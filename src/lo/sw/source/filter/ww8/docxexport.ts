// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/ww8/docxexport.cxx reduced
// @upstream sw/source/filter/ww8/docxattributeoutput.cxx reduced
// @upstream sw/source/filter/ww8/docxsdrexport.cxx reduced
// @upstream sw/source/filter/ww8/docxtableexport.cxx reduced
// Writes the model as WordprocessingML. Reduced: styles carry the attributes the model has;
// tables are written on a grid computed from their rows' relative widths; text frames become
// DrawingML text boxes; tables of contents are their current text; page styles become sections
// (headers and footers per page style, columns, page number restarts) and sections with columns
// continuous section breaks. Tracked changes, comments, footnotes and endnotes are written; fields
// other than page number, page count, date and time are not in the model.
import { writeZip } from '../../../../package/source/zipapi/zip.ts';
import { escapeXml } from '../../../../xmloff/source/core/xmlparse.ts';
import type { SwDoc } from '../../../inc/doc.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwNode, SwSectionNode, SwTableNode } from '../../../inc/node.ts';
import { SwStartNodeType } from '../../../inc/ndtyp.ts';
import { CH_TXTATR_BREAKWORD, POOL_DEFAULTS, type SvxBorderLine, type SwAttrSet, type SwCharAttrSet, type SwField, type SwFlyCnt, type SwRedlineData } from '../../../inc/hintids.ts';
import type { SwFormat } from '../../../inc/format.ts';
import { HoriOrientation, RelOrientation, VertOrientation, WrapTextMode, type SwFlyFrameFormat } from '../../../inc/frmfmt.ts';
import type { SwFormatCol } from '../../../inc/fmtclds.ts';
import type { SwPageDesc } from '../../../inc/pagedesc.ts';
import type { SwNumRule } from '../../../inc/numrule.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DOC_NS = `xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"`;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Twips to EMU: 635 EMU per twip. */
const emu = (t: number) => Math.round(t * 635);
const attr = (k: string, v: string | number) => ` w:${k}="${escapeXml(String(v))}"`;
const color = (c: string) => c.replace(/^#/, '').toUpperCase();

/** MSWordStyles::GetWWId: Writer pool styles to Word's built-in style ids and names. */
function wordStyle(name: string): { id: string; name: string } {
  const h = /^Heading (\d)$/.exec(name);
  if (h) return { id: `Heading${h[1]}`, name: `heading ${h[1]}` };
  const toc = /^Contents (\d+)$/.exec(name);
  if (toc) return { id: `TOC${toc[1]}`, name: `toc ${toc[1]}` };
  const map: Record<string, [string, string]> = {
    Standard: ['Normal', 'Normal'], 'Text Body': ['BodyText', 'Body Text'], Footnote: ['FootnoteText', 'footnote text'], Endnote: ['EndnoteText', 'endnote text'],
    Header: ['Header', 'header'], Footer: ['Footer', 'footer'], Title: ['Title', 'Title'], Subtitle: ['Subtitle', 'Subtitle'], Quotations: ['Quote', 'Quote'],
    'Contents Heading': ['TOCHeading', 'TOC Heading'], 'Default Character Style': ['DefaultParagraphFont', 'Default Paragraph Font'],
  };
  const m = map[name];
  return m ? { id: m[0], name: m[1] } : { id: name.replace(/[^A-Za-z0-9]/g, '') || 'Style', name };
}

/** WW8 numbering formats (DocxAttributeOutput::NumberingLevel's GetNumberFormat counterpart). */
const NUM_FMT: Partial<Record<NumberingType, string>> = {
  [NumberingType.ARABIC]: 'decimal', [NumberingType.CHARS_UPPER_LETTER]: 'upperLetter', [NumberingType.CHARS_LOWER_LETTER]: 'lowerLetter',
  [NumberingType.CHARS_UPPER_LETTER_N]: 'upperLetter', [NumberingType.CHARS_LOWER_LETTER_N]: 'lowerLetter',
  [NumberingType.ROMAN_UPPER]: 'upperRoman', [NumberingType.ROMAN_LOWER]: 'lowerRoman', [NumberingType.CHAR_SPECIAL]: 'bullet', [NumberingType.NUMBER_NONE]: 'none',
};

/** DocxAttributeOutput's run properties for a set of character attributes. */
function rPrXml(s: SwCharAttrSet, charStyle?: string): string {
  let o = charStyle ? `<w:rStyle${attr('val', charStyle)}/>` : '';
  if (s.RES_CHRATR_FONT) o += `<w:rFonts${attr('ascii', s.RES_CHRATR_FONT)}${attr('hAnsi', s.RES_CHRATR_FONT)}${attr('cs', s.RES_CHRATR_FONT)}/>`;
  if (s.RES_CHRATR_WEIGHT !== undefined) o += s.RES_CHRATR_WEIGHT ? '<w:b/><w:bCs/>' : '<w:b w:val="false"/><w:bCs w:val="false"/>';
  if (s.RES_CHRATR_POSTURE !== undefined) o += s.RES_CHRATR_POSTURE ? '<w:i/><w:iCs/>' : '<w:i w:val="false"/><w:iCs w:val="false"/>';
  if (s.RES_CHRATR_CASEMAP === 'uppercase') o += '<w:caps/>';
  if (s.RES_CHRATR_CROSSEDOUT !== undefined) o += s.RES_CHRATR_CROSSEDOUT ? '<w:strike/>' : '<w:strike w:val="false"/>';
  if (s.RES_CHRATR_COLOR !== undefined) o += `<w:color${attr('val', s.RES_CHRATR_COLOR ? color(s.RES_CHRATR_COLOR) : 'auto')}/>`;
  if (s.RES_CHRATR_FONTSIZE !== undefined) { const hp = Math.round(s.RES_CHRATR_FONTSIZE / 10); o += `<w:sz${attr('val', hp)}/><w:szCs${attr('val', hp)}/>`; }
  if (s.RES_CHRATR_UNDERLINE !== undefined) o += `<w:u${attr('val', { none: 'none', single: 'single', double: 'double', dotted: 'dotted', dash: 'dash', wave: 'wave' }[s.RES_CHRATR_UNDERLINE])}/>`;
  if (s.RES_CHRATR_BACKGROUND) o += `<w:shd w:val="clear" w:color="auto"${attr('fill', color(s.RES_CHRATR_BACKGROUND))}/>`;
  if (s.RES_CHRATR_ESCAPEMENT) o += `<w:vertAlign${attr('val', s.RES_CHRATR_ESCAPEMENT > 0 ? 'superscript' : 'subscript')}/>`;
  if (s.RES_CHRATR_LANGUAGE) o += `<w:lang${attr('val', s.RES_CHRATR_LANGUAGE === 'zxx' ? 'zxx' : s.RES_CHRATR_LANGUAGE)}/>`;
  return o ? `<w:rPr>${o}</w:rPr>` : '';
}

const borderXml = (tag: string, b: SvxBorderLine | null | undefined, space = 0) =>
  b ? `<w:${tag} w:val="single"${attr('sz', Math.max(2, Math.round((b.width * 8) / 20)))}${attr('space', Math.round(space / 20))}${attr('color', color(b.color))}/>` : `<w:${tag} w:val="nil"/>`;

/** DocxAttributeOutput's paragraph properties (without style, numbering and section). */
function pPrInner(s: SwAttrSet): string {
  let o = '';
  if (s.RES_KEEP) o += '<w:keepNext/>';
  if (s.RES_BREAK === 'page-before') o += '<w:pageBreakBefore/>';
  if (s.RES_PARATR_WIDOWS !== undefined || s.RES_PARATR_ORPHANS !== undefined) o += (s.RES_PARATR_WIDOWS ?? 2) > 1 ? '<w:widowControl/>' : '<w:widowControl w:val="false"/>';
  const box = s.RES_BOX;
  if (box) o += `<w:pBdr>${box.top ? borderXml('top', box.top, box.padding) : ''}${box.left ? borderXml('left', box.left, box.padding) : ''}${box.bottom ? borderXml('bottom', box.bottom, box.padding) : ''}${box.right ? borderXml('right', box.right, box.padding) : ''}</w:pBdr>`;
  if (s.RES_BACKGROUND) o += `<w:shd w:val="clear" w:color="auto"${attr('fill', color(s.RES_BACKGROUND))}/>`;
  if (s.RES_PARATR_TABSTOP?.length) {
    o += `<w:tabs>${s.RES_PARATR_TABSTOP.map((t) => `<w:tab${attr('val', t.adjust === 'decimal' ? 'decimal' : t.adjust === 'center' ? 'center' : t.adjust === 'right' ? 'right' : 'left')}${t.fill === '.' ? ' w:leader="dot"' : t.fill === '-' ? ' w:leader="hyphen"' : t.fill === '_' ? ' w:leader="underscore"' : ''}${attr('pos', t.pos)}/>`).join('')}</w:tabs>`;
  }
  const ul = s.RES_UL_SPACE, ls = s.RES_PARATR_LINESPACING;
  if (ul || ls) {
    let sp = '';
    if (ul) sp += attr('before', ul.upper) + attr('after', ul.lower);
    if (ls) sp += ls.rule === 'proportional' ? attr('line', Math.round((ls.value * 240) / 100)) + attr('lineRule', 'auto') : attr('line', ls.value) + attr('lineRule', ls.rule === 'fix' ? 'exact' : 'atLeast');
    o += `<w:spacing${sp}/>`;
  }
  const lr = s.RES_LR_SPACE;
  if (lr) o += `<w:ind${attr('left', lr.left)}${attr('right', lr.right)}${lr.firstLine < 0 ? attr('hanging', -lr.firstLine) : attr('firstLine', lr.firstLine)}/>`;
  const bidi = s.RES_FRAMEDIR === 'rl-tb';
  if (s.RES_FRAMEDIR) o += bidi ? '<w:bidi/>' : '<w:bidi w:val="0"/>';
  // Word mirrors left and right in right-to-left paragraphs.
  if (s.RES_PARATR_ADJUST) o += `<w:jc${attr('val', { left: bidi ? 'right' : 'left', right: bidi ? 'left' : 'right', center: 'center', block: 'both' }[s.RES_PARATR_ADJUST])}/>`;
  return o;
}

const charOnly = (s: SwAttrSet): SwCharAttrSet => Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('RES_CHRATR_'))) as SwCharAttrSet;

/** The table's columns: every distinct cell edge over all rows, in twips of the table width. */
function tableGrid(t: SwTableNode, width: number): { grid: number[]; rows: { edges: number[] }[] } {
  const rows = t.m_pTable.GetTabLines().map((line) => {
    const total = line.m_aBoxes.reduce((a, b) => a + b.m_aAttrs.width, 0) || 1;
    let x = 0;
    const edges = [0];
    for (const b of line.m_aBoxes) { x += (b.m_aAttrs.width / total) * width; edges.push(Math.round(x)); }
    return { edges };
  });
  const all = [...new Set(rows.flatMap((r) => r.edges))].sort((a, b) => a - b);
  // Edges closer than 20 twips are one.
  const merged: number[] = [];
  for (const e of all) if (!merged.length || e - merged[merged.length - 1]! > 20) merged.push(e);
  for (const r of rows) r.edges = r.edges.map((e) => merged.reduce((best, m) => (Math.abs(m - e) < Math.abs(best - e) ? m : best), merged[0]!));
  return { grid: merged.slice(1).map((e, i) => e - merged[i]!), rows };
}

export async function ExportDOCX(doc: SwDoc): Promise<Uint8Array> {
  const nodes = doc.GetNodes();
  const enc = new TextEncoder();
  // MSWordStyles::BuildStylesTable: every style gets an id of its own.
  const styleIds = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const name of [...doc.m_aTextFormatColls.keys(), ...doc.m_aCharFormats.keys()]) {
    const base = wordStyle(name).id;
    let id = base;
    for (let k = 1; usedIds.has(id.toLowerCase()); k++) id = `${base}${k}`;
    usedIds.add(id.toLowerCase());
    styleIds.set(name, id);
  }
  const sid = (name: string): string => styleIds.get(name) ?? wordStyle(name).id;
  const files: { name: string; data: Uint8Array }[] = [];
  const overrides: [string, string][] = [];
  const mediaTypes = new Set<string>();

  // Relationships of document.xml (headers, footers and media from every part share it).
  const docRels: string[] = [];
  let relId = 0;
  const addRel = (type: string, target: string, external = false): string => {
    const id = `rId${++relId + 10}`;
    docRels.push(`<Relationship Id="${id}" Type="${REL_TYPE}/${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
    return id;
  };
  // Every part's relationships: images and links are written per part.
  let partRels: string[] = docRels;
  const partRel = (type: string, target: string, external = false): string => {
    if (partRels === docRels) return addRel(type, target, external);
    const id = `rId${partRels.length + 1}`;
    partRels.push(`<Relationship Id="${id}" Type="${REL_TYPE}/${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`);
    return id;
  };
  const media = new Map<string, string>();
  const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif' };
  const mediaPath = (key: string): string | null => {
    const g = doc.m_aGraphics.get(key);
    if (!g) return null;
    let p = media.get(key);
    if (!p) {
      const ext = EXT[g.mime] ?? 'bin';
      p = `media/image${media.size + 1}.${ext}`;
      media.set(key, p);
      files.push({ name: `word/${p}`, data: g.data });
      mediaTypes.add(`${ext}|${g.mime}`);
    }
    return p;
  };
  let drawingId = 0;

  // --- numbering (DocxAttributeOutput::NumberingDefinition, AbstractNumberingDefinition) ---
  const abstractOf = new Map<SwNumRule, number>();
  const nums: { id: number; abs: number; restart?: { level: number; start: number } }[] = [];
  const numOfList = new Map<string, number>();
  const numIdFor = (n: SwTextNode, rule: SwNumRule): number => {
    let abs = abstractOf.get(rule);
    if (abs === undefined) { abs = abstractOf.size; abstractOf.set(rule, abs); }
    const listKey = `${rule.GetName()}|${n.GetAttr('RES_PARATR_LIST_ID')}`;
    let id = numOfList.get(listKey);
    // A restart is a new w:num with a start override, which the list then goes on with.
    if (id === undefined || (n.GetAttr('RES_PARATR_LIST_ISRESTART') && n.GetAttr('RES_PARATR_LIST_ISCOUNTED'))) {
      id = nums.length + 1;
      const level = n.GetAttr('RES_PARATR_LIST_LEVEL');
      const rv = n.GetAttr('RES_PARATR_LIST_RESTARTVALUE');
      nums.push({ id, abs, ...(numOfList.has(listKey) ? { restart: { level, start: rv >= 0 ? rv : rule.Get(level).GetStart() } } : {}) });
      numOfList.set(listKey, id);
    }
    return id;
  };

  // --- comments, footnotes, endnotes ---
  const comments: string[] = [];
  const commentIds = new Map<string, number>();
  const footnotes: string[] = [];
  const endnotes: string[] = [];
  let redlineId = 0;
  const redlineAttrs = (r: SwRedlineData) => `${attr('id', ++redlineId)}${attr('author', r.author)}${r.date ? attr('date', r.date) : ''}`;

  /** DocxAttributeOutput::StartParagraph ... EndParagraph */
  const paraXml = (n: SwTextNode, extraPPr = '', noteRef?: 'footnote' | 'endnote'): string => {
    const coll = n.GetTextColl();
    let pPr = coll.GetName() !== 'Standard' ? `<w:pStyle${attr('val', sid(coll.GetName()))}/>` : '';
    const rule = doc.FindNumRulePtr(n.GetAttr('RES_PARATR_NUMRULE'));
    if (rule) pPr += `<w:numPr><w:ilvl${attr('val', Math.min(8, n.GetAttr('RES_PARATR_LIST_LEVEL')))}/><w:numId${attr('val', n.GetAttr('RES_PARATR_LIST_ISCOUNTED') ? numIdFor(n, rule) : 0)}/></w:numPr>`;
    const own = { ...n.m_aSet };
    // A list's indents come from the numbering unless the paragraph sets its own.
    pPr += pPrInner(own) + extraPPr;
    const mark = n.m_aSet.RES_PARATR_REDLINE;
    const markRPr = mark ? `<w:rPr><w:${mark.type === 'Insert' ? 'ins' : 'del'}${redlineAttrs(mark)}/></w:rPr>` : '';
    let body = '';
    if (noteRef) body += `<w:r><w:rPr><w:rStyle${attr('val', noteRef === 'footnote' ? 'FootnoteReference' : 'EndnoteReference')}/></w:rPr><w:${noteRef}Ref/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>`;
    // Anchored objects go at their anchor position, at the start of the run there.
    const anchored = (pos: number) => n.m_aAnchoredFlys.filter((f) => Math.min(f.nContent, n.Len()) === pos).map((f) => `<w:r>${drawingXml(f.fmt)}</w:r>`).join('');
    const text = n.GetText();
    const cuts = new Set([0, text.length]);
    for (const h of n.m_aHints) { cuts.add(h.nStart); cuts.add(h.nEnd); }
    for (const f of n.m_aAnchoredFlys) cuts.add(Math.min(f.nContent, text.length));
    const sorted = [...cuts].sort((a, b) => a - b);
    let openLink: string | null = null, openRedline: SwRedlineData | null = null;
    let out = '';
    const closeLink = () => { if (openLink !== null) { out += '</w:hyperlink>'; openLink = null; } };
    const closeRedline = () => { if (openRedline) { out += `</w:${openRedline.type === 'Insert' ? 'ins' : 'del'}>`; openRedline = null; } };
    if (!text.length) out += anchored(0);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i]!, b = sorted[i + 1]!;
      out += anchored(a);
      if (a === b) continue;
      const h = n.m_aHints.find((x) => x.nStart <= a && a < x.nEnd);
      const rl = h?.aAttrs.RES_TXTATR_REDLINE ?? null;
      if (rl !== openRedline) { closeLink(); closeRedline(); if (rl) { out += `<w:${rl.type === 'Insert' ? 'ins' : 'del'}${redlineAttrs(rl)}>`; openRedline = rl; } }
      const url = h?.aAttrs.RES_TXTATR_INETFMT ?? null;
      if (url !== openLink) {
        closeLink();
        if (url !== null) { out += url.startsWith('#') ? `<w:hyperlink${attr('anchor', url.slice(1))}>` : `<w:hyperlink r:id="${partRel('hyperlink', url, true)}">`; openLink = url; }
      }
      const own: SwCharAttrSet = h ? (Object.fromEntries(Object.entries(h.aAttrs).filter(([k]) => k.startsWith('RES_CHRATR_'))) as SwCharAttrSet) : {};
      const cf = h?.aAttrs.RES_TXTATR_CHARFMT;
      const rPr = rPrXml(own, cf ? sid(cf.GetName()) : undefined);
      const del = rl?.type === 'Delete';
      const fld = h?.aAttrs.RES_TXTATR_FIELD, fly = h?.aAttrs.RES_TXTATR_FLYCNT, ftn = h?.aAttrs.RES_TXTATR_FTN, ann = h?.aAttrs.RES_TXTATR_ANNOTATION;
      const mark = h?.aAttrs.RES_TXTATR_ANNOTMARK;
      const seg = text.slice(a, b);
      if (ann) {
        for (let k = 0; k < seg.length; k++) {
          const cid = commentIds.get(ann.id) ?? commentIds.size;
          commentIds.set(ann.id, cid);
          const hasRange = n.m_aHints.some((x) => x.aAttrs.RES_TXTATR_ANNOTMARK === ann.id);
          if (hasRange) out += `<w:commentRangeStart${attr('id', cid)}/>`;
          else out += `<w:r><w:commentReference${attr('id', cid)}/></w:r>`;
          comments.push(`<w:comment${attr('id', cid)}${attr('author', ann.author)}${ann.date ? attr('date', ann.date) : ''}${attr('initials', ann.author.split(/\s+/).map((w) => w[0] ?? '').join(''))}>${ann.text.split('\n').map((t) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`).join('')}</w:comment>`);
        }
      } else if (ftn) {
        for (let k = 0; k < seg.length; k++) {
          const list = ftn.endnote ? endnotes : footnotes;
          const id = list.length + 1;
          const tag = ftn.endnote ? 'endnote' : 'footnote';
          const sec = nodes.FindFootnoteSection(ftn.id);
          let content = '';
          if (sec) {
            let first = true;
            for (let j = sec.GetIndex() + 1; j < sec.EndOfSectionNode().GetIndex(); j++) {
              const m = nodes.node(j);
              if (m.IsTextNode()) { content += paraXml(m, '', first ? tag : undefined); first = false; }
            }
          }
          list.push(`<w:${tag}${attr('id', id)}>${content || '<w:p/>'}</w:${tag}>`);
          out += `<w:r><w:rPr><w:rStyle${attr('val', ftn.endnote ? 'EndnoteReference' : 'FootnoteReference')}/></w:rPr><w:${tag}Reference${attr('id', id)}/></w:r>`;
        }
      } else if (fly) {
        for (let k = 0; k < seg.length; k++) out += `<w:r>${rPr}${inlineXml(fly)}</w:r>`;
      } else if (fld) {
        for (let k = 0; k < seg.length; k++) out += fieldXml(fld, rPr);
      } else {
        // Text: tabs and line breaks are their own run content.
        let runs = '';
        for (const part of seg.split(/(\t|\n)/)) {
          if (!part) continue;
          if (part === '\t') runs += '<w:tab/>';
          else if (part === '\n') runs += '<w:br/>';
          else runs += del ? `<w:delText xml:space="preserve">${escapeXml(part.replaceAll(CH_TXTATR_BREAKWORD, ''))}</w:delText>` : `<w:t xml:space="preserve">${escapeXml(part.replaceAll(CH_TXTATR_BREAKWORD, ''))}</w:t>`;
        }
        out += `<w:r>${rPr}${runs}</w:r>`;
      }
      if (mark) {
        const next = n.m_aHints.find((x) => x.nStart <= b && b < x.nEnd);
        if (next?.aAttrs.RES_TXTATR_ANNOTMARK !== mark) {
          const cid = commentIds.get(mark);
          if (cid !== undefined) out += `<w:commentRangeEnd${attr('id', cid)}/><w:r><w:commentReference${attr('id', cid)}/></w:r>`;
        }
      }
    }
    closeLink(); closeRedline();
    if (text.length) out += anchored(text.length);
    body += out;
    const pPrAll = pPr + markRPr;
    return `<w:p>${pPrAll ? `<w:pPr>${pPrAll}</w:pPr>` : ''}${body}</w:p>`;
  };

  /** DocxAttributeOutput::WriteField_Impl for the field types in the model. */
  const fieldXml = (f: SwField, rPr: string): string => {
    if (f.fixed !== undefined) return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(f.fixed)}</w:t></w:r>`;
    const instr = { PageNumber: ' PAGE ', PageCount: ' NUMPAGES ', Date: ' DATE \\@ "d. MMM. yyyy" ', Time: ' TIME \\@ "HH:mm" ' }[f.type];
    const shown = f.type === 'PageNumber' || f.type === 'PageCount' ? '1' : f.type === 'Date' ? new Date().toLocaleDateString() : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<w:r>${rPr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPr}<w:instrText xml:space="preserve">${escapeXml(instr)}</w:instrText></w:r><w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPr}<w:t>${escapeXml(shown)}</w:t></w:r><w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r>`;
  };

  const graphicXml = (key: string, w: number, h: number, name: string, id: number): string => {
    const path = mediaPath(key);
    if (!path) return '';
    const rid = partRel('image', path);
    return `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  };

  /** DocxSdrExport::writeInlineGraphic */
  const inlineXml = (f: SwFlyCnt): string => {
    const id = ++drawingId;
    return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(f.width)}" cy="${emu(f.height)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${escapeXml(f.name)}"${f.alt ? ` descr="${escapeXml(f.alt)}"` : ''}/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphicXml(f.graphic, f.width, f.height, f.name, id)}</wp:inline></w:drawing>`;
  };

  // DocxSdrExport::startDMLAnchorInline: the inverse of the import's PositionHandler mappings.
  const REL_H: Record<number, string> = { [RelOrientation.PAGE_PRINT_AREA]: 'margin', [RelOrientation.PAGE_FRAME]: 'page', [RelOrientation.FRAME]: 'column', [RelOrientation.PRINT_AREA]: 'column', [RelOrientation.CHAR]: 'character', [RelOrientation.PAGE_LEFT]: 'leftMargin', [RelOrientation.PAGE_RIGHT]: 'rightMargin', [RelOrientation.FRAME_LEFT]: 'column', [RelOrientation.FRAME_RIGHT]: 'column' };
  const REL_V: Record<number, string> = { [RelOrientation.PAGE_PRINT_AREA]: 'margin', [RelOrientation.PAGE_FRAME]: 'page', [RelOrientation.PAGE_PRINT_AREA_TOP]: 'topMargin', [RelOrientation.PAGE_PRINT_AREA_BOTTOM]: 'bottomMargin', [RelOrientation.FRAME]: 'paragraph', [RelOrientation.PRINT_AREA]: 'paragraph', [RelOrientation.TEXT_LINE]: 'line', [RelOrientation.CHAR]: 'line' };
  const ALIGN_H: Record<number, string> = { [HoriOrientation.LEFT]: 'left', [HoriOrientation.CENTER]: 'center', [HoriOrientation.RIGHT]: 'right', [HoriOrientation.INSIDE]: 'inside', [HoriOrientation.OUTSIDE]: 'outside' };
  const ALIGN_V: Record<number, string> = { [VertOrientation.TOP]: 'top', [VertOrientation.CENTER]: 'center', [VertOrientation.BOTTOM]: 'bottom' };

  /** DocxSdrExport::writeDMLDrawing / writeDMLTextFrame: an anchored picture or text box. */
  const drawingXml = (f: SwFlyFrameFormat): string => {
    const id = ++drawingId;
    const h = f.m_aHoriOrient, v = f.m_aVertOrient;
    const posH = `<wp:positionH relativeFrom="${REL_H[h.m_eRelation] ?? 'column'}">${ALIGN_H[h.m_eOrient] ? `<wp:align>${ALIGN_H[h.m_eOrient]}</wp:align>` : `<wp:posOffset>${emu(h.m_nPos)}</wp:posOffset>`}</wp:positionH>`;
    const posV = `<wp:positionV relativeFrom="${REL_V[v.m_eRelation] ?? 'paragraph'}">${ALIGN_V[v.m_eOrient] ? `<wp:align>${ALIGN_V[v.m_eOrient]}</wp:align>` : `<wp:posOffset>${emu(v.m_nPos)}</wp:posOffset>`}</wp:positionV>`;
    const wrapText = { [WrapTextMode.LEFT]: 'left', [WrapTextMode.RIGHT]: 'right', [WrapTextMode.DYNAMIC]: 'largest' }[f.m_aSurround.m_eSurround as number] ?? 'bothSides';
    const wrap = f.m_aSurround.m_eSurround === WrapTextMode.THROUGH ? '<wp:wrapNone/>' : f.m_aSurround.m_eSurround === WrapTextMode.NONE ? '<wp:wrapTopAndBottom/>' : `<wp:wrapSquare wrapText="${wrapText}"/>`;
    const head = `<wp:anchor distT="${emu(f.m_nUpperSpace)}" distB="${emu(f.m_nLowerSpace)}" distL="${emu(f.m_nLeftSpace)}" distR="${emu(f.m_nRightSpace)}" simplePos="0" relativeHeight="${251659264 + (f.m_nZOrder ?? 0) + id}" behindDoc="${f.m_bOpaque ? 0 : 1}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>${posH}${posV}`;
    const docPr = `<wp:docPr id="${id}" name="${escapeXml(f.m_aName)}"${f.alt ? ` descr="${escapeXml(f.alt)}"` : ''}/>`;
    if (f.graphic !== undefined) {
      return `<w:drawing>${head}<wp:extent cx="${emu(f.m_nWidth)}" cy="${emu(f.m_nHeight)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrap}${docPr}<wp:cNvGraphicFramePr/>${graphicXml(f.graphic, f.m_nWidth, f.m_nHeight, f.m_aName, id)}</wp:anchor></w:drawing>`;
    }
    // A text frame: a wps text box with its fill, outline and insets.
    const sec = f.m_sContentId ? nodes.FindFlySection(f.m_sContentId) : null;
    let content = '';
    if (sec) content = sectionXml(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex());
    const line = f.m_aBox?.top;
    const ln = line ? `<a:ln w="${emu(line.width)}"><a:solidFill><a:srgbClr val="${color(line.color)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
    const fill = f.m_aBackground ? `<a:solidFill><a:srgbClr val="${color(f.m_aBackground)}"/></a:solidFill>` : '<a:noFill/>';
    const ins = emu(f.m_aBox?.padding ?? 0);
    return `<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${head}<wp:extent cx="${emu(f.m_nWidth)}" cy="${emu(f.m_nHeight)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrap}${docPr}<wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(f.m_nWidth)}" cy="${emu(f.m_nHeight)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${ln}</wps:spPr><wps:txbx><w:txbxContent>${content || '<w:p/>'}</w:txbxContent></wps:txbx><wps:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="t">${f.m_bAutoHeight ? '<a:spAutoFit/>' : '<a:noAutofit/>'}</wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice></mc:AlternateContent>`;
  };

  /** DocxAttributeOutput::TableDefinition and friends: grid, rows, cells, merges, borders. */
  const tableXml = (t: SwTableNode, areaWidth: number): string => {
    const a = t.m_pTable.m_aAttrs;
    const width = a.adjust === 'full' || !a.width ? areaWidth : a.width;
    const { grid, rows } = tableGrid(t, width);
    const lines = t.m_pTable.GetTabLines();
    let out = `<w:tbl><w:tblPr><w:tblW${attr('w', width)} w:type="dxa"/>${a.adjust === 'center' ? '<w:jc w:val="center"/>' : a.adjust === 'right' ? '<w:jc w:val="right"/>' : ''}${a.adjust === 'left' || a.adjust === 'none' ? `<w:tblInd${attr('w', a.leftSpace)} w:type="dxa"/>` : ''}<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0"/></w:tblPr>`;
    out += `<w:tblGrid>${grid.map((g) => `<w:gridCol${attr('w', g)}/>`).join('')}</w:tblGrid>`;
    lines.forEach((line, li) => {
      out += `<w:tr><w:trPr>${li < t.m_pTable.GetRowsToRepeat() ? '<w:tblHeader/>' : ''}${line.m_aAttrs.minHeight ? `<w:trHeight${attr('val', line.m_aAttrs.minHeight)} w:hRule="atLeast"/>` : ''}</w:trPr>`;
      const edges = rows[li]!.edges;
      line.m_aBoxes.forEach((box, bi) => {
        const from = edges[bi]!, to = edges[bi + 1]!;
        const span = Math.max(1, grid.reduce((acc, _g, gi) => { const gx = grid.slice(0, gi).reduce((s, x) => s + x, 0); return acc + (gx >= from && gx < to ? 1 : 0); }, 0));
        const b = box.m_aAttrs;
        const rs = box.getRowSpan();
        const vMerge = rs > 1 ? '<w:vMerge w:val="restart"/>' : rs < 0 ? '<w:vMerge/>' : '';
        out += `<w:tc><w:tcPr><w:tcW${attr('w', to - from)} w:type="dxa"/>${span > 1 ? `<w:gridSpan${attr('val', span)}/>` : ''}${vMerge}<w:tcBorders>${borderXml('top', b.box.top)}${borderXml('left', b.box.left)}${borderXml('bottom', b.box.bottom)}${borderXml('right', b.box.right)}</w:tcBorders>${b.background ? `<w:shd w:val="clear" w:color="auto"${attr('fill', color(b.background))}/>` : ''}<w:tcMar><w:top${attr('w', b.padding)} w:type="dxa"/><w:left${attr('w', b.padding)} w:type="dxa"/><w:bottom${attr('w', b.padding)} w:type="dxa"/><w:right${attr('w', b.padding)} w:type="dxa"/></w:tcMar></w:tcPr>`;
        const sn = box.GetSttNd();
        const inner = sn && rs >= 0 ? sectionXml(sn.GetIndex() + 1, sn.EndOfSectionNode().GetIndex(), to - from - 2 * b.padding) : '';
        // A cell must end with a paragraph.
        out += `${inner && inner.endsWith('</w:p>') ? inner : `${inner}<w:p/>`}</w:tc>`;
      });
      out += '</w:tr>';
    });
    return `${out}</w:tbl>`;
  };

  /** The blocks of a node range (a cell, a header, a note, a text box): paragraphs and tables. */
  function sectionXml(from: number, to: number, width = doc.m_aPageDesc.PrintWidth()): string {
    let out = '';
    for (let i = from; i < to;) {
      const n = nodes.node(i);
      if (n.IsTextNode()) { out += paraXml(n); i++; }
      else if (n.IsTableNode()) { out += tableXml(n as SwTableNode, width); i = (n as SwTableNode).EndOfSectionNode().GetIndex() + 1; }
      else i++;
    }
    return out;
  }

  // --- headers and footers per page style (DocxExport::WriteHeadersFooters) ---
  const hfRefs = new Map<string, string>();
  let hfCount = 0;
  let anyLeft = false;
  const headerFooterRefs = (desc: SwPageDesc): string => {
    let out = '';
    for (const [eTyp, part, kind, wordType] of [
      [SwStartNodeType.SwHeaderStartNode, 'header', 'default', 'default'], [SwStartNodeType.SwHeaderStartNode, 'header', 'first', 'first'], [SwStartNodeType.SwHeaderStartNode, 'header', 'left', 'even'],
      [SwStartNodeType.SwFooterStartNode, 'footer', 'default', 'default'], [SwStartNodeType.SwFooterStartNode, 'footer', 'first', 'first'], [SwStartNodeType.SwFooterStartNode, 'footer', 'left', 'even'],
    ] as const) {
      const sec = nodes.FindAreaSection(eTyp, kind, desc.m_aName);
      if (!sec) continue;
      if (kind === 'left') anyLeft = true;
      const key = `${desc.m_aName}|${part}|${kind}`;
      let rid = hfRefs.get(key);
      if (!rid) {
        const name = `${part}${++hfCount}.xml`;
        const saved = partRels;
        partRels = [];
        const content = sectionXml(sec.GetIndex() + 1, sec.EndOfSectionNode().GetIndex(), desc.PrintWidth());
        const rels = partRels;
        partRels = saved;
        const tag = part === 'header' ? 'w:hdr' : 'w:ftr';
        files.push({ name: `word/${name}`, data: enc.encode(`${HEAD}<${tag} ${DOC_NS}>${content || '<w:p/>'}</${tag}>`) });
        if (rels.length) files.push({ name: `word/_rels/${name}.rels`, data: enc.encode(`${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`) });
        overrides.push([`/word/${name}`, `application/vnd.openxmlformats-officedocument.wordprocessingml.${part}+xml`]);
        rid = addRel(part, name);
        hfRefs.set(key, rid);
      }
      out += `<w:${part}Reference w:type="${wordType}" r:id="${rid}"/>`;
    }
    return out;
  };

  /** DocxAttributeOutput::SectionProperties: one section of the body. */
  const sectPrXml = (desc: SwPageDesc, type: 'nextPage' | 'continuous', cols: SwFormatCol | null, numStart: number | null): string => {
    const refs = headerFooterRefs(desc);
    const hasFirst = !!nodes.FindAreaSection(SwStartNodeType.SwHeaderStartNode, 'first', desc.m_aName) || !!nodes.FindAreaSection(SwStartNodeType.SwFooterStartNode, 'first', desc.m_aName);
    const hasHeader = !!nodes.FindAreaSection(SwStartNodeType.SwHeaderStartNode, 'default', desc.m_aName);
    const hasFooter = !!nodes.FindAreaSection(SwStartNodeType.SwFooterStartNode, 'default', desc.m_aName);
    // Word measures the header from the page edge and the body from the top margin.
    const top = hasHeader ? desc.nTop + Math.max(desc.nHeaderMinHeight, 0) + desc.nHeaderSpacing : desc.nTop;
    const bottom = hasFooter ? desc.nBottom + Math.max(desc.nFooterMinHeight, 0) + desc.nFooterSpacing : desc.nBottom;
    const colsXml = cols && cols.m_nCount > 1 ? `<w:cols${attr('num', cols.m_nCount)}${attr('space', cols.m_nGutterWidth)}${cols.m_bLine ? ' w:sep="1"' : ''}/>` : '<w:cols w:space="720"/>';
    return `<w:sectPr>${refs}${type === 'continuous' ? '<w:type w:val="continuous"/>' : ''}<w:pgSz${attr('w', desc.nWidth)}${attr('h', desc.nHeight)}${desc.nWidth > desc.nHeight ? ' w:orient="landscape"' : ''}/><w:pgMar${attr('top', top)}${attr('right', desc.nRight)}${attr('bottom', bottom)}${attr('left', desc.nLeft)}${attr('header', desc.nTop)}${attr('footer', desc.nBottom)} w:gutter="0"/>${numStart !== null ? `<w:pgNumType${attr('start', numStart)}/>` : ''}${colsXml}${hasFirst ? '<w:titlePg/>' : ''}</w:sectPr>`;
  };

  // --- the body: blocks grouped into sections by page style and by sections with columns ---
  interface Run { desc: SwPageDesc; type: 'nextPage' | 'continuous'; cols: SwFormatCol | null; numStart: number | null }
  const blocks: { node: SwNode; sec: SwSectionNode | null }[] = [];
  const secStack: SwSectionNode[] = [];
  for (let i = nodes.BodyStart(); i < nodes.GetEndOfContent().GetIndex();) {
    const n = nodes.node(i);
    while (secStack.length && i > secStack[secStack.length - 1]!.EndOfSectionNode().GetIndex()) secStack.pop();
    if (n.IsSectionNode()) { secStack.push(n as SwSectionNode); i++; continue; }
    const flow = [...secStack].reverse().find((x) => (x.m_pSection.m_aCol?.m_nCount ?? 1) > 1) ?? null;
    if (n.IsTextNode()) { blocks.push({ node: n, sec: flow }); i++; }
    else if (n.IsTableNode()) { blocks.push({ node: n, sec: flow }); i = (n as SwTableNode).EndOfSectionNode().GetIndex() + 1; }
    else i++;
  }
  const firstPd = blocks[0]?.node.IsTextNode() ? (blocks[0].node as SwTextNode).GetAttr('RES_PAGEDESC') : null;
  let run: Run = { desc: (firstPd && doc.FindPageDesc(firstPd.name)) || doc.m_aPageDesc, type: 'nextPage', cols: null, numStart: firstPd?.numOffset ?? null };
  run.cols = blocks[0]?.sec?.m_pSection.m_aCol ?? run.desc.m_aCol;
  let body = '';
  blocks.forEach((b, k) => {
    // The run after this block, if it starts a new section.
    const next = blocks[k + 1];
    let nextRun: Run | null = null;
    if (next) {
      const pd = next.node.IsTextNode() ? (next.node as SwTextNode).GetAttr('RES_PAGEDESC') : null;
      if (pd) {
        const d = doc.FindPageDesc(pd.name) ?? doc.m_aPageDesc;
        nextRun = { desc: d, type: 'nextPage', cols: next.sec?.m_pSection.m_aCol ?? d.m_aCol, numStart: pd.numOffset };
      } else if (next.sec !== b.sec) nextRun = { desc: run.desc, type: 'continuous', cols: next.sec?.m_pSection.m_aCol ?? run.desc.m_aCol, numStart: null };
    }
    const sect = nextRun ? sectPrXml(run.desc, run.type, run.cols, run.numStart) : '';
    if (b.node.IsTextNode()) {
      const n = b.node as SwTextNode;
      // A page style break is the previous section's end; Word has no break attribute for it.
      body += paraXml(n, sect);
    } else {
      body += tableXml(b.node as SwTableNode, run.desc.PrintWidth());
      // A section cannot end in a table: an empty paragraph carries the break.
      if (sect) body += `<w:p><w:pPr>${sect}</w:pPr></w:p>`;
    }
    if (nextRun) run = nextRun;
  });
  // Page anchored objects are anchored in the first paragraph in Word.
  if (doc.m_aPageFlys.length) {
    const flys = doc.m_aPageFlys.map((f) => `<w:r>${drawingXml({ ...f, m_aHoriOrient: { ...f.m_aHoriOrient, m_eRelation: f.m_aHoriOrient.m_eRelation === RelOrientation.FRAME ? RelOrientation.PAGE_FRAME : f.m_aHoriOrient.m_eRelation }, m_aVertOrient: { ...f.m_aVertOrient, m_eRelation: f.m_aVertOrient.m_eRelation === RelOrientation.FRAME ? RelOrientation.PAGE_FRAME : f.m_aVertOrient.m_eRelation } })}</w:r>`).join('');
    body = body.replace(/^<w:p>(<w:pPr>.*?<\/w:pPr>)?/, (m) => m + flys);
    if (!body.startsWith('<w:p>')) body = `<w:p>${flys}</w:p>${body}`;
  }
  const finalSect = sectPrXml(run.desc, run.type, run.cols, run.numStart);
  const documentXml = `${HEAD}<w:document ${DOC_NS}><w:body>${body}${finalSect}</w:body></w:document>`;

  // --- styles (DocxAttributeOutput::StartStyle ... EndStyle) ---
  const styleXml = (type: 'paragraph' | 'character', f: SwFormat, extra = '', pPrFirst = ''): string => {
    const ws = { ...wordStyle(f.GetName()), id: sid(f.GetName()) };
    const parent = f.DerivedFrom();
    const set = f.m_aSet as SwAttrSet;
    const pPr = type === 'paragraph' ? pPrFirst + pPrInner(set) : '';
    const rPr = rPrXml(charOnly(set));
    return `<w:style w:type="${type}"${ws.id === 'Normal' || ws.id === 'DefaultParagraphFont' ? ' w:default="1"' : ''}${attr('styleId', ws.id)}><w:name${attr('val', ws.name)}/>${parent && parent.GetName() !== 'Default Character Style' ? `<w:basedOn${attr('val', sid(parent.GetName()))}/>` : ''}${extra}<w:qFormat/>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${rPr}</w:style>`;
  };
  let styles = `<w:docDefaults><w:rPrDefault>${rPrXml({ RES_CHRATR_FONT: POOL_DEFAULTS.RES_CHRATR_FONT, RES_CHRATR_FONTSIZE: POOL_DEFAULTS.RES_CHRATR_FONTSIZE })}</w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`;
  for (const c of doc.m_aTextFormatColls.values()) {
    const next = c.m_pNextTextFormatColl && c.m_pNextTextFormatColl !== c ? `<w:next${attr('val', sid(c.m_pNextTextFormatColl.GetName()))}/>` : '';
    // Headings carry their outline level, which Word's navigation and tables of contents use.
    const outline = /^Heading (\d)$/.exec(c.GetName());
    styles += styleXml('paragraph', c, next, outline ? `<w:outlineLvl${attr('val', Number(outline[1]) - 1)}/>` : '');
  }
  for (const cf of doc.m_aCharFormats.values()) styles += styleXml('character', cf);
  styles += '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>';
  const stylesXml = `${HEAD}<w:styles xmlns:w="${NS_W}">${styles}</w:styles>`;

  // --- numbering ---
  let numbering = '';
  for (const [rule, abs] of abstractOf) {
    numbering += `<w:abstractNum${attr('abstractNumId', abs)}><w:multiLevelType w:val="hybridMultilevel"/>`;
    for (let l = 0; l < 9; l++) {
      const f = rule.Get(l);
      const bullet = f.GetNumberingType() === NumberingType.CHAR_SPECIAL;
      const lvlText = bullet ? f.GetBulletChar() : f.GetListFormat().replace(/%(\d+)%/g, '%$1');
      const suff = f.GetLabelFollowedBy() === 'space' ? 'space' : f.GetLabelFollowedBy() === 'listtab' ? 'tab' : 'nothing';
      const ind = `<w:ind${attr('left', f.GetIndentAt())}${f.GetFirstLineIndent() < 0 ? attr('hanging', -f.GetFirstLineIndent()) : attr('firstLine', f.GetFirstLineIndent())}/>`;
      const tabs = suff === 'tab' ? `<w:tabs><w:tab w:val="num"${attr('pos', f.GetListtabPos())}/></w:tabs>` : '';
      numbering += `<w:lvl${attr('ilvl', l)}><w:start${attr('val', f.GetStart())}/><w:numFmt${attr('val', NUM_FMT[f.GetNumberingType()] ?? 'decimal')}/>${suff !== 'tab' ? `<w:suff${attr('val', suff)}/>` : ''}<w:lvlText${attr('val', lvlText)}/><w:lvlJc${attr('val', f.GetNumAdjust() === 'right' ? 'right' : f.GetNumAdjust() === 'center' ? 'center' : 'left')}/><w:pPr>${tabs}${ind}</w:pPr>${bullet ? '<w:rPr><w:rFonts w:ascii="OpenSymbol" w:hAnsi="OpenSymbol" w:cs="OpenSymbol" w:hint="default"/></w:rPr>' : ''}</w:lvl>`;
    }
    numbering += '</w:abstractNum>';
  }
  for (const n of nums) numbering += `<w:num${attr('numId', n.id)}><w:abstractNumId${attr('val', n.abs)}/>${n.restart ? `<w:lvlOverride${attr('ilvl', n.restart.level)}><w:startOverride${attr('val', n.restart.start)}/></w:lvlOverride>` : ''}</w:num>`;

  // --- the package ---
  const settings = `${HEAD}<w:settings xmlns:w="${NS_W}">${doc.m_pDocumentRedlineManager.m_bRecord ? '<w:trackRevisions/>' : ''}<w:defaultTabStop w:val="709"/>${anyLeft ? '<w:evenAndOddHeaders/>' : ''}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  files.push({ name: 'word/document.xml', data: enc.encode(documentXml) });
  files.push({ name: 'word/styles.xml', data: enc.encode(stylesXml) });
  files.push({ name: 'word/settings.xml', data: enc.encode(settings) });
  addRel('styles', 'styles.xml');
  addRel('settings', 'settings.xml');
  overrides.push(['/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'], ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'], ['/word/settings.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml']);
  if (numbering) {
    files.push({ name: 'word/numbering.xml', data: enc.encode(`${HEAD}<w:numbering xmlns:w="${NS_W}">${numbering}</w:numbering>`) });
    addRel('numbering', 'numbering.xml');
    overrides.push(['/word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml']);
  }
  const SEP = (tag: string) => `<w:${tag} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${tag}><w:${tag} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${tag}>`;
  if (footnotes.length) {
    files.push({ name: 'word/footnotes.xml', data: enc.encode(`${HEAD}<w:footnotes ${DOC_NS}>${SEP('footnote')}${footnotes.join('')}</w:footnotes>`) });
    addRel('footnotes', 'footnotes.xml');
    overrides.push(['/word/footnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml']);
  }
  if (endnotes.length) {
    files.push({ name: 'word/endnotes.xml', data: enc.encode(`${HEAD}<w:endnotes ${DOC_NS}>${SEP('endnote')}${endnotes.join('')}</w:endnotes>`) });
    addRel('endnotes', 'endnotes.xml');
    overrides.push(['/word/endnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml']);
  }
  if (comments.length) {
    files.push({ name: 'word/comments.xml', data: enc.encode(`${HEAD}<w:comments xmlns:w="${NS_W}">${comments.join('')}</w:comments>`) });
    addRel('comments', 'comments.xml');
    overrides.push(['/word/comments.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml']);
  }
  files.push({ name: 'word/_rels/document.xml.rels', data: enc.encode(`${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels.join('')}</Relationships>`) });
  files.push({ name: '_rels/.rels', data: enc.encode(`${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="word/document.xml"/></Relationships>`) });
  const defaults = [...mediaTypes].map((m) => { const [ext, mime] = m.split('|'); return `<Default Extension="${ext}" ContentType="${mime}"/>`; }).join('');
  const contentTypes = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`;
  return writeZip([{ name: '[Content_Types].xml', data: enc.encode(contentTypes) }, ...files]);
}
