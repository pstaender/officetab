import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Controller } from '../controller.ts';
import { deleteDoc, listDocs, type StoredDocInfo } from '../storage.ts';
import upstream from '../../../upstream.json';
import { SwStartNodeType } from '@lo/sw/inc/ndtyp.ts';
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

const Actions = ({ c, ok = 'OK' }: { c: Controller; ok?: string }) => (
  <footer><button type="button" onClick={() => c.setDialog(null)}>Cancel</button><button type="submit" className="primary">{ok}</button></footer>
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
      <Field label="Size (pt)"><input name="size" type="number" step="0.5" min="1" max="999" defaultValue={get('RES_CHRATR_FONTSIZE') / 20} required /></Field>
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
      <Field label="Before text (cm)"><input name="left" type="number" step="0.05" defaultValue={toCm(lr.left)} /></Field>
      <Field label="After text (cm)"><input name="right" type="number" step="0.05" defaultValue={toCm(lr.right)} /></Field>
      <Field label="First line (cm)"><input name="first" type="number" step="0.05" defaultValue={toCm(lr.firstLine)} /></Field>
      <Field label="Above paragraph (cm)"><input name="upper" type="number" step="0.05" min="0" defaultValue={toCm(ul.upper)} /></Field>
      <Field label="Below paragraph (cm)"><input name="lower" type="number" step="0.05" min="0" defaultValue={toCm(ul.lower)} /></Field>
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

function Page({ c }: { c: Controller }) {
  const pd = c.sh.m_pDoc.m_aPageDesc;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => fromCm(String(f.get(k)));
    const w = g('w'), h = g('h'), l = g('l'), r = g('r'), t = g('t'), b = g('b');
    if (w - l - r < CM || h - t - b < CM) { c.setMessage('The margins leave no room for text on the page.'); return; }
    c.applyPage((p) => { p.nWidth = w; p.nHeight = h; p.nLeft = l; p.nRight = r; p.nTop = t; p.nBottom = b; });
    // Header and Footer tabs: on/off, and "Same content on first page" / "on left and right pages".
    for (const bHeader of [true, false]) {
      const k = bHeader ? 'header' : 'footer';
      const on = !!f.get(k);
      c.sh.ChangeHeaderOrFooter(bHeader, on, false);
      if (on) {
        c.sh.m_pDoc.SetHeaderFooter(c.sh.m_pCursor, bHeader, !!f.get(`${k}-first`), 'first');
        c.sh.m_pDoc.SetHeaderFooter(c.sh.m_pCursor, bHeader, !!f.get(`${k}-left`), 'left');
      }
    }
    c.setDialog(null);
  };
  const has = (bHeader: boolean, kind: 'default' | 'first' | 'left' = 'default') =>
    !!c.sh.m_pDoc.GetNodes().FindAreaSection(bHeader ? SwStartNodeType.SwHeaderStartNode : SwStartNodeType.SwFooterStartNode, kind);
  return (
    <Modal c={c} title="Page Style">
      <form onSubmit={submit}>
        <Field label="Width (cm)"><input name="w" type="number" step="0.01" min="1" defaultValue={toCm(pd.nWidth)} /></Field>
        <Field label="Height (cm)"><input name="h" type="number" step="0.01" min="1" defaultValue={toCm(pd.nHeight)} /></Field>
        <Field label="Left margin (cm)"><input name="l" type="number" step="0.01" min="0" defaultValue={toCm(pd.nLeft)} /></Field>
        <Field label="Right margin (cm)"><input name="r" type="number" step="0.01" min="0" defaultValue={toCm(pd.nRight)} /></Field>
        <Field label="Top margin (cm)"><input name="t" type="number" step="0.01" min="0" defaultValue={toCm(pd.nTop)} /></Field>
        <Field label="Bottom margin (cm)"><input name="b" type="number" step="0.01" min="0" defaultValue={toCm(pd.nBottom)} /></Field>
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
function Options({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    c.author = String(new FormData(e.currentTarget).get('name')).trim();
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Options">
      <form method="dialog" onSubmit={submit}>
        <h3>User Data</h3>
        <Field label="Name"><input name="name" defaultValue={c.author === 'Unknown Author' ? '' : c.author} placeholder="Shown as the author of your comments" autoFocus /></Field>
        <p className="muted">Stored in this browser only.</p>
        <Actions c={c} />
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
    case 'wordcount': return <WordCount c={c} />;
    case 'about': return <About c={c} />;
    case 'table': return <InsertTable c={c} />;
    case 'hyperlink': return <Hyperlink c={c} />;
    case 'specialchar': return <SpecialChar c={c} />;
    case 'options': return <Options c={c} />;
    case 'style': return <StyleDialog c={c} />;
    case 'newstyle': return <NewStyle c={c} />;
    default: return null;
  }
}

export function FindPanel({ c }: { c: Controller }) { return c.dialog === 'find' ? <Find c={c} /> : null; }
