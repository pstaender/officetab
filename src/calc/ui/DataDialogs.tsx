// The Data menu's dialogs: Standard Filter (sc/uiconfig/scalc/ui/standardfilterdialog.ui,
// ScFilterDlg), Define Database Range (definedatabaserangedialog.ui, ScDbNameDlg) and Select
// Database Range (selectrange.ui, ScSelEntryDlg). Subtotals and Validity follow in this file.
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Controller } from '../controller.ts';
import { Actions, Field, Modal, Panel, Tabs } from '@shell/ui/Dialogs.tsx';
import { t } from '@shell/i18n.ts';
import { ScColToAlpha, ScRange, ScRefFlags } from '@lo/sc/inc/address.ts';
import { ScGetDBMode, ScGetDBSelection, ScQueryConnect, ScQueryOp } from '@lo/sc/inc/global.ts';
import { ScQueryEntry } from '@lo/sc/inc/queryentry.ts';
import { ScFilterEntries } from '@lo/sc/inc/filterentries.ts';
import { SearchType } from '@lo/unotools/source/i18n/textsearch.ts';
import { ScDBData, STR_DB_LOCAL_NONAME } from '@lo/sc/source/core/tool/dbdata.ts';
import { ScDBDocFunc } from '@lo/sc/source/ui/docshell/dbdocfun.ts';
import { ScAddress } from '@lo/sc/inc/address.ts';
import { ScConditionMode } from '@lo/sc/source/core/data/conditio.ts';
import { ScValidationData, ScValidationMode, ScValidErrorStyle, TableValidationVisibility } from '@lo/sc/source/core/data/validat.ts';
import { ocSep } from '@lo/include/formula/opcode.ts';
import { FormulaCompiler } from '@lo/formula/source/core/api/FormulaCompiler.ts';
import { svString } from '@lo/formula/source/core/api/token.ts';

/** A dialog with a form; submit returns false to stay open. */
function FormDialog({ c, title, children, onSubmit, wide, ok, onCancel }: { c: Controller; title: string; children: ReactNode; onSubmit: (f: FormData) => boolean | void; wide?: boolean; ok?: string; onCancel?: () => void }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (onSubmit(new FormData(e.currentTarget)) === false) return;
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={title} wide={wide}>
      <form onSubmit={submit} onReset={() => { onCancel?.(); }} className="calc-dialog">
        {children}
        <Actions c={c} ok={ok} />
      </form>
    </Modal>
  );
}

const Check = ({ name, label, checked, onChange }: { name: string; label: string; checked?: boolean; onChange?: (b: boolean) => void }) => (
  <label className="check"><input type="checkbox" name={name} defaultChecked={checked} onChange={(e) => onChange?.(e.target.checked)} /> {label}</label>
);

/** The conditions of the standard filter in the order of its list (ScFilterDlg's condition box). */
const CONDITIONS: [ScQueryOp, string][] = [
  [ScQueryOp.SC_EQUAL, '='], [ScQueryOp.SC_LESS, '<'], [ScQueryOp.SC_GREATER, '>'], [ScQueryOp.SC_LESS_EQUAL, '<='], [ScQueryOp.SC_GREATER_EQUAL, '>='],
  [ScQueryOp.SC_NOT_EQUAL, '<>'], [ScQueryOp.SC_TOPVAL, 'calc.condLargest'], [ScQueryOp.SC_BOTVAL, 'calc.condSmallest'], [ScQueryOp.SC_TOPPERC, 'calc.condLargestPercent'],
  [ScQueryOp.SC_BOTPERC, 'calc.condSmallestPercent'], [ScQueryOp.SC_CONTAINS, 'calc.condContains'], [ScQueryOp.SC_DOES_NOT_CONTAIN, 'calc.condNotContains'],
  [ScQueryOp.SC_BEGINS_WITH, 'calc.condBeginsWith'], [ScQueryOp.SC_DOES_NOT_BEGIN_WITH, 'calc.condNotBeginsWith'], [ScQueryOp.SC_ENDS_WITH, 'calc.condEndsWith'],
  [ScQueryOp.SC_DOES_NOT_END_WITH, 'calc.condNotEndsWith'],
];
const condLabel = (s: string) => (s.startsWith('calc.') ? t(s) : s);
const QUERY_ROWS = 4;

/** Data > More Filters > Standard Filter (ScFilterDlg): up to four conditions on the database
    range of the selection, with the options. */
function StandardFilter({ c }: { c: Controller }) {
  const view = c.view;
  const rDoc = c.sh.GetDocument();
  const nTab = view.GetViewData().GetTabNo();
  const [pDBData] = useState(() => view.GetDBData(false, ScGetDBMode.SC_DB_MAKE, ScGetDBSelection.RowDown));
  const [aParam] = useState(() => pDBData!.GetQueryParam());
  const [header, setHeader] = useState(aParam.bHasHeader);
  const [copy, setCopy] = useState(!aParam.bInplace);

  const cols: { n: number; label: string }[] = [];
  for (let nCol = aParam.nCol1; nCol <= aParam.nCol2; nCol++) {
    const h = header ? rDoc.GetString(nCol, aParam.nRow1, nTab) : '';
    cols.push({ n: nCol, label: h || `${t('calc.column')} ${ScColToAlpha(nCol)}` });
  }
  /** The entries of a column for the value boxes (ScFilterDlg::UpdateValueList). */
  const values = (nCol: number): string[] => {
    const e = new ScFilterEntries();
    rDoc.FetchTable(nTab)?.GetFilterEntries(nCol, aParam.nRow1 + (header ? 1 : 0), aParam.nRow2, e, true);
    return [...new Set(e.maStrData.map((d) => d.GetString()).filter((s) => s !== ''))];
  };
  const entries = Array.from({ length: QUERY_ROWS }, (_, i) => {
    const e = aParam.GetEntry(i);
    if (!e.bDoQuery) return { field: '', op: ScQueryOp.SC_EQUAL as ScQueryOp, value: '', connect: ScQueryConnect.SC_AND as number };
    const item = e.GetQueryItem();
    const value = e.IsQueryByEmpty() ? t('calc.filterEmpty') : e.IsQueryByNonEmpty() ? t('calc.filterNotEmpty') : item.meType === ScQueryEntry.ByValue ? String(item.mfVal) : item.maString;
    return { field: String(e.nField), op: e.eOp, value, connect: e.eConnect };
  });
  const [fields, setFields] = useState(entries.map((e) => e.field));
  if (!pDBData) return null;

  return (
    <FormDialog c={c} title={t('calc.standardFilter')} wide onCancel={() => c.sh.CancelAutoDBRange(nTab)} onSubmit={(f) => {
      const p = pDBData.GetQueryParam();
      for (let i = 0; i < p.GetEntryCount(); i++) p.GetEntry(i).Clear();
      let n = 0;
      for (let i = 0; i < QUERY_ROWS; i++) {
        const field = String(f.get(`field${i}`) ?? '');
        if (field === '') break; // the conditions after an empty field are off (ScFilterDlg)
        const rEntry = p.GetEntry(n++);
        rEntry.bDoQuery = true;
        rEntry.nField = parseInt(field, 10);
        rEntry.eOp = Number(f.get(`op${i}`)) as ScQueryOp;
        rEntry.eConnect = i > 0 && f.get(`connect${i}`) === 'or' ? ScQueryConnect.SC_OR : ScQueryConnect.SC_AND;
        const value = String(f.get(`value${i}`) ?? '');
        if (value === t('calc.filterEmpty')) rEntry.SetQueryByEmpty();
        else if (value === t('calc.filterNotEmpty')) rEntry.SetQueryByNonEmpty();
        else {
          const rItem = rEntry.GetQueryItem();
          rItem.maString = value;
          rItem.meType = ScQueryEntry.ByString;
          rItem.mfVal = 0;
        }
      }
      p.bHasHeader = header;
      p.bCaseSens = f.get('case') === 'on';
      p.eSearchType = f.get('regex') === 'on' ? SearchType.Regexp : SearchType.Normal;
      p.bDuplicate = f.get('unique') !== 'on';
      p.bInplace = !copy;
      p.bDestPers = f.get('persistent') === 'on';
      if (copy) {
        const aDest = new ScRange();
        if (!(aDest.Parse(String(f.get('dest') ?? ''), rDoc) & ScRefFlags.VALID)) {
          c.setMessage(t('calc.invalidReference'));
          return false;
        }
        p.nDestTab = aDest.aStart.Tab();
        p.nDestCol = aDest.aStart.Col();
        p.nDestRow = aDest.aStart.Row();
      }
      pDBData.SetHeader(header);
      view.Query(p, null, true);
    }}>
      <fieldset><legend>{t('calc.filterCriteria')}</legend>
        <div className="filter-rows" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '4px 8px', alignItems: 'center' }}>
          <span>{t('calc.operator')}</span><span>{t('calc.fieldName')}</span><span>{t('calc.condition')}</span><span>{t('calc.value')}</span>
          {entries.map((e, i) => {
            const enabled = i === 0 || fields[i - 1] !== '';
            const field = fields[i] ?? '';
            return [
              i === 0 ? <span key={`c${i}`} /> : (
                <select key={`c${i}`} name={`connect${i}`} defaultValue={e.connect === ScQueryConnect.SC_OR ? 'or' : 'and'} disabled={!enabled} aria-label={t('calc.operator')}>
                  <option value="and">{t('calc.and')}</option><option value="or">{t('calc.or')}</option>
                </select>
              ),
              <select key={`f${i}`} name={`field${i}`} value={field} disabled={!enabled} aria-label={t('calc.fieldName')} data-testid={`filter-field${i}`}
                onChange={(ev) => setFields((fs) => fs.map((x, j) => (j === i ? ev.target.value : x)))}>
                <option value="">{t('calc.none')}</option>
                {cols.map((col) => <option key={col.n} value={col.n}>{col.label}</option>)}
              </select>,
              <select key={`o${i}`} name={`op${i}`} defaultValue={String(e.op)} disabled={!enabled || field === ''} aria-label={t('calc.condition')} data-testid={`filter-op${i}`}>
                {CONDITIONS.map(([op, s]) => <option key={op} value={op}>{condLabel(s)}</option>)}
              </select>,
              <span key={`v${i}`}>
                <input name={`value${i}`} defaultValue={e.value} list={`filter-values${i}`} disabled={!enabled || field === ''} aria-label={t('calc.value')} data-testid={`filter-value${i}`} />
                <datalist id={`filter-values${i}`}>
                  <option value={t('calc.filterEmpty')} /><option value={t('calc.filterNotEmpty')} />
                  {field !== '' && values(parseInt(field, 10)).map((s) => <option key={s} value={s} />)}
                </datalist>
              </span>,
            ];
          })}
        </div>
      </fieldset>
      <fieldset><legend>{t('calc.options')}</legend>
        <div className="grid2">
          <Check name="case" label={t('calc.caseSensitive')} checked={aParam.bCaseSens} />
          <label className="check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> {t('calc.rangeHasHeaders')}</label>
          <Check name="regex" label={t('calc.regularExpressions')} checked={aParam.eSearchType === SearchType.Regexp} />
          <Check name="unique" label={t('calc.noDuplications')} checked={!aParam.bDuplicate} />
          <label className="check"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> {t('calc.copyResultsTo')}</label>
          <Check name="persistent" label={t('calc.keepFilterCriteria')} checked={aParam.bDestPers} />
        </div>
        {copy && <Field label={t('calc.copyResultsTo')}><input name="dest" defaultValue={aParam.bInplace ? '' : new ScRange(aParam.nDestCol, aParam.nDestRow, aParam.nDestTab).Format(rDoc, ScRefFlags.RANGE_ABS_3D)} /></Field>}
      </fieldset>
    </FormDialog>
  );
}

/** Data > Define Range (ScDbNameDlg): named database ranges, added, modified and deleted. */
function DefineDB({ c }: { c: Controller }) {
  const view = c.view;
  const rDoc = c.sh.GetDocument();
  const rDBs = rDoc.GetDBCollection().getNamedDBs();
  const [, force] = useState(0);
  const [aSel] = useState(() => view.GetViewData().GetSimpleArea().rRange);
  const names = [...rDBs].map((p) => p.GetName());
  const [name, setName] = useState('');
  const existing = rDBs.findByUpperName(name.toUpperCase());
  const [range, setRange] = useState(() => aSel.Format(rDoc, ScRefFlags.RANGE_ABS_3D));
  const [header, setHeader] = useState(true);
  const pick = (n: string) => {
    setName(n);
    const p = rDBs.findByUpperName(n.toUpperCase());
    if (p) { setRange(p.GetArea().Format(rDoc, ScRefFlags.RANGE_ABS_3D)); setHeader(p.HasHeader()); }
  };
  const parse = (): ScRange | null => {
    const r = new ScRange();
    return r.Parse(range, rDoc) & ScRefFlags.VALID ? r : null;
  };
  const addModify = () => {
    const r = parse();
    if (!name || !/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) || name === STR_DB_LOCAL_NONAME) { c.setMessage(t('calc.invalidName')); return; }
    if (!r) { c.setMessage(t('calc.invalidReference')); return; }
    const aFunc = new ScDBDocFunc(c.sh);
    if (existing) {
      const pNew = new ScDBData(existing.GetName(), existing);
      pNew.MoveTo(r.aStart.Tab(), r.aStart.Col(), r.aStart.Row(), r.aEnd.Col(), r.aEnd.Row());
      pNew.SetHeader(header);
      aFunc.ModifyDBData(pNew);
    } else if (aFunc.AddDBRange(name, r)) {
      const p = rDBs.findByUpperName(name.toUpperCase());
      p?.SetHeader(header);
    }
    force((n) => n + 1);
    c.notify();
  };
  return (
    <FormDialog c={c} title={t('calc.defineDBRange')} onSubmit={() => { if (name && !existing) addModify(); }}>
      <Field label={t('calc.name')}><input value={name} list="db-names" onChange={(e) => pick(e.target.value)} data-testid="db-name" /></Field>
      <datalist id="db-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <select size={6} value={existing ? existing.GetName() : ''} onChange={(e) => pick(e.target.value)} aria-label={t('calc.name')}>
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <Field label={t('calc.range')}><input value={range} onChange={(e) => setRange(e.target.value)} data-testid="db-range" /></Field>
      <label className="check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> {t('calc.rangeHasHeaders')}</label>
      <div className="row">
        <button type="button" onClick={addModify}>{existing ? t('calc.modify') : t('calc.add')}</button>
        <button type="button" disabled={!existing} onClick={() => { new ScDBDocFunc(c.sh).DeleteDBRange(name); setName(''); force((n) => n + 1); c.notify(); }}>{t('calc.delete')}</button>
      </div>
    </FormDialog>
  );
}

/** Data > Select Range (ScSelEntryDlg): selects a named database range (GotoDBArea). */
function SelectDB({ c }: { c: Controller }) {
  const rDBs = c.sh.GetDocument().GetDBCollection().getNamedDBs();
  const names = [...rDBs].map((p) => p.GetName());
  return (
    <FormDialog c={c} title={t('calc.selectDBRange')} onSubmit={(f) => {
      const p = rDBs.findByName(String(f.get('db') ?? ''));
      if (!p) return false;
      const r = p.GetArea();
      if (r.aStart.Tab() !== c.view.GetViewData().GetTabNo()) c.view.SetTabNo(r.aStart.Tab());
      c.view.MarkRange(r, false);
      c.view.SetCursor(r.aStart.Col(), r.aStart.Row());
    }}>
      <select name="db" size={8} defaultValue={names[0]} aria-label={t('calc.selectDBRange')}>
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </FormDialog>
  );
}

/** The Allow list of the Criteria page (ScTPValidationValue): the mode, and for List whether the
    source is a cell range (Cell range) or entries (List). */
const ALLOW: [string, ScValidationMode, 'range' | 'list' | null][] = [
  ['calc.validAny', ScValidationMode.SC_VALID_ANY, null], ['calc.validWhole', ScValidationMode.SC_VALID_WHOLE, null], ['calc.validDecimal', ScValidationMode.SC_VALID_DECIMAL, null],
  ['calc.validDate', ScValidationMode.SC_VALID_DATE, null], ['calc.validTime', ScValidationMode.SC_VALID_TIME, null], ['calc.validRange', ScValidationMode.SC_VALID_LIST, 'range'],
  ['calc.validList', ScValidationMode.SC_VALID_LIST, 'list'], ['calc.validTextLen', ScValidationMode.SC_VALID_TEXTLEN, null], ['calc.validCustom', ScValidationMode.SC_VALID_CUSTOM, null],
];
/** The Data list (the condition) of the Criteria page. */
const VALID_CONDITIONS: [ScConditionMode, string][] = [
  [ScConditionMode.Equal, 'calc.condEqual'], [ScConditionMode.Less, 'calc.condLess'], [ScConditionMode.Greater, 'calc.condGreater'], [ScConditionMode.EqLess, 'calc.condEqLess'],
  [ScConditionMode.EqGreater, 'calc.condEqGreater'], [ScConditionMode.NotEqual, 'calc.condNotEqual'], [ScConditionMode.Between, 'calc.condBetween'], [ScConditionMode.NotBetween, 'calc.condNotBetween'],
];

/** The entries of a list formula, one per line ("a";"b" -> a, b), or null if it is no list of strings (ScTPValidationValue::lclGetStringListFromFormula). */
function listEntries(pData: ScValidationData): string[] | null {
  const pArr = pData.GetFormula1();
  if (!pArr) return null;
  const out: string[] = [];
  for (const t of pArr.GetArray()) {
    if (t.GetOpCode() === ocSep) continue;
    if (t.GetType() !== svString) return null;
    out.push(t.GetString());
  }
  return out;
}

/** Data > Validity (ScValidationDlg): Criteria, Input Help and Error Alert of the selection. */
function Validation({ c }: { c: Controller }) {
  const v = c.view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const aCursorPos = new ScAddress(v.GetCurX(), v.GetCurY(), v.GetTabNo());
  const [pOld] = useState(() => rDoc.GetValidationEntry(rDoc.GetAttr(aCursorPos.Col(), aCursorPos.Row(), aCursorPos.Tab(), 'ATTR_VALIDDATA')));
  const [tab, setTab] = useState('criteria');
  const initAllow = (() => {
    if (!pOld) return 0;
    const m = pOld.GetDataMode();
    if (m === ScValidationMode.SC_VALID_LIST) return listEntries(pOld) ? 6 : 5;
    return ALLOW.findIndex((a) => a[1] === m);
  })();
  const [allow, setAllow] = useState(initAllow);
  const [op, setOp] = useState<ScConditionMode>(pOld ? pOld.GetOperation() : ScConditionMode.Between);
  const expr = (n: 0 | 1) => (pOld && (n === 0 || pOld.HasSecondExpression()) ? pOld.GetExpression(aCursorPos, n) : '');
  const [input] = useState(() => pOld?.GetInput() ?? { bShow: true, aTitle: '', aMsg: '' });
  const [err] = useState(() => pOld?.GetErrMsg() ?? { bShow: true, aTitle: '', aMsg: '', eStyle: ScValidErrorStyle.SC_VALERR_STOP });
  const eMode = ALLOW[allow]![1];
  const source = ALLOW[allow]![2];
  const hasOp = eMode !== ScValidationMode.SC_VALID_ANY && eMode !== ScValidationMode.SC_VALID_LIST && eMode !== ScValidationMode.SC_VALID_CUSTOM;
  const two = hasOp && (op === ScConditionMode.Between || op === ScConditionMode.NotBetween);
  const sep = FormulaCompiler.GetNativeSymbol(ocSep);
  const labels = { criteria: t('calc.criteria'), input: t('calc.inputHelp'), error: t('calc.errorAlert') };
  return (
    <FormDialog c={c} title={t('calc.validity')} wide onSubmit={(f) => {
      let e1 = '', e2 = '';
      let eOp = op;
      if (source === 'list') {
        // one entry per line as a list of strings (lclGetFormulaFromStringList)
        const lines = String(f.get('entries') ?? '').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '');
        e1 = lines.map((l) => `"${l.replace(/"/g, '""')}"`).join(sep);
        eOp = ScConditionMode.Equal;
      } else if (source === 'range' || eMode === ScValidationMode.SC_VALID_CUSTOM) {
        e1 = String(f.get('source') ?? '');
        eOp = eMode === ScValidationMode.SC_VALID_CUSTOM ? ScConditionMode.Direct : ScConditionMode.Equal;
      } else if (hasOp) {
        e1 = String(f.get('min') ?? '');
        if (two) e2 = String(f.get('max') ?? '');
      }
      const aData = new ScValidationData(eMode, eOp, e1, e2, rDoc, aCursorPos);
      aData.SetIgnoreBlank(f.get('blank') === 'on');
      aData.SetListType(f.get('showlist') !== 'on' ? TableValidationVisibility.INVISIBLE : f.get('sortlist') === 'on' ? TableValidationVisibility.SORTEDASCENDING : TableValidationVisibility.UNSORTED);
      aData.SetCaseSensitive(f.get('case') === 'on');
      if (f.get('showinput') === 'on') aData.SetInput(String(f.get('inputtitle') ?? ''), String(f.get('inputmsg') ?? ''));
      else aData.ResetInput();
      if (f.get('showerror') === 'on') aData.SetError(String(f.get('errtitle') ?? ''), String(f.get('errmsg') ?? ''), Number(f.get('action')) as ScValidErrorStyle);
      else aData.ResetError();
      c.view.SetValidation(aData);
    }}>
      <Tabs ids={['criteria', 'input', 'error']} labels={labels} current={tab} onChange={setTab} label={t('calc.validity')} />
      <div className="tab-pages">
        <Panel id="criteria" current={tab}>
          <Field label={t('calc.allow')}>
            <select value={allow} onChange={(e) => setAllow(Number(e.target.value))} data-testid="valid-allow">
              {ALLOW.map((a, i) => <option key={a[0]} value={i}>{t(a[0])}</option>)}
            </select>
          </Field>
          <Check name="blank" label={t('calc.allowEmpty')} checked={pOld ? pOld.IsIgnoreBlank() : true} />
          {eMode === ScValidationMode.SC_VALID_LIST && <>
            <Check name="showlist" label={t('calc.showSelectionList')} checked={pOld ? pOld.GetListType() !== TableValidationVisibility.INVISIBLE : true} />
            <Check name="sortlist" label={t('calc.sortEntries')} checked={pOld?.GetListType() === TableValidationVisibility.SORTEDASCENDING} />
            <Check name="case" label={t('calc.caseSensitive')} checked={pOld?.IsCaseSensitive()} />
          </>}
          {hasOp && <Field label={t('calc.data')}>
            <select value={op} onChange={(e) => setOp(Number(e.target.value) as ScConditionMode)} data-testid="valid-op">
              {VALID_CONDITIONS.map(([o, k]) => <option key={o} value={o}>{t(k)}</option>)}
            </select>
          </Field>}
          {hasOp && <Field label={two ? t('calc.minimum') : t('calc.value')}><input name="min" defaultValue={expr(0)} data-testid="valid-min" /></Field>}
          {two && <Field label={t('calc.maximum')}><input name="max" defaultValue={expr(1)} data-testid="valid-max" /></Field>}
          {(source === 'range' || eMode === ScValidationMode.SC_VALID_CUSTOM) && <Field label={eMode === ScValidationMode.SC_VALID_CUSTOM ? t('calc.formula') : t('calc.source')}><input name="source" defaultValue={pOld && !listEntries(pOld) ? expr(0) : ''} data-testid="valid-source" /></Field>}
          {source === 'list' && <Field label={t('calc.entries')}><textarea name="entries" rows={6} defaultValue={pOld ? (listEntries(pOld) ?? []).join('\n') : ''} data-testid="valid-entries" /></Field>}
        </Panel>
        <Panel id="input" current={tab}>
          <Check name="showinput" label={t('calc.showInputHelp')} checked={input.bShow} />
          <Field label={t('calc.title')}><input name="inputtitle" defaultValue={input.aTitle} /></Field>
          <Field label={t('calc.inputHelp')}><textarea name="inputmsg" rows={4} defaultValue={input.aMsg} /></Field>
        </Panel>
        <Panel id="error" current={tab}>
          <Check name="showerror" label={t('calc.showErrorMessage')} checked={err.bShow} />
          <Field label={t('calc.action')}>
            <select name="action" defaultValue={err.eStyle}>
              <option value={ScValidErrorStyle.SC_VALERR_STOP}>{t('calc.actionStop')}</option>
              <option value={ScValidErrorStyle.SC_VALERR_WARNING}>{t('calc.actionWarning')}</option>
              <option value={ScValidErrorStyle.SC_VALERR_INFO}>{t('calc.actionInfo')}</option>
            </select>
          </Field>
          <Field label={t('calc.title')}><input name="errtitle" defaultValue={err.aTitle} /></Field>
          <Field label={t('calc.errorMessage')}><textarea name="errmsg" rows={4} defaultValue={err.aMsg} /></Field>
        </Panel>
      </div>
    </FormDialog>
  );
}

/** The error alert of invalid input (ScValidationData::DoError's message box): Stop with OK,
    Warning and Information with OK and Cancel. */
function ValidityError({ c }: { c: Controller }) {
  const v = c.validityError;
  if (!v) return null;
  const bStop = v.err.eStyle === ScValidErrorStyle.SC_VALERR_STOP;
  return (
    <Modal c={c} title={v.err.aTitle}>
      <p role="alert" style={{ whiteSpace: 'pre-wrap' }}>{v.err.aMessage}</p>
      <footer>
        {!bStop && <button type="button" onClick={() => v.resolve(false)}>{t('common.cancel')}</button>}
        <button type="button" className="primary" autoFocus onClick={() => v.resolve(!bStop)}>{t('common.ok')}</button>
      </footer>
    </Modal>
  );
}

export function DataDialogs({ c }: { c: Controller }) {
  switch (c.dialog) {
    case 'validation': return <Validation c={c} />;
    case 'validityerror': return <ValidityError c={c} />;
    case 'standardfilter': return <StandardFilter c={c} />;
    case 'definedb': return <DefineDB c={c} />;
    case 'selectdb': return <SelectDB c={c} />;
    default: return null;
  }
}
