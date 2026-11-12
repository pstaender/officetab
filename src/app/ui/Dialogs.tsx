import { ICON_THEMES, type IconTheme } from '../icons.ts';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ImportBitmap } from '@lo/vcl/source/graphic/Manager.ts';
import { SmDocShell } from '@lo/starmath/source/document.ts';
import { CreateAutoContour } from '@lo/svx/source/dialog/_contdlg.ts';
import { t } from '../i18n.ts';
import { languageName } from '../spell.ts';
import { dateOf, type Controller, type FileFormat } from '../controller.ts';
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
import { POOL_DEFAULTS, type FontLineStyle, type SvxCaseMap, type SvxAdjust, type SvxBreak, type SvxLineSpacing, type SwAttrs, type SwAttrSet, type SwCharAttrSet } from '@lo/sw/inc/hintids.ts';

const CM = 567;
const toCm = (t: number) => Math.round((t / CM) * 100) / 100;
const fromCm = (s: string) => Math.round(parseFloat(s || '0') * CM);

function Modal({ c, title, children, wide }: { c: Controller; title: string; children: ReactNode; wide?: boolean }) {
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

/** A file size in megabytes, with two decimals (at least 0.01 MB for a non-empty file). */
const formatMB = (bytes: number) => `${(bytes > 0 ? Math.max(0.01, bytes / 1_048_576) : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`;

function Documents({ c }: { c: Controller }) {
  const [docs, setDocs] = useState<StoredDocInfo[] | null>(null);
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
            <thead><tr><th scope="col">{t('docs.name')}</th><th scope="col">{t('docs.modified')}</th><th scope="col" className="num">{t('docs.size')}</th><th scope="col"><span className="sr-only">{t('docs.actions')}</span></th></tr></thead>
            <tbody>
              {docs.map((d) => (
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
      <Field label="Value"><input name="lsvalue" type="number" step="any" min="0" defaultValue={ls.rule === 'proportional' ? ls.value : toCm(ls.value)} /></Field>
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

/** cui's page tabs (Organizer, Page, Header, Footer), reduced: the page style of the cursor's page. */
function Page({ c }: { c: Controller }) {
  const doc = c.sh.m_pDoc;
  const [name, setName] = useState(c.sh.GetCurPageDesc().m_aName);
  const pd = doc.FindPageDesc(name) ?? doc.m_aPageDesc;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => fromCm(String(f.get(k)));
    let w = g('w'), h = g('h');
    const l = g('l'), r = g('r'), t = g('t'), b = g('b');
    // Orientation swaps the sides so that the longer one runs the chosen way.
    const landscape = f.get('orient') === 'landscape';
    if (landscape !== w > h) [w, h] = [h, w];
    if (w - l - r < CM || h - t - b < CM) { c.setMessage('The margins leave no room for text on the page.'); return; }
    c.applyPage((p) => { p.nWidth = w; p.nHeight = h; p.nLeft = l; p.nRight = r; p.nTop = t; p.nBottom = b; p.m_sFollow = String(f.get('follow') || p.m_aName); }, pd);
    // Header and Footer tabs: on/off, and "Same content on first page" / "on left and right pages".
    for (const bHeader of [true, false]) {
      const k = bHeader ? 'header' : 'footer';
      const on = !!f.get(k);
      c.sh.ChangeHeaderOrFooter(bHeader, on, false, pd.m_aName);
      if (on) {
        doc.SetHeaderFooter(c.sh.m_pCursor, bHeader, !!f.get(`${k}-first`), 'first', pd.m_aName);
        doc.SetHeaderFooter(c.sh.m_pCursor, bHeader, !!f.get(`${k}-left`), 'left', pd.m_aName);
      }
    }
    c.setDialog(null);
  };
  const has = (bHeader: boolean, kind: 'default' | 'first' | 'left' = 'default') =>
    !!doc.GetNodes().FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode, kind, pd.m_aName);
  const styles = [...new Set([...doc.m_aPageDescs.keys(), ...POOL_PAGE_DESCS])];
  return (
    <Modal c={c} title="Page Style">
      <Field label="Page style"><select value={name} onChange={(e) => { doc.FindPageDesc(e.target.value); setName(e.target.value); }}>{styles.map((n) => <option key={n}>{n}</option>)}</select></Field>
      <form key={name} onSubmit={submit}>
        <Field label="Next style"><select name="follow" defaultValue={pd.m_sFollow}>{styles.map((n) => <option key={n}>{n}</option>)}</select></Field>
        <Field label="Orientation"><select name="orient" defaultValue={pd.nWidth > pd.nHeight ? 'landscape' : 'portrait'}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></Field>
        <Field label="Width (cm)"><input name="w" type="number" step="any" min="1" defaultValue={toCm(pd.nWidth)} /></Field>
        <Field label="Height (cm)"><input name="h" type="number" step="any" min="1" defaultValue={toCm(pd.nHeight)} /></Field>
        <Field label="Left margin (cm)"><input name="l" type="number" step="any" min="0" defaultValue={toCm(pd.nLeft)} /></Field>
        <Field label="Right margin (cm)"><input name="r" type="number" step="any" min="0" defaultValue={toCm(pd.nRight)} /></Field>
        <Field label="Top margin (cm)"><input name="t" type="number" step="any" min="0" defaultValue={toCm(pd.nTop)} /></Field>
        <Field label="Bottom margin (cm)"><input name="b" type="number" step="any" min="0" defaultValue={toCm(pd.nBottom)} /></Field>
        {([true, false] as const).map((bHeader) => {
          const k = bHeader ? 'header' : 'footer', label = bHeader ? 'Header' : 'Footer';
          return (
            <fieldset key={k} className="hf">
              <label className="check"><input type="checkbox" name={k} defaultChecked={has(bHeader)} /> {label} on</label>
              <label className="check"><input type="checkbox" name={`${k}-first`} defaultChecked={has(bHeader, 'first')} /> Different on first page</label>
              <label className="check"><input type="checkbox" name={`${k}-left`} defaultChecked={has(bHeader, 'left')} /> Different on left pages</label>
            </fieldset>
          );
        })}
        <Actions c={c} />
      </form>
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
    const theme = String(f.get('icontheme'));
    if (theme !== c.iconTheme && (ICON_THEMES as readonly string[]).includes(theme)) c.setIconTheme(theme as IconTheme);
    c.setDialog(null);
    c.notify();
  };
  const pages = ['user', 'view', 'fonts', 'writing'];
  const labels = { user: t('options.user'), view: t('options.view'), fonts: t('fonts.title'), writing: t('options.writing') };
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
        </div>
        <Actions c={c} />
      </form>
    </Modal>
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
        <textarea ref={text} rows={7} cols={40} defaultValue={info.comment} readOnly={!edit} autoFocus={edit} aria-label={t('versions.comments')} />
        <footer>
          {edit ? (
            <><button type="button" onClick={() => onDone(null)}>{t('common.cancel')}</button><button type="submit" className="primary">{t('common.ok')}</button></>
          ) : <button type="button" className="primary" autoFocus onClick={() => onDone(null)}>{t('versions.close')}</button>}
        </footer>
      </form>
    </dialog>
  );
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
  const [confirmAll, setConfirmAll] = useState(false);
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
        {confirmAll && versions.length > 0 && (
          <p className="versions-confirm" role="alert">
            <span>{t('versions.deleteAllConfirm', { n: versions.length })}</span>
            <button type="button" onClick={() => setConfirmAll(false)}>{t('common.cancel')}</button>
            <button type="button" className="danger-primary" autoFocus onClick={() => { c.deleteAllVersions(); setConfirmAll(false); setSel(-1); }}>{t('versions.deleteAll')}</button>
          </p>
        )}
        <footer>
          <button type="button" disabled={!cur} onClick={remove}>{t('versions.delete')}</button>
          <button type="button" disabled={!versions.length} onClick={() => setConfirmAll(true)}>{t('versions.deleteAll')}</button>
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
  const type = !c.handle ? t('docinfo.typeNew') : ext === 'docx' ? t('docinfo.typeDocx') : ext === 'txt' ? t('docinfo.typeTxt') : ext === 'md' || ext === 'markdown' ? t('docinfo.typeMd') : t('docinfo.typeOdt');
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
 * Insert > Caption for a table (sw insertcaption.ui, SwCaptionDialog): the category (a number
 * range; a new name makes a new one), its numbering, the text, the separator before it and the
 * position, with a preview (DrawSample). The Auto and Options buttons are not ported.
 */
function CaptionDialog({ c }: { c: Controller }) {
  const none = t('caption.none');
  const [cat, setCat] = useState('Table');
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
function FormatSelect({ format = 'odt' }: { format?: string }) {
  return (
    <select name="format" defaultValue={format}>
      <option value="odt">ODF Text Document (.odt)</option>
      <option value="ott">ODF Text Document Template (.ott)</option>
      <option value="docx">Word Document (.docx)</option>
      <option value="txt">Text (.txt)</option>
      <option value="md">Markdown (.md)</option>
    </select>
  );
}

/** File > Download As (.uno:ExportTo): a copy of the document, in a chosen format, in the browser's downloads. */
function Download({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.setDialog(null);
    void c.download(String(f.get('name') ?? '').trim() || c.name, String(f.get('format')) as FileFormat);
  };
  return (
    <Modal c={c} title={t('download.title')}>
      <form onSubmit={submit}>
        <Field label={t('download.name')}><input name="name" defaultValue={c.name} autoFocus /></Field>
        <Field label={t('download.format')}><FormatSelect format={c.fileFormat()} /></Field>
        <Actions c={c} ok={t('download.ok')} />
      </form>
    </Modal>
  );
}

/** cui/uiconfig/ui/spellingdialog.ui, reduced: the next unknown word, its suggestions and what to do. */
function Spelling({ c }: { c: Controller }) {
  const sh = c.sh;
  const [wrong, setWrong] = useState(() => sh.SpellContinue());
  const [pick, setPick] = useState(0);
  const sugg = useMemo(() => (wrong ? c.spell.getSuggestions(wrong.word, wrong.lang) : []), [wrong]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { setPick(0); setWrong(sh.SpellContinue()); c.notify(); };
  const node = () => sh.m_pCursor.Start().GetNode();
  const change = (text: string) => { if (!wrong) return; sh.ReplaceWord(node(), wrong.nStart, wrong.nEnd, text); next(); };
  if (!c.spell.GetLocales().length) {
    return <Modal c={c} title="Spelling"><p className="muted">No spelling dictionary is loaded. Choose the text language in the status bar to download one.</p><footer><button type="button" className="primary" onClick={() => c.setDialog(null)}>Close</button></footer></Modal>;
  }
  return (
    <Modal c={c} title="Spelling">
      <div className="spelling">
        {wrong ? <>
          <p>Not in dictionary ({languageName(wrong.lang)}): <span className="word">{wrong.word}</span></p>
          <ul aria-label="Suggestions">{sugg.length ? sugg.map((s, i) => <li key={s}><button type="button" className={i === pick ? 'on' : undefined} onClick={() => setPick(i)} onDoubleClick={() => change(s)}>{s}</button></li>) : <li className="muted">(No suggestions)</li>}</ul>
          <footer>
            <button type="button" onClick={next}>Ignore Once</button>
            <button type="button" onClick={() => { c.spell.IgnoreAll(wrong.word); next(); }}>Ignore All</button>
            <button type="button" onClick={() => { c.addToDictionary(wrong.word); next(); }}>Add to Dictionary</button>
            <button type="button" disabled={!sugg.length} className="primary" onClick={() => change(sugg[pick]!)}>Correct</button>
            <button type="button" onClick={() => c.setDialog(null)}>Close</button>
          </footer>
        </> : <>
          <p>The spellcheck is complete.</p>
          <footer><button type="button" className="primary" onClick={() => c.setDialog(null)}>Close</button></footer>
        </>}
      </div>
    </Modal>
  );
}

export function Dialogs({ c }: { c: Controller }) {
  switch (c.dialog) {
    case 'documents': return <Documents c={c} />;
    case 'character': return <Character c={c} />;
    case 'paragraph': return <Paragraph c={c} />;
    case 'page': return <Page c={c} />;
    case 'wordcount': return <WordCount c={c} />;
    case 'about': return <About c={c} />;
    case 'querysave': return <QuerySave c={c} />;
    case 'table': return <InsertTable c={c} />;
    case 'hyperlink': return <Hyperlink c={c} />;
    case 'specialchar': return <SpecialChar c={c} />;
    case 'options': return <Options c={c} />;
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
    default: return null;
  }
}

export function FindPanel({ c }: { c: Controller }) { return c.dialog === 'find' ? <Find c={c} /> : null; }
