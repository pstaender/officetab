// The font name and font size boxes, of the formatting bar and of the dialogs (cui's Font tab,
// the paragraph style dialog, the watermark dialog).
//
// Each is a native select, so it looks like the lists beside it. Where a name or size may be typed
// (the size boxes, the dialogs' name boxes, like LibreOffice's FontNameBox and FontSizeBox), a text
// field lies over the select's text and only its arrow shows. With font previews on, the font
// name boxes open FontNameBox's list instead of the native popup.
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Controller } from '../controller.ts';
import { t } from '../i18n.ts';

/** FontList::aStdSizeAry (svtools ctrltool.cxx): the sizes the font size box offers, in points. */
export const FONT_SIZES = [6, 7, 8, 9, 10, 10.5, 11, 12, 13, 14, 15, 16, 18, 20, 21, 22, 24, 26, 28, 32, 36, 40, 42, 44, 48, 54, 60, 66, 72, 80, 88, 96];

const parseSize = (s: string) => parseFloat(s.replace(',', '.'));

/**
 * FontNameBox's list (svtools ctrlbox.cxx) with previews: the fonts chosen last (its MRU entries)
 * above a separator, then every font, each name drawn in its font (DrawPreview). An entry gets its
 * font when it comes into view, so the list fetches only the fonts it shows. The list goes to the
 * top layer the box is in (the body, or a modal dialog), placed under the box, or above it when
 * there is no room below.
 */
function FontPreviewList({ c, anchor, families, current, onPick, onClose }: {
  c: Controller; anchor: HTMLElement; families: string[]; current: string;
  onPick: (name: string) => void; onClose: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const mru = c.fonts.mru;
  const entries = [...mru, ...families];
  const [cur, setCur] = useState(() => mru.length + Math.max(0, families.findIndex((f) => f.toLowerCase() === current.toLowerCase())));
  const typed = useRef({ text: '', at: 0 });
  const [pos] = useState(() => {
    const r = anchor.getBoundingClientRect();
    const below = innerHeight - r.bottom - 8, above = r.top - 8;
    return below >= Math.min(300, above) ? { left: r.left, top: r.bottom + 2, maxHeight: Math.min(480, below), minWidth: r.width } : { left: r.left, bottom: innerHeight - r.top + 2, maxHeight: Math.min(480, above), minWidth: r.width };
  });
  useLayoutEffect(() => {
    const ul = list.current!;
    ul.focus();
    const seen = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        const li = e.target as HTMLElement;
        li.style.fontFamily = c.fonts.previewFamily(li.dataset.font!);
        seen.unobserve(li);
      }
    }, { root: ul });
    for (const li of ul.querySelectorAll('li[data-font]')) seen.observe(li);
    const away = (e: MouseEvent) => { if (!ul.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', away, true);
    return () => { seen.disconnect(); document.removeEventListener('mousedown', away, true); };
  }, []);
  useLayoutEffect(() => { list.current?.querySelector(`[data-index="${cur}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cur]);
  const onKey = (e: ReactKeyboardEvent) => {
    const n = entries.length, page = 10;
    const to = (i: number) => { e.preventDefault(); setCur(Math.max(0, Math.min(n - 1, i))); };
    if (e.key === 'ArrowDown') to(cur + 1);
    else if (e.key === 'ArrowUp') { if (e.altKey) { e.preventDefault(); onPick(entries[cur]!); } else to(cur - 1); }
    else if (e.key === 'PageDown') to(cur + page);
    else if (e.key === 'PageUp') to(cur - page);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(n - 1);
    // The keys are the list's: Enter must not submit a dialog or reach the text, Escape must not close a dialog.
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onPick(entries[cur]!); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead, as in a list box: the letters typed in a row find the next font starting with them.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 800 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const i = entries.findIndex((f, k) => k >= mru.length && f.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) to(i);
    }
  };
  return createPortal(
    <ul ref={list} className="font-list" role="listbox" aria-label={t('fontname.list')} tabIndex={-1} style={pos}
      aria-activedescendant={`font-entry-${cur}`} onKeyDown={onKey}>
      {entries.map((f, i) => (
        <li key={`${i}-${f}`} id={`font-entry-${i}`} role="option" data-index={i} data-font={f}
          aria-selected={i === cur} className={i === mru.length - 1 ? 'mru-last' : undefined}
          onMouseMove={() => { if (i !== cur) setCur(i); }}
          onClick={() => onPick(f)}>{f}</li>
      ))}
    </ul>,
    anchor.closest('dialog') ?? document.body,
  );
}

/** The keys that open a list from its box: Alt+Down and F4, and Space on a select. */
const opensList = (e: ReactKeyboardEvent, select: boolean) => (e.altKey && e.key === 'ArrowDown') || e.key === 'F4' || (select && e.key === ' ');

/**
 * SvxFontNameBox_Impl (the font name box of the formatting bar): picks the font of the selection,
 * and adds it to the fonts chosen last.
 */
export function FontNameBox({ c, font, families }: { c: Controller; font: string; families: string[] }) {
  const box = useRef<HTMLSelectElement>(null);
  const [open, setOpen] = useState(false);
  const previews = c.fonts.previews;
  const apply = (name: string) => {
    c.sh.SetCharAttr({ RES_CHRATR_FONT: name });
    c.fonts.addMRU(name);
    setOpen(false);
    c.notify();
    c.focusEditor();
  };
  return (
    <div className="font-name-box">
      <select ref={box} aria-label="Font name" value={font} aria-expanded={previews ? open : undefined}
        onChange={(e) => apply(e.target.value)}
        onMouseDown={(e) => { if (previews && e.button === 0) { e.preventDefault(); box.current?.focus(); setOpen(!open); } }}
        onKeyDown={(e) => { if (previews && opensList(e, true)) { e.preventDefault(); setOpen(true); } }}>
        {families.map((f) => <option key={f}>{f}</option>)}
      </select>
      {open && <FontPreviewList c={c} anchor={box.current!} families={families} current={font}
        onPick={apply} onClose={() => { setOpen(false); box.current?.focus(); }} />}
    </div>
  );
}

/**
 * A dialog's font name box (cui's Font tab, FontNameBox): any name may be typed, or one picked
 * from the list. In a form it is the field `name`; with `onChange` it is controlled by `value`.
 * As in LibreOffice, only the formatting bar's box adds to the fonts chosen last.
 */
export function FontNameField({ c, name, value, onChange, label, readOnly, required = !!name }: {
  c: Controller; name?: string; value: string; onChange?: (v: string) => void; label: string; readOnly?: boolean; required?: boolean;
}) {
  const [own, setOwn] = useState(value);
  const text = onChange ? value : own;
  const setText = onChange ?? setOwn;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLSelectElement>(null);
  const families = c.fonts.listFonts([value, ...c.documentFonts()].filter(Boolean));
  const previews = c.fonts.previews;
  const choose = (f: string) => { setText(f); setOpen(false); input.current?.focus(); };
  const showList = () => {
    if (readOnly) return;
    if (previews) { setOpen(true); return; }
    try { pick.current?.showPicker(); } catch { pick.current?.focus(); }
  };
  const known = families.find((f) => f.toLowerCase() === text.trim().toLowerCase());
  return (
    <div className="font-combo" ref={wrap}>
      <input ref={input} name={name} aria-label={label} role="combobox" aria-expanded={open} value={text} required={required} readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (opensList(e, false)) { e.preventDefault(); showList(); } }} />
      <select ref={pick} aria-label={t('fontname.list')} tabIndex={-1} value={known ?? ''}
        onChange={(e) => { if (e.target.value) choose(e.target.value); }}
        disabled={readOnly}
        onMouseDown={(e) => { if (previews && e.button === 0) { e.preventDefault(); setOpen(!open); } }}>
        <option value="" hidden>{text}</option>
        {families.map((f) => <option key={f}>{f}</option>)}
      </select>
      {open && <FontPreviewList c={c} anchor={wrap.current!} families={families} current={text}
        onPick={choose} onClose={() => { setOpen(false); input.current?.focus(); }} />}
    </div>
  );
}

/**
 * FontSizeBox / SvxFontSizeBox_Base: type a size, or pick one of the standard sizes from the list;
 * Up and Down step through them, Alt+Down opens the list. With `onApply` (the formatting bar) Enter
 * applies the size and Escape restores it; in a dialog the size is the form field `name`.
 */
export function FontSizeCombo({ value, label, name, onApply, onCancel }: {
  value: number; label: string; name?: string; onApply?: (pt: number) => void; onCancel?: () => void;
}) {
  const [text, setText] = useState(String(value));
  const pick = useRef<HTMLSelectElement>(null);
  useEffect(() => { setText(String(value)); }, [value]);
  const apply = (v: number) => {
    // FontSizeBox: sizes from 1 to 999.9 pt, in tenths. The field shows the size at once, also
    // when it only applies to the next text typed.
    if (!(v >= 1 && v <= 999.9)) { setText(String(value)); return; }
    setText(String(Math.round(v * 10) / 10));
    onApply?.(Math.round(v * 10) / 10);
  };
  const step = (dir: 1 | -1) => {
    const cur = parseSize(text);
    const i = dir > 0 ? FONT_SIZES.findIndex((s) => s > cur) : FONT_SIZES.length - 1 - [...FONT_SIZES].reverse().findIndex((s) => s < cur);
    if (i >= 0 && i < FONT_SIZES.length) setText(String(FONT_SIZES[i]));
  };
  const shown = parseSize(text);
  return (
    <div className={onApply ? 'font-size-box' : 'font-combo font-size-combo'}>
      <input aria-label={label} name={name} className="font-size" role="combobox" aria-expanded={false} value={text}
        inputMode="decimal" required={!!name}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => { if (name && !(shown >= 1 && shown <= 999.9)) setText(String(value)); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onApply) {
            // The key is the box's: it must not reach the text as a new paragraph.
            e.preventDefault();
            e.stopPropagation();
            apply(shown);
          } else if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            setText(String(value));
            onCancel();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (e.altKey) { try { pick.current?.showPicker(); } catch { pick.current?.focus(); } return; }
            step(e.key === 'ArrowDown' ? 1 : -1);
          }
        }} />
      <select ref={pick} aria-label={t('fontsize.list')} tabIndex={-1} value={FONT_SIZES.includes(shown) ? String(shown) : ''}
        onChange={(e) => { if (e.target.value) apply(parseFloat(e.target.value)); }}>
        <option value="" hidden>{text}</option>
        {FONT_SIZES.map((s) => <option key={s} value={String(s)}>{s}</option>)}
      </select>
    </div>
  );
}

/** The formatting bar's font size box: sets the size of the selection. */
export function FontSizeBox({ c, size }: { c: Controller; size: number }) {
  return (
    <FontSizeCombo value={size} label="Font size"
      onApply={(pt) => { c.sh.SetCharAttr({ RES_CHRATR_FONTSIZE: Math.round(pt * 20) }); c.notify(); c.focusEditor(); }}
      onCancel={() => c.focusEditor()} />
  );
}
