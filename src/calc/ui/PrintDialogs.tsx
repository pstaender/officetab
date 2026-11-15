// Calc's printing dialogs: Print (what to print before the browser's dialog: Calc's part of the
// print dialog, ScPrintUIOptions), Export as PDF (its range and empty pages), Format > Page Style
// (sc/uiconfig/scalc/ui/pagetemplatedialog.ui: Page, Header, Footer and Sheet tabs), the header
// and footer contents (headerfootercontent.ui: left, centre and right areas with field buttons)
// and Format > Print Ranges > Edit (printareasdialog.ui).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Controller } from '../controller.ts';
import { Actions, Field, Modal, Panel, Tabs } from '@shell/ui/Dialogs.tsx';
import { t } from '@shell/i18n.ts';
import { AlphaToCol, ScColToAlpha, ScRange, ScRefFlags } from '@lo/sc/inc/address.ts';
import { SfxStyleFamily, type ScStyleSheet } from '@lo/sc/inc/stlsheet.ts';
import type { ScItemSet, ScPageHFItem, ScPageHFSetItem } from '@lo/sc/inc/scitems.ts';
import { EditTextObject, type EditParagraph, type SvxFieldKind } from '@lo/editeng/source/editeng/editobj.ts';
import { ScModelObj } from '@lo/sc/source/ui/unoobj/docuno.ts';
import { ExportPDF, PrintDocument, RenderOptions, type CalcPrintChoice } from '../print.ts';

/** Twips as centimetres for the fields, and back. */
const toCm = (twips: number) => Math.round((twips / 1440) * 2.54 * 100) / 100;
const fromCm = (v: FormDataEntryValue | number | null): number => Math.max(0, Math.round((parseFloat(String(v ?? '0').replace(',', '.')) || 0) / 2.54 * 1440));

const Radio = ({ name, value, label, checked, onChange }: { name: string; value: string; label: string; checked?: boolean; onChange?: () => void }) => (
  <label className="check"><input type="radio" name={name} value={value} defaultChecked={checked} onChange={onChange} /> {label}</label>
);
const Check = ({ name, label, checked }: { name: string; label: string; checked?: boolean }) => (
  <label className="check"><input type="checkbox" name={name} defaultChecked={checked} /> {label}</label>
);

const curTab = (c: Controller) => c.view.GetViewData().CurrentTabForData();
const pageStyleOf = (c: Controller): ScStyleSheet | null => c.sh.GetDocument().GetStyleSheetPool().Find(c.sh.GetDocument().GetPageStyle(curTab(c)), SfxStyleFamily.Page);

// --- Print and Export as PDF ---------------------------------------------------------------------

/** The print dialog's Calc page: what to print, empty pages; the page count follows the choice. */
function PrintChoiceFields({ c, choice, setChoice }: { c: Controller; choice: CalcPrintChoice; setChoice: (p: CalcPrintChoice) => void }) {
  const count = useMemo(() => {
    try { return new ScModelObj(c.sh).getRendererCount(RenderOptions(c, choice)); } catch { return 0; }
  }, [c, choice]);
  return (
    <>
      <fieldset><legend>{t('calc.print.content')}</legend>
        {([[0, 'calc.print.allSheets'], [1, 'calc.print.selectedSheets'], [2, 'calc.print.selectedCells']] as const).map(([v, k]) => (
          <label key={v} className="check"><input type="radio" name="content" value={v} checked={choice.content === v} onChange={() => setChoice({ ...choice, content: v })} /> {t(k)}</label>
        ))}
      </fieldset>
      <label className="check"><input type="checkbox" name="suppress" checked={choice.suppressEmpty} onChange={(e) => setChoice({ ...choice, suppressEmpty: e.target.checked })} /> {t('calc.print.suppressEmpty')}</label>
      <p className="hint" role="status">{t('calc.print.pages', { n: count })}</p>
    </>
  );
}

export function PrintDialog({ c }: { c: Controller }) {
  const [choice, setChoice] = useState<CalcPrintChoice>({ content: 1, suppressEmpty: true });
  return (
    <Modal c={c} title={t('calc.print.title')}>
      <form className="calc-dialog" onSubmit={(e) => { e.preventDefault(); c.setDialog(null); void PrintDocument(c, choice); }}>
        <PrintChoiceFields c={c} choice={choice} setChoice={setChoice} />
        <p className="hint">{t('calc.print.browserHint')}</p>
        <Actions c={c} ok={t('calc.print.print')} />
      </form>
    </Modal>
  );
}

export function ExportPDFDialog({ c }: { c: Controller }) {
  const [choice, setChoice] = useState<CalcPrintChoice>({ content: 0, suppressEmpty: true });
  return (
    <Modal c={c} title={t('calc.pdf.title')}>
      <form className="calc-dialog" onSubmit={(e) => {
        e.preventDefault();
        c.setDialog(null);
        void ExportPDF(c, choice).then((bytes) => c.savePDF(bytes), (err: Error) => c.setMessage(t('calc.pdf.failed', { error: err.message })));
      }}>
        <PrintChoiceFields c={c} choice={choice} setChoice={setChoice} />
        <p className="hint">{t('calc.pdf.fontsHint')}</p>
        <Actions c={c} ok={t('calc.pdf.export')} />
      </form>
    </Modal>
  );
}

// --- Page Style ----------------------------------------------------------------------------------

/** The paper formats of the Page tab (SvxPaperInfo), in twips (portrait). */
const PAPERS: [string, number, number][] = [
  ['A3', 16838, 23811], ['A4', 11906, 16838], ['A5', 8391, 11906], ['B4 (ISO)', 14173, 20013], ['B5 (ISO)', 9978, 14173],
  ['Letter', 12240, 15840], ['Legal', 12240, 20160], ['Tabloid', 15840, 24480],
];
const paperOf = (w: number, h: number) => PAPERS.find(([, pw, ph]) => (Math.abs(pw - w) < 60 && Math.abs(ph - h) < 60) || (Math.abs(pw - h) < 60 && Math.abs(ph - w) < 60))?.[0] ?? 'user';

/** The numbering of page numbers (SvxNumType as ODF's style:num-format). */
const NUM_TYPES = ['1', 'A', 'a', 'I', 'i', ''] as const;

/** The header and footer fields as the dialog shows them in the text: ⟨Page⟩ … */
const FIELD_NAMES: Record<SvxFieldKind, string> = { TABLE: 'Sheet', PAGE: 'Page', PAGES: 'Pages', DATE: 'Date', TIME: 'Time', TITLE: 'Title', FILE: 'File' };
const FIELD_OF = Object.fromEntries(Object.entries(FIELD_NAMES).map(([k, v]) => [v, k as SvxFieldKind]));
/** A field's text as the file keeps it (as ScStyleSheetPool's default contents do). */
const FIELD_TEXT: Record<SvxFieldKind, string> = { PAGE: '1', PAGES: '99', TABLE: '???', DATE: '00/00/0000', TIME: '00:00:00', FILE: '???', TITLE: '???' };

/** An area's text with its fields as ⟨Name⟩. */
export function AreaToText(o: EditTextObject | null): string {
  if (!o) return '';
  return o.GetParagraphs().map((p) => {
    let s = '', pos = 0;
    const fields = p.maCharAttribs.filter((a) => a.aAttribs.FIELD).sort((a, b) => a.nStart - b.nStart);
    for (const f of fields) {
      s += p.aText.slice(pos, f.nStart) + `⟨${FIELD_NAMES[f.aAttribs.FIELD!]}⟩`;
      pos = f.nEnd;
    }
    return s + p.aText.slice(pos);
  }).join('\n');
}

/** An area from the dialog's text: plain text with ⟨Name⟩ fields, a paragraph per line. */
export function TextToArea(s: string): EditTextObject {
  return new EditTextObject(s.split('\n').map((line) => {
    const p: EditParagraph = { aText: '', maCharAttribs: [] };
    for (const part of line.split(/(⟨[A-Za-z]+⟩)/)) {
      const kind = /^⟨([A-Za-z]+)⟩$/.exec(part)?.[1];
      const f = kind ? FIELD_OF[kind] : undefined;
      if (f) {
        p.maCharAttribs.push({ nStart: p.aText.length, nEnd: p.aText.length + FIELD_TEXT[f].length, aAttribs: { FIELD: f } });
        p.aText += FIELD_TEXT[f];
      } else p.aText += part;
    }
    return p;
  }));
}

type AreaKey = 'pLeftArea' | 'pCenterArea' | 'pRightArea';
const AREAS: AreaKey[] = ['pLeftArea', 'pCenterArea', 'pRightArea'];
type HFWhich = 'HEADERRIGHT' | 'HEADERLEFT' | 'HEADERFIRST' | 'FOOTERRIGHT' | 'FOOTERLEFT' | 'FOOTERFIRST';

/** The contents being edited: the three areas' texts of each header and footer variant. */
type HFTexts = Record<HFWhich, Record<AreaKey, string>>;

function InitialTexts(s: ScStyleSheet): HFTexts {
  const one = (k: HFWhich) => { const i = s.GetItem(`ATTR_PAGE_${k}`); return Object.fromEntries(AREAS.map((a) => [a, AreaToText(i[a])])) as Record<AreaKey, string>; };
  return { HEADERRIGHT: one('HEADERRIGHT'), HEADERLEFT: one('HEADERLEFT'), HEADERFIRST: one('HEADERFIRST'), FOOTERRIGHT: one('FOOTERRIGHT'), FOOTERLEFT: one('FOOTERLEFT'), FOOTERFIRST: one('FOOTERFIRST') };
}

/** The changed header and footer items: an area keeps its object (with its formatting) when its text is unchanged. */
function ChangedHFItems(s: ScStyleSheet, initial: HFTexts, texts: HFTexts): ScItemSet {
  const out: ScItemSet = {};
  for (const k of Object.keys(texts) as HFWhich[]) {
    if (AREAS.every((a) => texts[k][a] === initial[k][a])) continue;
    const old = s.GetItem(`ATTR_PAGE_${k}`);
    const item: ScPageHFItem = { pLeftArea: old.pLeftArea, pCenterArea: old.pCenterArea, pRightArea: old.pRightArea };
    for (const a of AREAS) if (texts[k][a] !== initial[k][a]) item[a] = TextToArea(texts[k][a]);
    (out as Record<string, unknown>)[`ATTR_PAGE_${k}`] = item;
  }
  return out;
}

/** headerfootercontent.ui: the left, centre and right areas of one header or footer, and the field buttons. */
function HFContent({ value, onChange }: { value: Record<AreaKey, string>; onChange: (v: Record<AreaKey, string>) => void }) {
  const refs = useRef<Partial<Record<AreaKey, HTMLTextAreaElement | null>>>({});
  const last = useRef<AreaKey>('pCenterArea');
  const insert = (f: SvxFieldKind) => {
    const a = last.current, el = refs.current[a];
    const tok = `⟨${FIELD_NAMES[f]}⟩`;
    const text = value[a];
    const s = el?.selectionStart ?? text.length, e = el?.selectionEnd ?? text.length;
    onChange({ ...value, [a]: text.slice(0, s) + tok + text.slice(e) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s + tok.length, s + tok.length); });
  };
  const labels: Record<AreaKey, string> = { pLeftArea: t('calc.hf.leftArea'), pCenterArea: t('calc.hf.centerArea'), pRightArea: t('calc.hf.rightArea') };
  return (
    <div className="hf-content">
      <div className="hf-areas">
        {AREAS.map((a) => (
          <label key={a} className="hf-area"><span>{labels[a]}</span>
            <textarea rows={3} value={value[a]} ref={(el) => { refs.current[a] = el; }} onFocus={() => { last.current = a; }} onChange={(e) => onChange({ ...value, [a]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="hf-fields" role="group" aria-label={t('calc.hf.fields')}>
        {(['TABLE', 'PAGE', 'PAGES', 'DATE', 'TIME', 'TITLE', 'FILE'] as const).map((f) => (
          <button key={f} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(f)}>{t(`calc.hf.field.${f}`)}</button>
        ))}
      </div>
    </div>
  );
}

/** The variants of a header or footer the page style shows: right (all pages), left and first page. */
function Variants(bHeader: boolean, set: ScPageHFSetItem): HFWhich[] {
  const p = bHeader ? 'HEADER' : 'FOOTER';
  return [`${p}RIGHT` as HFWhich, ...(!set.bShared ? [`${p}LEFT` as HFWhich] : []), ...(!set.bSharedFirst ? [`${p}FIRST` as HFWhich] : [])];
}

function HFEditor({ which, texts, setTexts }: { which: HFWhich[]; texts: HFTexts; setTexts: (v: HFTexts) => void }) {
  const [cur, setCur] = useState<HFWhich>(which[0]!);
  const shown = which.includes(cur) ? cur : which[0]!;
  const label = (k: HFWhich) => t(`calc.hf.variant.${k}`);
  return (
    <>
      {which.length > 1 && <Tabs ids={which} labels={Object.fromEntries(which.map((k) => [k, label(k)]))} current={shown} onChange={(k) => setCur(k as HFWhich)} label={t('calc.hf.variants')} />}
      <HFContent value={texts[shown]} onChange={(v) => setTexts({ ...texts, [shown]: v })} />
    </>
  );
}

/** Edit > Headers and Footers (SID_HFEDIT, ScHFEditDlg): the contents of the page style's headers and footers that are on. */
export function HeaderFooterDialog({ c }: { c: Controller }) {
  const s = pageStyleOf(c)!;
  const initial = useMemo(() => InitialTexts(s), [s]);
  const [texts, setTexts] = useState(initial);
  const hs = s.GetItem('ATTR_PAGE_HEADERSET'), fs = s.GetItem('ATTR_PAGE_FOOTERSET');
  const which = [...(hs.bOn ? Variants(true, hs) : []), ...(fs.bOn ? Variants(false, fs) : [])];
  return (
    <Modal c={c} title={t('calc.hf.title', { style: s.GetName() })} wide>
      <form className="calc-dialog" onSubmit={(e) => {
        e.preventDefault();
        const items = ChangedHFItems(s, initial, texts);
        if (Object.keys(items).length) c.sh.ModifyPageStyle(curTab(c), items);
        c.setDialog(null);
      }}>
        <HFEditor which={which} texts={texts} setTexts={setTexts} />
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** The Header or Footer tab (svx's headfootformatpage.ui with Calc's Edit button). */
function HFTab({ bHeader, set, texts, setTexts }: { bHeader: boolean; set: ScPageHFSetItem; texts: HFTexts; setTexts: (v: HFTexts) => void }) {
  const k = bHeader ? 'header' : 'footer';
  const [on, setOn] = useState(set.bOn);
  const [shared, setShared] = useState(set.bShared);
  const [sharedFirst, setSharedFirst] = useState(set.bSharedFirst);
  const [edit, setEdit] = useState(false);
  const dist = bHeader ? set.nLower : set.nUpper;
  return (
    <>
      <label className="check"><input type="checkbox" name={`${k}-on`} checked={on} onChange={(e) => setOn(e.target.checked)} /> {t(bHeader ? 'calc.page.headerOn' : 'calc.page.footerOn')}</label>
      <fieldset disabled={!on} className="plain">
        <label className="check"><input type="checkbox" name={`${k}-shared`} checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t('calc.page.sameLeftRight')}</label>
        <label className="check"><input type="checkbox" name={`${k}-sharedfirst`} checked={sharedFirst} onChange={(e) => setSharedFirst(e.target.checked)} /> {t('calc.page.sameFirst')}</label>
        <div className="grid2">
          <Field label={t('calc.page.leftMargin')}><input name={`${k}-left`} type="number" step="0.01" min="0" defaultValue={toCm(set.nLeft)} /></Field>
          <Field label={t('calc.page.rightMargin')}><input name={`${k}-right`} type="number" step="0.01" min="0" defaultValue={toCm(set.nRight)} /></Field>
          <Field label={t('calc.page.spacing')}><input name={`${k}-spacing`} type="number" step="0.01" min="0" defaultValue={toCm(dist)} /></Field>
          <Field label={t('calc.page.height')}><input name={`${k}-height`} type="number" step="0.01" min="0" defaultValue={toCm(Math.max(0, set.nHeight - dist))} /></Field>
        </div>
        <Check name={`${k}-dynamic`} label={t('calc.page.autofit')} checked={set.bDynamic} />
        <div><button type="button" onClick={() => setEdit(!edit)} aria-expanded={edit}>{t('calc.page.editContents')}</button></div>
        {edit && <HFEditor which={Variants(bHeader, { ...set, bShared: shared, bSharedFirst: sharedFirst })} texts={texts} setTexts={setTexts} />}
      </fieldset>
    </>
  );
}

const SCALE_MODES = ['percent', 'widthheight', 'pages'] as const;

/** Format > Page Style (pagetemplatedialog.ui): Page, Header, Footer and Sheet. */
export function PageStyleDialog({ c }: { c: Controller }) {
  const s = pageStyleOf(c)!;
  const g = <K extends Parameters<ScStyleSheet['GetItem']>[0]>(k: K) => s.GetItem(k);
  const size = g('ATTR_PAGE_SIZE'), page = g('ATTR_PAGE'), lr = g('ATTR_LRSPACE'), ul = g('ATTR_ULSPACE');
  const [tab, setTab] = useState<string>(c.pageStyleTab);
  const [paper, setPaper] = useState(paperOf(size.nWidth, size.nHeight));
  const [landscape, setLandscape] = useState(page.bLandscape || size.nWidth > size.nHeight);
  const [dims, setDims] = useState({ w: toCm(size.nWidth), h: toCm(size.nHeight) });
  const scaleTo = g('ATTR_PAGE_SCALETO'), scalePages = g('ATTR_PAGE_SCALETOPAGES');
  const [scaleMode, setScaleMode] = useState<(typeof SCALE_MODES)[number]>(scaleTo.nWidth || scaleTo.nHeight ? 'widthheight' : scalePages ? 'pages' : 'percent');
  const [firstNo, setFirstNo] = useState(g('ATTR_PAGE_FIRSTPAGENO') !== 0);
  const initial = useMemo(() => InitialTexts(s), [s]);
  const [texts, setTexts] = useState(initial);

  const choosePaper = (p: string) => {
    setPaper(p);
    const f = PAPERS.find(([n]) => n === p);
    if (f) setDims(landscape ? { w: toCm(f[2]), h: toCm(f[1]) } : { w: toCm(f[1]), h: toCm(f[2]) });
  };
  const chooseOrientation = (l: boolean) => {
    setLandscape(l);
    if ((dims.w > dims.h) !== l) setDims({ w: dims.h, h: dims.w });
  };

  const submit = (f: FormData): boolean => {
    let w = fromCm(dims.w), h = fromCm(dims.h);
    if ((w > h) !== landscape && w !== h) [w, h] = [h, w];
    const l = fromCm(f.get('l')), r = fromCm(f.get('r')), tp = fromCm(f.get('t')), b = fromCm(f.get('b'));
    if (w < 567 || h < 567) { c.setMessage(t('calc.page.tooSmall')); return false; }
    if (w - l - r < 567 || h - tp - b < 567) { c.setMessage(t('calc.page.noRoom')); return false; }
    const items: ScItemSet = {
      ATTR_PAGE_SIZE: { nWidth: w, nHeight: h },
      ATTR_PAGE: { bLandscape: landscape, eUse: String(f.get('use')) as 'All' | 'Left' | 'Right' | 'Mirror', eNumType: String(f.get('numtype') ?? '1') },
      ATTR_LRSPACE: { nLeft: l, nRight: r },
      ATTR_ULSPACE: { nUpper: tp, nLower: b },
      ATTR_PAGE_HORCENTER: f.get('horcenter') === 'on',
      ATTR_PAGE_VERCENTER: f.get('vercenter') === 'on',
      // Sheet
      ATTR_PAGE_TOPDOWN: f.get('order') !== 'ltr',
      ATTR_PAGE_FIRSTPAGENO: firstNo ? Math.max(1, Math.round(Number(f.get('firstno')) || 1)) : 0,
      ATTR_PAGE_HEADERS: f.get('headers') === 'on',
      ATTR_PAGE_GRID: f.get('grid') === 'on',
      ATTR_PAGE_NOTES: f.get('notes') === 'on',
      ATTR_PAGE_OBJECTS: f.get('objects') === 'on' ? 'Show' : 'Hide',
      ATTR_PAGE_CHARTS: f.get('charts') === 'on' ? 'Show' : 'Hide',
      ATTR_PAGE_DRAWINGS: f.get('drawings') === 'on' ? 'Show' : 'Hide',
      ATTR_PAGE_FORMULAS: f.get('formulas') === 'on',
      ATTR_PAGE_NULLVALS: f.get('nullvals') === 'on',
    };
    // ScTablePage::FillItemSet: the scaling mode's items, the others reset
    const num = (k: string, min: number, max: number, def: number) => Math.max(min, Math.min(max, Math.round(Number(f.get(k))) || def));
    if (scaleMode === 'percent') {
      items.ATTR_PAGE_SCALE = num('scale', 10, 400, 100);
      items.ATTR_PAGE_SCALETO = { nWidth: 0, nHeight: 0 };
      items.ATTR_PAGE_SCALETOPAGES = 0;
    } else if (scaleMode === 'widthheight') {
      const sw = f.get('scalew-on') === 'on' ? num('scalew', 1, 1000, 1) : 0, sh = f.get('scaleh-on') === 'on' ? num('scaleh', 1, 1000, 1) : 0;
      items.ATTR_PAGE_SCALETO = { nWidth: sw, nHeight: sh };
      items.ATTR_PAGE_SCALE = 100;
      items.ATTR_PAGE_SCALETOPAGES = 0;
    } else {
      items.ATTR_PAGE_SCALETOPAGES = num('scalepages', 1, 1000, 1);
      items.ATTR_PAGE_SCALE = 100;
      items.ATTR_PAGE_SCALETO = { nWidth: 0, nHeight: 0 };
    }
    // Header and Footer (SvxHFPage::FillItemSet: the set's size is the height and the spacing)
    for (const bHeader of [true, false]) {
      const k = bHeader ? 'header' : 'footer';
      const old = g(bHeader ? 'ATTR_PAGE_HEADERSET' : 'ATTR_PAGE_FOOTERSET');
      const on = f.get(`${k}-on`) === 'on';
      const set: ScPageHFSetItem = on ? {
        ...old, bOn: true, bShared: f.get(`${k}-shared`) === 'on', bSharedFirst: f.get(`${k}-sharedfirst`) === 'on', bDynamic: f.get(`${k}-dynamic`) === 'on',
        nLeft: fromCm(f.get(`${k}-left`)), nRight: fromCm(f.get(`${k}-right`)),
        nHeight: fromCm(f.get(`${k}-height`)) + fromCm(f.get(`${k}-spacing`)),
        ...(bHeader ? { nLower: fromCm(f.get(`${k}-spacing`)) } : { nUpper: fromCm(f.get(`${k}-spacing`)) }),
      } : { ...old, bOn: false };
      items[bHeader ? 'ATTR_PAGE_HEADERSET' : 'ATTR_PAGE_FOOTERSET'] = set;
    }
    Object.assign(items, ChangedHFItems(s, initial, texts));
    c.sh.ModifyPageStyle(curTab(c), items);
    return true;
  };

  const tabs = ['page', 'header', 'footer', 'sheet'];
  const labels = Object.fromEntries(tabs.map((k) => [k, t(`calc.page.tab.${k}`)]));
  const Margin = ({ name, label, value }: { name: string; label: string; value: number }) => (
    <Field label={label}><input name={name} type="number" step="0.01" min="0" defaultValue={toCm(value)} /></Field>
  );
  const printChecks: [string, string, boolean][] = [
    ['headers', 'calc.page.printHeaders', g('ATTR_PAGE_HEADERS')], ['grid', 'calc.page.printGrid', g('ATTR_PAGE_GRID')],
    ['notes', 'calc.page.printNotes', g('ATTR_PAGE_NOTES')], ['objects', 'calc.page.printObjects', g('ATTR_PAGE_OBJECTS') === 'Show'],
    ['charts', 'calc.page.printCharts', g('ATTR_PAGE_CHARTS') === 'Show'], ['drawings', 'calc.page.printDrawings', g('ATTR_PAGE_DRAWINGS') === 'Show'],
    ['formulas', 'calc.page.printFormulas', g('ATTR_PAGE_FORMULAS')], ['nullvals', 'calc.page.printZero', g('ATTR_PAGE_NULLVALS')],
  ];
  return (
    <Modal c={c} title={t('calc.page.title', { style: s.GetName() })} wide>
      <form className="calc-dialog page-style" onSubmit={(e) => { e.preventDefault(); if (submit(new FormData(e.currentTarget))) c.setDialog(null); }}>
        <Tabs ids={tabs} labels={labels} current={tab} onChange={setTab} label={t('calc.page.tabs')} />
        <div className="tab-pages">
          <Panel id="page" current={tab}>
            <fieldset><legend>{t('calc.page.paperFormat')}</legend>
              <Field label={t('calc.page.format')}>
                <select name="paper" value={paper} onChange={(e) => choosePaper(e.target.value)}>
                  {PAPERS.map(([n]) => <option key={n} value={n}>{n}</option>)}
                  <option value="user">{t('calc.page.user')}</option>
                </select>
              </Field>
              <div className="grid2">
                <Field label={t('calc.page.width')}><input name="w" type="number" step="0.01" min="1" value={dims.w} onChange={(e) => { setDims({ ...dims, w: Number(e.target.value) }); setPaper('user'); }} /></Field>
                <Field label={t('calc.page.heightPaper')}><input name="h" type="number" step="0.01" min="1" value={dims.h} onChange={(e) => { setDims({ ...dims, h: Number(e.target.value) }); setPaper('user'); }} /></Field>
              </div>
              <div className="row">
                <Radio name="orient" value="portrait" label={t('calc.page.portrait')} checked={!landscape} onChange={() => chooseOrientation(false)} />
                <Radio name="orient" value="landscape" label={t('calc.page.landscape')} checked={landscape} onChange={() => chooseOrientation(true)} />
              </div>
            </fieldset>
            <fieldset><legend>{t('calc.page.margins')}</legend>
              <div className="grid2">
                <Margin name="l" label={t('calc.page.left')} value={lr.nLeft} />
                <Margin name="r" label={t('calc.page.right')} value={lr.nRight} />
                <Margin name="t" label={t('calc.page.top')} value={ul.nUpper} />
                <Margin name="b" label={t('calc.page.bottom')} value={ul.nLower} />
              </div>
            </fieldset>
            <fieldset><legend>{t('calc.page.layout')}</legend>
              <Field label={t('calc.page.pageLayout')}>
                <select name="use" defaultValue={page.eUse}>
                  {(['All', 'Mirror', 'Right', 'Left'] as const).map((u) => <option key={u} value={u}>{t(`calc.page.use.${u}`)}</option>)}
                </select>
              </Field>
              <Field label={t('calc.page.numbers')}>
                <select name="numtype" defaultValue={page.eNumType}>
                  {NUM_TYPES.map((n) => <option key={n} value={n}>{t(`calc.page.num.${n || 'none'}`)}</option>)}
                </select>
              </Field>
              <div className="row">
                <Check name="horcenter" label={t('calc.page.horCenter')} checked={g('ATTR_PAGE_HORCENTER')} />
                <Check name="vercenter" label={t('calc.page.verCenter')} checked={g('ATTR_PAGE_VERCENTER')} />
              </div>
            </fieldset>
          </Panel>
          <Panel id="header" current={tab}><HFTab bHeader set={g('ATTR_PAGE_HEADERSET')} texts={texts} setTexts={setTexts} /></Panel>
          <Panel id="footer" current={tab}><HFTab bHeader={false} set={g('ATTR_PAGE_FOOTERSET')} texts={texts} setTexts={setTexts} /></Panel>
          <Panel id="sheet" current={tab}>
            <fieldset><legend>{t('calc.page.order')}</legend>
              <Radio name="order" value="ttb" label={t('calc.page.topDown')} checked={g('ATTR_PAGE_TOPDOWN')} />
              <Radio name="order" value="ltr" label={t('calc.page.leftRight')} checked={!g('ATTR_PAGE_TOPDOWN')} />
              <div className="row">
                <label className="check"><input type="checkbox" checked={firstNo} onChange={(e) => setFirstNo(e.target.checked)} /> {t('calc.page.firstPageNo')}</label>
                <input name="firstno" type="number" min="1" aria-label={t('calc.page.firstPageNo')} disabled={!firstNo} defaultValue={g('ATTR_PAGE_FIRSTPAGENO') || 1} style={{ width: '6em' }} />
              </div>
            </fieldset>
            <fieldset><legend>{t('calc.page.print')}</legend>
              <div className="grid2">{printChecks.map(([n, k, v]) => <Check key={n} name={n} label={t(k)} checked={v} />)}</div>
            </fieldset>
            <fieldset><legend>{t('calc.page.scale')}</legend>
              <Field label={t('calc.page.scaleMode')}>
                <select value={scaleMode} onChange={(e) => setScaleMode(e.target.value as typeof scaleMode)}>
                  {SCALE_MODES.map((m) => <option key={m} value={m}>{t(`calc.page.scale.${m}`)}</option>)}
                </select>
              </Field>
              {scaleMode === 'percent' && <Field label={t('calc.page.scaleFactor')}><input name="scale" type="number" min="10" max="400" defaultValue={g('ATTR_PAGE_SCALE')} /></Field>}
              {scaleMode === 'widthheight' && <div className="grid2">
                <ScaleTo name="scalew" label={t('calc.page.widthInPages')} value={scaleTo.nWidth} />
                <ScaleTo name="scaleh" label={t('calc.page.heightInPages')} value={scaleTo.nHeight} />
              </div>}
              {scaleMode === 'pages' && <Field label={t('calc.page.maxPages')}><input name="scalepages" type="number" min="1" defaultValue={scalePages || 1} /></Field>}
            </fieldset>
          </Panel>
        </div>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** A "Width in pages" or "Height in pages" field with its check box (0: not set). */
function ScaleTo({ name, label, value }: { name: string; label: string; value: number }) {
  const [on, setOn] = useState(value > 0);
  return (
    <div className="row">
      <label className="check"><input type="checkbox" name={`${name}-on`} checked={on} onChange={(e) => setOn(e.target.checked)} /> {label}</label>
      <input name={name} type="number" min="1" aria-label={label} disabled={!on} defaultValue={value || 1} style={{ width: '6em' }} />
    </div>
  );
}

// --- Print Ranges --------------------------------------------------------------------------------

/** Rows "$1:$2" or columns "$A:$B" (lcl_CheckRepeatString), as a range of whole rows or columns. */
function RepeatRange(c: Controller, s: string, bRow: boolean): ScRange | null {
  const rDoc = c.sh.GetDocument(), nTab = curTab(c);
  const m = bRow ? /^\s*\$?(\d+)\s*(?::\s*\$?(\d+))?\s*$/.exec(s) : /^\s*\$?([A-Za-z]+)\s*(?::\s*\$?([A-Za-z]+))?\s*$/.exec(s);
  if (!m) return null;
  const a = bRow ? Number(m[1]) - 1 : AlphaToCol(rDoc, m[1]!);
  const b = m[2] ? (bRow ? Number(m[2]) - 1 : AlphaToCol(rDoc, m[2])) : a;
  if (a < 0 || b < 0) return null;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return bRow ? new ScRange(0, lo, nTab, rDoc.MaxCol(), hi, nTab) : new ScRange(lo, 0, nTab, hi, rDoc.MaxRow(), nTab);
}

/** lcl_GetRepeatRangeString */
function RepeatString(r: ScRange | null, bRow: boolean): string {
  if (!r) return '';
  const one = (n: number) => (bRow ? `$${n + 1}` : `$${ScColToAlpha(n)}`);
  const a = bRow ? r.aStart.Row() : r.aStart.Col(), b = bRow ? r.aEnd.Row() : r.aEnd.Col();
  return a === b ? one(a) : `${one(a)}:${one(b)}`;
}

/** Format > Print Ranges > Edit (ScPrintAreasDlg). */
export function PrintRangesDialog({ c }: { c: Controller }) {
  const rDoc = c.sh.GetDocument(), nTab = curTab(c);
  const ranges: string[] = [];
  for (let i = 0; i < rDoc.GetPrintRangeCount(nTab); i++) ranges.push(rDoc.GetPrintRange(nTab, i)!.Format(rDoc, ScRefFlags.RANGE_ABS));
  const [printMode, setPrintMode] = useState(rDoc.IsPrintEntireSheet(nTab) ? 'entire' : ranges.length ? 'user' : 'none');
  const [print, setPrint] = useState(ranges.join(';'));
  const [rows, setRows] = useState(RepeatString(rDoc.GetRepeatRowRange(nTab), true));
  const [cols, setCols] = useState(RepeatString(rDoc.GetRepeatColRange(nTab), false));
  const selection = () => {
    const r = c.view.GetViewData().GetSimpleArea().rRange;
    return r.Format(rDoc, ScRefFlags.RANGE_ABS);
  };
  const submit = (): boolean => {
    const bEntire = printMode === 'entire';
    const aPrintStr = printMode === 'none' || bEntire ? '' : print.trim();
    // Impl_CheckRefStrings: the ranges must be valid
    for (const tok of aPrintStr ? aPrintStr.split(';') : []) {
      const r = new ScRange(0, 0, nTab);
      if (!(r.ParseAny(tok.trim(), rDoc) & ScRefFlags.VALID)) { c.setMessage(t('calc.pr.invalid', { range: tok })); return false; }
    }
    const rowR = rows.trim() ? RepeatRange(c, rows, true) : null, colR = cols.trim() ? RepeatRange(c, cols, false) : null;
    if (rows.trim() && !rowR) { c.setMessage(t('calc.pr.invalid', { range: rows })); return false; }
    if (cols.trim() && !colR) { c.setMessage(t('calc.pr.invalid', { range: cols })); return false; }
    c.view.SetPrintRanges(bEntire, aPrintStr, colR ? colR.Format(rDoc, ScRefFlags.RANGE_ABS) : '', rowR ? rowR.Format(rDoc, ScRefFlags.RANGE_ABS) : '', false);
    return true;
  };
  const row = (label: string, select: ReactNode, value: string, set: (s: string) => void, disabled: boolean, name: string) => (
    <fieldset><legend>{label}</legend>
      <div className="row">{select}<input name={name} aria-label={label} value={value} disabled={disabled} onChange={(e) => set(e.target.value)} style={{ flex: 1, minWidth: '12em' }} /></div>
    </fieldset>
  );
  return (
    <Modal c={c} title={t('calc.pr.title')}>
      <form className="calc-dialog" onSubmit={(e) => { e.preventDefault(); if (submit()) c.setDialog(null); }}>
        {row(t('calc.pr.printRange'), (
          <select aria-label={t('calc.pr.printRangeMode')} value={printMode} onChange={(e) => { setPrintMode(e.target.value); if (e.target.value === 'selection') { setPrint(selection()); setPrintMode('user'); } }}>
            <option value="none">{t('calc.pr.none')}</option>
            <option value="entire">{t('calc.pr.entire')}</option>
            <option value="user">{t('calc.pr.user')}</option>
            <option value="selection">{t('calc.pr.selection')}</option>
          </select>
        ), print, (s) => { setPrint(s); setPrintMode('user'); }, printMode !== 'user', 'print')}
        {row(t('calc.pr.repeatRows'), null, rows, setRows, false, 'rows')}
        {row(t('calc.pr.repeatCols'), null, cols, setCols, false, 'cols')}
        <Actions c={c} />
      </form>
    </Modal>
  );
}
