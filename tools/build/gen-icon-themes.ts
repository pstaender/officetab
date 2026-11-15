// Writes src/shell/generated/icons-<theme>.json for the alternative icon themes, each from its
// Iconify package, for the commands the set has a fitting icon for; the other commands keep their
// Colibre icon:
// - line-md, "Material Line Icons" by Vjacheslav Trushkin (MIT). Its icons draw themselves with
//   SMIL animations; toolbar icons must not, so each is frozen at its last frame here. The commands
//   line-md has no icon for take Google's Material Symbols (Apache-2.0), in their rounded outline
//   style, the closest to line-md's round strokes.
// - keyline-icons, "Keyline Icons" (MIT), completed with this project's own icons in its style
//   (keyline-own.ts).
// - fluent, Microsoft's Fluent UI System Icons (MIT), the 20px regular (outline) style, and
//   fluent-color: the same outlines coloured as Office on the web does (FLUENT_ACCENT).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ROOT } from '../upstream/lib.ts';
import { OWN, type OwnIcon } from './keyline-own.ts';

const require = createRequire(import.meta.url);
interface IconSet { icons: Record<string, { body: string }>; width: number; height: number }

/** The line-md icon for each command (only where the meaning matches). */
const LINE_MD: Record<string, string> = {
  '.uno:AddDirect': 'document-add', '.uno:NewDoc': 'document-add', '.uno:Open': 'folder', '.uno:OpenFromWriter': 'folder',
  // The ribbon's New button (a popup of New Document and New Template): a plain document.
  'app:New': 'document',
  '.uno:Save': 'file-download', '.uno:SaveAs': 'file-export', '.uno:SaveACopy': 'download-outline', '.uno:SetDocumentProperties': 'file-document',
  '.uno:Copy': 'text-box-multiple', '.uno:Paste': 'clipboard-arrow',
  '.uno:Undo': 'u-turn-left', '.uno:Redo': 'u-turn-right', '.uno:Navigator': 'compass', '.uno:SearchDialog': 'search', '.uno:Zoom100Percent': 'search',
  '.uno:SpellingAndGrammarDialog': 'check-all', '.uno:WordCountDialog': 'document-report',
  '.uno:InsertGraphic': 'image', '.uno:HyperlinkDialog': 'link', '.uno:InsertSection': 'text-box',
  '.uno:InsertMultiIndex': 'document-list', '.uno:InsertDateField': 'calendar', '.uno:InsertPageNumberField': 'hash',
  '.uno:InsertPageCountField': 'hash-small', '.uno:EditStyle': 'edit',
  '.uno:InsertAnnotation': 'chat', '.uno:DeleteComment': 'chat-off',
  '.uno:TrackChanges': 'pencil', '.uno:NextTrackedChange': 'chevron-right', '.uno:PreviousTrackedChange': 'chevron-left',
  '.uno:AcceptTrackedChange': 'confirm', '.uno:RejectTrackedChange': 'close', '.uno:AcceptTrackedChangeToNext': 'confirm-circle',
  '.uno:RejectTrackedChangeToNext': 'close-circle', '.uno:AcceptAllTrackedChanges': 'check-all', '.uno:RejectAllTrackedChanges': 'close-square',
  '.uno:LeftPara': 'align-left', '.uno:CenterPara': 'align-center', '.uno:RightPara': 'align-right', '.uno:JustifyPara': 'align-justify',
  '.uno:CellVertTop': 'valign-top', '.uno:CellVertCenter': 'valign-middle', '.uno:CellVertBottom': 'valign-bottom',
  '.uno:DefaultBullet': 'list', '.uno:IncrementIndent': 'list-indented', '.uno:DecrementIndent': 'list-indented-reversed',
  '.uno:DeleteTable': 'trash', '.uno:TableSort': 'arrows-vertical', '.uno:Protect': 'security',
  '.uno:TableDialog': 'cog', '.uno:FrameDialog': 'cog', '.uno:GraphicDialog': 'cog', '.uno:CompressGraphic': 'folder-zip',
  '.uno:ObjectAlignLeft': 'arrow-align-left', '.uno:AlignCenter': 'arrow-align-center', '.uno:ObjectAlignRight': 'arrow-align-right',
  '.uno:AlignUp': 'arrow-align-top', '.uno:AlignMiddle': 'arrow-align-middle', '.uno:AlignDown': 'arrow-align-bottom',
  '.uno:BringToFront': 'chevron-double-up', '.uno:ObjectForwardOne': 'chevron-up', '.uno:ObjectBackOne': 'chevron-down', '.uno:SendToBack': 'chevron-double-down',
  '.uno:FlipVertical': 'double-arrow-vertical', '.uno:FlipHorizontal': 'double-arrow-horizontal',
  '.uno:RotateLeft': 'rotate-270', '.uno:RotateRight': 'rotate-90', '.uno:Rotate180': 'rotate-180', '.uno:RotateReset': 'backup-restore',
  '.uno:ToggleObjectRotateMode': 'round-360', '.uno:ZoomMinus': 'minus-circle', '.uno:ZoomPlus': 'plus-circle',
  // Calc: cell alignment as the paragraph's, the AutoFilter's funnel and the sheet grid.
  '.uno:OpenFromCalc': 'folder', '.uno:SpellDialog': 'check-all',
  '.uno:AlignLeft': 'align-left', '.uno:AlignHorizontalCenter': 'align-center', '.uno:AlignRight': 'align-right', '.uno:AlignBlock': 'align-justify',
  '.uno:AlignTop': 'valign-top', '.uno:AlignVCenter': 'valign-middle', '.uno:AlignBottom': 'valign-bottom',
  '.uno:DataFilterAutoFilter': 'filter', '.uno:ToggleSheetGrid': 'grid-3',
};

/** The Keyline icon for each command. */
const KEYLINE: Record<string, string> = {
  '.uno:AddDirect': 'file-plus', '.uno:NewDoc': 'file-plus', '.uno:Open': 'folder-open', '.uno:OpenFromWriter': 'folder-open', 'app:New': 'file',
  '.uno:Save': 'save', '.uno:SaveAs': 'save-plus', '.uno:SaveACopy': 'download', '.uno:Print': 'printer', '.uno:SetDocumentProperties': 'file-cog',
  '.uno:Cut': 'scissors', '.uno:Copy': 'copy', '.uno:Paste': 'clipboard-paste', '.uno:FormatPaintbrush': 'paintbrush', '.uno:ResetAttributes': 'eraser',
  '.uno:Undo': 'undo', '.uno:Redo': 'redo', '.uno:Navigator': 'compass', '.uno:SearchDialog': 'search', '.uno:SpellingAndGrammarDialog': 'spell-check',
  '.uno:ShowTrackedChanges': 'eye', '.uno:TrackChanges': 'pen',
  '.uno:InsertTable': 'table', '.uno:InsertGraphic': 'image', '.uno:InsertObjectStarMath': 'square-radical', '.uno:CharmapControl': 'omega',
  '.uno:HyperlinkDialog': 'link', '.uno:InsertAnnotation': 'message-square-plus', '.uno:DeleteComment': 'message-square-x',
  '.uno:NextTrackedChange': 'arrow-right', '.uno:PreviousTrackedChange': 'arrow-left', '.uno:AcceptTrackedChange': 'check', '.uno:RejectTrackedChange': 'x',
  '.uno:AcceptTrackedChangeToNext': 'circle-check', '.uno:RejectTrackedChangeToNext': 'circle-x', '.uno:AcceptAllTrackedChanges': 'double-check',
  '.uno:RejectAllTrackedChanges': 'square-x',
  '.uno:StyleUpdateByExample': 'refresh-cw', '.uno:StyleNewByExample': 'square-plus', '.uno:EditStyle': 'square-pen',
  '.uno:Grow': 'a-arrow-up', '.uno:Shrink': 'a-arrow-down', '.uno:Bold': 'bold', '.uno:Italic': 'italic', '.uno:Underline': 'underline',
  '.uno:Strikeout': 'strikethrough', '.uno:ChangeCaseToUpper': 'case-upper', '.uno:OutlineFont': 'type-outline', '.uno:FontDialog': 'type',
  '.uno:LeftPara': 'text-align-start', '.uno:CenterPara': 'text-align-center', '.uno:RightPara': 'text-align-end', '.uno:JustifyPara': 'text-align-justify',
  '.uno:CellVertTop': 'align-start-horizontal', '.uno:CellVertCenter': 'align-center-horizontal', '.uno:CellVertBottom': 'align-end-horizontal',
  '.uno:DefaultBullet': 'list', '.uno:DefaultNumbering': 'list-ordered', '.uno:IncrementIndent': 'list-indent-increase', '.uno:DecrementIndent': 'list-indent-decrease',
  '.uno:InsertRowsBefore': 'table-rows-add-above', '.uno:InsertRowsAfter': 'table-rows-add-below',
  '.uno:InsertColumnsBefore': 'table-columns-add-before', '.uno:InsertColumnsAfter': 'table-columns-add-after',
  '.uno:DeleteRows': 'table-rows-remove-below', '.uno:DeleteColumns': 'table-columns-remove-after', '.uno:DeleteTable': 'table-off',
  '.uno:MergeCells': 'table-cells-merge', '.uno:SplitCell': 'table-cells-split', '.uno:EntireRow': 'table-rows', '.uno:EntireColumn': 'columns-3',
  '.uno:SelectTable': 'table', '.uno:AutoFormat': 'swatch-book', '.uno:TableSort': 'list-sort', '.uno:InsertFormula': 'function', '.uno:AutoSum': 'sigma',
  '.uno:NumberFormatPercent': 'percent', '.uno:NumberFormatCurrency': 'dollar-sign', '.uno:NumberFormatDate': 'calendar-days',
  '.uno:Protect': 'lock', '.uno:UnsetCellsReadOnly': 'unlock', '.uno:TableDialog': 'settings', '.uno:FrameDialog': 'settings', '.uno:GraphicDialog': 'settings',
  '.uno:InsertCaptionDialog': 'captions', '.uno:ChainFrames': 'link', '.uno:UnhainFrames': 'unlink',
  '.uno:ObjectAlignLeft': 'align-start-vertical', '.uno:AlignCenter': 'align-center-vertical', '.uno:ObjectAlignRight': 'align-end-vertical',
  '.uno:AlignUp': 'align-start-horizontal', '.uno:AlignMiddle': 'align-center-horizontal', '.uno:AlignDown': 'align-end-horizontal',
  '.uno:BringToFront': 'arrow-up-to-line', '.uno:ObjectForwardOne': 'arrow-up', '.uno:ObjectBackOne': 'arrow-down', '.uno:SendToBack': 'arrow-down-to-line',
  '.uno:FlipVertical': 'flip-vertical', '.uno:FlipHorizontal': 'flip-horizontal', '.uno:RotateLeft': 'rotate-ccw', '.uno:RotateRight': 'rotate-cw',
  '.uno:Crop': 'crop', '.uno:CompressGraphic': 'minimize', '.uno:FormatArea': 'paint-roller', '.uno:FormatLine': 'pen-line', '.uno:ColorSettings': 'palette',
  '.uno:Watermark': 'stamp', '.uno:ContourDialog': 'vector-square', '.uno:InsertMultiIndex': 'book-open-text', '.uno:UpdateCurIndex': 'refresh-ccw',
  '.uno:InsertPageNumberField': 'hash', '.uno:InsertDateField': 'calendar', '.uno:WordCountDialog': 'scan-text',
  '.uno:ZoomMinus': 'search-minus', '.uno:ZoomPlus': 'search-plus', '.uno:Zoom100Percent': 'search',
  '.uno:BasicShapes.rectangle': 'square', '.uno:BasicShapes.ellipse': 'circle',
  '.uno:GrafLuminance': 'sun', '.uno:GrafContrast': 'circle-half', '.uno:GrafGamma': 'chart-spline', '.uno:TableCellBackgroundColor': 'droplet',
  '.uno:ToggleObjectRotateMode': 'rotate-cw-square', '.uno:InsertBreak': 'corner-down-left',
  // The shell's colour window: removing a colour and choosing a custom one.
  'app:ColorRemove': 'droplet-off', 'app:ColorCustom': 'palette',
  '.uno:SelectAll': 'square-dashed', '.uno:NumberFormatStandard': 'hash', '.uno:RotateReset': 'history',
  '.uno:DrawText': 'type', '.uno:VerticalText': 'text-cursor', '.uno:PageNumberWizard': 'hash', '.uno:InsertReferenceField': 'bookmark', '.uno:InsertBookmark': 'bookmark-plus',
  '.uno:InsertSignatureLine': 'signature', '.uno:EditSignatureLine': 'pen-line',
};
/** Calc's commands in Keyline: cell alignment as the paragraph's, sorting, filtering, charts and the sheet's panes. */
Object.assign(KEYLINE, {
  '.uno:OpenFromCalc': 'folder-open', '.uno:SpellDialog': 'spell-check',
  '.uno:AlignLeft': 'text-align-start', '.uno:AlignHorizontalCenter': 'text-align-center', '.uno:AlignRight': 'text-align-end', '.uno:AlignBlock': 'text-align-justify',
  '.uno:AlignTop': 'align-start-horizontal', '.uno:AlignVCenter': 'align-center-horizontal', '.uno:AlignBottom': 'align-end-horizontal',
  '.uno:DataSort': 'list-sort', '.uno:SortAscending': 'arrow-up-narrow-wide', '.uno:SortDescending': 'arrow-down-wide-narrow', '.uno:DataFilterAutoFilter': 'filter',
  '.uno:InsertObjectChart': 'chart-column', '.uno:DataDataPilotRun': 'table-pivot', '.uno:FunctionDialog': 'square-function',
  '.uno:ToggleMergeCells': 'table-cells-merge', '.uno:InsertCell': 'grid-2x2-plus', '.uno:RowOperations': 'table-rows', '.uno:ColumnOperations': 'columns-3',
  '.uno:FreezePanes': 'panels-top-left', '.uno:SplitWindow': 'grid-2x2', '.uno:ToggleSheetGrid': 'grid-3x3', '.uno:BackgroundColor': 'droplet',
});

/** The Fluent icon (20px) for each command. */
const FLUENT: Record<string, string> = {
  '.uno:AddDirect': 'document-add', '.uno:NewDoc': 'document-add', 'app:New': 'document', '.uno:Open': 'folder-open', '.uno:OpenFromWriter': 'folder-open', '.uno:Save': 'save', '.uno:SaveAs': 'save-edit', '.uno:SaveACopy': 'arrow-download',
  '.uno:Print': 'print', '.uno:SetDocumentProperties': 'document-settings', '.uno:Cut': 'cut', '.uno:Copy': 'copy', '.uno:Paste': 'clipboard-paste', '.uno:FormatPaintbrush': 'paint-brush',
  '.uno:ResetAttributes': 'text-clear-formatting', '.uno:Undo': 'arrow-undo', '.uno:Redo': 'arrow-redo', '.uno:Navigator': 'compass-northwest', '.uno:SearchDialog': 'search', '.uno:SpellingAndGrammarDialog': 'text-proofing-tools',
  '.uno:SpellOnline': 'text-grammar-wand', '.uno:ControlCodes': 'text-paragraph', '.uno:InsertTable': 'table', '.uno:InsertGraphic': 'image', '.uno:InsertObjectStarMath': 'math-formula',
  '.uno:InsertPagebreak': 'document-page-break', '.uno:CharmapControl': 'symbols', '.uno:HyperlinkDialog': 'link', '.uno:InsertFootnote': 'text-footnote', '.uno:InsertEndnote': 'document-endnote',
  '.uno:InsertAnnotation': 'comment-add', '.uno:DeleteComment': 'comment-dismiss', '.uno:ShowTrackedChanges': 'eye', '.uno:TrackChanges': 'document-edit',
  '.uno:StyleUpdateByExample': 'arrow-sync', '.uno:StyleNewByExample': 'add-square', '.uno:EditStyle': 'text-edit-style',
  '.uno:Grow': 'text-font-size', '.uno:Shrink': 'text-font-size', '.uno:Bold': 'text-bold', '.uno:Italic': 'text-italic', '.uno:Underline': 'text-underline', '.uno:UnderlineDouble': 'text-underline-double',
  '.uno:Strikeout': 'text-strikethrough', '.uno:Overline': 'text-case-title', '.uno:SuperScript': 'text-superscript', '.uno:SubScript': 'text-subscript', '.uno:Shadowed': 'text-effects',
  '.uno:OutlineFont': 'text-color', '.uno:ChangeCaseToLower': 'text-case-lowercase', '.uno:ChangeCaseToUpper': 'text-case-uppercase', '.uno:SmallCaps': 'text-case-title',
  '.uno:LeftPara': 'text-align-left', '.uno:CenterPara': 'text-align-center', '.uno:RightPara': 'text-align-right', '.uno:JustifyPara': 'text-align-justify',
  '.uno:CellVertTop': 'textbox-align-top', '.uno:CellVertCenter': 'textbox-align-middle', '.uno:CellVertBottom': 'textbox-align-bottom',
  '.uno:DefaultBullet': 'text-bullet-list-ltr', '.uno:DefaultNumbering': 'text-number-list-ltr', '.uno:IncrementIndent': 'text-indent-increase-ltr', '.uno:DecrementIndent': 'text-indent-decrease-ltr',
  '.uno:ParaspaceIncrease': 'text-line-spacing', '.uno:ParaspaceDecrease': 'text-line-spacing',
  '.uno:ParaLeftToRight': 'text-paragraph-direction-right', '.uno:ParaRightToLeft': 'text-paragraph-direction-left', '.uno:SelectAll': 'select-all-on',
  '.uno:FontDialog': 'text-font', '.uno:ParagraphDialog': 'text-paragraph',
  '.uno:InsertRowsBefore': 'table-insert-row', '.uno:InsertRowsAfter': 'table-insert-row', '.uno:InsertColumnsBefore': 'table-insert-column', '.uno:InsertColumnsAfter': 'table-insert-column',
  '.uno:DeleteRows': 'table-delete-row', '.uno:DeleteColumns': 'table-delete-column', '.uno:DeleteTable': 'table-dismiss', '.uno:EntireCell': 'table-cell-edit',
  '.uno:EntireRow': 'table-stack-down', '.uno:EntireColumn': 'table-stack-right', '.uno:SelectTable': 'table-checker', '.uno:MergeCells': 'table-cells-merge', '.uno:SplitCell': 'table-cells-split',
  '.uno:SplitTable': 'table-split', '.uno:OptimizeTable': 'table-resize-column', '.uno:TableCellBackgroundColor': 'paint-bucket', '.uno:AutoFormat': 'table-lightning',
  '.uno:SetBorderStyle': 'border-all', '.uno:LineStyle': 'line-style', '.uno:FrameLineColor': 'border-outside', '.uno:NumberFormatStandard': 'number-symbol',
  '.uno:NumberFormatCurrency': 'money', '.uno:NumberFormatPercent': 'text-percent', '.uno:NumberFormatDecimal': 'decimal-arrow-right', '.uno:NumberFormatDate': 'calendar-ltr',
  '.uno:TableNumberFormatDialog': 'text-number-format', '.uno:InsertCaptionDialog': 'closed-caption', '.uno:TableSort': 'arrow-sort', '.uno:Protect': 'lock-closed', '.uno:UnsetCellsReadOnly': 'lock-open',
  '.uno:AutoSum': 'autosum', '.uno:InsertFormula': 'math-formula', '.uno:TableDialog': 'table-settings',
  '.uno:WrapOff': 'text-position-top-bottom', '.uno:WrapOn': 'text-position-square', '.uno:WrapIdeal': 'text-position-tight', '.uno:WrapLeft': 'text-position-square-right', '.uno:WrapRight': 'text-position-square-left', '.uno:WrapThrough': 'text-position-through',
  '.uno:ObjectAlignLeft': 'align-left', '.uno:AlignCenter': 'align-center-horizontal', '.uno:ObjectAlignRight': 'align-right', '.uno:AlignUp': 'align-top', '.uno:AlignMiddle': 'align-center-vertical', '.uno:AlignDown': 'align-bottom',
  '.uno:BringToFront': 'position-to-front', '.uno:ObjectForwardOne': 'position-forward', '.uno:ObjectBackOne': 'position-backward', '.uno:SendToBack': 'position-to-back', '.uno:SetObjectToForeground': 'text-position-front', '.uno:SetObjectToBackground': 'text-position-behind',
  '.uno:FrameDialog': 'settings', '.uno:GraphicDialog': 'image-edit', '.uno:ChainFrames': 'link', '.uno:UnhainFrames': 'link-dismiss', '.uno:Crop': 'crop', '.uno:FlipVertical': 'flip-vertical', '.uno:FlipHorizontal': 'flip-horizontal',
  '.uno:RotateLeft': 'rotate-left', '.uno:RotateRight': 'rotate-right', '.uno:ToggleObjectRotateMode': 'arrow-rotate-clockwise', '.uno:Rotate180': 'arrow-rotate-clockwise', '.uno:RotateReset': 'arrow-reset',
  '.uno:GrafTransparence': 'transparency-square', '.uno:ColorSettings': 'color', '.uno:GrafRed': 'color', '.uno:GrafGreen': 'color', '.uno:GrafBlue': 'color', '.uno:GrafLuminance': 'brightness-high', '.uno:GrafContrast': 'circle-half-fill', '.uno:GrafGamma': 'data-line',
  '.uno:TitlePageDialog': 'document-header', '.uno:InsertSection': 'document-text', '.uno:InsertBreak': 'arrow-enter-left', '.uno:Watermark': 'drop', '.uno:ContourDialog': 'shape-intersect',
  '.uno:TextWrap': 'text-wrap', '.uno:InsertMultiIndex': 'text-bullet-list-square', '.uno:UpdateCurIndex': 'arrow-clockwise', '.uno:InsertPageNumberField': 'number-symbol', '.uno:InsertPageCountField': 'document-page-number',
  '.uno:InsertDateField': 'calendar-ltr', '.uno:WordCountDialog': 'text-word-count', '.uno:NextTrackedChange': 'arrow-next', '.uno:PreviousTrackedChange': 'arrow-previous',
  '.uno:AcceptTrackedChange': 'checkmark', '.uno:RejectTrackedChange': 'dismiss', '.uno:AcceptTrackedChangeToNext': 'checkmark-circle', '.uno:RejectTrackedChangeToNext': 'dismiss-circle',
  '.uno:AcceptAllTrackedChanges': 'checkmark-starburst', '.uno:RejectAllTrackedChanges': 'dismiss-square-multiple', '.uno:Zoom100Percent': 'zoom-fit', '.uno:CompressGraphic': 'arrow-minimize',
  '.uno:FormatArea': 'paint-bucket', '.uno:FormatLine': 'line', '.uno:ZoomMinus': 'zoom-out', '.uno:ZoomPlus': 'zoom-in', '.uno:Line': 'line', '.uno:BasicShapes.rectangle': 'rectangle-landscape', '.uno:BasicShapes.ellipse': 'circle',
  '.uno:Color': 'text-color', '.uno:CharBackColor': 'highlight', 'app:ColorRemove': 'color-off', 'app:ColorCustom': 'color',
  '.uno:DrawText': 'textbox', '.uno:VerticalText': 'textbox-rotate-90', '.uno:PageNumberWizard': 'document-page-number',
  '.uno:InsertReferenceField': 'document-link', '.uno:InsertBookmark': 'bookmark-add', '.uno:InsertSignatureLine': 'signature', '.uno:EditSignatureLine': 'signature',
};
/** Calc's commands in Fluent, as Excel on the web draws them. */
Object.assign(FLUENT, {
  '.uno:OpenFromCalc': 'folder-open', '.uno:SpellDialog': 'text-proofing-tools',
  '.uno:AlignLeft': 'text-align-left', '.uno:AlignHorizontalCenter': 'text-align-center', '.uno:AlignRight': 'text-align-right', '.uno:AlignBlock': 'text-align-justify',
  '.uno:AlignTop': 'textbox-align-top', '.uno:AlignVCenter': 'textbox-align-middle', '.uno:AlignBottom': 'textbox-align-bottom',
  '.uno:DataSort': 'arrow-sort', '.uno:SortAscending': 'text-sort-ascending', '.uno:SortDescending': 'text-sort-descending', '.uno:DataFilterAutoFilter': 'filter',
  '.uno:InsertObjectChart': 'data-bar-vertical', '.uno:FunctionDialog': 'math-formula', '.uno:WrapText': 'text-wrap', '.uno:ToggleMergeCells': 'table-cells-merge',
  '.uno:NumberFormatIncDecimals': 'decimal-arrow-left', '.uno:NumberFormatDecDecimals': 'decimal-arrow-right',
  '.uno:InsertCell': 'table-cell-add', '.uno:Insert': 'tab-add', '.uno:RowOperations': 'table-insert-row', '.uno:ColumnOperations': 'table-insert-column',
  '.uno:FreezePanes': 'table-freeze-column-and-row', '.uno:SplitWindow': 'layout-cell-four', '.uno:ToggleSheetGrid': 'table-simple', '.uno:BackgroundColor': 'paint-bucket',
  '.uno:TextdirectionLeftToRight': 'text-direction-horizontal-ltr', '.uno:TextdirectionTopToBottom': 'text-direction-vertical',
});
/** The colour area of Fluent's colour icons (their accent shape). */
const FLUENT_COLOR_AREA: Record<string, string> = { '.uno:Color': 'text-color-accent-20-regular', '.uno:CharBackColor': 'highlight-accent-20-filled' };

/**
 * Fluent's colour theme, after Office on the web: grey outlines, a few icons wholly in a muted
 * colour, and the badges, pencils and changed parts of others in colour. Each entry is the colour
 * and, for a part, the shape (in Fluent's 20px grid) the coloured copy is clipped to.
 */
const O365 = { blue: '#0f6cbd', green: '#107c41', red: '#c50f1f', orange: '#c43e1c', amber: '#c98a0b', pink: '#c2397a', purple: '#7a4fb5' };
const BADGE_TR = '<circle cx="14.5" cy="5.5" r="5.25"/>', BADGE_BR = '<circle cx="14.5" cy="14.5" r="5.25"/>', BADGE_BL = '<circle cx="5.5" cy="14.5" r="5.25"/>';
const PENCIL = '<polygon points="8.5,19.5 18.5,9.5 21,12 12,21.5"/>', CENTER_X = '<rect x="7" y="7" width="6" height="6"/>';
const FLUENT_ACCENT: Record<string, { color: string; clip?: string }> = {
  '.uno:AddDirect': { color: O365.green, clip: BADGE_BL }, '.uno:NewDoc': { color: O365.green, clip: BADGE_BL },
  '.uno:InsertAnnotation': { color: O365.green, clip: BADGE_TR }, '.uno:DeleteComment': { color: O365.red, clip: BADGE_TR },
  '.uno:DeleteTable': { color: O365.red, clip: BADGE_BR }, '.uno:UnhainFrames': { color: O365.red, clip: BADGE_BR },
  '.uno:SaveAs': { color: O365.blue, clip: PENCIL }, '.uno:TrackChanges': { color: O365.blue, clip: PENCIL },
  '.uno:GraphicDialog': { color: O365.blue, clip: PENCIL }, '.uno:EntireCell': { color: O365.blue, clip: PENCIL },
  '.uno:AutoFormat': { color: O365.amber, clip: '<circle cx="14.5" cy="14.5" r="4.75"/>' },
  '.uno:InsertRowsBefore': { color: O365.blue, clip: '<rect x="0" y="6.5" width="20" height="7"/>' },
  '.uno:InsertRowsAfter': { color: O365.blue, clip: '<rect x="0" y="6.5" width="20" height="7"/>' },
  '.uno:InsertColumnsBefore': { color: O365.blue, clip: '<rect x="6.5" y="0" width="7" height="20"/>' },
  '.uno:InsertColumnsAfter': { color: O365.blue, clip: '<rect x="6.5" y="0" width="7" height="20"/>' },
  '.uno:DeleteRows': { color: O365.red, clip: CENTER_X }, '.uno:DeleteColumns': { color: O365.red, clip: CENTER_X },
  '.uno:ResetAttributes': { color: O365.pink, clip: '<circle cx="14.8" cy="15.5" r="4.6"/>' },
  '.uno:FormatPaintbrush': { color: O365.amber, clip: '<rect x="0" y="0" width="20" height="10.5"/>' },
  '.uno:SpellingAndGrammarDialog': { color: O365.green, clip: '<rect x="0" y="10" width="20" height="10"/>' },
  '.uno:SpellOnline': { color: O365.amber, clip: '<circle cx="15.5" cy="8" r="4.5"/>' },
  '.uno:TitlePageDialog': { color: O365.orange, clip: '<rect x="0" y="0" width="20" height="7"/>' },
  '.uno:AcceptTrackedChange': { color: O365.green }, '.uno:AcceptTrackedChangeToNext': { color: O365.green }, '.uno:AcceptAllTrackedChanges': { color: O365.green },
  '.uno:RejectTrackedChange': { color: O365.red }, '.uno:RejectTrackedChangeToNext': { color: O365.red }, '.uno:RejectAllTrackedChanges': { color: O365.red },
  '.uno:NextTrackedChange': { color: O365.blue }, '.uno:PreviousTrackedChange': { color: O365.blue },
  '.uno:InsertPageNumberField': { color: O365.blue }, '.uno:InsertPageCountField': { color: O365.blue }, '.uno:InsertFootnote': { color: O365.blue },
  '.uno:InsertEndnote': { color: O365.blue }, '.uno:Shadowed': { color: O365.blue }, '.uno:Watermark': { color: O365.blue },
  '.uno:GrafRed': { color: O365.red }, '.uno:GrafGreen': { color: O365.green }, '.uno:GrafBlue': { color: O365.blue }, '.uno:GrafLuminance': { color: O365.amber },
  '.uno:InsertObjectStarMath': { color: O365.purple }, '.uno:InsertFormula': { color: O365.purple },
};

const GREY = '#3c4048';

/** The Material Symbols whose first subpath is the colour bar. */
const MATERIAL_BAR = new Set(['.uno:Color', '.uno:CharBackColor']);
/** Material Symbols for the commands line-md has no icon for. */
const MATERIAL: Record<string, string> = {
  '.uno:Print': 'print', '.uno:Cut': 'content-cut', '.uno:FormatPaintbrush': 'format-paint', '.uno:ResetAttributes': 'format-clear',
  '.uno:SpellOnline': 'spellcheck', '.uno:ControlCodes': 'format-paragraph', '.uno:InsertTable': 'table', '.uno:InsertObjectStarMath': 'function',
  '.uno:InsertPagebreak': 'insert-page-break', '.uno:CharmapControl': 'special-character', '.uno:InsertFootnote': 'notes', '.uno:InsertEndnote': 'article',
  '.uno:ShowTrackedChanges': 'visibility', '.uno:StyleUpdateByExample': 'sync', '.uno:StyleNewByExample': 'add-box',
  '.uno:Grow': 'text-increase', '.uno:Shrink': 'text-decrease', '.uno:Bold': 'format-bold', '.uno:Italic': 'format-italic', '.uno:Underline': 'format-underlined',
  '.uno:UnderlineDouble': 'format-underlined', '.uno:Strikeout': 'strikethrough-s', '.uno:Overline': 'format-overline', '.uno:SuperScript': 'superscript',
  '.uno:SubScript': 'subscript', '.uno:Shadowed': 'filter-none', '.uno:OutlineFont': 'text-fields', '.uno:ChangeCaseToLower': 'lowercase',
  '.uno:ChangeCaseToUpper': 'uppercase', '.uno:SmallCaps': 'match-case', '.uno:DefaultNumbering': 'format-list-numbered',
  '.uno:ParaspaceIncrease': 'format-line-spacing', '.uno:ParaspaceDecrease': 'format-line-spacing', '.uno:ParaLeftToRight': 'format-textdirection-l-to-r',
  '.uno:ParaRightToLeft': 'format-textdirection-r-to-l', '.uno:SelectAll': 'select-all', '.uno:FontDialog': 'text-format', '.uno:ParagraphDialog': 'subject',
  '.uno:InsertRowsBefore': 'add-row-above', '.uno:InsertRowsAfter': 'add-row-below', '.uno:InsertColumnsBefore': 'add-column-left',
  '.uno:InsertColumnsAfter': 'add-column-right', '.uno:DeleteRows': 'playlist-remove', '.uno:DeleteColumns': 'variable-remove', '.uno:EntireCell': 'crop-square',
  '.uno:EntireRow': 'table-rows', '.uno:EntireColumn': 'view-column', '.uno:SelectTable': 'table-view', '.uno:MergeCells': 'cell-merge',
  '.uno:SplitCell': 'vertical-split', '.uno:SplitTable': 'splitscreen', '.uno:OptimizeTable': 'fit-width', '.uno:TableCellBackgroundColor': 'format-color-fill',
  '.uno:AutoFormat': 'auto-awesome-mosaic', '.uno:SetBorderStyle': 'border-all', '.uno:LineStyle': 'line-style', '.uno:FrameLineColor': 'border-outer',
  '.uno:NumberFormatStandard': 'numbers', '.uno:NumberFormatCurrency': 'attach-money', '.uno:NumberFormatPercent': 'percent',
  '.uno:NumberFormatDecimal': 'decimal-increase', '.uno:NumberFormatDate': 'calendar-today', '.uno:TableNumberFormatDialog': 'numbers',
  '.uno:InsertCaptionDialog': 'closed-caption', '.uno:UnsetCellsReadOnly': 'lock-open', '.uno:AutoSum': 'functions', '.uno:InsertFormula': 'function',
  // Text wrap as Google Docs draws it: break text, wrap text, the text's side, behind and in front.
  '.uno:WrapOff': 'format-image-break-left', '.uno:WrapOn': 'wrap-text', '.uno:WrapIdeal': 'format-text-wrap', '.uno:WrapLeft': 'format-image-right',
  '.uno:WrapRight': 'format-image-left', '.uno:WrapThrough': 'layers', '.uno:TextWrap': 'format-text-wrap',
  '.uno:SetObjectToForeground': 'format-image-front', '.uno:SetObjectToBackground': 'format-image-back',
  '.uno:ChainFrames': 'add-link', '.uno:UnhainFrames': 'link-off', '.uno:Crop': 'crop', '.uno:GrafTransparence': 'opacity', '.uno:ColorSettings': 'palette',
  '.uno:GrafRed': 'palette', '.uno:GrafGreen': 'palette', '.uno:GrafBlue': 'palette', '.uno:GrafLuminance': 'light-mode', '.uno:GrafContrast': 'contrast',
  '.uno:GrafGamma': 'tonality', '.uno:TitlePageDialog': 'title', '.uno:InsertBreak': 'keyboard-return', '.uno:Watermark': 'water-drop',
  '.uno:ContourDialog': 'polyline', '.uno:UpdateCurIndex': 'refresh', '.uno:FormatArea': 'texture', '.uno:FormatLine': 'line-weight',
  '.uno:Line': 'diagonal-line', '.uno:BasicShapes.rectangle': 'rectangle', '.uno:BasicShapes.ellipse': 'circle',
  // Insert: text boxes, page numbers, bookmarks, cross-references and signature lines.
  '.uno:DrawText': 'text-fields', '.uno:VerticalText': 'text-rotate-vertical', '.uno:PageNumberWizard': '123',
  '.uno:InsertReferenceField': 'quick-reference', '.uno:InsertBookmark': 'bookmark-add', '.uno:InsertSignatureLine': 'signature', '.uno:EditSignatureLine': 'draw',
  '.uno:Color': 'format-color-text', '.uno:CharBackColor': 'format-ink-highlighter', 'app:ColorRemove': 'format-color-reset', 'app:ColorCustom': 'palette',
};
/** Calc's commands line-md has no icon for, as Google Sheets draws them. */
Object.assign(MATERIAL, {
  '.uno:DataSort': 'sort', '.uno:SortAscending': 'sort-by-alpha', '.uno:InsertObjectChart': 'insert-chart', '.uno:DataDataPilotRun': 'pivot-table-chart',
  '.uno:FunctionDialog': 'function', '.uno:WrapText': 'wrap-text', '.uno:ToggleMergeCells': 'cell-merge',
  '.uno:NumberFormatIncDecimals': 'decimal-increase', '.uno:NumberFormatDecDecimals': 'decimal-decrease',
  '.uno:RowOperations': 'table-rows', '.uno:ColumnOperations': 'view-column', '.uno:SplitWindow': 'window', '.uno:BackgroundColor': 'format-color-fill',
  '.uno:TextdirectionLeftToRight': 'text-rotation-none', '.uno:TextdirectionTopToBottom': 'text-rotate-vertical',
});

interface El { tag: string; attrs: [string, string][]; children: (El | string)[] }

function parse(src: string): El {
  const root: El = { tag: '', attrs: [], children: [] };
  const stack = [root];
  for (const m of src.matchAll(/<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g)) {
    const top = stack[stack.length - 1]!;
    if (m[5] !== undefined) { top.children.push(m[5]); continue; }
    if (m[1]) { stack.pop(); continue; }
    const el: El = { tag: m[2]!, attrs: [...m[3]!.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]), children: [] };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}

const attr = (e: El, k: string) => e.attrs.find((a) => a[0] === k)?.[1];
function setAttr(e: El, k: string, v: string) { const a = e.attrs.find((x) => x[0] === k); if (a) a[1] = v; else e.attrs.push([k, v]); }

/** Applies each animation's end value to the element it animates and drops the animation. */
function freeze(e: El): void {
  for (const ch of e.children) if (typeof ch !== 'string') freeze(ch);
  e.children = e.children.filter((ch) => {
    if (typeof ch === 'string' || !['animate', 'set', 'animateTransform'].includes(ch.tag)) return true;
    const name = attr(ch, 'attributeName');
    const end = attr(ch, 'to') ?? attr(ch, 'values')?.split(';').pop()?.trim();
    if (name && end !== undefined && attr(ch, 'fill') === 'freeze') {
      if (ch.tag === 'animateTransform') setAttr(e, 'transform', `${attr(ch, 'type')}(${end})`);
      else setAttr(e, name, end);
    }
    return false;
  });
}

const serialize = (e: El | string): string => typeof e === 'string' ? e
  : e.tag ? `<${e.tag}${e.attrs.map(([k, v]) => ` ${k}="${v}"`).join('')}${e.children.length ? `>${e.children.map(serialize).join('')}</${e.tag}>` : '/>'}`
  : e.children.map(serialize).join('');

const svgOf = (body: string, set: IconSet = { icons: {}, width: 24, height: 24 }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${set.width} ${set.height}">${body}</svg>`;
const STROKED = 'fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"';

/** An own icon (keyline-own.ts). */
const ownIcon = (i: OwnIcon): string => [
  i.bar ? `<path fill="COLORBAR" d="${i.bar}"/>` : '',
  i.mark ? `<path fill="${GREY}" fill-opacity=".35" d="${i.mark}"/>` : '',
  `<g ${STROKED} stroke="${GREY}">`,
  i.body ? `<path d="${i.body}"/>` : '',
  i.extra ?? '',
  i.accent ? `<path d="${i.accent}"/>` : '',
  '</g>',
].join('');

function write(id: string, out: Record<string, string>, note: string) {
  writeFileSync(join(ROOT, `src/shell/generated/icons-${id}.json`), `${JSON.stringify(out)}\n`);
  console.log(`${id}: ${Object.keys(out).length} command icons (${note})`);
}
const version = (pkgId: string) => (JSON.parse(readFileSync(require.resolve(`@iconify-json/${pkgId}/package.json`), 'utf8')) as { version: string }).version;

function fromSet(pkgId: string, map: Record<string, string>): Record<string, string> {
  const set = require(`@iconify-json/${pkgId}/icons.json`) as IconSet;
  const out: Record<string, string> = {};
  for (const [cmd, name] of Object.entries(map)) {
    if (!set.icons[name]) throw new Error(`${pkgId} has no icon ${name}`);
    const body = parse(set.icons[name]!.body);
    freeze(body);
    // A data: URL image has no inherited colour: the strokes take the toolbar's text grey.
    out[cmd] = svgOf(serialize(body).replace(/currentColor/g, GREY), set);
  }
  return out;
}

/** An icon of a set by name, following aliases. */
const lookup = (set: IconSet & { aliases?: Record<string, { parent: string }> }, name: string) => set.icons[name] ?? set.icons[set.aliases?.[name]?.parent ?? ''];
const lineMd = fromSet('line-md', LINE_MD);
{
  const ms = require('@iconify-json/material-symbols/icons.json') as IconSet;
  for (const [cmd, name] of Object.entries(MATERIAL)) {
    if (lineMd[cmd]) throw new Error(`line-md has ${cmd} already`);
    // The rounded outline variant first; plain names are the filled style.
    const icon = [`${name}-outline-rounded`, `${name}-rounded`, `${name}-outline`, name].map((n) => lookup(ms, n)).find(Boolean);
    if (!icon) throw new Error(`material-symbols has no icon ${name}`);
    let body = icon.body;
    // The colour icons' bar (their first subpath) becomes the area the toolbar fills.
    // The rest continues from the bar's start point, as its first command may be a relative move.
    if (MATERIAL_BAR.has(cmd)) {
      body = body.replace(/<path fill="currentColor" d="(M(-?[\d.]+)[ ,](-?[\d.]+)[^z]*z)/, (_m, bar: string, x: string, y: string) =>
        `<path fill="COLORBAR" d="${bar}"/><path fill="currentColor" d="M${x} ${y}`);
    }
    lineMd[cmd] = svgOf(body.replace(/currentColor/g, GREY), ms);
  }
}
write('line-md', lineMd, `line-md ${version('line-md')} and ${Object.keys(MATERIAL).length} of material-symbols ${version('material-symbols')}`);
const keyline = fromSet('keyline-icons', KEYLINE);
for (const [cmd, i] of Object.entries(OWN)) keyline[cmd] = svgOf(ownIcon(i));
{
  const fl = require('@iconify-json/fluent/icons.json') as IconSet;
  const fluent: Record<string, string> = {};
  const fluentColor: Record<string, string> = {};
  for (const [cmd, name] of Object.entries(FLUENT)) {
    const regular = lookup(fl, `${name}-20-regular`);
    if (!regular) throw new Error(`fluent has no icon ${name}`);
    let outline = regular.body.replace(/currentColor/g, GREY);
    // Fluent's accent shape of the colour icons: the area the toolbar fills with the colour.
    const accentShape = FLUENT_COLOR_AREA[cmd] && lookup(fl, FLUENT_COLOR_AREA[cmd]);
    if (accentShape) outline += accentShape.body.replace(/currentColor/g, 'COLORBAR');
    fluent[cmd] = svgOf(outline, fl);
    const accent = FLUENT_ACCENT[cmd];
    const colored = accent && regular.body.replace(/currentColor/g, accent.color);
    fluentColor[cmd] = !accent ? fluent[cmd]!
      : !accent.clip ? svgOf(colored!, fl)
      // The coloured copy over the grey one, clipped to the part.
      : svgOf(`<defs><clipPath id="a">${accent.clip}</clipPath></defs>${outline}<g clip-path="url(#a)">${colored}</g>`, fl);
  }
  write('fluent', fluent, `fluent ${version('fluent')}`);
  write('fluent-color', fluentColor, `${Object.keys(FLUENT_ACCENT).length} in colour`);
}
write('keyline-icons', keyline, `keyline-icons ${version('keyline-icons')} and ${Object.keys(OWN).length} own`);
