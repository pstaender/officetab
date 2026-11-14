import { ICON_THEMES, type IconTheme } from '../icons.ts';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ImportBitmap } from '@lo/vcl/source/graphic/Manager.ts';
import { SmDocShell } from '@lo/starmath/source/document.ts';
import { CreateAutoContour } from '@lo/svx/source/dialog/_contdlg.ts';
import { t } from '../i18n.ts';
import { KeyboardSettings } from './KeyboardSettings.tsx';
import { languageName } from '../spell.ts';
import { LOCAL_LANGUAGETOOL_URL, dateOf, type Controller, type FileFormat } from '../controller.ts';
import { LANGUAGETOOLPLUS_DEFAULT_URL, LANGUAGETOOL_DEFAULT_URL } from '@lo/lingucomponent/source/spellcheck/languagetool/languagetoolimp.ts';
import { deleteDoc, listDocs, type StoredDocInfo } from '../storage.ts';
import upstream from '../../../upstream.json';
import { SwStartNodeType } from '@lo/sw/inc/ndtyp.ts';
import { DEF_GUTTER_WIDTH, type SwFormatCol } from '@lo/sw/inc/fmtclds.ts';
import { POOL_PAGE_DESCS } from '@lo/sw/inc/pagedesc.ts';
import type { SwSectionData } from '@lo/sw/inc/node.ts';
import { COL_DEFAULT_SHAPE_FILLING, COL_DEFAULT_SHAPE_STROKE, HoriOrientation, RelOrientation, RndStdIds, VertOrientation, WrapTextMode, type SwFlyFrameFormat } from '@lo/sw/inc/frmfmt.ts';
import { GetGrfFilterParams, GrfFilterTable, type GrfFilterParam } from '@lo/svx/source/dialog/grfflt.ts';
import { MAXLEVEL, SwNumRule, type SvxNumLabelFollowedBy, type SwNumFormat } from '@lo/sw/inc/numrule.ts';
import { NumberingType, makeNumberingString } from '@lo/i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { ALL_LEVELS, BulletPick, FirstLevel, OutlinePick, OutlineSettings, SameForLevels, SetAlignAt, SetBullet, SetIncludeUpperLevels, SetIndentAt, SetLabelFollowedBy, SetListtabPos, SetNumAdjust, SetNumberType, SetPrefixSuffix, SetStart, SingleNumPick, SingleNumSettings, StandardPositions, m_aBulletSymbols } from '@lo/cui/source/tabpages/numpages.ts';
import { SwTitlePageDlgInit, SwTitlePageDlgOK, type SwTitlePageSettings } from '@lo/sw/source/ui/misc/titlepage.ts';
import { SignatureLineDialogApply, SignatureLineDialogInit, type SignatureLineDialog } from '@lo/cui/source/dialogs/SignatureLineDialog.ts';
import { MakeDocInfoField, SwDocInfoFieldType, SwDocInfoSubType, SwDocStatSubType } from '@lo/sw/source/core/fields/docufld.ts';
import { GetDocLanguage, SwGetSetExpType, SwInputFieldSubType } from '@lo/sw/source/core/fields/expfld.ts';
import { SwUserFieldType, SwUserType } from '@lo/sw/source/core/fields/usrfld.ts';
import { SwCalc } from '@lo/sw/source/core/bastyp/calc.ts';
import { GetSubTypes, InsertField, RemoveFieldType, SwFieldTypesEnum } from '@lo/sw/source/uibase/fldui/fldmgr.ts';
import { GetFootnotes, GetNumItems, GetOutlineNodes, GetSeqCategories, GetSeqFields, RefFieldFormat, ReferencesSubtype } from '@lo/sw/source/core/fields/reffld.ts';
import type { SwTextNode } from '@lo/sw/inc/ndtxt.ts';
import type { MarkBase } from '@lo/sw/source/core/doc/docbm.ts';
import { BookmarkTable, SwInsertBookmarkDlg, SwRenameXNamedDlg_ModifyHdl, SwRenameXNamedDlg_OkHdl, SwRenameXNamedDlg_TextFilter, type BookmarkRow } from '@lo/sw/source/ui/misc/bookmark.ts';
import { IsGrammarArea, ProofreadingText } from '@lo/sw/source/core/txtnode/txtedt.ts';
import { ExecutePageNumberWizard, SwPageNumberDlgInit, type SwPageNumberDlg } from '@lo/sw/source/uibase/shells/textfld.ts';
import { GetWatermark, SetWatermark } from '@lo/sw/source/core/edit/edfcol.ts';
import { GraphicSizeCheckGUIEntryText, GraphicSizeCheckGUIResult } from '@lo/sw/source/core/graphic/GraphicSizeCheck.ts';
import type { DateTime } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { CAPTION_CATEGORIES, SplitTable_HeadlineOption, T2T_PARA } from '@lo/sw/inc/doc.ts';
import { AutoFormatPos, DefaultTableStyle, type SwTableAutoFormat } from '@lo/sw/source/core/doc/tblafmt.ts';
import { SwSortDirection, SwSortOrder } from '@lo/sw/source/core/doc/docsort.ts';
import tableAutoFormats from '../generated/tableautoformats.json';
import { GenerateFormat, GetBuiltInFormats, GetFormatSpecialInfo, GetOutputString, GetType, SvNumFormatType } from '@lo/svl/source/numbers/zforlist.ts';
import type { SvxBorderLine } from '@lo/sw/inc/swtable.ts';
import { FontNameField, FontSizeCombo } from './FontBoxes.tsx';
import { LoadStyles, SaveAsTemplate, TemplateManager } from './Templates.tsx';
import { CommandPopup } from './CommandPopup.tsx';
import { SvxAutoCorrCfg } from '@lo/editeng/source/misc/acorrcfg.ts';
import { ACFlags, LANGUAGE_UNDETERMINED, SvxAutocorrWord, type SvxAutoCorrLangData } from '@lo/editeng/source/misc/svxacorr.ts';
import { KEY_END, KEY_RETURN, KEY_RIGHT, KEY_SPACE, KEY_TAB, type SvxSwAutoFormatFlag, type SvxSwAutoFormatFlags } from '@lo/editeng/source/misc/swafopt.ts';
import { AUTOCORR_LANGUAGES, autoCompleteWords, ensureLists, listLanguage } from '../autocorrect.ts';
import { POOL_DEFAULTS, type SvxParaBox, type FontLineStyle, type SvxCaseMap, type SvxAdjust, type SvxBreak, type SvxLineSpacing, type SwAttrs, type SwAttrSet, type SwCharAttrSet } from '@lo/sw/inc/hintids.ts';

const CM = 567;
const toCm = (t: number) => Math.round((t / CM) * 100) / 100;
const fromCm = (s: string) => Math.round(parseFloat(s || '0') * CM);

export function Modal({ c, title, children, wide }: { c: Controller; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className={wide ? 'wide' : undefined} aria-label={title} onClose={() => { c.setDialog(null); c.focusEditor(); }}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

const Actions = ({ c, ok = t('common.ok') }: { c: Controller; ok?: string }) => (
  <footer><button type="button" onClick={() => c.setDialog(null)}>{t('common.cancel')}</button><button type="submit" className="primary">{ok}</button></footer>
);

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

/** A file size in megabytes, with two decimals (at least 0.01 MB for a non-empty file). */
const formatMB = (bytes: number) => `${(bytes > 0 ? Math.max(0.01, bytes / 1_048_576) : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`;

/** The documents table's sort columns, and the order a column sorts in first: names A to Z, the newest and largest first. */
type DocSortKey = 'name' | 'updated' | 'size';
const DOC_SORT_FIRST: Record<DocSortKey, 'asc' | 'desc'> = { name: 'asc', updated: 'desc', size: 'desc' };
const docCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const compareDocs = (key: DocSortKey) => (a: StoredDocInfo, b: StoredDocInfo) =>
  key === 'name' ? docCollator.compare(a.name, b.name) || a.updated - b.updated : a[key] - b[key] || docCollator.compare(a.name, b.name);

function Documents({ c }: { c: Controller }) {
  const [docs, setDocs] = useState<StoredDocInfo[] | null>(null);
  // Newest first, as before; a header sorts by its column, and again the other way round.
  const [sort, setSort] = useState<{ key: DocSortKey; dir: 'asc' | 'desc' }>({ key: 'updated', dir: 'desc' });
  const sorted = useMemo(() => {
    const list = [...(docs ?? [])].sort(compareDocs(sort.key));
    return sort.dir === 'desc' ? list.reverse() : list;
  }, [docs, sort]);
  const sortBy = (key: DocSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DOC_SORT_FIRST[key] }));
  const head = (key: DocSortKey, label: string, num = false) => (
    <th scope="col" className={num ? 'num' : undefined} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="sort" onClick={() => sortBy(key)}>
        {label}<span className="sort-mark" aria-hidden="true">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
  const refresh = () => void listDocs().then(setDocs).catch((e: Error) => c.setMessage(e.message));
  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Every stored document but the open one, which autosave would write back.
  const others = (docs ?? []).filter((d) => d.id !== c.docId);
  const clearAll = () => {
    if (!confirm(t('docs.clearAllConfirm', { count: others.length }))) return;
    void Promise.all(others.map((d) => deleteDoc(d.id))).then(() => { c.setMessage(t('docs.cleared', { count: others.length })); refresh(); });
  };
  return (
    <Modal c={c} title="Open document" wide>
      <button className="primary" onClick={() => void c.openFromDisk()}>Open file from this computer…</button>
      <h3>Stored in this browser</h3>
      {docs === null ? <p>Loading…</p> : docs.length === 0 ? <p className="muted">No documents yet. Your work is saved here automatically.</p> : (
        <div className="doclist">
          <table>
            <thead><tr>{head('name', t('docs.name'))}{head('updated', t('docs.modified'))}{head('size', t('docs.size'), true)}<th scope="col"><span className="sr-only">{t('docs.actions')}</span></th></tr></thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id} className={d.id === c.docId ? 'current' : undefined}>
                  <td><button className="doc" onClick={() => void c.openStored(d.id)}>{d.name}</button></td>
                  <td className="muted">{new Date(d.updated).toLocaleString()}</td>
                  <td className="muted num">{formatMB(d.size)}</td>
                  <td><button aria-label={`Delete ${d.name}`} disabled={d.id === c.docId} title={d.id === c.docId ? 'This document is open' : 'Delete'} onClick={() => { if (confirm(`Delete “${d.name}” from this browser?`)) void deleteDoc(d.id).then(refresh); }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer>
        {!!others.length && <button className="danger" onClick={clearAll}>{t('docs.clearAll')}</button>}
        <button onClick={() => c.setDialog(null)}>Close</button>
      </footer>
    </Modal>
  );
}

type Get = <K extends keyof SwAttrs>(k: K) => SwAttrs[K];

/** cui's character tabs (Font, Font Effects), reduced: shared by the Character and style dialogs. */
function CharFields({ c, get }: { c: Controller; get: Get }) {
  return (
    <>
      <Field label="Font"><FontNameField c={c} name="font" label="Font" value={get('RES_CHRATR_FONT')} /></Field>
      <Field label="Size (pt)"><FontSizeCombo name="size" label="Size (pt)" value={get('RES_CHRATR_FONTSIZE') / 20} /></Field>
      <Field label="Underline"><select name="underline" defaultValue={get('RES_CHRATR_UNDERLINE')}><option value="none">None</option><option value="single">Single</option><option value="double">Double</option><option value="dotted">Dotted</option><option value="dash">Dash</option></select></Field>
      <Field label="Overline"><select name="overline" defaultValue={get('RES_CHRATR_OVERLINE')}><option value="none">None</option><option value="single">Single</option><option value="double">Double</option><option value="dotted">Dotted</option><option value="dash">Dash</option></select></Field>
      <Field label="Case"><select name="casemap" defaultValue={get('RES_CHRATR_CASEMAP')}><option value="none">As typed</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option><option value="capitalize">Capitalize Every Word</option><option value="smallcaps">Small capitals</option></select></Field>
      <Field label="Color"><input name="color" type="color" defaultValue={get('RES_CHRATR_COLOR') ?? '#000000'} /></Field>
      <label className="check"><input name="auto" type="checkbox" defaultChecked={get('RES_CHRATR_COLOR') === null} /> Automatic color</label>
      <label className="check"><input name="bold" type="checkbox" defaultChecked={get('RES_CHRATR_WEIGHT')} /> Bold</label>
      <label className="check"><input name="italic" type="checkbox" defaultChecked={get('RES_CHRATR_POSTURE')} /> Italic</label>
      <label className="check"><input name="strike" type="checkbox" defaultChecked={get('RES_CHRATR_CROSSEDOUT')} /> Strikethrough</label>
      <label className="check"><input name="outline" type="checkbox" defaultChecked={get('RES_CHRATR_CONTOUR')} /> Outline</label>
      <label className="check"><input name="shadow" type="checkbox" defaultChecked={get('RES_CHRATR_SHADOWED')} /> Shadow</label>
    </>
  );
}

// The size box takes a decimal comma too; a size out of FontSizeBox's range is not applied.
const readSize = (f: FormData) => { const v = parseFloat(String(f.get('size')).replace(',', '.')); return v >= 1 && v <= 999.9 ? { RES_CHRATR_FONTSIZE: Math.round(v * 20) } : {}; };
const readCharFields = (f: FormData): SwCharAttrSet => ({
  RES_CHRATR_FONT: String(f.get('font')).trim(), ...readSize(f),
  RES_CHRATR_WEIGHT: !!f.get('bold'), RES_CHRATR_POSTURE: !!f.get('italic'),
  RES_CHRATR_UNDERLINE: String(f.get('underline')) as FontLineStyle, RES_CHRATR_CROSSEDOUT: !!f.get('strike'),
  RES_CHRATR_COLOR: f.get('auto') ? null : String(f.get('color')),
  RES_CHRATR_CASEMAP: String(f.get('casemap')) as SvxCaseMap,
  RES_CHRATR_OVERLINE: String(f.get('overline')) as FontLineStyle,
  RES_CHRATR_CONTOUR: !!f.get('outline'), RES_CHRATR_SHADOWED: !!f.get('shadow'),
});

/** cui's paragraph tabs (Indents & Spacing, Alignment, Text Flow), reduced. */
function ParaFields({ get }: { get: Get }) {
  const lr = get('RES_LR_SPACE'), ul = get('RES_UL_SPACE'), ls = get('RES_PARATR_LINESPACING');
  return (
    <>
      <Field label="Alignment"><select name="adjust" defaultValue={get('RES_PARATR_ADJUST')}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="block">Justified</option></select></Field>
      <Field label="Before text (cm)"><input name="left" type="number" step="any" defaultValue={toCm(lr.left)} /></Field>
      <Field label="After text (cm)"><input name="right" type="number" step="any" defaultValue={toCm(lr.right)} /></Field>
      <Field label="First line (cm)"><input name="first" type="number" step="any" defaultValue={toCm(lr.firstLine)} /></Field>
      <Field label="Above paragraph (cm)"><input name="upper" type="number" step="any" min="0" defaultValue={toCm(ul.upper)} /></Field>
      <Field label="Below paragraph (cm)"><input name="lower" type="number" step="any" min="0" defaultValue={toCm(ul.lower)} /></Field>
      <Field label="Line spacing"><select name="rule" defaultValue={ls.rule}><option value="proportional">Proportional (%)</option><option value="min">At least (cm)</option><option value="fix">Fixed (cm)</option></select></Field>
      <Field label="Line spacing value"><input name="lsvalue" type="number" step="any" min="0" defaultValue={ls.rule === 'proportional' ? ls.value : toCm(ls.value)} /></Field>
      <Field label="Orphan lines"><input name="orphans" type="number" min="0" max="9" defaultValue={get('RES_PARATR_ORPHANS')} /></Field>
      <Field label="Widow lines"><input name="widows" type="number" min="0" max="9" defaultValue={get('RES_PARATR_WIDOWS')} /></Field>
      <Field label="Page break"><select name="break" defaultValue={get('RES_BREAK')}><option value="none">None</option><option value="page-before">Before</option><option value="page-after">After</option></select></Field>
      <label className="check"><input name="keep" type="checkbox" defaultChecked={get('RES_KEEP')} /> Keep with next paragraph</label>
    </>
  );
}

function readParaFields(f: FormData): SwAttrSet {
  const g = (k: string) => String(f.get(k));
  const rule = g('rule') as SvxLineSpacing['rule'];
  const value = rule === 'proportional' ? parseFloat(g('lsvalue')) : Math.round(parseFloat(g('lsvalue')) * CM);
  return {
    RES_PARATR_ADJUST: g('adjust') as SvxAdjust,
    RES_LR_SPACE: { left: fromCm(g('left')), right: fromCm(g('right')), firstLine: fromCm(g('first')) },
    RES_UL_SPACE: { upper: fromCm(g('upper')), lower: fromCm(g('lower')) },
    RES_PARATR_LINESPACING: { rule, value } as SvxLineSpacing,
    RES_KEEP: !!f.get('keep'),
    RES_PARATR_WIDOWS: parseInt(g('widows'), 10), RES_PARATR_ORPHANS: parseInt(g('orphans'), 10),
    RES_BREAK: g('break') as SvxBreak,
  };
}

function Character({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    c.sh.SetCharAttr(readCharFields(new FormData(e.currentTarget)));
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Character">
      <form onSubmit={submit}>
        <CharFields c={c} get={(k) => c.sh.GetAttr(k)} />
        <Actions c={c} />
      </form>
    </Modal>
  );
}

function Paragraph({ c }: { c: Controller }) {
  const n = c.sh.m_pCursor.GetPoint().GetNode();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    c.sh.SetParaAttr(readParaFields(new FormData(e.currentTarget)));
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Paragraph">
      <form onSubmit={submit}>
        <ParaFields get={(k) => n.GetAttr(k)} />
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * The paragraph style dialog (sw's templatedlg, reduced): Organizer, Indents & Spacing and Font.
 * Only values that differ from the parent style are stored in the style.
 */
function StyleDialog({ c }: { c: Controller }) {
  const doc = c.sh.m_pDoc;
  const coll = c.sh.m_pCursor.GetPoint().GetNode().GetTextColl();
  const isStandard = coll.GetName() === 'Standard';
  const names = [...doc.m_aTextFormatColls.keys()];
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parent = isStandard ? null : doc.FindTextFormatCollByName(String(f.get('parent'))) ?? null;
    const wanted: SwAttrSet = { ...readParaFields(f), ...readCharFields(f) };
    // Keep the style's own values, and add those that now differ from what it would inherit.
    const set: SwAttrSet = {};
    for (const [k, v] of Object.entries(wanted) as [keyof SwAttrs, unknown][]) {
      const inherited = parent ? parent.GetFormatAttr(k) : POOL_DEFAULTS[k];
      if (k in coll.m_aSet || JSON.stringify(inherited) !== JSON.stringify(v)) (set as Record<string, unknown>)[k] = v;
    }
    for (const [k, v] of Object.entries(coll.m_aSet)) if (!(k in set)) (set as Record<string, unknown>)[k] = v;
    doc.ChgFormatColl(c.sh.m_pCursor, coll, {
      set, parent: isStandard ? undefined : parent, name: String(f.get('name')).trim() || undefined,
      next: doc.FindTextFormatCollByName(String(f.get('next'))) ?? null,
    });
    c.setDialog(null);
  };
  return (
    <Modal c={c} title={`Paragraph Style: ${coll.GetName()}`} wide>
      <form onSubmit={submit}>
        <h3>Organizer</h3>
        <Field label="Name"><input name="name" defaultValue={coll.GetName()} readOnly={isStandard} /></Field>
        <Field label="Inherit from">
          <select name="parent" defaultValue={coll.DerivedFrom()?.GetName() ?? ''} disabled={isStandard}>
            {isStandard && <option value="">- None -</option>}
            {names.filter((x) => x !== coll.GetName()).map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Next style"><select name="next" defaultValue={coll.GetNextTextFormatColl().GetName()}>{names.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <h3>Indents, spacing and flow</h3>
        <ParaFields get={(k) => coll.GetFormatAttr(k)} />
        <h3>Font</h3>
        <CharFields c={c} get={(k) => coll.GetFormatAttr(k)} />
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** FN_NEW_STYLE_BY_EXAMPLE: names the style made from the paragraph at the cursor. */
function NewStyle({ c }: { c: Controller }) {
  const [error, setError] = useState('');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name')).trim();
    if (!name) return;
    if (c.sh.m_pDoc.FindTextFormatCollByName(name)) { setError('A style with this name exists already.'); return; }
    c.sh.m_pDoc.MakeCollByExample(c.sh.m_pCursor, name, c.sh.CopyFormat().chars);
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="New Style from Selection">
      <form onSubmit={submit}>
        <Field label="Style name"><input name="name" autoFocus required onInput={() => setError('')} /></Field>
        {error && <p role="alert" className="muted">{error}</p>}
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * svx/source/dialog/hdft.cxx's "More..." (SvxHFPage::BackgroundHdl, reduced) and the header/footer
 * button's Border and Background (SwHeaderFooterWin::ExecuteCommand "borderback"): the lines of the
 * Borders tab (each side on or off, one width and colour), the spacing to the contents, and the
 * Area tab's colour.
 */
function BorderBackgroundFields({ prefix, box, background }: { prefix: string; box: SvxParaBox | null; background: string | null }) {
  const line = box?.top ?? box?.bottom ?? box?.left ?? box?.right ?? null;
  return (
    <fieldset className="hf"><legend>{t('hf.borderBackground')}</legend>
      <div className="wraps">
        {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
          <label key={side} className="check"><input type="checkbox" name={`${prefix}-b-${side}`} defaultChecked={!!box?.[side]} /> {t(`hf.border.${side}`)}</label>
        ))}
      </div>
      <Field label={t('hf.lineWidth')}><input name={`${prefix}-b-width`} type="number" step="any" min="0.05" defaultValue={(line?.width ?? 15) / 20} /></Field>
      <Field label={t('hf.lineColor')}><input name={`${prefix}-b-color`} type="color" defaultValue={line?.color ?? '#000000'} /></Field>
      <Field label={t('hf.padding')}><input name={`${prefix}-b-padding`} type="number" step="any" min="0" defaultValue={toCm(box?.padding ?? 0)} /></Field>
      <label className="check"><input type="checkbox" name={`${prefix}-bg`} defaultChecked={!!background} /> {t('hf.background')}</label>
      <Field label={t('hf.backgroundColor')}><input name={`${prefix}-bg-color`} type="color" defaultValue={background ?? '#ffffff'} /></Field>
    </fieldset>
  );
}

function readBorderBackground(f: FormData, prefix: string): { box: SvxParaBox | null; background: string | null } {
  const width = Math.max(1, Math.round(Number(f.get(`${prefix}-b-width`)) * 20) || 15), color = String(f.get(`${prefix}-b-color`) || '#000000');
  const side = (k: string) => (f.get(`${prefix}-b-${k}`) ? { color, width } : null);
  const box = { top: side('top'), bottom: side('bottom'), left: side('left'), right: side('right'), padding: fromCm(String(f.get(`${prefix}-b-padding`))) };
  return {
    box: box.top || box.bottom || box.left || box.right || box.padding ? box : null,
    background: f.get(`${prefix}-bg`) ? String(f.get(`${prefix}-bg-color`)) : null,
  };
}

/**
 * The page style dialog (sw/uiconfig/swriter/ui/pagedialog.ui), reduced to its Organizer, Page,
 * Header and Footer tabs; the header and footer tabs (svx/uiconfig/ui/headfootformatpage.ui) show
 * the border and background in place of their "More..." button.
 */
function Page({ c, initial = 'page' }: { c: Controller; initial?: 'page' | 'header' | 'footer' }) {
  const doc = c.sh.m_pDoc;
  const [name, setName] = useState(c.dialogPageStyle ?? c.sh.GetCurPageDesc().m_aName);
  const [tab, setTab] = useState<string>(initial);
  const pd = doc.FindPageDesc(name) ?? doc.m_aPageDesc;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => fromCm(String(f.get(k)));
    let w = g('w'), h = g('h');
    const l = g('l'), r = g('r'), tp = g('t'), b = g('b');
    // Orientation swaps the sides so that the longer one runs the chosen way.
    const landscape = f.get('orient') === 'landscape';
    if (landscape !== w > h) [w, h] = [h, w];
    if (w - l - r < CM || h - tp - b < CM) { c.setMessage('The margins leave no room for text on the page.'); return; }
    const hf = { header: readBorderBackground(f, 'header'), footer: readBorderBackground(f, 'footer') };
    c.applyPage((p) => {
      p.nWidth = w; p.nHeight = h; p.nLeft = l; p.nRight = r; p.nTop = tp; p.nBottom = b; p.m_sFollow = String(f.get('follow') || p.m_aName);
      // SvxHFPage::FillItemSet: the spacing, the height and dynamic spacing of a header or footer that is on.
      if (f.get('header')) {
        p.nHeaderSpacing = g('header-spacing'); p.nHeaderMinHeight = g('header-height'); p.bHeaderEatSpacing = !!f.get('header-dynamic');
        p.m_aHeaderBox = hf.header.box; p.m_aHeaderBackground = hf.header.background;
      }
      if (f.get('footer')) {
        p.nFooterSpacing = g('footer-spacing'); p.nFooterMinHeight = g('footer-height'); p.bFooterEatSpacing = !!f.get('footer-dynamic');
        p.m_aFooterBox = hf.footer.box; p.m_aFooterBackground = hf.footer.background;
      }
    }, pd);
    // Header and Footer tabs: on/off, and "Same content on left and right pages" / "on first page".
    for (const bHeader of [true, false]) {
      const k = bHeader ? 'header' : 'footer';
      const on = !!f.get(k);
      c.sh.ChangeHeaderOrFooter(bHeader, on, false, pd.m_aName);
      if (on) {
        doc.SetHeaderFooter(c.sh.m_pCursor, bHeader, !f.get(`${k}-samefirst`), 'first', pd.m_aName);
        doc.SetHeaderFooter(c.sh.m_pCursor, bHeader, !f.get(`${k}-sameleft`), 'left', pd.m_aName);
      }
    }
    c.setDialog(null);
  };
  const has = (bHeader: boolean, kind: 'default' | 'first' | 'left' = 'default') =>
    !!doc.GetNodes().FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode, kind, pd.m_aName);
  const styles = [...new Set([...doc.m_aPageDescs.keys(), ...POOL_PAGE_DESCS])];
  const tabs = { page: t('page.tab.page'), header: t('page.tab.header'), footer: t('page.tab.footer') };
  return (
    <Modal c={c} title={t('page.title', { style: pd.m_aName })} wide>
      <Field label={t('page.style')}><select value={name} onChange={(e) => { doc.FindPageDesc(e.target.value); setName(e.target.value); }}>{styles.map((n) => <option key={n}>{n}</option>)}</select></Field>
      <Tabs ids={Object.keys(tabs)} labels={tabs} current={tab} onChange={setTab} label={t('page.tabs')} />
      <form key={name} onSubmit={submit}>
        <Panel id="page" current={tab}>
          <Field label="Next style"><select name="follow" defaultValue={pd.m_sFollow}>{styles.map((n) => <option key={n}>{n}</option>)}</select></Field>
          <Field label="Orientation"><select name="orient" defaultValue={pd.nWidth > pd.nHeight ? 'landscape' : 'portrait'}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></Field>
          <Field label="Width (cm)"><input name="w" type="number" step="any" min="1" defaultValue={toCm(pd.nWidth)} /></Field>
          <Field label="Height (cm)"><input name="h" type="number" step="any" min="1" defaultValue={toCm(pd.nHeight)} /></Field>
          <Field label="Left margin (cm)"><input name="l" type="number" step="any" min="0" defaultValue={toCm(pd.nLeft)} /></Field>
          <Field label="Right margin (cm)"><input name="r" type="number" step="any" min="0" defaultValue={toCm(pd.nRight)} /></Field>
          <Field label="Top margin (cm)"><input name="t" type="number" step="any" min="0" defaultValue={toCm(pd.nTop)} /></Field>
          <Field label="Bottom margin (cm)"><input name="b" type="number" step="any" min="0" defaultValue={toCm(pd.nBottom)} /></Field>
        </Panel>
        {([true, false] as const).map((bHeader) => {
          const k = bHeader ? 'header' : 'footer';
          return (
            <Panel key={k} id={k} current={tab}>
              <label className="check"><input type="checkbox" name={k} defaultChecked={has(bHeader)} autoFocus={initial === k} /> {t(bHeader ? 'hf.headerOn' : 'hf.footerOn')}</label>
              <label className="check"><input type="checkbox" name={`${k}-sameleft`} defaultChecked={!has(bHeader, 'left')} /> {t('hf.sameLeftRight')}</label>
              <label className="check"><input type="checkbox" name={`${k}-samefirst`} defaultChecked={!has(bHeader, 'first')} /> {t('hf.sameFirst')}</label>
              <Field label={t('hf.spacing')}><input name={`${k}-spacing`} type="number" step="any" min="0" defaultValue={toCm(bHeader ? pd.nHeaderSpacing : pd.nFooterSpacing)} /></Field>
              <label className="check"><input type="checkbox" name={`${k}-dynamic`} defaultChecked={bHeader ? pd.bHeaderEatSpacing : pd.bFooterEatSpacing} /> {t('hf.dynamicSpacing')}</label>
              <Field label={t('hf.height')}><input name={`${k}-height`} type="number" step="any" min="0" defaultValue={toCm(bHeader ? pd.nHeaderMinHeight : pd.nFooterMinHeight)} /></Field>
              <BorderBackgroundFields prefix={k} box={bHeader ? pd.m_aHeaderBox : pd.m_aFooterBox} background={bHeader ? pd.m_aHeaderBackground : pd.m_aFooterBackground} />
            </Panel>
          );
        })}
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * SwHeaderFooterWin::ExecuteCommand "borderback": svx's border and background dialog for the
 * header or footer of a page style, applied to all its variants (SwPageDesc::SetFormatAttrOnAll).
 */
function HeaderFooterBorder({ c, bHeader }: { c: Controller; bHeader: boolean }) {
  const doc = c.sh.m_pDoc;
  const pd = doc.FindPageDesc(c.dialogPageStyle ?? c.sh.GetCurPageDesc().m_aName) ?? doc.m_aPageDesc;
  const prefix = bHeader ? 'header' : 'footer';
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { box, background } = readBorderBackground(new FormData(e.currentTarget), prefix);
    c.sh.ChgPageDesc(pd, (p) => {
      if (bHeader) { p.m_aHeaderBox = box; p.m_aHeaderBackground = background; }
      else { p.m_aFooterBox = box; p.m_aFooterBackground = background; }
    });
    c.setDialog(null);
  };
  return (
    <Modal c={c} title={t('hf.borderBackgroundTitle')}>
      <form onSubmit={submit}>
        <BorderBackgroundFields prefix={prefix} box={bHeader ? pd.m_aHeaderBox : pd.m_aFooterBox} background={bHeader ? pd.m_aHeaderBackground : pd.m_aFooterBackground} />
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** A yes/no message dialog (weld::MessageDialogController), e.g. svx's DeleteHeaderDialog. */
function MessageQuery({ c }: { c: Controller }) {
  const q = c.messageQuery;
  if (!q) return null;
  return (
    <Modal c={c} title={q.title}>
      <p><strong>{q.text}</strong></p>
      <footer>
        <button type="button" onClick={() => c.answerQuery(false)}>{t('common.no')}</button>
        <button type="button" className="primary" autoFocus onClick={() => c.answerQuery(true)}>{t('common.yes')}</button>
      </footer>
    </Modal>
  );
}

/** sw/uiconfig/swriter/ui/insertbreak.ui: a line, column or page break, the page with a style and number. */
function InsertBreak({ c }: { c: Controller }) {
  const [kind, setKind] = useState<'line' | 'column' | 'page'>('page');
  const [renumber, setRenumber] = useState(false);
  const styles = [...new Set([...c.sh.m_pDoc.m_aPageDescs.keys(), ...POOL_PAGE_DESCS])];
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (kind === 'line') c.sh.InsertLineBreak();
    else if (kind === 'column') { c.sh.SplitNode(); c.sh.SetParaAttr({ RES_BREAK: 'column-before' }); }
    else {
      const style = String(f.get('style') ?? '');
      const num = renumber ? Math.max(0, parseInt(String(f.get('num')), 10) || 1) : null;
      if (style) c.sh.m_pDoc.FindPageDesc(style);
      c.sh.InsertPageBreak(style || (num !== null ? c.sh.GetCurPageDesc().m_aName : null), num);
    }
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Insert Break">
      <form onSubmit={submit}>
        <fieldset className="hf"><legend>Type</legend>
          {(['line', 'column', 'page'] as const).map((k) => <label key={k} className="check"><input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} /> {k[0]!.toUpperCase() + k.slice(1)} break</label>)}
        </fieldset>
        {kind === 'page' && <>
          <Field label="Page style"><select name="style" defaultValue=""><option value="">[None]</option>{styles.map((n) => <option key={n}>{n}</option>)}</select></Field>
          <label className="check"><input type="checkbox" checked={renumber} onChange={(e) => setRenumber(e.target.checked)} /> Change page number</label>
          {renumber && <Field label="Page number"><input name="num" type="number" min={0} defaultValue={1} /></Field>}
        </>}
        <Actions c={c} ok="Insert" />
      </form>
    </Modal>
  );
}

function Find({ c }: { c: Controller }) {
  const [q, setQ] = useState(c.sh.GetSelText().includes('\n') ? '' : c.sh.GetSelText());
  const [r, setR] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [status, setStatus] = useState('');
  const find = (backward: boolean) => {
    const ok = c.sh.Find(q, { matchCase, backward });
    setStatus(ok ? '' : 'Not found');
    c.onEdit();
    c.notify();
  };
  const selected = () => (matchCase ? c.sh.GetSelText() === q : c.sh.GetSelText().toLowerCase() === q.toLowerCase());
  return (
    <div className="findbar" role="dialog" aria-label="Find and Replace">
      <input aria-label="Find" placeholder="Find" autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Enter') find(e.shiftKey);
        if (e.key === 'Escape') { c.setDialog(null); c.focusEditor(); }
      }} />
      <input aria-label="Replace with" placeholder="Replace with" value={r} onChange={(e) => setR(e.target.value)} />
      <label className="check"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
      <button onClick={() => find(true)}>Previous</button>
      <button onClick={() => find(false)}>Next</button>
      <button onClick={() => { if (q && selected()) c.sh.Insert(r); find(false); }}>Replace</button>
      <button onClick={() => setStatus(`${c.sh.ReplaceAll(q, r, matchCase)} replaced`)}>Replace All</button>
      <span className="muted" role="status">{status}</span>
      <button aria-label="Close" onClick={() => { c.setDialog(null); c.focusEditor(); }}>×</button>
    </div>
  );
}

function WordCount({ c }: { c: Controller }) {
  const { words, chars } = c.sh.GetWordCount();
  return <Modal c={c} title="Word Count"><p>{words} words<br />{chars} characters</p><footer><button onClick={() => c.setDialog(null)}>Close</button></footer></Modal>;
}

function About({ c }: { c: Controller }) {
  return (
    <Modal c={c} title="About">
      <p>Writer for the Web: an early TypeScript port of LibreOffice Writer that runs entirely in your browser.</p>
      <p className="muted">Based on {upstream.tag}. Licensed under the Mozilla Public License 2.0. Most desktop features are not ported yet; those appear greyed out in the menus.</p>
      <footer><button onClick={() => c.setDialog(null)}>Close</button></footer>
    </Modal>
  );
}

/** The web shell's File > Clear Data: a warning before everything stored in this browser is deleted. */
function ClearData({ c }: { c: Controller }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal c={c} title={t('cleardata.title')}>
      <p><strong>{t('cleardata.text')}</strong></p>
      <p className="muted">{t('cleardata.secondary')}</p>
      <footer>
        <button type="button" autoFocus disabled={busy} onClick={() => c.setDialog(null)}>{t('common.cancel')}</button>
        <button type="button" className="danger-primary" disabled={busy} onClick={() => { setBusy(true); void c.clearData(); }}>{t('cleardata.confirm')}</button>
      </footer>
    </Modal>
  );
}

/** sfx2/uiconfig/ui/querysavedialog.ui: save the changes before another document replaces this one. */
function QuerySave({ c }: { c: Controller }) {
  return (
    <Modal c={c} title={t('querysave.title')}>
      <p><strong>{t('querysave.text', { doc: c.name })}</strong></p>
      <p className="muted">{t('querysave.secondary')}</p>
      <footer>
        <button type="button" onClick={() => void c.answerQuerySave('discard')}>{t('querysave.discard')}</button>
        <button type="button" onClick={() => void c.answerQuerySave(false)}>{t('common.cancel')}</button>
        <button type="button" className="primary" autoFocus onClick={() => void c.answerQuerySave('save')}>{t('querysave.save')}</button>
      </footer>
    </Modal>
  );
}

/** Edit > Go to Page (svx::GotoPageDlg): the cursor to the start of a page. */
function GotoPage({ c }: { c: Controller }) {
  const nPages = c.sh.GetPageCnt();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = Math.max(1, Math.min(nPages, parseInt(String(new FormData(e.currentTarget).get('page')), 10) || 1));
    c.setDialog(null);
    c.sh.GotoPage(n);
    c.onEdit();
    c.notify();
  };
  return (
    <Modal c={c} title={t('gotopage.title')}>
      <form method="dialog" onSubmit={submit}>
        <Field label={t('gotopage.page')}>
          <span className="inline"><input name="page" type="number" min={1} max={nPages} defaultValue={c.sh.GetPageNumber()} autoFocus onFocus={(e) => e.currentTarget.select()} /> {t('gotopage.of', { n: String(nPages) })}</span>
        </Field>
        <footer>
          <button type="button" onClick={() => c.setDialog(null)}>{t('common.cancel')}</button>
          <button type="submit" className="primary">{t('common.ok')}</button>
        </footer>
      </form>
    </Modal>
  );
}

/**
 * uui's RequestPackageReparation query (ERRCODE_UUI_IO_BROKENPACKAGE): the file's package is
 * broken; Repair opens it with its entries recovered.
 */
function RepairPackage({ c }: { c: Controller }) {
  const name = c.repairQuery?.name ?? '';
  return (
    <Modal c={c} title={t('repair.title')}>
      <p><strong>{t('repair.text', { name })}</strong></p>
      <p className="muted">{t('repair.secondary')}</p>
      <p>{t('repair.question')}</p>
      <footer>
        <button type="button" onClick={() => c.answerRepair(false)}>{t('repair.no')}</button>
        <button type="button" className="primary" autoFocus onClick={() => c.answerRepair(true)}>{t('repair.yes')}</button>
      </footer>
    </Modal>
  );
}

/** sw/uiconfig/swriter/ui/inserttable.ui, reduced: size, heading and borders. */
function InsertTable({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => Math.max(1, Math.min(k === 'cols' ? 63 : 1000, parseInt(String(f.get(k)), 10) || 1));
    c.sh.InsertTable(n('rows'), n('cols'), { heading: !!f.get('heading'), repeatHeading: !!f.get('repeat'), borders: !!f.get('borders') });
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Insert Table">
      <form method="dialog" onSubmit={submit}>
        <Field label="Columns"><input name="cols" type="number" min={1} max={63} defaultValue={2} autoFocus /></Field>
        <Field label="Rows"><input name="rows" type="number" min={1} max={1000} defaultValue={2} /></Field>
        <label className="check"><input type="checkbox" name="heading" defaultChecked /> Heading</label>
        <label className="check"><input type="checkbox" name="repeat" defaultChecked /> Repeat heading rows on new pages</label>
        <label className="check"><input type="checkbox" name="borders" defaultChecked /> Default borders</label>
        <Actions c={c} ok="Insert" />
      </form>
    </Modal>
  );
}

/** cui/uiconfig/ui/hyperlinkinternetpage.ui, reduced: URL and text. */
function Hyperlink({ c }: { c: Controller }) {
  const sh = c.sh;
  const cur = sh.HasSelection() ? null : sh.GetINetAttr();
  const initialText = cur ? sh.m_pCursor.GetPoint().GetNode().GetText().slice(cur.start, cur.end) : sh.GetSelText();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let url = String(f.get('url')).trim();
    if (!url) return;
    // Like the dialog's protocol handling: a bare host name becomes an https URL.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('#')) url = url.includes('@') && !url.includes('/') ? `mailto:${url}` : `https://${url}`;
    sh.InsertURL(url, String(f.get('text')));
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Hyperlink">
      <form method="dialog" onSubmit={submit}>
        <Field label="URL"><input name="url" type="text" inputMode="url" defaultValue={cur?.url ?? ''} placeholder="https://" autoFocus /></Field>
        <Field label="Text"><input name="text" type="text" defaultValue={initialText} /></Field>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

// The characters offered first by the Special Characters dropdown, then common symbols.
const SPECIAL_CHARS = [...'“”‘’„«»‹›–—…•·€£¥¢$©®™§¶†‡°±×÷≠≈≤≥∞√∑∏∫π∆µΩαβγδελσφ→←↑↓↔⇒⇔✓✗★☆♥♦♣♠½¼¾¹²³‰′″№℃'];

function SpecialChar({ c }: { c: Controller }) {
  const [hover, setHover] = useState('');
  const insert = (ch: string) => { c.sh.Insert(ch); c.setDialog(null); };
  return (
    <Modal c={c} title="Special Characters" wide>
      <div className="charmap" role="grid" aria-label="Characters">
        {SPECIAL_CHARS.map((ch) => (
          <button key={ch} type="button" title={`U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`}
            onMouseEnter={() => setHover(ch)} onFocus={() => setHover(ch)} onClick={() => insert(ch)}>{ch}</button>
        ))}
      </div>
      <p className="muted">{hover ? `U+${hover.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : 'Choose a character to insert it.'}</p>
      <footer><button onClick={() => c.setDialog(null)}>Close</button></footer>
    </Modal>
  );
}

/** cui/uiconfig/ui/optuserpage.ui, reduced to the name used for new comments. */
/** A row of tabs (or the sidebar's list) with arrow-key navigation, as weld::Notebook / the options tree. */
function Tabs({ ids, labels, current, onChange, vertical, label }: { ids: string[]; labels: Record<string, string>; current: string; onChange: (id: string) => void; vertical?: boolean; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: React.KeyboardEvent, k: number) => {
    const next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!next) return;
    e.preventDefault();
    const n = (k + next + ids.length) % ids.length;
    onChange(ids[n]!);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} aria-orientation={vertical ? 'vertical' : 'horizontal'} className={vertical ? 'side-tabs' : 'tabs'}>
      {ids.map((id, k) => (
        <button key={id} ref={(el) => { refs.current[k] = el; }} type="button" role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={current === id} tabIndex={current === id ? 0 : -1} onClick={() => onChange(id)} onKeyDown={(e) => move(e, k)}>{labels[id]}</button>
      ))}
    </div>
  );
}

/** A tab's panel; every panel stays mounted so that the form keeps all its fields. */
const Panel = ({ id, current, children }: { id: string; current: string; children: ReactNode }) => (
  <section role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={current !== id}>{children}</section>
);

/**
 * Tools > Options (the options dialog's tree, reduced to the pages that are ported): a list of
 * pages beside the selected page.
 */
function Options({ c }: { c: Controller }) {
  const [page, setPage] = useState(() => { try { return sessionStorage.getItem('writer:optionspage') ?? 'user'; } catch { return 'user'; } });
  const choose = (p: string) => { setPage(p); try { sessionStorage.setItem('writer:optionspage', p); } catch { /* storage unavailable */ } };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.author = String(f.get('name')).trim();
    c.onlineSpell = f.get('autospell') === 'on';
    c.ctrlClickHyperlink = f.get('ctrlclick') === 'on';
    // OptLanguageToolTabPage::FillItemSet: an empty base URL is the free server's; with a user
    // name and API key, the free server's URL becomes the premium one (tdf#150494, tdf#159395).
    const ltServer = f.get('ltengine') === 'server';
    let baseURL = String(f.get('ltbaseurl') ?? '').trim();
    const username = String(f.get('ltusername') ?? '').trim(), apiKey = String(f.get('ltapikey') ?? '').trim();
    if (baseURL === '' || (username === '' && apiKey === '' && baseURL === LANGUAGETOOLPLUS_DEFAULT_URL)) baseURL = LANGUAGETOOL_DEFAULT_URL;
    if (username !== '' && apiKey !== '' && baseURL === LANGUAGETOOL_DEFAULT_URL) baseURL = LANGUAGETOOLPLUS_DEFAULT_URL;
    c.setLanguageToolCfg({ IsEnabled: f.get('ltactivate') === 'on', BaseURL: ltServer ? baseURL : LOCAL_LANGUAGETOOL_URL, ServerURL: baseURL, Username: username, ApiKey: apiKey, RestProtocol: String(f.get('ltrest') ?? '').trim() });
    const theme = String(f.get('icontheme'));
    if (theme !== c.iconTheme && (ICON_THEMES as readonly string[]).includes(theme)) c.setIconTheme(theme as IconTheme);
    c.setDialog(null);
    c.notify();
  };
  const pages = ['user', 'view', 'fonts', 'writing', 'languagetool', 'keyboard'];
  const labels = { user: t('options.user'), view: t('options.view'), fonts: t('fonts.title'), writing: t('options.writing'), languagetool: t('lt.title'), keyboard: t('keys.title') };
  return (
    <Modal c={c} title={t('options.title')} wide>
      <form method="dialog" onSubmit={submit} className="options">
        <nav><Tabs ids={pages} labels={labels} current={page} onChange={choose} vertical label={t('options.title')} /></nav>
        <div className="options-page">
          <Panel id="user" current={page}>
            <h3>{t('options.user')}</h3>
            <Field label={t('options.name')}><input name="name" defaultValue={c.author === 'Unknown Author' ? '' : c.author} placeholder={t('options.namePlaceholder')} autoFocus /></Field>
            <p className="muted">{t('options.stored')}</p>
          </Panel>
          {/* LibreOffice > View: the icon theme. */}
          <Panel id="view" current={page}>
            <h3>{t('options.view')}</h3>
            <Field label={t('options.iconTheme')}>
              <select name="icontheme" defaultValue={c.iconTheme}>
                {ICON_THEMES.map((th) => <option key={th} value={th}>{t(`iconTheme.${th}`)}</option>)}
              </select>
            </Field>
            <p className="muted">{t('options.iconThemeHint')}</p>
          </Panel>
          <Panel id="fonts" current={page}><FontSettings c={c} /></Panel>
          <Panel id="writing" current={page}>
            <h3>{t('options.writing')}</h3>
            <label className="check"><input type="checkbox" name="autospell" defaultChecked={c.onlineSpell} /> {t('options.autospell')}</label>
            <p className="muted">{t('options.autospellHint')}</p>
            <label className="check"><input type="checkbox" name="ctrlclick" defaultChecked={c.ctrlClickHyperlink} /> {t('options.ctrlClick')}</label>
          </Panel>
          <Panel id="languagetool" current={page}><LanguageToolSettings c={c} /></Panel>
          <Panel id="keyboard" current={page}><KeyboardSettings c={c} /></Panel>
        </div>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * Tools > Options > Language Settings > LanguageTool Server (cui/uiconfig/ui/langtoolconfigpage.ui),
 * with a choice of where LanguageTool runs: in this browser (the default; nothing is sent
 * anywhere) or on a server, with upstream's server settings.
 */
function LanguageToolSettings({ c }: { c: Controller }) {
  const cfg = c.languageToolCfg;
  const [on, setOn] = useState(cfg.IsEnabled);
  const [server, setServer] = useState(cfg.BaseURL !== LOCAL_LANGUAGETOOL_URL);
  return (
    <>
      <h3>{t('lt.title')}</h3>
      <label className="check"><input type="checkbox" name="ltactivate" checked={on} onChange={(e) => setOn(e.target.checked)} /> {t('lt.activate')}</label>
      <p className="muted">{t('lt.activateHint')}</p>
      <fieldset disabled={!on} className="lt-engine">
        <label className="check"><input type="radio" name="ltengine" value="browser" checked={!server} onChange={() => setServer(false)} /> {t('lt.browser')}</label>
        <p className="muted">{t('lt.browserHint')}</p>
        <label className="check"><input type="radio" name="ltengine" value="server" checked={server} onChange={() => setServer(true)} /> {t('lt.server')}</label>
        <div hidden={!server}>
          <p className="muted">{t('lt.disclaimer')} <a href="https://languagetool.org/legal/privacy" target="_blank" rel="noreferrer">{t('lt.policy')}</a></p>
          <Field label={t('lt.base')}><input name="ltbaseurl" defaultValue={cfg.ServerURL || ''} placeholder={LANGUAGETOOL_DEFAULT_URL} /></Field>
          <p className="muted">{t('lt.urldesc')}</p>
          <Field label={t('lt.username')}><input name="ltusername" defaultValue={cfg.Username} placeholder={t('lt.leaveEmpty')} autoComplete="off" /></Field>
          <p className="muted">{t('lt.usernamedesc')}</p>
          <Field label={t('lt.apikey')}><input name="ltapikey" type="password" defaultValue={cfg.ApiKey} placeholder={t('lt.leaveEmpty')} autoComplete="off" /></Field>
          <p className="muted">{t('lt.apikeydesc')}</p>
          <Field label={t('lt.rest')}><input name="ltrest" defaultValue={cfg.RestProtocol} placeholder={t('lt.restLeaveEmpty')} /></Field>
          <p className="muted">{t('lt.restdesc')}</p>
        </div>
      </fieldset>
    </>
  );
}

/**
 * Tools > Options > Fonts: the font replacement profile (LibreOffice's fonts, Google Fonts, or the
 * user's own), its replacement table and default fonts, import and export, and the font list.
 */
function FontSettings({ c }: { c: Controller }) {
  const fs = c.fonts;
  const [, refresh] = useState(0);
  const update = () => refresh((n) => n + 1);
  const p = fs.active;
  const rows = Object.entries(p.replacements);
  const change = (next: typeof p) => { fs.updateProfile(next); update(); };
  const setRow = (k: number, from: string, to: string) => {
    const entries = rows.map((r, i) => (i === k ? [from, to] : r));
    change({ ...p, replacements: Object.fromEntries(entries.filter(([f]) => f !== undefined)) });
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const download = () => {
    const url = URL.createObjectURL(new Blob([fs.exportProfile(p)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${p.name.replace(/[^\w.-]+/g, '-')}.fonts.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const ro = !!p.builtin;
  const [tab, setTab] = useState('profiles');
  const tabs = ['profiles', 'defaults', 'list'];
  const tabLabels = { profiles: t('fonts.tab.profiles'), defaults: t('fonts.tab.defaults'), list: t('fonts.tab.list') };
  const profileSelect = (
    <Field label={t('fonts.profile')}>
      <select aria-label={t('fonts.profile')} value={p.id} onChange={(e) => { fs.setActive(e.target.value); update(); }}>
        {fs.profiles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </Field>
  );
  return (
    <div className="font-settings">
      <h3>{t('fonts.title')}</h3>
      <Tabs ids={tabs} labels={tabLabels} current={tab} onChange={setTab} label={t('fonts.title')} />
      <Panel id="profiles" current={tab}>
      <Field label={t('fonts.profile')}>
        <select aria-label={t('fonts.profile')} value={p.id} onChange={(e) => { fs.setActive(e.target.value); update(); }}>
          {fs.profiles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <p className="muted">{t('fonts.profileHint')}</p>
      <div className="button-row">
        <button type="button" onClick={() => { fs.cloneProfile(p); update(); }}>{t('fonts.duplicate')}</button>
        <button type="button" disabled={ro} onClick={() => { fs.deleteProfile(p.id); update(); }}>{t('fonts.delete')}</button>
        <button type="button" onClick={() => fileRef.current?.click()}>{t('fonts.import')}</button>
        <button type="button" onClick={download}>{t('fonts.export')}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void f.text().then((s) => { fs.importProfile(s); update(); }).catch((err: Error) => c.setMessage(err.message));
        }} />
      </div>
      {ro ? <p className="muted">{t('fonts.builtinHint')}</p> : (
        <Field label={t('fonts.name')}><input value={p.name} onChange={(e) => change({ ...p, name: e.target.value })} /></Field>
      )}
      <table className="font-table">
        <thead><tr><th>{t('fonts.font')}</th><th>{t('fonts.replacement')}</th>{!ro && <th />}</tr></thead>
        <tbody>
          {rows.map(([from, to], k) => (
            <tr key={k}>
              <td><FontNameField c={c} label={t('fonts.font')} value={from} readOnly={ro} onChange={(v) => setRow(k, v, to)} /></td>
              <td><FontNameField c={c} label={t('fonts.replacement')} value={to} readOnly={ro} onChange={(v) => setRow(k, from, v)} /></td>
              {!ro && <td><button type="button" aria-label={t('fonts.remove')} onClick={() => change({ ...p, replacements: Object.fromEntries(rows.filter((_, i) => i !== k)) })}>×</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!ro && <button type="button" onClick={() => change({ ...p, replacements: { ...p.replacements, '': '' } })}>{t('fonts.add')}</button>}
      </Panel>
      <Panel id="defaults" current={tab}>
      {profileSelect}
      <p className="muted">{t('fonts.defaultsHint')}</p>
      {ro && <p className="muted">{t('fonts.builtinHint')}</p>}
      {(['sans', 'serif', 'mono'] as const).map((k) => (
        <Field key={k} label={t(`fonts.${k}`)}>
          <FontNameField c={c} label={t(`fonts.${k}`)} value={p.defaults[k]} readOnly={ro} onChange={(v) => change({ ...p, defaults: { ...p.defaults, [k]: v } })} />
        </Field>
      ))}
      <label className="check"><input type="checkbox" checked={fs.alwaysReplace} onChange={(e) => { fs.setAlwaysReplace(e.target.checked); update(); }} /> {t('fonts.always')}</label>
      </Panel>
      <Panel id="list" current={tab}>
      <label className="check"><input type="checkbox" checked={fs.showAll} onChange={(e) => { fs.setShowAll(e.target.checked); update(); c.notify(); }} /> {t('fonts.showAll')}</label>
      <p className="muted">{t('fonts.showAllHint')}</p>
      <label className="check"><input type="checkbox" checked={fs.preview && !fs.showAll} disabled={fs.showAll} onChange={(e) => { fs.setPreview(e.target.checked); update(); c.notify(); }} /> {t('fonts.preview')}</label>
      <p className="muted">{t('fonts.previewHint')}</p>
      </Panel>
    </div>
  );
}

/** sw's tocindexpage, reduced to the title and the outline levels evaluated. */
function InsertToc({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.sh.InsertTableOf(String(f.get('title')), Math.max(1, Math.min(10, parseInt(String(f.get('levels')), 10) || 10)));
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Table of Contents">
      <form onSubmit={submit}>
        <Field label="Title"><input name="title" defaultValue="Table of Contents" autoFocus /></Field>
        <Field label="Evaluate up to level"><input name="levels" type="number" min={1} max={10} defaultValue={10} /></Field>
        <p className="muted">Entries come from paragraphs in the Heading 1 to Heading 10 styles. Use Update Index after editing.</p>
        <Actions c={c} ok="Insert" />
      </form>
    </Modal>
  );
}


// sw/uiconfig/swriter/ui/frmtypepage.ui and wrappage.ui, reduced: size, anchor, position, wrap.
const H_ORIENT: [number, string][] = [[HoriOrientation.LEFT, 'Left'], [HoriOrientation.CENTER, 'Center'], [HoriOrientation.RIGHT, 'Right'], [HoriOrientation.NONE, 'From left']];
const V_ORIENT: [number, string][] = [[VertOrientation.TOP, 'Top'], [VertOrientation.CENTER, 'Center'], [VertOrientation.BOTTOM, 'Bottom'], [VertOrientation.NONE, 'From top']];
const H_REL: [number, string][] = [[RelOrientation.FRAME, 'Paragraph area'], [RelOrientation.PRINT_AREA, 'Paragraph text area'], [RelOrientation.FRAME_LEFT, 'Left paragraph border'], [RelOrientation.FRAME_RIGHT, 'Right paragraph border'],
  [RelOrientation.PAGE_FRAME, 'Entire page'], [RelOrientation.PAGE_PRINT_AREA, 'Page text area'], [RelOrientation.PAGE_LEFT, 'Left page border'], [RelOrientation.PAGE_RIGHT, 'Right page border']];
const V_REL: [number, string][] = [[RelOrientation.FRAME, 'Margin'], [RelOrientation.PRINT_AREA, 'Paragraph text area'], [RelOrientation.PAGE_FRAME, 'Entire page'], [RelOrientation.PAGE_PRINT_AREA, 'Page text area']];
const WRAPS: [WrapTextMode, string][] = [[WrapTextMode.NONE, 'None'], [WrapTextMode.LEFT, 'Before'], [WrapTextMode.RIGHT, 'After'], [WrapTextMode.PARALLEL, 'Parallel'], [WrapTextMode.THROUGH, 'Through'], [WrapTextMode.DYNAMIC, 'Optimal']];
const ANCHORS: [RndStdIds, string][] = [[RndStdIds.FLY_AT_PAGE, 'To page'], [RndStdIds.FLY_AT_PARA, 'To paragraph'], [RndStdIds.FLY_AT_CHAR, 'To character'], [RndStdIds.FLY_AS_CHAR, 'As character']];

function FlyProperties({ c }: { c: Controller }) {
  const sh = c.sh;
  const fmt = sh.GetFlyFrameFormat();
  const [ratio, setRatio] = useState(fmt?.graphic !== undefined);
  const wRef = useRef<HTMLInputElement>(null), hRef = useRef<HTMLInputElement>(null);
  if (!fmt) return null;
  const isGraphic = fmt.graphic !== undefined;
  const shape = fmt.m_pShape;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => Number(f.get(k));
    const anchor = n('anchor') as RndStdIds;
    const change: Partial<SwFlyFrameFormat> = {
      m_aName: String(f.get('name') || fmt.m_aName).trim() || fmt.m_aName,
      m_nWidth: Math.max(56, fromCm(String(f.get('w')))), m_nHeight: Math.max(56, fromCm(String(f.get('h')))),
      m_aHoriOrient: { m_eOrient: n('horient'), m_eRelation: n('hrel'), m_nPos: fromCm(String(f.get('hpos'))) },
      m_aVertOrient: { m_eOrient: n('vorient'), m_eRelation: n('vrel'), m_nPos: fromCm(String(f.get('vpos'))) },
      // SwWrapTabPage: contour and outside only, for graphics with a wrap other than none and through.
      m_aSurround: { ...fmt.m_aSurround, m_eSurround: n('wrap') as WrapTextMode, m_bContour: !!f.get('contour') && isGraphic, m_bOutside: !!f.get('outside') },
      m_bOpaque: !f.get('background'),
      m_nLeftSpace: fromCm(String(f.get('sl'))), m_nRightSpace: fromCm(String(f.get('sr'))), m_nUpperSpace: fromCm(String(f.get('st'))), m_nLowerSpace: fromCm(String(f.get('sb'))),
      ...(isGraphic ? { alt: String(f.get('alt') ?? '') || undefined } : shape ? {} : { m_bAutoHeight: !!f.get('autoh') }),
      // svx's area and line tab pages (SvxAreaTabPage, SvxLineTabPage) and the rotation (SvxAngleTabPage).
      ...(shape ? { m_pShape: {
        ...shape,
        m_aFill: f.get('fill') ? String(f.get('fillcolor')) : null,
        m_aLine: f.get('line') ? { color: String(f.get('linecolor')), width: Math.max(0, Math.round(Number(f.get('linewidth')) * 20) || 0) } : null,
        m_nRotate: ((Number(f.get('rotate')) % 360) + 360) % 360 || undefined,
      } } : {}),
    };
    if (change.m_aName !== fmt.m_aName && sh.m_pDoc.FindFlyByName(change.m_aName!)) { c.setMessage(`The name “${change.m_aName}” is already in use.`); return; }
    // The anchor goes first: changing it keeps the object where it is, the rest then applies.
    if (anchor !== fmt.m_aAnchor.m_eAnchorId) sh.ChgAnchor(anchor);
    const name = change.m_aName!;
    sh.SetFlyFrameAttr({ ...change, m_aName: fmt.m_aName });
    // SwNoTextNode::CreateContour when contour wrap is turned on without a contour.
    if (change.m_aSurround?.m_bContour && !fmt.m_aContour?.length) {
      void c.selectedBitmap().then((b) => { const poly = b ? CreateAutoContour(b) : []; if (poly.length) { sh.SetFlyFrameAttr({ m_aContour: poly, m_bAutoContour: true }); c.notify(); } });
    }
    if (name !== fmt.m_aName) { sh.SetFlyFrameAttr({ m_aName: name }); sh.SelectFly(name); }
    c.setDialog(null);
  };
  const keep = (from: 'w' | 'h') => {
    if (!ratio) return;
    const w = wRef.current!, h = hRef.current!;
    const r = fmt.m_nHeight / fmt.m_nWidth;
    if (from === 'w') h.value = String(toCm(fromCm(w.value) * r)); else w.value = String(toCm(fromCm(h.value) / r));
  };
  const opts = (list: [number, string][]) => list.map(([v, l]) => <option key={v} value={v}>{l}</option>);
  return (
    <Modal c={c} title={isGraphic ? 'Image' : shape ? t('shape.title') : 'Frame'} wide>
      <form onSubmit={submit} className="flyprops">
        <fieldset><legend>Size</legend>
          <Field label="Width (cm)"><input ref={wRef} name="w" type="number" step="any" min="0.1" defaultValue={toCm(fmt.m_nWidth)} onInput={() => keep('w')} autoFocus /></Field>
          <Field label={fmt.m_bAutoHeight ? 'Minimum height (cm)' : 'Height (cm)'}><input ref={hRef} name="h" type="number" step="any" min="0.1" defaultValue={toCm(fmt.m_nHeight)} onInput={() => keep('h')} /></Field>
          <label className="check"><input type="checkbox" checked={ratio} onChange={(e) => setRatio(e.target.checked)} /> Keep ratio</label>
          {!isGraphic && !shape && <label className="check"><input type="checkbox" name="autoh" defaultChecked={!!fmt.m_bAutoHeight} /> AutoSize height</label>}
        </fieldset>
        <fieldset><legend>Anchor</legend>
          {ANCHORS.filter(([v]) => isGraphic || (shape && fmt.m_sContentId === undefined) || v !== RndStdIds.FLY_AS_CHAR).map(([v, l]) => (
            <label key={v} className="check"><input type="radio" name="anchor" value={v} defaultChecked={fmt.m_aAnchor.m_eAnchorId === v} /> {l}</label>
          ))}
        </fieldset>
        <fieldset><legend>Position</legend>
          <Field label="Horizontal"><select name="horient" defaultValue={fmt.m_aHoriOrient.m_eOrient}>{opts(H_ORIENT)}</select></Field>
          <Field label="by (cm)"><input name="hpos" type="number" step="any" defaultValue={toCm(fmt.m_aHoriOrient.m_nPos)} /></Field>
          <Field label="to"><select name="hrel" defaultValue={fmt.m_aHoriOrient.m_eRelation}>{opts(H_REL.some(([v]) => v === fmt.m_aHoriOrient.m_eRelation) ? H_REL : [...H_REL, [fmt.m_aHoriOrient.m_eRelation, 'Character']])}</select></Field>
          <Field label="Vertical"><select name="vorient" defaultValue={fmt.m_aVertOrient.m_eOrient}>{opts(V_ORIENT.some(([v]) => v === fmt.m_aVertOrient.m_eOrient) ? V_ORIENT : [...V_ORIENT, [fmt.m_aVertOrient.m_eOrient, 'Line']])}</select></Field>
          <Field label="by (cm)"><input name="vpos" type="number" step="any" defaultValue={toCm(fmt.m_aVertOrient.m_nPos)} /></Field>
          <Field label="to"><select name="vrel" defaultValue={fmt.m_aVertOrient.m_eRelation}>{opts(V_REL.some(([v]) => v === fmt.m_aVertOrient.m_eRelation) ? V_REL : [...V_REL, [fmt.m_aVertOrient.m_eRelation, 'Other']])}</select></Field>
        </fieldset>
        <fieldset><legend>Wrap</legend>
          <div className="wraps">
            {WRAPS.map(([v, l]) => <label key={v} className="check"><input type="radio" name="wrap" value={v} defaultChecked={fmt.m_aSurround.m_eSurround === v} /> {l}</label>)}
          </div>
          <label className="check"><input type="checkbox" name="background" defaultChecked={!fmt.m_bOpaque} /> In background</label>
          {isGraphic && <label className="check"><input type="checkbox" name="contour" defaultChecked={!!fmt.m_aSurround.m_bContour} /> Contour</label>}
          {isGraphic && <label className="check"><input type="checkbox" name="outside" defaultChecked={!!fmt.m_aSurround.m_bOutside} /> Outside only</label>}
          <Field label="Spacing left (cm)"><input name="sl" type="number" step="any" min="0" defaultValue={toCm(fmt.m_nLeftSpace)} /></Field>
          <Field label="Spacing right (cm)"><input name="sr" type="number" step="any" min="0" defaultValue={toCm(fmt.m_nRightSpace)} /></Field>
          <Field label="Spacing top (cm)"><input name="st" type="number" step="any" min="0" defaultValue={toCm(fmt.m_nUpperSpace)} /></Field>
          <Field label="Spacing bottom (cm)"><input name="sb" type="number" step="any" min="0" defaultValue={toCm(fmt.m_nLowerSpace)} /></Field>
        </fieldset>
        {shape && <fieldset><legend>{t('shape.areaLine')}</legend>
          <label className="check"><input type="checkbox" name="fill" defaultChecked={!!shape.m_aFill} /> {t('shape.fill')}</label>
          <Field label={t('shape.fillColor')}><input type="color" name="fillcolor" defaultValue={shape.m_aFill ?? COL_DEFAULT_SHAPE_FILLING} /></Field>
          <label className="check"><input type="checkbox" name="line" defaultChecked={!!shape.m_aLine} /> {t('shape.line')}</label>
          <Field label={t('shape.lineColor')}><input type="color" name="linecolor" defaultValue={shape.m_aLine?.color ?? COL_DEFAULT_SHAPE_STROKE} /></Field>
          <Field label={t('shape.lineWidth')}><input type="number" name="linewidth" step="any" min="0" defaultValue={(shape.m_aLine?.width ?? 0) / 20} /></Field>
          <Field label={t('shape.rotate')}><input type="number" name="rotate" step="1" defaultValue={Math.round((shape.m_nRotate ?? 0) * 100) / 100} /></Field>
        </fieldset>}
        <fieldset><legend>Options</legend>
          <Field label="Name"><input name="name" defaultValue={fmt.m_aName} /></Field>
          {isGraphic && <Field label="Alternative text"><input name="alt" defaultValue={fmt.alt ?? ''} /></Field>}
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** sw/uiconfig/swriter/ui/managechangessidebar.ui, reduced: the list of changes with accept and reject. */
/** sfx2 ConvertWhiteSpaces_Impl: line breaks and tabs as blanks, for the list. */
const ConvertWhiteSpaces_Impl = (rText: string) => rText.replace(/[\n\t]/g, ' ');

/**
 * sfx2/uiconfig/ui/versioncommentdialog.ui (SfxViewVersionDialog_Impl): the comment of a new
 * version to enter, or of a saved one to read.
 */
function VersionComment({ info, edit, onDone }: { info: { date?: Date; author: string; comment: string }; edit: boolean; onDone: (comment: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const title = edit ? t('versions.insertComment') : t('versions.viewComment');
  return (
    <dialog ref={ref} className="version-comment" aria-label={title} onClose={() => onDone(null)} onClick={(e) => e.stopPropagation()}>
      <h2>{title}</h2>
      <form onSubmit={(e) => { e.preventDefault(); onDone(text.current?.value ?? ''); }}>
        {!edit && info.date && <p>{t('versions.timestamp')}{info.date.toLocaleString()}</p>}
        <p>{t('versions.author')}{info.author || t('versions.noName')}</p>
        <textarea ref={text} rows={7} cols={40} defaultValue={info.comment} readOnly={!edit} autoFocus={edit} aria-label={t('versions.comments')}
          onKeyDown={(e) => { if (edit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <footer>
          {edit ? (
            <><button type="button" onClick={() => onDone(null)}>{t('common.cancel')}</button><button type="submit" className="primary">{t('common.ok')}</button></>
          ) : <button type="button" className="primary" autoFocus onClick={() => onDone(null)}>{t('versions.close')}</button>}
        </footer>
      </form>
    </dialog>
  );
}

/** The web shell's File > Save New Version (Ctrl+Alt+V): the comment, then a new version. */
function SaveVersion({ c }: { c: Controller }) {
  return <VersionComment info={{ author: c.userFullName, comment: '' }} edit onDone={(r) => { c.setDialog(null); if (r !== null) void c.saveVersionCommand(r); }} />;
}

/** sfx2/uiconfig/ui/versionsofdialog.ui (SfxVersionDialog): File > Versions. */
function Versions({ c }: { c: Controller }) {
  const versions = c.versions;
  // Init_Impl: the newest version is selected.
  const [sel, setSel] = useState(versions.length - 1);
  const [sub, setSub] = useState<'save' | 'show' | null>(null);
  const [busy, setBusy] = useState(false);
  const nEntry = sel >= 0 && sel < versions.length ? sel : -1;
  const cur = nEntry !== -1 ? versions[nEntry] : undefined;
  const save = async (comment: string | null) => {
    setSub(null);
    if (comment === null) return;
    setBusy(true);
    await c.saveNewVersion(comment);
    setBusy(false);
    setSel(c.versions.length - 1);
  };
  const remove = () => {
    if (!cur) return;
    c.deleteVersion(cur.Identifier);
    setSel(c.versions.length - 1);
  };
  return (
    <Modal c={c} title={t('versions.title', { doc: c.name })} wide>
      <div className="versions">
        <fieldset><legend>{t('versions.new')}</legend>
          <button type="button" disabled={busy} onClick={() => setSub('save')}>{t('versions.save')}</button>
          <label className="check"><input type="checkbox" checked={c.saveVersionOnClose} onChange={(e) => { c.saveVersionOnClose = e.currentTarget.checked; }} /> {t('versions.always')}</label>
          {c.autoSave && <p className="muted">{t('versions.autosave')}</p>}
        </fieldset>
        <fieldset><legend>{t('versions.existing')}</legend>
          {versions.length === 0 ? <p className="muted">{t('versions.none')}</p> : (
            <div className="changes-scroll"><table className="changes" role="grid">
              <thead><tr><th>{t('versions.datetime')}</th><th>{t('versions.savedby')}</th><th>{t('versions.comments')}</th></tr></thead>
              <tbody>
                {versions.map((v, i) => (
                  <tr key={v.Identifier} aria-selected={i === nEntry} className={i === nEntry ? 'selected' : undefined} onClick={() => setSel(i)} onDoubleClick={() => void c.openVersion(i)}>
                    <td>{dateOf(v.TimeStamp).toLocaleString()}</td><td>{v.Author}</td><td className="excerpt">{ConvertWhiteSpaces_Impl(v.Comment)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </fieldset>
        <footer>
          <button type="button" disabled={!cur} onClick={remove}>{t('versions.delete')}</button>
          <button type="button" disabled={!versions.length} onClick={() => { c.deleteAllVersions(); setSel(-1); }}>{t('versions.deleteAll')}</button>
          <button type="button" disabled title={t('versions.compareMissing')}>{t('versions.compare')}</button>
          <button type="button" disabled={!cur} onClick={() => setSub('show')}>{t('versions.show')}</button>
          <button type="button" disabled={!cur} onClick={() => void c.openVersion(nEntry)}>{t('versions.open')}</button>
          <button type="button" className="primary" onClick={() => c.setDialog(null)}>{t('versions.close')}</button>
        </footer>
      </div>
      {sub === 'save' && <VersionComment info={{ author: c.userFullName, comment: '' }} edit onDone={(r) => void save(r)} />}
      {sub === 'show' && cur && <VersionComment info={{ date: dateOf(cur.TimeStamp), author: cur.Author, comment: cur.Comment }} edit={false} onDone={() => setSub(null)} />}
    </Modal>
  );
}

function ManageChanges({ c }: { c: Controller }) {
  const sh = c.sh;
  const table = sh.GetRedlineTable();
  const [sel, setSel] = useState(0);
  const cur = table[Math.min(sel, table.length - 1)];
  const excerpt = (r: (typeof table)[number]) => r.pieces.map((p) => (p.mark ? '¶' : p.node.GetText().slice(p.start, p.end))).join('').replace(/\u0001/g, '').slice(0, 60);
  const act = (f: () => void) => { f(); c.notify(); };
  return (
    <Modal c={c} title="Manage Changes" wide>
      {table.length === 0 ? <p className="muted">There are no tracked changes in this document.</p> : (
        <div className="changes-scroll"><table className="changes" role="grid">
          <thead><tr><th>Action</th><th>Author</th><th>Date</th><th>Text</th></tr></thead>
          <tbody>
            {table.map((r, i) => (
              <tr key={i} aria-selected={r === cur} className={r === cur ? 'selected' : undefined} onClick={() => { setSel(i); sh.SelectRedline(r); c.notify(); }}>
                <td>{r.data.type === 'Insert' ? 'Insertion' : 'Deletion'}</td><td>{r.data.author}</td>
                <td>{r.data.date ? new Date(r.data.date).toLocaleString() : ''}</td><td className="excerpt">{excerpt(r)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <footer>
        <button type="button" disabled={!cur} onClick={() => act(() => sh.AcceptReject(cur!, true))}>Accept</button>
        <button type="button" disabled={!cur} onClick={() => act(() => sh.AcceptReject(cur!, false))}>Reject</button>
        <button type="button" disabled={!table.length} onClick={() => act(() => sh.AcceptRejectAll(true))}>Accept All</button>
        <button type="button" disabled={!table.length} onClick={() => act(() => sh.AcceptRejectAll(false))}>Reject All</button>
        <button type="button" className="primary" onClick={() => c.setDialog(null)}>Close</button>
      </footer>
    </Modal>
  );
}

// sw/uiconfig/swriter/ui/sectionpage.ui and columnpage.ui, reduced: name, options and equal columns.
function ColumnFields({ col, balance }: { col: SwFormatCol | null; balance?: boolean }) {
  return (
    <fieldset className="hf"><legend>Columns</legend>
      <Field label="Columns"><input name="cols" type="number" min={1} max={99} defaultValue={col?.m_nCount ?? 1} /></Field>
      <Field label="Spacing (cm)"><input name="gap" type="number" step="any" min="0" defaultValue={toCm(col?.m_nGutterWidth ?? DEF_GUTTER_WIDTH)} /></Field>
      <label className="check"><input type="checkbox" name="line" defaultChecked={col?.m_bLine ?? false} /> Separator line</label>
      {balance && <label className="check"><input type="checkbox" name="balance" defaultChecked={col?.m_bBalanced ?? true} /> Evenly distribute contents</label>}
    </fieldset>
  );
}
const readColumnFields = (f: FormData): SwFormatCol | null => {
  const n = Math.max(1, Math.min(99, parseInt(String(f.get('cols')), 10) || 1));
  return n < 2 ? null : { m_nCount: n, m_nGutterWidth: fromCm(String(f.get('gap'))), m_bLine: !!f.get('line'), m_bBalanced: f.get('balance') === null ? true : !!f.get('balance') };
};

function SectionFields({ d }: { d: SwSectionData }) {
  return (
    <>
      <Field label="Name"><input name="name" defaultValue={d.m_sSectionName} autoFocus /></Field>
      <label className="check"><input type="checkbox" name="hide" defaultChecked={d.m_bHidden} /> Hide</label>
      <label className="check"><input type="checkbox" name="protect" defaultChecked={d.m_bProtectFlag} /> Protect</label>
      <ColumnFields col={d.m_aCol} balance />
    </>
  );
}
const readSectionFields = (f: FormData, d: SwSectionData): SwSectionData => ({
  ...d, m_sSectionName: String(f.get('name') ?? '').trim() || d.m_sSectionName, m_bHidden: !!f.get('hide'), m_bProtectFlag: !!f.get('protect'), m_aCol: readColumnFields(f),
});

function InsertSection({ c }: { c: Controller }) {
  const d: SwSectionData = { m_sSectionName: c.sh.m_pDoc.GetUniqueSectionName(), m_bHidden: false, m_bProtectFlag: false, m_aCol: null };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = readSectionFields(new FormData(e.currentTarget), d);
    if (c.sh.m_pDoc.GetSections().some((s) => s.m_pSection.m_sSectionName === data.m_sSectionName)) { c.setMessage(`A section named “${data.m_sSectionName}” already exists.`); return; }
    if (!c.sh.m_pDoc.InsertSwSection(c.sh.m_pCursor, data)) c.setMessage('A section cannot start and end in different sections or tables.');
    c.setDialog(null);
  };
  return <Modal c={c} title="Insert Section"><form onSubmit={submit}><SectionFields d={d} /><Actions c={c} ok="Insert" /></form></Modal>;
}

function EditSections({ c }: { c: Controller }) {
  const sections = c.sh.m_pDoc.GetSections();
  const here = c.sh.m_pCursor.GetPoint().GetNode().FindSectionNode();
  const [name, setName] = useState((here ?? sections[0])?.m_pSection.m_sSectionName ?? '');
  const sec = sections.find((s) => s.m_pSection.m_sSectionName === name) ?? sections[0];
  if (!sec) return null;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    c.sh.m_pDoc.UpdateSection(c.sh.m_pCursor, sec, readSectionFields(new FormData(e.currentTarget), sec.m_pSection));
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Edit Sections">
      <Field label="Section"><select value={sec.m_pSection.m_sSectionName} onChange={(e) => setName(e.target.value)}>{sections.map((s) => <option key={s.m_pSection.m_sSectionName}>{s.m_pSection.m_sSectionName}</option>)}</select></Field>
      <form key={sec.m_pSection.m_sSectionName} onSubmit={submit}>
        <SectionFields d={sec.m_pSection} />
        <footer>
          <button type="button" onClick={() => { c.sh.m_pDoc.DelSectionFormat(c.sh.m_pCursor, sec); c.setDialog(null); }}>Remove</button>
          <button type="button" onClick={() => c.setDialog(null)}>Cancel</button><button type="submit" className="primary">OK</button>
        </footer>
      </form>
    </Modal>
  );
}

function FormatColumns({ c }: { c: Controller }) {
  const sec = c.sh.m_pCursor.GetPoint().GetNode().FindSectionNode();
  const [target, setTarget] = useState<'page' | 'section'>(sec ? 'section' : 'page');
  const col = target === 'section' && sec ? sec.m_pSection.m_aCol : c.sh.GetCurPageDesc().m_aCol;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cols = readColumnFields(new FormData(e.currentTarget));
    if (target === 'section' && sec) c.sh.m_pDoc.UpdateSection(c.sh.m_pCursor, sec, { ...sec.m_pSection, m_aCol: cols });
    else c.applyPage((p) => { p.m_aCol = cols; });
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Columns">
      {sec && <Field label="Apply to"><select value={target} onChange={(e) => setTarget(e.target.value as 'page' | 'section')}><option value="section">Section</option><option value="page">Page Style</option></select></Field>}
      <form key={target} onSubmit={submit}><ColumnFields col={col} balance={target === 'section'} /><Actions c={c} /></form>
    </Modal>
  );
}

/**
 * svx's CompressGraphicsDialog, reduced: JPEG quality or lossless PNG, and the new resolution for
 * the image's size on the page. The browser's encoder sets the PNG compression level itself, and
 * the interpolations map to the canvas' smoothing qualities.
 */
function CompressImage({ c }: { c: Controller }) {
  const fmt = c.sh.GetFlyFrameFormat()!;
  const g = c.selectedGraphic()!;
  const [px, setPx] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => { void ImportBitmap(g.data, g.mime).then((b) => { setPx({ w: b.width, h: b.height }); b.close(); }); }, [g]);
  // GetViewWidthInch / GetViewHeightInch: the frame's size.
  const viewW = Math.round((fmt.m_nWidth / 1440) * 100) / 100, viewH = Math.round((fmt.m_nHeight / 1440) * 100) / 100;
  const [jpeg, setJpeg] = useState(g.mime === 'image/jpeg');
  const [quality, setQuality] = useState(80);
  const [reduce, setReduce] = useState(true);
  const [dpi, setDpi] = useState(300);
  const [interp, setInterp] = useState('Lanczos');
  const [newSize, setNewSize] = useState<string>('??');
  const nPixelX = Math.trunc(viewW * dpi), nPixelY = Math.trunc(viewH * dpi);
  const compress = async (): Promise<{ data: Uint8Array; mime: string }> => {
    const b = await ImportBitmap(g.data, g.mime);
    const w = reduce ? Math.max(1, nPixelX) : b.width, h = reduce ? Math.max(1, nPixelY) : b.height;
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = interp !== 'None';
    ctx.imageSmoothingQuality = interp === 'Bilinear' ? 'low' : interp === 'Bicubic' ? 'medium' : 'high';
    // JPEG has no transparency: the image is put on white, as the JPEG export does.
    if (jpeg) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(b, 0, 0, w, h);
    b.close();
    const mime = jpeg ? 'image/jpeg' : 'image/png';
    const blob = await cv.convertToBlob({ type: mime, ...(jpeg ? { quality: quality / 100 } : {}) });
    return { data: new Uint8Array(await blob.arrayBuffer()), mime };
  };
  const calculate = async () => {
    const r = await compress();
    const reduction = Math.round((1 - r.data.length / g.data.length) * 100);
    setNewSize(`${Math.round(r.data.length / 1024)} KiB (${reduction}% reduction)`);
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const r = await compress();
    c.sh.ReRead(r.data, r.mime);
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Compress Image">
      <form onSubmit={(e) => void submit(e)}>
        <fieldset><legend>Compression</legend>
          <label className="check"><input type="radio" name="kind" checked={jpeg} onChange={() => setJpeg(true)} /> Lossy compression</label>
          <Field label="JPEG Quality"><input type="number" min="1" max="100" value={quality} disabled={!jpeg} onChange={(e) => setQuality(Number(e.target.value))} /></Field>
          <label className="check"><input type="radio" name="kind" checked={!jpeg} onChange={() => setJpeg(false)} /> Lossless compression</label>
        </fieldset>
        <fieldset><legend>Resolution</legend>
          <label className="check"><input type="checkbox" checked={reduce} onChange={(e) => setReduce(e.target.checked)} /> Change image resolution to:</label>
          <Field label="Width (px)"><input type="number" min="1" value={nPixelX} disabled={!reduce} onChange={(e) => setDpi(Number(e.target.value) / viewW)} /></Field>
          <Field label="Height (px)"><input type="number" min="1" value={nPixelY} disabled={!reduce} onChange={(e) => setDpi(Number(e.target.value) / viewH)} /></Field>
          <Field label="Resolution (DPI)">
            <input list="compress-dpi" type="number" min="1" value={Math.trunc(dpi)} disabled={!reduce} onChange={(e) => setDpi(Number(e.target.value) || 1)} />
            <datalist id="compress-dpi">{[96, 150, 200, 300, 600].map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          <Field label="Interpolation"><select value={interp} disabled={!reduce} onChange={(e) => setInterp(e.target.value)}>{['None', 'Bilinear', 'Bicubic', 'Lanczos'].map((i) => <option key={i}>{i}</option>)}</select></Field>
        </fieldset>
        <fieldset><legend>Image Information</legend>
          <p>Type: {g.mime.replace('image/', '').toUpperCase()}</p>
          <p>Actual dimensions: {px ? `${px.w} × ${px.h} px` : '…'}</p>
          <p>Apparent dimensions: {`${toCm(fmt.m_nWidth)} cm × ${toCm(fmt.m_nHeight)} cm`}{px ? ` at ${Math.trunc(px.w / viewW)} DPI` : ''}</p>
          <p>Image size: {Math.round(g.data.length / 1024)} KiB</p>
          <p><button type="button" onClick={() => void calculate()}>Calculate New Size:</button> {newSize}</p>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * The cui graphic filter dialogs (GraphicFilterSmooth, Mosaic, Emboss, Poster, Sepia, Solarize),
 * reduced: their controls from GetGrfFilterParams, without the preview.
 */
function ImageFilter({ c }: { c: Controller }) {
  const command = c.filterCommand;
  const entry = GrfFilterTable[command]!;
  const [params, setParams] = useState<GrfFilterParam[] | null>(null);
  useEffect(() => { void c.selectedBitmap().then((b) => setParams(GetGrfFilterParams(command, b ?? undefined))); }, [command]);
  const label = (l: string) => l.replace(/_/g, '').replace(/:$/, '');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values: Record<string, number | boolean | string> = {};
    for (const p of params ?? []) values[p.name] = p.type === 'boolean' ? !!f.get(p.name) : p.type === 'number' ? Number(f.get(p.name)) : String(f.get(p.name));
    c.setDialog(null);
    void c.applyImageFilter(command, values);
  };
  return (
    <Modal c={c} title={entry.dialog?.title ?? ''}>
      <form onSubmit={submit}>
        {params?.map((p) => p.type === 'boolean'
          ? <label key={p.name} className="check"><input type="checkbox" name={p.name} defaultChecked={!!p.default} /> {label(p.label)}</label>
          : p.type === 'choice'
            ? <Field key={p.name} label={label(p.label)}><select name={p.name} defaultValue={String(p.default)}>{p.choices!.map((o) => <option key={o.value} value={o.value}>{label(o.label)}</option>)}</select></Field>
            : <Field key={p.name} label={`${label(p.label)}${p.unit === 'percent' ? ' (%)' : p.unit === 'pixel' ? ' (px)' : ''}`}><input type="number" name={p.name} min={p.min} max={p.max} step={p.digits ? 10 ** -p.digits : 1} defaultValue={Number(p.default)} /></Field>)}
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** cui's SvxObjectNameDialog (FN_NAME_SHAPE): the selected object's name, unique among objects. */
function ObjectName({ c }: { c: Controller }) {
  const fmt = c.sh.GetFlyFrameFormat()!;
  const [name, setName] = useState(fmt.m_aName);
  const taken = name.trim() !== fmt.m_aName && !!c.sh.m_pDoc.FindFlyByName(name.trim());
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || taken) return;
    if (n !== fmt.m_aName) { c.sh.SetFlyFrameAttr({ m_aName: n }); c.sh.SelectFly(n); }
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Name">
      <form onSubmit={submit}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-invalid={taken} /></Field>
        {taken && <p role="alert">The name “{name.trim()}” is already in use.</p>}
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** cui's SvxObjectTitleDescDialog (FN_TITLE_DESCRIPTION_SHAPE): the object's title and description. */
function ObjectTitleDesc({ c }: { c: Controller }) {
  const fmt = c.sh.GetFlyFrameFormat()!;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.sh.SetFlyFrameAttr({ m_sTitle: String(f.get('title') ?? '') || undefined, alt: String(f.get('desc') ?? '') || undefined });
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Alt Text">
      <form onSubmit={submit}>
        <p>Give a short description of non-text content for users who do not see this object.</p>
        <Field label="Text"><input name="title" defaultValue={fmt.m_sTitle ?? ''} autoFocus /></Field>
        <Field label="Alt Text"><textarea name="desc" rows={5} defaultValue={fmt.alt ?? ''} /></Field>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** The numbering types of the Customize page (RID_SVXSTRARY_NUMBERINGTYPE, those the provider has). */
const NUM_TYPES: [number, string][] = [
  [NumberingType.NUMBER_NONE, 'num.type.none'], [NumberingType.CHAR_SPECIAL, 'num.type.bullet'], [NumberingType.ARABIC, '1, 2, 3, ...'],
  [NumberingType.CHARS_UPPER_LETTER, 'A, B, C, ...'], [NumberingType.CHARS_LOWER_LETTER, 'a, b, c, ...'], [NumberingType.ROMAN_UPPER, 'I, II, III, ...'],
  [NumberingType.ROMAN_LOWER, 'i, ii, iii, ...'], [NumberingType.CHARS_UPPER_LETTER_N, 'A, .., AA, .., AAA, ...'], [NumberingType.CHARS_LOWER_LETTER_N, 'a, .., aa, .., aaa, ...'],
];

/** A list label as the layout makes it: the bullet, or the number string of the counters. */
const labelOf = (r: SwNumRule, counters: number[]): string => {
  const f = r.Get(counters.length - 1);
  return f.IsItemize() ? f.GetBulletChar() : r.MakeNumString(counters);
};
const sameFormat = (a: SwNumRule, b: SwNumRule, lvl: number): boolean => {
  const x = a.Get(lvl), y = b.Get(lvl);
  return x.GetNumberingType() === y.GetNumberingType() && x.GetListFormat() === y.GetListFormat() && (!x.IsItemize() || (x.GetBulletChar() === y.GetBulletChar() && x.GetBulletFont() === y.GetBulletFont()));
};

/**
 * Format > Bullets and Numbering (SwTextShell::ExecEnterNum's FN_NUMBER_BULLETS and
 * SwSvxNumBulletTabDialog): the pick pages, Position and Customize, on a copy of the selection's
 * list rule or a new one. The Image page and the preview are not ported.
 */
function NumBullet({ c }: { c: Controller }) {
  const init = useMemo(() => {
    const pNumRuleAtCurrentSelection = c.sh.GetNumRuleAtCurrentSelection();
    if (pNumRuleAtCurrentSelection) {
      const nLevel = c.sh.GetNumLevel();
      return { existing: pNumRuleAtCurrentSelection, rule: pNumRuleAtCurrentSelection.Clone(), mask: nLevel < MAXLEVEL ? 1 << nLevel : ALL_LEVELS };
    }
    const aRule = new SwNumRule(c.sh.m_pDoc.GetUniqueNumRuleName());
    // #i38904# Default alignment for numbering/bullet should be rtl in rtl paragraph
    if (c.sh.m_pCursor.GetPoint().GetNode().GetAttr('RES_FRAMEDIR') === 'rl-tb') for (let n = 0; n < MAXLEVEL; n++) { const f = aRule.Get(n).Clone(); f.SetNumAdjust('right'); aRule.Set(n, f); }
    // ActivatePage: no level is set yet, so the first example is chosen (bPreset).
    return { existing: undefined, rule: BulletPick(aRule, ALL_LEVELS, 0), mask: ALL_LEVELS };
  }, [c]);
  const [rule, setRule] = useState(init.rule);
  const [mask, setMask] = useState(init.mask);
  const [modified, setModified] = useState(false);
  const [page, setPage] = useState('bullets');
  const change = (r: SwNumRule) => { setRule(r); setModified(true); };
  const lvl = FirstLevel(mask);
  const fmt = rule.Get(lvl);
  const same = <T,>(get: (f: SwNumFormat) => T) => SameForLevels(rule, mask, get);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (modified || !init.existing) {
      const aSetRule = rule.Clone(init.existing ? init.existing.GetName() : c.sh.m_pDoc.GetUniqueNumRuleName());
      aSetRule.SetAutoRule(true);
      // No start of new list, if an existing list style is edited. Otherwise start a new list.
      c.sh.SetCurNumRule(aSetRule, !init.existing);
    }
    c.setDialog(null);
    c.notify();
  };
  const remove = () => { c.sh.DelNumRules(); c.setDialog(null); c.notify(); };

  const examples = (n: number, pick: (r: SwNumRule, i: number) => SwNumRule, sample: (r: SwNumRule) => string[], label: string, indent = false) => (
    <div className="num-examples" role="group" aria-label={label}>
      {Array.from({ length: n }, (_, i) => {
        const r = pick(rule, i);
        const selected = Array.from({ length: MAXLEVEL }, (_, l) => l).filter((l) => mask & (1 << l)).every((l) => sameFormat(r, rule, l));
        return (
          <button key={i} type="button" aria-pressed={selected} onClick={() => change(r)} onDoubleClick={(e) => { change(r); e.currentTarget.form?.requestSubmit(); }}>
            {sample(r).map((l, k) => <span key={k} style={indent ? { paddingLeft: `${k * 0.8}em` } : undefined}>{l || ' '}<i /></span>)}
          </button>
        );
      })}
    </div>
  );
  const pages = ['bullets', 'singlenum', 'outlinenum', 'position', 'customize'];
  const labels = { bullets: t('num.unordered'), singlenum: t('num.ordered'), outlinenum: t('num.outline'), position: t('num.position'), customize: t('num.customize') };
  const levelSelect = (
    <Field label={t('num.level')}>
      <select value={mask} onChange={(e) => setMask(Number(e.target.value))}>
        {Array.from({ length: MAXLEVEL }, (_, l) => <option key={l} value={1 << l}>{l + 1}</option>)}
        <option value={ALL_LEVELS}>1 - {MAXLEVEL}</option>
      </select>
    </Field>
  );
  const cm = (v: number) => String(toCm(v));
  return (
    <Modal c={c} title={t('num.title')} wide>
      <form method="dialog" onSubmit={submit} className="numbullet">
        <Tabs ids={pages} labels={labels} current={page} onChange={setPage} label={t('num.title')} />
        <Panel id="bullets" current={page}>
          {examples(m_aBulletSymbols.length, (r, i) => BulletPick(r, mask, i), (r) => [labelOf(r, [1]), labelOf(r, [2]), labelOf(r, [3])], t('num.unordered'))}
        </Panel>
        <Panel id="singlenum" current={page}>
          {examples(SingleNumSettings().length, (r, i) => SingleNumPick(r, mask, i), (r) => [1, 2, 3].map((n) => labelOf(r, [...Array(lvl).fill(1), n])), t('num.ordered'))}
        </Panel>
        <Panel id="outlinenum" current={page}>
          {examples(OutlineSettings().length, (r, i) => OutlinePick(r, i), (r) => [labelOf(r, [1]), labelOf(r, [1, 1]), labelOf(r, [1, 1, 1])], t('num.outline'), true)}
        </Panel>
        <Panel id="position" current={page}>
          {levelSelect}
          <Field label={t('num.followedBy')}>
            <select value={same((f) => f.GetLabelFollowedBy()) ? fmt.GetLabelFollowedBy() : ''} onChange={(e) => change(SetLabelFollowedBy(rule, mask, e.target.value as SvxNumLabelFollowedBy))}>
              {!same((f) => f.GetLabelFollowedBy()) && <option value="" />}
              <option value="listtab">{t('num.tab')}</option><option value="space">{t('num.space')}</option><option value="nothing">{t('num.nothing')}</option><option value="newline">{t('num.newline')}</option>
            </select>
          </Field>
          <Field label={t('num.tabAt')}><input key={`tab${mask}${fmt.GetListtabPos()}`} type="number" step="0.01" disabled={!same((f) => f.GetLabelFollowedBy()) || fmt.GetLabelFollowedBy() !== 'listtab'} defaultValue={same((f) => f.GetListtabPos()) ? cm(fmt.GetListtabPos()) : ''} onChange={(e) => e.target.value !== '' && change(SetListtabPos(rule, mask, fromCm(e.target.value)))} /></Field>
          <Field label={t('num.alignment')}>
            <select value={same((f) => f.GetNumAdjust()) ? fmt.GetNumAdjust() : ''} onChange={(e) => change(SetNumAdjust(rule, mask, e.target.value as SvxAdjust))}>
              {!same((f) => f.GetNumAdjust()) && <option value="" />}
              <option value="left">{t('num.left')}</option><option value="center">{t('num.centered')}</option><option value="right">{t('num.right')}</option>
            </select>
          </Field>
          <Field label={t('num.alignedAt')}><input key={`al${mask}${fmt.GetIndentAt() + fmt.GetFirstLineIndent()}`} type="number" step="0.01" defaultValue={same((f) => f.GetIndentAt() + f.GetFirstLineIndent()) ? cm(fmt.GetIndentAt() + fmt.GetFirstLineIndent()) : ''} onChange={(e) => e.target.value !== '' && change(SetAlignAt(rule, mask, fromCm(e.target.value)))} /></Field>
          <Field label={t('num.indentAt')}><input key={`in${mask}${fmt.GetIndentAt()}`} type="number" step="0.01" defaultValue={same((f) => f.GetIndentAt()) ? cm(fmt.GetIndentAt()) : ''} onChange={(e) => e.target.value !== '' && change(SetIndentAt(rule, mask, fromCm(e.target.value)))} /></Field>
          <p><button type="button" onClick={() => change(StandardPositions(rule, mask))}>{t('num.default')}</button></p>
        </Panel>
        <Panel id="customize" current={page}>
          {levelSelect}
          <Field label={t('num.number')}>
            <select value={same((f) => f.GetNumberingType()) ? fmt.GetNumberingType() : ''} onChange={(e) => change(SetNumberType(rule, mask, Number(e.target.value) as NumberingType, fmt.GetPrefix(), fmt.GetSuffix()))}>
              {!same((f) => f.GetNumberingType()) && <option value="" />}
              {NUM_TYPES.map(([v, l]) => <option key={v} value={v}>{l.startsWith('num.') ? t(l as 'num.type.none') : l}</option>)}
            </select>
          </Field>
          {fmt.IsItemize() ? (
            <Field label={t('num.character')}><input key={`ch${mask}${fmt.GetBulletChar()}`} maxLength={2} defaultValue={same((f) => f.GetBulletChar()) ? fmt.GetBulletChar() : ''} onChange={(e) => { const ch = [...e.target.value][0]; if (ch) change(SetBullet(rule, mask, ch, null)); }} /></Field>
          ) : (<>
            <Field label={t('num.start')}><input key={`st${mask}`} type="number" min={fmt.GetNumberingType() < NumberingType.ARABIC ? 1 : 0} defaultValue={same((f) => f.GetStart()) ? fmt.GetStart() : ''} onChange={(e) => e.target.value !== '' && change(SetStart(rule, mask, Number(e.target.value)))} /></Field>
            <Field label={t('num.before')}><input key={`pre${mask}`} defaultValue={same((f) => f.GetPrefix()) ? fmt.GetPrefix() : ''} onChange={(e) => change(SetPrefixSuffix(rule, mask, e.target.value, rule.Get(lvl).GetSuffix()))} /></Field>
            <Field label={t('num.after')}><input key={`suf${mask}`} defaultValue={same((f) => f.GetSuffix()) ? fmt.GetSuffix() : ''} onChange={(e) => change(SetPrefixSuffix(rule, mask, rule.Get(lvl).GetPrefix(), e.target.value))} /></Field>
            <Field label={t('num.sublevels')}><input key={`sub${mask}`} type="number" min="1" max={lvl + 1} disabled={lvl === 0} defaultValue={fmt.GetIncludeUpperLevels()} onChange={(e) => e.target.value !== '' && change(SetIncludeUpperLevels(rule, mask, Number(e.target.value)))} /></Field>
          </>)}
        </Panel>
        <footer>
          <button type="button" onClick={remove} disabled={!init.existing}>{t('num.remove')}</button>
          <button type="button" onClick={() => { setRule(init.rule); setModified(false); }}>{t('num.reset')}</button>
          <button type="button" onClick={() => c.setDialog(null)}>{t('common.cancel')}</button>
          <button type="submit" className="primary">{t('common.ok')}</button>
        </footer>
      </form>
    </Modal>
  );
}

/** Format > Title Page (SwTitlePageDlg), without its page style list and Edit button. */
function TitlePage({ c }: { c: Controller }) {
  const dlg = useMemo(() => SwTitlePageDlgInit(c.sh), [c]);
  const [s, setS] = useState(dlg.settings);
  const [docStart, setDocStart] = useState(true);
  const set = (p: Partial<SwTitlePageSettings>) => setS({ ...s, ...p });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    SwTitlePageDlgOK(c.sh, dlg, s, docStart);
    c.setDialog(null);
    c.notify();
  };
  const num = (v: number, on: (n: number) => void, p: { min?: number; max?: number; disabled?: boolean; label: string }) =>
    <input type="number" aria-label={p.label} min={p.min ?? 1} max={p.max} value={v} disabled={p.disabled} onChange={(e) => on(Math.max(p.min ?? 1, Number(e.target.value) || 0))} />;
  return (
    <Modal c={c} title={t('title.title')}>
      <form method="dialog" onSubmit={submit}>
        <fieldset><legend>{t('title.make')}</legend>
          <label className="check"><input type="radio" name="use" checked={s.bUseExisting} onChange={() => set({ bUseExisting: true })} /> {t('title.existing')}</label>
          <label className="check"><input type="radio" name="use" checked={!s.bUseExisting} onChange={() => set({ bUseExisting: false })} /> {t('title.insert')}</label>
          <Field label={t('title.count')}>{num(s.nPageCount, (n) => set({ nPageCount: n }), { label: t('title.count') })}</Field>
          <p>{t('title.placeAt')}</p>
          <label className="check"><input type="radio" name="at" checked={docStart} onChange={() => setDocStart(true)} /> {t('title.docStart')}</label>
          <label className="check"><input type="radio" name="at" checked={!docStart} onChange={() => setDocStart(false)} /> {t('title.page')} {num(s.nPageStart, (n) => set({ nPageStart: n }), { max: dlg.nPageCnt + 1, disabled: docStart, label: t('title.page') })}</label>
        </fieldset>
        <fieldset><legend>{t('title.numbering')}</legend>
          <label className="check"><input type="checkbox" checked={s.bRestartNumbering} onChange={(e) => set({ bRestartNumbering: e.target.checked })} /> {t('title.restart')}</label>
          <Field label={t('title.pageNumber')}>{num(s.nRestartNumber, (n) => set({ nRestartNumber: n }), { min: 0, disabled: !s.bRestartNumbering, label: t('title.restart') })}</Field>
          <label className="check"><input type="checkbox" checked={s.bSetPageNumber} onChange={(e) => set({ bSetPageNumber: e.target.checked })} /> {t('title.setNumber')}</label>
          <Field label={t('title.pageNumber')}>{num(s.nSetPageNumber, (n) => set({ nSetPageNumber: n }), { min: 0, disabled: !s.bSetPageNumber, label: t('title.setNumber') })}</Field>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * Insert > Page Number (sw pagenumberdlg.ui, SwPageNumberDlg): position, alignment, mirroring,
 * page total, fitting into the margin and the page style's number format, with a preview
 * (SwPageNumberDlg::updateImage: a page with the number where it will be).
 */
function PageNumberDialog({ c }: { c: Controller }) {
  const [d, setD] = useState<SwPageNumberDlg>(() => SwPageNumberDlgInit(c.sh));
  const set = (p: Partial<SwPageNumberDlg>) => setD({ ...d, ...p });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    ExecutePageNumberWizard(c.sh, d);
    c.setDialog(null);
    c.notify();
  };
  const sample = makeNumberingString(d.m_nPageNumberType as NumberingType, 1) + (d.m_bIncludePageTotal || d.m_bIncludePageRangeTotal ? ` / ${makeNumberingString(d.m_nPageNumberType as NumberingType, 9)}` : '');
  const y = d.m_aPageNumberPosition ? 96 : 14;
  const x = [10, 37.5, 65][d.m_aPageNumberAlignment]!;
  const anchor = (['start', 'middle', 'end'] as const)[d.m_aPageNumberAlignment];
  return (
    <Modal c={c} title={t('pagenum.title')}>
      <form method="dialog" onSubmit={submit} className="pagenumber">
        <Field label={t('pagenum.position')}>
          <select value={d.m_aPageNumberPosition} onChange={(e) => set({ m_aPageNumberPosition: Number(e.target.value) })}>
            <option value={0}>{t('pagenum.top')}</option><option value={1}>{t('pagenum.bottom')}</option>
          </select>
        </Field>
        <Field label={t('pagenum.alignment')}>
          <select value={d.m_aPageNumberAlignment} onChange={(e) => set({ m_aPageNumberAlignment: Number(e.target.value) })}>
            <option value={0}>{t('pagenum.left')}</option><option value={1}>{t('pagenum.center')}</option><option value={2}>{t('pagenum.right')}</option>
          </select>
        </Field>
        <label className="check"><input type="checkbox" disabled={d.m_aPageNumberAlignment === 1} checked={d.m_bMirrorOnEvenPages} onChange={(e) => set({ m_bMirrorOnEvenPages: e.target.checked })} /> {t('pagenum.mirror')}</label>
        <label className="check"><input type="checkbox" disabled={d.m_bIncludePageRangeTotal} checked={d.m_bIncludePageTotal} onChange={(e) => set({ m_bIncludePageTotal: e.target.checked })} /> {t('pagenum.total')}</label>
        <label className="check"><input type="checkbox" disabled={d.m_bIncludePageTotal} checked={d.m_bIncludePageRangeTotal} onChange={(e) => set({ m_bIncludePageRangeTotal: e.target.checked })} /> {t('pagenum.rangeTotal')}</label>
        <label className="check"><input type="checkbox" checked={d.m_bFitIntoExistingMargins} onChange={(e) => set({ m_bFitIntoExistingMargins: e.target.checked })} /> {t('pagenum.fit')}</label>
        <Field label={t('pagenum.format')}>
          <select value={d.m_nPageNumberType} onChange={(e) => set({ m_nPageNumberType: Number(e.target.value) })}>
            {NUM_TYPES.filter(([v]) => v !== NumberingType.CHAR_SPECIAL).map(([v, l]) => <option key={v} value={v}>{l.startsWith('num.') ? t(l) : l}</option>)}
          </select>
        </Field>
        <fieldset><legend>{t('pagenum.preview')}</legend>
          <svg className="pagenumber-preview" viewBox="0 0 75 105" width="75" height="105" role="img" aria-label={t('pagenum.preview')}>
            <rect x="0.5" y="0.5" width="74" height="104" fill="#fff" stroke="#888" />
            {[24, 32, 40, 48, 56, 64, 72, 80].map((ly) => <line key={ly} x1="10" x2="65" y1={ly} y2={ly} stroke="#ccc" />)}
            <text x={x} y={y} fontSize="7" textAnchor={anchor} fill="#000">{sample}</text>
          </svg>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * Insert > Signature Line (cui signatureline.ui, SignatureLineDialog): the suggested signer's name,
 * title and e-mail, instructions for the signer, and whether the signer may add a comment and the
 * date is shown. Edits the selected signature line with `edit`.
 */
function SignatureLine({ c, edit }: { c: Controller; edit: boolean }) {
  const [d, setD] = useState<SignatureLineDialog>(() => SignatureLineDialogInit(c.sh, edit));
  const set = (p: Partial<SignatureLineDialog>) => setD({ ...d, ...p });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    SignatureLineDialogApply(c.sh, d);
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('sigline.title')}>
      <form method="dialog" onSubmit={submit}>
        <fieldset><legend>{t('sigline.signer')}</legend>
          <Field label={t('sigline.name')}><input value={d.m_xEditName} autoFocus placeholder={t('sigline.namePlaceholder')} onChange={(e) => set({ m_xEditName: e.target.value })} /></Field>
          <Field label={t('sigline.signerTitle')}><input value={d.m_xEditTitle} placeholder={t('sigline.titlePlaceholder')} onChange={(e) => set({ m_xEditTitle: e.target.value })} /></Field>
          <Field label={t('sigline.email')}><input type="email" value={d.m_xEditEmail} placeholder={t('sigline.emailPlaceholder')} onChange={(e) => set({ m_xEditEmail: e.target.value })} /></Field>
        </fieldset>
        <fieldset><legend>{t('sigline.more')}</legend>
          <label className="check"><input type="checkbox" checked={d.m_xCheckboxCanAddComments} onChange={(e) => set({ m_xCheckboxCanAddComments: e.target.checked })} /> {t('sigline.comments')}</label>
          <label className="check"><input type="checkbox" checked={d.m_xCheckboxShowSignDate} onChange={(e) => set({ m_xCheckboxShowSignDate: e.target.checked })} /> {t('sigline.date')}</label>
          <Field label={t('sigline.instructions')}><textarea rows={4} value={d.m_xEditInstructions} onChange={(e) => set({ m_xEditInstructions: e.target.value })} /></Field>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * Insert > Bookmark (insertbookmark.ui): the view of SwInsertBookmarkDlg. A click selects a row,
 * Ctrl (Cmd) or Shift adds to the selection, a double click or Enter goes to the bookmark; a column
 * header sorts by it (HeaderBarClick). Edit Text edits the row's text in place.
 */
type BookmarkSortColumn = 'page' | 'name' | 'text' | 'hidden';
function BookmarkDialog({ c }: { c: Controller }) {
  const dlg = useMemo(() => new SwInsertBookmarkDlg(c.sh), [c.sh]);
  const [, setTick] = useState(0);
  const [sort, setSort] = useState<{ col: BookmarkSortColumn; bAtoZ: boolean } | null>(null);
  const [editing, setEditing] = useState<{ pMark: MarkBase; sText: string } | null>(null);
  const [rename, setRename] = useState<MarkBase | null>(null);
  const anchor = useRef<MarkBase | null>(null);
  const update = () => { setTick((x) => x + 1); c.notify(); if (dlg.m_bClosed) c.setDialog(null); };
  const box = dlg.m_xBookmarksBox;
  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true }), []);
  const rows = useMemo(() => {
    const list = [...box.m_aRows];
    if (!sort) return list;
    const key = (r: BookmarkRow) => (sort.col === 'page' ? r.sPageNum : sort.col === 'name' ? r.sName : sort.col === 'text' ? r.sText : r.bHidden ? '1' : '0');
    list.sort((a, b) => collator.compare(key(a), key(b)));
    return sort.bAtoZ ? list : list.reverse();
  }, [box.m_aRows, box.m_aRows.length, sort, collator, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const select = (r: BookmarkRow, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    let sel: MarkBase[];
    if (e.shiftKey && anchor.current) {
      const a = rows.findIndex((x) => x.pMark === anchor.current), b = rows.indexOf(r);
      sel = a < 0 ? [r.pMark] : rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.pMark);
    } else if (e.ctrlKey || e.metaKey) {
      sel = box.m_aSelected.has(r.pMark) ? [...box.m_aSelected].filter((p) => p !== r.pMark) : [...box.m_aSelected, r.pMark];
      anchor.current = r.pMark;
    } else { sel = [r.pMark]; anchor.current = r.pMark; }
    dlg.SelectionChangedHdl(sel);
    update();
  };
  const keyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (editing) return;
    const cur = rows.findIndex((x) => box.m_aSelected.has(x.pMark));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { select(next, { ctrlKey: false, metaKey: false, shiftKey: e.shiftKey }); document.getElementById(`bm-row-${rows.indexOf(next)}`)?.focus(); }
    } else if (e.key === 'Enter') { e.preventDefault(); dlg.DoubleClickHdl(); update(); }
  };
  const head = (col: BookmarkSortColumn, label: string) => (
    <th scope="col" aria-sort={sort?.col === col ? (sort.bAtoZ ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="sort" onClick={() => setSort((s) => (s?.col === col ? { col, bAtoZ: !s.bAtoZ } : { col, bAtoZ: true }))}>
        {label}<span className="sort-mark" aria-hidden="true">{sort?.col === col ? (sort.bAtoZ ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
  const endEditing = (bCommit: boolean) => {
    if (!editing) return;
    const row = box.m_aRows.find((r) => r.pMark === editing.pMark);
    setEditing(null);
    if (bCommit && row) dlg.EditedHdl(row, editing.sText);
    update();
  };
  return (
    <Modal c={c} title={t('bookmark.title')} wide>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (dlg.m_bInsert) { dlg.InsertHdl(); update(); } }}>
        <div className="bookmark-name">
          <label className="field"><span>{t('bookmark.name')}</span>
            <input value={dlg.m_sEditBox} autoFocus aria-invalid={dlg.m_bEditBoxError} aria-describedby={dlg.m_bForbiddenCharsVisible ? 'bm-forbidden' : undefined}
              onChange={(e) => { dlg.ModifyHdl(e.target.value); update(); }} />
          </label>
          <button type="submit" className="primary" disabled={!dlg.m_bInsert}>{t('bookmark.insert')}</button>
        </div>
        {dlg.m_bForbiddenCharsVisible && <p id="bm-forbidden" role="alert" className="muted">{t('bookmark.forbidden')} {BookmarkTable.aForbiddenChars}</p>}
        <h3 id="bm-list">{t('bookmark.list')}</h3>
        <div className="doclist bookmarks">
          <table aria-labelledby="bm-list" aria-multiselectable="true" role="grid">
            <thead><tr>{head('page', t('bookmark.page'))}{head('name', t('bookmark.colName'))}{head('text', t('bookmark.text'))}{head('hidden', t('bookmark.hidden'))}</tr></thead>
            <tbody onKeyDown={keyDown}>
              {rows.map((r, k) => (
                <tr key={k} id={`bm-row-${k}`} tabIndex={box.m_aSelected.has(r.pMark) || (!box.m_aSelected.size && k === 0) ? 0 : -1} aria-selected={box.m_aSelected.has(r.pMark)}
                  className={box.m_aSelected.has(r.pMark) ? 'selected' : undefined}
                  onClick={(e) => select(r, e)} onDoubleClick={() => { dlg.DoubleClickHdl(); update(); }}>
                  <td className="num">{r.sPageNum}</td>
                  <td>{r.sName}</td>
                  <td>{editing?.pMark === r.pMark
                    ? <input autoFocus aria-label={t('bookmark.text')} value={editing.sText} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditing({ pMark: r.pMark, sText: e.target.value })} onBlur={() => endEditing(true)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); endEditing(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endEditing(false); } }} />
                    : r.sText}</td>
                  <td>{r.bHidden ? t('bookmark.yes') : t('bookmark.no')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bookmark-buttons">
          <button type="button" disabled={!dlg.m_bGoto} onClick={() => { dlg.GotoHdl(); update(); }}>{t('bookmark.goto')}</button>
          <button type="button" disabled={!dlg.m_bDelete} onClick={() => { dlg.DeleteHdl(); update(); }}>{t('bookmark.delete')}</button>
          <button type="button" disabled={!dlg.m_bEditText} onClick={() => { const p = dlg.EditTextHdl(); const row = p && box.m_aRows.find((x) => x.pMark === p); setEditing(row ? { pMark: row.pMark, sText: row.sText } : null); update(); }}>{t('bookmark.editText')}</button>
          <button type="button" disabled={!dlg.m_bRename} onClick={() => { setRename(dlg.RenameHdl()); update(); }}>{t('bookmark.rename')}</button>
        </div>
        <footer><button type="button" onClick={() => c.setDialog(null)}>{t('common.close')}</button></footer>
      </form>
      {rename && <RenameXNamedDialog c={c} pMark={rename} onClose={(bOk) => { setRename(null); dlg.RenameDone(bOk); update(); }} />}
    </Modal>
  );
}

/** SwRenameXNamedDlg (renameobjectdialog.ui) for a bookmark, over the Bookmark dialog. */
function RenameXNamedDialog({ c, pMark, onClose }: { c: Controller; pMark: MarkBase; onClose: (bOk: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [sName, setName] = useState(pMark.GetName());
  // The OK button is disabled until the name is changed (ModifyHdl runs on changes only).
  const [bOk, setOk] = useState(false);
  const done = useRef(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const close = (b: boolean) => { if (done.current) return; done.current = true; ref.current?.close(); onClose(b); };
  const title = t('bookmark.renameTitle', { name: pMark.GetName() });
  return (
    <dialog ref={ref} aria-label={title} onClose={() => close(false)} onCancel={(e) => { e.stopPropagation(); }}>
      <h2>{title}</h2>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); if (bOk) close(SwRenameXNamedDlg_OkHdl(c.sh, pMark, sName)); }}>
        <fieldset><legend>{t('bookmark.changeName')}</legend>
          <Field label={t('bookmark.newName')}>
            <input value={sName} autoFocus onFocus={(e) => e.target.select()}
              onChange={(e) => { const s = SwRenameXNamedDlg_TextFilter(e.target.value); setName(s); setOk(SwRenameXNamedDlg_ModifyHdl(c.sh, s)); }} />
          </Field>
        </fieldset>
        <footer><button type="button" onClick={() => close(false)}>{t('common.cancel')}</button><button type="submit" className="primary" disabled={!bOk}>{t('common.ok')}</button></footer>
      </form>
    </dialog>
  );
}

/**
 * Insert > Cross-reference (sw fldrefpage.ui, SwFieldRefPage): the type (setting a reference mark,
 * reference marks, headings, numbered paragraphs, bookmarks, notes and number range categories),
 * the item and how to refer to it (FillFormatLB). Insert keeps the dialog open, as the Fields
 * dialog does. Style references (STYLEREF) and the filter field are not ported.
 */
type RefType = 'setref' | 'getref' | 'heading' | 'numitem' | 'bookmark' | 'footnote' | 'endnote' | `seq:${string}`;
const REF_FORMATS = ['page', 'chapter', 'content', 'updown', 'pagedesc', 'catnum', 'caption', 'numbering', 'number', 'numberNoContext', 'numberFullContext'] as const;
function CrossReferencePage({ c }: { c: Controller }) {
  const sh = c.sh, doc = sh.m_pDoc;
  const [type, setType] = useState<RefType>('heading');
  const [item, setItem] = useState(-1);
  const [format, setFormat] = useState<number>(RefFieldFormat.Content);
  const [name, setName] = useState('');
  const [, setTick] = useState(0);
  const access = doc.getIDocumentMarkAccess();
  const nums = sh.m_pRoot.m_aNums;
  const label = (n: SwTextNode) => { const num = nums.get(n); const text = n.GetText().split('\u0001').join(''); return num?.counted && num.label ? `${num.label} ${text}` : text; };
  const categories = [...new Set([...CAPTION_CATEGORIES, ...GetSeqCategories(doc)])];
  const types: [RefType, string][] = [
    ['setref', t('xref.setRef')], ['getref', t('xref.getRef')], ['heading', t('xref.headings')], ['numitem', t('xref.numItems')], ['bookmark', t('xref.bookmarks')],
    ...(GetFootnotes(doc, false).length ? [['footnote', t('xref.footnotes')] as [RefType, string]] : []),
    ...(GetFootnotes(doc, true).length ? [['endnote', t('xref.endnotes')] as [RefType, string]] : []),
    ...categories.map((k): [RefType, string] => [`seq:${k}`, k]),
  ];
  // SwFieldRefPage::UpdateSubType: the items of the type.
  const items: { text: string; insert: () => void }[] = (() => {
    const ref = (subType: number, extra: { name?: string; seqNo?: number } = {}, target?: { node: SwTextNode; bHeading: boolean }) => () => sh.InsertRefField({ subType, format, ...extra }, target);
    switch (type) {
      case 'setref': case 'getref': return access.getRefMarks().map((m) => ({ text: m.GetName(), insert: ref(ReferencesSubtype.SetRefAttr, { name: m.GetName() }) }));
      case 'heading': return GetOutlineNodes(doc).map((n) => ({ text: label(n), insert: ref(ReferencesSubtype.Bookmark, {}, { node: n, bHeading: true }) }));
      case 'numitem': return GetNumItems(doc, nums).map((n) => ({ text: label(n), insert: ref(ReferencesSubtype.Bookmark, {}, { node: n, bHeading: false }) }));
      case 'bookmark': return access.getBookmarks().map((m) => ({ text: m.GetName(), insert: ref(ReferencesSubtype.Bookmark, { name: m.GetName() }) }));
      case 'footnote': case 'endnote': return GetFootnotes(doc, type === 'endnote').map((id, k) => {
        const sec = doc.GetNodes().FindFootnoteSection(id);
        const first = sec ? doc.GetNodes().GoNext(sec.GetIndex()) : null;
        return { text: `${type === 'endnote' ? makeNumberingString(NumberingType.ROMAN_LOWER, k + 1) : k + 1}  ${first?.GetText() ?? ''}`, insert: ref(type === 'endnote' ? ReferencesSubtype.Endnote : ReferencesSubtype.Footnote, { name: id }) };
      });
      default: {
        const cat = type.slice(4);
        return GetSeqFields(doc, cat).map(({ f, node }) => {
          const n = makeNumberingString((f.numType ?? NumberingType.ARABIC) as NumberingType, sh.m_pRoot.m_aSeqNums.get(f) ?? 1);
          return { text: node.GetText().replace('\u0001', n).split('\u0001').join(''), insert: () => { if (f.seqNo === undefined) f.seqNo = doc.NextSeqNo(cat); sh.InsertRefField({ subType: ReferencesSubtype.SequenceField, format, name: cat, seqNo: f.seqNo }); } };
        });
      }
    }
  })();
  // SwFieldRefPage::FillFormatLB: the formats of the type.
  const formats: number[] = type === 'setref' ? []
    : type === 'heading' || type === 'numitem' ? [0, 1, 2, 3, 4, 8, 9, 10]
    : type.startsWith('seq:') ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4];
  const chooseType = (k: RefType) => { setType(k); setItem(-1); setName(''); if (!(k.startsWith('seq:') ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4]).includes(format)) setFormat(RefFieldFormat.Content); };
  const canInsert = type === 'setref' ? !!name && !access.getRefMarks().some((m) => m.GetName() === name) : item >= 0 && item < items.length;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canInsert) return;
    if (type === 'setref') sh.SetRefMark(name);
    else items[item]!.insert();
    setName('');
    setTick((x) => x + 1);
    c.notify();
  };
  return (
    <form method="dialog" onSubmit={submit}>
      <div className="crossref">
        <Field label={t('xref.type')}>
          <select size={10} value={type} onChange={(e) => chooseType(e.target.value as RefType)}>
            {types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={t('xref.selection')}>
          <select size={10} value={item} onChange={(e) => { const k = Number(e.target.value); setItem(k); if (type !== 'setref') setName(items[k]?.text ?? ''); }} onDoubleClick={() => { if (canInsert) { items[item]!.insert(); c.notify(); } }}>
            {items.map((x, k) => <option key={k} value={k}>{x.text}</option>)}
          </select>
        </Field>
        <Field label={t('xref.format')}>
          <select size={10} value={format} disabled={!formats.length} onChange={(e) => setFormat(Number(e.target.value))}>
            {formats.map((k) => <option key={k} value={k}>{t(`xref.fmt.${REF_FORMATS[k]}`)}</option>)}
          </select>
        </Field>
        <label className="field crossref-name"><span>{t('xref.name')}</span>
          <input value={name} readOnly={type !== 'setref'} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <footer><button type="button" onClick={() => c.setDialog(null)}>{t('common.close')}</button><button type="submit" className="primary" disabled={!canInsert}>{t('xref.insert')}</button></footer>
    </form>
  );
}

/**
 * Insert > Field > More Fields (sw fielddialog.ui, SwFieldDlg): the Document, Cross-references,
 * DocInformation and Variables pages; Functions and Database are not ported. Insert keeps the
 * dialog open; Insert > Cross-reference opens it on its page.
 */
type FieldPage = 'document' | 'ref' | 'docinfo' | 'var';
function FieldDialog({ c, initial }: { c: Controller; initial: FieldPage }) {
  const [page, setPage] = useState<FieldPage>(initial);
  const pages: FieldPage[] = ['document', 'ref', 'docinfo', 'var'];
  const labels = { document: t('fields.document'), ref: t('fields.ref'), docinfo: t('fields.docinfo'), var: t('fields.var') };
  return (
    <Modal c={c} title={t('xref.title')} wide>
      <Tabs ids={pages} labels={labels} current={page} onChange={(p) => setPage(p as FieldPage)} label={t('xref.title')} />
      {/* Only the current page: each is a form of its own, inserting as it is. */}
      <Panel id={page} current={page}>{page === 'document' ? <FieldDocumentPage c={c} /> : page === 'ref' ? <CrossReferencePage c={c} /> : page === 'docinfo' ? <FieldDocInfoPage c={c} /> : <FieldVarPage c={c} />}</Panel>
    </Modal>
  );
}

/** SVX_NUM_PAGEDESC in the format lists: the numbering of the page's style. */
const AS_PAGE_STYLE = -1;
/**
 * The Document page (flddocumentpage.ui, SwFieldDokPage) for the field types ported: date, page
 * number, statistics (SwDocStatSubType, the pages being the page count field) and time. Author,
 * chapter, file name, sender and template fields, and the offsets, are not ported.
 */
function FieldDocumentPage({ c }: { c: Controller }) {
  type DocType = 'date' | 'page' | 'stat' | 'time';
  const [type, setType] = useState<DocType>('date');
  const [sel, setSel] = useState(0);
  const [fmt, setFmt] = useState(AS_PAGE_STYLE);
  const types: [DocType, string][] = [['date', t('fields.date')], ['page', t('fields.page')], ['stat', t('fields.stat')], ['time', t('fields.time')]];
  const selects = type === 'date' ? [t('fields.date'), t('fields.dateFixed')] : type === 'time' ? [t('fields.time'), t('fields.timeFixed')]
    : type === 'page' ? [t('fields.pageNumber')] : [0, 1, 2, 3, 4, 5, 6, 7].map((k) => t(`fields.stat.${k}`));
  // SwFieldMgr's format lists: the page numbers and counts may number as their page's style.
  const pageLike = type === 'page' || (type === 'stat' && sel <= SwDocStatSubType.PageRange);
  const formats: [number, string][] = type === 'date' || type === 'time' ? []
    : [...NUM_TYPES.filter(([v]) => v !== NumberingType.NUMBER_NONE && v !== NumberingType.CHAR_SPECIAL), ...(pageLike ? [[AS_PAGE_STYLE, t('fields.pageStyle')] as [number, string]] : [])];
  const choose = (k: DocType, nSel = 0) => {
    setType(k);
    setSel(nSel);
    setFmt(k === 'page' || (k === 'stat' && nSel <= SwDocStatSubType.PageRange) ? AS_PAGE_STYLE : NumberingType.ARABIC);
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const numType = fmt === AS_PAGE_STYLE ? {} : { numType: fmt };
    if (type === 'date' || type === 'time') c.sh.InsertField(type === 'date' ? 'Date' : 'Time', sel === 1);
    else if (type === 'page') c.sh.InsertFormatField({ type: 'PageNumber', ...numType });
    else if (sel === SwDocStatSubType.Page) c.sh.InsertFormatField({ type: 'PageCount', ...numType });
    else c.sh.InsertFormatField({ type: 'DocStat', subType: sel, ...numType });
    c.notify();
  };
  return (
    <form method="dialog" onSubmit={submit}>
      <div className="crossref">
        <Field label={t('xref.type')}>
          <select size={10} value={type} onChange={(e) => choose(e.target.value as DocType)}>
            {types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={t('fields.select')}>
          <select size={10} value={sel} onChange={(e) => choose(type, Number(e.target.value))}>
            {selects.map((l, k) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={t('fields.format')}>
          <select size={10} value={fmt} disabled={!formats.length} onChange={(e) => setFmt(Number(e.target.value))}>
            {formats.map(([v, l]) => <option key={v} value={v}>{l.startsWith('num.') ? t(l) : l}</option>)}
          </select>
        </Field>
      </div>
      <footer><button type="button" onClick={() => c.setDialog(null)}>{t('common.close')}</button><button type="submit" className="primary">{t('xref.insert')}</button></footer>
    </form>
  );
}

/**
 * The DocInformation page (flddocinfopage.ui, SwFieldDokInfPage): the document properties, the
 * created, modified and printed ones by author, date or time, and the custom properties. Fixed
 * content keeps the property's text now. The date and time formats are not ported.
 */
function FieldDocInfoPage({ c }: { c: Controller }) {
  const props = c.sh.m_pDoc.m_xDocProps;
  const [item, setItem] = useState(-1);
  const [fixed, setFixed] = useState(false);
  const parts = (nSub: number): { label: string; nSub: number }[] => [
    { label: t('fields.author'), nSub: nSub | SwDocInfoSubType.SubAuthor }, { label: t('fields.date'), nSub: nSub | SwDocInfoSubType.SubDate }, { label: t('fields.time'), nSub: nSub | SwDocInfoSubType.SubTime },
  ];
  // SwFieldDokInfPage::Reset: the types in the order of the tree, sorted by their names.
  const groups: { label: string; items: { label: string; nSub: number; name?: string }[] }[] = [
    { label: t('fields.info.comment'), items: [{ label: t('fields.info.comment'), nSub: SwDocInfoSubType.Comment }] },
    { label: t('fields.info.create'), items: parts(SwDocInfoSubType.Create) },
    { label: t('fields.info.custom'), items: props.m_aUserDefined.map((p) => ({ label: p.name, nSub: SwDocInfoSubType.Custom, name: p.name })) },
    { label: t('fields.info.keys'), items: [{ label: t('fields.info.keys'), nSub: SwDocInfoSubType.Keys }] },
    { label: t('fields.info.print'), items: parts(SwDocInfoSubType.Print) },
    { label: t('fields.info.change'), items: parts(SwDocInfoSubType.Change) },
    { label: t('fields.info.docno'), items: [{ label: t('fields.info.docno'), nSub: SwDocInfoSubType.DocNo }] },
    { label: t('fields.info.subject'), items: [{ label: t('fields.info.subject'), nSub: SwDocInfoSubType.Subject }] },
    { label: t('fields.info.title'), items: [{ label: t('fields.info.title'), nSub: SwDocInfoSubType.Title }] },
    { label: t('fields.info.edit'), items: [{ label: t('fields.info.edit'), nSub: SwDocInfoSubType.Edit }] },
  ].filter((g) => g.items.length);
  const flat = groups.flatMap((g) => g.items);
  const insert = () => {
    const it = flat[item];
    if (!it) return;
    c.sh.InsertFormatField(MakeDocInfoField(props, it.nSub, it.name, fixed));
    c.notify();
  };
  let k = 0;
  return (
    <form method="dialog" onSubmit={(e) => { e.preventDefault(); insert(); }}>
      <div className="crossref">
        <Field label={t('xref.type')}>
          <select size={14} value={item} onChange={(e) => setItem(Number(e.target.value))} onDoubleClick={insert}>
            {groups.map((g) => (g.items.length === 1 && g.items[0]!.label === g.label && g.items[0]!.name === undefined
              ? <option key={g.label} value={k++}>{g.label}</option>
              : <optgroup key={g.label} label={g.label}>{g.items.map((x) => <option key={`${g.label}:${x.label}`} value={k++}>{x.label}</option>)}</optgroup>))}
          </select>
        </Field>
        <Field label={t('fields.value')}>
          <output>{flat[item] ? new SwDocInfoFieldType(props).Expand(flat[item]!.nSub, flat[item]!.name ?? '') : ''}</output>
        </Field>
      </div>
      <label className="check"><input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} /> {t('fields.fixed')}</label>
      <footer><button type="button" onClick={() => c.setDialog(null)}>{t('common.close')}</button><button type="submit" className="primary" disabled={!flat[item]}>{t('xref.insert')}</button></footer>
    </form>
  );
}

/** The entries of the Variables page's number format list that are no number format (NUMBERFORMAT_ENTRY_NOT_FOUND). */
const VAR_FMT_TEXT = '\u0001text', VAR_FMT_CMD = '\u0001cmd', VAR_FMT_NAME = '\u0001name';
/**
 * The Variables page (fldvarpage.ui, SwFieldVarPage): set and show variables, formulas, input
 * fields, number ranges, page variables and user fields, as SwFieldMgr inserts them. The number
 * formats are the language's number formats (SwNumFormatTreeView without Additional Formats). Not
 * ported: DDE fields, a number range's chapter level and separator, and editing a field
 * (Edit > Fields).
 */
function FieldVarPage({ c }: { c: Controller }) {
  const sh = c.sh, doc = sh.m_pDoc;
  const lang = GetDocLanguage(doc);
  const [type, setTypeState] = useState<SwFieldTypesEnum>(SwFieldTypesEnum.Set);
  const [sel, setSel] = useState(-1);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [numFmt, setNumFmt] = useState('General');
  const [fmt, setFmt] = useState<number>(NumberingType.ARABIC);
  const [invisible, setInvisible] = useState(false);
  const [, setTick] = useState(0);
  const valueRef = useRef<HTMLTextAreaElement>(null);
  const types: [SwFieldTypesEnum, string][] = [
    [SwFieldTypesEnum.Set, t('fields.var.set')], [SwFieldTypesEnum.Get, t('fields.var.get')], [SwFieldTypesEnum.Formel, t('fields.var.formula')],
    [SwFieldTypesEnum.Input, t('fields.var.input')], [SwFieldTypesEnum.Sequence, t('fields.var.sequence')], [SwFieldTypesEnum.SetRefPage, t('fields.var.setPage')],
    [SwFieldTypesEnum.GetRefPage, t('fields.var.getPage')], [SwFieldTypesEnum.User, t('fields.var.user')],
  ];
  // UpdateSubType: the sorted names of the type (Input without its [Text] entry).
  const subTypes = (k: SwFieldTypesEnum) => {
    const out = GetSubTypes(sh, k, [t('fields.var.off'), t('fields.var.on')]);
    if (k !== SwFieldTypesEnum.SetRefPage) out.sort((a, b) => a.localeCompare(b));
    return out;
  };
  const items = subTypes(type);
  const selName = sel >= 0 ? items[sel] : undefined;
  const setVar = selName !== undefined ? doc.m_aSetExpFieldTypes.get(selName) : undefined;
  const bStringVar = !!setVar && !!(setVar.GetType() & SwGetSetExpType.String);
  const bUserSel = selName !== undefined && doc.m_aUserFieldTypes.has(selName);
  // SubTypeHdl: which controls the type uses.
  let bValue = false, bName = false, bNumFormat = false, bInvisible = false;
  let valueLabel = t('fields.value');
  switch (type) {
    case SwFieldTypesEnum.User: bValue = bName = bNumFormat = bInvisible = true; break;
    case SwFieldTypesEnum.Set: bValue = bNumFormat = bInvisible = bName = true; break;
    case SwFieldTypesEnum.Formel: bValue = bNumFormat = true; valueLabel = t('fields.var.formulaLabel'); break;
    case SwFieldTypesEnum.Get: bNumFormat = selName !== undefined && !bStringVar; break;
    case SwFieldTypesEnum.Input: valueLabel = t('fields.var.prompt'); if (selName !== undefined) { bValue = true; bNumFormat = !bUserSel; } break;
    case SwFieldTypesEnum.Sequence: bName = bValue = true; break;
    case SwFieldTypesEnum.SetRefPage: valueLabel = t('fields.var.offset'); bValue = sel === 1; break;
    default: break;
  }
  // FillFormatLB: the number formats with the type's own entries first, or the numberings.
  const numbers: [string, string][] = GetBuiltInFormats(lang).NUMBER.map((code) => [code, code === 'General' ? t('fields.var.general') : GetOutputString(-1234.56789, code, lang).text]);
  const numFormats: [string, string][] = type === SwFieldTypesEnum.User ? [[VAR_FMT_TEXT, t('fields.var.text')], [VAR_FMT_CMD, t('fields.var.formulaLabel')], ...numbers]
    : type === SwFieldTypesEnum.Set ? [[VAR_FMT_TEXT, t('fields.var.text')], ...numbers]
    : type === SwFieldTypesEnum.Formel || type === SwFieldTypesEnum.Get ? [[VAR_FMT_NAME, t('fields.var.name')], ...numbers]
    : type === SwFieldTypesEnum.Input && bStringVar ? [[VAR_FMT_TEXT, t('fields.var.text')]] : numbers;
  const formats: [number, string][] = type === SwFieldTypesEnum.Sequence ? NUM_TYPES.filter(([v]) => v !== NumberingType.NUMBER_NONE && v !== NumberingType.CHAR_SPECIAL)
    : type === SwFieldTypesEnum.GetRefPage ? [...NUM_TYPES.filter(([v]) => v !== NumberingType.NUMBER_NONE && v !== NumberingType.CHAR_SPECIAL), [AS_PAGE_STYLE, t('fields.pageStyle')]]
    : type === SwFieldTypesEnum.Get && bStringVar ? [[0, t('fields.var.text')]] : [];
  const shownNumFmt = numFormats.some(([k]) => k === numFmt) ? numFmt : numFormats.find(([k]) => k === 'General')?.[0] ?? numFormats[0]?.[0] ?? 'General';
  const shownFmt = formats.some(([k]) => k === fmt) ? fmt : formats[formats.length - 1]?.[0] === AS_PAGE_STYLE ? AS_PAGE_STYLE : formats[0]?.[0] ?? 0;

  /** SubTypeHdl for a selection made with the mouse: the name and value of what is selected. */
  const select = (k: number, eType: SwFieldTypesEnum = type, aItems: string[] = items) => {
    setSel(k);
    const n = aItems[k];
    if (n === undefined) return;
    switch (eType) {
      case SwFieldTypesEnum.User: {
        const pType = doc.m_aUserFieldTypes.get(n);
        setName(n);
        setValue(pType?.GetInputOrDateTime() ?? '');
        if (pType && pType.GetType() & SwUserType.String) setNumFmt(VAR_FMT_TEXT);
        break;
      }
      case SwFieldTypesEnum.Set: setName(n); if (doc.m_aSetExpFieldTypes.get(n)?.GetType() === SwGetSetExpType.String) setNumFmt(VAR_FMT_TEXT); break;
      case SwFieldTypesEnum.Get: case SwFieldTypesEnum.Input: case SwFieldTypesEnum.Sequence: setName(n); break;
      default: break;
    }
  };
  // TypeHdl and UpdateSubType: a new type clears the name and value and selects its first entry.
  const chooseType = (k: SwFieldTypesEnum) => {
    setTypeState(k);
    setName('');
    setValue('');
    setInvisible(false);
    const aItems = subTypes(k);
    if (aItems.length) select(0, k, aItems);
    else setSel(-1);
  };

  // ModifyHdl: a variable's name is the identifier it starts with; whether Insert, New and Delete apply.
  const fixName = (s: string) => (type === SwFieldTypesEnum.User || type === SwFieldTypesEnum.Set || type === SwFieldTypesEnum.Sequence ? SwCalc.IsValidVarName(s).sValidName : s);
  const sName = name;
  let bInsert = false, bApply = false, bDelete = false;
  if (type === SwFieldTypesEnum.User) {
    if (sName) {
      bDelete = doc.m_aUserFieldTypes.has(sName) && !doc.IsUsed('User', sName);
      // no name conflict with variables; user fields can also be inserted without content
      if (!doc.m_aSetExpFieldTypes.has(sName)) bInsert = bApply = true;
    }
  } else {
    bInsert = true;
    if (type === SwFieldTypesEnum.Set || type === SwFieldTypesEnum.Sequence) {
      if (doc.m_aSetExpFieldTypes.has(sName)) {
        if (type === SwFieldTypesEnum.Set && !doc.IsUsed('SetExp', sName)) bDelete = true;
        if (type === SwFieldTypesEnum.Sequence) bInsert = false;
      } else if (type === SwFieldTypesEnum.Set && items.length && GetSubTypes(sh, SwFieldTypesEnum.Sequence).includes(sName)) bInsert = false;
      if (doc.m_aUserFieldTypes.has(sName)) bInsert = false;
    }
    if (!sName && (type === SwFieldTypesEnum.Set || type === SwFieldTypesEnum.Input || type === SwFieldTypesEnum.Get)) bInsert = false;
    if ((type === SwFieldTypesEnum.Set || type === SwFieldTypesEnum.Formel) && !value) bInsert = false;
    if (type === SwFieldTypesEnum.SetRefPage && sel < 0) bInsert = false;
  }

  const refresh = () => { setTick((x) => x + 1); c.notify(); };
  /** TBClickHdl: New/Apply sets the user field's content and kind; Delete removes an unused type. */
  const apply = () => {
    const bText = shownNumFmt === VAR_FMT_TEXT || shownNumFmt === VAR_FMT_CMD;
    const nFormat = bText ? undefined : shownNumFmt === 'General' ? undefined : shownNumFmt;
    const pType = doc.m_aUserFieldTypes.get(sName) ?? doc.InsertFieldType(new SwUserFieldType(sName));
    pType.SetContent(value, nFormat, lang);
    pType.SetType(bText ? SwUserType.String : SwUserType.Expr);
    doc.UpdateFields();
    const k = GetSubTypes(sh, SwFieldTypesEnum.User).sort((a, b) => a.localeCompare(b)).indexOf(sName);
    setSel(k);
    refresh();
  };
  const remove = () => {
    RemoveFieldType(sh, type === SwFieldTypesEnum.User ? 'User' : 'SetExp', sName);
    setSel(-1);
    setName('');
    setValue('');
    refresh();
  };

  /** FillItemSet: the sub type and format of the field, then SwFieldMgr::InsertField. */
  const insert = () => {
    if (!bInsert) return;
    const sNum = bNumFormat ? shownNumFmt : undefined;
    const sNumFormat = sNum && !sNum.startsWith('\u0001') && sNum !== 'General' ? sNum : undefined;
    const bNotFound = sNum?.startsWith('\u0001') ?? false;
    let nSubType = 0;
    switch (type) {
      case SwFieldTypesEnum.User:
        nSubType = bNotFound ? SwUserType.String : SwUserType.Expr;
        if (sNum === VAR_FMT_CMD) nSubType |= SwUserType.ShowCommand;
        if (invisible) nSubType |= SwUserType.Invisible;
        break;
      case SwFieldTypesEnum.Formel: nSubType = SwGetSetExpType.Formula | (bNotFound ? SwGetSetExpType.Command : 0); break;
      case SwFieldTypesEnum.Get: nSubType = bNumFormat && bNotFound ? SwGetSetExpType.Command : 0; break;
      case SwFieldTypesEnum.Input: nSubType = doc.m_aUserFieldTypes.has(sName) ? SwInputFieldSubType.User : SwInputFieldSubType.Var; break;
      case SwFieldTypesEnum.Set: nSubType = (bNotFound ? SwGetSetExpType.String : SwGetSetExpType.Expr) | (invisible ? SwGetSetExpType.Invisible : 0); break;
      case SwFieldTypesEnum.SetRefPage: nSubType = sel === 1 ? 1 : 0; break;
      default: break;
    }
    const nNumType = type === SwFieldTypesEnum.Sequence || type === SwFieldTypesEnum.GetRefPage ? (shownFmt === AS_PAGE_STYLE ? undefined : shownFmt) : undefined;
    const f = InsertField(sh, { m_nTypeId: type, m_nSubType: nSubType, m_sPar1: sName, m_sPar2: type === SwFieldTypesEnum.SetRefPage && sel !== 1 ? '' : value, m_sNumFormat: sNumFormat, m_nNumType: nNumType });
    refresh();
    // SwFieldMgr::InsertField: an input field asks for its value at once.
    if (f && (f.type === 'Input' || (f.type === 'SetExp' && f.input))) {
      const pos = sh.m_pCursor.GetPoint();
      c.StartInputFieldDlg(pos.GetNodeIndex(), pos.GetContentIndex() - 1);
    }
  };
  /** SubTypeInsertHdl: for a formula, a double-clicked name goes into the formula. */
  const activate = (k: number) => {
    if (type === SwFieldTypesEnum.Formel && items[k] !== undefined) {
      const el = valueRef.current;
      const a = el?.selectionStart ?? value.length, b = el?.selectionEnd ?? value.length;
      setValue(value.slice(0, a) + items[k] + value.slice(b));
      return;
    }
    insert();
  };
  return (
    <form method="dialog" onSubmit={(e) => { e.preventDefault(); insert(); }}>
      <div className="crossref">
        <Field label={t('xref.type')}>
          <select size={10} value={type} onChange={(e) => chooseType(e.target.value as SwFieldTypesEnum)} onDoubleClick={insert}>
            {types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={t('fields.select')}>
          <select size={10} value={sel} disabled={!items.length} onChange={(e) => select(Number(e.target.value))} onDoubleClick={() => activate(sel)}>
            {items.map((x, k) => <option key={`${k}:${x}`} value={k}>{x}</option>)}
          </select>
        </Field>
        <Field label={t('fields.format')}>
          {bNumFormat
            ? <select size={10} value={shownNumFmt} onChange={(e) => setNumFmt(e.target.value)} onDoubleClick={insert}>
                {numFormats.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            : <select size={10} value={shownFmt} disabled={!formats.length} onChange={(e) => setFmt(Number(e.target.value))} onDoubleClick={insert}>
                {formats.map(([k, l]) => <option key={k} value={k}>{l.startsWith('num.') ? t(l) : l}</option>)}
              </select>}
        </Field>
        <label className="field crossref-name"><span>{t('fields.var.nameLabel')}</span>
          <input value={name} disabled={!bName} onChange={(e) => setName(fixName(e.target.value))} spellCheck={false} />
        </label>
        <label className="field crossref-name"><span>{valueLabel}</span>
          <textarea ref={valueRef} rows={3} value={value} disabled={!bValue} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
        </label>
      </div>
      <div className="row">
        {type === SwFieldTypesEnum.User && <>
          <button type="button" disabled={!bApply} onClick={apply} title={t('fields.var.apply')}>{t('fields.var.apply')}</button>
          <button type="button" disabled={!bDelete} onClick={remove} title={t('fields.var.delete')}>{t('fields.var.delete')}</button>
        </>}
        {type === SwFieldTypesEnum.Set && <button type="button" disabled={!bDelete} onClick={remove}>{t('fields.var.delete')}</button>}
        <label className="check"><input type="checkbox" checked={invisible} disabled={!bInvisible} onChange={(e) => setInvisible(e.target.checked)} /> {t('fields.var.invisible')}</label>
      </div>
      <footer><button type="button" onClick={() => c.setDialog(null)}>{t('common.close')}</button><button type="submit" className="primary" disabled={!bInsert}>{t('xref.insert')}</button></footer>
    </form>
  );
}

/**
 * The Input Field dialog (inputfielddialog.ui, SwFieldInputDlg): the prompt, and the value of the
 * input field to change. The Next and Previous buttons of Tools > Update > Fields are not ported.
 */
function FieldInputDialog({ c }: { c: Controller }) {
  const pos = c.inputField;
  const node = pos ? c.sh.m_pDoc.GetNodes().node(pos.nNode) : null;
  const texts = node?.IsTextNode() ? c.sh.GetInputFieldTexts(node as SwTextNode, pos!.nAt) : null;
  const [value, setValue] = useState(texts?.sValue ?? '');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (node?.IsTextNode() && pos) c.sh.SetInputFieldValue(node as SwTextNode, pos.nAt, value);
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('fields.input.title')}>
      <form method="dialog" onSubmit={submit}>
        <p className="prompt">{texts?.sPrompt ?? ''}</p>
        <textarea rows={4} value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label={texts?.sPrompt || t('fields.input.title')} />
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** Format > Watermark (SwWatermarkDialog): text, font, angle, transparency and colour of every page's watermark. */
function Watermark({ c }: { c: Controller }) {
  const init = useMemo(() => GetWatermark(c.sh), [c]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    // OKButtonHdl dispatches .uno:Watermark; an empty text removes the watermark.
    SetWatermark(c.sh, {
      m_aText: String(f.get('text')), m_aFont: String(f.get('font')) || init.m_aFont,
      m_nAngle: ((Math.round(Number(f.get('angle'))) % 360) + 360) % 360, m_nTransparency: Math.max(0, Math.min(100, Math.round(Number(f.get('transparency'))))),
      m_nColor: String(f.get('color')),
    });
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('watermark.title')}>
      <form method="dialog" onSubmit={submit}>
        <Field label={t('watermark.text')}><input name="text" defaultValue={init.m_aText} autoFocus /></Field>
        <Field label={t('watermark.font')}>
          <FontNameField c={c} name="font" label={t('watermark.font')} value={init.m_aFont} required={false} />
        </Field>
        <Field label={t('watermark.angle')}><input name="angle" type="number" min="0" max="359" defaultValue={init.m_nAngle} /></Field>
        <Field label={t('watermark.transparency')}><input name="transparency" type="number" min="0" max="100" defaultValue={init.m_nTransparency} /></Field>
        <Field label={t('watermark.color')}><input name="color" type="color" defaultValue={init.m_nColor} /></Field>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** dinfdlg.cxx CreateSizeText: bytes below 10000, else KB, MB or GB with the bytes after them. */
function CreateSizeText(nSize: number, lang: string): string {
  const nMega = 1024 * 1024, nGiga = nMega * 1024;
  const num = (n: number, dec = 0) => n.toLocaleString(lang, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const [unit, div, nDec] = nSize >= nGiga ? ['GB', nGiga, 3] : nSize >= nMega ? ['MB', nMega, 2] : nSize >= 10000 ? ['KB', 1024, 0] : [t('docinfo.bytes'), 1, 0];
  if (div === 1) return `${num(nSize)} ${unit}`;
  return `${num(nSize / div, nDec as number)} ${unit} (${num(nSize)} ${t('docinfo.bytes')})`;
}

/** dinfdlg.cxx ConvertDateTime_Impl: date, time and the author, if any. */
function ConvertDateTime_Impl(rName: string, uDT: DateTime, lang: string): string {
  if (uDT.Month <= 0) return '';
  const d = new Date(uDT.Year, uDT.Month - 1, uDT.Day, uDT.Hours, uDT.Minutes, uDT.Seconds);
  let aStr = `${d.toLocaleDateString(lang)}, ${d.toLocaleTimeString(lang)}`;
  const aAuthor = rName.replace(/^ +/, '');
  if (aAuthor) aStr += `, ${aAuthor}`;
  return aStr;
}

/** comphelper::string::convertCommaSeparated, both ways. */
const fromCommaSeparated = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/**
 * File > Properties (SfxDocumentInfoDialog), reduced to its General and Description pages. Not
 * ported: the location, template, signature and password parts of General, the thumbnail
 * option, and the Custom Properties, CMIS, Security, Font and Statistics pages.
 */
function DocumentProperties({ c }: { c: Controller }) {
  const doc = c.sh.m_pDoc, p = doc.m_xDocProps, lang = navigator.language || 'en';
  const [page, setPage] = useState('general');
  const [useUserData, setUseUserData] = useState(doc.m_bUseUserData);
  const [reset, setReset] = useState(false);
  const [dpiOn, setDpiOn] = useState(doc.m_nImagePreferredDPI > 0);
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => { void c.handle?.getFile().then((f) => setSize(f.size)).catch(() => {}); }, [c]);
  const ext = c.handle?.name.match(/\.(\w+)$/)?.[1]?.toLowerCase();
  const type = !c.handle ? t('docinfo.typeNew') : ext === 'docx' ? t('docinfo.typeDocx') : ext === 'txt' ? t('docinfo.typeTxt') : ext === 'md' || ext === 'markdown' ? t('docinfo.typeMd') : ext === 'html' || ext === 'htm' ? t('docinfo.typeHtml') : t('docinfo.typeOdt');
  // The values shown: after Reset Properties, those resetUserData gives.
  const shown = useMemo(() => {
    if (!reset) return p;
    const q = p.Clone();
    q.resetUserData(useUserData ? c.userFullName : '');
    return q;
  }, [p, reset, useUserData, c]);
  const secs = shown.getEditingDuration();
  const editTime = `${Math.trunc(secs / 3600)}:${String(Math.trunc((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  const desc: [string, string, string][] = [
    ['title', 'docinfo.docTitle', p.getTitle()], ['subject', 'docinfo.subject', p.getSubject()], ['keywords', 'docinfo.keywords', p.getKeywords().join(', ')],
    ['contributor', 'docinfo.contributor', p.getContributor().join(', ')], ['coverage', 'docinfo.coverage', p.getCoverage()], ['identifier', 'docinfo.identifier', p.getIdentifier()],
    ['publisher', 'docinfo.publisher', p.getPublisher().join(', ')], ['relation', 'docinfo.relation', p.getRelation().join(', ')], ['rights', 'docinfo.rights', p.getRights()],
    ['source', 'docinfo.source', p.getSource()], ['type', 'docinfo.docType', p.getType()],
  ];
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? '');
    const before = p.Write() + doc.m_bUseUserData + doc.m_nImagePreferredDPI;
    // SfxDocumentPage::FillItemSet: Reset Properties, Apply user data, the preferred resolution.
    if (reset) p.resetUserData(useUserData ? c.userFullName : '');
    doc.m_bUseUserData = useUserData;
    doc.m_nImagePreferredDPI = dpiOn ? Math.max(0, Math.trunc(Number(str('dpi')) || 0)) : 0;
    // SfxDocumentDescPage::FillItemSet
    p.setTitle(str('title')); p.setSubject(str('subject')); p.setKeywords(fromCommaSeparated(str('keywords')));
    p.setContributor(fromCommaSeparated(str('contributor'))); p.setCoverage(str('coverage')); p.setIdentifier(str('identifier'));
    p.setPublisher(fromCommaSeparated(str('publisher'))); p.setRelation(fromCommaSeparated(str('relation'))); p.setRights(str('rights'));
    p.setSource(str('source')); p.setType(str('type')); p.setDescription(str('comments'));
    c.setDialog(null);
    if (p.Write() + doc.m_bUseUserData + doc.m_nImagePreferredDPI !== before) doc.SetModified();
    c.notify();
  };
  const labels = { general: t('docinfo.general'), description: t('docinfo.description') };
  return (
    <Modal c={c} title={t('docinfo.title', { name: c.name })} wide>
      <form method="dialog" onSubmit={submit}>
        <Tabs ids={['general', 'description']} labels={labels} current={page} onChange={setPage} label={t('docinfo.title', { name: c.name })} />
        <section role="tabpanel" id="panel-general" aria-labelledby="tab-general" hidden={page !== 'general'}>
          <dl className="docinfo">
            <dt>{t('docinfo.type')}</dt><dd>{type}</dd>
            <dt>{t('docinfo.size')}</dt><dd>{size === null ? t('docinfo.unknown') : CreateSizeText(size, lang)}</dd>
            <dt>{t('docinfo.created')}</dt><dd>{ConvertDateTime_Impl(shown.getAuthor(), shown.getCreationDate(), lang)}</dd>
            <dt>{t('docinfo.modified')}</dt><dd>{ConvertDateTime_Impl(shown.getModifiedBy(), shown.getModificationDate(), lang)}</dd>
            <dt>{t('docinfo.printed')}</dt><dd>{ConvertDateTime_Impl(shown.getPrintedBy(), shown.getPrintDate(), lang)}</dd>
            <dt>{t('docinfo.editTime')}</dt><dd>{useUserData ? editTime : ''}</dd>
            <dt>{t('docinfo.revision')}</dt><dd>{useUserData ? shown.getEditingCycles() : ''}</dd>
          </dl>
          <label className="check"><input type="checkbox" checked={useUserData} onChange={(e) => setUseUserData(e.target.checked)} />{t('docinfo.useUserData')}</label>
          <p><button type="button" onClick={() => setReset(true)}>{t('docinfo.reset')}</button></p>
          <div className="docinfo-dpi">
            <label className="check"><input type="checkbox" checked={dpiOn} onChange={(e) => setDpiOn(e.target.checked)} />{t('docinfo.dpi')}</label>
            <input name="dpi" type="number" min="1" list="docinfo-dpi" disabled={!dpiOn} defaultValue={doc.m_nImagePreferredDPI || ''} aria-label={t('docinfo.ppi')} /> {t('docinfo.ppi')}
            <datalist id="docinfo-dpi">{[96, 150, 200, 300, 600].map((n) => <option key={n} value={n} />)}</datalist>
          </div>
        </section>
        <section role="tabpanel" id="panel-description" aria-labelledby="tab-description" hidden={page !== 'description'}>
          {desc.map(([name, key, value]) => <Field key={name} label={t(key)}><input name={name} defaultValue={value} /></Field>)}
          <Field label={t('docinfo.comments')}><textarea name="comments" rows={4} defaultValue={p.getDescription()} /></Field>
        </section>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** Format > Image > Graphic Size Check (svx GenericCheckDialog with GraphicSizeCheckGUIResult). */
function GraphicSizeCheckDialog({ c }: { c: Controller }) {
  const list = useMemo(() => GraphicSizeCheckGUIResult(c.sh.m_pDoc), [c]);
  // GraphicSizeCheckGUIEntry::markObject: GotoFly, selecting the image.
  const mark = (name: string) => { c.sh.SelectFly(name); c.onEdit(); c.notify(); };
  return (
    <Modal c={c} title={t('sizecheck.title')} wide>
      {list.length ? (
        <ul className="check-list">
          {list.map((v) => (
            <li key={v.getGraphicName()}>
              <span>{GraphicSizeCheckGUIEntryText(v, t('sizecheck.low'), t('sizecheck.high'))}</span>
              <button type="button" onClick={() => mark(v.getGraphicName())}>{t('sizecheck.mark')}</button>
              {/* runProperties: mark it, then FN_FORMAT_GRAFIC_DLG. */}
              <button type="button" onClick={() => { mark(v.getGraphicName()); c.setDialog('fly'); }}>{t('sizecheck.properties')}</button>
            </li>
          ))}
        </ul>
      ) : <p>{t('sizecheck.none')}</p>}
      <footer><button type="button" className="primary" onClick={() => c.setDialog(null)}>{t('common.ok')}</button></footer>
    </Modal>
  );
}

/** Table > Insert > Rows / Columns (cui insertrowcolumn.ui): how many, before or after. */
function InsertRowCol({ c, cols }: { c: Controller; cols: boolean }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = Math.max(1, Math.min(99, parseInt(String(f.get('n')), 10) || 1)), after = f.get('pos') === 'after';
    if (cols) c.sh.InsertCol(after, n); else c.sh.InsertRow(after, n);
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t(cols ? 'table.insertCols' : 'table.insertRows')}>
      <form method="dialog" onSubmit={submit}>
        <Field label={t('table.number')}><input name="n" type="number" min={1} max={99} defaultValue={1} autoFocus /></Field>
        <fieldset><legend>{t('table.position')}</legend>
          <label className="check"><input type="radio" name="pos" value="before" /> {t('table.before')}</label>
          <label className="check"><input type="radio" name="pos" value="after" defaultChecked /> {t('table.after')}</label>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** Table > Split Cells (cui splitcellsdialog.ui): into how many, horizontally (rows) or vertically. */
function SplitCells({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = Math.max(2, Math.min(20, parseInt(String(f.get('n')), 10) || 2));
    // SwTableShell FN_TABLE_SPLIT_CELLS: SplitTab(!bHorizontal, nCount - 1).
    c.sh.SplitTab(f.get('dir') === 'vert', n - 1);
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('table.splitCells')}>
      <form method="dialog" onSubmit={submit}>
        <Field label={t('table.splitInto')}><input name="n" type="number" min={2} max={20} defaultValue={2} autoFocus /></Field>
        <fieldset><legend>{t('table.direction')}</legend>
          <label className="check"><input type="radio" name="dir" value="hori" defaultChecked /> {t('table.horizontally')}</label>
          <label className="check"><input type="radio" name="dir" value="vert" /> {t('table.vertically')}</label>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** Table > Merge Table (sw mergetabledialog.ui), when there are tables on both sides. */
function MergeTables({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    c.sh.MergeTable(new FormData(e.currentTarget).get('with') === 'prev');
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('table.mergeTables')}>
      <form method="dialog" onSubmit={submit}>
        <fieldset><legend>{t('table.mode')}</legend>
          <label className="check"><input type="radio" name="with" value="prev" defaultChecked /> {t('table.mergePrev')}</label>
          <label className="check"><input type="radio" name="with" value="next" /> {t('table.mergeNext')}</label>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** Table > Split Table (sw splittable.ui, SwSplitTableDlg::Apply). */
function SplitTableDialog({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const mode = { copy: SplitTable_HeadlineOption.ContentCopy, style: SplitTable_HeadlineOption.BoxAttrAllCopy, custom: SplitTable_HeadlineOption.BoxAttrCopy, none: SplitTable_HeadlineOption.BorderCopy }[String(new FormData(e.currentTarget).get('mode'))] ?? SplitTable_HeadlineOption.ContentCopy;
    c.sh.SplitTable(mode);
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('table.splitTable')}>
      <form method="dialog" onSubmit={submit}>
        <fieldset><legend>{t('table.mode')}</legend>
          <label className="check"><input type="radio" name="mode" value="copy" defaultChecked /> {t('table.copyHeading')}</label>
          <label className="check"><input type="radio" name="mode" value="style" /> {t('table.customHeadingStyle')}</label>
          <label className="check"><input type="radio" name="mode" value="custom" /> {t('table.customHeading')}</label>
          <label className="check"><input type="radio" name="mode" value="none" /> {t('table.noHeading')}</label>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * Insert > Caption for a table, frame, graphic, formula or shape (sw insertcaption.ui, SwCaptionDialog): the category (a number
 * range; a new name makes a new one), its numbering, the text, the separator before it and the
 * position, with a preview (DrawSample). The Auto and Options buttons are not ported.
 */
function CaptionDialog({ c }: { c: Controller }) {
  const none = t('caption.none');
  // SwCaptionDialog: the category of the selection's kind (RES_POOLCOLL_LABEL_*), Illustration
  // for graphics of documents that use it.
  const [cat, setCat] = useState(() => {
    const eType = c.sh.GetLabelType();
    if (eType === 'Object') return c.sh.m_pDoc.IsUsedSeq('Illustration') ? 'Illustration' : 'Figure';
    return eType === 'Fly' ? 'Text' : eType === 'Draw' ? 'Drawing' : 'Table';
  });
  const [text, setText] = useState('');
  const [sep, setSep] = useState(': ');
  const [num, setNum] = useState<number>(NumberingType.ARABIC);
  const [below, setBelow] = useState(false);
  // TextFilterAutoConvert: a category must be a valid variable name (SwCalc::IsValidVarName).
  const valid = (s: string) => !s || s === none || /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s);
  const isNone = !cat || cat === none;
  const numbers: [number, string][] = [[NumberingType.ARABIC, '1, 2, 3, ...'], [NumberingType.CHARS_UPPER_LETTER, 'A, B, C, ...'], [NumberingType.CHARS_LOWER_LETTER, 'a, b, c, ...'], [NumberingType.ROMAN_UPPER, 'I, II, III, ...'], [NumberingType.ROMAN_LOWER, 'i, ii, iii, ...']];
  // SwCaptionDialog::DrawSample: the category, a sample number, the separator and the text.
  const preview = (isNone ? '' : `${cat} ${makeNumberingString(num as NumberingType, 1)}`) + (text ? (isNone ? '' : sep) + text : '');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    c.sh.InsertLabel(isNone ? '' : cat.trim(), text, isNone ? '' : sep, !below, num);
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('caption.title')}>
      <form method="dialog" onSubmit={submit}>
        <fieldset><legend>{t('caption.caption')}</legend>
          <input aria-label={t('caption.caption')} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
        </fieldset>
        <fieldset><legend>{t('caption.properties')}</legend>
          <label className="field">{t('caption.category')}
            <input list="caption-categories" value={cat} onChange={(e) => { if (valid(e.target.value)) setCat(e.target.value); }} />
            <datalist id="caption-categories">{[none, ...CAPTION_CATEGORIES].map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label className="field">{t('caption.numbering')}
            <select value={num} disabled={isNone} onChange={(e) => setNum(Number(e.target.value))}>{numbers.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="field">{t('caption.separator')}
            <input value={sep} disabled={isNone} onChange={(e) => setSep(e.target.value)} />
          </label>
          <label className="field">{t('caption.position')}
            <select value={below ? 'below' : 'above'} onChange={(e) => setBelow(e.target.value === 'below')}>
              <option value="above">{t('caption.above')}</option>
              <option value="below">{t('caption.below')}</option>
            </select>
          </label>
        </fieldset>
        <fieldset><legend>{t('caption.preview')}</legend>
          <output aria-label={t('caption.preview')} className="caption-preview">{preview || '\u00a0'}</output>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * The formula editor (LibreOffice Math's command window, edit window and Elements panel, in a
 * dialog): the formula text with a preview; the elements insert their command with placeholders.
 * Inserts a formula, or changes the selected one.
 */
const FORMULA_ELEMENTS: [string, string][] = [
  ['a + b', '<?> + <?>'], ['a − b', '<?> - <?>'], ['a × b', '<?> times <?>'], ['a ⋅ b', '<?> cdot <?>'], ['a ÷ b', '<?> div <?>'],
  ['a = b', '<?> = <?>'], ['a ≠ b', '<?> <> <?>'], ['a ≤ b', '<?> <= <?>'], ['a ≥ b', '<?> >= <?>'], ['a ≈ b', '<?> approx <?>'],
  ['a/b', '{<?>} over {<?>}'], ['aⁿ', '<?>^{<?>}'], ['aₙ', '<?>_{<?>}'], ['√a', 'sqrt{<?>}'], ['ⁿ√a', 'nroot{<?>}{<?>}'],
  ['∑', 'sum from{<?>} to{<?>} <?>'], ['∏', 'prod from{<?>} to{<?>} <?>'], ['∫', 'int from{<?>} to{<?>} <?>'], ['lim', 'lim from{<?>} <?>'],
  ['(a)', 'left( <?> right)'], ['[a]', 'left[ <?> right]'], ['{a}', 'left lbrace <?> right rbrace'], ['|a|', 'abs{<?>}'],
  ['→a', 'vec <?>'], ['ā', 'bar <?>'], ['â', 'hat <?>'], ['sin', 'sin(<?>)'], ['α', '%alpha'], ['π', '%pi'], ['∞', 'infinity'],
  ['(ab/cd)', 'left( matrix{<?> # <?> ## <?> # <?>} right)'], ['a\nb', 'stack{<?> # <?>}'],
];

function FormulaDialog({ c }: { c: Controller }) {
  const editing = c.sh.IsOLEMath();
  const [text, setText] = useState(() => (editing ? c.sh.GetFlyFrameFormat()?.m_pMath?.m_sText ?? '' : ''));
  const area = useRef<HTMLTextAreaElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const shell = useMemo(() => new SmDocShell(text), [text]);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const size = shell.GetSize(c.measurer);
    const dpr = globalThis.devicePixelRatio || 1;
    // 1.5 times the size on the page, at most the preview's width.
    const scale = Math.min(1.5 / 15, (cv.clientWidth - 16) / Math.max(1, size.width));
    cv.width = Math.round(cv.clientWidth * dpr);
    cv.height = Math.round(Math.max(cv.clientHeight, size.height * scale + 16) * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 8 * dpr, 8 * dpr);
    shell.DrawFormula(ctx, c.measurer, 0, 0, getComputedStyle(cv).color || '#000000');
  }, [shell, c.measurer]);
  // SmEditTextWindow::InsertText: the element at the cursor, then the first placeholder selected.
  const insert = (cmd: string) => {
    const el = area.current;
    const from = el?.selectionStart ?? text.length, to = el?.selectionEnd ?? text.length;
    const before = text.slice(0, from), after = text.slice(to);
    const ins = `${before && !/\s$/.test(before) ? ' ' : ''}${cmd} `;
    const next = before + ins + after;
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const p = next.indexOf('<?>', before.length);
      if (p >= 0 && p < before.length + ins.length) el.setSelectionRange(p, p + 3);
      else el.setSelectionRange(before.length + ins.length, before.length + ins.length);
    });
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (editing) c.sh.SetFormulaText(text);
    else if (text.trim()) c.sh.InsertObjectStarMath(text);
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t(editing ? 'formula.edit' : 'formula.title')} wide>
      <form method="dialog" onSubmit={submit} className="formula-dialog">
        <div className="formula-elements" role="toolbar" aria-label={t('formula.elements')}>
          {FORMULA_ELEMENTS.map(([label, cmd]) => <button key={cmd} type="button" title={cmd} onClick={() => insert(cmd)}>{label}</button>)}
        </div>
        <label className="field formula-text">{t('formula.commands')}
          <textarea ref={area} value={text} autoFocus spellCheck={false} rows={4} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit(); }} />
        </label>
        <fieldset><legend>{t('caption.preview')}{shell.mbHasErrors ? ` — ${t('formula.error')}` : ''}</legend>
          <canvas ref={canvas} className="formula-preview" aria-label={t('caption.preview')} />
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * The Contour Editor (SvxContourDlg, reduced): the graphic with its contour. AutoContour traces it
 * from the graphic; points are moved by dragging, added by a double click on an edge and removed
 * with Delete. Applying it turns contour wrap on (SID_CONTOUR_EXEC).
 */
function ContourDialog({ c }: { c: Controller }) {
  const fmt = c.sh.GetFlyFrameFormat()!;
  const [poly, setPoly] = useState<[number, number][]>(() => fmt.m_aContour?.[0]?.map((p) => [...p] as [number, number]) ?? []);
  const [undo, setUndo] = useState<[number, number][][]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [raw, setRaw] = useState<{ width: number; height: number; data: Uint8ClampedArray } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  useEffect(() => {
    void c.selectedBitmap().then(async (b) => {
      if (!b) return;
      setRaw(b);
      setBmp(await createImageBitmap(new ImageData(new Uint8ClampedArray(b.data), b.width, b.height)));
    });
  }, [c]);
  // The graphic fitted into the editor, in CSS pixels.
  const W = 480, H = 320;
  const fit = bmp ? Math.min(W / bmp.width, H / bmp.height) : 1;
  const gw = bmp ? bmp.width * fit : W, gh = bmp ? bmp.height * fit : H, ox = (W - gw) / 2, oy = (H - gh) / 2;
  const toPx = ([x, y]: [number, number]) => [ox + x * gw, oy + y * gh] as const;
  const fromPx = (px: number, py: number): [number, number] => [Math.min(1, Math.max(0, (px - ox) / gw)), Math.min(1, Math.max(0, (py - oy) / gh))];
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = globalThis.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (bmp) ctx.drawImage(bmp, ox, oy, gw, gh);
    if (poly.length) {
      ctx.beginPath();
      poly.forEach((p, i) => { const [x, y] = toPx(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.fillStyle = 'rgba(52, 101, 164, 0.2)'; ctx.fill();
      ctx.strokeStyle = '#3465a4'; ctx.lineWidth = 1.5; ctx.stroke();
      poly.forEach((p, i) => { const [x, y] = toPx(p); ctx.fillStyle = i === sel ? '#e9322d' : '#3465a4'; ctx.fillRect(x - 3, y - 3, 6, 6); });
    }
  });
  const change = (next: [number, number][]) => { setUndo((u) => [...u, poly]); setPoly(next); };
  const at = (e: React.MouseEvent) => { const r = canvas.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const pointAt = (px: number, py: number) => poly.findIndex((p) => { const [x, y] = toPx(p); return Math.abs(x - px) <= 5 && Math.abs(y - py) <= 5; });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = c.sh.GetFlyFrameFormat()!;
    const s = f.m_aSurround;
    c.sh.SetFlyFrameAttr({
      m_aContour: poly.length > 2 ? [poly] : undefined, m_bAutoContour: false,
      m_aSurround: { ...s, m_bContour: true, m_eSurround: s.m_eSurround === WrapTextMode.NONE ? WrapTextMode.PARALLEL : s.m_eSurround },
    });
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('contour.title')} wide>
      <form method="dialog" onSubmit={submit} className="contour-dialog">
        <div role="toolbar" aria-label={t('contour.tools')} className="contour-tools">
          <button type="button" disabled={!raw} onClick={() => { if (raw) change(CreateAutoContour(raw)[0] ?? []); }}>{t('contour.auto')}</button>
          <button type="button" onClick={() => change([])}>{t('contour.clear')}</button>
          <button type="button" disabled={sel === null} onClick={() => { if (sel !== null) { change(poly.filter((_, i) => i !== sel)); setSel(null); } }}>{t('contour.delete')}</button>
          <button type="button" disabled={!undo.length} onClick={() => { setPoly(undo.at(-1)!); setUndo(undo.slice(0, -1)); }}>{t('contour.undo')}</button>
        </div>
        <canvas ref={canvas} className="contour-canvas" style={{ width: W, height: H }} aria-label={t('contour.title')} tabIndex={0}
          onMouseDown={(e) => { const [px, py] = at(e); const i = pointAt(px, py); setSel(i >= 0 ? i : null); if (i >= 0) { drag.current = i; setUndo((u) => [...u, poly]); } }}
          onMouseMove={(e) => { if (drag.current === null) return; const [px, py] = at(e); const i = drag.current; setPoly((p) => p.map((q, k) => (k === i ? fromPx(px, py) : q))); }}
          onMouseUp={() => { drag.current = null; }}
          onDoubleClick={(e) => {
            // Insert a point on the nearest edge.
            const [px, py] = at(e);
            if (poly.length < 2) { change([...poly, fromPx(px, py)]); return; }
            let best = 0, bestD = Infinity;
            for (let i = 0; i < poly.length; i++) {
              const [ax, ay] = toPx(poly[i]!), [bx, by] = toPx(poly[(i + 1) % poly.length]!);
              const l2 = (bx - ax) ** 2 + (by - ay) ** 2, tt = l2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2)) : 0;
              const d = (ax + tt * (bx - ax) - px) ** 2 + (ay + tt * (by - ay) - py) ** 2;
              if (d < bestD) { bestD = d; best = i; }
            }
            change([...poly.slice(0, best + 1), fromPx(px, py), ...poly.slice(best + 1)]);
          }}
          onKeyDown={(e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null) { e.preventDefault(); change(poly.filter((_, i) => i !== sel)); setSel(null); } }} />
        <p className="muted">{t('contour.hint')}</p>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** Table > Size > Row Height (sw rowheight.ui, SwTableHeightDlg): the height, or the minimum ("Fit to size"). */
function RowHeight({ c }: { c: Controller }) {
  const cur = c.sh.GetRowHeight() ?? { height: 0, fix: false };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.sh.SetRowHeight(fromCm(String(f.get('h'))), !f.get('fit'));
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('table.rowHeight')}>
      <form method="dialog" onSubmit={submit}>
        <Field label={t('table.height')}><input name="h" type="number" min={0} max={55} step={0.01} defaultValue={toCm(cur.height || 0)} autoFocus /></Field>
        <label className="check"><input type="checkbox" name="fit" defaultChecked={!cur.fix} /> {t('table.fitToSize')}</label>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** Table > Size > Column Width (sw columnwidth.ui, SwTableWidthDlg): one column's width. */
function ColWidth({ c }: { c: Controller }) {
  const widths = c.sh.GetColWidths();
  const [col, setCol] = useState(c.sh.GetCurTabColNum() + 1);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.sh.SetColWidth(Math.max(0, Math.min(widths.length - 1, col - 1)), Math.max(23, fromCm(String(f.get('w')))));
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('table.colWidth')}>
      <form method="dialog" onSubmit={submit}>
        <Field label={t('table.column')}><input name="col" type="number" min={1} max={widths.length} value={col} onChange={(e) => setCol(Math.max(1, Math.min(widths.length, Number(e.target.value) || 1)))} /></Field>
        <Field label={t('table.width')}><input key={col} name="w" type="number" min={0.04} step={0.01} defaultValue={toCm(widths[col - 1] ?? 0)} autoFocus /></Field>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * Table > Properties (SwTableTabDlg), reduced to its Table, Text Flow, Columns, Borders and
 * Background pages without the break, text direction and border shadow and padding settings.
 */
function TableProperties({ c }: { c: Controller }) {
  const sh = c.sh, t0 = sh.GetTableNode()!, table = t0.m_pTable, a = table.m_aAttrs;
  const cols = useMemo(() => sh.GetTabCols(), [sh]);
  const widths = useMemo(() => sh.GetColWidths(), [sh]);
  const [page, setPage] = useState('table');
  const [adjust, setAdjust] = useState(a.adjust);
  const [repeat, setRepeat] = useState(table.GetRowsToRepeat() > 0);
  const total = cols?.right ?? 0;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cm = (k: string) => Math.max(0, fromCm(String(f.get(k) ?? '0')));
    const n = sh.StartUndo();
    // SwTableTabDlg's Table page (SwFormatTablePage::FillItemSet)
    const name = String(f.get('name') ?? '').trim();
    const nameOk = !!name && (name === a.name || ![...Array(sh.m_pDoc.GetNodes().Count()).keys()].some((i) => { const nd = sh.m_pDoc.GetNodes().node(i); return nd.IsTableNode() && (nd as typeof t0).m_pTable.m_aAttrs.name === name; }));
    sh.m_pDoc.SetTableAttr(sh.m_pCursor, (tab) => {
      tab.m_aAttrs = {
        ...tab.m_aAttrs, name: nameOk ? name : tab.m_aAttrs.name, adjust,
        width: adjust === 'full' ? tab.m_aAttrs.width : cm('width') || total,
        leftSpace: adjust === 'left' || adjust === 'none' ? cm('left') : 0, rightSpace: adjust === 'right' || adjust === 'none' ? cm('right') || undefined : undefined,
        upper: cm('above'), lower: cm('below'),
        // Text Flow page
        dontSplit: f.get('split') ? undefined : true, keepWithNext: f.get('keep') ? true : undefined,
      };
      tab.m_nRowsToRepeat = repeat ? Math.max(1, Math.min(tab.m_aLines.length, parseInt(String(f.get('rows')), 10) || 1)) : 0;
      // Allow row to break across pages: every row.
      for (const l of tab.m_aLines) l.m_aAttrs = { ...l.m_aAttrs, cantSplit: f.get('rowsplit') ? undefined : true };
    });
    const va = String(f.get('valign'));
    if (va === 'top' || va === 'center' || va === 'bottom') sh.SetBoxAlign(va);
    // Columns page: new widths; "Adapt table width" lets the table grow or shrink.
    if (cols && widths.length) {
      const nw = widths.map((w, i) => Math.max(23, fromCm(String(f.get(`col${i}`) ?? toCm(w)))));
      if (nw.some((w, i) => Math.abs(w - widths[i]!) > 5)) {
        const cur = sh.GetTabCols()!;
        if (!f.get('adapt')) { const rest = cur.right - nw.slice(0, -1).reduce((x, y) => x + y, 0); nw[nw.length - 1] = Math.max(23, rest); }
        let x = 0;
        const borders = nw.slice(0, -1).map((w) => (x += w));
        sh.SetTabCols(cur, { ...cur, cols: borders, right: nw.reduce((p, q) => p + q, 0) });
      }
    }
    // Borders page (SetTabBorders on the selection or the whole table)
    const preset = String(f.get('borders'));
    if (preset !== 'keep') {
      const line = preset === 'none' ? null : { color: String(f.get('bcolor')), width: Math.max(1, Math.round(parseFloat(String(f.get('bwidth'))) * 20) || 10) };
      const inner = preset === 'all' ? line : preset === 'outerhori' ? undefined : null;
      sh.SetTabBorders({ left: line, right: line, top: line, bottom: line, hori: preset === 'outerhori' ? line : inner, vert: inner });
    }
    // Background page: the cells' colour
    const bg = String(f.get('bg'));
    if (bg !== 'keep') sh.SetBoxBackground(bg === 'none' ? null : String(f.get('bgcolor')));
    sh.EndUndo(n);
    c.setDialog(null);
    c.notify();
  };
  const pages = ['table', 'flow', 'columns', 'borders', 'background'];
  const labels = { table: t('tableprops.table'), flow: t('tableprops.flow'), columns: t('tableprops.columns'), borders: t('tableprops.borders'), background: t('tableprops.background') };
  const sec = (id: string, children: ReactNode) => <section role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={page !== id}>{children}</section>;
  return (
    <Modal c={c} title={t('tableprops.title')} wide>
      <form method="dialog" onSubmit={submit}>
        <Tabs ids={pages} labels={labels} current={page} onChange={setPage} label={t('tableprops.title')} />
        {sec('table', <>
          <Field label={t('tableprops.name')}><input name="name" defaultValue={a.name} /></Field>
          <Field label={t('table.width')}><input name="width" type="number" min={0} step={0.01} disabled={adjust === 'full'} defaultValue={toCm(total)} /></Field>
          <fieldset><legend>{t('tableprops.alignment')}</legend>
            {(['full', 'left', 'right', 'center', 'none'] as const).map((k) => (
              <label key={k} className="check"><input type="radio" name="adjust" value={k} checked={adjust === k} onChange={() => setAdjust(k)} /> {t(`tableprops.adjust.${k}`)}</label>
            ))}
          </fieldset>
          <fieldset><legend>{t('tableprops.spacing')}</legend>
            <Field label={t('tableprops.left')}><input name="left" type="number" min={0} step={0.01} disabled={adjust !== 'left' && adjust !== 'none'} defaultValue={toCm(a.leftSpace)} /></Field>
            <Field label={t('tableprops.right')}><input name="right" type="number" min={0} step={0.01} disabled={adjust !== 'right' && adjust !== 'none'} defaultValue={toCm(a.rightSpace ?? 0)} /></Field>
            <Field label={t('tableprops.above')}><input name="above" type="number" min={0} step={0.01} defaultValue={toCm(a.upper)} /></Field>
            <Field label={t('tableprops.below')}><input name="below" type="number" min={0} step={0.01} defaultValue={toCm(a.lower)} /></Field>
          </fieldset>
        </>)}
        {sec('flow', <>
          <label className="check"><input type="checkbox" name="split" defaultChecked={!a.dontSplit} /> {t('tableprops.allowSplit')}</label>
          <label className="check"><input type="checkbox" name="rowsplit" defaultChecked={!table.m_aLines.some((l) => l.m_aAttrs.cantSplit)} /> {t('tableprops.allowRowSplit')}</label>
          <label className="check"><input type="checkbox" name="keep" defaultChecked={!!a.keepWithNext} /> {t('tableprops.keep')}</label>
          <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> {t('tableprops.repeat')}</label>
          <Field label={t('tableprops.repeatRows')}><input name="rows" type="number" min={1} max={table.m_aLines.length} disabled={!repeat} defaultValue={Math.max(1, table.GetRowsToRepeat())} /></Field>
          <Field label={t('tableprops.valign')}>
            <select name="valign" defaultValue="keep">
              <option value="keep">—</option>
              <option value="top">{t('tableprops.valign.top')}</option>
              <option value="center">{t('tableprops.valign.center')}</option>
              <option value="bottom">{t('tableprops.valign.bottom')}</option>
            </select>
          </Field>
        </>)}
        {sec('columns', <>
          <label className="check"><input type="checkbox" name="adapt" /> {t('tableprops.adapt')}</label>
          <div className="col-widths">
            {widths.map((w, i) => <Field key={i} label={t('tableprops.colN', { n: i + 1 })}><input name={`col${i}`} type="number" min={0.04} step={0.01} defaultValue={toCm(w)} /></Field>)}
          </div>
        </>)}
        {sec('borders', <>
          <Field label={t('tableprops.arrangement')}>
            <select name="borders" defaultValue="keep">
              {(['keep', 'none', 'outer', 'outerhori', 'all'] as const).map((k) => <option key={k} value={k}>{t(`tableprops.borders.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('tableprops.lineWidth')}><input name="bwidth" type="number" min={0.05} max={9} step={0.05} defaultValue={0.5} /></Field>
          <Field label={t('tableprops.lineColor')}><input name="bcolor" type="color" defaultValue="#000000" /></Field>
        </>)}
        {sec('background', <>
          <Field label={t('tableprops.cellBackground')}>
            <select name="bg" defaultValue="keep">
              <option value="keep">—</option>
              <option value="none">{t('tableprops.bg.none')}</option>
              <option value="color">{t('tableprops.bg.color')}</option>
            </select>
          </Field>
          <Field label={t('tableprops.lineColor')}><input name="bgcolor" type="color" defaultValue={sh.GetBoxBackground() ?? '#ffffcc'} /></Field>
        </>)}
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** The styles the AutoFormat dialog offers: the Default Table Style and those of autotbl.fmt. */
const tableStyles = (): SwTableAutoFormat[] => [DefaultTableStyle(POOL_DEFAULTS.RES_CHRATR_FONT, t('autoformat.default')), ...(tableAutoFormats as SwTableAutoFormat[])];

/** SwAutoFormatDlg's preview (AutoFormatPreview), reduced: a 5 × 5 grid with the style's backgrounds, borders and text weight. */
function AutoFormatPreview({ f, opts }: { f: SwTableAutoFormat; opts: Record<string, boolean> }) {
  const cells = ['', 'Jan', 'Feb', 'Mar', t('autoformat.sum'), 'North', '6', '7', '8', '21', 'Mid', '11', '12', '13', '36', 'South', '16', '17', '18', '51', t('autoformat.sum'), '33', '36', '39', '108'];
  const line = (b: SvxBorderLine | null) => (b ? `${Math.max(1, Math.round(b.width / 15))}px solid ${b.color}` : '1px solid transparent');
  return (
    <div className="autoformat-preview" aria-hidden>
      {cells.map((text, i) => {
        const r = Math.trunc(i / 5), c = i % 5;
        const p = f.m_aBoxAutoFormat[AutoFormatPos(r, 5, c, 5)]!;
        return (
          <span key={i} style={{
            background: opts.pattern ? p.background ?? 'transparent' : 'transparent', fontWeight: opts.font && p.weight ? 700 : 400, fontStyle: opts.font && p.posture ? 'italic' : 'normal',
            color: opts.font && p.color ? p.color : 'inherit', textAlign: opts.align ? (p.adjust === 'right' ? 'right' : p.adjust === 'center' ? 'center' : 'left') : 'left',
            borderTop: opts.border ? line(p.box.top) : undefined, borderLeft: opts.border ? line(p.box.left) : undefined, borderRight: opts.border ? line(p.box.right) : undefined, borderBottom: opts.border ? line(p.box.bottom) : undefined,
          }}>{text}</span>
        );
      })}
    </div>
  );
}

/** Table > AutoFormat Styles (sw autoformattable.ui, SwAutoFormatDlg); adding, deleting and renaming styles are not ported. */
function AutoFormat({ c }: { c: Controller }) {
  const styles = useMemo(tableStyles, []);
  const cur = c.sh.GetTableNode()?.m_pTable.m_aAttrs.styleName;
  const [idx, setIdx] = useState(Math.max(0, styles.findIndex((x) => x.m_aName === cur)));
  const f = styles[idx]!;
  const [opts, setOpts] = useState({ border: f.m_bInclFrame, font: f.m_bInclFont, pattern: f.m_bInclBackground, align: f.m_bInclJustify });
  const choose = (i: number) => { setIdx(i); const g = styles[i]!; setOpts({ border: g.m_bInclFrame, font: g.m_bInclFont, pattern: g.m_bInclBackground, align: g.m_bInclJustify }); };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    c.sh.SetTableStyle({ ...f, m_bInclFrame: opts.border, m_bInclFont: opts.font, m_bInclBackground: opts.pattern, m_bInclJustify: opts.align });
    c.setDialog(null);
    c.notify();
  };
  const check = (k: keyof typeof opts, label: string) => <label className="check"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {label}</label>;
  return (
    <Modal c={c} title={t('autoformat.title')} wide>
      <form method="dialog" onSubmit={submit}>
        <div className="autoformat">
          <select size={11} aria-label={t('autoformat.format')} value={idx} onChange={(e) => choose(Number(e.target.value))}>
            {styles.map((x, i) => <option key={x.m_aName} value={i}>{x.m_aName}</option>)}
          </select>
          <AutoFormatPreview f={f} opts={opts} />
        </div>
        <fieldset><legend>{t('autoformat.formatting')}</legend>
          {check('border', t('autoformat.borders'))}{check('font', t('autoformat.font'))}{check('pattern', t('autoformat.pattern'))}{check('align', t('autoformat.alignment'))}
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** The separator choice of the conversion dialogs (sw converttexttable.ui). */
function SeparatorFields({ para = true }: { para?: boolean }) {
  return (
    <fieldset><legend>{t('convert.separate')}</legend>
      <label className="check"><input type="radio" name="sep" value="tabs" defaultChecked /> {t('convert.tabs')}</label>
      <label className="check"><input type="radio" name="sep" value="semicolons" /> {t('convert.semicolons')}</label>
      {para && <label className="check"><input type="radio" name="sep" value="paragraph" /> {t('convert.paragraph')}</label>}
      <label className="check"><input type="radio" name="sep" value="other" /> {t('convert.other')} <input name="othered" defaultValue="," maxLength={1} size={2} aria-label={t('convert.other')} /></label>
    </fieldset>
  );
}
const separatorOf = (f: FormData): string => {
  switch (String(f.get('sep'))) {
    case 'semicolons': return ';';
    case 'paragraph': return T2T_PARA;
    case 'other': return String(f.get('othered') || ',').slice(0, 1) || ',';
    default: return '\t';
  }
};

/** Table > Convert > Text to Table (SwConvertTableDlg for text). */
function TextToTableDialog({ c }: { c: Controller }) {
  const [repeat, setRepeat] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const heading = !!f.get('heading');
    c.sh.TextToTable(separatorOf(f), { repeat: heading && repeat ? Math.max(1, parseInt(String(f.get('rows')), 10) || 1) : 0, dontSplit: !!f.get('dontsplit'), borders: true });
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('convert.textToTable')}>
      <form method="dialog" onSubmit={submit}>
        <SeparatorFields />
        <fieldset><legend>{t('convert.options')}</legend>
          <label className="check"><input type="checkbox" name="heading" /> {t('convert.heading')}</label>
          <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> {t('tableprops.repeat')}</label>
          <Field label={t('tableprops.repeatRows')}><input name="rows" type="number" min={1} defaultValue={1} disabled={!repeat} /></Field>
          <label className="check"><input type="checkbox" name="dontsplit" /> {t('convert.dontSplit')}</label>
        </fieldset>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** Table > Convert > Table to Text (SwConvertTableDlg for a table). */
function TableToTextDialog({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!c.sh.TableToText(separatorOf(new FormData(e.currentTarget)))) c.setMessage(t('convert.nested'));
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('convert.tableToText')}>
      <form method="dialog" onSubmit={submit}>
        <SeparatorFields />
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** Table > Sort (sw sortdialog.ui, SwSortDlg) for a table selection; the language list is the document's. */
function TableSortDialog({ c }: { c: Controller }) {
  const cols = Math.max(1, ...c.sh.GetTableSelBoxes().reduce((m, b) => m.set(b.m_pUpper, (m.get(b.m_pUpper) ?? 0) + 1), new Map<unknown, number>()).values());
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const aKeys = [1, 2, 3].filter((k) => f.get(`key${k}`)).map((k) => ({
      nColumnId: Math.max(1, parseInt(String(f.get(`col${k}`)), 10) || 1), bIsNumeric: f.get(`type${k}`) === 'num', eSortOrder: f.get(`order${k}`) === 'down' ? SwSortOrder.Descending : SwSortOrder.Ascending,
    }));
    const ok = c.sh.SortTable({ aKeys, eDirection: f.get('dir') === 'cols' ? SwSortDirection.Columns : SwSortDirection.Rows, bIgnoreCase: !f.get('case'), nLanguage: c.sh.GetAttr('RES_CHRATR_LANGUAGE') });
    if (!ok) c.setMessage(t('sort.notPossible'));
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('sort.title')} wide>
      <form method="dialog" onSubmit={submit}>
        <fieldset><legend>{t('sort.criteria')}</legend>
          {[1, 2, 3].map((k) => (
            <div key={k} className="sort-key">
              <label className="check"><input type="checkbox" name={`key${k}`} defaultChecked={k === 1} /> {t('sort.key', { n: k })}</label>
              <Field label={t('sort.column')}><input name={`col${k}`} type="number" min={1} max={cols} defaultValue={Math.min(k, cols)} /></Field>
              <Field label={t('sort.keyType')}><select name={`type${k}`} defaultValue="alpha"><option value="alpha">{t('sort.alphanumeric')}</option><option value="num">{t('sort.numeric')}</option></select></Field>
              <label className="check"><input type="radio" name={`order${k}`} value="up" defaultChecked /> {t('sort.ascending')}</label>
              <label className="check"><input type="radio" name={`order${k}`} value="down" /> {t('sort.descending')}</label>
            </div>
          ))}
        </fieldset>
        <fieldset><legend>{t('sort.direction')}</legend>
          <label className="check"><input type="radio" name="dir" value="rows" defaultChecked /> {t('sort.rows')}</label>
          <label className="check"><input type="radio" name="dir" value="cols" /> {t('sort.columns')}</label>
        </fieldset>
        <label className="check"><input type="checkbox" name="case" /> {t('sort.matchCase')}</label>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * Table > Number Format (cui numberingformatpage.ui, SvxNumberFormatTabPage), reduced: the
 * category, its built-in formats, the options that make a code (decimal places, leading zeros,
 * negative numbers red, thousands separator), the code and a preview of the cell's value.
 */
function NumberFormatDialog({ c }: { c: Controller }) {
  const lang = c.sh.GetAttr('RES_CHRATR_LANGUAGE') || 'en-US';
  const formats = useMemo(() => GetBuiltInFormats(lang), [lang]);
  const cats = Object.keys(formats) as (keyof typeof formats)[];
  const [code, setCode] = useState(c.sh.GetBoxNumFormat() ?? 'General');
  const catOf = (k: string) => cats.find((x) => formats[x].includes(k)) ?? ({ [SvNumFormatType.PERCENT]: 'PERCENT', [SvNumFormatType.CURRENCY]: 'CURRENCY', [SvNumFormatType.DATE]: 'DATE', [SvNumFormatType.TIME]: 'TIME', [SvNumFormatType.DATETIME]: 'DATE', [SvNumFormatType.SCIENTIFIC]: 'SCIENTIFIC', [SvNumFormatType.TEXT]: 'TEXT' } as Record<number, keyof typeof formats>)[GetType(k, lang)] ?? 'NUMBER';
  const [cat, setCat] = useState<keyof typeof formats>(catOf(code));
  const info = GetFormatSpecialInfo(code, lang);
  const value = c.sh.GetBoxValue() ?? (cat === 'DATE' || cat === 'TIME' ? 45605.5 : -1234.56789);
  let preview: { text: string; color: string | null };
  try { preview = GetOutputString(value, code, lang); } catch { preview = { text: '', color: null }; }
  const options = (cat === 'NUMBER' || cat === 'PERCENT' || cat === 'CURRENCY' || cat === 'SCIENTIFIC');
  const regen = (o: Partial<typeof info>) => { const n = { ...info, ...o }; setCode(GenerateFormat(code === 'General' ? '0' : code, lang, n.bThousand, n.bNegRed, n.nPrecision, n.nLeadingZeros)); };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    c.sh.SetTableBoxFormulaAttrs({ numFormat: code });
    c.setDialog(null);
    c.notify();
  };
  return (
    <Modal c={c} title={t('numformat.title')} wide>
      <form method="dialog" onSubmit={submit}>
        <div className="numformat">
          <Field label={t('numformat.category')}>
            <select size={8} value={cat} onChange={(e) => { const k = e.target.value as keyof typeof formats; setCat(k); setCode(formats[k][0]!); }}>
              {cats.map((k) => <option key={k} value={k}>{t(`numformat.cat.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('numformat.format')}>
            <select size={8} value={formats[cat].includes(code) ? code : ''} onChange={(e) => setCode(e.target.value)}>
              {formats[cat].map((k) => { let shown = k; try { shown = GetOutputString(value, k, lang).text; } catch { /* keep the code */ } return <option key={k} value={k}>{shown}</option>; })}
            </select>
          </Field>
          {options && <>
            <Field label={t('numformat.decimals')}><input type="number" min={0} max={20} value={info.nPrecision} onChange={(e) => regen({ nPrecision: Math.max(0, Number(e.target.value) || 0) })} /></Field>
            <Field label={t('numformat.leadingZeros')}><input type="number" min={0} max={20} value={info.nLeadingZeros} onChange={(e) => regen({ nLeadingZeros: Math.max(0, Number(e.target.value) || 0) })} /></Field>
            <label className="check"><input type="checkbox" checked={info.bNegRed} onChange={(e) => regen({ bNegRed: e.target.checked })} /> {t('numformat.negRed')}</label>
            <label className="check"><input type="checkbox" checked={info.bThousand} onChange={(e) => regen({ bThousand: e.target.checked })} /> {t('numformat.thousands')}</label>
          </>}
          <Field label={t('numformat.code')}><input value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} /></Field>
          <div className="preview" aria-label={t('numformat.preview')} style={{ color: preview.color ?? undefined }}>{preview.text}</div>
        </div>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/** The file types the shell writes, for Download As. */
function FormatSelect({ format = 'odt', onChange }: { format?: string; onChange?: (format: FileFormat) => void }) {
  return (
    <select name="format" defaultValue={format} onChange={onChange && ((e) => onChange(e.currentTarget.value as FileFormat))}>
      <option value="odt">ODF Text Document (.odt)</option>
      <option value="ott">ODF Text Document Template (.ott)</option>
      <option value="docx">Word Document (.docx)</option>
      <option value="txt">Text (.txt)</option>
      <option value="md">Markdown (.md)</option>
      <option value="html">HTML Document (.html)</option>
    </select>
  );
}

/**
 * File > Download As (.uno:ExportTo): a copy of the document, in a chosen format, in the browser's
 * downloads. For an ODT or OTT of a document with versions, "Include version history" (on by
 * default) chooses whether the file carries them.
 */
function Download({ c }: { c: Controller }) {
  const [format, setFormat] = useState<FileFormat>(c.fileFormat());
  const n = c.versions.length;
  const carriesVersions = n > 0 && (format === 'odt' || format === 'ott');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.setDialog(null);
    void c.download(String(f.get('name') ?? '').trim() || c.name, String(f.get('format')) as FileFormat, !carriesVersions || f.get('versions') === 'on');
  };
  return (
    <Modal c={c} title={t('download.title')}>
      <form onSubmit={submit}>
        <Field label={t('download.name')}><input name="name" defaultValue={c.name} autoFocus /></Field>
        <Field label={t('download.format')}><FormatSelect format={c.fileFormat()} onChange={setFormat} /></Field>
        {carriesVersions && <label className="check"><input type="checkbox" name="versions" defaultChecked /> {t(n === 1 ? 'download.versions1' : 'download.versions', { n })}</label>}
        <Actions c={c} ok={t('download.ok')} />
      </form>
    </Modal>
  );
}

/** The web shell's File > Create Copy: the name of the copy stored in the browser. */
function CreateCopy({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    c.setDialog(null);
    void c.createCopy(name);
  };
  return (
    <Modal c={c} title={t('createcopy.title')}>
      <form onSubmit={submit}>
        <Field label={t('createcopy.name')}><input name="name" required defaultValue={t('createcopy.default', { name: c.name })} autoFocus onFocus={(e) => e.currentTarget.select()} /></Field>
        <Actions c={c} ok={t('createcopy.ok')} />
      </form>
    </Modal>
  );
}

/**
 * cui/uiconfig/ui/spellingdialog.ui, reduced: the next unknown word or grammar error, its
 * suggestions and what to do (SpellDialog's grammar mode shows the error's comment).
 */
function Spelling({ c }: { c: Controller }) {
  const sh = c.sh;
  const [wrong, setWrong] = useState(() => sh.SpellContinue());
  const [pick, setPick] = useState(0);
  const sugg = useMemo(() => (wrong ? (wrong.pError ? wrong.pError.aSuggestions : c.spell.getSuggestions(wrong.word, wrong.lang)) : []), [wrong]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { setPick(0); setWrong(sh.SpellContinue()); c.notify(); };
  const node = () => sh.m_pCursor.Start().GetNode();
  const change = (text: string) => { if (!wrong) return; sh.ReplaceWord(node(), wrong.nStart, wrong.nEnd, text); next(); };
  const grammar = !!wrong && IsGrammarArea(wrong);
  if (!c.spell.GetLocales().length && !c.grammar) {
    return <Modal c={c} title={t('spell.title')}><p className="muted">{t('spell.noDictionary')}</p><footer><button type="button" className="primary" onClick={() => c.setDialog(null)}>{t('spell.close')}</button></footer></Modal>;
  }
  return (
    <Modal c={c} title={t('spell.title')}>
      <div className="spelling">
        {wrong ? <>
          {grammar
            ? <p>{wrong.pError!.aShortComment} <span className="word grammar">{wrong.word}</span></p>
            : <p>{t('spell.notInDictionary', { lang: languageName(wrong.lang) })} <span className="word">{wrong.word}</span></p>}
          <ul aria-label={t('spell.suggestions')}>{sugg.length ? sugg.map((s, i) => <li key={s}><button type="button" className={i === pick ? 'on' : undefined} onClick={() => setPick(i)} onDoubleClick={() => change(s)}>{s}</button></li>) : <li className="muted">{t('spell.noSuggestions')}</li>}</ul>
          <footer>
            <button type="button" onClick={() => { if (grammar) c.grammar?.IgnoreGrammarErrorAt(ProofreadingText(node()), wrong.pError!); next(); }}>{t('spell.ignoreOnce')}</button>
            <button type="button" onClick={() => { if (grammar) c.grammar?.ignoreRule(wrong.pError!.aRuleIdentifier); else c.spell.IgnoreAll(wrong.word); next(); }}>{grammar ? t('spell.ignoreRule') : t('spell.ignoreAll')}</button>
            {!grammar && <button type="button" onClick={() => { c.addToDictionary(wrong.word); next(); }}>{t('spell.addToDictionary')}</button>}
            <button type="button" disabled={!sugg.length} className="primary" onClick={() => change(sugg[pick]!)}>{t('spell.correct')}</button>
            <button type="button" onClick={() => c.setDialog(null)}>{t('spell.close')}</button>
          </footer>
        </> : <>
          <p>{t('spell.complete')}</p>
          <footer><button type="button" className="primary" onClick={() => c.setDialog(null)}>{t('spell.close')}</button></footer>
        </>}
      </div>
    </Modal>
  );
}

/** The options of the Options and Localized Options pages: a label, the [M] flag and the [T] flag. */
type AcorRow = { label: string; m?: SvxSwAutoFormatFlag; t?: SvxSwAutoFormatFlag | number };

/** A one-character field with its code point, as the Special Characters dialog would choose it. */
function CharField({ value, onChange, label, allowEmpty }: { value: string; onChange: (v: string) => void; label: string; allowEmpty?: boolean }) {
  const cp = value ? `U+${value.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : t('autocorr.default');
  return (
    <span className="acor-char">
      <input aria-label={label} value={value} maxLength={2} onChange={(e) => { const v = [...e.target.value].pop() ?? ''; if (v || allowEmpty) onChange(v); }} />
      <span className="muted">{cp}</span>
    </span>
  );
}

/**
 * Tools > AutoCorrect > AutoCorrect Options (OfaAutoCorrDlg with Writer's pages): the replacement
 * table and the exception lists of a language, the options while typing [T] and when applied [M],
 * the localized options with the quotation marks, and word completion. Smart Tags are left out, as
 * upstream does without smart tag extensions.
 */
function AutoCorrectDialog({ c }: { c: Controller }) {
  const a = c.acorr;
  const docLang = c.sh.GetAttr('RES_CHRATR_LANGUAGE');
  const [page, setPage] = useState(() => { try { return sessionStorage.getItem('writer:autocorrpage') ?? 'replace'; } catch { return 'replace'; } });
  const choose = (p: string) => { setPage(p); try { sessionStorage.setItem('writer:autocorrpage', p); } catch { /* storage unavailable */ } };
  const [lang, setLang] = useState(() => listLanguage(docLang) ?? LANGUAGE_UNDETERMINED);
  /** Each language's lists as edited here (OfaAutocorrReplacePage's aChangesTable and the except page's lists). */
  const [lists, setLists] = useState<Record<string, SvxAutoCorrLangData>>({});
  const originals = useRef<Record<string, SvxAutoCorrLangData>>({});
  const init = () => ({
    flags: a.GetFlags(), sw: a.GetSwFlags().Clone(),
    quotes: [a.GetStartSingleQuote(), a.GetEndSingleQuote(), a.GetStartDoubleQuote(), a.GetEndDoubleQuote()],
    words: autoCompleteWords.GetWordList(),
  });
  const [st, setSt] = useState(init);
  const [short, setShort] = useState('');
  const [long, setLong] = useState('');
  const [abbrev, setAbbrev] = useState('');
  const [double, setDouble] = useState('');
  const [selWords, setSelWords] = useState<string[]>([]);
  const [selAbbrev, setSelAbbrev] = useState<string[]>([]);
  const [selDouble, setSelDouble] = useState<string[]>([]);

  // The lists of the chosen language, once loaded.
  useEffect(() => {
    if (lists[lang]) return;
    let live = true;
    void ensureLists(lang).then(() => {
      if (!live) return;
      const l = a.GetLanguageList_(lang);
      const data: SvxAutoCorrLangData = l
        ? { replace: l.GetAutocorrWordList().getSortedContent().map((w) => [w.GetShort(), w.GetLong()]), sentence: [...l.GetCplSttExceptList().m_aList], word: [...l.GetWordStartExceptList().m_aList] }
        : { replace: [], sentence: [], word: [] };
      originals.current[lang] = data;
      setLists((x) => ({ ...x, [lang]: structuredClone(data) }));
    });
    return () => { live = false; };
  }, [lang, lists, a]);
  const cur = lists[lang];
  const setCur = (f: (d: SvxAutoCorrLangData) => SvxAutoCorrLangData) => setLists((x) => ({ ...x, [lang]: f(x[lang]!) }));

  const ac = (n: number) => !!(st.flags & n);
  const setAc = (n: number, on: boolean) => setSt((s) => ({ ...s, flags: on ? s.flags | n : s.flags & ~n }));
  const setSw = (k: SvxSwAutoFormatFlag, on: boolean) => setSt((s) => { const sw = s.sw.Clone(); sw[k] = on; return { ...s, sw }; });
  const setSwVal = (f: (sw: SvxSwAutoFormatFlags) => void) => setSt((s) => { const sw = s.sw.Clone(); f(sw); return { ...s, sw }; });
  const get = (k: SvxSwAutoFormatFlag | number) => (typeof k === 'number' ? ac(k) : st.sw[k]);
  const set = (k: SvxSwAutoFormatFlag | number, on: boolean) => (typeof k === 'number' ? setAc(k, on) : setSw(k, on));

  // OfaAutocorrReplacePage: New, Replace and Delete.
  const found = cur?.replace.findIndex(([s]) => s === short) ?? -1;
  const canNew = !!short && !!cur && (found < 0 || cur.replace[found]![1] !== long);
  const newEntry = () => {
    if (!canNew) return;
    setCur((d) => {
      const replace = d.replace.filter(([s]) => s !== short);
      replace.push([short, long]);
      replace.sort(([x], [y]) => x.localeCompare(y));
      return { ...d, replace };
    });
  };
  const deleteEntry = () => { setCur((d) => ({ ...d, replace: d.replace.filter(([s]) => s !== short) })); setShort(''); setLong(''); };
  const shownReplace = useMemo(() => {
    const low = short.toLowerCase();
    return (cur?.replace ?? []).filter(([s]) => !low || s.toLowerCase().startsWith(low));
  }, [cur, short]);

  // OfaAutocorrExceptPage
  const addExcept = (k: 'sentence' | 'word', v: string) => {
    if (!v) return;
    setCur((d) => (d[k].some((x) => x.toLowerCase() === v.toLowerCase()) ? d : { ...d, [k]: [...d[k], v].sort((x, y) => x.localeCompare(y)) }));
  };
  const delExcept = (k: 'sentence' | 'word', sel: string[]) => setCur((d) => ({ ...d, [k]: d[k].filter((x) => !sel.includes(x)) }));

  const reset = () => { setSt(init()); setLists(structuredClone(originals.current)); setShort(''); setLong(''); };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // OfaAutocorrOptionsPage::FillItemSet and friends
    a.nFlags = (a.GetFlags() & ~0x1ffff) | (st.flags & 0x1ffff);
    a.aSwFlags = st.sw;
    const [sS = '', eS = '', sD = '', eD = ''] = st.quotes;
    a.SetStartSingleQuote(sS); a.SetEndSingleQuote(eS); a.SetStartDoubleQuote(sD); a.SetEndDoubleQuote(eD);
    // OfaAutocorrReplacePage::FillItemSet: the changes of each language in one pass.
    for (const [l, d] of Object.entries(lists)) {
      const o = originals.current[l];
      const ll = a.GetLanguageList_(l);
      if (!o || !ll) continue;
      const before = new Map(o.replace), after = new Map(d.replace);
      const aDelete = [...before.keys()].filter((s) => !after.has(s)).map((s) => new SvxAutocorrWord(s, ''));
      const aNew = [...after].filter(([s, v]) => before.get(s) !== v).map(([s, v]) => new SvxAutocorrWord(s, v));
      if (aDelete.length || aNew.length) a.MakeCombinedChanges(aNew, aDelete, l);
      if (JSON.stringify(o.sentence) !== JSON.stringify(d.sentence) || JSON.stringify(o.word) !== JSON.stringify(d.word)) ll.SetExceptLists(d.sentence, d.word);
    }
    // OfaAutoCompleteTabPage::FillItemSet
    if (st.words.length !== autoCompleteWords.GetWordList().length) autoCompleteWords.CheckChangedList(st.words);
    SvxAutoCorrCfg.Get().SetModified();
    c.setDialog(null);
    c.notify();
  };

  const AF = ACFlags;
  const optionRows: AcorRow[] = [
    { label: t('autocorr.useReplace'), m: 'bAutoCorrect', t: AF.Autocorrect },
    { label: t('autocorr.cptlSttWord'), m: 'bCapitalStartWord', t: AF.CapitalStartWord },
    { label: t('autocorr.cptlSttSent'), m: 'bCapitalStartSentence', t: AF.CapitalStartSentence },
    { label: t('autocorr.boldUnder'), m: 'bChgWeightUnderl', t: AF.ChgWeightUnderl },
    { label: t('autocorr.detectUrl'), m: 'bSetINetAttr', t: AF.SetINetAttr },
    { label: t('autocorr.detectDoi'), m: 'bSetDOIAttr', t: AF.SetDOIAttr },
    { label: t('autocorr.dash'), m: 'bChgToEnEmDash', t: AF.ChgToEnEmDash },
    { label: t('autocorr.delSpacesAtSttEnd'), m: 'bAFormatDelSpacesAtSttEnd', t: 'bAFormatByInpDelSpacesAtSttEnd' },
    { label: t('autocorr.delSpacesBetweenLines'), m: 'bAFormatDelSpacesBetweenLines', t: 'bAFormatByInpDelSpacesBetweenLines' },
    { label: t('autocorr.noDblSpaces'), t: AF.IgnoreDoubleSpace },
    { label: t('autocorr.capsLock'), t: AF.CorrectCapsLock },
    { label: t('autocorr.num', { char: st.sw.cByInputBullet }), t: 'bSetNumRule' },
    { label: t('autocorr.numAfterSpace'), t: 'bSetNumRuleAfterSpace' },
    { label: t('autocorr.border'), t: 'bSetBorder' },
    { label: t('autocorr.createTable'), t: 'bCreateTable' },
    { label: t('autocorr.replaceTemplates'), m: 'bReplaceStyles', t: 'bReplaceStylesByInput' },
    { label: t('autocorr.delEmptyPara'), m: 'bDelEmptyNode' },
    { label: t('autocorr.userStyle'), m: 'bChgUserColl' },
    { label: t('autocorr.bullet', { char: st.sw.cBullet }), m: 'bChgEnumNum' },
    { label: t('autocorr.rightMargin', { percent: `${st.sw.nRightMargin}%` }), m: 'bRightMargin' },
  ];
  const localizedRows: AcorRow[] = [
    { label: t('autocorr.nonBreakSpace'), m: 'bAddNonBrkSpace', t: AF.AddNonBrkSpace },
    { label: t('autocorr.ordinal'), m: 'bChgOrdinalNumber', t: AF.ChgOrdinalNumber },
    { label: t('autocorr.oldHungarian'), m: 'bTransliterateRTL', t: AF.TransliterateRTL },
    { label: t('autocorr.angleQuotes'), m: 'bChgAngleQuotes', t: AF.ChgAngleQuotes },
  ];
  const checkTable = (rows: AcorRow[], name: string) => (
    <table className="acor-checks" aria-label={name}>
      <thead><tr><th scope="col" title={t('autocorr.mHint')}>[M]</th><th scope="col" title={t('autocorr.tHint')}>[T]</th><th scope="col"><span className="sr-only">{t('autocorr.option')}</span></th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.m && <input type="checkbox" aria-label={`[M] ${r.label}`} checked={get(r.m)} onChange={(e) => set(r.m!, e.target.checked)} />}</td>
            <td>{r.t !== undefined && <input type="checkbox" aria-label={`[T] ${r.label}`} checked={get(r.t)} onChange={(e) => set(r.t!, e.target.checked)} />}</td>
            <td>{r.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const quote = (i: number, label: string) => (
    <Field label={label}>
      <CharField label={label} allowEmpty value={st.quotes[i] ?? ''} onChange={(v) => setSt((s) => { const q = [...s.quotes]; q[i] = v; return { ...s, quotes: q }; })} />
    </Field>
  );
  const pages = ['replace', 'exceptions', 'options', 'localized', 'wordcompletion'];
  const labels = { replace: t('autocorr.replace'), exceptions: t('autocorr.exceptions'), options: t('autocorr.options'), localized: t('autocorr.localized'), wordcompletion: t('autocorr.wordCompletion') };
  const multi = (e: React.ChangeEvent<HTMLSelectElement>) => [...e.target.selectedOptions].map((o) => o.value);
  return (
    <Modal c={c} title={t('autocorr.title')} wide>
      <form method="dialog" onSubmit={submit} className="autocorrect">
        <Field label={t('autocorr.language')}>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {AUTOCORR_LANGUAGES.map((l) => <option key={l} value={l}>{l === LANGUAGE_UNDETERMINED ? t('autocorr.all') : languageName(l)}</option>)}
          </select>
        </Field>
        <Tabs ids={pages} labels={labels} current={page} onChange={choose} label={t('autocorr.title')} />
        <Panel id="replace" current={page}>
          <div className="acor-replace">
            <Field label={t('autocorr.replaceField')}><input value={short} onChange={(e) => { setShort(e.target.value); const hit = cur?.replace.find(([s]) => s === e.target.value); if (hit) setLong(hit[1]); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); newEntry(); } }} /></Field>
            <Field label={t('autocorr.with')}><input value={long} onChange={(e) => setLong(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); newEntry(); } }} /></Field>
            <div className="acor-replace-row">
              <label className="check"><input type="checkbox" checked disabled /> {t('autocorr.textOnly')}</label>
              <div className="acor-buttons">
                <button type="button" disabled={!canNew} onClick={newEntry}>{found >= 0 ? t('autocorr.replaceButton') : t('autocorr.new')}</button>
                <button type="button" disabled={found < 0} onClick={deleteEntry}>{t('autocorr.delete')}</button>
              </div>
            </div>
          </div>
          <div className="acor-list" role="listbox" aria-label={t('autocorr.replaceList')}>
            {!cur ? <p className="muted">{t('autocorr.loading')}</p> : (
              <table>
                <tbody>
                  {shownReplace.map(([s, l]) => (
                    <tr key={s} role="option" aria-selected={s === short} className={s === short ? 'on' : undefined} onClick={() => { setShort(s); setLong(l); }}><td>{s}</td><td>{l}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
        <Panel id="exceptions" current={page}>
          <div className="acor-except">
            <fieldset>
              <legend>{t('autocorr.abbrev')}</legend>
              <div className="acor-entry">
                <input aria-label={t('autocorr.abbrev')} value={abbrev} onChange={(e) => setAbbrev(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExcept('sentence', abbrev); setAbbrev(''); } }} />
                <button type="button" disabled={!abbrev || !cur} onClick={() => { addExcept('sentence', abbrev); setAbbrev(''); }}>{t('autocorr.new')}</button>
                <button type="button" disabled={!selAbbrev.length} onClick={() => { delExcept('sentence', selAbbrev); setSelAbbrev([]); }}>{t('autocorr.delete')}</button>
              </div>
              <select multiple size={8} aria-label={t('autocorr.abbrev')} value={selAbbrev} onChange={(e) => { const v = multi(e); setSelAbbrev(v); if (v[0]) setAbbrev(v[0]); }}>
                {cur?.sentence.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <label className="check"><input type="checkbox" checked={ac(AF.SaveWordCplSttLst)} onChange={(e) => setAc(AF.SaveWordCplSttLst, e.target.checked)} /> {t('autocorr.autoInclude')}</label>
            </fieldset>
            <fieldset>
              <legend>{t('autocorr.doubleCaps')}</legend>
              <div className="acor-entry">
                <input aria-label={t('autocorr.doubleCaps')} value={double} onChange={(e) => setDouble(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExcept('word', double); setDouble(''); } }} />
                <button type="button" disabled={!double || !cur} onClick={() => { addExcept('word', double); setDouble(''); }}>{t('autocorr.new')}</button>
                <button type="button" disabled={!selDouble.length} onClick={() => { delExcept('word', selDouble); setSelDouble([]); }}>{t('autocorr.delete')}</button>
              </div>
              <select multiple size={8} aria-label={t('autocorr.doubleCaps')} value={selDouble} onChange={(e) => { const v = multi(e); setSelDouble(v); if (v[0]) setDouble(v[0]); }}>
                {cur?.word.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <label className="check"><input type="checkbox" checked={ac(AF.SaveWordWordStartLst)} onChange={(e) => setAc(AF.SaveWordWordStartLst, e.target.checked)} /> {t('autocorr.autoInclude')}</label>
            </fieldset>
          </div>
        </Panel>
        <Panel id="options" current={page}>
          <p className="muted">{t('autocorr.mHint')}<br />{t('autocorr.tHint')}</p>
          {checkTable(optionRows, t('autocorr.options'))}
          {/* OfaSwAutoFmtOptionsPage's Edit...: the bullet characters and the percentage. */}
          <fieldset className="acor-edit"><legend>{t('autocorr.edit')}</legend>
            <Field label={t('autocorr.byInputBullet')}><CharField label={t('autocorr.byInputBullet')} value={st.sw.cByInputBullet} onChange={(v) => setSwVal((sw) => { sw.cByInputBullet = v; })} /></Field>
            <Field label={t('autocorr.bulletChar')}><CharField label={t('autocorr.bulletChar')} value={st.sw.cBullet} onChange={(v) => setSwVal((sw) => { sw.cBullet = v; })} /></Field>
            <Field label={t('autocorr.minSize')}><input type="number" min={1} max={100} value={st.sw.nRightMargin} onChange={(e) => setSwVal((sw) => { sw.nRightMargin = Math.max(1, Math.min(100, Number(e.target.value) || 50)); })} /></Field>
          </fieldset>
        </Panel>
        <Panel id="localized" current={page}>
          {checkTable(localizedRows, t('autocorr.localized'))}
          <div className="acor-quotes">
            <fieldset><legend>{t('autocorr.singleQuotes')}</legend>
              <label className="check"><input type="checkbox" checked={ac(AF.ChgSglQuotes)} onChange={(e) => setAc(AF.ChgSglQuotes, e.target.checked)} /> {t('autocorr.replaceQuotes')}</label>
              {quote(0, t('autocorr.startQuote'))}
              {quote(1, t('autocorr.endQuote'))}
              <button type="button" onClick={() => setSt((s) => ({ ...s, quotes: ['', '', s.quotes[2] ?? '', s.quotes[3] ?? ''] }))}>{t('autocorr.defaultButton')}</button>
            </fieldset>
            <fieldset><legend>{t('autocorr.doubleQuotes')}</legend>
              <label className="check"><input type="checkbox" checked={ac(AF.ChgQuotes)} onChange={(e) => setAc(AF.ChgQuotes, e.target.checked)} /> {t('autocorr.replaceQuotes')}</label>
              {quote(2, t('autocorr.startQuote'))}
              {quote(3, t('autocorr.endQuote'))}
              <button type="button" onClick={() => setSt((s) => ({ ...s, quotes: [s.quotes[0] ?? '', s.quotes[1] ?? '', '', ''] }))}>{t('autocorr.defaultButton')}</button>
            </fieldset>
          </div>
        </Panel>
        <Panel id="wordcompletion" current={page}>
          <div className="acor-complete">
            <div>
              <label className="check"><input type="checkbox" checked={st.sw.bAutoCompleteWords} onChange={(e) => setSw('bAutoCompleteWords', e.target.checked)} /> {t('autocorr.enableComplete')}</label>
              <label className="check"><input type="checkbox" disabled={!st.sw.bAutoCompleteWords} checked={st.sw.bAutoCmpltAppendBlank} onChange={(e) => setSw('bAutoCmpltAppendBlank', e.target.checked)} /> {t('autocorr.appendSpace')}</label>
              <label className="check"><input type="checkbox" disabled={!st.sw.bAutoCompleteWords} checked={st.sw.bAutoCmpltShowAsTip} onChange={(e) => setSw('bAutoCmpltShowAsTip', e.target.checked)} /> {t('autocorr.showAsTip')}</label>
              <Field label={t('autocorr.acceptWith')}>
                <select disabled={!st.sw.bAutoCompleteWords} value={st.sw.nAutoCmpltExpandKey} onChange={(e) => setSwVal((sw) => { sw.nAutoCmpltExpandKey = Number(e.target.value); })}>
                  {[[KEY_END, 'End'], [KEY_RETURN, 'Enter'], [KEY_SPACE, 'Space'], [KEY_RIGHT, 'Right'], [KEY_TAB, 'Tab']].map(([k, n]) => <option key={k} value={k}>{t(`autocorr.key${n}`)}</option>)}
                </select>
              </Field>
              <Field label={t('autocorr.minWordLen')}><input type="number" min={5} max={100} disabled={!st.sw.bAutoCompleteWords} value={st.sw.nAutoCmpltWordLen} onChange={(e) => setSwVal((sw) => { sw.nAutoCmpltWordLen = Math.max(5, Math.min(100, Number(e.target.value) || 8)); })} /></Field>
              <Field label={t('autocorr.maxEntries')}><input type="number" min={50} max={65535} disabled={!st.sw.bAutoCompleteWords} value={st.sw.nAutoCmpltListLen} onChange={(e) => setSwVal((sw) => { sw.nAutoCmpltListLen = Math.max(50, Math.min(65535, Number(e.target.value) || 1000)); })} /></Field>
            </div>
            <fieldset><legend>{t('autocorr.collectedWords')}</legend>
              <select multiple size={10} aria-label={t('autocorr.collectedWords')} value={selWords} onChange={(e) => setSelWords(multi(e))}>
                {[...st.words].sort((x, y) => x.localeCompare(y)).map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <button type="button" disabled={!selWords.length} onClick={() => { setSt((s) => ({ ...s, words: s.words.filter((w) => !selWords.includes(w)) })); setSelWords([]); }}>{t('autocorr.delete')}</button>
              <label className="check"><input type="checkbox" disabled={!st.sw.bAutoCompleteWords} checked={st.sw.bAutoCmpltCollectWords} onChange={(e) => setSw('bAutoCmpltCollectWords', e.target.checked)} /> {t('autocorr.collectWords')}</label>
              <label className="check"><input type="checkbox" disabled={!st.sw.bAutoCompleteWords || !st.sw.bAutoCmpltCollectWords} checked={!st.sw.bAutoCmpltKeepList} onChange={(e) => setSw('bAutoCmpltKeepList', !e.target.checked)} /> {t('autocorr.whenClosing')}</label>
            </fieldset>
          </div>
        </Panel>
        <footer>
          <button type="button" onClick={reset}>{t('autocorr.reset')}</button>
          <button type="button" onClick={() => c.setDialog(null)}>{t('common.cancel')}</button>
          <button type="submit" className="primary">{t('common.ok')}</button>
        </footer>
      </form>
    </Modal>
  );
}

export function Dialogs({ c }: { c: Controller }) {
  switch (c.dialog) {
    case 'documents': return <Documents c={c} />;
    case 'character': return <Character c={c} />;
    case 'paragraph': return <Paragraph c={c} />;
    case 'page': return <Page c={c} />;
    case 'pageheader': return <Page c={c} initial="header" />;
    case 'pagefooter': return <Page c={c} initial="footer" />;
    case 'hfborder-header': return <HeaderFooterBorder c={c} bHeader />;
    case 'hfborder-footer': return <HeaderFooterBorder c={c} bHeader={false} />;
    case 'query': return <MessageQuery c={c} />;
    case 'wordcount': return <WordCount c={c} />;
    case 'about': return <About c={c} />;
    case 'querysave': return <QuerySave c={c} />;
    case 'repairpackage': return <RepairPackage c={c} />;
    case 'gotopage': return <GotoPage c={c} />;
    case 'cleardata': return <ClearData c={c} />;
    case 'createcopy': return <CreateCopy c={c} />;
    case 'saveversion': return <SaveVersion c={c} />;
    case 'templates': return <TemplateManager c={c} />;
    case 'saveastemplate': return <SaveAsTemplate c={c} />;
    case 'loadstyles': return <LoadStyles c={c} />;
    case 'commandpopup': return <CommandPopup c={c} />;
    case 'table': return <InsertTable c={c} />;
    case 'hyperlink': return <Hyperlink c={c} />;
    case 'specialchar': return <SpecialChar c={c} />;
    case 'options': return <Options c={c} />;
    case 'autocorrect': return <AutoCorrectDialog c={c} />;
    case 'style': return <StyleDialog c={c} />;
    case 'newstyle': return <NewStyle c={c} />;
    case 'toc': return <InsertToc c={c} />;
    case 'fly': return <FlyProperties c={c} />;
    case 'redlines': return <ManageChanges c={c} />;
    case 'versions': return <Versions c={c} />;
    case 'section': return <InsertSection c={c} />;
    case 'sections': return <EditSections c={c} />;
    case 'columns': return <FormatColumns c={c} />;
    case 'break': return <InsertBreak c={c} />;
    case 'download': return <Download c={c} />;
    case 'spelling': return <Spelling c={c} />;
    case 'compress': return <CompressImage c={c} />;
    case 'objname': return <ObjectName c={c} />;
    case 'imagefilter': return <ImageFilter c={c} />;
    case 'alttext': return <ObjectTitleDesc c={c} />;
    case 'numbullet': return <NumBullet c={c} />;
    case 'titlepage': return <TitlePage c={c} />;
    case 'watermark': return <Watermark c={c} />;
    case 'docinfo': return <DocumentProperties c={c} />;
    case 'sizecheck': return <GraphicSizeCheckDialog c={c} />;
    case 'insrows': return <InsertRowCol c={c} cols={false} />;
    case 'inscols': return <InsertRowCol c={c} cols />;
    case 'splitcells': return <SplitCells c={c} />;
    case 'mergetable': return <MergeTables c={c} />;
    case 'splittable': return <SplitTableDialog c={c} />;
    case 'caption': return <CaptionDialog c={c} />;
    case 'formula': return <FormulaDialog c={c} />;
    case 'contour': return <ContourDialog c={c} />;
    case 'rowheight': return <RowHeight c={c} />;
    case 'colwidth': return <ColWidth c={c} />;
    case 'tableprops': return <TableProperties c={c} />;
    case 'autoformat': return <AutoFormat c={c} />;
    case 'texttotable': return <TextToTableDialog c={c} />;
    case 'tabletotext': return <TableToTextDialog c={c} />;
    case 'tablesort': return <TableSortDialog c={c} />;
    case 'numformat': return <NumberFormatDialog c={c} />;
    case 'pagenumber': return <PageNumberDialog c={c} />;
    case 'crossref': return <FieldDialog c={c} initial="ref" />;
    case 'fields': return <FieldDialog c={c} initial="document" />;
    case 'bookmark': return <BookmarkDialog c={c} />;
    case 'fieldinput': return <FieldInputDialog c={c} />;
    case 'signatureline': return <SignatureLine c={c} edit={false} />;
    case 'signatureline-edit': return <SignatureLine c={c} edit />;
    default: return null;
  }
}

export function FindPanel({ c }: { c: Controller }) { return c.dialog === 'find' ? <Find c={c} /> : null; }
