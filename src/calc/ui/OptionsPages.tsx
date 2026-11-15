// Calc's pages of Tools > Options (LibreOffice Calc > General, View, Calculate, Formula), added
// to the shell's through the registry. The input and view options are kept in this browser (as
// LibreOffice keeps them in the user profile); the calculation options are the document's
// (ScDocOptions), as in LibreOffice.
import { t } from '@shell/i18n.ts';
import type { OptionsPage } from '@shell/ui/registry.ts';
import type { Controller } from '../controller.ts';
import { ScDirection } from '@lo/sc/inc/global.ts';
import { ViewOption } from '@lo/sc/inc/viewopti.ts';
import { FormulaGrammar } from '@lo/include/formula/grammar.ts';

const Check = ({ name, label, checked }: { name: string; label: string; checked: boolean }) => (
  <label className="check"><input type="checkbox" name={name} defaultChecked={checked} /> {label}</label>
);

/** scgeneralpage.ui: the input settings. */
const GENERAL: OptionsPage<Controller> = {
  id: 'calc-general',
  after: 'fonts',
  label: () => t('calc.opt.general'),
  render: (c) => {
    const o = c.inputOptions;
    return <>
      <h3>{t('calc.opt.general')}</h3>
      <fieldset><legend>{t('calc.opt.input')}</legend>
        <div className="row">
          <Check name="calc-movesel" label={t('calc.opt.moveSelection')} checked={o.GetMoveSelection()} />
          <select name="calc-movedir" aria-label={t('calc.opt.moveDirection')} defaultValue={String(o.GetMoveDir())}>
            <option value={ScDirection.DIR_BOTTOM}>{t('calc.opt.down')}</option>
            <option value={ScDirection.DIR_RIGHT}>{t('calc.opt.right')}</option>
            <option value={ScDirection.DIR_TOP}>{t('calc.opt.up')}</option>
            <option value={ScDirection.DIR_LEFT}>{t('calc.opt.left')}</option>
          </select>
        </div>
        <Check name="calc-enteredit" label={t('calc.opt.enterEdit')} checked={o.GetEnterEdit()} />
        <Check name="calc-expandrefs" label={t('calc.opt.expandRefs')} checked={o.GetExpandRefs()} />
        <Check name="calc-markheader" label={t('calc.opt.markHeader')} checked={o.GetMarkHeader()} />
        <Check name="calc-rangefinder" label={t('calc.opt.rangeFinder')} checked={o.GetRangeFinder()} />
        <Check name="calc-autoinput" label={t('calc.opt.autoInput')} checked={c.appOptions.GetAutoComplete()} />
        <Check name="calc-legacysel" label={t('calc.opt.legacySelection')} checked={o.GetLegacyCellSelection()} />
      </fieldset>
    </>;
  },
  apply: (c, f) => {
    const o = c.inputOptions;
    o.SetMoveSelection(f.get('calc-movesel') === 'on');
    o.SetMoveDir(Number(f.get('calc-movedir')));
    o.SetEnterEdit(f.get('calc-enteredit') === 'on');
    o.SetExpandRefs(f.get('calc-expandrefs') === 'on');
    o.SetMarkHeader(f.get('calc-markheader') === 'on');
    o.SetRangeFinder(f.get('calc-rangefinder') === 'on');
    o.SetLegacyCellSelection(f.get('calc-legacysel') === 'on');
    c.appOptions.SetAutoComplete(f.get('calc-autoinput') === 'on');
    c.sh.GetDocument().SetExpandRefs(o.GetExpandRefs());
    c.saveOptions();
  },
};

/** tpviewpage.ui: what the view shows. */
const VIEW: OptionsPage<Controller> = {
  id: 'calc-view',
  after: 'calc-general',
  label: () => t('calc.opt.view'),
  render: (c) => {
    const o = c.viewOptions;
    return <>
      <h3>{t('calc.opt.view')}</h3>
      <fieldset><legend>{t('calc.opt.display')}</legend>
        <Check name="calc-formulas" label={t('calc.opt.formulas')} checked={o.GetOption(ViewOption.FORMULAS)} />
        <Check name="calc-nullvals" label={t('calc.opt.zeroValues')} checked={o.GetOption(ViewOption.NULLVALS)} />
      </fieldset>
      <fieldset><legend>{t('calc.opt.windows')}</legend>
        <Check name="calc-header" label={t('calc.opt.headers')} checked={o.GetOption(ViewOption.HEADER)} />
        <Check name="calc-grid" label={t('calc.opt.grid')} checked={o.GetOption(ViewOption.GRID)} />
        <label className="field"><span>{t('calc.opt.gridColor')}</span><input type="color" name="calc-gridcolor" defaultValue={o.GetGridColor()} /></label>
      </fieldset>
    </>;
  },
  apply: (c, f) => {
    const o = c.viewOptions;
    o.SetOption(ViewOption.FORMULAS, f.get('calc-formulas') === 'on');
    o.SetOption(ViewOption.NULLVALS, f.get('calc-nullvals') === 'on');
    o.SetOption(ViewOption.HEADER, f.get('calc-header') === 'on');
    o.SetOption(ViewOption.GRID, f.get('calc-grid') === 'on');
    o.SetGridColor(String(f.get('calc-gridcolor') ?? '#c0c0c0'), '');
    c.saveOptions();
  },
};

/** optcalculatepage.ui: the document's calculation settings (ScDocOptions). */
const CALCULATE: OptionsPage<Controller> = {
  id: 'calc-calculate',
  after: 'calc-view',
  label: () => t('calc.opt.calculate'),
  render: (c) => {
    const o = c.sh.GetDocument().GetDocOptions();
    const d = o.GetDate();
    const nullDate = d.nYear === 1900 ? '1900' : d.nYear === 1904 ? '1904' : '1899';
    return <>
      <h3>{t('calc.opt.calculate')}</h3>
      <fieldset><legend>{t('calc.opt.iterations')}</legend>
        <Check name="calc-iter" label={t('calc.opt.iterate')} checked={o.IsIter()} />
        <div className="row">
          <label className="field"><span>{t('calc.opt.steps')}</span><input type="number" name="calc-itercount" min={1} max={1000} defaultValue={o.GetIterCount()} /></label>
          <label className="field"><span>{t('calc.opt.minChange')}</span><input type="number" name="calc-itereps" step="0.0001" min={0} defaultValue={o.GetIterEps()} /></label>
        </div>
      </fieldset>
      <fieldset><legend>{t('calc.opt.date')}</legend>
        <label className="check"><input type="radio" name="calc-nulldate" value="1899" defaultChecked={nullDate === '1899'} /> 12/30/1899 ({t('calc.opt.default')})</label>
        <label className="check"><input type="radio" name="calc-nulldate" value="1900" defaultChecked={nullDate === '1900'} /> 01/01/1900</label>
        <label className="check"><input type="radio" name="calc-nulldate" value="1904" defaultChecked={nullDate === '1904'} /> 01/01/1904</label>
      </fieldset>
      <Check name="calc-case" label={t('calc.opt.caseSensitive')} checked={!o.IsIgnoreCase()} />
      <Check name="calc-asshown" label={t('calc.opt.precisionAsShown')} checked={o.IsCalcAsShown()} />
      <Check name="calc-wholecell" label={t('calc.opt.wholeCell')} checked={o.IsMatchWholeCell()} />
      <p className="muted">{t('calc.opt.documentSettings')}</p>
    </>;
  },
  apply: (c, f) => {
    const rDoc = c.sh.GetDocument();
    const o = rDoc.GetDocOptions().clone();
    o.SetIter(f.get('calc-iter') === 'on');
    o.SetIterCount(Math.max(1, parseInt(String(f.get('calc-itercount')), 10) || 100));
    o.SetIterEps(Math.max(0, parseFloat(String(f.get('calc-itereps'))) || 0.001));
    const nd = String(f.get('calc-nulldate'));
    if (nd === '1900') o.SetDate(1, 1, 1900); else if (nd === '1904') o.SetDate(1, 1, 1904); else o.SetDate(30, 12, 1899);
    o.SetIgnoreCase(f.get('calc-case') !== 'on');
    o.SetCalcAsShown(f.get('calc-asshown') === 'on');
    o.SetMatchWholeCell(f.get('calc-wholecell') === 'on');
    if (!o.equals(rDoc.GetDocOptions())) {
      rDoc.SetDocOptions(o);
      rDoc.CalcAll();
      c.sh.SetDocumentModified();
      c.sh.PostPaintGridAll();
    }
  },
};

/** optformula.ui, reduced to the formula syntax (the separators are Calc's own: ";" and ","). */
const FORMULA: OptionsPage<Controller> = {
  id: 'calc-formula',
  after: 'calc-calculate',
  label: () => t('calc.opt.formula'),
  render: (c) => {
    const g = c.sh.GetDocument().GetGrammar();
    const v = g === FormulaGrammar.GRAM_NATIVE_XL_A1 ? 'xla1' : g === FormulaGrammar.GRAM_NATIVE_XL_R1C1 ? 'xlr1c1' : 'calc';
    return <>
      <h3>{t('calc.opt.formula')}</h3>
      <label className="field"><span>{t('calc.opt.syntax')}</span>
        <select name="calc-syntax" defaultValue={v}>
          <option value="calc">Calc A1</option>
          <option value="xla1">Excel A1</option>
          <option value="xlr1c1">Excel R1C1</option>
        </select>
      </label>
      <fieldset disabled><legend>{t('calc.opt.separators')}</legend>
        <label className="field"><span>{t('calc.opt.sepFunction')}</span><input value=";" readOnly /></label>
        <label className="field"><span>{t('calc.opt.sepArrayCol')}</span><input value=";" readOnly /></label>
        <label className="field"><span>{t('calc.opt.sepArrayRow')}</span><input value="|" readOnly /></label>
      </fieldset>
      <p className="muted">{t('calc.opt.separatorsHint')}</p>
    </>;
  },
  apply: (c, f) => {
    const s = String(f.get('calc-syntax'));
    const g = s === 'xla1' ? FormulaGrammar.GRAM_NATIVE_XL_A1 : s === 'xlr1c1' ? FormulaGrammar.GRAM_NATIVE_XL_R1C1 : FormulaGrammar.GRAM_NATIVE;
    const rDoc = c.sh.GetDocument();
    if (rDoc.GetGrammar() !== g) { rDoc.SetGrammar(g); c.notify(); }
  },
};

export const CALC_OPTIONS_PAGES: OptionsPage<Controller>[] = [GENERAL, VIEW, CALCULATE, FORMULA];
