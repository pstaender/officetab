// The Data menu's dialogs: Standard Filter (sc/uiconfig/scalc/ui/standardfilterdialog.ui,
// ScFilterDlg), Define Database Range (definedatabaserangedialog.ui, ScDbNameDlg) and Select
// Database Range (selectrange.ui, ScSelEntryDlg). Subtotals and Validity follow in this file.
import { useState, type FormEvent, type ReactNode } from 'react';
import type { Controller } from '../controller.ts';
import { Actions, Field, Modal } from '@shell/ui/Dialogs.tsx';
import { t } from '@shell/i18n.ts';
import { ScColToAlpha, ScRange, ScRefFlags } from '@lo/sc/inc/address.ts';
import { ScGetDBMode, ScGetDBSelection, ScQueryConnect, ScQueryOp } from '@lo/sc/inc/global.ts';
import { ScQueryEntry } from '@lo/sc/inc/queryentry.ts';
import { ScFilterEntries } from '@lo/sc/inc/filterentries.ts';
import { SearchType } from '@lo/unotools/source/i18n/textsearch.ts';
import { ScDBData, STR_DB_LOCAL_NONAME } from '@lo/sc/source/core/tool/dbdata.ts';
import { ScDBDocFunc } from '@lo/sc/source/ui/docshell/dbdocfun.ts';

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

export function DataDialogs({ c }: { c: Controller }) {
  switch (c.dialog) {
    case 'standardfilter': return <StandardFilter c={c} />;
    case 'definedb': return <DefineDB c={c} />;
    case 'selectdb': return <SelectDB c={c} />;
    default: return null;
  }
}
