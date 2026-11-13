// `.uno:` command dispatch. Keys are upstream's command names, so menus, toolbars and shortcuts
// generated from upstream light up as soon as a command is registered here.
import { CHAR_HARDBLANK, CHAR_HARDHYPHEN, CHAR_LRM, CHAR_NNBSP, CHAR_RLM, CHAR_SOFTHYPHEN, CHAR_WJ, CHAR_ZWSP } from '@lo/sw/source/core/text/itrform2.ts';
import { CreateAutoContour } from '@lo/svx/source/dialog/_contdlg.ts';
import type { SwGrfAttr } from '@lo/sw/inc/hintids.ts';
import { TableMergeErr } from '@lo/sw/inc/doc.ts';
import { t } from './i18n.ts';
import { GetFormatIndex_1000DEC2, GetStandardFormat, SvNumFormatType } from '@lo/svl/source/numbers/zforlist.ts';
import type { GraphicDrawMode } from '@lo/drawinglayer/source/primitive2d/graphicprimitivehelper2d.ts';
import type { Controller } from './controller.ts';
import { printDocument } from './print.ts';
import { fromColorInt, lastColor, rememberColor, type ColorKind } from './colors.ts';
import { HoriOrientation, RndStdIds, VertOrientation, WrapTextMode } from '@lo/sw/inc/frmfmt.ts';
import { GetCustomShapeContent } from '@lo/svx/source/customshapes/EnhancedCustomShapeGeometry.ts';
import { TransliterationFlags } from '@lo/i18npool/source/transliteration/transliteration_body.ts';
import { MAXLEVEL } from '@lo/sw/inc/numrule.ts';
import { RotateTransliteration } from '@lo/unotools/source/i18n/caserotate.ts';
import upstreamUi from './generated/upstream-ui.json';

export interface Command {
  /** `args` are the dispatch's arguments (a toolbar control's value), as upstream's request items. */
  exec(c: Controller, args?: Record<string, number>): void | Promise<void>;
  /** Toggle state for toolbar buttons and menu checkmarks. */
  checked?(c: Controller): boolean;
  enabled?(c: Controller): boolean;
}

const hasUndo = (c: Controller) => c.sh.m_pDoc.m_aUndo.length > 0;
const hasRedo = (c: Controller) => c.sh.m_pDoc.m_aRedo.length > 0;
const hasSel = (c: Controller) => c.sh.HasSelection();
/** SwView's state for Cut and Copy: text or an object is selected. */
const hasSelOrObj = (c: Controller) => c.sh.HasSelection() || c.sh.IsFrameSelected();
/** Copies or cuts the selected object to the system clipboard (the menus' path; shortcuts stay native). */
const writeFly = async (c: Controller, cut: boolean) => {
  const out = c.copyFly(false);
  if (!out) return;
  await navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([out.html], { type: 'text/html' }),
    'text/plain': new Blob([out.text], { type: 'text/plain' }),
  })]);
  if (cut) c.sh.DelSelectedFly();
};
const ESC = 33;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const FONT_STEP = 20; // 1pt, in twips
const INDENT_STEP = 567; // 1 cm, in twips
const PARA_STEP = 100; // about 0.18 cm, in twips

const toggle = (key: 'RES_CHRATR_WEIGHT' | 'RES_CHRATR_POSTURE' | 'RES_CHRATR_CROSSEDOUT' | 'RES_CHRATR_SHADOWED' | 'RES_CHRATR_CONTOUR'): Command => ({
  exec: (c) => c.sh.SetCharAttr({ [key]: !c.sh.GetAttr(key) }),
  checked: (c) => c.sh.GetAttr(key),
});

/** SwTextShell::ExecTransliteration: Format > Text > Change Case. */
const transliterate = (mode: TransliterationFlags): Command => ({ exec: (c) => c.sh.TransliterateText(mode) });
/** SwTextShell's m_aRotateCase. */
const aRotateCase = new RotateTransliteration();

/**
 * SwView's SID_ALIGN_ANY_TOP, _VCENTER and _BOTTOM: in text the table cell's vertical alignment
 * (SID_TABLE_VERT_*), for a selected object its vertical alignment (SID_OBJECT_ALIGN_*).
 */
const alignAny = (cell: 'top' | 'center' | 'bottom', obj: number): Command => {
  const object = objAlign(null, obj);
  return {
    exec: (c) => (flySel(c) ? object.exec(c) : c.sh.SetBoxAlign(cell)),
    checked: (c) => (flySel(c) ? object.checked!(c) : c.sh.GetBoxAlign() === cell),
    enabled: (c) => (flySel(c) ? object.enabled!(c) : inTable(c)),
  };
};

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

const hasRedlines = (c: Controller) => c.sh.GetRedlineTable().length > 0;
const hasRedlineAt = (c: Controller) => c.sh.m_pDoc.m_pDocumentRedlineManager.GetRedlinesAt(c.sh.m_pCursor).length > 0;
const flySel = (c: Controller) => c.sh.IsFrameSelected();
/** Anchored (not as-character) selected objects: the ones wrap and position apply to. */
const flyFree = (c: Controller) => flySel(c) && c.sh.GetAnchorId() !== RndStdIds.FLY_AS_CHAR;
/** A graphic is selected (SwGrfShell). */
const grfSel = (c: Controller) => flySel(c) && c.sh.GetFlyFrameFormat()?.graphic !== undefined;
/** SwTableShell::ExecNumberFormat: the language's standard format of a type for the selected boxes. */
const numberFormat = (eType: SvNumFormatType): Command => ({
  exec: (c) => { c.sh.SetTableBoxFormulaAttrs({ numFormat: GetStandardFormat(eType, c.sh.GetAttr('RES_CHRATR_LANGUAGE') || 'en-US') }); c.notify(); },
  enabled: inTable,
});
/** sw optimizetablebar.xml */
export const OPTIMIZE_TABLE = ['.uno:SetMinimalRowHeight', '.uno:SetMinimalColumnWidth', '.uno:SetOptimalRowHeight', '.uno:SetOptimalColumnWidth', '.uno:DistributeRows', '.uno:DistributeColumns'];
const pct = (v: number) => Math.max(-100, Math.min(100, Math.round(v)));
/** A colour attribute command: its argument (named as the command) is the control's value. */
const grfAttr = (arg: string, attr: (v: number) => SwGrfAttr): Command => ({
  exec: (c, args) => { const v = args?.[arg]; if (v !== undefined && Number.isFinite(v)) { c.sh.SetGrfAttr(attr(v)); c.notify(); } },
  enabled: grfSel,
});
/** A drawing shape is selected (SwDrawShell). */
const shapeSel = (c: Controller) => flySel(c) && !!c.sh.GetFlyFrameFormat()?.m_pShape;
const wrap = (mode: WrapTextMode, opaque?: boolean): Command => ({
  exec: (c) => { c.sh.SetFlyFrameAttr({ m_aSurround: { ...c.sh.GetFlyFrameFormat()!.m_aSurround, m_eSurround: mode }, ...(opaque !== undefined ? { m_bOpaque: opaque } : {}) }); },
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
  // The web shell's New > Template: a blank text template (.ott).
  'app:NewTemplate': { exec: (c) => c.newTemplate() },
  '.uno:OpenFromWriter': { exec: (c) => c.setDialog('documents') },
  '.uno:Open': { exec: (c) => c.setDialog('documents') },
  // With autosave, every change is in the browser already: Save keeps the state as a version
  // (and writes the file on disk, if one is attached).
  '.uno:Save': { exec: (c) => c.saveCommand() },
  // Save a Copy and Export are, in a browser, downloads: the web shell names them File > Download
  // as File (the document's own format, at once) and Download As (another format, from a dialog).
  '.uno:SaveACopy': { exec: (c) => c.download(c.name, c.fileFormat()) },
  '.uno:ExportTo': { exec: (c) => c.setDialog('download') },
  // Save As, where the browser has a save dialog: File > Save to Computer, which links the file.
  '.uno:SaveAs': { exec: (c) => c.saveToComputer() },
  // SID_VERSION: File > Versions (SfxObjectShell::ExecFile_Impl, SfxVersionDialog).
  '.uno:VersionDialog': { exec: (c) => c.setDialog('versions') },
  // The web shell's File > Download without Version History: Download, leaving out File > Versions.
  'app:DownloadNoVersions': { exec: (c) => c.downloadWithoutVersions(), enabled: (c) => (c.fileFormat() === 'odt' || c.fileFormat() === 'ott') && c.versions.length > 0 },
  // The web shell's File > Create Copy: store a copy of the document in the browser under a new name.
  'app:CreateCopy': { exec: (c) => c.setDialog('createcopy') },
  // The web shell's File > Clear Data: delete everything stored in this browser, after a warning.
  'app:ClearData': { exec: (c) => c.setDialog('cleardata') },
  // The web shell's File > Autosave: store every change in the browser at once.
  'app:AutoSave': { exec: (c) => c.setAutoSave(!c.autoSave), checked: (c) => c.autoSave },
  'app:MenuClassic': { exec: (c) => c.setUiMode('classic'), checked: (c) => c.uiMode === 'classic' },
  'app:MenuRibbon': { exec: (c) => c.setUiMode('ribbon'), checked: (c) => c.uiMode === 'ribbon' },
  '.uno:Print': { exec: (c) => printDocument(c) },
  // The AutoCorrect configuration goes along: undoing a correction may add an exception (AutoInclude).
  '.uno:Undo': { exec: (c) => c.sh.Undo(c.acorr), enabled: hasUndo },
  '.uno:Redo': { exec: (c) => c.sh.Redo(), enabled: hasRedo },
  '.uno:Cut': {
    enabled: hasSelOrObj,
    exec: async (c) => {
      if (c.sh.IsFrameSelected()) { await writeFly(c, true); return; }
      await navigator.clipboard.writeText(c.sh.GetSelText());
      c.sh.DelSelection();
    },
  },
  '.uno:Copy': { enabled: hasSelOrObj, exec: (c) => (c.sh.IsFrameSelected() ? writeFly(c, false) : navigator.clipboard.writeText(c.sh.GetSelText())) },
  '.uno:Paste': {
    exec: async (c) => {
      // SwTransferable::Paste: the copied object, then a picture, then text.
      try {
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes('text/html') && c.pasteFly(await (await item.getType('text/html')).text())) return;
          const image = item.types.find((ty) => ty.startsWith('image/'));
          if (image) { await c.insertImageFile(await item.getType(image)); return; }
        }
      } catch { /* Reading anything but text may be refused; text follows. */ }
      c.sh.Paste(await navigator.clipboard.readText());
    },
  },
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
  '.uno:Shadowed': toggle('RES_CHRATR_SHADOWED'),
  '.uno:OutlineFont': toggle('RES_CHRATR_CONTOUR'),
  '.uno:Overline': {
    exec: (c) => c.sh.SetCharAttr({ RES_CHRATR_OVERLINE: c.sh.GetAttr('RES_CHRATR_OVERLINE') === 'none' ? 'single' : 'none' }),
    checked: (c) => c.sh.GetAttr('RES_CHRATR_OVERLINE') !== 'none',
  },
  // SID_ATTR_CHAR_CASEMAP with SvxCaseMap::SmallCaps.
  '.uno:SmallCaps': {
    exec: (c) => c.sh.SetCharAttr({ RES_CHRATR_CASEMAP: c.sh.GetAttr('RES_CHRATR_CASEMAP') === 'smallcaps' ? 'none' : 'smallcaps' }),
    checked: (c) => c.sh.GetAttr('RES_CHRATR_CASEMAP') === 'smallcaps',
  },
  '.uno:ChangeCaseToUpper': transliterate(TransliterationFlags.LOWERCASE_UPPERCASE),
  '.uno:ChangeCaseToLower': transliterate(TransliterationFlags.UPPERCASE_LOWERCASE),
  '.uno:ChangeCaseToSentenceCase': transliterate(TransliterationFlags.SENTENCE_CASE),
  '.uno:ChangeCaseToTitleCase': transliterate(TransliterationFlags.TITLE_CASE),
  '.uno:ChangeCaseToToggleCase': transliterate(TransliterationFlags.TOGGLE_CASE),
  '.uno:ChangeCaseToHalfWidth': transliterate(TransliterationFlags.FULLWIDTH_HALFWIDTH),
  '.uno:ChangeCaseToFullWidth': transliterate(TransliterationFlags.HALFWIDTH_FULLWIDTH),
  '.uno:ChangeCaseToHiragana': transliterate(TransliterationFlags.KATAKANA_HIRAGANA),
  '.uno:ChangeCaseToKatakana': transliterate(TransliterationFlags.HIRAGANA_KATAKANA),
  // SwTextShell::ExecRotateTransliteration (Shift+F3): sentence case needs more than one word.
  '.uno:ChangeCaseRotateCase': {
    exec: (c) => {
      let mode = aRotateCase.getNextMode();
      const bSentenceCase = mode === TransliterationFlags.SENTENCE_CASE;
      if (c.sh.HasSelection()) {
        const sel = c.sh.GetSelText().trim();
        if (bSentenceCase && (sel.length <= 2 || !/[ \t]/.test(sel))) mode = aRotateCase.getNextMode();
        c.sh.TransliterateText(mode);
      } else {
        if (bSentenceCase) mode = aRotateCase.getNextMode();
        c.sh.SelWrd();
        if (c.sh.HasSelection()) c.sh.TransliterateText(mode);
      }
    },
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
  '.uno:CommonAlignTop': alignAny('top', VertOrientation.TOP),
  '.uno:CommonAlignVerticalCenter': alignAny('center', VertOrientation.CENTER),
  '.uno:CommonAlignBottom': alignAny('bottom', VertOrientation.BOTTOM),
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
  // Format > Text direction (SID_ATTR_PARA_LEFT_TO_RIGHT, SID_ATTR_PARA_RIGHT_TO_LEFT).
  '.uno:ParaLeftToRight': { exec: (c) => c.sh.SetParaDirection(false), checked: (c) => para(c).GetAttr('RES_FRAMEDIR') !== 'rl-tb' },
  '.uno:ParaRightToLeft': { exec: (c) => c.sh.SetParaDirection(true), checked: (c) => para(c).GetAttr('RES_FRAMEDIR') === 'rl-tb' },
  '.uno:InsertBreak': { exec: (c) => c.setDialog('break') },
  '.uno:InsertColumnBreak': { exec: (c) => { c.sh.SplitNode(); c.sh.SetParaAttr({ RES_BREAK: 'column-before' }); } },
  // Sections and columns (SwView: FN_INSERT_REGION, FN_EDIT_REGION, FN_FORMAT_COLUMN).
  '.uno:InsertSection': { exec: (c) => c.setDialog('section') },
  '.uno:EditRegion': { exec: (c) => c.setDialog('sections'), enabled: (c) => c.sh.m_pDoc.GetSections().length > 0 },
  '.uno:FormatColumns': { exec: (c) => c.setDialog('columns') },
  // SwTextShell::ExecInsert: Insert > Formatting Mark.
  '.uno:InsertNonBreakingSpace': { exec: (c) => c.sh.Insert(CHAR_HARDBLANK) },
  '.uno:InsertHardHyphen': { exec: (c) => c.sh.Insert(CHAR_HARDHYPHEN) },
  // Never two soft hyphens next to each other.
  '.uno:InsertSoftHyphen': { exec: (c) => { if (c.sh.GetChar() !== CHAR_SOFTHYPHEN && c.sh.GetChar(true, -1) !== CHAR_SOFTHYPHEN) c.sh.Insert(CHAR_SOFTHYPHEN); } },
  '.uno:InsertNarrowNobreakSpace': { exec: (c) => c.sh.Insert(CHAR_NNBSP) },
  '.uno:InsertZWSP': { exec: (c) => c.sh.Insert(CHAR_ZWSP) },
  '.uno:InsertWJ': { exec: (c) => c.sh.Insert(CHAR_WJ) },
  // Upstream shows these with complex text layout enabled (SvtCTLOptions::IsCTLFontEnabled), which the web shell has no option for.
  '.uno:InsertLRM': { exec: (c) => c.sh.Insert(CHAR_LRM) },
  '.uno:InsertRLM': { exec: (c) => c.sh.Insert(CHAR_RLM) },
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
  // Tools > Spelling and Automatic Spell Checking (SwView::ExecLingu, FN_ONLINE_AUTOFORMAT's sibling SID_AUTOSPELL_CHECK).
  '.uno:SpellOnline': { exec: (c) => { c.onlineSpell = !c.onlineSpell; }, checked: (c) => c.onlineSpell },
  '.uno:SpellingAndGrammarDialog': { exec: (c) => { void c.loadUsedDictionaries(true).then(() => c.setDialog('spelling')); } },
  // Tools > AutoCorrect (SwTextShell::Execute, FN_AUTOFORMAT_AUTO, FN_AUTOFORMAT_APPLY and
  // FN_AUTOFORMAT_REDLINE_APPLY; SID_AUTO_CORRECT_DLG).
  '.uno:OnlineAutoFormat': { exec: (c) => { c.autoFormatByInput = !c.autoFormatByInput; }, checked: (c) => c.autoFormatByInput },
  '.uno:AutoFormatApply': {
    exec: (c) => {
      const aFlags = c.acorr.GetSwFlags().Clone();
      // This must always be false for the postprocessing.
      aFlags.bAFormatByInput = false;
      c.sh.AutoFormat(aFlags, false);
    },
  },
  '.uno:AutoFormatRedlineApply': {
    exec: (c) => {
      const aFlags = c.acorr.GetSwFlags().Clone();
      // This must always be false for the postprocessing.
      aFlags.bAFormatByInput = false;
      aFlags.bWithRedlining = true;
      c.sh.AutoFormat(aFlags, false);
      // Upstream asks to accept, reject or review the changes (SwModalRedlineAcceptDlg): here
      // Manage Changes opens.
      c.setDialog('redlines');
    },
  },
  '.uno:AutoCorrectDlg': { exec: (c) => c.setDialog('autocorrect') },
  // Edit > Track Changes (SwView::ExecuteRedline / ExecDlg).
  '.uno:TrackChanges': { exec: (c) => c.sh.SetRedlineOn(!c.sh.IsRedlineOn()), checked: (c) => c.sh.IsRedlineOn() },
  '.uno:ShowTrackedChanges': { exec: (c) => c.sh.SetShowChanges(!c.sh.IsShowChanges()), checked: (c) => c.sh.IsShowChanges() },
  '.uno:AcceptTrackedChange': { exec: (c) => { c.sh.AcceptRejectAtCursor(true); }, enabled: hasRedlineAt },
  '.uno:RejectTrackedChange': { exec: (c) => { c.sh.AcceptRejectAtCursor(false); }, enabled: hasRedlineAt },
  '.uno:AcceptTrackedChangeToNext': { exec: (c) => { c.sh.AcceptRejectAtCursor(true); c.sh.GotoRedline(true); }, enabled: hasRedlineAt },
  '.uno:RejectTrackedChangeToNext': { exec: (c) => { c.sh.AcceptRejectAtCursor(false); c.sh.GotoRedline(true); }, enabled: hasRedlineAt },
  '.uno:AcceptAllTrackedChanges': { exec: (c) => { c.sh.AcceptRejectAll(true); }, enabled: hasRedlines },
  '.uno:RejectAllTrackedChanges': { exec: (c) => { c.sh.AcceptRejectAll(false); }, enabled: hasRedlines },
  '.uno:NextTrackedChange': { exec: (c) => { c.sh.GotoRedline(true); }, enabled: hasRedlines },
  '.uno:PreviousTrackedChange': { exec: (c) => { c.sh.GotoRedline(false); }, enabled: hasRedlines },
  '.uno:AcceptTrackedChanges': { exec: (c) => c.setDialog('redlines') },
  '.uno:InsertFrame': { exec: (c) => { c.sh.InsertTextFrame(); } },
  // Format > Frame and Object > Link Frames / Unlink Frames (SwFrameShell FN_FRAME_CHAIN, FN_FRAME_UNCHAIN).
  '.uno:ChainFrames': { exec: (c) => c.setChainMode(!c.chainMode), checked: (c) => c.chainMode, enabled: (c) => { const f = c.sh.GetFlyFrameFormat(); return !!f && f.m_sContentId !== undefined && !f.m_pShape && !f.m_aChain?.m_sNext; } },
  '.uno:UnhainFrames': { exec: (c) => c.sh.Unchain(), enabled: (c) => !!c.sh.GetFlyFrameFormat()?.m_aChain?.m_sNext },
  '.uno:InsertFrameInteract': { exec: (c) => { c.sh.InsertTextFrame(); } },
  // Objects (frameobjectbar, Format > Wrap and Anchor menus).
  '.uno:WrapOff': wrap(WrapTextMode.NONE),
  '.uno:WrapOn': wrap(WrapTextMode.PARALLEL),
  '.uno:WrapIdeal': wrap(WrapTextMode.DYNAMIC),
  '.uno:WrapLeft': wrap(WrapTextMode.LEFT),
  '.uno:WrapRight': wrap(WrapTextMode.RIGHT),
  '.uno:WrapThrough': wrap(WrapTextMode.THROUGH, true),
  // FN_WRAP_ANCHOR_ONLY: Wrap First Paragraph.
  // FN_FRAME_WRAP_CONTOUR (SwBaseShell::SetWrapMode): wrap around the graphic's contour, traced from
  // it the first time (SwNoTextNode::CreateContour); no contour without wrap or with wrap through.
  '.uno:WrapContour': {
    exec: async (c) => {
      const f = c.sh.GetFlyFrameFormat()!;
      const on = !f.m_aSurround.m_bContour;
      let contour = f.m_aContour;
      if (on && !contour?.length) {
        const b = await c.selectedBitmap();
        contour = b ? CreateAutoContour(b) : undefined;
      }
      const eOld = f.m_aSurround.m_eSurround;
      const eSurround = on && (eOld === WrapTextMode.NONE || eOld === WrapTextMode.THROUGH) ? WrapTextMode.PARALLEL : eOld;
      c.sh.SetFlyFrameAttr({ m_aSurround: { ...f.m_aSurround, m_eSurround: eSurround, m_bContour: on }, ...(on && contour?.length && !f.m_aContour?.length ? { m_aContour: contour, m_bAutoContour: true } : {}) });
      c.notify();
    },
    checked: (c) => grfSel(c) && !!c.sh.GetFlyFrameFormat()?.m_aSurround.m_bContour,
    enabled: (c) => grfSel(c) && ![WrapTextMode.NONE, WrapTextMode.THROUGH].includes(c.sh.GetFlyFrameFormat()!.m_aSurround.m_eSurround as never),
  },
  // SID_CONTOUR_DLG: the Contour Editor.
  '.uno:ContourDialog': { exec: (c) => c.setDialog('contour'), enabled: grfSel },
  '.uno:WrapAnchorOnly': {
    exec: (c) => { const f = c.sh.GetFlyFrameFormat()!; c.sh.SetFlyFrameAttr({ m_aSurround: { ...f.m_aSurround, m_bAnchorOnly: !f.m_aSurround.m_bAnchorOnly } }); },
    checked: (c) => flyFree(c) && !!c.sh.GetFlyFrameFormat()?.m_aSurround.m_bAnchorOnly,
    enabled: (c) => flyFree(c) && c.sh.GetAnchorId() === RndStdIds.FLY_AT_PARA,
  },
  // FN_FRAME_WRAP_DLG: the wrap settings, in the object's dialog.
  '.uno:TextWrap': { exec: (c) => c.setDialog('fly'), enabled: flyFree },
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
  // SwGrfShell::ExecuteRotation and the flips of SwGrfShell (SwMirrorGrf) and SwDrawShell (MirrorSelection).
  '.uno:RotateLeft': { exec: (c) => { c.sh.RotateGraphic(900); }, enabled: grfSel },
  '.uno:RotateRight': { exec: (c) => { c.sh.RotateGraphic(2700); }, enabled: grfSel },
  '.uno:Rotate180': { exec: (c) => { c.sh.RotateGraphic(1800); }, enabled: grfSel },
  '.uno:RotateReset': { exec: (c) => { c.sh.RotateGraphic(null); }, enabled: (c) => grfSel(c) && !!c.sh.GetFlyFrameFormat()?.m_nGrfRotation },
  '.uno:FlipHorizontal': { exec: (c) => { if (grfSel(c)) c.sh.MirrorGraphic(true); else c.sh.MirrorSelection(true); }, enabled: (c) => grfSel(c) || shapeSel(c) },
  '.uno:FlipVertical': { exec: (c) => { if (grfSel(c)) c.sh.MirrorGraphic(false); else c.sh.MirrorSelection(false); }, enabled: (c) => grfSel(c) || shapeSel(c) },
  // SvxGraphicFilter: Format > Image > Filter.
  '.uno:GraphicFilterInvert': { exec: (c) => c.imageFilter('.uno:GraphicFilterInvert'), enabled: grfSel },
  '.uno:GraphicFilterSmooth': { exec: (c) => c.imageFilter('.uno:GraphicFilterSmooth'), enabled: grfSel },
  '.uno:GraphicFilterSharpen': { exec: (c) => c.imageFilter('.uno:GraphicFilterSharpen'), enabled: grfSel },
  '.uno:GraphicFilterRemoveNoise': { exec: (c) => c.imageFilter('.uno:GraphicFilterRemoveNoise'), enabled: grfSel },
  '.uno:GraphicFilterSobel': { exec: (c) => c.imageFilter('.uno:GraphicFilterSobel'), enabled: grfSel },
  '.uno:GraphicFilterMosaic': { exec: (c) => c.imageFilter('.uno:GraphicFilterMosaic'), enabled: grfSel },
  '.uno:GraphicFilterRelief': { exec: (c) => c.imageFilter('.uno:GraphicFilterRelief'), enabled: grfSel },
  '.uno:GraphicFilterPoster': { exec: (c) => c.imageFilter('.uno:GraphicFilterPoster'), enabled: grfSel },
  '.uno:GraphicFilterPopart': { exec: (c) => c.imageFilter('.uno:GraphicFilterPopart'), enabled: grfSel },
  '.uno:GraphicFilterSepia': { exec: (c) => c.imageFilter('.uno:GraphicFilterSepia'), enabled: grfSel },
  '.uno:GraphicFilterSolarize': { exec: (c) => c.imageFilter('.uno:GraphicFilterSolarize'), enabled: grfSel },
  // SID_OBJECT_ROTATE: the handles rotate the selected shape or graphic.
  '.uno:ToggleObjectRotateMode': { exec: (c) => c.setRotateMode(!c.rotateMode), checked: (c) => flySel(c) && c.rotateMode, enabled: (c) => grfSel(c) || shapeSel(c) },
  // FN_NAME_SHAPE and FN_TITLE_DESCRIPTION_SHAPE.
  '.uno:NameGroup': { exec: (c) => c.setDialog('objname'), enabled: flySel },
  '.uno:ObjectTitleDescription': { exec: (c) => c.setDialog('alttext'), enabled: flySel },
  // SwGrfShell::Execute: Format > Image.
  // Cropping a rotated graphic is not ported.
  // Image colour (SwGrfShell::ExecAttr SID_ATTR_GRAF_*): the graphicobjectbar and colorbar controls.
  '.uno:GrafMode': grfAttr('GrafMode', (v) => ({ m_eDrawMode: Math.max(0, Math.min(3, Math.round(v))) as GraphicDrawMode })),
  '.uno:GrafRed': grfAttr('GrafRed', (v) => ({ m_nChannelR: pct(v) })),
  '.uno:GrafGreen': grfAttr('GrafGreen', (v) => ({ m_nChannelG: pct(v) })),
  '.uno:GrafBlue': grfAttr('GrafBlue', (v) => ({ m_nChannelB: pct(v) })),
  '.uno:GrafLuminance': grfAttr('GrafLuminance', (v) => ({ m_nLuminance: pct(v) })),
  '.uno:GrafContrast': grfAttr('GrafContrast', (v) => ({ m_nContrast: pct(v) })),
  // SID_ATTR_GRAF_GAMMA: hundredths, 0.10 to 10.00.
  '.uno:GrafGamma': grfAttr('GrafGamma', (v) => ({ m_fGamma: Math.max(10, Math.min(1000, Math.round(v))) / 100 })),
  '.uno:GrafTransparence': grfAttr('GrafTransparence', (v) => ({ m_nTransparency: Math.max(0, Math.min(100, Math.round(v))) })),
  // SID_COLOR_SETTINGS: shows or hides the colorbar.
  '.uno:ColorSettings': { exec: (c) => { c.showColorBar = !c.showColorBar; c.notify(); }, checked: (c) => c.showColorBar, enabled: grfSel },
  '.uno:Crop': { exec: (c) => c.setCropMode(!c.cropMode), checked: (c) => grfSel(c) && c.cropMode, enabled: (c) => grfSel(c) && !c.sh.GetFlyFrameFormat()?.m_nGrfRotation },
  '.uno:ChangePicture': { exec: (c) => c.replaceImageFromDisk(), enabled: grfSel },
  '.uno:SaveGraphic': { exec: (c) => c.saveImage(), enabled: grfSel },
  '.uno:CompressGraphic': { exec: (c) => c.setDialog('compress'), enabled: grfSel },
  '.uno:FrameDialog': { exec: (c) => c.setDialog('fly'), enabled: (c) => flySel(c) && c.sh.GetFlyFrameFormat()?.m_sContentId !== undefined && !c.sh.GetFlyFrameFormat()?.m_pShape },
  // The drawing object's dialogs (SwDrawBaseShell::Execute): position and size, area, line.
  '.uno:TransformDialog': { exec: (c) => c.setDialog('fly'), enabled: (c) => flySel(c) && !!c.sh.GetFlyFrameFormat()?.m_pShape },
  '.uno:FormatArea': { exec: (c) => c.setDialog('fly'), enabled: (c) => flySel(c) && !!c.sh.GetFlyFrameFormat()?.m_pShape },
  '.uno:FormatLine': { exec: (c) => c.setDialog('fly'), enabled: (c) => flySel(c) && !!c.sh.GetFlyFrameFormat()?.m_pShape },
  // View > Spotlight (SwView::ExecViewOptions: SID_SPOTLIGHT_CHAR_DF, _PARASTYLES, _CHARSTYLES).
  '.uno:HighlightCharDF': { exec: (c) => { c.sh.m_aSpotlight.charDF = !c.sh.m_aSpotlight.charDF; c.notify(); }, checked: (c) => c.sh.m_aSpotlight.charDF },
  '.uno:SpotlightParaStyles': { exec: (c) => { c.sh.m_aSpotlight.paraStyles = !c.sh.m_aSpotlight.paraStyles; c.notify(); }, checked: (c) => c.sh.m_aSpotlight.paraStyles },
  '.uno:SpotlightCharStyles': { exec: (c) => { c.sh.m_aSpotlight.charStyles = !c.sh.m_aSpotlight.charStyles; c.notify(); }, checked: (c) => c.sh.m_aSpotlight.charStyles },
  '.uno:ControlCodes': { exec: (c) => { c.showControlCodes = !c.showControlCodes; c.notify(); }, checked: (c) => c.showControlCodes },
  '.uno:FormatPaintbrush': {
    exec: (c) => { c.formatClipboard = c.formatClipboard ? null : c.sh.CopyFormat(); c.notify(); },
    checked: (c) => !!c.formatClipboard,
  },
  '.uno:CharmapControl': { exec: (c) => c.setDialog('specialchar') },
  '.uno:InsertSymbol': { exec: (c) => c.setDialog('specialchar') },
  '.uno:InsertFootnote': { exec: (c) => c.sh.InsertFootnote(), enabled: (c) => !c.sh.IsInHeaderFooter() },
  '.uno:InsertEndnote': { exec: (c) => c.sh.InsertFootnote(true), enabled: (c) => !c.sh.IsInHeaderFooter() },
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
  // Table > Select (SwTableShell FN_TABLE_SELECT_CELL, FN_TABLE_SELECT_ROW, FN_TABLE_SELECT_COL).
  '.uno:EntireCell': tableCmd((c) => { c.sh.SelTableBox(); c.notify(); }),
  '.uno:EntireRow': tableCmd((c) => { c.sh.SelTableRow(); c.notify(); }),
  '.uno:EntireColumn': tableCmd((c) => { c.sh.SelTableCol(); c.notify(); }),
  // FN_TABLE_INSERT_ROW_DLG and FN_TABLE_INSERT_COL_DLG
  '.uno:InsertRowDialog': { exec: (c) => c.setDialog('insrows'), enabled: inTable },
  '.uno:InsertColumnDialog': { exec: (c) => c.setDialog('inscols'), enabled: inTable },
  // FN_TABLE_MERGE_CELLS: only for a selection of several cells.
  '.uno:MergeCells': {
    exec: (c) => { if (c.sh.MergeTab() === TableMergeErr.TooComplex) c.setMessage(t('table.mergeTooComplex')); c.notify(); },
    enabled: (c) => c.sh.IsTableMode(),
  },
  // FN_TABLE_SPLIT_CELLS
  '.uno:SplitCell': { exec: (c) => c.setDialog('splitcells'), enabled: inTable },
  // FN_TABLE_MERGE_TABLE: with the only neighbour, or asks which one.
  '.uno:MergeTable': {
    exec: (c) => { const m = c.sh.CanMergeTable(); if (m.prev && m.next) c.setDialog('mergetable'); else { c.sh.MergeTable(m.prev); c.notify(); } },
    enabled: (c) => { const m = c.sh.CanMergeTable(); return m.prev || m.next; },
  },
  // Table > Size (SwTableShell): SID_TABLE_MINIMAL_ROW_HEIGHT, FN_TABLE_OPTIMAL_HEIGHT, FN_TABLE_BALANCE_ROWS, ...
  '.uno:SetRowHeight': { exec: (c) => c.setDialog('rowheight'), enabled: inTable },
  '.uno:SetMinimalRowHeight': tableCmd((c) => { c.sh.SetRowHeight(0, false); c.notify(); }),
  '.uno:SetOptimalRowHeight': tableCmd((c) => { c.sh.BalanceRowHeight(false, true); c.sh.BalanceRowHeight(false, false); c.notify(); }),
  '.uno:DistributeRows': { exec: (c) => { if (c.sh.BalanceRowHeight(true)) c.sh.BalanceRowHeight(false); c.notify(); }, enabled: (c) => c.sh.BalanceRowHeight(true) },
  '.uno:SetColumnWidth': { exec: (c) => c.setDialog('colwidth'), enabled: inTable },
  '.uno:SetMinimalColumnWidth': tableCmd((c) => { c.sh.AdjustCellWidth(false, false); c.notify(); }),
  '.uno:SetOptimalColumnWidth': tableCmd((c) => { c.sh.AdjustCellWidth(false, true); c.notify(); }),
  // IsAdjustCellWidthAllowed(bBalance): distributing needs more than one column.
  '.uno:DistributeColumns': { exec: (c) => { c.sh.AdjustCellWidth(true, false); c.notify(); }, enabled: (c) => c.sh.IsTableMode() && new Set(c.sh.GetTableSelBoxes().map((b) => b.m_pUpper.m_aBoxes.indexOf(b))).size > 1 },
  // FN_TABLE_HEADLINE_REPEAT: off, or on for the rows selected from the top.
  '.uno:HeadingRowsRepeat': {
    exec: (c) => { c.sh.SetRowsToRepeat(c.sh.GetRowsToRepeat() ? 0 : c.sh.GetRowSelectionFromTop()); c.notify(); },
    checked: (c) => c.sh.GetRowsToRepeat() > 0, enabled: (c) => inTable(c) && (c.sh.GetRowsToRepeat() > 0 || c.sh.GetRowSelectionFromTop() > 0),
  },
  // FN_TABLE_ROW_SPLIT
  '.uno:RowSplit': { exec: (c) => { c.sh.SetRowSplit(!c.sh.GetRowSplit()); c.notify(); }, checked: (c) => inTable(c) && c.sh.GetRowSplit() === true, enabled: inTable },
  // FN_TABLE_SET_READ_ONLY_CELLS and FN_TABLE_UNSET_READ_ONLY_CELLS
  '.uno:Protect': tableCmd((c) => { c.sh.ProtectCells(true); c.notify(); }),
  '.uno:UnsetCellsReadOnly': { exec: (c) => { c.sh.ProtectCells(false); c.notify(); }, enabled: (c) => inTable(c) && c.sh.CanUnProtectCells() },
  // SID_TABLE_VERT_NONE, SID_TABLE_VERT_CENTER, SID_TABLE_VERT_BOTTOM
  '.uno:CellVertTop': { exec: (c) => { c.sh.SetBoxAlign('top'); c.notify(); }, checked: (c) => c.sh.GetBoxAlign() === 'top', enabled: inTable },
  '.uno:CellVertCenter': { exec: (c) => { c.sh.SetBoxAlign('center'); c.notify(); }, checked: (c) => c.sh.GetBoxAlign() === 'center', enabled: inTable },
  '.uno:CellVertBottom': { exec: (c) => { c.sh.SetBoxAlign('bottom'); c.notify(); }, checked: (c) => c.sh.GetBoxAlign() === 'bottom', enabled: inTable },
  // SID_ATTR_CHAR_COLOR and SID_ATTR_CHAR_BACK_COLOR: the colour as 0xRRGGBB, -1 for Automatic
  // (COL_AUTO) or no highlighting (COL_TRANSPARENT); without one, the colour chosen last.
  '.uno:Color': { exec: (c, args) => setCharColor(c, 'font', args?.Color) },
  '.uno:CharBackColor': { exec: (c, args) => setCharColor(c, 'highlight', args?.CharBackColor) },
  // SID_TABLE_CELL_BACKGROUND_COLOR: the colour as 0xRRGGBB, -1 for none (the toolbar's colour control).
  '.uno:TableCellBackgroundColor': {
    exec: (c, args) => { const v = args?.TableCellBackgroundColor; if (v === undefined) return; c.sh.SetBoxBackground(v < 0 ? null : `#${v.toString(16).padStart(6, '0')}`); c.notify(); },
    enabled: inTable,
  },
  // Table > AutoFormat Styles (SID_AUTOFORMAT, SwAutoFormatDlg)
  '.uno:AutoFormat': { exec: (c) => c.setDialog('autoformat'), enabled: inTable },
  // Table > Convert (FN_CONVERT_TEXT_TABLE, FN_CONVERT_TABLE_TEXT): text needs a selection outside tables.
  '.uno:ConvertTextToTable': { exec: (c) => c.setDialog('texttotable'), enabled: (c) => c.sh.HasSelection() && !c.sh.IsCursorInTable() },
  '.uno:ConvertTableToText': { exec: (c) => c.setDialog('tabletotext'), enabled: inTable },
  // FN_TABLE_SORT_DIALOG: a selection in a table.
  '.uno:TableSort': { exec: (c) => c.setDialog('tablesort'), enabled: (c) => c.sh.HasSelection() && inTable(c) },
  // Number formats (SwTableShell: FN_NUMBER_STANDARD … FN_NUMBER_TWODEC): the standard format of a type.
  '.uno:NumberFormatStandard': numberFormat(SvNumFormatType.NUMBER),
  '.uno:NumberFormatCurrency': numberFormat(SvNumFormatType.CURRENCY),
  '.uno:NumberFormatPercent': numberFormat(SvNumFormatType.PERCENT),
  '.uno:NumberFormatDate': numberFormat(SvNumFormatType.DATE),
  '.uno:NumberFormatDecimal': { exec: (c) => { c.sh.SetTableBoxFormulaAttrs({ numFormat: GetFormatIndex_1000DEC2() }); c.notify(); }, enabled: inTable },
  // FN_NUM_FORMAT_TABLE_DLG
  '.uno:TableNumberFormatDialog': { exec: (c) => c.setDialog('numformat'), enabled: inTable },
  // FN_SET_MODOPT_TBLNUMFMT
  '.uno:TableNumberRecognition': { exec: (c) => { c.numberRecognition = !c.numberRecognition; }, checked: (c) => c.numberRecognition },
  // FN_EDIT_FORMULA: the input window with the box's formula; FN_TABLE_AUTOSUM with a sum of the boxes above or left.
  '.uno:InsertFormula': { exec: (c) => { c.formulaBar = { text: c.sh.GetTableBoxFormula() ?? '=' }; c.notify(); }, enabled: inTable },
  '.uno:AutoSum': { exec: (c) => { c.formulaBar = { text: `=${c.sh.GetAutoSum()}` }; c.notify(); }, enabled: inTable },
  // The table toolbar's popups: SvxFrameToolBoxControl (the arrangement presets 1 … 12 of
  // SvxFrameWindow_Impl, a thin black line), SvxLineStyleToolBoxControl and the line colour.
  '.uno:SetBorderStyle': {
    exec: (c, args) => {
      const n = args?.SetBorderStyle;
      if (!n) return;
      const L = { color: '#000000', width: 15 }; // SvxBorderLineWidth::Thin
      const presets: Record<number, Parameters<typeof c.sh.SetTabBorders>[0]> = {
        1: { left: null, right: null, top: null, bottom: null, hori: null, vert: null },
        2: { left: L }, 3: { right: L }, 4: { left: L, right: L }, 5: { top: L }, 6: { bottom: L }, 7: { top: L, bottom: L },
        8: { left: L, right: L, top: L, bottom: L },
        9: { top: L, bottom: L, hori: L },
        10: { left: L, right: L, top: L, bottom: L, hori: L },
        11: { left: L, right: L, top: L, bottom: L, vert: L },
        12: { left: L, right: L, top: L, bottom: L, hori: L, vert: L },
      };
      if (presets[n]) { c.sh.SetTabBorders(presets[n]!); c.notify(); }
    },
    enabled: inTable,
  },
  '.uno:LineStyle': { exec: (c, args) => { const w = args?.LineStyle; if (w) { c.sh.SetTabLineStyle({ width: w }); c.notify(); } }, enabled: inTable },
  '.uno:FrameLineColor': { exec: (c, args) => { const v = args?.FrameLineColor; if (v !== undefined) { c.sh.SetTabLineStyle({ color: `#${v.toString(16).padStart(6, '0')}` }); c.notify(); } }, enabled: inTable },
  // The Optimize popup (the size commands of the optimizetablebar toolbar), by its index.
  '.uno:OptimizeTable': { exec: (c, args) => { const cmd = OPTIMIZE_TABLE[args?.OptimizeTable ?? -1]; if (cmd) dispatch(c, cmd); }, enabled: inTable },
  // FN_FORMAT_TABLE_DLG
  '.uno:TableDialog': { exec: (c) => c.setDialog('tableprops'), enabled: inTable },
  // FN_TABLE_SPLIT_TABLE: not in the first row.
  // FN_INSERT_CAPTION: captions of tables (SwLabelType::Table); objects and frames are not ported.
  '.uno:InsertCaptionDialog': { exec: (c) => c.setDialog('caption'), enabled: inTable },
  // Insert > Object > Formula Object: the formula editor; with a formula selected it edits that one.
  '.uno:InsertObjectStarMath': { exec: (c) => c.setDialog('formula') },
  '.uno:SplitTable': { exec: (c) => c.setDialog('splittable'), enabled: (c) => c.sh.GetTableRow() > 0 },
  '.uno:DefaultBullet': { exec: (c) => c.sh.ToggleNum(false), checked: (c) => c.sh.SelectionHasBullet() },
  '.uno:DefaultNumbering': { exec: (c) => c.sh.ToggleNum(true), checked: (c) => c.sh.SelectionHasNumber() },
  // File > Properties (SfxObjectShell::ExecFile_Impl SID_DOCINFO: SfxDocumentInfoDialog).
  '.uno:SetDocumentProperties': { exec: (c) => c.setDialog('docinfo') },
  // Format > Image > Graphic Size Check (SwBaseShell SID_GRAPHIC_SIZE_CHECK), only with a preferred resolution.
  '.uno:GraphicSizeCheck': { exec: (c) => c.setDialog('sizecheck'), enabled: (c) => c.sh.m_pDoc.m_nImagePreferredDPI > 0 },
  // Format > Watermark (SwBaseShell: SID_WATERMARK, through SwDocShell to SwWatermarkDialog).
  '.uno:Watermark': { exec: (c) => c.setDialog('watermark') },
  // Format > Title Page (SwView::ExecuteSlot FN_TITLE_PAGE_DLG).
  '.uno:TitlePageDialog': { exec: (c) => c.setDialog('titlepage') },
  // Format > Bullets and Numbering (SwTextShell::ExecEnterNum: SID_OUTLINE_BULLET, FN_NUMBER_BULLETS).
  '.uno:OutlineBullet': { exec: (c) => c.setDialog('numbullet') },
  '.uno:BulletsAndNumberingDialog': { exec: (c) => c.setDialog('numbullet') },
  '.uno:RemoveBullets': { exec: (c) => c.sh.DelNumRules(), enabled: inList },
  '.uno:DecrementLevel': { exec: (c) => { c.sh.NumUpDown(true); }, enabled: (c) => inList(c) && c.sh.GetNumLevel() < 9 },
  '.uno:IncrementLevel': { exec: (c) => { c.sh.NumUpDown(false); }, enabled: (c) => inList(c) && c.sh.GetNumLevel() > 0 },
  // SwListShell::Execute: lists are never outline rules here, so "with subpoints" is MoveNumParas.
  '.uno:DecrementSubLevels': { exec: (c) => { c.sh.MoveNumParas(false, false); }, enabled: (c) => inList(c) && (c.sh.GetCurrentOutlineLevels()?.nLower ?? 0) < MAXLEVEL - 1 },
  '.uno:IncrementSubLevels': { exec: (c) => { c.sh.MoveNumParas(false, true); }, enabled: (c) => inList(c) && c.sh.GetNumLevel() > 0 },
  '.uno:MoveDownSubItems': { exec: (c) => { c.sh.MoveNumParas(true, false); }, enabled: inList },
  '.uno:MoveUpSubItems': { exec: (c) => { c.sh.MoveNumParas(true, true); }, enabled: inList },
  '.uno:JumpDownThisLevel': { exec: (c) => { c.sh.GotoNextNum(); }, enabled: inList },
  '.uno:JumpUpThisLevel': { exec: (c) => { c.sh.GotoPrevNum(); }, enabled: inList },
  '.uno:InsertNeutralParagraph': { exec: (c) => c.sh.NoNum(), enabled: inList },
  // SwTextShell: Move Item Up and Down move any paragraph.
  '.uno:MoveDown': { exec: (c) => { c.sh.MoveParagraph(1); } },
  '.uno:MoveUp': { exec: (c) => { c.sh.MoveParagraph(-1); } },
  '.uno:ContinueNumbering': { exec: (c) => c.sh.ContinueNumbering(), enabled: (c) => c.sh.CanContinueNumbering() },
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

// Insert > Shape: every shape command of the shape toolbars whose type has a preset geometry, and
// the drawing toolbar's line, rectangle and ellipse (SwView::ExecDraw with SID_DRAW_CS_ID).
const shapeCommand = (type: string): Command => ({ exec: (c) => c.setDrawShape(type), checked: (c) => c.drawShape === type });
const SHAPE_MENUS = /^\.uno:(BasicShapes|ArrowShapes|SymbolShapes|StarShapes|CalloutShapes|FlowChartShapes)\.(.+)$/;
const collectShapeCommands = (items: readonly { cmd?: string; items?: readonly unknown[] }[]) => {
  for (const it of items) {
    const m = it.cmd && SHAPE_MENUS.exec(it.cmd);
    if (m && GetCustomShapeContent(m[2]!)) COMMANDS[it.cmd!] = shapeCommand(m[2]!);
    if (it.items) collectShapeCommands(it.items as { cmd?: string; items?: unknown[] }[]);
  }
};
collectShapeCommands(upstreamUi.menubar as { cmd?: string; items?: unknown[] }[]);
COMMANDS['.uno:Line'] = shapeCommand('line');
COMMANDS['.uno:Rect'] = shapeCommand('rectangle');
COMMANDS['.uno:Ellipse'] = shapeCommand('ellipse');

/** Font colour or highlighting for the selection (or what is typed next); remembers the colour. */
function setCharColor(c: Controller, kind: ColorKind, v: number | undefined): void {
  const color = v === undefined ? lastColor(kind) : v < 0 ? null : fromColorInt(v);
  if (color) rememberColor(kind, color);
  c.sh.SetCharAttr(kind === 'font' ? { RES_CHRATR_COLOR: color } : { RES_CHRATR_BACKGROUND: color });
  c.notify();
}

export function dispatch(c: Controller, name: string, args?: Record<string, number>): boolean {
  const cmd = COMMANDS[name.split('?')[0]!];
  if (!cmd || (cmd.enabled && !cmd.enabled(c))) return false;
  void Promise.resolve(cmd.exec(c, args)).catch((e: Error) => c.setMessage(e.message));
  return true;
}
