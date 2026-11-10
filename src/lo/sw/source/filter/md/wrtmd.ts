// SPDX-License-Identifier: MPL-2.0
// @upstream sw/source/filter/md/wrtmd.cxx reduced
// @upstream sw/source/filter/md/wrtmd.hxx reduced
// Markdown export (GitHub flavour): headings, block quotes, code blocks, lists (with their labels),
// tables, bold, italic, strikethrough, code spans, hyperlinks, images as data: URLs, tracked changes
// as <ins>/<del>, and task list items (☐/☒ at the start of a list paragraph). Differences: empty
// "Horizontal Line" paragraphs are written as thematic breaks (upstream checks for them only in
// non-empty paragraphs); text frames and shapes are not written; hidden sections are skipped.
import type { SwDoc } from '../../../inc/doc.ts';
import { CH_TXTATR_BREAKWORD, type SwCharAttrSet, type SwRedlineData } from '../../../inc/hintids.ts';
import type { SwTextNode } from '../../../inc/ndtxt.ts';
import type { SwNode, SwTableNode } from '../../../inc/node.ts';
import type { SwFormat } from '../../../inc/format.ts';
import { NumberingType } from '../../../../i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { NumberParagraphs, GetActualListLevel, type SwNodeNum } from '../../core/doc/list.ts';
import { CHECKED_STATE, UNCHECKED_STATE } from './swmd.ts';

const NL = '\n';

/** SwMDImageInfo */
interface SwMDImageInfo { aURL: string; aTitle: string; aDescription: string; aLink: string }

/** FormattingStatus: the "level" of each feature; positive means applied. */
interface FormattingStatus {
  nCrossedOutChange: number;
  nPostureChange: number;
  nUnderlineChange: number;
  nWeightChange: number;
  nCodeChange: number;
  aHyperlinkChanges: Map<string, number>;
  aRedlineChanges: Map<SwRedlineData, number>;
  aImages: SwMDImageInfo[];
}
const newStatus = (): FormattingStatus => ({ nCrossedOutChange: 0, nPostureChange: 0, nUnderlineChange: 0, nWeightChange: 0, nCodeChange: 0, aHyperlinkChanges: new Map(), aRedlineChanges: new Map(), aImages: [] });
const copyStatus = (s: FormattingStatus): FormattingStatus => ({ ...s, aHyperlinkChanges: new Map(s.aHyperlinkChanges), aRedlineChanges: new Map(s.aRedlineChanges), aImages: [] });

/** An attribute that starts or ends at a position (a hint, a paragraph attribute or an image). */
interface Pos { pos: number; attrs: SwCharAttrSet; image?: SwMDImageInfo }

const ShouldCloseIt = (prev: number, curr: number) => prev !== curr && prev >= 0 && curr <= 0;
const ShouldOpenIt = (prev: number, curr: number) => prev !== curr && prev <= 0 && curr > 0;

const base64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** SwMDCellInfo */
interface SwMDCellInfo { bCellStart?: boolean; bCellEnd?: boolean; bRowStart?: boolean; bRowEnd?: boolean; bFirstRowEnd?: boolean; nFirstRowBoxCount?: number; aFirstRowBoxAdjustments?: string[] }
interface SwMDTableInfo { aCellInfos: Map<number, SwMDCellInfo>; nEndIndex: number }

class SwMDWriter {
  private out: string[] = [];
  private m_aTableInfos: SwMDTableInfo[] = [];
  private m_aListLevelPrefixSizes = new Map<number, number>();
  private m_nTaskListItems = 0;
  private nums: Map<SwTextNode, SwNodeNum>;
  private codeFont: string;
  private readonly m_pDoc: SwDoc;

  constructor(doc: SwDoc) {
    this.m_pDoc = doc;
    const nodes = doc.GetNodes(), paras: SwTextNode[] = [];
    for (let i = nodes.BodyStart(); i < nodes.GetEndOfContent().GetIndex(); i++) { const n = nodes.node(i); if (n.IsTextNode()) paras.push(n); }
    this.nums = NumberParagraphs(doc, paras);
    this.codeFont = doc.FindTextFormatCollByName('Preformatted Text')?.GetFormatAttr('RES_CHRATR_FONT') ?? 'Liberation Mono';
  }

  private w(s: string): void { this.out.push(s); }

  /** ApplyItem */
  private ApplyItem(rChange: FormattingStatus, a: SwCharAttrSet, increment: number): void {
    const flag = (v: unknown) => (v ? increment : -increment);
    if (a.RES_CHRATR_CROSSEDOUT !== undefined) rChange.nCrossedOutChange += flag(a.RES_CHRATR_CROSSEDOUT);
    if (a.RES_CHRATR_POSTURE !== undefined) rChange.nPostureChange += flag(a.RES_CHRATR_POSTURE);
    if (a.RES_CHRATR_UNDERLINE !== undefined) rChange.nUnderlineChange += flag(a.RES_CHRATR_UNDERLINE !== 'none');
    if (a.RES_CHRATR_WEIGHT !== undefined) rChange.nWeightChange += flag(a.RES_CHRATR_WEIGHT);
    // We know the import uses this font for code spans, so map this back to a code span.
    if (a.RES_CHRATR_FONT !== undefined && a.RES_CHRATR_FONT === this.codeFont) rChange.nCodeChange += increment;
    if (a.RES_TXTATR_INETFMT) rChange.aHyperlinkChanges.set(a.RES_TXTATR_INETFMT, (rChange.aHyperlinkChanges.get(a.RES_TXTATR_INETFMT) ?? 0) + increment);
    const r = a.RES_TXTATR_REDLINE;
    if (r && (r.type === 'Insert' || r.type === 'Delete')) rChange.aRedlineChanges.set(r, (rChange.aRedlineChanges.get(r) ?? 0) + increment);
  }

  /** ApplyFlyFrameFormat for a graphic: its data goes into a data: URL. */
  private ImageInfo(graphic: string, alt: string | undefined): SwMDImageInfo | null {
    const g = this.m_pDoc.m_aGraphics.get(graphic);
    if (!g) return null;
    return { aURL: `data:${g.mime};base64,${base64(g.data)}`, aTitle: '', aDescription: alt ?? '', aLink: '' };
  }

  private OutMarkdown_SwMDImageInfo(i: SwMDImageInfo): void {
    if (i.aLink) this.w('[');
    this.w('![');
    this.OutEscapedChars(i.aDescription);
    this.w(`](${i.aURL}`);
    if (i.aTitle) { this.w(' "'); this.OutEscapedChars(i.aTitle); this.w('"'); }
    this.w(')');
    if (i.aLink) this.w(`](${i.aLink})`);
  }

  /** OutFormattingChange: closing markup for what ends here, then opening markup for what starts. */
  private OutFormattingChange(starts: Pos[], ends: Pos[], pos: number, current: FormattingStatus): FormattingStatus {
    const result = copyStatus(current);
    for (const e of ends) if (e.pos === pos) this.ApplyItem(result, e.attrs, -1);
    for (const s of starts) if (s.pos === pos) { this.ApplyItem(result, s.attrs, +1); if (s.image) result.aImages.push(s.image); }

    if (ShouldCloseIt(current.nCodeChange, result.nCodeChange)) this.w('`');
    // Not in CommonMark
    if (ShouldCloseIt(current.nCrossedOutChange, result.nCrossedOutChange)) this.w('~~');
    if (ShouldCloseIt(current.nPostureChange, result.nPostureChange)) this.w('*');
    if (ShouldCloseIt(current.nWeightChange, result.nWeightChange)) this.w('**');
    for (const [url, curr] of result.aHyperlinkChanges) if (ShouldCloseIt(current.aHyperlinkChanges.get(url) ?? 0, curr)) this.w(`](${url})`);
    for (const [r, curr] of result.aRedlineChanges) if (ShouldCloseIt(current.aRedlineChanges.get(r) ?? 0, curr)) this.w(`</${r.type === 'Insert' ? 'ins' : 'del'}>`);

    for (const [r, curr] of result.aRedlineChanges) {
      if (ShouldOpenIt(current.aRedlineChanges.get(r) ?? 0, curr)) this.w(`<${r.type === 'Insert' ? 'ins' : 'del'} title="Author: ${r.author}" datetime="${r.date}">`);
    }
    if (ShouldOpenIt(current.nCrossedOutChange, result.nCrossedOutChange)) this.w('~~');
    if (ShouldOpenIt(current.nPostureChange, result.nPostureChange)) this.w('*');
    if (ShouldOpenIt(current.nWeightChange, result.nWeightChange)) this.w('**');
    for (const [url, curr] of result.aHyperlinkChanges) if (ShouldOpenIt(current.aHyperlinkChanges.get(url) ?? 0, curr)) this.w('[');
    if (ShouldOpenIt(current.nCodeChange, result.nCodeChange)) this.w('`');
    // Images: write the complete markup on start.
    for (const i of result.aImages) this.OutMarkdown_SwMDImageInfo(i);
    return result;
  }

  private OutEscapedChars(chars: string): void {
    let s = '';
    for (const ch of chars) {
      switch (ch) {
        // dummy characters: anchors, comments, etc.
        case CH_TXTATR_BREAKWORD: break;
        case '\n': s += `  ${NL}`; break;
        case '\\': case '`': case '*': case '_': case '{': case '}': case '[': case ']': case '<': case '>': case '#':
          s += `\\${ch}`; break;
        default: s += ch;
      }
    }
    this.w(s);
  }

  /** The heading level of a paragraph's style chain (RES_POOLCOLL_HEADLINE1..6). */
  private static HeadingLevel(n: SwTextNode): number {
    for (let f: SwFormat | null = n.GetTextColl(); f; f = f.DerivedFrom()) {
      const m = /^Heading ([1-6])$/.exec(f.GetName());
      if (m) return parseInt(m[1]!, 10);
    }
    return 0;
  }

  /** OutMarkdown_SwTextNode */
  private OutMarkdown_SwTextNode(rNode: SwTextNode, bFirst: boolean): void {
    const nodes = this.m_pDoc.GetNodes();
    const tableInfo = this.m_aTableInfos[this.m_aTableInfos.length - 1];
    const bInTable = !!tableInfo;
    const oCellInfo = tableInfo?.aCellInfos.get(rNode.GetIndex());
    const bInNestedTable = this.m_aTableInfos.length > 1;
    if (oCellInfo?.bCellStart && !bInNestedTable) {
      // Cell start, separate by " | " from the previous cell.
      if (!oCellInfo.bRowStart) this.w(' ');
      this.w('| ');
    }
    const text = rNode.GetText();
    const coll = rNode.GetTextColl().GetName();
    if (!text && coll === 'Horizontal Line' && !bInTable) {
      if (!bFirst) this.w(NL);
      this.w(`___${NL}`);
      return;
    }
    if (text) {
      // Paragraphs separate by empty lines
      if (!bFirst && !bInTable) this.w(NL);
      if (coll === 'Quotations') this.w('> ');
      const nHeadingLevel = SwMDWriter.HeadingLevel(rNode);
      const num = this.nums.get(rNode);
      let skipTask = 0;
      if (nHeadingLevel > 0) this.w(`${'#'.repeat(nHeadingLevel)} `);
      else if (num) {
        // The amount of indent depends on the parent's prefix size.
        const level = GetActualListLevel(rNode);
        const aLevel = ' '.repeat(this.m_aListLevelPrefixSizes.get(level - 1) ?? 0);
        let aNumString = num.counted ? num.label : '';
        if (num.counted && num.fmt.GetNumberingType() === NumberingType.CHAR_SPECIAL) aNumString = '-';
        if (aLevel || aNumString) {
          let aPrefix = `${aLevel}${aNumString} `;
          // A task list item: its checkbox becomes the item's marker.
          const box = /^([☐☒]) /.exec(text);
          if (box && aNumString) { aPrefix += `[${box[1] === CHECKED_STATE ? 'x' : ' '}] `; skipTask = 2; }
          this.w(aPrefix);
          this.m_aListLevelPrefixSizes.set(level, aLevel.length + aNumString.length + 1);
        }
      }
      const isCode = (n: SwNode | undefined) => !!n?.IsTextNode() && (n as SwTextNode).GetTextColl().GetName() === 'Preformatted Text';
      const bCode = isCode(rNode);
      // Before the first paragraph of a code block.
      if (bCode && !isCode(nodes.node(rNode.GetIndex() - 1))) this.w(`\`\`\`${NL}`);

      const nEnd = text.length;
      const starts: Pos[] = [], ends: Pos[] = [];
      // Paragraph properties span the whole text.
      const paraChar: SwCharAttrSet = {};
      for (const k of Object.keys(rNode.m_aSet) as (keyof SwCharAttrSet)[]) if (k.startsWith('RES_CHRATR_')) (paraChar as Record<string, unknown>)[k] = rNode.m_aSet[k as keyof typeof rNode.m_aSet];
      if (!bCode && Object.keys(paraChar).length) { starts.push({ pos: 0, attrs: paraChar }); ends.push({ pos: nEnd, attrs: paraChar }); }
      for (const h of rNode.m_aHints) {
        const fly = h.aAttrs.RES_TXTATR_FLYCNT;
        if (fly) {
          const info = fly.graphic ? this.ImageInfo(fly.graphic, fly.alt) : null;
          if (info) starts.push({ pos: h.nStart, attrs: {}, image: info });
          continue;
        }
        if (h.nEnd === h.nStart || bCode) continue; // no output of zero-length hints
        starts.push({ pos: h.nStart, attrs: h.aAttrs });
        ends.push({ pos: Math.min(h.nEnd, nEnd), attrs: h.aAttrs });
      }
      // Flys anchored to this paragraph, at their content position.
      for (const f of rNode.m_aAnchoredFlys) {
        const info = f.fmt.graphic !== undefined ? this.ImageInfo(f.fmt.graphic, f.fmt.alt) : null;
        if (info) starts.push({ pos: Math.min(f.nContent, nEnd), attrs: {}, image: info });
      }
      const cuts = new Set<number>([skipTask, nEnd]);
      for (const p of [...starts, ...ends]) cuts.add(p.pos);
      const order = [...cuts].filter((c) => c >= skipTask && c <= nEnd).sort((a, b) => a - b);
      let current = newStatus();
      for (let k = 0; k < order.length; k++) {
        const pos = order[k]!;
        current = this.OutFormattingChange(starts, ends, pos, current);
        const next = order[k + 1];
        if (next === undefined) break;
        const chunk = text.slice(pos, next);
        if (bCode) this.w(chunk); else this.OutEscapedChars(chunk);
      }
      // After the last paragraph of a code block.
      if (bCode && !isCode(nodes.node(rNode.GetIndex() + 1))) this.w(`${NL}\`\`\``);
    }

    const bRowEnd = !!oCellInfo?.bRowEnd;
    if (bRowEnd && !bInNestedTable) {
      // Cell ends are implicit, but row end has its own marker.
      this.w(' |');
      if (oCellInfo!.bFirstRowEnd) {
        // First row has a separator from the remaining rows.
        this.w(NL);
        for (const adj of oCellInfo!.aFirstRowBoxAdjustments ?? []) this.w(adj === 'center' ? '| :-: ' : adj === 'right' ? '| -: ' : '| - ');
        this.w('|');
      }
    }
    const bCellEnd = !!oCellInfo?.bCellEnd;
    if (bInTable && (!bCellEnd || bInNestedTable)) this.w(' ');
    else if (!bInTable || bRowEnd) this.w(NL);
  }

  /** OutMarkdown_SwTableNode: where cells and rows start and end. */
  private OutMarkdown_SwTableNode(rTableNode: SwTableNode): void {
    const nodes = this.m_pDoc.GetNodes();
    const aTableInfo: SwMDTableInfo = { aCellInfos: new Map(), nEndIndex: rTableNode.EndOfSectionNode().GetIndex() };
    const info = (i: number) => { let c = aTableInfo.aCellInfos.get(i); if (!c) { c = {}; aTableInfo.aCellInfos.set(i, c); } return c; };
    rTableNode.m_pTable.GetTabLines().forEach((line, nLine) => {
      const boxes = line.m_aBoxes.filter((b) => b.m_pStartNode && b.getRowSpan() > 0);
      const adjustments: string[] = [];
      boxes.forEach((box, nBox) => {
        const start = box.m_pStartNode!;
        const nCellStart = start.GetIndex() + 1;
        const rStart = info(nCellStart);
        rStart.bCellStart = true;
        if (nLine === 0) {
          const first = nodes.node(nCellStart);
          adjustments.push(first.IsTextNode() ? first.GetAttr('RES_PARATR_ADJUST') : 'left');
        }
        if (nBox === 0) rStart.bRowStart = true;
        const rEnd = info(start.EndOfSectionNode().GetIndex() - 1);
        rEnd.bCellEnd = true;
        if (nBox === boxes.length - 1) {
          rEnd.bRowEnd = true;
          if (nLine === 0) { rEnd.bFirstRowEnd = true; rEnd.nFirstRowBoxCount = boxes.length; rEnd.aFirstRowBoxAdjustments = adjustments; }
        }
      });
    });
    this.m_aTableInfos.push(aTableInfo);
    // Separator between the table and the previous content.
    if (this.m_aTableInfos.length === 1) this.w(NL);
  }

  /** Out_SwDoc */
  Out_SwDoc(): string {
    const nodes = this.m_pDoc.GetNodes();
    let bFirstLine = true;
    for (let i = nodes.BodyStart(); i < nodes.GetEndOfContent().GetIndex(); i++) {
      const rNd = nodes.node(i);
      if (rNd.IsTextNode()) { this.OutMarkdown_SwTextNode(rNd, bFirstLine); bFirstLine = false; }
      else if (rNd.IsTableNode()) { this.OutMarkdown_SwTableNode(rNd as SwTableNode); bFirstLine = false; }
      else if (rNd.IsEndNode() && this.m_aTableInfos.length && i === this.m_aTableInfos[this.m_aTableInfos.length - 1]!.nEndIndex) this.m_aTableInfos.pop();
      else if (rNd.GetSectionNode()?.m_pSection.m_bHidden) i = rNd.GetSectionNode()!.EndOfSectionNode().GetIndex();
    }
    return this.out.join('');
  }
}

/** SwMDWriter::WriteStream for the whole document. */
export function ExportMarkdown(doc: SwDoc): string {
  return new SwMDWriter(doc).Out_SwDoc();
}
