// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/writerfilter/dmapper/DomainMapper.cxx reduced
// @upstream sw/source/writerfilter/dmapper/DomainMapper_Impl.cxx reduced
// @upstream sw/source/writerfilter/dmapper/StyleSheetTable.cxx reduced
// @upstream sw/source/writerfilter/dmapper/NumberingManager.cxx reduced
// @upstream sw/source/writerfilter/dmapper/DomainMapperTableHandler.cxx reduced
// @upstream sw/source/writerfilter/dmapper/ConversionHelper.cxx reduced
// @upstream sw/source/writerfilter/dmapper/GraphicImport.cxx reduced
// @upstream sw/source/writerfilter/dmapper/PropertyMap.cxx reduced
// @upstream sw/source/writerfilter/dmapper/ThemeHandler.cxx reduced
// Upstream tokenises OOXML into sprms that DomainMapper turns into UNO API calls. This reads the
// WordprocessingML elements directly into the document model, with the same conversions:
// half-points, twips, EMU, lvlText list formats, gridSpan and vMerge, the default header and
// footer of the last section. Content the model cannot hold is reported in `lost`.
import { readZip } from '../../../../package/source/zipapi/zip.ts';
import { child, childElements, parseXml, type XmlElement } from '../../../../xmloff/source/core/xmlparse.ts';
import { SwDoc } from '../../../inc/doc.ts';
import { SwEndNode, SwStartNode, SwTableNode, type SwNode } from '../../../inc/node.ts';
import { SwNodeType, SwStartNodeType } from '../../../inc/ndtyp.ts';
import { CH_TXTATR_BREAKWORD, type FontLineStyle, type SvxTabStop, type SwAttrSet, type SwCharAttrSet, type SwPostItField } from '../../../inc/hintids.ts';
import { MAXLEVEL, SwNumFormat, SwNumRule } from '../../../inc/numrule.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { SwTable, SwTableBox, SwTableLine, defaultBoxAttrs, type SvxBorderLine, type SvxBoxItem, type SwTableAdjust } from '../../../inc/swtable.ts';
import type { SwTextFormatColl } from '../../../inc/format.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { ImportResult } from '../../filter/xml/odt.ts';

const W = (e: XmlElement | undefined, k: string): string | undefined => e?.attrs.get(`w:${k}`);
const val = (e: XmlElement | undefined): string | undefined => W(e, 'val');
const kids = (e: XmlElement | undefined, name: string): XmlElement[] => (e ? childElements(e).filter((c) => c.name === name) : []);
const int = (s: string | undefined): number | undefined => (s === undefined || s === '' ? undefined : Math.round(parseFloat(s)));
/** ST_OnOff: present means on, unless val says otherwise. */
const onOff = (e: XmlElement | undefined): boolean | undefined => (e ? !['0', 'false', 'off'].includes(val(e) ?? 'true') : undefined);
/** EMU to twips: 914400 EMU per inch, 1440 twips per inch. */
const emuToTwips = (emu: number): number => Math.round(emu / 635);

// ConversionHelper::ConvertNumberingType
const NUM_FMT: Record<string, NumberingType> = {
  decimal: NumberingType.ARABIC, upperRoman: NumberingType.ROMAN_UPPER, lowerRoman: NumberingType.ROMAN_LOWER,
  bullet: NumberingType.CHAR_SPECIAL, none: NumberingType.NUMBER_NONE,
  upperLetter: NumberingType.CHARS_UPPER_LETTER_N, lowerLetter: NumberingType.CHARS_LOWER_LETTER_N,
};

// Symbol and Wingdings bullets live in the private use area; the browser has neither font.
const BULLET_GLYPHS: Record<string, string> = {
  '': '•', '': '▪', '': '➢', '': '❖', '': '✓', '': '■',
  '': '□', '': '❑', '': '○', '': '➔', '': '–',
};

const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
};

const UNDERLINE: Record<string, FontLineStyle> = { single: 'single', words: 'single', double: 'double', dotted: 'dotted', dash: 'dash', dashLong: 'dash', wave: 'wave', thick: 'single', none: 'none' };

// StyleSheetTable::ConvertStyleName: Word's built-in style names that map to Writer's pool styles.
const STYLE_NAMES: Record<string, string> = {
  Normal: 'Standard', normal: 'Standard', Title: 'Title', Subtitle: 'Subtitle', Quote: 'Quotations',
  'footnote text': 'Footnote', header: 'Header', footer: 'Footer', 'Body Text': 'Text Body',
};

interface Rel { target: string; external: boolean }

export async function ImportDOCX(bytes: Uint8Array): Promise<ImportResult> {
  // An encrypted document is an OLE compound file, not a zip.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('This Word document is password-protected. Encrypted documents cannot be opened yet.');
  const files = await readZip(bytes);
  const text = (path: string) => { const b = files.get(path); return b ? new TextDecoder().decode(b) : undefined; };
  const xml = (path: string) => { const t = text(path); return t ? parseXml(t) : undefined; };
  // The main part is the package's officeDocument relationship, usually word/document.xml.
  const pkgRoot = xml('_rels/.rels');
  const mainRel = pkgRoot && childElements(childElements(pkgRoot)[0] ?? pkgRoot).find((e) => /officeDocument$/.test(e.attrs.get('Type') ?? ''));
  const mainPart = mainRel?.attrs.get('Target')?.replace(/^\//, '') ?? 'word/document.xml';
  const documentXml = xml(mainPart) ?? xml('word/document.xml');
  if (!documentXml) throw new Error('This file has no word/document.xml, so it is not a Word document.');
  const doc = new SwDoc();
  const lost = new Set<string>();
  const nodes = doc.GetNodes();

  const rels = (part: string): Map<string, Rel> => {
    const dir = part.slice(0, part.lastIndexOf('/') + 1);
    const r = xml(`${dir}_rels/${part.slice(dir.length)}.rels`);
    const out = new Map<string, Rel>();
    // Relationship parts use a default namespace, which the parser leaves unprefixed.
    const root = r && childElements(r).find((e) => /(^|:)Relationships$/.test(e.name));
    for (const e of root ? childElements(root).filter((x) => /(^|:)Relationship$/.test(x.name)) : []) {
      const target = e.attrs.get('Target') ?? '';
      const external = e.attrs.get('TargetMode') === 'External';
      out.set(e.attrs.get('Id') ?? '', { target: external || target.startsWith('/') ? target.replace(/^\//, '') : dir + target, external });
    }
    return out;
  };

  // ThemeHandler: the major and minor Latin fonts that rFonts' theme attributes name.
  const theme = new Map<string, string>();
  const themeXml = xml('word/theme/theme1.xml');
  const fontScheme = themeXml && childElements(themeXml)[0] && findDeep(childElements(themeXml)[0]!, 'a:fontScheme');
  for (const [k, tag] of [['major', 'a:majorFont'], ['minor', 'a:minorFont']] as const) {
    const latin = child(child(fontScheme, tag), 'a:latin')?.attrs.get('typeface');
    if (latin) theme.set(k, latin);
  }

  // --- properties ---
  const runProps = (rPr: XmlElement | undefined): SwCharAttrSet => {
    const out: SwCharAttrSet = {};
    if (!rPr) return out;
    const fonts = child(rPr, 'w:rFonts');
    if (fonts) {
      const f = W(fonts, 'ascii') ?? W(fonts, 'hAnsi');
      const th = W(fonts, 'asciiTheme') ?? W(fonts, 'hAnsiTheme');
      const themed = th && theme.get(th.startsWith('major') ? 'major' : 'minor');
      if (themed ?? f) out.RES_CHRATR_FONT = (themed ?? f)!;
    }
    const sz = int(val(child(rPr, 'w:sz')));
    if (sz !== undefined) out.RES_CHRATR_FONTSIZE = sz * 10; // half-points to twips
    const b = onOff(child(rPr, 'w:b')); if (b !== undefined) out.RES_CHRATR_WEIGHT = b;
    const i = onOff(child(rPr, 'w:i')); if (i !== undefined) out.RES_CHRATR_POSTURE = i;
    const u = child(rPr, 'w:u');
    if (u) out.RES_CHRATR_UNDERLINE = UNDERLINE[val(u) ?? 'single'] ?? 'single';
    const strike = onOff(child(rPr, 'w:strike')) ?? onOff(child(rPr, 'w:dstrike'));
    if (strike !== undefined) out.RES_CHRATR_CROSSEDOUT = strike;
    const color = val(child(rPr, 'w:color'));
    if (color) out.RES_CHRATR_COLOR = color === 'auto' ? null : `#${color.toLowerCase()}`;
    const hl = val(child(rPr, 'w:highlight'));
    if (hl) out.RES_CHRATR_BACKGROUND = hl === 'none' ? null : HIGHLIGHT[hl] ?? null;
    const shd = W(child(rPr, 'w:shd'), 'fill');
    if (shd && shd !== 'auto' && !hl) out.RES_CHRATR_BACKGROUND = `#${shd.toLowerCase()}`;
    const va = val(child(rPr, 'w:vertAlign'));
    if (va) out.RES_CHRATR_ESCAPEMENT = va === 'superscript' ? 33 : va === 'subscript' ? -33 : 0;
    const caps = onOff(child(rPr, 'w:caps'));
    if (caps !== undefined) out.RES_CHRATR_CASEMAP = caps ? 'uppercase' : 'none';
    if (onOff(child(rPr, 'w:smallCaps'))) lost.add('small capitals (shown as normal letters)');
    if (onOff(child(rPr, 'w:vanish'))) lost.add('hidden text (shown)');
    return out;
  };

  const paraProps = (pPr: XmlElement | undefined): SwAttrSet => {
    const out: SwAttrSet = {};
    if (!pPr) return out;
    const jc = val(child(pPr, 'w:jc'));
    if (jc) out.RES_PARATR_ADJUST = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'block' : 'left';
    const ind = child(pPr, 'w:ind');
    if (ind) {
      const left = int(W(ind, 'left') ?? W(ind, 'start')) ?? 0;
      const right = int(W(ind, 'right') ?? W(ind, 'end')) ?? 0;
      const hanging = int(W(ind, 'hanging'));
      const first = hanging !== undefined ? -hanging : int(W(ind, 'firstLine')) ?? 0;
      out.RES_LR_SPACE = { left, right, firstLine: first };
    }
    const sp = child(pPr, 'w:spacing');
    if (sp) {
      const before = int(W(sp, 'before')), after = int(W(sp, 'after'));
      if (before !== undefined || after !== undefined) out.RES_UL_SPACE = { upper: before ?? 0, lower: after ?? 0 };
      const line = int(W(sp, 'line'));
      if (line !== undefined) {
        const rule = W(sp, 'lineRule') ?? 'auto';
        // "auto" is in 240ths of a line.
        out.RES_PARATR_LINESPACING = rule === 'exact' ? { rule: 'fix', value: line } : rule === 'atLeast' ? { rule: 'min', value: line } : { rule: 'proportional', value: Math.round((line * 100) / 240) };
      }
    }
    const keep = onOff(child(pPr, 'w:keepNext')); if (keep !== undefined) out.RES_KEEP = keep;
    if (onOff(child(pPr, 'w:pageBreakBefore'))) out.RES_BREAK = 'page-before';
    const widow = onOff(child(pPr, 'w:widowControl'));
    if (widow !== undefined) { out.RES_PARATR_WIDOWS = widow ? 2 : 0; out.RES_PARATR_ORPHANS = widow ? 2 : 0; }
    const shd = W(child(pPr, 'w:shd'), 'fill');
    if (shd && shd !== 'auto') out.RES_BACKGROUND = `#${shd.toLowerCase()}`;
    const tabs = kids(child(pPr, 'w:tabs'), 'w:tab').filter((t) => val(t) !== 'clear');
    if (tabs.length) {
      out.RES_PARATR_TABSTOP = tabs.map((t): SvxTabStop => {
        const v = val(t);
        const leader = W(t, 'leader');
        return {
          pos: int(W(t, 'pos')) ?? 0, adjust: v === 'right' || v === 'end' ? 'right' : v === 'center' ? 'center' : v === 'decimal' ? 'decimal' : 'left',
          fill: leader === 'dot' ? '.' : leader === 'hyphen' ? '-' : leader === 'underscore' ? '_' : ' ', decimal: '.',
        };
      }).sort((a, b) => a.pos - b.pos);
    }
    if (child(pPr, 'w:pBdr')) lost.add('paragraph borders');
    if (child(pPr, 'w:framePr')) lost.add('frames');
    return out;
  };

  // --- styles (StyleSheetTable) ---
  const stylesXml = child(xml('word/styles.xml'), 'w:styles');
  const defaults = child(stylesXml, 'w:docDefaults');
  const standard = doc.FindTextFormatCollByName('Standard')!;
  Object.assign(standard.m_aSet, runProps(child(child(defaults, 'w:rPrDefault'), 'w:rPr')), paraProps(child(child(defaults, 'w:pPrDefault'), 'w:pPr')));
  const styleEls = new Map<string, XmlElement>();
  for (const s of kids(stylesXml, 'w:style')) styleEls.set(`${W(s, 'type')}/${W(s, 'styleId')}`, s);
  const colls = new Map<string, SwTextFormatColl>();
  /** Paragraph styles become format collections, parents first; Normal is Writer's Default Paragraph Style. */
  const resolveColl = (id: string | undefined): SwTextFormatColl => {
    if (!id) return standard;
    const got = colls.get(id);
    if (got) return got;
    const el = styleEls.get(`paragraph/${id}`);
    if (!el) return standard;
    const raw = val(child(el, 'w:name')) ?? id;
    const heading = /^heading (\d)$/i.exec(raw);
    const name = heading ? `Heading ${heading[1]}` : STYLE_NAMES[raw] ?? raw;
    const isDefault = W(el, 'default') === '1' || name === 'Standard';
    const parentId = val(child(el, 'w:basedOn'));
    const parent = isDefault ? null : resolveColl(parentId);
    const set = { ...paraProps(child(el, 'w:pPr')), ...runProps(child(el, 'w:rPr')) };
    let c: SwTextFormatColl;
    if (isDefault) { Object.assign(standard.m_aSet, set); c = standard; }
    else {
      const existing = doc.FindTextFormatCollByName(name);
      // Word's styles replace the pool style of the same name.
      if (existing) { existing.m_aSet = set; existing.m_pDerivedFrom = parent; c = existing; }
      else c = doc.MakeColl(name, parent, set);
    }
    colls.set(id, c);
    return c;
  };
  for (const [key] of styleEls) if (key.startsWith('paragraph/')) resolveColl(key.slice(10));
  for (const [key, el] of styleEls) {
    if (!key.startsWith('paragraph/')) continue;
    const next = val(child(el, 'w:next'));
    if (next && colls.has(next)) colls.get(key.slice(10))!.m_pNextTextFormatColl = colls.get(next)!;
  }
  /** Character style properties, flattened along basedOn (character styles are not ported). */
  const charStyle = (id: string | undefined): SwCharAttrSet => {
    const el = id ? styleEls.get(`character/${id}`) : undefined;
    if (!el) return {};
    return { ...charStyle(val(child(el, 'w:basedOn'))), ...runProps(child(el, 'w:rPr')) };
  };
  /** Table style properties along basedOn. */
  const tableStyle = (id: string | undefined): { tblPr?: XmlElement; tcPr?: XmlElement }[] => {
    const el = id ? styleEls.get(`table/${id}`) : undefined;
    if (!el) return [];
    return [...tableStyle(val(child(el, 'w:basedOn'))), { tblPr: child(el, 'w:tblPr'), tcPr: child(el, 'w:tcPr') }];
  };
  /** Numbering set by a paragraph style (w:numPr in the style's pPr), along basedOn. */
  const styleNumPr = (id: string | undefined): XmlElement | undefined => {
    const el = id ? styleEls.get(`paragraph/${id}`) : undefined;
    if (!el) return undefined;
    return child(child(el, 'w:pPr'), 'w:numPr') ?? styleNumPr(val(child(el, 'w:basedOn')));
  };

  // --- numbering (NumberingManager): one rule and one list per w:num ---
  const numberingXml = child(xml('word/numbering.xml'), 'w:numbering');
  const abstracts = new Map<string, XmlElement>();
  for (const a of kids(numberingXml, 'w:abstractNum')) abstracts.set(W(a, 'abstractNumId') ?? '', a);
  const nums = new Map<string, { rule: SwNumRule; listId: string }>();
  for (const n of kids(numberingXml, 'w:num')) {
    const numId = W(n, 'numId') ?? '';
    const abs = abstracts.get(val(child(n, 'w:abstractNumId')) ?? '');
    if (!abs) continue;
    const rule = new SwNumRule(`WWNum${numId}`);
    const overrides = new Map(kids(n, 'w:lvlOverride').map((o) => [W(o, 'ilvl') ?? '', o]));
    for (const lvl of kids(abs, 'w:lvl')) {
      const ilvl = int(W(lvl, 'ilvl')) ?? 0;
      if (ilvl >= MAXLEVEL) continue;
      const over = overrides.get(String(ilvl));
      const src = child(over, 'w:lvl') ?? lvl;
      const f = new SwNumFormat();
      const fmt = val(child(src, 'w:numFmt')) ?? 'decimal';
      f.SetNumberingType(NUM_FMT[fmt] ?? NumberingType.ARABIC);
      if (!(fmt in NUM_FMT)) lost.add(`list numbering of type "${fmt}" (shown as 1, 2, 3)`);
      f.SetStart(int(val(child(over, 'w:startOverride'))) ?? int(val(child(src, 'w:start'))) ?? 1);
      // tdf#101626: a soft hyphen becomes a hard one. DOCX level text "%1.%2" is "%1%.%2%" in LO.
      const lvlText = (val(child(src, 'w:lvlText')) ?? '').replace(/\u00ad/g, '-');
      if (fmt === 'bullet') f.SetBulletChar(BULLET_GLYPHS[lvlText] ?? (lvlText === 'o' ? '◦' : lvlText || '•'));
      else f.SetListFormatString(lvlText.replace(/(%\d)/g, '$1%'));
      const jc = val(child(src, 'w:lvlJc'));
      f.SetNumAdjust(jc === 'right' || jc === 'end' ? 'right' : jc === 'center' ? 'center' : 'left');
      const suff = val(child(src, 'w:suff'));
      f.SetLabelFollowedBy(suff === 'space' ? 'space' : suff === 'nothing' ? 'nothing' : 'listtab');
      const ind = child(child(src, 'w:pPr'), 'w:ind');
      const left = int(W(ind, 'left') ?? W(ind, 'start')) ?? 720 * (ilvl + 1);
      const first = W(ind, 'hanging') !== undefined ? -(int(W(ind, 'hanging')) ?? 0) : int(W(ind, 'firstLine')) ?? 0;
      f.SetIndentAt(left);
      f.SetFirstLineIndent(first);
      // Word's list tab is the indent unless a tab stop says otherwise.
      const tab = kids(child(child(src, 'w:pPr'), 'w:tabs'), 'w:tab').find((t) => val(t) === 'num');
      f.SetListtabPos(int(W(tab, 'pos')) ?? left);
      rule.Set(ilvl, f);
    }
    doc.PutNumRule(rule);
    nums.set(numId, { rule, listId: `docx${numId}` });
  }

  // --- content ---
  // New nodes go before the end of the section being read, as in the ODT importer.
  let sectionEnd: SwNode = nodes.GetEndOfContent();
  const initial = nodes.FirstTextNode();
  let initialUsed = false;
  const newNode = (coll: SwTextFormatColl): SwTextNode => {
    if (!initialUsed && sectionEnd === nodes.GetEndOfContent()) { initialUsed = true; initial.m_pColl = coll; return initial; }
    if (sectionEnd === nodes.GetEndOfContent()) initialUsed = true;
    return nodes.MakeTextNode(sectionEnd.GetIndex(), coll);
  };
  const append = (node: SwTextNode, s: string, attrs: SwCharAttrSet) => {
    if (!s) return;
    const start = node.Len();
    node.m_Text += s;
    if (Object.keys(attrs).length) node.SetAttr(start, start + s.length, attrs);
  };

  const docRels = rels(files.has(mainPart) ? mainPart : 'word/document.xml');
  const footnotesXml = child(xml('word/footnotes.xml'), 'w:footnotes');
  const commentsXml = child(xml('word/comments.xml'), 'w:comments');
  const textOf = (e: XmlElement): string => e.children.map((c) => (typeof c === 'string' ? c : c.name === 'w:t' ? textOf(c) : c.name === 'w:tab' ? '\t' : c.name === 'w:br' ? '\n' : textOf(c))).join('');

  /** A complex field being read: its instruction, whether its result is being read, and whether that result is replaced. */
  interface FieldState { instr: string; inResult: boolean; replaced: boolean; savedLink: string | null }
  interface RunContext { link: string | null; partRels: Map<string, Rel>; fields: FieldState[]; openComments: Map<string, { node: SwTextNode; start: number; id: string }> }

  const readRun = (r: XmlElement, node: SwTextNode, base: SwCharAttrSet, ctx: RunContext) => {
    const rPr = child(r, 'w:rPr');
    const attrs: SwCharAttrSet = { ...base, ...charStyle(val(child(rPr, 'w:rStyle'))), ...runProps(rPr) };
    for (const c of childElements(r)) {
      if (ctx.link) attrs.RES_TXTATR_INETFMT = ctx.link; else delete attrs.RES_TXTATR_INETFMT;
      // Complex fields: begin, instruction, separate, result, end. PAGE and NUMPAGES become fields,
      // HYPERLINK a link; other fields keep their last result as text.
      const field = ctx.fields[ctx.fields.length - 1];
      if (c.name === 'w:fldChar') {
        const t = W(c, 'fldCharType');
        if (t === 'begin') ctx.fields.push({ instr: '', inResult: false, replaced: false, savedLink: ctx.link });
        else if (t === 'separate' && field) {
          field.inResult = true;
          const instr = field.instr.trim();
          const type = /^PAGE\b/.test(instr) ? 'PageNumber' : /^NUMPAGES\b/.test(instr) ? 'PageCount' : null;
          const href = /^HYPERLINK\s+"([^"]*)"/.exec(instr);
          if (type) { append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FIELD: { type } }); field.replaced = true; }
          else if (href) ctx.link = href[1]!;
          else if (instr) lost.add('fields (their current value is kept as text)');
        } else if (t === 'end' && field) { ctx.link = field.savedLink; ctx.fields.pop(); }
        continue;
      }
      if (c.name === 'w:instrText') { if (field && !field.inResult) field.instr += textOf(c); continue; }
      // A field's instruction is never shown, nor a result that became a field of its own.
      if (field && (!field.inResult || field.replaced)) continue;
      switch (c.name) {
        case 'w:t': append(node, textOf(c), attrs); break;
        case 'w:tab': append(node, '\t', attrs); break;
        case 'w:br':
          // A page break inside a paragraph moves the next paragraph to a new page.
          if (W(c, 'type') === 'page') pendingPageBreak = true;
          else append(node, '\n', attrs);
          break;
        case 'w:cr': append(node, '\n', attrs); break;
        case 'w:noBreakHyphen': append(node, '‑', attrs); break;
        case 'w:softHyphen': append(node, '­', attrs); break;
        case 'w:sym': {
          const code = W(c, 'char');
          if (code) append(node, BULLET_GLYPHS[String.fromCharCode(parseInt(code, 16) | 0xf000)] ?? String.fromCharCode(parseInt(code, 16)), attrs);
          break;
        }
        case 'w:drawing': readDrawing(c, node, attrs, ctx.partRels); break;
        case 'mc:AlternateContent': {
          const drawing = findDeep(c, 'w:drawing');
          if (drawing) readDrawing(drawing, node, attrs, ctx.partRels);
          else lost.add('shapes and text boxes');
          break;
        }
        case 'w:pict': case 'w:object': lost.add('shapes, text boxes and embedded objects'); break;
        case 'w:ptab': append(node, '\t', attrs); break; // absolute tabs approximate as tabs
        case 'w:footnoteReference': {
          const fn = kids(footnotesXml, 'w:footnote').find((f) => W(f, 'id') === W(c, 'id'));
          if (!fn) break;
          const id = doc.NewFootnoteId();
          const sec = nodes.MakeFootnoteSection(id, doc.FindTextFormatCollByName('Footnote')!);
          const placeholder = nodes.GoNext(sec.GetIndex())!;
          const saved = sectionEnd;
          sectionEnd = sec.EndOfSectionNode();
          readBlocks(fn, rels('word/footnotes.xml'));
          sectionEnd = saved;
          if (sec.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
          append(node, CH_TXTATR_BREAKWORD, { ...attrs, RES_TXTATR_FTN: { id } });
          break;
        }
        case 'w:endnoteReference': lost.add('endnotes'); break;
        case 'w:footnoteRef': break; // the footnote's own number: Writer adds it
        case 'w:commentReference': {
          const cm = kids(commentsXml, 'w:comment').find((x) => W(x, 'id') === W(c, 'id'));
          if (!cm) break;
          const open = ctx.openComments.get(W(c, 'id') ?? '');
          const field: SwPostItField = {
            id: doc.NewAnnotationId(), author: W(cm, 'author') ?? 'Unknown Author', date: W(cm, 'date') ?? '',
            text: kids(cm, 'w:p').map((p) => textOf(p)).join('\n'), resolved: false,
          };
          if (open && open.node === node && open.start < node.Len()) {
            // The anchor goes where the range starts, the range is marked.
            node.InsertText(CH_TXTATR_BREAKWORD, open.start);
            node.SetAttr(open.start, open.start + 1, { RES_TXTATR_ANNOTATION: field });
            node.SetAttr(open.start + 1, node.Len(), { RES_TXTATR_ANNOTMARK: field.id });
          } else append(node, CH_TXTATR_BREAKWORD, { RES_TXTATR_ANNOTATION: field });
          ctx.openComments.delete(W(c, 'id') ?? '');
          break;
        }
        case 'w:rPr': case 'w:lastRenderedPageBreak': case 'w:annotationRef': case 'w:separator': case 'w:continuationSeparator': break;
        default: lost.add(`other content (${c.name})`);
      }
    }
  };

  /** GraphicImport: an inline or anchored picture becomes a graphic anchored as character. */
  const readDrawing = (d: XmlElement, node: SwTextNode, attrs: SwCharAttrSet, partRels: Map<string, Rel>) => {
    const holder = child(d, 'wp:inline') ?? child(d, 'wp:anchor');
    const blip = holder && findDeep(holder, 'a:blip');
    const ext = child(holder, 'wp:extent');
    const rel = blip && partRels.get(blip.attrs.get('r:embed') ?? '');
    const data = rel && files.get(rel.target);
    if (!holder || !data || !ext) { lost.add('shapes and text boxes'); return; }
    if (holder.name === 'wp:anchor') lost.add('image positions and text wrap (images are shown in the line they are anchored to)');
    const ext2 = rel!.target.split('.').pop()!.toLowerCase();
    const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' } as Record<string, string>)[ext2];
    if (!mime) { lost.add('images in formats a browser cannot show'); return; }
    const docPr = child(holder, 'wp:docPr');
    append(node, CH_TXTATR_BREAKWORD, {
      ...attrs,
      RES_TXTATR_FLYCNT: {
        graphic: doc.AddGraphic(data, mime), width: emuToTwips(int(ext.attrs.get('cx')) ?? 0), height: emuToTwips(int(ext.attrs.get('cy')) ?? 0),
        name: docPr?.attrs.get('name') ?? doc.GetUniqueGrfName(), ...(docPr?.attrs.get('descr') ? { alt: docPr.attrs.get('descr')! } : {}),
      },
    });
  };

  let pendingPageBreak = false;
  let lastSectPr: XmlElement | undefined;

  const readPara = (p: XmlElement, partRels: Map<string, Rel>) => {
    const pPr = child(p, 'w:pPr');
    const styleId = val(child(pPr, 'w:pStyle'));
    const node = newNode(resolveColl(styleId));
    Object.assign(node.m_aSet, paraProps(pPr));
    if (pendingPageBreak) { node.m_aSet.RES_BREAK = 'page-before'; pendingPageBreak = false; }
    const numPr = child(pPr, 'w:numPr') ?? styleNumPr(styleId);
    const numId = val(child(numPr, 'w:numId'));
    const list = numId && numId !== '0' ? nums.get(numId) : undefined;
    if (list) {
      Object.assign(node.m_aSet, { RES_PARATR_NUMRULE: list.rule.GetName(), RES_PARATR_LIST_ID: list.listId, RES_PARATR_LIST_LEVEL: int(val(child(numPr, 'w:ilvl'))) ?? 0 } satisfies SwAttrSet);
      // The list's indents apply unless the paragraph sets its own.
      if (!child(pPr, 'w:ind')) delete node.m_aSet.RES_LR_SPACE;
    }
    const sect = child(pPr, 'w:sectPr');
    if (sect) { if (lastSectPr) lost.add('more than one page style (sections)'); lastSectPr = sect; }
    const ctx: RunContext = { link: null, partRels, fields: [], openComments: new Map() };
    const walk = (parent: XmlElement) => {
      for (const c of childElements(parent)) {
        switch (c.name) {
          case 'w:r': readRun(c, node, {}, ctx); break;
          case 'w:hyperlink': {
            const rel = partRels.get(c.attrs.get('r:id') ?? '');
            const anchor = W(c, 'anchor');
            const saved = ctx.link;
            ctx.link = rel?.target ?? (anchor ? `#${anchor}` : null);
            walk(c);
            ctx.link = saved;
            break;
          }
          case 'w:fldSimple': {
            const instr = (W(c, 'instr') ?? '').trim();
            const type = /^PAGE\b/.test(instr) ? 'PageNumber' : /^NUMPAGES\b/.test(instr) ? 'PageCount' : null;
            if (type) append(node, CH_TXTATR_BREAKWORD, { RES_TXTATR_FIELD: { type } });
            else { lost.add('fields (their current value is kept as text)'); walk(c); }
            break;
          }
          case 'w:smartTag': case 'w:customXml': case 'w:sdt': walk(child(c, 'w:sdtContent') ?? c); break;
          case 'w:ins': case 'w:moveTo': walk(c); lost.add('tracked changes (insertions are kept, deletions dropped)'); break;
          case 'w:del': case 'w:moveFrom': lost.add('tracked changes (insertions are kept, deletions dropped)'); break;
          case 'm:oMath': case 'm:oMathPara': lost.add('formulas'); break;
          case 'w:commentRangeStart': ctx.openComments.set(W(c, 'id') ?? '', { node, start: node.Len(), id: W(c, 'id') ?? '' }); break;
          case 'w:pPr': case 'w:bookmarkStart': case 'w:bookmarkEnd': case 'w:proofErr': case 'w:commentRangeEnd': case 'w:permStart': case 'w:permEnd':
          case 'w:moveFromRangeStart': case 'w:moveFromRangeEnd': case 'w:moveToRangeStart': case 'w:moveToRangeEnd': case 'w:smartTagPr':
          case 'w:customXmlMoveFromRangeStart': case 'w:customXmlMoveFromRangeEnd': case 'w:customXmlMoveToRangeStart': case 'w:customXmlMoveToRangeEnd': break;
          default: lost.add(`other content (${c.name})`);
        }
      }
    };
    walk(p);
    node.m_nVersion++;
  };

  // DomainMapperTableHandler: rows of cells over a grid of columns; gridSpan widens a box, vMerge continues one.
  const readTable = (tbl: XmlElement, partRels: Map<string, Rel>) => {
    const tblPr = child(tbl, 'w:tblPr');
    const styles = tableStyle(val(child(tblPr, 'w:tblStyle')));
    const prop = (name: string) => child(tblPr, name) ?? styles.map((s) => child(s.tblPr, name)).filter(Boolean).pop();
    const jc = val(prop('w:jc'));
    const tblW = prop('w:tblW');
    const width = W(tblW, 'type') === 'dxa' ? int(W(tblW, 'w')) ?? 0 : 0;
    const adjust: SwTableAdjust = width ? (jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left') : 'full';
    const table = new SwTable({ name: doc.GetUniqueTableName(), adjust, width, leftSpace: int(W(prop('w:tblInd'), 'w')) ?? 0, upper: 0, lower: 0 });
    const tableNode = new SwTableNode(nodes, table);
    tableNode.m_pStartOfSection = sectionEnd.m_pStartOfSection;
    const at = sectionEnd.GetIndex();
    nodes.Insert(tableNode, at);
    const tableEnd = new SwEndNode(nodes, tableNode);
    nodes.Insert(tableEnd, at + 1);
    if (sectionEnd === nodes.GetEndOfContent()) initialUsed = true;
    const grid = kids(child(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => int(W(g, 'w')) ?? 1000);
    const border = (e: XmlElement | undefined): SvxBorderLine | null | undefined => {
      if (!e) return undefined;
      const v = val(e);
      if (!v || v === 'nil' || v === 'none') return null;
      const color = W(e, 'color');
      return { color: color && color !== 'auto' ? `#${color.toLowerCase()}` : '#000000', width: Math.max(1, Math.round(((int(W(e, 'sz')) ?? 4) * 20) / 8)) };
    };
    const tblBorders = prop('w:tblBorders');
    /** A table border: the outer one on the table's edge, insideH/insideV between cells. */
    const tableBorder = (side: 'left' | 'right' | 'top' | 'bottom', isEdge: boolean): SvxBorderLine | null | undefined => {
      if (!isEdge) return border(child(tblBorders, side === 'top' || side === 'bottom' ? 'w:insideH' : 'w:insideV'));
      return border(child(tblBorders, `w:${side}`) ?? (side === 'left' ? child(tblBorders, 'w:start') : side === 'right' ? child(tblBorders, 'w:end') : undefined));
    };
    const cellMar = prop('w:tblCellMar');
    const padding = int(W(child(cellMar, 'w:left') ?? child(cellMar, 'w:start'), 'w')) ?? 108;
    const rows = kids(tbl, 'w:tr');
    // Open vertical merges by column: the top box and the boxes it covers.
    const vmerge = new Map<number, { top: SwTableBox; covered: SwTableBox[] }>();
    const merges: { top: SwTableBox; covered: SwTableBox[] }[] = [];
    const saved = sectionEnd;
    rows.forEach((tr, ri) => {
      const line = new SwTableLine();
      table.m_aLines.push(line);
      const trPr = child(tr, 'w:trPr');
      if (onOff(child(trPr, 'w:tblHeader')) && ri === table.m_nRowsToRepeat) table.m_nRowsToRepeat++;
      line.m_aAttrs.minHeight = int(val(child(trPr, 'w:trHeight'))) ?? 0;
      let col = int(val(child(trPr, 'w:gridBefore'))) ?? 0;
      const cells = kids(tr, 'w:tc');
      cells.forEach((tc, ci) => {
        const tcPr = child(tc, 'w:tcPr');
        const span = Math.max(1, int(val(child(tcPr, 'w:gridSpan'))) ?? 1);
        let w = 0;
        for (let k = 0; k < span; k++) w += grid[col + k] ?? grid[grid.length - 1] ?? 1000;
        const vm = child(tcPr, 'w:vMerge');
        const cont = vm && (val(vm) ?? 'continue') === 'continue';
        const attrs = defaultBoxAttrs(w, false);
        const tcBorders = child(tcPr, 'w:tcBorders');
        const lastRow = ri === rows.length - 1, lastCol = ci === cells.length - 1;
        const side = (s: 'left' | 'right' | 'top' | 'bottom', edge: boolean): SvxBorderLine | null => {
          const own = border(child(tcBorders, `w:${s}`) ?? (s === 'left' ? child(tcBorders, 'w:start') : s === 'right' ? child(tcBorders, 'w:end') : undefined));
          return own !== undefined ? own : tableBorder(s, edge) ?? null;
        };
        attrs.box = { left: side('left', ci === 0), right: side('right', lastCol), top: side('top', ri === 0), bottom: side('bottom', lastRow) } satisfies SvxBoxItem;
        attrs.padding = padding;
        const fill = W(child(tcPr, 'w:shd'), 'fill');
        if (fill && fill !== 'auto') attrs.background = `#${fill.toLowerCase()}`;
        const box = new SwTableBox(line, attrs);
        const sn = new SwStartNode(nodes, SwNodeType.Start, SwStartNodeType.SwTableBoxStartNode);
        sn.m_pStartOfSection = tableNode;
        nodes.Insert(sn, tableEnd.GetIndex());
        const en = new SwEndNode(nodes, sn);
        nodes.Insert(en, tableEnd.GetIndex());
        box.m_pStartNode = sn;
        line.m_aBoxes.push(box);
        const merge = cont ? vmerge.get(col) : undefined;
        if (merge) {
          // Continues the merge started above in this column: a covered box.
          merge.top.setRowSpan(merge.top.getRowSpan() + 1);
          merge.covered.push(box);
          box.setRowSpan(-1);
          nodes.MakeTextNode(en.GetIndex(), doc.FindTextFormatCollByName('Table Contents')!);
        } else {
          vmerge.delete(col);
          if (vm) { const m2 = { top: box, covered: [] }; vmerge.set(col, m2); merges.push(m2); }
          sectionEnd = en;
          readBlocks(tc, partRels);
          sectionEnd = saved;
          if (en.GetIndex() === sn.GetIndex() + 1) nodes.MakeTextNode(en.GetIndex(), standard);
        }
        col += span;
      });
    });
    sectionEnd = saved;
    // Covered boxes count down to the merge's end, as upstream's new table model does.
    for (const { top, covered } of merges) covered.forEach((b, i) => b.setRowSpan(-(top.getRowSpan() - 1 - i)));
    if (!table.m_aLines.length) nodes.Remove(tableNode.GetIndex(), 2);
  };

  const readBlocks = (parent: XmlElement, partRels: Map<string, Rel>) => {
    for (const el of childElements(parent)) {
      switch (el.name) {
        case 'w:p': readPara(el, partRels); break;
        case 'w:tbl': readTable(el, partRels); break;
        case 'w:sdt': readBlocks(child(el, 'w:sdtContent') ?? el, partRels); break;
        case 'w:customXml': readBlocks(el, partRels); break;
        case 'w:sectPr': if (lastSectPr && lastSectPr !== el) lost.add('more than one page style (sections)'); lastSectPr = el; break;
        case 'w:bookmarkStart': case 'w:bookmarkEnd': case 'w:tcPr': case 'w:proofErr': case 'w:permStart': case 'w:permEnd': break;
        case 'm:oMathPara': lost.add('formulas'); break;
        default: lost.add(`other content (${el.name})`);
      }
    }
  };

  const body = child(child(documentXml, 'w:document'), 'w:body');
  if (!body) throw new Error('This Word document has no body.');
  readBlocks(body, docRels);

  // PropertyMap::SectionPropertyMap: page size and margins of the last section, its default
  // header and footer. Word's header sits at its own distance from the edge and the body starts at
  // the top margin or below the header, whichever is lower: a minimum height and no spacing say that.
  const pd = doc.m_aPageDesc;
  const pgSz = child(lastSectPr, 'w:pgSz'), pgMar = child(lastSectPr, 'w:pgMar');
  if (pgSz) { pd.nWidth = int(W(pgSz, 'w')) ?? pd.nWidth; pd.nHeight = int(W(pgSz, 'h')) ?? pd.nHeight; }
  const m = (k: string) => int(W(pgMar, k));
  if (pgMar) {
    pd.nLeft = m('left') ?? pd.nLeft; pd.nRight = m('right') ?? pd.nRight;
    pd.nTop = Math.abs(m('top') ?? pd.nTop); pd.nBottom = Math.abs(m('bottom') ?? pd.nBottom);
  }
  for (const [tag, eTyp, coll] of [['w:headerReference', SwStartNodeType.SwHeaderStartNode, 'Header'], ['w:footerReference', SwStartNodeType.SwFooterStartNode, 'Footer']] as const) {
    const refs = kids(lastSectPr, tag);
    if (refs.some((r) => W(r, 'type') === 'first' || W(r, 'type') === 'even')) lost.add('different headers or footers on left or first pages');
    const ref = refs.find((r) => (W(r, 'type') ?? 'default') === 'default');
    const rel = ref && docRels.get(ref.attrs.get('r:id') ?? '');
    const partXml = rel && xml(rel.target);
    const root = partXml && childElements(partXml)[0];
    if (!root) continue;
    const sec = nodes.MakeAreaSection(eTyp, doc.FindTextFormatCollByName(coll)!);
    const placeholder = nodes.GoNext(sec.GetIndex())!;
    const saved = sectionEnd;
    sectionEnd = sec.EndOfSectionNode();
    readBlocks(root, rels(rel!.target));
    sectionEnd = saved;
    if (sec.EndOfSectionNode().GetIndex() > placeholder.GetIndex() + 1) nodes.Remove(placeholder.GetIndex());
    const isHeader = eTyp === SwStartNodeType.SwHeaderStartNode;
    const dist = m(isHeader ? 'header' : 'footer') ?? 720;
    if (isHeader) { pd.nHeaderMinHeight = Math.max(0, pd.nTop - dist); pd.nHeaderSpacing = 0; pd.nTop = dist; }
    else { pd.nFooterMinHeight = Math.max(0, pd.nBottom - dist); pd.nFooterSpacing = 0; pd.nBottom = dist; }
  }

  if (nodes.node(nodes.GetEndOfContent().GetIndex() - 1).IsEndNode()) nodes.MakeTextNode(nodes.GetEndOfContent().GetIndex(), standard);
  doc.SetUnmodified();
  return { doc, lost: [...lost] };
}

function findDeep(e: XmlElement, name: string): XmlElement | undefined {
  for (const c of childElements(e)) {
    if (c.name === name) return c;
    const f = findDeep(c, name);
    if (f) return f;
  }
  return undefined;
}
