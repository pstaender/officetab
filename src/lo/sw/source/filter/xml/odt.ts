// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/xml/swxml.cxx reduced
// @upstream sw/source/filter/xml/wrtxml.cxx reduced
// @upstream sw/source/filter/xml/xmlfmt.cxx reduced
// @upstream xmloff/source/text/txtparai.cxx reduced
// @upstream xmloff/source/text/txtparae.cxx reduced
// Reads and writes paragraphs, spans, styles and page geometry. Unsupported content is reported
// through `ImportResult.lost` so that callers can warn before a save would drop it.
import { readZip, writeZip } from '../../../../package/source/zipapi/zip.ts';
import { child, childElements, escapeXml, parseXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { SwDoc } from '../../../inc/doc.ts';
import { POOL_DEFAULTS, type FontLineStyle, type SvxAdjust, type SwAttrSet, type SwCharAttrSet } from '../../../inc/hintids.ts';
import type { SwTextFormatColl } from '../../../inc/format.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';

const MIME = 'application/vnd.oasis.opendocument.text';

export function toTwips(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(-?[\d.]+)(cm|mm|in|pt|pc|px|twip)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  const f: Record<string, number> = { cm: 1440 / 2.54, mm: 144 / 2.54, in: 1440, pt: 20, pc: 240, px: 15, twip: 1 };
  return Math.round(n * (f[m[2] ?? 'pt'] ?? 20));
}

const twipsToCm = (t: number): string => `${(t * 2.54 / 1440).toFixed(4)}cm`;

interface OdfStyle { name: string; display: string; family: string; parent?: string; next?: string; attrs: SwAttrSet }

function readProps(styleEl: XmlElement, fonts: Map<string, string>): SwAttrSet {
  const out: SwAttrSet = {};
  const tp = child(styleEl, 'style:text-properties');
  if (tp) {
    const a = (k: string) => tp.attrs.get(k);
    const size = toTwips(a('fo:font-size'));
    if (size !== undefined) out.RES_CHRATR_FONTSIZE = size;
    const fontName = a('style:font-name') ?? a('fo:font-family');
    if (fontName) out.RES_CHRATR_FONT = fonts.get(fontName) ?? fontName.replace(/^['"]|['"]$/g, '');
    const w = a('fo:font-weight');
    if (w) out.RES_CHRATR_WEIGHT = w === 'bold' || parseInt(w, 10) >= 600;
    const st = a('fo:font-style');
    if (st) out.RES_CHRATR_POSTURE = st === 'italic' || st === 'oblique';
    const ul = a('style:text-underline-style');
    if (ul) {
      const type = a('style:text-underline-type');
      const map: Record<string, FontLineStyle> = { none: 'none', solid: 'single', dotted: 'dotted', dash: 'dash', 'long-dash': 'dash', wave: 'wave' };
      out.RES_CHRATR_UNDERLINE = type === 'double' ? 'double' : map[ul] ?? 'single';
    }
    const lt = a('style:text-line-through-style');
    if (lt) out.RES_CHRATR_CROSSEDOUT = lt !== 'none';
    const c = a('fo:color');
    if (c) out.RES_CHRATR_COLOR = c;
    const bg = a('fo:background-color');
    if (bg) out.RES_CHRATR_BACKGROUND = bg === 'transparent' ? null : bg;
    const tt = a('fo:text-transform');
    if (tt) out.RES_CHRATR_CASEMAP = tt === 'uppercase' ? 'uppercase' : tt === 'lowercase' ? 'lowercase' : 'none';
    const pos = a('style:text-position');
    if (pos) {
      const token = pos.split(/\s+/)[0]!;
      out.RES_CHRATR_ESCAPEMENT = token === 'super' ? 33 : token === 'sub' ? -33 : parseInt(token, 10) || 0;
    }
  }
  const pp = child(styleEl, 'style:paragraph-properties');
  if (pp) {
    const a = (k: string) => pp.attrs.get(k);
    const ta = a('fo:text-align');
    if (ta) {
      const map: Record<string, SvxAdjust> = { start: 'left', left: 'left', end: 'right', right: 'right', center: 'center', justify: 'block' };
      out.RES_PARATR_ADJUST = map[ta] ?? 'left';
    }
    if (a('fo:margin-left') || a('fo:margin-right') || a('fo:text-indent')) {
      out.RES_LR_SPACE = { left: toTwips(a('fo:margin-left')) ?? 0, right: toTwips(a('fo:margin-right')) ?? 0, firstLine: toTwips(a('fo:text-indent')) ?? 0 };
    }
    if (a('fo:margin-top') || a('fo:margin-bottom')) {
      out.RES_UL_SPACE = { upper: toTwips(a('fo:margin-top')) ?? 0, lower: toTwips(a('fo:margin-bottom')) ?? 0 };
    }
    const lh = a('fo:line-height');
    if (lh) {
      if (lh.endsWith('%')) out.RES_PARATR_LINESPACING = { rule: 'proportional', value: parseFloat(lh) };
      else if (lh !== 'normal') out.RES_PARATR_LINESPACING = { rule: 'fix', value: toTwips(lh) ?? 240 };
    }
    const atLeast = toTwips(a('style:line-height-at-least'));
    if (atLeast !== undefined) out.RES_PARATR_LINESPACING = { rule: 'min', value: atLeast };
    const w = a('fo:widows'); if (w) out.RES_PARATR_WIDOWS = parseInt(w, 10);
    const o = a('fo:orphans'); if (o) out.RES_PARATR_ORPHANS = parseInt(o, 10);
    const k = a('fo:keep-with-next'); if (k) out.RES_KEEP = k === 'always';
    if (a('fo:break-before') === 'page') out.RES_BREAK = 'page-before';
    else if (a('fo:break-after') === 'page') out.RES_BREAK = 'page-after';
    const bg = a('fo:background-color');
    if (bg) out.RES_BACKGROUND = bg === 'transparent' ? null : bg;
  }
  return out;
}

const charOnly = (s: SwAttrSet): SwCharAttrSet => Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('RES_CHRATR_'))) as SwCharAttrSet;

export interface ImportResult { doc: SwDoc; lost: string[] }

const decodeXml = (b: Uint8Array) => new TextDecoder().decode(b);

export async function ImportODT(bytes: Uint8Array): Promise<ImportResult> {
  const files = await readZip(bytes);
  const contentBytes = files.get('content.xml');
  if (!contentBytes) throw new Error('This file has no content.xml, so it is not an OpenDocument text file.');
  const contentRoot = parseXml(decodeXml(contentBytes));
  const content = child(contentRoot, 'office:document-content');
  const stylesBytes = files.get('styles.xml');
  const stylesDoc = stylesBytes ? child(parseXml(decodeXml(stylesBytes)), 'office:document-styles') : undefined;

  const doc = new SwDoc();
  const lost = new Set<string>();
  const fonts = new Map<string, string>();
  for (const root of [stylesDoc, content]) {
    for (const f of childElements(child(root, 'office:font-face-decls') ?? { name: '', attrs: new Map(), children: [] })) {
      const family = f.attrs.get('svg:font-family');
      if (f.attrs.get('style:name') && family) fonts.set(f.attrs.get('style:name')!, family.replace(/^['"]|['"]$/g, ''));
    }
  }

  const styles = new Map<string, OdfStyle>(); // keyed "family/name"
  const collect = (container?: XmlElement) => {
    for (const s of container ? childElements(container) : []) {
      if (s.name !== 'style:style') continue;
      const name = s.attrs.get('style:name')!;
      const family = s.attrs.get('style:family')!;
      styles.set(`${family}/${name}`, {
        name, family, display: s.attrs.get('style:display-name') ?? name.replace(/_20_/g, ' '),
        parent: s.attrs.get('style:parent-style-name'), next: s.attrs.get('style:next-style-name'), attrs: readProps(s, fonts),
      });
    }
  };
  collect(child(stylesDoc, 'office:styles'));
  const namedParagraph = new Set([...styles.values()].filter((s) => s.family === 'paragraph').map((s) => s.name));
  collect(child(stylesDoc, 'office:automatic-styles'));
  collect(child(content, 'office:automatic-styles'));

  // Named paragraph styles become format collections, resolved parent first.
  const colls = new Map<string, SwTextFormatColl>();
  const standard = doc.FindTextFormatCollByName('Standard')!;
  const resolveColl = (name: string): SwTextFormatColl => {
    const got = colls.get(name);
    if (got) return got;
    const s = styles.get(`paragraph/${name}`);
    if (!s) return standard;
    const parent = s.parent ? resolveColl(s.parent) : null;
    const existing = doc.FindTextFormatCollByName(s.display);
    let c: SwTextFormatColl;
    if (existing) { existing.m_aSet = s.attrs; if (existing !== standard) existing.m_pDerivedFrom = parent; c = existing; }
    else c = doc.MakeColl(s.display, parent, s.attrs);
    colls.set(name, c);
    return c;
  };
  for (const n of namedParagraph) resolveColl(n);
  for (const n of namedParagraph) {
    const s = styles.get(`paragraph/${n}`)!;
    if (s.next && namedParagraph.has(s.next)) colls.get(n)!.m_pNextTextFormatColl = colls.get(s.next)!;
  }

  // Page geometry from the Standard master page, else the first one.
  const masters = child(stylesDoc, 'office:master-styles');
  const master = masters && (childElements(masters).find((m) => m.attrs.get('style:name') === 'Standard') ?? childElements(masters)[0]);
  const layoutName = master?.attrs.get('style:page-layout-name');
  const layouts = child(stylesDoc, 'office:automatic-styles');
  const layout = layouts && childElements(layouts).find((l) => l.name === 'style:page-layout' && l.attrs.get('style:name') === layoutName);
  const lp = child(layout, 'style:page-layout-properties');
  if (lp) {
    const pd = doc.m_aPageDesc;
    pd.nWidth = toTwips(lp.attrs.get('fo:page-width')) ?? pd.nWidth;
    pd.nHeight = toTwips(lp.attrs.get('fo:page-height')) ?? pd.nHeight;
    pd.nLeft = toTwips(lp.attrs.get('fo:margin-left')) ?? pd.nLeft;
    pd.nRight = toTwips(lp.attrs.get('fo:margin-right')) ?? pd.nRight;
    pd.nTop = toTwips(lp.attrs.get('fo:margin-top')) ?? pd.nTop;
    pd.nBottom = toTwips(lp.attrs.get('fo:margin-bottom')) ?? pd.nBottom;
  }
  if (master && childElements(master).some((m) => m.name === 'style:header' || m.name === 'style:footer')) lost.add('headers and footers');

  const nodes = doc.GetNodes();
  let firstPara = true;
  const newNode = (): SwTextNode => {
    if (firstPara) { firstPara = false; return nodes.FirstTextNode(); }
    return nodes.MakeTextNode(nodes.GetEndOfContent().GetIndex(), standard);
  };

  const collectText = (el: XmlElement, node: SwTextNode, inherited: SwCharAttrSet): void => {
    for (const c of el.children) {
      if (typeof c === 'string') { append(node, c.replace(/[\r\n\t ]+/g, ' '), inherited); continue; }
      switch (c.name) {
        case 'text:span': {
          const st = styles.get(`text/${c.attrs.get('text:style-name') ?? ''}`);
          collectText(c, node, st ? { ...inherited, ...charChain(st) } : inherited);
          break;
        }
        case 'text:s': append(node, ' '.repeat(parseInt(c.attrs.get('text:c') ?? '1', 10)), inherited); break;
        case 'text:tab': append(node, '\t', inherited); break;
        case 'text:line-break': append(node, '\n', inherited); break;
        case 'text:a': collectText(c, node, inherited); lost.add('hyperlinks (their text is kept)'); break;
        case 'text:bookmark': case 'text:bookmark-start': case 'text:bookmark-end':
        case 'text:soft-page-break': case 'office:annotation-end': break;
        case 'office:annotation': lost.add('comments'); break;
        case 'draw:frame': lost.add('images and frames'); break;
        default:
          if (c.name.startsWith('text:') && c.children.length) { collectText(c, node, inherited); lost.add('fields (their current value is kept as text)'); }
          else lost.add(c.name);
      }
    }
  };
  const charChain = (s: OdfStyle): SwCharAttrSet => {
    const parent = s.parent ? styles.get(`${s.family}/${s.parent}`) : undefined;
    return { ...(parent ? charChain(parent) : {}), ...charOnly(s.attrs) };
  };
  const append = (node: SwTextNode, text: string, attrs: SwCharAttrSet) => {
    if (!text) return;
    const start = node.Len();
    node.m_Text += text;
    if (Object.keys(attrs).length) node.SetAttr(start, start + text.length, attrs);
  };

  const readPara = (el: XmlElement) => {
    const node = newNode();
    const styleName = el.attrs.get('text:style-name');
    const st = styleName ? styles.get(`paragraph/${styleName}`) : undefined;
    if (st && !namedParagraph.has(st.name)) {
      // Automatic style: direct formatting on top of its named parent.
      node.m_pColl = st.parent ? resolveColl(st.parent) : standard;
      node.m_aSet = { ...st.attrs };
    } else if (st) node.m_pColl = resolveColl(st.name);
    collectText(el, node, {});
    node.m_nVersion++;
  };

  const readBlocks = (parent: XmlElement) => {
    for (const el of childElements(parent)) {
      switch (el.name) {
        case 'text:p': case 'text:h': readPara(el); break;
        case 'text:list': lost.add('list numbering and bullets (the text is kept)'); readList(el); break;
        case 'text:section': lost.add('sections (the text is kept)'); readBlocks(el); break;
        case 'table:table': lost.add('tables (cell text is kept as paragraphs)'); readTable(el); break;
        case 'text:sequence-decls': case 'text:tracked-changes': case 'office:forms': case 'text:user-field-decls': break;
        default: lost.add(el.name);
      }
    }
  };
  const readList = (l: XmlElement) => { for (const it of childElements(l)) readBlocks(it); };
  const readTable = (t: XmlElement) => {
    for (const r of childElements(t)) {
      if (r.name === 'table:table-row') { for (const c of childElements(r)) if (c.name === 'table:table-cell') readBlocks(c); }
      else if (r.name.startsWith('table:table-')) readTable(r);
    }
  };

  const text = child(child(content, 'office:body'), 'office:text');
  if (!text) throw new Error('This document has no text body.');
  readBlocks(text);
  doc.SetUnmodified();
  return { doc, lost: [...lost] };
}

function paragraphProps(s: SwAttrSet): string {
  const p: string[] = [];
  if (s.RES_PARATR_ADJUST) p.push(`fo:text-align="${{ left: 'start', right: 'end', center: 'center', block: 'justify' }[s.RES_PARATR_ADJUST]}"`);
  if (s.RES_LR_SPACE) p.push(`fo:margin-left="${twipsToCm(s.RES_LR_SPACE.left)}" fo:margin-right="${twipsToCm(s.RES_LR_SPACE.right)}" fo:text-indent="${twipsToCm(s.RES_LR_SPACE.firstLine)}"`);
  if (s.RES_UL_SPACE) p.push(`fo:margin-top="${twipsToCm(s.RES_UL_SPACE.upper)}" fo:margin-bottom="${twipsToCm(s.RES_UL_SPACE.lower)}"`);
  const ls = s.RES_PARATR_LINESPACING;
  if (ls) p.push(ls.rule === 'proportional' ? `fo:line-height="${ls.value}%"` : ls.rule === 'fix' ? `fo:line-height="${twipsToCm(ls.value)}"` : `style:line-height-at-least="${twipsToCm(ls.value)}"`);
  if (s.RES_PARATR_WIDOWS !== undefined) p.push(`fo:widows="${s.RES_PARATR_WIDOWS}"`);
  if (s.RES_PARATR_ORPHANS !== undefined) p.push(`fo:orphans="${s.RES_PARATR_ORPHANS}"`);
  if (s.RES_KEEP !== undefined) p.push(`fo:keep-with-next="${s.RES_KEEP ? 'always' : 'auto'}"`);
  if (s.RES_BREAK === 'page-before') p.push('fo:break-before="page"');
  if (s.RES_BREAK === 'page-after') p.push('fo:break-after="page"');
  if (s.RES_BACKGROUND !== undefined) p.push(`fo:background-color="${s.RES_BACKGROUND ?? 'transparent'}"`);
  return p.length ? `<style:paragraph-properties ${p.join(' ')}/>` : '';
}

function textProps(s: SwAttrSet): string {
  const p: string[] = [];
  if (s.RES_CHRATR_FONT) { const f = escapeXml(s.RES_CHRATR_FONT); p.push(`style:font-name="${f}" fo:font-family="'${f}'"`); }
  if (s.RES_CHRATR_FONTSIZE) p.push(`fo:font-size="${s.RES_CHRATR_FONTSIZE / 20}pt"`);
  if (s.RES_CHRATR_WEIGHT !== undefined) p.push(`fo:font-weight="${s.RES_CHRATR_WEIGHT ? 'bold' : 'normal'}"`);
  if (s.RES_CHRATR_POSTURE !== undefined) p.push(`fo:font-style="${s.RES_CHRATR_POSTURE ? 'italic' : 'normal'}"`);
  const ul = s.RES_CHRATR_UNDERLINE;
  if (ul) {
    if (ul === 'none') p.push('style:text-underline-style="none"');
    else if (ul === 'double') p.push('style:text-underline-style="solid" style:text-underline-type="double"');
    else p.push(`style:text-underline-style="${ul === 'single' ? 'solid' : ul}" style:text-underline-width="auto" style:text-underline-color="font-color"`);
  }
  if (s.RES_CHRATR_CROSSEDOUT !== undefined) p.push(`style:text-line-through-style="${s.RES_CHRATR_CROSSEDOUT ? 'solid' : 'none'}"`);
  if (s.RES_CHRATR_COLOR) p.push(`fo:color="${s.RES_CHRATR_COLOR}"`);
  if (s.RES_CHRATR_BACKGROUND !== undefined) p.push(`fo:background-color="${s.RES_CHRATR_BACKGROUND ?? 'transparent'}"`);
  if (s.RES_CHRATR_ESCAPEMENT !== undefined) p.push(`style:text-position="${s.RES_CHRATR_ESCAPEMENT > 0 ? `super` : s.RES_CHRATR_ESCAPEMENT < 0 ? 'sub' : '0%'}"`);
  if (s.RES_CHRATR_CASEMAP) p.push(`fo:text-transform="${s.RES_CHRATR_CASEMAP}"`);
  return p.length ? `<style:text-properties ${p.join(' ')}/>` : '';
}

/** Serialises text so the ODF whitespace collapsing rules reproduce it exactly on import. */
function serialiseRun(t: string, atParaStart: boolean): string {
  let out = '', buf = '';
  const flush = () => { out += escapeXml(buf); buf = ''; };
  let i = 0;
  let prevSpace = !atParaStart ? false : true;
  while (i < t.length) {
    const c = t[i]!;
    if (c === ' ') {
      let n = 1;
      while (t[i + n] === ' ') n++;
      if (prevSpace) { flush(); out += n > 1 ? `<text:s text:c="${n}"/>` : '<text:s/>'; }
      else { buf += ' '; if (n > 1) { flush(); out += n > 2 ? `<text:s text:c="${n - 1}"/>` : '<text:s/>'; } }
      i += n; prevSpace = true;
      continue;
    }
    if (c === '\t') { flush(); out += '<text:tab/>'; prevSpace = false; i++; continue; }
    if (c === '\n') { flush(); out += '<text:line-break/>'; prevSpace = false; i++; continue; }
    buf += c; prevSpace = false; i++;
  }
  flush();
  return out;
}

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"';

const styleId = (name: string) => name.replace(/ /g, '_20_').replace(/[^\w.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);

export async function ExportODT(doc: SwDoc): Promise<Uint8Array> {
  const nodes = doc.GetNodes();
  const auto = new Map<string, { name: string; xml: string }>();
  const fonts = new Set<string>();
  const noteFont = (s: SwAttrSet) => { if (s.RES_CHRATR_FONT) fonts.add(s.RES_CHRATR_FONT); };
  const autoStyle = (family: 'paragraph' | 'text', inner: string, parent?: string): string => {
    const key = `${family}|${parent ?? ''}|${inner}`;
    let e = auto.get(key);
    if (!e) {
      const name = `${family === 'paragraph' ? 'P' : 'T'}${auto.size + 1}`;
      e = { name, xml: `<style:style style:name="${name}" style:family="${family}"${parent ? ` style:parent-style-name="${parent}"` : ''}>${inner}</style:style>` };
      auto.set(key, e);
    }
    return e.name;
  };

  let body = '';
  for (let n: SwTextNode | null = nodes.FirstTextNode(); n; n = nodes.GoNext(n.GetIndex())) {
    const collId = styleId(n.GetTextColl().GetName());
    noteFont(n.m_aSet);
    const direct = paragraphProps(n.m_aSet) + textProps(charOnly(n.m_aSet));
    const pStyle = direct ? autoStyle('paragraph', direct, collId) : collId;
    const text = n.GetText();
    const cuts = new Set([0, text.length]);
    for (const h of n.m_aHints) { cuts.add(h.nStart); cuts.add(h.nEnd); }
    const sorted = [...cuts].sort((a, b) => a - b);
    let inner = '';
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i]!, b = sorted[i + 1]!;
      const h = n.m_aHints.find((x) => x.nStart <= a && a < x.nEnd);
      const run = serialiseRun(text.slice(a, b), a === 0);
      if (h && Object.keys(h.aAttrs).length) {
        noteFont(h.aAttrs);
        inner += `<text:span text:style-name="${autoStyle('text', textProps(h.aAttrs))}">${run}</text:span>`;
      } else inner += run;
    }
    body += `<text:p text:style-name="${pStyle}">${inner}</text:p>`;
  }

  let named = '';
  for (const c of doc.m_aTextFormatColls.values()) {
    noteFont(c.m_aSet);
    const parent = c.DerivedFrom();
    const next = c.m_pNextTextFormatColl;
    named += `<style:style style:name="${styleId(c.GetName())}" style:display-name="${escapeXml(c.GetName())}" style:family="paragraph"${parent ? ` style:parent-style-name="${styleId(parent.GetName())}"` : ''}${next ? ` style:next-style-name="${styleId(next.GetName())}"` : ''}>${paragraphProps(c.m_aSet)}${textProps(c.m_aSet)}</style:style>`;
  }
  noteFont(POOL_DEFAULTS);
  const fontDecls = `<office:font-face-decls>${[...fonts].map((f) => `<style:font-face style:name="${escapeXml(f)}" svg:font-family="'${escapeXml(f)}'"/>`).join('')}</office:font-face-decls>`;
  const defaults = `<style:default-style style:family="paragraph">${textProps({ RES_CHRATR_FONT: POOL_DEFAULTS.RES_CHRATR_FONT, RES_CHRATR_FONTSIZE: POOL_DEFAULTS.RES_CHRATR_FONTSIZE })}${paragraphProps({ RES_PARATR_WIDOWS: 2, RES_PARATR_ORPHANS: 2 })}</style:default-style>`;
  const pd = doc.m_aPageDesc;
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  const contentXml = `${head}<office:document-content ${NS}>${fontDecls}<office:automatic-styles>${[...auto.values()].map((e) => e.xml).join('')}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const stylesXml = `${head}<office:document-styles ${NS}>${fontDecls}<office:styles>${defaults}${named}</office:styles><office:automatic-styles><style:page-layout style:name="Mpm1"><style:page-layout-properties fo:page-width="${twipsToCm(pd.nWidth)}" fo:page-height="${twipsToCm(pd.nHeight)}" style:print-orientation="${pd.nWidth > pd.nHeight ? 'landscape' : 'portrait'}" fo:margin-top="${twipsToCm(pd.nTop)}" fo:margin-bottom="${twipsToCm(pd.nBottom)}" fo:margin-left="${twipsToCm(pd.nLeft)}" fo:margin-right="${twipsToCm(pd.nRight)}"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="Mpm1"/></office:master-styles></office:document-styles>`;
  const metaXml = `${head}<office:document-meta ${NS}><office:meta><meta:generator>LibreOffice-Webbrowser/0.1</meta:generator></office:meta></office:document-meta>`;
  const manifest = `${head}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  const enc = new TextEncoder();
  return writeZip([
    { name: 'mimetype', data: enc.encode(MIME), store: true }, // ODF requires it first and uncompressed
    { name: 'content.xml', data: enc.encode(contentXml) },
    { name: 'styles.xml', data: enc.encode(stylesXml) },
    { name: 'meta.xml', data: enc.encode(metaXml) },
    { name: 'META-INF/manifest.xml', data: enc.encode(manifest) },
  ]);
}
