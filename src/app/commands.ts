// `.uno:` command dispatch. Keys are upstream's command names, so menus, toolbars and shortcuts
// generated from upstream light up as soon as a command is registered here.
import type { Controller } from './controller.ts';
import { printDocument } from './print.ts';
import { exportPDFToFile } from './pdf.ts';
import { HoriOrientation, RndStdIds, VertOrientation, WrapTextMode } from '@lo/sw/inc/frmfmt.ts';

export interface Command {
  exec(c: Controller): void | Promise<void>;
  /** Toggle state for toolbar buttons and menu checkmarks. */
  checked?(c: Controller): boolean;
  enabled?(c: Controller): boolean;
}

const hasUndo = (c: Controller) => c.sh.m_pDoc.m_aUndo.length > 0;
const hasRedo = (c: Controller) => c.sh.m_pDoc.m_aRedo.length > 0;
const hasSel = (c: Controller) => c.sh.HasSelection();
const ESC = 33;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const FONT_STEP = 20; // 1pt, in twips
const INDENT_STEP = 567; // 1 cm, in twips
const PARA_STEP = 100; // about 0.18 cm, in twips

const toggle = (key: 'RES_CHRATR_WEIGHT' | 'RES_CHRATR_POSTURE' | 'RES_CHRATR_CROSSEDOUT'): Command => ({
  exec: (c) => c.sh.SetCharAttr({ [key]: !c.sh.GetAttr(key) }),
  checked: (c) => c.sh.GetAttr(key),
});

const adjust = (value: 'left' | 'right' | 'center' | 'block'): Command => ({
  exec: (c) => c.sh.SetParaAttr({ RES_PARATR_ADJUST: value }),
  checked: (c) => c.sh.m_pCursor.GetPoint().GetNode().GetAttr('RES_PARATR_ADJUST') === value,
});

const heading = (style: string): Command => ({
  exec: (c) => c.sh.SetTextFormatColl(style),
  checked: (c) => c.sh.GetCurTextFormatColl() === style,
});

const para = (c: Controller) => c.sh.m_pCursor.GetPoint().GetNode();
const inList = (c: Controller) => !!c.sh.GetNumRuleAtCurrCursorPos();
const inTable = (c: Controller) => c.sh.IsCursorInTable();
const tableCmd = (f: (c: Controller) => unknown): Command => ({ exec: (c) => { f(c); }, enabled: inTable });

const charStyle = (name: string): Command => ({
  exec: (c) => c.sh.SetCharFormat(c.sh.GetCharFormatName() === name ? null : name),
  checked: (c) => c.sh.GetCharFormatName() === name,
});

const listStyle = (name: string): Command => ({
  exec: (c) => c.sh.SetCurNumRuleByName(name),
  checked: (c) => para(c).GetAttr('RES_PARATR_NUMRULE') === name,
});

const flySel = (c: Controller) => c.sh.IsFrameSelected();
/** Anchored (not as-character) selected objects: the ones wrap and position apply to. */
const flyFree = (c: Controller) => flySel(c) && c.sh.GetAnchorId() !== RndStdIds.FLY_AS_CHAR;
const wrap = (mode: WrapTextMode, opaque?: boolean): Command => ({
  exec: (c) => { c.sh.SetFlyFrameAttr({ m_aSurround: { m_eSurround: mode }, ...(opaque !== undefined ? { m_bOpaque: opaque } : {}) }); },
  checked: (c) => flyFree(c) && c.sh.GetFlyFrameFormat()?.m_aSurround.m_eSurround === mode && (opaque === undefined || c.sh.GetFlyFrameFormat()?.m_bOpaque === opaque),
  enabled: flyFree,
});
const anchor = (id: RndStdIds): Command => ({
  exec: (c) => { c.sh.ChgAnchor(id); },
  checked: (c) => c.sh.GetAnchorId() === id,
  enabled: (c) => flySel(c) && (id !== RndStdIds.FLY_AS_CHAR || c.sh.GetFlyFrameFormat()?.graphic !== undefined),
});
/** SwFEShell::SetFlyFrameAttr with an orientation against the current relation (Align Objects). */
const objAlign = (hori: number | null, vert: number | null): Command => ({
  exec: (c) => {
    const f = c.sh.GetFlyFrameFormat();
    if (!f) return;
    c.sh.SetFlyFrameAttr(hori !== null ? { m_aHoriOrient: { ...f.m_aHoriOrient, m_eOrient: hori } } : { m_aVertOrient: { ...f.m_aVertOrient, m_eOrient: vert! } });
  },
  checked: (c) => { const f = c.sh.GetFlyFrameFormat(); return !!f && flyFree(c) && (hori !== null ? f.m_aHoriOrient.m_eOrient === hori : f.m_aVertOrient.m_eOrient === vert); },
  enabled: flyFree,
});
/** Drawing order (SwFEShell::SelectionToTop and friends): one step or all the way. */
const order = (dir: 1 | -1, all: boolean): Command => ({
  exec: (c) => {
    const zs = c.sh.m_pDoc.GetFlyFormats().map((f) => (f.fmt?.m_nZOrder ?? 0));
    const cur = c.sh.GetFlyFrameFormat()?.m_nZOrder ?? 0;
    const z = all ? (dir > 0 ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1) : cur + dir;
    c.sh.SetFlyFrameAttr({ m_nZOrder: z });
  },
  enabled: flyFree,
});

export const COMMANDS: Record<string, Command> = {
  '.uno:AddDirect': { exec: (c) => c.newDocument() },
  '.uno:NewDoc': { exec: (c) => c.newDocument() },
  '.uno:OpenFromWriter': { exec: (c) => c.setDialog('documents') },
  '.uno:Open': { exec: (c) => c.setDialog('documents') },
  '.uno:Save': { exec: (c) => c.save() },
  '.uno:SaveAs': { exec: (c) => c.saveAs() },
  '.uno:Print': { exec: (c) => printDocument(c) },
  '.uno:ExportDirectToPDF': { exec: (c) => exportPDFToFile(c) },
  '.uno:ExportToPDF': { exec: (c) => exportPDFToFile(c) },
  '.uno:Undo': { exec: (c) => c.sh.Undo(), enabled: hasUndo },
  '.uno:Redo': { exec: (c) => c.sh.Redo(), enabled: hasRedo },
  '.uno:Cut': {
    enabled: hasSel,
    exec: async (c) => { await navigator.clipboard.writeText(c.sh.GetSelText()); c.sh.DelSelection(); },
  },
  '.uno:Copy': { enabled: hasSel, exec: (c) => navigator.clipboard.writeText(c.sh.GetSelText()) },
  '.uno:Paste': { exec: async (c) => c.sh.Paste(await navigator.clipboard.readText()) },
  '.uno:SelectAll': { exec: (c) => { c.sh.SelAll(); c.notify(); } },
  '.uno:SearchDialog': { exec: (c) => c.setDialog('find') },
  '.uno:Bold': toggle('RES_CHRATR_WEIGHT'),
  '.uno:Italic': toggle('RES_CHRATR_POSTURE'),
  '.uno:Strikeout': toggle('RES_CHRATR_CROSSEDOUT'),
  '.uno:Underline': {
    exec: (c) => c.sh.SetCharAttr({ RES_CHRATR_UNDERLINE: c.sh.GetAttr('RES_CHRATR_UNDERLINE') === 'none' ? 'single' : 'none' }),
    checked: (c) => c.sh.GetAttr('RES_CHRATR_UNDERLINE') !== 'none',
  },
  '.uno:UnderlineSingle': {
    exec: (c) => c.sh.SetCharAttr({ RES_CHRATR_UNDERLINE: c.sh.GetAttr('RES_CHRATR_UNDERLINE') === 'single' ? 'none' : 'single' }),
    checked: (c) => c.sh.GetAttr('RES_CHRATR_UNDERLINE') === 'single',
  },
  '.uno:UnderlineDouble': {
    exec: (c) => c.sh.SetCharAttr({ RES_CHRATR_UNDERLINE: c.sh.GetAttr('RES_CHRATR_UNDERLINE') === 'double' ? 'none' : 'double' }),
    checked: (c) => c.sh.GetAttr('RES_CHRATR_UNDERLINE') === 'double',
  },
  '.uno:SuperScript': {
    exec: (c) => c.sh.SetCharAttr({ RES_CHRATR_ESCAPEMENT: c.sh.GetAttr('RES_CHRATR_ESCAPEMENT') > 0 ? 0 : ESC }),
    checked: (c) => c.sh.GetAttr('RES_CHRATR_ESCAPEMENT') > 0,
  },
  '.uno:SubScript': {
    exec: (c) => c.sh.SetCharAttr({ RES_CHRATR_ESCAPEMENT: c.sh.GetAttr('RES_CHRATR_ESCAPEMENT') < 0 ? 0 : -ESC }),
    checked: (c) => c.sh.GetAttr('RES_CHRATR_ESCAPEMENT') < 0,
  },
  '.uno:Grow': { exec: (c) => c.sh.SetCharAttr({ RES_CHRATR_FONTSIZE: c.sh.GetAttr('RES_CHRATR_FONTSIZE') + FONT_STEP }) },
  '.uno:Shrink': { exec: (c) => c.sh.SetCharAttr({ RES_CHRATR_FONTSIZE: Math.max(FONT_STEP * 2, c.sh.GetAttr('RES_CHRATR_FONTSIZE') - FONT_STEP) }) },
  '.uno:ResetAttributes': { exec: (c) => c.sh.ResetAttrs() },
  '.uno:LeftPara': adjust('left'),
  '.uno:CenterPara': adjust('center'),
  '.uno:RightPara': adjust('right'),
  '.uno:JustifyPara': adjust('block'),
  '.uno:CommonAlignLeft': adjust('left'),
  '.uno:CommonAlignHorizontalCenter': adjust('center'),
  '.uno:CommonAlignRight': adjust('right'),
  '.uno:CommonAlignJustified': adjust('block'),
  '.uno:IncrementIndent': { exec: (c) => { const lr = para(c).GetAttr('RES_LR_SPACE'); c.sh.SetParaAttr({ RES_LR_SPACE: { ...lr, left: lr.left + INDENT_STEP } }); } },
  '.uno:DecrementIndent': { exec: (c) => { const lr = para(c).GetAttr('RES_LR_SPACE'); c.sh.SetParaAttr({ RES_LR_SPACE: { ...lr, left: Math.max(0, lr.left - INDENT_STEP) } }); } },
  '.uno:ParaspaceIncrease': { exec: (c) => { const u = para(c).GetAttr('RES_UL_SPACE'); c.sh.SetParaAttr({ RES_UL_SPACE: { upper: u.upper + PARA_STEP, lower: u.lower + PARA_STEP } }); } },
  '.uno:ParaspaceDecrease': { exec: (c) => { const u = para(c).GetAttr('RES_UL_SPACE'); c.sh.SetParaAttr({ RES_UL_SPACE: { upper: Math.max(0, u.upper - PARA_STEP), lower: Math.max(0, u.lower - PARA_STEP) } }); } },
  '.uno:SpacePara1': { exec: (c) => c.sh.SetParaAttr({ RES_PARATR_LINESPACING: { rule: 'proportional', value: 100 } }) },
  '.uno:SpacePara115': { exec: (c) => c.sh.SetParaAttr({ RES_PARATR_LINESPACING: { rule: 'proportional', value: 115 } }) },
  '.uno:SpacePara15': { exec: (c) => c.sh.SetParaAttr({ RES_PARATR_LINESPACING: { rule: 'proportional', value: 150 } }) },
  '.uno:SpacePara2': { exec: (c) => c.sh.SetParaAttr({ RES_PARATR_LINESPACING: { rule: 'proportional', value: 200 } }) },
  '.uno:InsertPagebreak': {
    exec: (c) => { c.sh.SplitNode(); c.sh.SetParaAttr({ RES_BREAK: 'page-before' }); },
  },
  '.uno:InsertLinebreak': { exec: (c) => c.sh.InsertLineBreak() },
  '.uno:InsertNonBreakingSpace': { exec: (c) => c.sh.Insert('\u00a0') },
  '.uno:FontDialog': { exec: (c) => c.setDialog('character') },
  '.uno:ParagraphDialog': { exec: (c) => c.setDialog('paragraph') },
  '.uno:PageDialog': { exec: (c) => c.setDialog('page') },
  '.uno:WordCountDialog': { exec: (c) => c.setDialog('wordcount') },
  '.uno:About': { exec: (c) => c.setDialog('about') },
  '.uno:ZoomPlus': { exec: (c) => c.setZoom(clamp(c.zoom * 1.2, 0.2, 6)) },
  '.uno:ZoomMinus': { exec: (c) => c.setZoom(clamp(c.zoom / 1.2, 0.2, 6)) },
  '.uno:Zoom50Percent': { exec: (c) => c.setZoom(0.5) },
  '.uno:Zoom75Percent': { exec: (c) => c.setZoom(0.75) },
  '.uno:Zoom100Percent': { exec: (c) => c.setZoom(1) },
  '.uno:Zoom150Percent': { exec: (c) => c.setZoom(1.5) },
  '.uno:Zoom200Percent': { exec: (c) => c.setZoom(2) },
  '.uno:HyperlinkDialog': { exec: (c) => c.setDialog('hyperlink') },
  '.uno:EditHyperlink': { exec: (c) => c.setDialog('hyperlink'), enabled: (c) => !!c.sh.GetINetAttr() },
  '.uno:RemoveHyperlink': { exec: (c) => c.sh.DeleteINetAttr(), enabled: (c) => !!c.sh.GetINetAttr() || c.sh.HasSelection() },
  '.uno:CopyHyperlinkLocation': { exec: (c) => navigator.clipboard.writeText(c.sh.GetINetAttr()!.url), enabled: (c) => !!c.sh.GetINetAttr() },
  '.uno:OpenHyperlinkOnCursor': { exec: (c) => c.openURL(c.sh.GetINetAttr()!.url), enabled: (c) => !!c.sh.GetINetAttr() },
  '.uno:InsertPageHeader': { exec: (c) => c.sh.ChangeHeaderOrFooter(true, !c.sh.IsHeaderOn(true)), checked: (c) => c.sh.IsHeaderOn(true) },
  '.uno:InsertPageFooter': { exec: (c) => c.sh.ChangeHeaderOrFooter(false, !c.sh.IsHeaderOn(false)), checked: (c) => c.sh.IsHeaderOn(false) },
  '.uno:JumpToHeader': { exec: (c) => { c.sh.GotoHeaderFooter(true); }, enabled: (c) => c.sh.IsHeaderOn(true) },
  '.uno:JumpToFooter': { exec: (c) => { c.sh.GotoHeaderFooter(false); }, enabled: (c) => c.sh.IsHeaderOn(false) },
  '.uno:InsertPageNumberField': { exec: (c) => c.sh.InsertField('PageNumber') },
  '.uno:InsertPageCountField': { exec: (c) => c.sh.InsertField('PageCount') },
  '.uno:InsertDateField': { exec: (c) => c.sh.InsertField('Date', true) },
  '.uno:InsertDateFieldVar': { exec: (c) => c.sh.InsertField('Date') },
  '.uno:InsertTimeField': { exec: (c) => c.sh.InsertField('Time', true) },
  '.uno:InsertTimeFieldVar': { exec: (c) => c.sh.InsertField('Time') },
  '.uno:InsertGraphic': { exec: (c) => c.insertImageFromDisk() },
  '.uno:InsertFrame': { exec: (c) => { c.sh.InsertTextFrame(); } },
  '.uno:InsertFrameInteract': { exec: (c) => { c.sh.InsertTextFrame(); } },
  // Objects (frameobjectbar, Format > Wrap and Anchor menus).
  '.uno:WrapOff': wrap(WrapTextMode.NONE),
  '.uno:WrapOn': wrap(WrapTextMode.PARALLEL),
  '.uno:WrapIdeal': wrap(WrapTextMode.DYNAMIC),
  '.uno:WrapLeft': wrap(WrapTextMode.LEFT),
  '.uno:WrapRight': wrap(WrapTextMode.RIGHT),
  '.uno:WrapThrough': wrap(WrapTextMode.THROUGH, true),
  '.uno:WrapThroughTransparencyToggle': {
    exec: (c) => { c.sh.SetFlyFrameAttr({ m_aSurround: { m_eSurround: WrapTextMode.THROUGH }, m_bOpaque: !(c.sh.GetFlyFrameFormat()?.m_bOpaque ?? true) }); },
    checked: (c) => flyFree(c) && c.sh.GetFlyFrameFormat()?.m_bOpaque === false, enabled: flyFree,
  },
  '.uno:SetObjectToForeground': { exec: (c) => { c.sh.SetFlyFrameAttr({ m_bOpaque: true }); }, enabled: (c) => flyFree(c) && c.sh.GetFlyFrameFormat()?.m_bOpaque === false },
  '.uno:SetObjectToBackground': { exec: (c) => { c.sh.SetFlyFrameAttr({ m_bOpaque: false }); }, enabled: (c) => flyFree(c) && c.sh.GetFlyFrameFormat()?.m_bOpaque !== false },
  '.uno:SetAnchorToPage': anchor(RndStdIds.FLY_AT_PAGE),
  '.uno:SetAnchorToPara': anchor(RndStdIds.FLY_AT_PARA),
  '.uno:SetAnchorAtChar': anchor(RndStdIds.FLY_AT_CHAR),
  '.uno:SetAnchorToChar': anchor(RndStdIds.FLY_AS_CHAR),
  '.uno:ObjectAlignLeft': objAlign(HoriOrientation.LEFT, null),
  '.uno:AlignCenter': objAlign(HoriOrientation.CENTER, null),
  '.uno:ObjectAlignRight': objAlign(HoriOrientation.RIGHT, null),
  '.uno:AlignUp': objAlign(null, VertOrientation.TOP),
  '.uno:AlignMiddle': objAlign(null, VertOrientation.CENTER),
  '.uno:AlignDown': objAlign(null, VertOrientation.BOTTOM),
  '.uno:BringToFront': order(1, true),
  '.uno:ObjectForwardOne': order(1, false),
  '.uno:ObjectBackOne': order(-1, false),
  '.uno:SendToBack': order(-1, true),
  '.uno:GraphicDialog': { exec: (c) => c.setDialog('fly'), enabled: (c) => flySel(c) && c.sh.GetFlyFrameFormat()?.graphic !== undefined },
  '.uno:FrameDialog': { exec: (c) => c.setDialog('fly'), enabled: (c) => flySel(c) && c.sh.GetFlyFrameFormat()?.m_sContentId !== undefined },
  '.uno:ControlCodes': { exec: (c) => { c.showControlCodes = !c.showControlCodes; c.notify(); }, checked: (c) => c.showControlCodes },
  '.uno:FormatPaintbrush': {
    exec: (c) => { c.formatClipboard = c.formatClipboard ? null : c.sh.CopyFormat(); c.notify(); },
    checked: (c) => !!c.formatClipboard,
  },
  '.uno:CharmapControl': { exec: (c) => c.setDialog('specialchar') },
  '.uno:InsertSymbol': { exec: (c) => c.setDialog('specialchar') },
  '.uno:InsertFootnote': { exec: (c) => c.sh.InsertFootnote(), enabled: (c) => !c.sh.IsInHeaderFooter() },
  '.uno:JumpToFootnoteOrAnchor': { exec: (c) => { c.sh.GotoFootnoteOrAnchor(); } },
  '.uno:InsertAnnotation': {
    exec: (c) => {
      const id = c.sh.InsertPostIt(c.author);
      if (!c.sh.m_pRoot.m_bShowComments) { c.sh.m_pRoot.m_bShowComments = true; c.sh.m_pRoot.Layout(); }
      c.notify();
      setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-comment="${id}"]`)?.focus(), 0);
    },
  },
  '.uno:DeleteComment': { exec: (c) => c.sh.m_pDoc.DeleteAnnotations(c.sh.m_pCursor, [c.sh.GetCurrentPostIt()!.id]), enabled: (c) => !!c.sh.GetCurrentPostIt() },
  '.uno:DeleteAllNotes': { exec: (c) => c.sh.m_pDoc.DeleteAnnotations(c.sh.m_pCursor), enabled: (c) => c.sh.m_pRoot.m_aAnnotationAnchors.length > 0 },
  '.uno:ResolveComment': {
    exec: (c) => { const f = c.sh.GetCurrentPostIt()!; c.sh.m_pDoc.SetAnnotation(f.id, { resolved: !f.resolved }); },
    enabled: (c) => !!c.sh.GetCurrentPostIt(), checked: (c) => !!c.sh.GetCurrentPostIt()?.resolved,
  },
  '.uno:ShowAnnotations': {
    exec: (c) => { const r = c.sh.m_pRoot; r.m_bShowComments = !r.m_bShowComments; c.notify(); },
    checked: (c) => c.sh.m_pRoot.m_bShowComments,
  },
  '.uno:ShowResolvedAnnotations': { exec: (c) => { c.showResolvedComments = !c.showResolvedComments; c.notify(); }, checked: (c) => c.showResolvedComments },
  '.uno:OptionsTreeDialog': { exec: (c) => c.setDialog('options') },
  '.uno:DefaultCharStyle': { exec: (c) => c.sh.SetCharFormat(null), checked: (c) => c.sh.GetCharFormatName() === null },
  '.uno:EmphasisCharStyle': charStyle('Emphasis'),
  '.uno:StrongEmphasisCharStyle': charStyle('Strong Emphasis'),
  '.uno:QuoteCharStyle': charStyle('Citation'),
  '.uno:SourceCharStyle': charStyle('Source Text'),
  '.uno:InsertMultiIndex': { exec: (c) => c.setDialog('toc') },
  '.uno:UpdateCurIndex': { exec: (c) => c.sh.UpdateTableOf(c.sh.GetCurTOX()), enabled: (c) => !!c.sh.GetCurTOX() },
  '.uno:UpdateAllIndexes': { exec: (c) => c.sh.UpdateAllTableOf() },
  '.uno:EditStyle': { exec: (c) => c.setDialog('style') },
  '.uno:StyleNewByExample': { exec: (c) => c.setDialog('newstyle') },
  '.uno:StyleUpdateByExample': { exec: (c) => c.sh.m_pDoc.UpdateCollByExample(c.sh.m_pCursor, c.sh.CopyFormat().chars) },
  '.uno:InsertTable': { exec: (c) => c.setDialog('table') },
  '.uno:InsertRowsBefore': tableCmd((c) => c.sh.InsertRow(false)),
  '.uno:InsertRowsAfter': tableCmd((c) => c.sh.InsertRow(true)),
  '.uno:InsertColumnsBefore': tableCmd((c) => c.sh.InsertCol(false)),
  '.uno:InsertColumnsAfter': tableCmd((c) => c.sh.InsertCol(true)),
  '.uno:DeleteRows': tableCmd((c) => c.sh.DeleteRow()),
  '.uno:DeleteColumns': tableCmd((c) => c.sh.DeleteCol()),
  '.uno:DeleteTable': tableCmd((c) => c.sh.DeleteTable()),
  '.uno:SelectTable': tableCmd((c) => { c.sh.SelTable(); c.notify(); }),
  '.uno:DefaultBullet': { exec: (c) => c.sh.ToggleNum(false), checked: (c) => c.sh.SelectionHasBullet() },
  '.uno:DefaultNumbering': { exec: (c) => c.sh.ToggleNum(true), checked: (c) => c.sh.SelectionHasNumber() },
  '.uno:RemoveBullets': { exec: (c) => c.sh.DelNumRules(), enabled: inList },
  '.uno:DecrementLevel': { exec: (c) => { c.sh.NumUpDown(true); }, enabled: (c) => inList(c) && c.sh.GetNumLevel() < 9 },
  '.uno:IncrementLevel': { exec: (c) => { c.sh.NumUpDown(false); }, enabled: (c) => inList(c) && c.sh.GetNumLevel() > 0 },
  '.uno:NumberingStart': { exec: (c) => c.sh.SetNumRuleStart(!c.sh.IsNumRuleStart()), enabled: inList, checked: (c) => c.sh.IsNumRuleStart() },
  '.uno:BulletListStyle': listStyle('List 1'),
  '.uno:NumberListStyle': listStyle('Numbering 123'),
  '.uno:AlphaListStyle': listStyle('Numbering ABC'),
  '.uno:AlphaLowListStyle': listStyle('Numbering abc'),
  '.uno:RomanListStyle': listStyle('Numbering IVX'),
  '.uno:RomanLowListStyle': listStyle('Numbering ivx'),
  '.uno:Heading1ParaStyle': heading('Heading 1'),
  '.uno:Heading2ParaStyle': heading('Heading 2'),
  '.uno:Heading3ParaStyle': heading('Heading 3'),
  '.uno:TextBodyParaStyle': heading('Text Body'),
  '.uno:TitleParaStyle': heading('Title'),
  '.uno:SubtitleParaStyle': heading('Subtitle'),
  '.uno:QuoteParaStyle': heading('Quotations'),
  '.uno:PreformattedParaStyle': heading('Preformatted Text'),
};

export function dispatch(c: Controller, name: string): boolean {
  const cmd = COMMANDS[name.split('?')[0]!];
  if (!cmd || (cmd.enabled && !cmd.enabled(c))) return false;
  void Promise.resolve(cmd.exec(c)).catch((e: Error) => c.setMessage(e.message));
  return true;
}
