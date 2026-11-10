// The comment sidebar (SwPostItMgr and SwAnnotationWin): one card per comment beside the page,
// at its anchor's height and pushed down so that cards never overlap. Cards are DOM, so comment
// text is editable with the browser's own text field and reachable by assistive technology.
import { useLayoutEffect, useRef } from 'react';
import { TWIPS_PER_CSS_PX } from '@lo/sw/source/core/view/paint.ts';
import { COMMENT_SIDEBAR } from '@lo/sw/source/core/layout/pagechg.ts';
import type { Controller } from '../controller.ts';

const GAP = 8; // px between stacked cards

export function Comments({ c }: { c: Controller }) {
  const root = c.sh.m_pRoot;
  const refs = useRef(new Map<string, HTMLElement>());
  const anchors = root.m_bShowComments ? root.m_aAnnotationAnchors.filter((a) => c.showResolvedComments || !a.field.resolved) : [];
  const f = c.zoom / TWIPS_PER_CSS_PX;

  // Stack the cards top-down once their heights are known.
  useLayoutEffect(() => {
    let bottom = -Infinity;
    for (const a of anchors) {
      const el = refs.current.get(a.field.id);
      if (!el) continue;
      const top = Math.max(a.y * f, bottom + GAP);
      el.style.top = `${top}px`;
      bottom = top + el.offsetHeight;
    }
  });

  if (!anchors.length) return null;
  return (
    <div className="comments" aria-label="Comments">
      {anchors.map((a) => {
        const date = new Date(a.field.date);
        return (
          <article key={a.field.id} ref={(el) => { if (el) refs.current.set(a.field.id, el); else refs.current.delete(a.field.id); }}
            className={`comment${a.field.resolved ? ' resolved' : ''}`} style={{ left: `${(a.page.aFrame.Right() + 120) * f}px`, width: `${(COMMENT_SIDEBAR - 240) * f}px` }}
            aria-label={`Comment by ${a.field.author}`}
            onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <span className="initials" aria-hidden>{a.field.author.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
              <span className="who">
                <strong title={a.field.author}>{a.field.author}</strong>
                <time dateTime={a.field.date}>{Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
              </span>
              <button type="button" className={a.field.resolved ? 'on' : undefined} aria-pressed={a.field.resolved} aria-label="Resolved" title="Resolved"
                onClick={() => c.sh.m_pDoc.SetAnnotation(a.field.id, { resolved: !a.field.resolved })}>✓</button>
              <button type="button" aria-label="Delete comment" title="Delete Comment" onClick={() => { c.sh.m_pDoc.DeleteAnnotations(c.sh.m_pCursor, [a.field.id]); c.focusEditor(); }}>×</button>
            </header>
            <textarea aria-label="Comment text" data-comment={a.field.id} defaultValue={a.field.text} rows={Math.max(1, a.field.text.split('\n').length)}
              onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }}
              onBlur={(e) => { if (e.target.value !== a.field.text) c.sh.m_pDoc.SetAnnotation(a.field.id, { text: e.target.value }); }}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.blur(); c.focusEditor(); } }} />
          </article>
        );
      })}
    </div>
  );
}
