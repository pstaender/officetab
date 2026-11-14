import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AnyController as Controller } from '../appcontroller.ts';
import { lastColor, recentColors, toColorInt, type ColorKind } from '../colors.ts';
import { t } from '../i18n.ts';
import { dispatch, tooltip } from './registry.ts';
import { iconClass, iconColorAreaUrl, iconUrl } from '../icons.ts';

/** An icon of the chosen icon theme. */
const Icon = ({ cmd }: { cmd: string }) => { const url = iconUrl(cmd); return url ? <img src={url} className={iconClass(cmd)} alt="" draggable={false} /> : null; };

/** The commands of each kind (Writer's); an app may name others (Calc's cell background). */
export const COLOR_COMMANDS: Record<ColorKind, { cmd: string; arg: string }> = {
  font: { cmd: '.uno:Color', arg: 'Color' },
  highlight: { cmd: '.uno:CharBackColor', arg: 'CharBackColor' },
};

/**
 * The font colour or character highlighting control (svx SvxColorToolBoxControl): the button shows
 * the colour at the cursor and opens the colour window (ColorWindow), reduced to what a browser
 * needs: Automatic or No Highlighting, the recent colours, the colours the document uses, and a
 * custom colour from the browser's picker. A choice applies at once and closes the window.
 * `value` is the colour at the cursor, `used` gives the colours the document uses.
 */
export function ColorControl({ c, kind, value, used, command }: { c: Controller; kind: ColorKind; value: string | null; used: () => string[]; command?: { cmd: string; arg: string } }) {
  const CMD = { ...COLOR_COMMANDS, ...(command ? { [kind]: command } : {}) };
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const label = tooltip(CMD[kind].cmd);
  const shown = value ?? (kind === 'font' ? '#000000' : null);
  const area = shown && iconColorAreaUrl(CMD[kind].cmd, shown);
  return (
    <>
      <button ref={button} className={`tool colorpick color-control${open ? ' on' : ''}`} title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        {/* The icon's colour area shows the colour at the cursor (svx ToolboxButtonColorUpdater), in
            a layer of its own over the icon. */}
        <span className="color-icon">
          <img src={iconUrl(CMD[kind].cmd) ?? ''} alt="" draggable={false} />
          {area && <img className="color-area" src={area} alt="" draggable={false} />}
        </span>
        <span className="color-caret" aria-hidden="true">▾</span>
      </button>
      {open && button.current && <ColorWindow c={c} kind={kind} anchor={button.current} value={value} used={used} command={CMD[kind]} close={() => setOpen(false)} />}
    </>
  );
}

function ColorWindow({ c, kind, anchor, value, used: usedColors, command, close }: {
  c: Controller; kind: ColorKind; anchor: HTMLElement; value: string | null; used: () => string[]; command: { cmd: string; arg: string }; close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState(() => { const r = anchor.getBoundingClientRect(); return { left: r.left, top: r.bottom + 4 }; });
  const recent = recentColors();
  const used = usedColors();
  const { cmd, arg } = command;
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
    <section aria-label={title}>
      <h4>{title}</h4>
      <div className="color-swatches">
        {colors.map((col) => (
          <button key={col} className={`color-swatch${value && value.toLowerCase() === col ? ' on' : ''}`} style={{ background: col }} title={col} aria-label={col}
            onMouseDown={(e) => e.preventDefault()} onClick={() => apply(col)} />
        ))}
      </div>
    </section>
  );
  const recentPart = swatches(t('color.recent'), recent), usedPart = swatches(t('color.document'), used);

  return createPortal(
    <div ref={ref} className="color-window" role="dialog" aria-label={tooltip(cmd)} style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => { if (e.target !== picker.current) e.preventDefault(); }}>
      <button className="color-item" onClick={() => apply(null)}>
        <Icon cmd="app:ColorRemove" />
        {t(kind === 'font' ? 'color.automatic' : 'color.noHighlight')}
      </button>
      {(recentPart || usedPart) && <hr />}
      {recentPart}
      {usedPart}
      <hr />
      <button className="color-item" onClick={() => { const el = picker.current; if (!el) return; try { el.showPicker(); } catch { el.click(); } }}>
        <Icon cmd="app:ColorCustom" />
        {t('color.custom')}
      </button>
      <input ref={picker} type="color" className="color-picker-input" tabIndex={-1} aria-hidden="true" defaultValue={value ?? lastColor(kind)} />
    </div>,
    document.body,
  );
}
