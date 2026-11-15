// SPDX-License-Identifier: MPL-2.0
// @upstream sc/source/filter/excel/xecontent.cxx reduced
// @upstream sc/source/filter/excel/xestring.cxx reduced
// XclExpSst (the shared string table, sharedStrings.xml, with rich text runs of edit cells as
// XclExpString's formatting runs) and XclExpHyperlink (the hyperlinks of a sheet, external targets
// as relations, document-internal ones as locations). Reduced: conditional formatting, data
// validation and the web queries of xecontent.cxx are not exported (they are not imported).
import { escapeXml } from '../../../../xmloff/source/core/xmlparse.ts';
import { encodeXString } from '../../../../oox/source/helper/attributelist.ts';
import type { EditCharAttribs, EditTextObject } from '../../../../editeng/source/editeng/editobj.ts';
import type { ScPatternAttr } from '../../../inc/patattr.ts';
import { ToARGB } from './xestyle.ts';

/** The t element of a text, with xml:space="preserve" where whitespace matters. */
export function WriteText(s: string): string {
  const e = escapeXml(encodeXString(s));
  return /^\s|\s$|\n/.test(s) ? `<t xml:space="preserve">${e}</t>` : `<t>${e}</t>`;
}

/** XclXmlUtils::WriteFontData for a run: the cell font with the run's attributes (rPr). */
function RunProperties(a: EditCharAttribs, p: ScPatternAttr): string {
  const font = a.ATTR_FONT ?? p.GetItem('ATTR_FONT');
  const height = a.ATTR_FONT_HEIGHT ?? p.GetItem('ATTR_FONT_HEIGHT');
  const bold = a.ATTR_FONT_WEIGHT ?? p.GetItem('ATTR_FONT_WEIGHT');
  const italic = a.ATTR_FONT_POSTURE ?? p.GetItem('ATTR_FONT_POSTURE');
  const strike = a.ATTR_FONT_CROSSEDOUT ?? p.GetItem('ATTR_FONT_CROSSEDOUT');
  const u = a.ATTR_FONT_UNDERLINE ?? p.GetItem('ATTR_FONT_UNDERLINE');
  const color = a.ATTR_FONT_COLOR !== undefined ? a.ATTR_FONT_COLOR : p.GetItem('ATTR_FONT_COLOR');
  let s = '<rPr>';
  if (bold) s += '<b val="true"/>';
  if (italic) s += '<i val="true"/>';
  if (strike) s += '<strike val="true"/>';
  if (u && u !== 'none') s += `<u val="${u === 'double' ? 'double' : 'single'}"/>`;
  if (a.ESCAPEMENT) s += `<vertAlign val="${a.ESCAPEMENT > 0 ? 'superscript' : 'subscript'}"/>`;
  s += `<sz val="${height / 20}"/>`;
  if (color) s += `<color rgb="${ToARGB(color)}"/>`;
  s += `<rFont val="${escapeXml(font)}"/><family val="2"/></rPr>`;
  return s;
}

/** Whether an edit text needs rich text runs (character attributes other than fields). */
export function IsRichText(p: EditTextObject): boolean {
  return p.GetParagraphs().some((para) => para.maCharAttribs.some((r) => Object.keys(r.aAttribs).some((k) => k !== 'URL' && k !== 'FIELD')));
}

export class XclExpSst {
  private maStrings: string[] = [];
  private maIndex = new Map<string, number>();
  private mnTotal = 0;

  /** Insert a plain string; the index of its si. */
  Insert(rString: string): number {
    return this.InsertXml(WriteText(rString));
  }

  /** Insert an edit text with its formatting runs (relative to the cell's pattern). */
  InsertRich(pText: EditTextObject, pPattern: ScPatternAttr): number {
    if (!IsRichText(pText)) return this.Insert(pText.GetString());
    let s = '';
    pText.GetParagraphs().forEach((para, nPara) => {
      // the run boundaries of the paragraph
      const cuts = new Set([0, para.aText.length]);
      for (const r of para.maCharAttribs) { cuts.add(Math.max(0, Math.min(para.aText.length, r.nStart))); cuts.add(Math.max(0, Math.min(para.aText.length, r.nEnd))); }
      const pos = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i + 1 < pos.length; i++) {
        const a = pos[i]!, b = pos[i + 1]!;
        if (a === b) continue;
        const attribs: EditCharAttribs = {};
        for (const r of para.maCharAttribs) if (r.nStart <= a && r.nEnd >= b) Object.assign(attribs, r.aAttribs);
        delete attribs.URL; delete attribs.FIELD;
        let t = para.aText.slice(a, b);
        if (nPara > 0 && i === 0) t = `\n${t}`;
        s += `<r>${Object.keys(attribs).length ? RunProperties(attribs, pPattern) : ''}${WriteText(t)}</r>`;
      }
      if (nPara > 0 && !para.aText.length) s += `<r>${WriteText('\n')}</r>`;
    });
    return this.InsertXml(s);
  }

  private InsertXml(s: string): number {
    ++this.mnTotal;
    let n = this.maIndex.get(s);
    if (n === undefined) { n = this.maStrings.length; this.maStrings.push(s); this.maIndex.set(s, n); }
    return n;
  }

  IsEmpty(): boolean { return this.maStrings.length === 0; }

  SaveXml(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.mnTotal}" uniqueCount="${this.maStrings.length}">`
      + this.maStrings.map((s) => `<si>${s}</si>`).join('') + '</sst>';
  }
}

/** XclExpHyperlink: a hyperlink of a cell; a "#Sheet.A1" URL is a location in the document. */
export interface XclExpHyperlink { ref: string; url: string }

/** The hyperlinks element of a sheet and the relations of its external targets. */
export function SaveHyperlinksXml(aLinks: XclExpHyperlink[], addRel: (target: string) => string): string {
  if (!aLinks.length) return '';
  let s = '<hyperlinks>';
  for (const l of aLinks) {
    if (l.url.startsWith('#')) {
      // a reference into the document: '#Sheet.A1' is 'Sheet!A1' in Excel
      let aLoc = l.url.slice(1);
      const nSep = aLoc.lastIndexOf('.');
      if (nSep > 0 && /^\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?$/.test(aLoc.slice(nSep + 1))) aLoc = `${aLoc.slice(0, nSep)}!${aLoc.slice(nSep + 1)}`;
      s += `<hyperlink ref="${l.ref}" location="${escapeXml(aLoc)}" display="${escapeXml(aLoc)}"/>`;
    } else {
      const nHash = l.url.indexOf('#');
      const aTarget = nHash >= 0 ? l.url.slice(0, nHash) : l.url;
      const aLoc = nHash >= 0 ? l.url.slice(nHash + 1) : '';
      s += `<hyperlink ref="${l.ref}" r:id="${addRel(aTarget)}"${aLoc ? ` location="${escapeXml(aLoc)}"` : ''}/>`;
    }
  }
  return `${s}</hyperlinks>`;
}
