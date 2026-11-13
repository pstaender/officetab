// The template dialogs of sfx2: the template manager (templatedlg.ui, SfxTemplateManagerDlg), its
// category and name dialogs (templatecategorydlg.ui, InputDialog), Save as Template
// (saveastemplatedlg.ui, SfxSaveAsTemplateDialog) and Load Styles from Template
// (loadtemplatedialog.ui, SfxNewFileDialog in LoadTemplate mode).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import type { Controller } from '../controller.ts';
import {
  categories, createRegion, getDefaultTemplate, isBuiltInRegion, MY_TEMPLATES, moveTemplate, regionName, removeRegion,
  removeTemplate, renameRegion, renameTemplate, setDefaultTemplate, thumbnailUrl, type TemplateItem,
} from '../templates.ts';
import { DefaultTemplateFlags, SfxTemplateFlags } from '@lo/sw/source/uibase/app/docsh2.ts';
import { Field, Modal } from './Dialogs.tsx';

/** The template manager's settings (TM_SETTING_LASTFOLDER, TM_SETTING_VIEWMODE), kept for the next time. */
const LS_MANAGER = 'writer:template-manager';
type ViewMode = 'thumbnail' | 'list';
function readSettings(): { folder: string; view: ViewMode } {
  try {
    const v = JSON.parse(localStorage.getItem(LS_MANAGER) ?? '{}') as { folder?: unknown; view?: unknown };
    return { folder: typeof v.folder === 'string' ? v.folder : '', view: v.view === 'list' ? 'list' : 'thumbnail' };
  } catch { return { folder: '', view: 'thumbnail' }; }
}
function writeSettings(s: { folder: string; view: ViewMode }): void {
  try { localStorage.setItem(LS_MANAGER, JSON.stringify(s)); } catch { /* storage may be unavailable */ }
}

const formatSize = (n: number) => (n ? `${(n / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB` : '');

/** A dialog over another dialog: its own modal, closed by its buttons or Escape. */
function SubDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} aria-label={title} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => e.stopPropagation()}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

/**
 * vcl's InputDialog: a name to enter. `check` returns an error for a name that cannot be taken
 * (setCheckEntry with its tooltip), which keeps OK disabled.
 */
function InputDialog({ title, label, value = '', check, onDone }: { title: string; label: string; value?: string; check?: (v: string) => string | null; onDone: (v: string | null) => void }) {
  const [text, setText] = useState(value);
  const error = check?.(text.trim()) ?? null;
  return (
    <SubDialog title={title} onClose={() => onDone(null)}>
      <form onSubmit={(e) => { e.preventDefault(); if (!error && text.trim()) onDone(text.trim()); }}>
        <Field label={label}><input value={text} onChange={(e) => setText(e.currentTarget.value)} autoFocus onFocus={(e) => e.currentTarget.select()} aria-invalid={!!error} /></Field>
        {error && <p className="tm-error" role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={() => onDone(null)}>{t('common.cancel')}</button>
          <button type="submit" className="primary" disabled={!!error || !text.trim()}>{t('common.ok')}</button>
        </footer>
      </form>
    </SubDialog>
  );
}

/**
 * templatecategorydlg.ui (SfxTemplateCategoryDialog): an existing category, or a new one to make.
 * `onDone` gets the category and whether it is new.
 */
function CategoryDialog({ regions, onDone }: { regions: string[]; onDone: (r: { region: string; isNew: boolean } | null) => void }) {
  const [sel, setSel] = useState(-1);
  const [fresh, setFresh] = useState('');
  const newName = fresh.trim();
  const ok = newName ? true : sel >= 0;
  return (
    <SubDialog title={t('templates.selectCategory')} onClose={() => onDone(null)}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onDone(newName ? { region: newName, isNew: true } : { region: regions[sel]!, isNew: false }); }}>
        <p className="tm-label" id="tm-cat-existing">{t('templates.existingCategory')}</p>
        <select size={8} className="tm-select" aria-labelledby="tm-cat-existing" disabled={!!newName} value={sel < 0 ? '' : String(sel)} onChange={(e) => setSel(e.currentTarget.value === '' ? -1 : Number(e.currentTarget.value))}>
          <option value="">{t('templates.categoryNone')}</option>
          {regions.map((r, i) => <option key={r} value={i}>{regionName(r)}</option>)}
        </select>
        <Field label={t('templates.newCategoryLabel')}><input value={fresh} onChange={(e) => setFresh(e.currentTarget.value)} /></Field>
        <footer>
          <button type="button" onClick={() => onDone(null)}>{t('common.cancel')}</button>
          <button type="submit" className="primary" disabled={!ok}>{t('common.ok')}</button>
        </footer>
      </form>
    </SubDialog>
  );
}

/** A template's thumbnail (ThumbnailViewItem), or a blank page while there is none. */
function Thumbnail({ item }: { item: TemplateItem }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void thumbnailUrl(item.id, item.updated).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [item.id, item.updated]);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="tm-blank" aria-hidden="true" />;
}

type Sub =
  | { kind: 'input'; title: string; label: string; value?: string; check?: (v: string) => string | null; done: (v: string) => void | Promise<void> }
  | { kind: 'category'; done: (region: string, isNew: boolean) => void | Promise<void> };

/**
 * File > Templates > Manage Templates (SfxTemplateManagerDlg): the templates by category, found by
 * name, in thumbnails or a list. A template opens as a new document (Open, a double click), opens
 * for editing (Edit), becomes the template of new documents (Set as Default), is renamed, deleted,
 * moved to another category or exported (downloaded). Manage makes, renames and deletes
 * categories, resets the default template and imports template files. Only text document
 * templates exist here, so there is no application filter.
 */
export function TemplateManager({ c }: { c: Controller }) {
  const saved = useMemo(readSettings, []);
  const [items, setItems] = useState<TemplateItem[] | null>(null);
  const [folder, setFolder] = useState(saved.folder);
  const [view, setView] = useState<ViewMode>(saved.view);
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [manage, setManage] = useState(false);
  const [sub, setSub] = useState<Sub | null>(null);
  const [def, setDef] = useState(getDefaultTemplate());
  const fileInput = useRef<HTMLInputElement>(null);
  const importTo = useRef(MY_TEMPLATES);
  const listRef = useRef<HTMLDivElement>(null);

  const reload = async () => { try { setItems(await c.listTemplates()); } catch (e) { c.setMessage((e as Error).message); } };
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const regions = useMemo(() => (items ? categories(items) : [MY_TEMPLATES]), [items]);
  // A remembered category that no longer exists shows all (readSettings' aLastFolder).
  const region = regions.includes(folder) ? folder : '';
  useEffect(() => { writeSettings({ folder: region, view }); }, [region, view]);
  const needle = search.trim().toLowerCase();
  const shown = useMemo(() => (items ?? []).filter((i) => (!region || i.region === region) && (!needle || i.name.toLowerCase().includes(needle))), [items, region, needle]);
  const selected = shown.filter((i) => sel.includes(i.id));
  const single = selected.length === 1 ? selected[0]! : null;

  const close = () => c.setDialog(null);
  const open = (item: TemplateItem) => { close(); void c.newFromTemplate(item.id); };
  const edit = (item: TemplateItem) => { close(); void c.editTemplate(item.id); };

  // ThumbnailView's selection: a click selects one, Ctrl (Cmd) adds or removes one, Shift a range.
  const click = (item: TemplateItem, e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) { setSel((s) => (s.includes(item.id) ? s.filter((x) => x !== item.id) : [...s, item.id])); setAnchor(item.id); return; }
    if (e.shiftKey && anchor) {
      const a = shown.findIndex((i) => i.id === anchor), b = shown.findIndex((i) => i.id === item.id);
      if (a >= 0 && b >= 0) { setSel(shown.slice(Math.min(a, b), Math.max(a, b) + 1).map((i) => i.id)); return; }
    }
    setSel([item.id]);
    setAnchor(item.id);
  };
  const contextMenu = (item: TemplateItem, e: MouseEvent) => {
    e.preventDefault();
    if (!sel.includes(item.id)) { setSel([item.id]); setAnchor(item.id); }
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const keyDown = (e: KeyboardEvent) => {
    const at = shown.findIndex((i) => i.id === (anchor ?? sel[0]));
    if (e.key === 'Enter' && single) { e.preventDefault(); open(single); return; }
    if (e.key === 'Delete' && selected.length) { e.preventDefault(); void remove(); return; }
    if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && selected.length) {
      e.preventDefault();
      const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      const r = el?.getBoundingClientRect();
      setMenu({ x: r ? r.left + 8 : 0, y: r ? r.bottom - 8 : 0 });
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step && shown.length) {
      e.preventDefault();
      const next = shown[Math.max(0, Math.min(shown.length - 1, at < 0 ? 0 : at + step))]!;
      setSel([next.id]);
      setAnchor(next.id);
      listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  // --- the context menu's actions (TemplateLocalView::ContextMenuSelectHdl) ---
  const toggleDefault = () => {
    if (!single) return;
    const id = def === single.id ? null : single.id;
    setDefaultTemplate(id);
    setDef(id);
  };
  const rename = () => {
    if (!single) return;
    const others = (items ?? []).filter((i) => i.region === single.region && i.id !== single.id);
    setSub({
      kind: 'input', title: t('templates.renameTitle'), label: t('templates.renameLabel'), value: single.name,
      check: (v) => (v && v !== single.name && others.some((i) => i.name === v) ? t('templates.renameExists', { name: v, category: regionName(single.region) }) : null),
      done: async (v) => { if (v !== single.name) { await renameTemplate(single.id, v); await reload(); } },
    });
  };
  async function remove() {
    if (!selected.length || !confirm(t('templates.deleteConfirm'))) return;
    const failed: string[] = [];
    for (const i of selected) if (!(await removeTemplate(i.id))) failed.push(i.name);
    if (failed.length) c.setMessage(t('templates.deleteFailed', { names: failed.join(', ') }));
    setSel([]);
    setDef(getDefaultTemplate());
    await reload();
  }
  const move = () => {
    const ids = selected.map((i) => i.id);
    setSub({
      kind: 'category',
      done: async (target, isNew) => {
        if (isNew && !createRegion(target, items ?? [])) { c.setMessage(t('templates.createError', { name: target })); return; }
        for (const id of ids) await moveTemplate(id, target, (i, r) => c.copyTemplate(i, r));
        await reload();
      },
    });
  };
  const exportSel = async () => {
    const n = selected.length;
    await c.exportTemplates(selected.map((i) => i.id));
    setSel([]);
    c.setMessage(t('templates.exported', { n }));
  };

  // --- Manage (MenuSelectHdl) ---
  const newCategory = () => setSub({
    kind: 'input', title: t('templates.newCategoryTitle'), label: t('templates.categoryName'),
    done: async (v) => { if (!createRegion(v, items ?? [])) c.setMessage(t('templates.createError', { name: v })); else { await reload(); setFolder(regionOf(v)); } },
  });
  const regionOf = (v: string) => regions.find((r) => regionName(r) === v) ?? v;
  const renameCategory = () => setSub({
    kind: 'input', title: t('templates.renameCategoryTitle'), label: t('templates.categoryName'), value: region,
    done: async (v) => { if (!(await renameRegion(region, v, items ?? []))) c.setMessage(t('templates.createError', { name: v })); else { await reload(); setFolder(v); } },
  });
  const deleteCategory = async () => {
    if (!confirm(t('templates.deleteCategoryConfirm', { name: regionName(region) }))) return;
    if (!(await removeRegion(region, items ?? []))) c.setMessage(t('templates.deleteCategoryFailed', { name: regionName(region) }));
    setFolder('');
    setDef(getDefaultTemplate());
    await reload();
  };
  const resetDefault = () => { setDefaultTemplate(null); setDef(null); };
  const importFiles = () => {
    const pick = (target: string) => { importTo.current = target; fileInput.current?.click(); };
    if (region) { pick(region); return; }
    setSub({
      kind: 'category',
      done: (target, isNew) => {
        if (isNew && !createRegion(target, items ?? [])) { c.setMessage(t('templates.createError', { name: target })); return; }
        pick(target);
      },
    });
  };
  const imported = async (files: File[]) => {
    const failed = await c.importTemplates(files, importTo.current);
    if (failed.length) c.setMessage(t('templates.importFailed', { category: regionName(importTo.current), names: failed.join(', ') }));
    await reload();
  };

  const anyBuiltIn = selected.some((i) => i.builtIn);
  const menuItem = (label: string, run: () => void, enabled = true) => (
    <button type="button" role="menuitem" disabled={!enabled} onClick={() => { setMenu(null); setManage(false); run(); }}>{label}</button>
  );
  const done = (s: Sub, v: string | null) => { setSub(null); if (v !== null && s.kind === 'input') void s.done(v); };

  return (
    <Modal c={c} title={t('templates.title')} wide>
      <div className="template-manager" onClick={() => { setMenu(null); setManage(false); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && (menu || manage)) { e.preventDefault(); e.stopPropagation(); setMenu(null); setManage(false); listRef.current?.focus(); } }}>
        <div className="tm-bar">
          <input type="search" className="tm-search" placeholder={t('templates.search')} aria-label={t('templates.searchLabel')} value={search}
            onChange={(e) => setSearch(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Escape' && search) { e.preventDefault(); e.stopPropagation(); setSearch(''); } }} />
          <label className="tm-filter"><span>{t('templates.filter')}</span>
            <select aria-label={t('templates.filterCategory')} value={region} onChange={(e) => { setFolder(e.currentTarget.value); setSel([]); }}>
              <option value="">{t('templates.allCategories')}</option>
              {regions.map((r) => <option key={r} value={r}>{regionName(r)}</option>)}
            </select>
          </label>
          <div className="tm-views" role="group" aria-label={t('templates.view')}>
            <button type="button" aria-pressed={view === 'thumbnail'} title={t('templates.thumbnailView')} aria-label={t('templates.thumbnailView')} onClick={() => setView('thumbnail')}>▦</button>
            <button type="button" aria-pressed={view === 'list'} title={t('templates.listView')} aria-label={t('templates.listView')} onClick={() => setView('list')}>☰</button>
          </div>
        </div>
        <div ref={listRef} className={`tm-items ${view}`} role="listbox" aria-multiselectable="true" aria-label={t('templates.list')} tabIndex={0} onKeyDown={keyDown}
          onClick={(e) => { if (e.target === e.currentTarget) setSel([]); }}>
          {items === null ? <p className="muted">{t('templates.loading')}</p> : shown.length === 0 ? <p className="muted">{t('templates.none')}</p> : view === 'thumbnail' ? shown.map((i) => (
            <div key={i.id} data-id={i.id} role="option" aria-selected={sel.includes(i.id)} aria-description={def === i.id ? t('templates.isDefault') : undefined} className="tm-item" title={t('templates.tooltip', { name: i.name, category: regionName(i.region) })}
              onClick={(e) => { e.stopPropagation(); setMenu(null); click(i, e); }} onDoubleClick={() => open(i)} onContextMenu={(e) => { e.stopPropagation(); contextMenu(i, e); }}>
              <span className="tm-thumb"><Thumbnail item={i} />{def === i.id && <span className="tm-default" title={t('templates.isDefault')} aria-hidden="true">★</span>}</span>
              <span className="tm-name">{i.name}</span>
            </div>
          )) : (
            <table className="changes">
              <thead><tr><th>{t('templates.colName')}</th><th>{t('templates.colCategory')}</th><th>{t('templates.colApplication')}</th><th>{t('templates.colModified')}</th><th>{t('templates.colSize')}</th></tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} data-id={i.id} role="option" aria-selected={sel.includes(i.id)} aria-description={def === i.id ? t('templates.isDefault') : undefined} className={sel.includes(i.id) ? 'selected' : undefined}
                    onClick={(e) => { e.stopPropagation(); setMenu(null); click(i, e); }} onDoubleClick={() => open(i)} onContextMenu={(e) => { e.stopPropagation(); contextMenu(i, e); }}>
                    <td>{def === i.id && <span aria-hidden="true">★ </span>}{i.name}</td><td>{regionName(i.region)}</td><td>{t('templates.writer')}</td>
                    <td>{i.updated ? new Date(i.updated).toLocaleString() : ''}</td><td className="num">{formatSize(i.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {menu && (
          <div className="spell-menu tm-menu" role="menu" aria-label={t('templates.actions')} style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 280) }} onClick={(e) => e.stopPropagation()}>
            {menuItem(t('templates.open'), () => single && open(single), !!single)}
            {menuItem(t('templates.edit'), () => single && edit(single), !!single)}
            {menuItem(single && def === single.id ? t('templates.resetDefault') : t('templates.setDefault'), toggleDefault, !!single)}
            <hr />
            {menuItem(t('templates.rename'), rename, !!single && !anyBuiltIn)}
            {menuItem(t('templates.delete'), () => void remove(), !anyBuiltIn)}
            <hr />
            {menuItem(t('templates.move'), move)}
            {menuItem(t('templates.export'), () => void exportSel())}
          </div>
        )}
        <footer>
          <div className="tm-manage">
            <button type="button" aria-haspopup="menu" aria-expanded={manage} onClick={(e) => { e.stopPropagation(); setMenu(null); setManage(!manage); }}>{t('templates.manage')} ▾</button>
            {manage && (
              <div className="spell-menu tm-menu up" role="menu" aria-label={t('templates.manage')} onClick={(e) => e.stopPropagation()}>
                {menuItem(t('templates.newCategory'), newCategory)}
                {menuItem(t('templates.renameCategory'), renameCategory, !!region && !isBuiltInRegion(region))}
                {menuItem(t('templates.deleteCategory'), () => void deleteCategory(), !!region && !isBuiltInRegion(region))}
                <hr />
                {menuItem(t('templates.resetDefaultText'), resetDefault, !!def)}
                <hr />
                {menuItem(t('templates.import'), importFiles)}
              </div>
            )}
          </div>
          <button type="button" onClick={close}>{t('templates.close')}</button>
          <button type="button" className="primary" disabled={!single} onClick={() => single && open(single)}>{t('templates.open')}</button>
        </footer>
        <input ref={fileInput} type="file" multiple hidden accept=".ott,.dotx,.dot" aria-label={t('templates.import')}
          onChange={(e) => { const f = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; if (f.length) void imported(f); }} />
      </div>
      {sub?.kind === 'input' && <InputDialog title={sub.title} label={sub.label} value={sub.value} check={sub.check} onDone={(v) => done(sub, v)} />}
      {sub?.kind === 'category' && <CategoryDialog regions={regions} onDone={(r) => { setSub(null); if (r) void sub.done(r.region, r.isNew); }} />}
    </Modal>
  );
}

/**
 * File > Templates > Save as Template (SfxSaveAsTemplateDialog): the document as a template under
 * a name, in a category; a name the category has asks to overwrite that template. "Set as default
 * template" makes new documents from it.
 */
export function SaveAsTemplate({ c }: { c: Controller }) {
  const [items, setItems] = useState<TemplateItem[] | null>(null);
  const [name, setName] = useState('');
  const [sel, setSel] = useState('');
  const [asDefault, setAsDefault] = useState(false);
  useEffect(() => { void c.listTemplates().then(setItems).catch(() => setItems([])); }, [c]);
  const regions = items ? categories(items) : [];
  const n = name.trim();
  // SelectCategoryHdl: None (the first entry) keeps Save disabled.
  const ok = !!n && !!sel;
  const submit = async () => {
    if (!ok) return;
    const existing = (items ?? []).find((i) => i.region === sel && i.name === n);
    if (existing && !confirm(t('templates.overwrite', { name: n, category: regionName(sel) }))) return;
    c.setDialog(null);
    await c.saveAsTemplate(n, sel, asDefault, existing && !existing.builtIn ? existing.id : undefined);
  };
  return (
    <Modal c={c} title={t('saveastemplate.title')}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label={t('saveastemplate.name')}><input value={name} onChange={(e) => setName(e.currentTarget.value)} autoFocus /></Field>
        <p className="tm-label" id="sat-category">{t('saveastemplate.category')}</p>
        <select size={8} className="tm-select" aria-labelledby="sat-category" value={sel} onChange={(e) => setSel(e.currentTarget.value)}>
          <option value="">{t('templates.categoryNone')}</option>
          {regions.map((r) => <option key={r} value={r}>{regionName(r)}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.currentTarget.checked)} /> {t('saveastemplate.default')}</label>
        <footer>
          <button type="button" onClick={() => c.setDialog(null)}>{t('common.cancel')}</button>
          <button type="submit" className="primary" disabled={!ok}>{t('saveastemplate.save')}</button>
        </footer>
      </form>
    </Modal>
  );
}

/** SID_TEMPLATE_LOAD's static choices: the dialog starts with the last ones (SwDocShell::Execute). */
let lastFlags: number = DefaultTemplateFlags();

/**
 * Styles > Load Styles from Template (SfxNewFileDialog, LoadTemplate mode): a template by category,
 * or another file (From File), and which styles to load. Frame styles are not ported.
 */
export function LoadStyles({ c }: { c: Controller }) {
  const [items, setItems] = useState<TemplateItem[] | null>(null);
  const [region, setRegion] = useState<string>(MY_TEMPLATES);
  const [tpl, setTpl] = useState('');
  const [flags, setFlags] = useState(lastFlags);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { void c.listTemplates().then(setItems).catch(() => setItems([])); }, [c]);
  const regions = items ? categories(items) : [];
  const inRegion = (items ?? []).filter((i) => i.region === region);
  // A list box shows its first entry selected when none is chosen: that entry is the selection, so
  // OK loads what is shown (clicking it again would not report a change).
  const chosen = inRegion.some((i) => i.id === tpl) ? tpl : inRegion[0]?.id ?? '';
  const flag = (f: number, label: string, disabled = false, title?: string) => (
    <label className="check" title={title}><input type="checkbox" disabled={disabled} checked={!disabled && !!(flags & f)} onChange={(e) => setFlags(e.currentTarget.checked ? flags | f : flags & ~f)} /> {label}</label>
  );
  const load = (source: { id: string } | { file: File }) => {
    lastFlags = flags;
    c.setDialog(null);
    void c.loadStyles(source, flags);
  };
  return (
    <Modal c={c} title={t('loadstyles.title')} wide>
      <form className="load-styles" onSubmit={(e) => { e.preventDefault(); if (chosen) load({ id: chosen }); }}>
        <div className="ls-lists">
          <div>
            <p className="tm-label" id="ls-categories">{t('loadstyles.categories')}</p>
            <select size={8} className="tm-select" aria-labelledby="ls-categories" value={region} onChange={(e) => { setRegion(e.currentTarget.value); setTpl(''); }}>
              {regions.map((r) => <option key={r} value={r}>{regionName(r)}</option>)}
            </select>
          </div>
          <div>
            <p className="tm-label" id="ls-templates">{t('loadstyles.templates')}</p>
            <select size={8} className="tm-select" aria-labelledby="ls-templates" value={chosen} onChange={(e) => setTpl(e.currentTarget.value)} onDoubleClick={() => { if (chosen) load({ id: chosen }); }}>
              {inRegion.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        </div>
        <div className="ls-flags">
          {flag(SfxTemplateFlags.LOAD_TEXT_STYLES, t('loadstyles.text'))}
          {flag(SfxTemplateFlags.LOAD_FRAME_STYLES, t('loadstyles.frame'), true, t('loadstyles.frameMissing'))}
          {flag(SfxTemplateFlags.LOAD_PAGE_STYLES, t('loadstyles.pages'))}
          {flag(SfxTemplateFlags.LOAD_NUM_STYLES, t('loadstyles.numbering'))}
          {flag(SfxTemplateFlags.MERGE_STYLES, t('loadstyles.overwrite'))}
        </div>
        <footer>
          <button type="button" className="tm-left" onClick={() => fileInput.current?.click()} title={t('loadstyles.fromFileTip')}>{t('loadstyles.fromFile')}</button>
          <button type="button" onClick={() => c.setDialog(null)}>{t('common.cancel')}</button>
          <button type="submit" className="primary" disabled={!chosen}>{t('common.ok')}</button>
        </footer>
        <input ref={fileInput} type="file" hidden accept=".odt,.ott" aria-label={t('loadstyles.fromFile')}
          onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) load({ file: f }); }} />
      </form>
    </Modal>
  );
}
