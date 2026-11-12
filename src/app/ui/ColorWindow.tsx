import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Controller } from '../controller.ts';
import { dispatch } from '../commands.ts';
import { documentColors, lastColor, recentColors, toColorInt, type ColorKind } from '../colors.ts';
import { t } from '../i18n.ts';
import { tooltip } from './labels.ts';

const CMD: Record<ColorKind, { cmd: string; arg: string }> = {
  font: { cmd: '.uno:Color', arg: 'Color' },
  highlight: { cmd: '.uno:CharBackColor', arg: 'CharBackColor' },
};

/**
 * The font colour or character highlighting control (svx SvxColorToolBoxControl): the button shows
 * the colour at the cursor and opens the colour window (ColorWindow), reduced to what a browser
 * needs: Automatic or No Highlighting, the recent colours, the colours the document uses, and a
 * custom colour from the browser's picker. A choice applies at once and closes the window.
 */
export function ColorControl({ c, kind }: { c: Controller; kind: ColorKind }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const label = tooltip(CMD[kind].cmd);
  const value: string | null = kind === 'font' ? c.sh.GetAttr('RES_CHRATR_COLOR') : c.sh.GetAttr('RES_CHRATR_BACKGROUND');
  return (
    <>
      <button ref={button} className={`tool colorpick color-control${open ? ' on' : ''}`} title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        {kind === 'font'
          ? <span style={{ borderBottomColor: value ?? 'currentColor' }}>A</span>
          : <span style={{ background: value ?? 'transparent' }}>ab</span>}
        <span className="color-caret" aria-hidden="true">▾</span>
      </button>
      {open && button.current && <ColorWindow c={c} kind={kind} anchor={button.current} value={value} close={() => setOpen(false)} />}
    </>
  );
}

function ColorWindow({ c, kind, anchor, value, close }: { c: Controller; kind: ColorKind; anchor: HTMLElement; value: string | null; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState(() => { const r = anchor.getBoundingClientRect(); return { left: r.left, top: r.bottom + 4 }; });
  const recent = recentColors();
  const used = documentColors(c.sh.m_pDoc);
  const { cmd, arg } = CMD[kind];
  const apply = (color: string | null) => {
    dispatch(c, cmd, { [arg]: color === null ? -1 : toColorInt(color) });
    close();
    c.focusEditor();
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect(), w = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - w.width - 4)), top: Math.min(r.bottom + 4, window.innerHeight - w.height - 4) });
  }, [anchor]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); c.focusEditor(); } };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [anchor, close, c]);
  // The browser's picker reports its final choice with "change" (React's onChange is "input",
  // which fires while the colour is still being dragged).
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const change = () => apply(el.value);
    el.addEventListener('change', change);
    return () => el.removeEventListener('change', change);
  });

  const swatches = (title: string, colors: string[]) => colors.length > 0 && (
    <section>
      <h4>{title}</h4>
      <div className="color-swatches">
        {colors.map((col) => (
          <button key={col} className={`color-swatch${value && value.toLowerCase() === col ? ' on' : ''}`} style={{ background: col }} title={col} aria-label={col}
            onMouseDown={(e) => e.preventDefault()} onClick={() => apply(col)} />
        ))}
      </div>
    </section>
  );

  return createPortal(
    <div ref={ref} className="color-window" role="dialog" aria-label={tooltip(cmd)} style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => { if (e.target !== picker.current) e.preventDefault(); }}>
      <button className="color-auto" onClick={() => apply(null)}>
        <span className={`color-swatch ${kind === 'font' ? 'auto' : 'none'}`} aria-hidden="true" />
        {t(kind === 'font' ? 'color.automatic' : 'color.noHighlight')}
      </button>
      {swatches(t('color.recent'), recent)}
      {swatches(t('color.document'), used)}
      <button className="color-custom" onClick={() => { const el = picker.current; if (!el) return; try { el.showPicker(); } catch { el.click(); } }}>
        <span className="color-swatch custom" aria-hidden="true" />
        {t('color.custom')}
      </button>
      <input ref={picker} type="color" className="color-picker-input" tabIndex={-1} aria-hidden="true" defaultValue={value ?? lastColor(kind)} />
    </div>,
    document.body,
  );
}
