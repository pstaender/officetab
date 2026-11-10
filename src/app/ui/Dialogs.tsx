import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import { languageName } from '../spell.ts';
import type { Controller } from '../controller.ts';
import { deleteDoc, listDocs, type StoredDocInfo } from '../storage.ts';
import upstream from '../../../upstream.json';
import { SwStartNodeType } from '@lo/sw/inc/ndtyp.ts';
import { DEF_GUTTER_WIDTH, type SwFormatCol } from '@lo/sw/inc/fmtclds.ts';
import { POOL_PAGE_DESCS } from '@lo/sw/inc/pagedesc.ts';
import type { SwSectionData } from '@lo/sw/inc/node.ts';
import { COL_DEFAULT_SHAPE_FILLING, COL_DEFAULT_SHAPE_STROKE, HoriOrientation, RelOrientation, RndStdIds, VertOrientation, WrapTextMode, type SwFlyFrameFormat } from '@lo/sw/inc/frmfmt.ts';
import { GetGrfFilterParams, GrfFilterTable, type GrfFilterParam } from '@lo/svx/source/dialog/grfflt.ts';
import { MAXLEVEL, SwNumRule, type SvxNumLabelFollowedBy, type SwNumFormat } from '@lo/sw/inc/numrule.ts';
import { NumberingType } from '@lo/i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';
import { ALL_LEVELS, BulletPick, FirstLevel, OutlinePick, OutlineSettings, SameForLevels, SetAlignAt, SetBullet, SetIncludeUpperLevels, SetIndentAt, SetLabelFollowedBy, SetListtabPos, SetNumAdjust, SetNumberType, SetPrefixSuffix, SetStart, SingleNumPick, SingleNumSettings, StandardPositions, m_aBulletSymbols } from '@lo/cui/source/tabpages/numpages.ts';
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
        <ul className="doclist">
          {docs.map((d) => (
            <li key={d.id}>
              <button className="doc" onClick={() => void c.openStored(d.id)}><strong>{d.name}</strong><span>{new Date(d.updated).toLocaleString()}</span></button>
              <button aria-label={`Delete ${d.name}`} disabled={d.id === c.docId} title={d.id === c.docId ? 'This document is open' : 'Delete'} onClick={() => { if (confirm(`Delete “${d.name}” from this browser?`)) void deleteDoc(d.id).then(refresh); }}>Delete</button>
            </li>
          ))}
        </ul>
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
function CharFields({ get }: { get: Get }) {
  return (
    <>
      <Field label="Font"><input name="font" defaultValue={get('RES_CHRATR_FONT')} required /></Field>
      <Field label="Size (pt)"><input name="size" type="number" step="any" min="1" max="999" defaultValue={get('RES_CHRATR_FONTSIZE') / 20} required /></Field>
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

const readCharFields = (f: FormData): SwCharAttrSet => ({
  RES_CHRATR_FONT: String(f.get('font')), RES_CHRATR_FONTSIZE: Math.round(parseFloat(String(f.get('size'))) * 20),
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
        <CharFields get={(k) => c.sh.GetAttr(k)} />
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
        <CharFields get={(k) => coll.GetFormatAttr(k)} />
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
    c.setDialog(null);
    c.notify();
  };
  const pages = ['user', 'fonts', 'writing'];
  const labels = { user: t('options.user'), fonts: t('fonts.title'), writing: t('options.writing') };
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
          <Panel id="fonts" current={page}><FontSettings c={c} /></Panel>
          <Panel id="writing" current={page}>
            <h3>{t('options.writing')}</h3>
            <label className="check"><input type="checkbox" name="autospell" defaultChecked={c.onlineSpell} /> {t('options.autospell')}</label>
            <p className="muted">{t('options.autospellHint')}</p>
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
      <datalist id="font-names">{fs.listFonts([]).map((f) => <option key={f} value={f} />)}</datalist>
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
              <td><input aria-label={t('fonts.font')} value={from} readOnly={ro} list="font-names" onChange={(e) => setRow(k, e.target.value, to)} /></td>
              <td><input aria-label={t('fonts.replacement')} value={to} readOnly={ro} list="font-names" onChange={(e) => setRow(k, from, e.target.value)} /></td>
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
          <input value={p.defaults[k]} readOnly={ro} list="font-names" onChange={(e) => change({ ...p, defaults: { ...p.defaults, [k]: e.target.value } })} />
        </Field>
      ))}
      <label className="check"><input type="checkbox" checked={fs.alwaysReplace} onChange={(e) => { fs.setAlwaysReplace(e.target.checked); update(); }} /> {t('fonts.always')}</label>
      </Panel>
      <Panel id="list" current={tab}>
      <label className="check"><input type="checkbox" checked={fs.showAll} onChange={(e) => { fs.setShowAll(e.target.checked); update(); c.notify(); }} /> {t('fonts.showAll')}</label>
      <p className="muted">{t('fonts.showAllHint')}</p>
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
      m_aSurround: { m_eSurround: n('wrap') as WrapTextMode },
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
  useEffect(() => { void createImageBitmap(new Blob([g.data as BlobPart], { type: g.mime })).then((b) => { setPx({ w: b.width, h: b.height }); b.close(); }); }, [g]);
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
    const b = await createImageBitmap(new Blob([g.data as BlobPart], { type: g.mime }));
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

/** The Save As dialog for browsers without a file picker: a name and a file type to download. */
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

function SaveAs({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.rename(String(f.get('name') ?? '').trim() || c.name);
    c.setDialog(null);
    void c.saveAs(String(f.get('format')) as 'odt' | 'docx' | 'txt' | 'md');
  };
  return (
    <Modal c={c} title="Save As">
      <form onSubmit={submit}>
        <Field label="File name"><input name="name" defaultValue={c.name} autoFocus /></Field>
        <Field label="File type">
          <select name="format" defaultValue="odt">
            <option value="odt">ODF Text Document (.odt)</option>
            <option value="docx">Word Document (.docx)</option>
            <option value="txt">Text (.txt)</option>
            <option value="md">Markdown (.md)</option>
          </select>
        </Field>
        <Actions c={c} ok="Save" />
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
    case 'table': return <InsertTable c={c} />;
    case 'hyperlink': return <Hyperlink c={c} />;
    case 'specialchar': return <SpecialChar c={c} />;
    case 'options': return <Options c={c} />;
    case 'style': return <StyleDialog c={c} />;
    case 'newstyle': return <NewStyle c={c} />;
    case 'toc': return <InsertToc c={c} />;
    case 'fly': return <FlyProperties c={c} />;
    case 'redlines': return <ManageChanges c={c} />;
    case 'section': return <InsertSection c={c} />;
    case 'sections': return <EditSections c={c} />;
    case 'columns': return <FormatColumns c={c} />;
    case 'break': return <InsertBreak c={c} />;
    case 'saveas': return <SaveAs c={c} />;
    case 'spelling': return <Spelling c={c} />;
    case 'compress': return <CompressImage c={c} />;
    case 'objname': return <ObjectName c={c} />;
    case 'imagefilter': return <ImageFilter c={c} />;
    case 'alttext': return <ObjectTitleDesc c={c} />;
    case 'numbullet': return <NumBullet c={c} />;
    default: return null;
  }
}

export function FindPanel({ c }: { c: Controller }) { return c.dialog === 'find' ? <Find c={c} /> : null; }
