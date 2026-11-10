import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Controller } from '../controller.ts';
import { deleteDoc, listDocs, type StoredDocInfo } from '../storage.ts';
import upstream from '../../../upstream.json';
import type { FontLineStyle, SvxAdjust, SvxBreak, SvxLineSpacing } from '@lo/sw/inc/hintids.ts';

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

function Character({ c }: { c: Controller }) {
  const sh = c.sh;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const color = f.get('auto') ? null : String(f.get('color'));
    sh.SetCharAttr({
      RES_CHRATR_FONT: String(f.get('font')), RES_CHRATR_FONTSIZE: Math.round(parseFloat(String(f.get('size'))) * 20),
      RES_CHRATR_WEIGHT: !!f.get('bold'), RES_CHRATR_POSTURE: !!f.get('italic'),
      RES_CHRATR_UNDERLINE: String(f.get('underline')) as FontLineStyle, RES_CHRATR_CROSSEDOUT: !!f.get('strike'),
      RES_CHRATR_COLOR: color,
      RES_CHRATR_CASEMAP: String(f.get('casemap')) as 'none' | 'uppercase' | 'lowercase',
    });
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Character">
      <form onSubmit={submit}>
        <Field label="Font"><input name="font" defaultValue={sh.GetAttr('RES_CHRATR_FONT')} required /></Field>
        <Field label="Size (pt)"><input name="size" type="number" step="0.5" min="1" max="999" defaultValue={sh.GetAttr('RES_CHRATR_FONTSIZE') / 20} required /></Field>
        <Field label="Underline"><select name="underline" defaultValue={sh.GetAttr('RES_CHRATR_UNDERLINE')}><option value="none">None</option><option value="single">Single</option><option value="double">Double</option><option value="dotted">Dotted</option><option value="dash">Dash</option></select></Field>
        <Field label="Case"><select name="casemap" defaultValue={sh.GetAttr('RES_CHRATR_CASEMAP')}><option value="none">As typed</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option></select></Field>
        <Field label="Color"><input name="color" type="color" defaultValue={sh.GetAttr('RES_CHRATR_COLOR') ?? '#000000'} /></Field>
        <label className="check"><input name="auto" type="checkbox" defaultChecked={sh.GetAttr('RES_CHRATR_COLOR') === null} /> Automatic color</label>
        <label className="check"><input name="bold" type="checkbox" defaultChecked={sh.GetAttr('RES_CHRATR_WEIGHT')} /> Bold</label>
        <label className="check"><input name="italic" type="checkbox" defaultChecked={sh.GetAttr('RES_CHRATR_POSTURE')} /> Italic</label>
        <label className="check"><input name="strike" type="checkbox" defaultChecked={sh.GetAttr('RES_CHRATR_CROSSEDOUT')} /> Strikethrough</label>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

function Paragraph({ c }: { c: Controller }) {
  const n = c.sh.m_pCursor.GetPoint().GetNode();
  const lr = n.GetAttr('RES_LR_SPACE'), ul = n.GetAttr('RES_UL_SPACE'), ls = n.GetAttr('RES_PARATR_LINESPACING');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k));
    const rule = g('rule') as SvxLineSpacing['rule'];
    const value = rule === 'proportional' ? parseFloat(g('lsvalue')) : Math.round(parseFloat(g('lsvalue')) * CM);
    c.sh.SetParaAttr({
      RES_PARATR_ADJUST: g('adjust') as SvxAdjust,
      RES_LR_SPACE: { left: fromCm(g('left')), right: fromCm(g('right')), firstLine: fromCm(g('first')) },
      RES_UL_SPACE: { upper: fromCm(g('upper')), lower: fromCm(g('lower')) },
      RES_PARATR_LINESPACING: { rule, value } as SvxLineSpacing,
      RES_KEEP: !!f.get('keep'),
      RES_PARATR_WIDOWS: parseInt(g('widows'), 10), RES_PARATR_ORPHANS: parseInt(g('orphans'), 10),
      RES_BREAK: g('break') as SvxBreak,
    });
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Paragraph">
      <form onSubmit={submit}>
        <Field label="Alignment"><select name="adjust" defaultValue={n.GetAttr('RES_PARATR_ADJUST')}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="block">Justified</option></select></Field>
        <Field label="Before text (cm)"><input name="left" type="number" step="0.05" defaultValue={toCm(lr.left)} /></Field>
        <Field label="After text (cm)"><input name="right" type="number" step="0.05" defaultValue={toCm(lr.right)} /></Field>
        <Field label="First line (cm)"><input name="first" type="number" step="0.05" defaultValue={toCm(lr.firstLine)} /></Field>
        <Field label="Above paragraph (cm)"><input name="upper" type="number" step="0.05" min="0" defaultValue={toCm(ul.upper)} /></Field>
        <Field label="Below paragraph (cm)"><input name="lower" type="number" step="0.05" min="0" defaultValue={toCm(ul.lower)} /></Field>
        <Field label="Line spacing"><select name="rule" defaultValue={ls.rule}><option value="proportional">Proportional (%)</option><option value="min">At least (cm)</option><option value="fix">Fixed (cm)</option></select></Field>
        <Field label="Value"><input name="lsvalue" type="number" step="any" min="0" defaultValue={ls.rule === 'proportional' ? ls.value : toCm(ls.value)} /></Field>
        <Field label="Orphan lines"><input name="orphans" type="number" min="0" max="9" defaultValue={n.GetAttr('RES_PARATR_ORPHANS')} /></Field>
        <Field label="Widow lines"><input name="widows" type="number" min="0" max="9" defaultValue={n.GetAttr('RES_PARATR_WIDOWS')} /></Field>
        <Field label="Page break"><select name="break" defaultValue={n.GetAttr('RES_BREAK')}><option value="none">None</option><option value="page-before">Before</option><option value="page-after">After</option></select></Field>
        <label className="check"><input name="keep" type="checkbox" defaultChecked={n.GetAttr('RES_KEEP')} /> Keep with next paragraph</label>
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
    c.setDialog(null);
  };
  return (
    <Modal c={c} title="Page Style">
      <form onSubmit={submit}>
        <Field label="Width (cm)"><input name="w" type="number" step="0.01" min="1" defaultValue={toCm(pd.nWidth)} /></Field>
        <Field label="Height (cm)"><input name="h" type="number" step="0.01" min="1" defaultValue={toCm(pd.nHeight)} /></Field>
        <Field label="Left margin (cm)"><input name="l" type="number" step="0.01" min="0" defaultValue={toCm(pd.nLeft)} /></Field>
        <Field label="Right margin (cm)"><input name="r" type="number" step="0.01" min="0" defaultValue={toCm(pd.nRight)} /></Field>
        <Field label="Top margin (cm)"><input name="t" type="number" step="0.01" min="0" defaultValue={toCm(pd.nTop)} /></Field>
        <Field label="Bottom margin (cm)"><input name="b" type="number" step="0.01" min="0" defaultValue={toCm(pd.nBottom)} /></Field>
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

export function Dialogs({ c }: { c: Controller }) {
  switch (c.dialog) {
    case 'documents': return <Documents c={c} />;
    case 'character': return <Character c={c} />;
    case 'paragraph': return <Paragraph c={c} />;
    case 'page': return <Page c={c} />;
    case 'wordcount': return <WordCount c={c} />;
    case 'about': return <About c={c} />;
    default: return null;
  }
}

export function FindPanel({ c }: { c: Controller }) { return c.dialog === 'find' ? <Find c={c} /> : null; }
