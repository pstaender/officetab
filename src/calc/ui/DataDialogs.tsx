// The Data menu's dialogs: Standard Filter (sc/uiconfig/scalc/ui/standardfilterdialog.ui,
// ScFilterDlg), Define Database Range (definedatabaserangedialog.ui, ScDbNameDlg) and Select
// Database Range (selectrange.ui, ScSelEntryDlg). Subtotals and Validity follow in this file.
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Controller } from '../controller.ts';
import { Actions, Field, Modal, Panel, Tabs } from '@shell/ui/Dialogs.tsx';
import { t } from '@shell/i18n.ts';
import { ScColToAlpha, ScRange, ScRefFlags } from '@lo/sc/inc/address.ts';
import { ScGetDBMode, ScGetDBSelection, ScQueryConnect, ScQueryOp, ScSubTotalFunc } from '@lo/sc/inc/global.ts';
import { ScQueryEntry } from '@lo/sc/inc/queryentry.ts';
import { ScFilterEntries } from '@lo/sc/inc/filterentries.ts';
import { SearchType } from '@lo/unotools/source/i18n/textsearch.ts';
import { ScDBData, STR_DB_LOCAL_NONAME } from '@lo/sc/source/core/tool/dbdata.ts';
import { ScDBDocFunc } from '@lo/sc/source/ui/docshell/dbdocfun.ts';
import { ScAddress } from '@lo/sc/inc/address.ts';
import { ScCondFormatEntry, ScConditionMode, ScConditionalFormat } from '@lo/sc/source/core/data/conditio.ts';
import { ScRangeList } from '@lo/sc/inc/rangelst.ts';
import { ScDocFunc } from '@lo/sc/source/ui/docshell/docfunc.ts';
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

/** The function list of the Subtotals dialog (ScTpSubTotalGroup's function box). */
const SUBTOTAL_FUNCS: [ScSubTotalFunc, string][] = [
  [ScSubTotalFunc.SUBTOTAL_FUNC_SUM, 'calc.func.sum'], [ScSubTotalFunc.SUBTOTAL_FUNC_CNT2, 'calc.func.counta'], [ScSubTotalFunc.SUBTOTAL_FUNC_AVE, 'calc.func.average'],
  [ScSubTotalFunc.SUBTOTAL_FUNC_MAX, 'calc.func.max'], [ScSubTotalFunc.SUBTOTAL_FUNC_MIN, 'calc.func.min'], [ScSubTotalFunc.SUBTOTAL_FUNC_PROD, 'calc.subProduct'],
  [ScSubTotalFunc.SUBTOTAL_FUNC_CNT, 'calc.func.count'], [ScSubTotalFunc.SUBTOTAL_FUNC_STD, 'calc.subStdev'], [ScSubTotalFunc.SUBTOTAL_FUNC_STDP, 'calc.subStdevp'],
  [ScSubTotalFunc.SUBTOTAL_FUNC_VAR, 'calc.subVar'], [ScSubTotalFunc.SUBTOTAL_FUNC_VARP, 'calc.subVarp'],
];

/** Data > Subtotals (ScSubTotalDlg): up to three groups, each with the columns to total and a
    function, and the options. */
function SubTotals({ c }: { c: Controller }) {
  const view = c.view;
  const rDoc = c.sh.GetDocument();
  const nTab = view.GetViewData().GetTabNo();
  const [pDBData] = useState(() => view.GetDBData(true, ScGetDBMode.SC_DB_MAKE, ScGetDBSelection.RowDown));
  const [aParam] = useState(() => pDBData!.GetSubTotalParam());
  const [tab, setTab] = useState('g0');
  if (!pDBData) return null;
  const cols: { n: number; label: string }[] = [];
  for (let nCol = aParam.nCol1; nCol <= aParam.nCol2; nCol++) cols.push({ n: nCol, label: rDoc.GetString(nCol, aParam.nRow1, nTab) || `${t('calc.column')} ${ScColToAlpha(nCol)}` });
  const labels = { g0: t('calc.groupN', { n: 1 }), g1: t('calc.groupN', { n: 2 }), g2: t('calc.groupN', { n: 3 }), options: t('calc.options') };
  const apply = (f: FormData, bRemoveOnly: boolean) => {
    const p = pDBData.GetSubTotalParam();
    for (let g = 0; g < 3; g++) {
      const field = String(f.get(`group${g}`) ?? '');
      const grp = p.aGroups[g]!;
      grp.bActive = field !== '' && !bRemoveOnly;
      if (!grp.bActive) { grp.AllocSubTotals(0); continue; }
      grp.nField = parseInt(field, 10);
      const sel = cols.filter((col) => f.get(`g${g}c${col.n}`) === 'on').map((col) => col.n);
      const fn = Number(f.get(`func${g}`)) as ScSubTotalFunc;
      p.SetSubTotals(g + 1, sel, sel.map(() => fn), sel.length);
      if (!sel.length) grp.AllocSubTotals(0);
    }
    // the groups after an empty one are off (ScSubTotalDlg)
    for (let g = 0; g < 3; g++) if (!p.aGroups[g]!.bActive) for (let h = g + 1; h < 3; h++) p.aGroups[h]!.bActive = false;
    p.bRemoveOnly = bRemoveOnly;
    p.bReplace = f.get('replace') === 'on' || bRemoveOnly;
    p.bPagebreak = f.get('pagebreak') === 'on';
    p.bCaseSens = f.get('case') === 'on';
    p.bDoSort = f.get('sort') === 'on';
    p.bAscending = f.get('desc') !== 'on';
    p.bIncludePattern = f.get('formats') === 'on';
    p.bSummaryBelow = f.get('above') !== 'on';
    new ScDBDocFunc(c.sh).DoSubTotals(nTab, p, true, false);
    const r = pDBData.GetArea();
    view.MarkRange(r, false);
    const e = c.sh.GetLastError();
    if (e) { c.setMessage(e); c.sh.ClearLastError(); }
  };
  const group = (g: number) => {
    const grp = aParam.aGroups[g]!;
    const active = grp.bActive && (g === 0 || aParam.aGroups[g - 1]!.bActive);
    const checked = new Set(active ? grp.subtotals().map(([col]) => col) : []);
    return (
      <Panel id={`g${g}`} current={tab} key={g}>
        <Field label={t('calc.groupBy')}>
          <select name={`group${g}`} defaultValue={active ? String(grp.nField) : ''} data-testid={`sub-group${g}`}>
            <option value="">{t('calc.none')}</option>
            {cols.map((col) => <option key={col.n} value={col.n}>{col.label}</option>)}
          </select>
        </Field>
        <fieldset><legend>{t('calc.calculateSubtotalsFor')}</legend>
          {cols.map((col) => <Check key={col.n} name={`g${g}c${col.n}`} label={col.label} checked={checked.has(col.n)} />)}
        </fieldset>
        <Field label={t('calc.useFunction')}>
          <select name={`func${g}`} defaultValue={active && grp.nSubTotals ? grp.func(0) : ScSubTotalFunc.SUBTOTAL_FUNC_SUM} data-testid={`sub-func${g}`}>
            {SUBTOTAL_FUNCS.map(([fn, k]) => <option key={fn} value={fn}>{t(k)}</option>)}
          </select>
        </Field>
      </Panel>
    );
  };
  return (
    <Modal c={c} title={t('calc.subtotals')} wide>
      <form className="calc-dialog" onSubmit={(e) => {
        e.preventDefault();
        const bRemove = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'remove';
        apply(new FormData(e.currentTarget), bRemove);
        c.setDialog(null);
        c.notify();
      }}>
        <Tabs ids={['g0', 'g1', 'g2', 'options']} labels={labels} current={tab} onChange={setTab} label={t('calc.subtotals')} />
        <div className="tab-pages">
          {group(0)}{group(1)}{group(2)}
          <Panel id="options" current={tab}>
            <Check name="replace" label={t('calc.replaceSubtotals')} checked={aParam.bReplace} />
            <Check name="pagebreak" label={t('calc.pageBreakGroups')} checked={aParam.bPagebreak} />
            <Check name="case" label={t('calc.caseSensitive')} checked={aParam.bCaseSens} />
            <Check name="sort" label={t('calc.preSortGroups')} checked={aParam.bDoSort} />
            <Check name="desc" label={t('calc.descending')} checked={!aParam.bAscending} />
            <Check name="formats" label={t('calc.includeFormats')} checked={aParam.bIncludePattern} />
            <Check name="above" label={t('calc.summaryAbove')} checked={!aParam.bSummaryBelow} />
          </Panel>
        </div>
        <footer>
          <button type="submit" value="remove">{t('calc.removeAll')}</button>
          <button type="button" onClick={() => { c.sh.CancelAutoDBRange(nTab); c.setDialog(null); }}>{t('common.cancel')}</button>
          <button type="submit" className="primary" value="ok">{t('common.ok')}</button>
        </footer>
      </form>
    </Modal>
  );
}

/** The conditions of "Cell value is" (ScConditionFrmtEntry's operator list, in its order). */
const COND_OPS: [ScConditionMode, string][] = [
  [ScConditionMode.Equal, 'calc.cfEqual'], [ScConditionMode.Less, 'calc.cfLess'], [ScConditionMode.Greater, 'calc.cfGreater'], [ScConditionMode.EqLess, 'calc.cfEqLess'],
  [ScConditionMode.EqGreater, 'calc.cfEqGreater'], [ScConditionMode.NotEqual, 'calc.cfNotEqual'], [ScConditionMode.Between, 'calc.cfBetween'], [ScConditionMode.NotBetween, 'calc.cfNotBetween'],
  [ScConditionMode.Duplicate, 'calc.cfDuplicate'], [ScConditionMode.NotDuplicate, 'calc.cfNotDuplicate'], [ScConditionMode.Top10, 'calc.cfTop10'], [ScConditionMode.Bottom10, 'calc.cfBottom10'],
  [ScConditionMode.TopPercent, 'calc.cfTopPercent'], [ScConditionMode.BottomPercent, 'calc.cfBottomPercent'], [ScConditionMode.AboveAverage, 'calc.cfAboveAverage'],
  [ScConditionMode.BelowAverage, 'calc.cfBelowAverage'], [ScConditionMode.AboveEqualAverage, 'calc.cfAboveEqualAverage'], [ScConditionMode.BelowEqualAverage, 'calc.cfBelowEqualAverage'],
  [ScConditionMode.Error, 'calc.cfError'], [ScConditionMode.NoError, 'calc.cfNoError'], [ScConditionMode.BeginsWith, 'calc.cfBeginsWith'], [ScConditionMode.EndsWith, 'calc.cfEndsWith'],
  [ScConditionMode.ContainsText, 'calc.cfContains'], [ScConditionMode.NotContainsText, 'calc.cfNotContains'],
];
/** How many values a condition takes (ScConditionFrmtEntry::OnConditionTypeChanged). */
const condArgs = (op: ScConditionMode): number => {
  if (op === ScConditionMode.Between || op === ScConditionMode.NotBetween) return 2;
  if (op === ScConditionMode.Duplicate || op === ScConditionMode.NotDuplicate || op === ScConditionMode.AboveAverage || op === ScConditionMode.BelowAverage
    || op === ScConditionMode.AboveEqualAverage || op === ScConditionMode.BelowEqualAverage || op === ScConditionMode.Error || op === ScConditionMode.NoError) return 0;
  return 1;
};

interface CondRow { id: number; op: ScConditionMode; e1: string; e2: string; style: string }

/** Format > Conditional > Condition (ScCondFormatDlg): the conditions of a range, each a cell
    value condition or a formula, applying a cell style; new for the selection, or the format at
    the cursor (c.condFormatKey). Colour scales, data bars, icon sets and dates are not offered. */
function CondFormat({ c }: { c: Controller }) {
  const v = c.view.GetViewData();
  const rDoc = c.sh.GetDocument();
  const nTab = v.GetTabNo();
  const aPos = new ScAddress(v.GetCurX(), v.GetCurY(), nTab);
  const [nKey] = useState(() => c.condFormatKey);
  const [pOld] = useState(() => (nKey ? rDoc.GetCondFormList(nTab)?.GetFormat(nKey) ?? null : null));
  const [aRange] = useState(() => {
    if (pOld) return pOld.GetRange().Format(rDoc, ScRefFlags.VALID | ScRefFlags.TAB_3D);
    const l = new ScRangeList();
    const aMark = v.GetMarkData().clone();
    aMark.MarkToMulti();
    aMark.FillRangeListWithMarks(l, false, nTab);
    if (!l.size()) l.push_back(new ScRange(aPos));
    return l.Format(rDoc, ScRefFlags.VALID);
  });
  const styles = rDoc.GetStyleSheetPool().GetStyles().map((st) => st.GetName());
  const aSrc = pOld?.GetRange().front()?.aStart ?? aPos;
  let nextId = 1;
  const [rows, setRows] = useState<CondRow[]>(() => {
    const out: CondRow[] = [];
    for (let i = 0; pOld && i < pOld.size(); i++) {
      const e = pOld.GetEntry(i)!;
      out.push({ id: nextId++, op: e.GetOperation(), e1: e.GetExpression(aSrc, 0), e2: e.HasSecondExpression() ? e.GetExpression(aSrc, 1) : '', style: e.GetStyle() });
    }
    if (!out.length) out.push({ id: nextId++, op: ScConditionMode.Equal, e1: '', e2: '', style: styles.includes('Accent') ? 'Accent' : styles[0]! });
    return out;
  });
  const [err, setErr] = useState('');
  const set = (i: number, r: Partial<CondRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...r } : x)));
  return (
    <FormDialog c={c} title={t('calc.conditionalFormatting')} wide onSubmit={(f) => {
      const aRanges = new ScRangeList();
      const nFlags = aRanges.Parse(String(f.get('range') ?? ''), rDoc, undefined, nTab);
      if (!(nFlags & ScRefFlags.VALID) || !aRanges.size()) { setErr(t('calc.invalidRange')); return false; }
      const aFirst = aRanges.front()!.aStart;
      const pFormat = new ScConditionalFormat(0, rDoc);
      for (const r of rows) {
        const n = r.op === ScConditionMode.Direct ? 1 : condArgs(r.op);
        pFormat.AddEntry(new ScCondFormatEntry(r.op, n >= 1 ? r.e1 : '', n >= 2 ? r.e2 : '', rDoc, aFirst, r.style));
      }
      new ScDocFunc(c.sh).ReplaceConditionalFormat(nKey, pFormat, nTab, aRanges);
      c.notify();
    }}>
      <div className="calc-cond-rows">
        {rows.map((r, i) => {
          const n = r.op === ScConditionMode.Direct ? 1 : condArgs(r.op);
          return (
            <fieldset key={r.id} data-testid={`cond-${i}`}>
              <legend>{t('calc.conditionN', { n: i + 1 })}</legend>
              <div className="calc-cond-line">
                <select aria-label={t('calc.conditionType')} value={r.op === ScConditionMode.Direct ? 'formula' : 'value'}
                  onChange={(e) => set(i, { op: e.target.value === 'formula' ? ScConditionMode.Direct : ScConditionMode.Equal })}>
                  <option value="value">{t('calc.cfCellValue')}</option>
                  <option value="formula">{t('calc.cfFormula')}</option>
                </select>
                {r.op !== ScConditionMode.Direct && (
                  <select aria-label={t('calc.condition')} value={r.op} onChange={(e) => set(i, { op: Number(e.target.value) as ScConditionMode })}>
                    {COND_OPS.map(([op, k]) => <option key={op} value={op}>{t(k)}</option>)}
                  </select>
                )}
                {n >= 1 && <input aria-label={t('calc.value')} value={r.e1} onChange={(e) => set(i, { e1: e.target.value })} />}
                {n >= 2 && <input aria-label={t('calc.value2')} value={r.e2} onChange={(e) => set(i, { e2: e.target.value })} />}
              </div>
              <Field label={t('calc.applyStyle')}>
                <select value={r.style} onChange={(e) => set(i, { style: e.target.value })}>
                  {styles.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </Field>
              <button type="button" disabled={rows.length < 2} onClick={() => setRows(rows.filter((_, j) => j !== i))}>{t('calc.remove')}</button>
            </fieldset>
          );
        })}
        <button type="button" onClick={() => setRows([...rows, { id: Math.max(...rows.map((x) => x.id)) + 1, op: ScConditionMode.Equal, e1: '', e2: '', style: rows[rows.length - 1]!.style }])}>{t('calc.add')}</button>
      </div>
      <Field label={t('calc.cellRange')}><input name="range" defaultValue={aRange} /></Field>
      {err && <p role="alert">{err}</p>}
    </FormDialog>
  );
}

/** Format > Conditional > Manage (ScCondFormatManagerDlg): the formats of the sheet, to edit or
    remove. */
function CondFormatManager({ c }: { c: Controller }) {
  const rDoc = c.sh.GetDocument();
  const nTab = c.view.GetViewData().GetTabNo();
  const [, setTick] = useState(0);
  const pList = rDoc.GetCondFormList(nTab);
  const formats = pList ? [...pList] : [];
  const [sel, setSel] = useState(formats[0]?.GetKey() ?? 0);
  const describe = (f: ScConditionalFormat) => {
    const e = f.GetEntry(0);
    if (!e) return '';
    const aSrc = f.GetRange().front()?.aStart ?? new ScAddress(0, 0, nTab);
    if (e.GetOperation() === ScConditionMode.Direct) return `${t('calc.cfFormula')} ${e.GetExpression(aSrc, 0)}`;
    const op = COND_OPS.find(([o]) => o === e.GetOperation());
    const n = condArgs(e.GetOperation());
    return `${t('calc.cfCellValue')} ${op ? t(op[1]) : ''}${n >= 1 ? ' ' + e.GetExpression(aSrc, 0) : ''}${n >= 2 ? ` ${t('calc.and')} ` + e.GetExpression(aSrc, 1) : ''}`;
  };
  return (
    <Modal c={c} title={t('calc.manageConditionalFormatting')} wide>
      <div className="calc-dialog">
        <table className="calc-cond-list">
          <thead><tr><th>{t('calc.range')}</th><th>{t('calc.firstCondition')}</th></tr></thead>
          <tbody>
            {formats.map((f) => (
              <tr key={f.GetKey()} aria-selected={f.GetKey() === sel} onClick={() => setSel(f.GetKey())} onDoubleClick={() => { c.condFormatKey = f.GetKey(); c.setDialog('condformat'); }}>
                <td>{f.GetRange().Format(rDoc, ScRefFlags.VALID)}</td><td>{describe(f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <footer>
          <button type="button" onClick={() => { c.condFormatKey = 0; c.setDialog('condformat'); }}>{t('calc.add')}</button>
          <button type="button" disabled={!sel} onClick={() => { c.condFormatKey = sel; c.setDialog('condformat'); }}>{t('calc.edit')}</button>
          <button type="button" disabled={!sel} onClick={() => {
            new ScDocFunc(c.sh).ReplaceConditionalFormat(sel, null, nTab, new ScRangeList());
            setSel([...(rDoc.GetCondFormList(nTab) ?? [])][0]?.GetKey() ?? 0);
            setTick((n) => n + 1);
            c.notify();
          }}>{t('calc.remove')}</button>
          <button type="button" className="primary" onClick={() => c.setDialog(null)}>{t('common.close')}</button>
        </footer>
      </div>
    </Modal>
  );
}

export function DataDialogs({ c }: { c: Controller }) {
  switch (c.dialog) {
    case 'condformat': return <CondFormat c={c} />;
    case 'condformatmanager': return <CondFormatManager c={c} />;
    case 'subtotals': return <SubTotals c={c} />;
    case 'validation': return <Validation c={c} />;
    case 'validityerror': return <ValidityError c={c} />;
    case 'standardfilter': return <StandardFilter c={c} />;
    case 'definedb': return <DefineDB c={c} />;
    case 'selectdb': return <SelectDB c={c} />;
    default: return null;
  }
}
