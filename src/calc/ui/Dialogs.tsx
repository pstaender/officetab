// Calc's dialogs (sc/uiconfig/scalc/ui): Insert and Delete Cells, Delete Contents, Row Height and
// Column Width (and their optimal variants), the sheet dialogs (Insert, Rename, Move/Copy, Tab
// Color), Sort, Paste Special, Format Cells (Numbers, Font, Font Effects, Alignment, Borders,
// Background), and Find & Replace as a bar over the grid; the shared ones come from the shell.
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Controller } from '../controller.ts';
import { Actions, Field, Modal, Panel, ShellDialogs, Tabs } from '@shell/ui/Dialogs.tsx';
import { FontNameField, FontSizeCombo } from '@shell/ui/FontBoxes.tsx';
import { t } from '@shell/i18n.ts';
import { DelCellCmd, InsCellCmd, InsertDeleteFlags, ScSizeMode } from '@lo/sc/inc/global.ts';
import { ScColToAlpha } from '@lo/sc/inc/address.ts';
import { ScSortParam, ScColorSortMode } from '@lo/sc/inc/sortparam.ts';
import type { ScItemSet, SvxBorderLine, SvxBorderLineStyle, SvxCellHorJustify, SvxCellVerJustify, FontLineStyle } from '@lo/sc/inc/scitems.ts';
import { GenerateFormat, GetFormatSpecialInfo, GetOutputString, GetStandardFormat, GetType, SvNumFormatType } from '@lo/svl/source/numbers/zforlist.ts';
import { getLastClip } from '../clipboard.ts';
import type { ScSearchItem } from '@lo/sc/source/ui/view/viewfunc.ts';
import { IsDark } from '@lo/sc/source/ui/view/output.ts';
import { DataDialogs } from './DataDialogs.tsx';

/** Twips as centimetres for the dialogs' fields (Calc's metric default), and back. */
const toCm = (twips: number) => Math.round((twips / 1440) * 2.54 * 100) / 100;
const fromCm = (s: string): number | null => {
  const m = /^\s*([\d.,]+)\s*(cm|mm|in|"|pt)?\s*$/i.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]!.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? 'cm').toLowerCase();
  const inch = unit === 'mm' ? n / 25.4 : unit === 'in' || unit === '"' ? n : unit === 'pt' ? n / 72 : n / 2.54;
  return Math.round(inch * 1440);
};

const Radio = ({ name, value, label, checked }: { name: string; value: string; label: string; checked?: boolean }) => (
  <label className="check"><input type="radio" name={name} value={value} defaultChecked={checked} /> {label}</label>
);
const Check = ({ name, label, checked }: { name: string; label: string; checked?: boolean }) => (
  <label className="check"><input type="checkbox" name={name} defaultChecked={checked} /> {label}</label>
);

/** A dialog with a form; submit returns whether to close. */
function FormDialog({ c, title, children, onSubmit, wide, ok }: { c: Controller; title: string; children: ReactNode; onSubmit: (f: FormData) => boolean | void; wide?: boolean; ok?: string }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (onSubmit(new FormData(e.currentTarget)) === false) return;
    c.setDialog(null);
  };
  return (
    <Modal c={c} title={title} wide={wide}>
      <form onSubmit={submit} className="calc-dialog">
        {children}
        <Actions c={c} ok={ok} />
      </form>
    </Modal>
  );
}

/** sc/uiconfig/scalc/ui/insertcells.ui */
function InsertCells({ c }: { c: Controller }) {
  return (
    <FormDialog c={c} title={t('calc.insertCells')} onSubmit={(f) => {
      const cmd = ({ down: InsCellCmd.INS_CELLSDOWN, right: InsCellCmd.INS_CELLSRIGHT, rows: InsCellCmd.INS_INSROWS_BEFORE, cols: InsCellCmd.INS_INSCOLS_BEFORE } as Record<string, InsCellCmd>)[String(f.get('mode'))]!;
      c.view.InsertCells(cmd);
    }}>
      <fieldset><legend>{t('calc.selection')}</legend>
        <Radio name="mode" value="down" label={t('calc.shiftDown')} checked />
        <Radio name="mode" value="right" label={t('calc.shiftRight')} />
        <Radio name="mode" value="rows" label={t('calc.entireRow')} />
        <Radio name="mode" value="cols" label={t('calc.entireColumn')} />
      </fieldset>
    </FormDialog>
  );
}

/** sc/uiconfig/scalc/ui/deletecells.ui */
function DeleteCells({ c }: { c: Controller }) {
  return (
    <FormDialog c={c} title={t('calc.deleteCells')} onSubmit={(f) => {
      const cmd = ({ up: DelCellCmd.CellsUp, left: DelCellCmd.CellsLeft, rows: DelCellCmd.Rows, cols: DelCellCmd.Cols } as Record<string, DelCellCmd>)[String(f.get('mode'))]!;
      c.view.DeleteCells(cmd);
    }}>
      <fieldset><legend>{t('calc.selection')}</legend>
        <Radio name="mode" value="up" label={t('calc.shiftUp')} checked />
        <Radio name="mode" value="left" label={t('calc.shiftLeft')} />
        <Radio name="mode" value="rows" label={t('calc.deleteRows')} />
        <Radio name="mode" value="cols" label={t('calc.deleteColumns')} />
      </fieldset>
    </FormDialog>
  );
}

/** sc/uiconfig/scalc/ui/deletecontents.ui: what Backspace deletes. */
function DeleteContents({ c }: { c: Controller }) {
  const [all, setAll] = useState(false);
  return (
    <FormDialog c={c} title={t('calc.deleteContents')} onSubmit={(f) => {
      let n = 0;
      if (f.get('all') === 'on') n = InsertDeleteFlags.ALL;
      else {
        if (f.get('text') === 'on') n |= InsertDeleteFlags.STRING;
        if (f.get('numbers') === 'on') n |= InsertDeleteFlags.VALUE;
        if (f.get('datetime') === 'on') n |= InsertDeleteFlags.DATETIME;
        if (f.get('formulas') === 'on') n |= InsertDeleteFlags.FORMULA;
        if (f.get('comments') === 'on') n |= InsertDeleteFlags.NOTE;
        if (f.get('formats') === 'on') n |= InsertDeleteFlags.ATTRIB;
      }
      if (n) c.view.DeleteContents(n);
    }}>
      <fieldset><legend>{t('calc.selection')}</legend>
        <label className="check"><input type="checkbox" name="all" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t('calc.deleteAll')}</label>
        <fieldset disabled={all} className="plain">
          <Check name="text" label={t('calc.text')} checked />
          <Check name="numbers" label={t('calc.numbers')} checked />
          <Check name="datetime" label={t('calc.dateTime')} checked />
          <Check name="formulas" label={t('calc.formulas')} checked />
          <Check name="comments" label={t('calc.comments')} />
          <Check name="formats" label={t('calc.formats')} />
        </fieldset>
      </fieldset>
    </FormDialog>
  );
}

/** rowheightdialog.ui and colwidthdialog.ui */
function SizeDialog({ c, bWidth }: { c: Controller; bWidth: boolean }) {
  const v = c.view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const cur = bWidth ? rDoc.GetColWidth(v.GetCurX(), v.GetTabNo()) : rDoc.GetRowHeight(v.GetCurY(), v.GetTabNo());
  const def = bWidth ? 1280 : 255;
  const [isDefault, setDefault] = useState(cur === def);
  return (
    <FormDialog c={c} title={t(bWidth ? 'calc.columnWidth' : 'calc.rowHeight')} onSubmit={(f) => {
      const tw = f.get('default') === 'on' ? def : fromCm(String(f.get('size')));
      if (tw === null) return false;
      c.view.SetMarkedWidthOrHeight(bWidth, ScSizeMode.SC_SIZE_DIRECT, tw);
    }}>
      <Field label={t(bWidth ? 'calc.width' : 'calc.height')}><input name="size" defaultValue={`${toCm(cur)} cm`} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={() => setDefault(false)} /></Field>
      <label className="check"><input type="checkbox" name="default" checked={isDefault} onChange={(e) => setDefault(e.target.checked)} /> {t('calc.defaultValue')}</label>
    </FormDialog>
  );
}

/** optimalrowheightdialog.ui and optimalcolwidthdialog.ui */
function OptimalSizeDialog({ c, bWidth }: { c: Controller; bWidth: boolean }) {
  return (
    <FormDialog c={c} title={t(bWidth ? 'calc.optimalColumnWidth' : 'calc.optimalRowHeight')} onSubmit={(f) => {
      const tw = fromCm(String(f.get('add')));
      if (tw === null) return false;
      c.view.SetMarkedWidthOrHeight(bWidth, ScSizeMode.SC_SIZE_OPTIMAL, tw);
    }}>
      <Field label={t('calc.add')}><input name="add" defaultValue={`${toCm(bWidth ? 113 : 0)} cm`} autoFocus /></Field>
    </FormDialog>
  );
}

/** insertsheet.ui: position, number of sheets, name. */
function InsertSheet({ c }: { c: Controller }) {
  const rDoc = c.sh.GetDocument();
  const nTab = c.view.GetViewData().GetTabNo();
  return (
    <FormDialog c={c} title={t('calc.insertSheet')} onSubmit={(f) => {
      const n = Math.max(1, Math.min(256, parseInt(String(f.get('count')), 10) || 1));
      let pos = f.get('pos') === 'after' ? nTab + 1 : nTab;
      const name = String(f.get('name') ?? '').trim();
      if (n === 1 && name && !rDoc.ValidNewTabName(name)) { c.setMessage(t('calc.invalidSheetName')); return false; }
      for (let i = 0; i < n; i++) {
        const nm = n === 1 && name ? name : rDoc.CreateValidTabName(`Sheet${rDoc.GetTableCount() + 1}`);
        c.view.InsertTable(nm, pos++);
      }
    }}>
      <fieldset><legend>{t('calc.position')}</legend>
        <Radio name="pos" value="before" label={t('calc.beforeCurrent')} checked />
        <Radio name="pos" value="after" label={t('calc.afterCurrent')} />
      </fieldset>
      <Field label={t('calc.noOfSheets')}><input type="number" name="count" min={1} max={256} defaultValue={1} /></Field>
      <Field label={t('calc.name')}><input name="name" defaultValue={rDoc.CreateValidTabName(`Sheet${rDoc.GetTableCount() + 1}`)} autoFocus onFocus={(e) => e.currentTarget.select()} /></Field>
    </FormDialog>
  );
}

/** Rename Sheet (ScStringInputDlg) */
function RenameSheet({ c }: { c: Controller }) {
  const rDoc = c.sh.GetDocument();
  const nTab = c.view.GetViewData().GetTabNo();
  return (
    <FormDialog c={c} title={t('calc.renameSheet')} onSubmit={(f) => {
      const name = String(f.get('name') ?? '').trim();
      if (name === rDoc.GetName(nTab)) return;
      if (!name || !c.view.RenameTable(name, nTab)) { c.setMessage(t('calc.invalidSheetName')); return false; }
    }}>
      <Field label={t('calc.name')}><input name="name" data-testid="rename-sheet" defaultValue={rDoc.GetName(nTab)} autoFocus onFocus={(e) => e.currentTarget.select()} /></Field>
    </FormDialog>
  );
}

/** movecopysheet.ui: move or copy the sheet before another (or to the end), with a new name. */
function MoveSheet({ c }: { c: Controller }) {
  const rDoc = c.sh.GetDocument();
  const nTab = c.view.GetViewData().GetTabNo();
  const names = rDoc.GetAllTableNames();
  return (
    <FormDialog c={c} title={t('calc.moveSheet')} onSubmit={(f) => {
      const copy = f.get('action') === 'copy';
      const dest = parseInt(String(f.get('before')), 10);
      const name = String(f.get('name') ?? '').trim();
      if (!c.view.MoveTable(dest, copy, nTab)) return false;
      const nNew = c.view.GetViewData().GetTabNo();
      if (name && name !== rDoc.GetName(nNew) && !c.view.RenameTable(name, nNew)) c.setMessage(t('calc.invalidSheetName'));
    }}>
      <fieldset><legend>{t('calc.action')}</legend>
        <Radio name="action" value="move" label={t('calc.move')} checked />
        <Radio name="action" value="copy" label={t('calc.copy')} />
      </fieldset>
      <Field label={t('calc.insertBefore')}>
        <select name="before" size={Math.min(8, names.length + 1)} defaultValue={String(nTab)}>
          {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
          <option value={names.length}>{t('calc.moveToEnd')}</option>
        </select>
      </Field>
      <Field label={t('calc.newName')}><input name="name" defaultValue={rDoc.GetName(nTab)} /></Field>
    </FormDialog>
  );
}

/** tabcolordialog.ui: the palette and No Color. */
const TAB_COLORS = ['#ff0000', '#ff8000', '#ffff00', '#81d41a', '#00a933', '#2a6099', '#5983b0', '#800080', '#a1467e', '#808080', '#c9211e', '#ff4000', '#ffbf00', '#729fcf', '#3465a4', '#ffd7d7', '#ffe994', '#dee6ef', '#e8f2a1', '#000000'];
function TabColor({ c }: { c: Controller }) {
  const nTab = c.view.GetViewData().GetTabNo();
  const cur = c.sh.GetDocument().GetTabBgColor(nTab);
  const pick = (col: string | null) => {
    for (const n of c.view.GetViewData().GetMarkData().GetSelectedTabs()) c.view.SetTabBgColor(col, n);
    c.view.SetTabBgColor(col, nTab);
    c.setDialog(null);
  };
  return (
    <Modal c={c} title={t('calc.tabColor')}>
      <div className="color-swatches tab-colors">
        {TAB_COLORS.map((col) => <button key={col} type="button" className={`color-swatch${cur === col ? ' on' : ''}`} style={{ background: col }} title={col} aria-label={col} onClick={() => pick(col)} />)}
      </div>
      <p><label className="check">{t('calc.customColor')} <input type="color" defaultValue={cur ?? '#2a6099'} onChange={(e) => pick(e.target.value)} /></label></p>
      <footer>
        <button type="button" onClick={() => pick(null)}>{t('calc.noColor')}</button>
        <button type="button" onClick={() => c.setDialog(null)}>{t('common.cancel')}</button>
      </footer>
    </Modal>
  );
}

/** sortdialog.ui with sortkey.ui and sortoptionspage.ui, reduced: three keys, header, case. */
function Sort({ c }: { c: Controller }) {
  const view = c.view;
  const v = view.GetViewData();
  const r = view.GetSortArea();
  const rDoc = c.sh.GetDocument();
  const nTab = v.GetTabNo();
  const [header, setHeader] = useState(() => {
    for (let nCol = r.aStart.Col(); nCol <= r.aEnd.Col(); nCol++) if (rDoc.HasStringData(nCol, r.aStart.Row(), nTab) && r.aEnd.Row() > r.aStart.Row() && rDoc.HasValueData(nCol, r.aStart.Row() + 1, nTab)) return true;
    return false;
  });
  const cols: { n: number; label: string }[] = [];
  for (let nCol = r.aStart.Col(); nCol <= r.aEnd.Col(); nCol++) {
    const h = header ? rDoc.GetString(nCol, r.aStart.Row(), nTab) : '';
    cols.push({ n: nCol, label: h ? `${h}` : `${t('calc.column')} ${ScColToAlpha(nCol)}` });
  }
  const key = (i: number) => (
    <fieldset key={i}><legend>{t('calc.sortKey', { n: i + 1 })}</legend>
      <select name={`key${i}`} defaultValue={i === 0 ? String(Math.min(Math.max(v.GetCurX(), r.aStart.Col()), r.aEnd.Col())) : ''}>
        {i > 0 && <option value="">{t('calc.none')}</option>}
        {cols.map((col) => <option key={col.n} value={col.n}>{col.label}</option>)}
      </select>
      <Radio name={`dir${i}`} value="asc" label={t('calc.ascending')} checked />
      <Radio name={`dir${i}`} value="desc" label={t('calc.descending')} />
    </fieldset>
  );
  return (
    <FormDialog c={c} title={t('calc.sort')} onSubmit={(f) => {
      const p = new ScSortParam();
      p.nCol1 = r.aStart.Col(); p.nRow1 = r.aStart.Row(); p.nCol2 = r.aEnd.Col(); p.nRow2 = r.aEnd.Row();
      p.nSourceTab = nTab;
      p.bHasHeader = header;
      p.bCaseSens = f.get('case') === 'on';
      p.bByRow = true;
      p.maKeyState = [0, 1, 2].flatMap((i) => {
        const k = String(f.get(`key${i}`) ?? '');
        return k === '' ? [] : [{ nField: parseInt(k, 10), bDoSort: true, bAscending: f.get(`dir${i}`) !== 'desc', aColorSortMode: ScColorSortMode.None, aColorSortColor: null }];
      });
      if (p.maKeyState.length) view.Sort(p);
    }}>
      {key(0)}{key(1)}{key(2)}
      <label className="check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> {t('calc.rangeHasHeaders')}</label>
      <Check name="case" label={t('calc.caseSensitive')} />
    </FormDialog>
  );
}

/** pastespecial.ui, reduced: what to paste and skip empty cells. */
function PasteSpecial({ c }: { c: Controller }) {
  const clip = getLastClip();
  return (
    <FormDialog c={c} title={t('calc.pasteSpecial')} onSubmit={(f) => {
      if (!clip) return;
      let n = 0;
      if (f.get('all') === 'on') n = InsertDeleteFlags.ALL & ~InsertDeleteFlags.OBJECTS;
      else {
        if (f.get('text') === 'on') n |= InsertDeleteFlags.STRING;
        if (f.get('numbers') === 'on') n |= InsertDeleteFlags.VALUE;
        if (f.get('datetime') === 'on') n |= InsertDeleteFlags.DATETIME;
        if (f.get('formulas') === 'on') n |= InsertDeleteFlags.FORMULA;
        if (f.get('comments') === 'on') n |= InsertDeleteFlags.NOTE;
        if (f.get('formats') === 'on') n |= InsertDeleteFlags.ATTRIB;
      }
      if (n) c.view.PasteFromClip(n, clip.doc, f.get('skip') === 'on');
    }}>
      {!clip && <p className="muted">{t('calc.pasteSpecialEmpty')}</p>}
      <fieldset disabled={!clip}><legend>{t('calc.selection')}</legend>
        <Check name="all" label={t('calc.pasteAll')} checked />
        <Check name="text" label={t('calc.text')} checked />
        <Check name="numbers" label={t('calc.numbers')} checked />
        <Check name="datetime" label={t('calc.dateTime')} checked />
        <Check name="formulas" label={t('calc.formulas')} checked />
        <Check name="comments" label={t('calc.comments')} checked />
        <Check name="formats" label={t('calc.formats')} checked />
        <Check name="skip" label={t('calc.skipEmpty')} />
      </fieldset>
    </FormDialog>
  );
}

// --- Format Cells (sc/uiconfig/scalc/ui/formatcellsdialog.ui) ---

const CATEGORIES: [string, SvNumFormatType | 0][] = [['general', 0], ['number', SvNumFormatType.NUMBER], ['percent', SvNumFormatType.PERCENT], ['currency', SvNumFormatType.CURRENCY], ['date', SvNumFormatType.DATE], ['time', SvNumFormatType.TIME], ['scientific', SvNumFormatType.SCIENTIFIC], ['boolean', SvNumFormatType.LOGICAL], ['text', SvNumFormatType.TEXT]];
const LINE_STYLES: SvxBorderLineStyle[] = ['solid', 'dotted', 'dashed', 'double', 'dash-dot', 'dash-dot-dot', 'fine-dashed'];
const WIDTHS: [number, string][] = [[1, '0.05 pt'], [10, '0.50 pt'], [15, '0.75 pt'], [30, '1.50 pt'], [45, '2.25 pt'], [90, '4.50 pt']];

/** cui's number format page (SvxNumberFormatTabPage), reduced: category, options and the code. */
function NumbersPage({ c, code, setCode }: { c: Controller; code: string; setCode: (s: string) => void }) {
  const v = c.view.GetViewData();
  const fVal = c.sh.GetDocument().GetValue(v.GetCurX(), v.GetCurY(), v.GetTabNo());
  const eType = /^\s*General\s*$/i.test(code) ? 0 : GetType(code, 'en-US');
  const info = GetFormatSpecialInfo(code, 'en-US');
  const sample = (() => { try { return GetOutputString(fVal || 1234.5678, code, 'en-US').text; } catch { return ''; } })();
  const regen = (o: Partial<typeof info>) => {
    const i = { ...info, ...o };
    setCode(GenerateFormat(eType ? code : '0', 'en-US', i.bThousand, i.bNegRed, i.nPrecision, Math.max(1, i.nLeadingZeros)));
  };
  const numeric = eType === 0 || eType === SvNumFormatType.NUMBER || eType === SvNumFormatType.PERCENT || eType === SvNumFormatType.CURRENCY || eType === SvNumFormatType.SCIENTIFIC;
  return (
    <>
      <Field label={t('calc.category')}>
        <select value={CATEGORIES.find(([, ty]) => ty === eType)?.[0] ?? 'general'} onChange={(e) => {
          const ty = CATEGORIES.find(([k]) => k === e.target.value)![1];
          setCode(ty === 0 ? 'General' : ty === SvNumFormatType.NUMBER ? '0.00' : ty === SvNumFormatType.LOGICAL ? 'BOOLEAN' : GetStandardFormat(ty, 'en-US'));
        }}>
          {CATEGORIES.map(([k]) => <option key={k} value={k}>{t(`calc.cat.${k}`)}</option>)}
        </select>
      </Field>
      {numeric && <div className="row">
        <Field label={t('calc.decimalPlaces')}><input type="number" min={0} max={20} value={info.nPrecision} onChange={(e) => regen({ nPrecision: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
        <Field label={t('calc.leadingZeros')}><input type="number" min={0} max={20} value={Math.max(info.nLeadingZeros, eType ? 0 : 1)} onChange={(e) => regen({ nLeadingZeros: Math.max(0, parseInt(e.target.value, 10) || 0) })} /></Field>
      </div>}
      {numeric && <>
        <label className="check"><input type="checkbox" checked={info.bNegRed} onChange={(e) => regen({ bNegRed: e.target.checked })} /> {t('calc.negativeRed')}</label>
        <label className="check"><input type="checkbox" checked={info.bThousand} onChange={(e) => regen({ bThousand: e.target.checked })} /> {t('calc.thousandsSeparator')}</label>
      </>}
      <Field label={t('calc.formatCode')}><input name="numfmt" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} /></Field>
      <p className="format-preview" aria-label={t('calc.preview')}>{sample}</p>
    </>
  );
}

/** svx's frame selector, reduced: the sides of the cell (or of each cell of the selection) to line. */
function BordersPage({ init }: { init: { top: boolean; bottom: boolean; left: boolean; right: boolean; style: SvxBorderLineStyle; width: number; color: string } }) {
  const [sides, setSides] = useState({ top: init.top, bottom: init.bottom, left: init.left, right: init.right, innerH: false, innerV: false });
  const preset = (s: Partial<typeof sides>) => setSides({ top: false, bottom: false, left: false, right: false, innerH: false, innerV: false, ...s });
  const box = (k: keyof typeof sides) => <label className="check"><input type="checkbox" name={`b_${k}`} checked={sides[k]} onChange={(e) => setSides({ ...sides, [k]: e.target.checked })} /> {t(`calc.border.${k}`)}</label>;
  return (
    <>
      <div className="border-presets">
        <button type="button" onClick={() => preset({})}>{t('calc.border.none')}</button>
        <button type="button" onClick={() => preset({ top: true, bottom: true, left: true, right: true })}>{t('calc.border.box')}</button>
        <button type="button" onClick={() => preset({ top: true, bottom: true, left: true, right: true, innerH: true, innerV: true })}>{t('calc.border.all')}</button>
        <button type="button" onClick={() => preset({ top: true, bottom: true })}>{t('calc.border.topBottom')}</button>
      </div>
      <div className="border-preview" aria-hidden="true" style={{
        borderTop: sides.top ? '2px solid currentColor' : '1px dashed var(--line)', borderBottom: sides.bottom ? '2px solid currentColor' : '1px dashed var(--line)',
        borderLeft: sides.left ? '2px solid currentColor' : '1px dashed var(--line)', borderRight: sides.right ? '2px solid currentColor' : '1px dashed var(--line)',
      }} />
      <div className="grid2">{box('top')}{box('bottom')}{box('left')}{box('right')}{box('innerH')}{box('innerV')}</div>
      <div className="row">
        <Field label={t('calc.lineStyle')}><select name="b_style" defaultValue={init.style}>{LINE_STYLES.map((s) => <option key={s} value={s}>{t(`calc.line.${s}`)}</option>)}</select></Field>
        <Field label={t('calc.lineWidth')}><select name="b_width" defaultValue={String(init.width)}>{WIDTHS.map(([w, l]) => <option key={w} value={w}>{l}</option>)}</select></Field>
        <Field label={t('calc.lineColor')}><input type="color" name="b_color" defaultValue={init.color} /></Field>
      </div>
    </>
  );
}

function FormatCells({ c }: { c: Controller }) {
  const p = c.view.GetSelectionPattern();
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('calc:formatcells') ?? 'numbers'; } catch { return 'numbers'; } });
  const [code, setCode] = useState(p.GetNumberFormat());
  const [bgNone, setBgNone] = useState(!p.GetItem('ATTR_BACKGROUND'));
  const [fontAuto, setFontAuto] = useState(!p.GetItem('ATTR_FONT_COLOR'));
  const b = p.GetItem('ATTR_BORDER');
  const anyLine = b.top ?? b.bottom ?? b.left ?? b.right;
  const tabs = ['numbers', 'font', 'effects', 'alignment', 'borders', 'background'];
  const labels = Object.fromEntries(tabs.map((k) => [k, t(`calc.fmt.${k}`)]));
  const choose = (k: string) => { setTab(k); try { sessionStorage.setItem('calc:formatcells', k); } catch { /* storage unavailable */ } };
  return (
    <FormDialog c={c} title={t('calc.formatCells')} wide onSubmit={(f) => {
      const items: ScItemSet = {};
      // Numbers
      if (code !== p.GetNumberFormat()) items.ATTR_VALUE_FORMAT = code.trim() || 'General';
      // Font
      const font = String(f.get('font') ?? '').trim();
      if (font && font !== p.GetItem('ATTR_FONT')) items.ATTR_FONT = font;
      const size = parseFloat(String(f.get('size')));
      if (Number.isFinite(size) && Math.round(size * 20) !== p.GetItem('ATTR_FONT_HEIGHT')) items.ATTR_FONT_HEIGHT = Math.round(size * 20);
      const style = String(f.get('style'));
      const bold = style === 'bold' || style === 'bolditalic', italic = style === 'italic' || style === 'bolditalic';
      if (bold !== p.GetItem('ATTR_FONT_WEIGHT')) items.ATTR_FONT_WEIGHT = bold;
      if (italic !== p.GetItem('ATTR_FONT_POSTURE')) items.ATTR_FONT_POSTURE = italic;
      // Font Effects
      const color = fontAuto ? null : String(f.get('color'));
      if (color !== p.GetItem('ATTR_FONT_COLOR')) items.ATTR_FONT_COLOR = color;
      const under = String(f.get('underline')) as FontLineStyle, over = String(f.get('overline')) as FontLineStyle;
      if (under !== p.GetItem('ATTR_FONT_UNDERLINE')) items.ATTR_FONT_UNDERLINE = under;
      if (over !== p.GetItem('ATTR_FONT_OVERLINE')) items.ATTR_FONT_OVERLINE = over;
      const strike = f.get('strike') === 'on';
      if (strike !== p.GetItem('ATTR_FONT_CROSSEDOUT')) items.ATTR_FONT_CROSSEDOUT = strike;
      const outline = f.get('outline') === 'on', shadow = f.get('shadow') === 'on';
      if (outline !== p.GetItem('ATTR_FONT_CONTOUR')) items.ATTR_FONT_CONTOUR = outline;
      if (shadow !== p.GetItem('ATTR_FONT_SHADOWED')) items.ATTR_FONT_SHADOWED = shadow;
      // Alignment
      const hor = String(f.get('hor')) as SvxCellHorJustify, ver = String(f.get('ver')) as SvxCellVerJustify;
      if (hor !== p.GetItem('ATTR_HOR_JUSTIFY')) items.ATTR_HOR_JUSTIFY = hor;
      if (ver !== p.GetItem('ATTR_VER_JUSTIFY')) items.ATTR_VER_JUSTIFY = ver;
      const indent = Math.round(parseFloat(String(f.get('indent'))) * 20);
      if (Number.isFinite(indent) && indent !== p.GetItem('ATTR_INDENT')) items.ATTR_INDENT = Math.max(0, indent);
      const wrap = f.get('wrap') === 'on', shrink = f.get('shrink') === 'on';
      if (wrap !== p.GetItem('ATTR_LINEBREAK')) items.ATTR_LINEBREAK = wrap;
      if (shrink !== p.GetItem('ATTR_SHRINKTOFIT')) items.ATTR_SHRINKTOFIT = shrink;
      const rot = Math.round(parseFloat(String(f.get('rotate'))) * 100);
      if (Number.isFinite(rot) && rot !== p.GetItem('ATTR_ROTATE_VALUE')) items.ATTR_ROTATE_VALUE = ((rot % 36000) + 36000) % 36000;
      // Background
      const bg = bgNone ? null : String(f.get('bg'));
      if (bg !== p.GetItem('ATTR_BACKGROUND')) items.ATTR_BACKGROUND = bg;
      const rDocFunc = c.view.GetViewData().GetDocFunc();
      rDocFunc.EnterListAction(t('calc.formatCells'));
      if (Object.keys(items).length) c.view.ApplyAttributes(items);
      // Borders: applied to the selection's edges and inner lines
      const sides = ['top', 'bottom', 'left', 'right', 'innerH', 'innerV'].map((k) => f.get(`b_${k}`) === 'on');
      const was = [!!b.top, !!b.bottom, !!b.left, !!b.right];
      const line: SvxBorderLine = { style: String(f.get('b_style')) as SvxBorderLineStyle, width: parseInt(String(f.get('b_width')), 10) || 15, color: String(f.get('b_color')) };
      const changedLine = anyLine && (anyLine.style !== line.style || anyLine.width !== line.width || anyLine.color !== line.color);
      if (sides.some((s, i) => (i < 4 ? s !== was[i] : s)) || changedLine) {
        c.view.ApplyFrameLines(null, false, false, false, false, false, false, true);
        if (sides.some(Boolean)) c.view.ApplyFrameLines(line, sides[2]!, sides[3]!, sides[0]!, sides[1]!, sides[4]!, sides[5]!);
      }
      rDocFunc.EndListAction();
    }}>
      <Tabs ids={tabs} labels={labels} current={tab} onChange={choose} label={t('calc.formatCells')} />
      <div className="tab-pages">
        <Panel id="numbers" current={tab}><NumbersPage c={c} code={code} setCode={setCode} /></Panel>
        <Panel id="font" current={tab}>
          <Field label={t('calc.family')}><FontNameField c={c} name="font" value={p.GetItem('ATTR_FONT')} label={t('calc.family')} /></Field>
          <div className="row">
            <Field label={t('calc.style')}>
              <select name="style" defaultValue={p.GetItem('ATTR_FONT_WEIGHT') ? (p.GetItem('ATTR_FONT_POSTURE') ? 'bolditalic' : 'bold') : p.GetItem('ATTR_FONT_POSTURE') ? 'italic' : 'regular'}>
                {['regular', 'italic', 'bold', 'bolditalic'].map((s) => <option key={s} value={s}>{t(`calc.fontstyle.${s}`)}</option>)}
              </select>
            </Field>
            <Field label={t('calc.size')}><FontSizeCombo name="size" value={p.GetItem('ATTR_FONT_HEIGHT') / 20} label={t('calc.size')} /></Field>
          </div>
        </Panel>
        <Panel id="effects" current={tab}>
          <div className="row">
            <Field label={t('calc.fontColor')}><input type="color" name="color" defaultValue={p.GetItem('ATTR_FONT_COLOR') ?? '#000000'} disabled={fontAuto} /></Field>
            <label className="check"><input type="checkbox" checked={fontAuto} onChange={(e) => setFontAuto(e.target.checked)} /> {t('calc.automatic')}</label>
          </div>
          <div className="row">
            <Field label={t('calc.underline')}><select name="underline" defaultValue={p.GetItem('ATTR_FONT_UNDERLINE')}>{(['none', 'single', 'double', 'dotted', 'dash', 'wave'] as const).map((s) => <option key={s} value={s}>{t(`calc.uline.${s}`)}</option>)}</select></Field>
            <Field label={t('calc.overline')}><select name="overline" defaultValue={p.GetItem('ATTR_FONT_OVERLINE')}>{(['none', 'single', 'double'] as const).map((s) => <option key={s} value={s}>{t(`calc.uline.${s}`)}</option>)}</select></Field>
          </div>
          <Check name="strike" label={t('calc.strikethrough')} checked={p.GetItem('ATTR_FONT_CROSSEDOUT')} />
          <Check name="outline" label={t('calc.outline')} checked={p.GetItem('ATTR_FONT_CONTOUR')} />
          <Check name="shadow" label={t('calc.shadow')} checked={p.GetItem('ATTR_FONT_SHADOWED')} />
        </Panel>
        <Panel id="alignment" current={tab}>
          <div className="row">
            <Field label={t('calc.horizontal')}>
              <select name="hor" defaultValue={p.GetItem('ATTR_HOR_JUSTIFY')}>{(['Standard', 'Left', 'Center', 'Right', 'Block', 'Repeat'] as const).map((s) => <option key={s} value={s}>{t(`calc.hor.${s}`)}</option>)}</select>
            </Field>
            <Field label={t('calc.indent')}><input type="number" name="indent" min={0} step={1} defaultValue={p.GetItem('ATTR_INDENT') / 20} /></Field>
            <Field label={t('calc.vertical')}>
              <select name="ver" defaultValue={p.GetItem('ATTR_VER_JUSTIFY')}>{(['Standard', 'Top', 'Center', 'Bottom'] as const).map((s) => <option key={s} value={s}>{t(`calc.ver.${s}`)}</option>)}</select>
            </Field>
          </div>
          <Field label={t('calc.rotation')}><input type="number" name="rotate" min={0} max={359} defaultValue={p.GetItem('ATTR_ROTATE_VALUE') / 100} /></Field>
          <Check name="wrap" label={t('calc.wrapText')} checked={p.GetItem('ATTR_LINEBREAK')} />
          <Check name="shrink" label={t('calc.shrinkToFit')} checked={p.GetItem('ATTR_SHRINKTOFIT')} />
        </Panel>
        <Panel id="borders" current={tab}>
          <BordersPage init={{ top: !!b.top, bottom: !!b.bottom, left: !!b.left, right: !!b.right, style: anyLine?.style ?? 'solid', width: anyLine?.width ?? 15, color: anyLine?.color ?? '#000000' }} />
        </Panel>
        <Panel id="background" current={tab}>
          <label className="check"><input type="checkbox" checked={bgNone} onChange={(e) => setBgNone(e.target.checked)} /> {t('calc.noBackground')}</label>
          <Field label={t('calc.backgroundColor')}><input type="color" name="bg" defaultValue={p.GetItem('ATTR_BACKGROUND') ?? '#ffff00'} disabled={bgNone} /></Field>
        </Panel>
      </div>
    </FormDialog>
  );
}

/**
 * Find & Replace (svx's SvxSearchDialog, as a bar over the grid like Writer's): the text, the
 * replacement, match case, entire cells, and whether formulas or values are searched.
 */
function Find({ c }: { c: Controller }) {
  const [search, setSearch] = useState('');
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [cellType, setCellType] = useState<'formulas' | 'values'>('formulas');
  const [status, setStatus] = useState('');
  const run = (nCommand: ScSearchItem['nCommand'], bBackward = false) => {
    const n = c.view.SearchAndReplace({ aSearch: search, aReplace: replace, nCommand, bMatchCase: matchCase, bWholeCell: whole, bBackward, eCellType: cellType });
    setStatus(!n ? t('calc.searchNotFound') : nCommand === 'REPLACE_ALL' ? t('calc.replacedCount', { n }) : nCommand === 'FIND_ALL' ? t('calc.foundCount', { n }) : '');
  };
  return (
    <div className="findbar" role="dialog" aria-label={t('calc.findReplace')}>
      <input aria-label={t('calc.find')} placeholder={t('calc.find')} value={search} autoFocus onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run('FIND', e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); c.setDialog(null); } }} />
      <button onClick={() => run('FIND', true)}>{t('calc.findPrevious')}</button>
      <button onClick={() => run('FIND')}>{t('calc.findNext')}</button>
      <button onClick={() => run('FIND_ALL')}>{t('calc.findAll')}</button>
      <input aria-label={t('calc.replaceWith')} placeholder={t('calc.replaceWith')} value={replace} onChange={(e) => setReplace(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); c.setDialog(null); } }} />
      <button onClick={() => run('REPLACE')}>{t('calc.replace')}</button>
      <button onClick={() => run('REPLACE_ALL')}>{t('calc.replaceAll')}</button>
      <label className="check"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> {t('calc.matchCase')}</label>
      <label className="check"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> {t('calc.entireCells')}</label>
      <select aria-label={t('calc.searchIn')} value={cellType} onChange={(e) => setCellType(e.target.value as 'formulas' | 'values')}>
        <option value="formulas">{t('calc.searchFormulas')}</option>
        <option value="values">{t('calc.searchValues')}</option>
      </select>
      <span role="status" className="muted">{status}</span>
      <button aria-label={t('common.close')} onClick={() => c.setDialog(null)}>✕</button>
    </div>
  );
}

export function FindBar({ c }: { c: Controller }) { return c.dialog === 'find' ? <Find c={c} /> : null; }

export function Dialogs({ c }: { c: Controller }) {
  switch (c.dialog) {
    case 'insertcells': return <InsertCells c={c} />;
    case 'deletecells': return <DeleteCells c={c} />;
    case 'deletecontents': return <DeleteContents c={c} />;
    case 'rowheight': return <SizeDialog c={c} bWidth={false} />;
    case 'colwidth': return <SizeDialog c={c} bWidth />;
    case 'optimalrowheight': return <OptimalSizeDialog c={c} bWidth={false} />;
    case 'optimalcolwidth': return <OptimalSizeDialog c={c} bWidth />;
    case 'insertsheet': return <InsertSheet c={c} />;
    case 'renamesheet': return <RenameSheet c={c} />;
    case 'movesheet': return <MoveSheet c={c} />;
    case 'tabcolor': return <TabColor c={c} />;
    case 'sort': return <Sort c={c} />;
    case 'pastespecial': return <PasteSpecial c={c} />;
    case 'formatcells': return <FormatCells c={c} />;
    case 'find': return null;
    case 'standardfilter': case 'definedb': case 'selectdb': case 'subtotals': case 'validation': case 'condformat': case 'validityerror': return <DataDialogs c={c} />;
    default: return <ShellDialogs c={c} />;
  }
}

export { IsDark };
