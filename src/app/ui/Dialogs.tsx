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
import { POOL_DEFAULTS, type FontLineStyle, type SvxAdjust, type SvxBreak, type SvxLineSpacing, type SwAttrs, type SwAttrSet, type SwCharAttrSet } from '@lo/sw/inc/hintids.ts';

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
      <footer><button onClick={() => c.setDialog(null)}>Close</button></footer>
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
      <Field label="Case"><select name="casemap" defaultValue={get('RES_CHRATR_CASEMAP')}><option value="none">As typed</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option></select></Field>
      <Field label="Color"><input name="color" type="color" defaultValue={get('RES_CHRATR_COLOR') ?? '#000000'} /></Field>
      <label className="check"><input name="auto" type="checkbox" defaultChecked={get('RES_CHRATR_COLOR') === null} /> Automatic color</label>
      <label className="check"><input name="bold" type="checkbox" defaultChecked={get('RES_CHRATR_WEIGHT')} /> Bold</label>
      <label className="check"><input name="italic" type="checkbox" defaultChecked={get('RES_CHRATR_POSTURE')} /> Italic</label>
      <label className="check"><input name="strike" type="checkbox" defaultChecked={get('RES_CHRATR_CROSSEDOUT')} /> Strikethrough</label>
    </>
  );
}

const readCharFields = (f: FormData): SwCharAttrSet => ({
  RES_CHRATR_FONT: String(f.get('font')), RES_CHRATR_FONTSIZE: Math.round(parseFloat(String(f.get('size'))) * 20),
  RES_CHRATR_WEIGHT: !!f.get('bold'), RES_CHRATR_POSTURE: !!f.get('italic'),
  RES_CHRATR_UNDERLINE: String(f.get('underline')) as FontLineStyle, RES_CHRATR_CROSSEDOUT: !!f.get('strike'),
  RES_CHRATR_COLOR: f.get('auto') ? null : String(f.get('color')),
  RES_CHRATR_CASEMAP: String(f.get('casemap')) as 'none' | 'uppercase' | 'lowercase',
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

/** The Save As dialog for browsers without a file picker: a name and a file type to download. */
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
    default: return null;
  }
}

export function FindPanel({ c }: { c: Controller }) { return c.dialog === 'find' ? <Find c={c} /> : null; }
