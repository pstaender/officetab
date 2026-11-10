// Canvas text is invisible to assistive technology. This mirror renders the document's text as
// visually hidden, semantic HTML (headings, lists, tables, image descriptions, footnotes and
// comments) that screen readers can browse, and a live region announces what the caret moves over.
// It plays the part of upstream's accessibility layer (sw/source/core/access).
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CH_TXTATR_BREAKWORD } from '@lo/sw/inc/hintids.ts';
import type { SwTableNode } from '@lo/sw/inc/node.ts';
import type { SwTextNode } from '@lo/sw/inc/ndtxt.ts';
import type { Controller } from '../controller.ts';

/** The paragraph's text as read aloud: fields expanded, images described, comments spoken. */
function readable(c: Controller, n: SwTextNode): string {
  const t = n.GetText();
  let out = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== CH_TXTATR_BREAKWORD) { out += t[i] === '\t' ? ' ' : t[i]; continue; }
    const fly = n.GetCharAttrAt('RES_TXTATR_FLYCNT', i);
    const ftn = n.GetCharAttrAt('RES_TXTATR_FTN', i);
    const fld = n.GetCharAttrAt('RES_TXTATR_FIELD', i);
    const ann = n.GetCharAttrAt('RES_TXTATR_ANNOTATION', i);
    if (fly) out += ` [Image${fly.alt ? `: ${fly.alt}` : ''}] `;
    else if (ftn) out += `[footnote ${c.sh.m_pRoot.m_aFootnoteNums.get(ftn.id) ?? ''}]`;
    else if (fld) out += fld.fixed ?? (fld.type === 'PageNumber' ? `[page number]` : fld.type === 'PageCount' ? '[page count]' : `[${fld.type.toLowerCase()}]`);
    else if (ann) out += ` [Comment by ${ann.author}: ${ann.text}] `;
  }
  return out;
}

function headingLevel(n: SwTextNode): number {
  const name = n.GetTextColl().GetName();
  if (name === 'Title') return 1;
  const m = /^Heading (\d)$/.exec(name);
  return m ? Math.min(6, parseInt(m[1]!, 10)) : 0;
}

function Section({ c, from, to }: { c: Controller; from: number; to: number }) {
  const nodes = c.sh.m_pDoc.GetNodes();
  const out: ReactNode[] = [];
  let list: ReactNode[] | null = null;
  const flush = () => { if (list) { out.push(<ul key={`l${out.length}`}>{list}</ul>); list = null; } };
  for (let i = from; i < to;) {
    const n = nodes.node(i);
    if (n.IsTextNode()) {
      const text = readable(c, n);
      const num = c.sh.m_pRoot.m_aNums.get(n);
      if (num) {
        list ??= [];
        list.push(<li key={i}>{num.label && !num.fmt.IsItemize() ? `${num.label} ` : ''}{text}</li>);
      } else {
        flush();
        const h = headingLevel(n);
        const Tag = (h ? `h${h}` : 'p') as 'p';
        out.push(<Tag key={i}>{text || ' '}</Tag>);
      }
      i++;
    } else if (n.IsTableNode()) {
      flush();
      const t = n as SwTableNode;
      out.push(
        <table key={i}><tbody>
          {t.m_pTable.GetTabLines().map((l, li) => (
            <tr key={li}>{l.m_aBoxes.filter((b) => b.getRowSpan() > 0).map((b, bi) => (
              <td key={bi} rowSpan={b.getRowSpan() > 1 ? b.getRowSpan() : undefined}>
                <Section c={c} from={b.m_pStartNode!.GetIndex() + 1} to={b.m_pStartNode!.EndOfSectionNode().GetIndex()} />
              </td>
            ))}</tr>
          ))}
        </tbody></table>,
      );
      i = t.EndOfSectionNode().GetIndex() + 1;
    } else i++;
  }
  flush();
  return <>{out}</>;
}

export function A11yMirror({ c, version }: { c: Controller; version: number }) {
  // Rebuilding the mirror must never hold up typing: it follows the document at low priority.
  const deferred = useDeferredValue(version);
  return useMemo(() => <Mirror c={c} />, [c, deferred]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Mirror({ c }: { c: Controller }) {
  const nodes = c.sh.m_pDoc.GetNodes();
  const ftns = [...c.sh.m_pRoot.m_aFootnoteNums];
  return (
    <div className="sr-only" role="document" aria-label={`${c.name}, document text`} aria-readonly>
      <Section c={c} from={nodes.BodyStart()} to={nodes.GetEndOfContent().GetIndex()} />
      {ftns.length > 0 && (
        <aside aria-label="Footnotes">
          {ftns.map(([id, nr]) => {
            const s = nodes.FindFootnoteSection(id);
            return s ? <div key={id}>{`Footnote ${nr}: `}<Section c={c} from={s.GetIndex() + 1} to={s.EndOfSectionNode().GetIndex()} /></div> : null;
          })}
        </aside>
      )}
    </div>
  );
}

/** Announces the text the caret moved over: the character, or the whole line on vertical moves. */
export function CaretAnnouncer({ c, version }: { c: Controller; version: number }) {
  const [msg, setMsg] = useState('');
  const last = useRef({ node: null as SwTextNode | null, pos: -1, line: -1 });
  useEffect(() => {
    const sh = c.sh;
    const pt = sh.m_pCursor.GetPoint();
    const node = pt.GetNode(), pos = pt.GetContentIndex();
    const prev = last.current;
    if (prev.node === node && prev.pos === pos) return;
    const hit = sh.m_pRoot.FindLine(node, pos);
    const lineStart = hit?.line.nStart ?? 0;
    if (sh.HasSelection()) setMsg(`Selected: ${sh.GetSelText()}`);
    else if (prev.node !== node || prev.line !== lineStart || Math.abs(prev.pos - pos) > 1) {
      const text = node.GetText().slice(lineStart, hit ? hit.line.nStart + hit.line.nLen : undefined);
      setMsg(text.replace(new RegExp(CH_TXTATR_BREAKWORD, 'g'), '').trim() || 'blank');
    } else {
      const ch = node.GetText()[pos] ?? '';
      setMsg(ch === ' ' ? 'space' : ch === '' ? 'end of paragraph' : ch);
    }
    last.current = { node, pos, line: lineStart };
  }, [c, version]);
  return <div className="sr-only" role="status" aria-live="polite" aria-atomic>{msg}</div>;
}
