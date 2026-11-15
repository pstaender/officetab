// The dialogs every app of the suite has: the Modal frame and form fields, Tools > Options (its
// shared pages and the app's, from the registry), File > Open's documents, Versions and Save New
// Version, Download As, Create Copy, Clear Data, the queries (Save Document?, repair, yes/no),
// About and Help > Search Commands. ShellDialogs shows the open one of them.
import { ICON_THEMES, type IconTheme } from '../icons.ts';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import { KeyboardSettings } from './KeyboardSettings.tsx';
import { CommandPopup } from './CommandPopup.tsx';
import { LOCAL_LANGUAGETOOL_URL, dateOf, type AnyController as Controller } from '../appcontroller.ts';
import { LANGUAGETOOLPLUS_DEFAULT_URL, LANGUAGETOOL_DEFAULT_URL } from '@lo/lingucomponent/source/spellcheck/languagetool/languagetoolimp.ts';
import type { StoredDocInfo } from '../storage.ts';
import { storedSummary, type WorkspaceAppSummary, type WorkspaceFile, type WorkspaceOptions } from '../workspace.ts';
import { APPS } from '../apps.ts';
import { appKey } from '../settings.ts';
import upstream from '../../../upstream.json';
import { getDisplayVersion, getProductName } from '@lo/unotools/source/config/configmgr.ts';
import { FontNameField } from './FontBoxes.tsx';
import { appRegistry } from './registry.ts';

type FileFormat = string;

export function Modal({ c, title, children, wide }: { c: Controller; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className={wide ? 'wide' : undefined} aria-label={title} onClose={() => { c.setDialog(null); c.focusEditor(); }}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

export const Actions = ({ c, ok = t('common.ok') }: { c: Controller; ok?: string }) => (
  <footer><button type="button" onClick={() => c.setDialog(null)}>{t('common.cancel')}</button><button type="submit" className="primary">{ok}</button></footer>
);

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

/** A file size in megabytes, with two decimals (at least 0.01 MB for a non-empty file). */
const formatMB = (bytes: number) => `${(bytes > 0 ? Math.max(0.01, bytes / 1_048_576) : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MB`;

/** The documents table's sort columns, and the order a column sorts in first: names and formats A to Z, the newest and largest first. */
type DocSortKey = 'name' | 'format' | 'updated' | 'size';
const DOC_SORT_FIRST: Record<DocSortKey, 'asc' | 'desc'> = { name: 'asc', format: 'asc', updated: 'desc', size: 'desc' };
const docCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** The format of the file a stored document came from (`DOCX`); empty when it was stored before formats were kept. */
const docFormat = (d: StoredDocInfo) => d.format?.toUpperCase() ?? '';
const compareDocs = (key: DocSortKey) => (a: StoredDocInfo, b: StoredDocInfo) =>
  key === 'name' ? docCollator.compare(a.name, b.name) || a.updated - b.updated
  : key === 'format' ? docCollator.compare(docFormat(a), docFormat(b)) || docCollator.compare(a.name, b.name)
  : a[key] - b[key] || docCollator.compare(a.name, b.name);

export function Documents({ c }: { c: Controller }) {
  const [docs, setDocs] = useState<StoredDocInfo[] | null>(null);
  // Newest first, as before; a header sorts by its column, and again the other way round.
  const [sort, setSort] = useState<{ key: DocSortKey; dir: 'asc' | 'desc' }>({ key: 'updated', dir: 'desc' });
  const sorted = useMemo(() => {
    const list = [...(docs ?? [])].sort(compareDocs(sort.key));
    return sort.dir === 'desc' ? list.reverse() : list;
  }, [docs, sort]);
  const sortBy = (key: DocSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DOC_SORT_FIRST[key] }));
  const head = (key: DocSortKey, label: string, num = false) => (
    <th scope="col" className={num ? 'num' : undefined} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="sort" onClick={() => sortBy(key)}>
        {label}<span className="sort-mark" aria-hidden="true">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
  const refresh = () => void c.storage.listDocs().then(setDocs).catch((e: Error) => c.setMessage(e.message));
  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Every stored document but the open one, which autosave would write back.
  const others = (docs ?? []).filter((d) => d.id !== c.docId);
  const clearAll = () => {
    if (!confirm(t('docs.clearAllConfirm', { count: others.length }))) return;
    void Promise.all(others.map((d) => c.storage.deleteDoc(d.id))).then(() => { c.setMessage(t('docs.cleared', { count: others.length })); refresh(); });
  };
  return (
    <Modal c={c} title="Open document" wide>
      <button className="primary" onClick={() => void c.openFromDisk()}>Open file from this computer…</button>
      <h3>Stored in this browser</h3>
      {docs === null ? <p>Loading…</p> : docs.length === 0 ? <p className="muted">No documents yet. Your work is saved here automatically.</p> : (
        <div className="doclist">
          <table>
            <thead><tr>{head('name', t('docs.name'))}{head('format', t('docs.format'))}{head('updated', t('docs.modified'))}{head('size', t('docs.size'), true)}<th scope="col"><span className="sr-only">{t('docs.actions')}</span></th></tr></thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id} className={d.id === c.docId ? 'current' : undefined}>
                  <td><button className="doc" onClick={() => void c.openStored(d.id)}>{d.name}</button></td>
                  <td className="muted format">{docFormat(d) || '—'}</td>
                  <td className="muted">{new Date(d.updated).toLocaleString()}</td>
                  <td className="muted num">{formatMB(d.size)}</td>
                  <td><button aria-label={`Delete ${d.name}`} disabled={d.id === c.docId} title={d.id === c.docId ? 'This document is open' : 'Delete'} onClick={() => { if (confirm(`Delete “${d.name}” from this browser?`)) void c.storage.deleteDoc(d.id).then(refresh); }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer>
        {!!others.length && <button className="danger" onClick={clearAll}>{t('docs.clearAll')}</button>}
        <button onClick={() => c.setDialog(null)}>Close</button>
      </footer>
    </Modal>
  );
}

/** A yes/no message dialog (weld::MessageDialogController), e.g. svx's DeleteHeaderDialog. */
export function MessageQuery({ c }: { c: Controller }) {
  const q = c.messageQuery;
  if (!q) return null;
  return (
    <Modal c={c} title={q.title}>
      <p><strong>{q.text}</strong></p>
      <footer>
        <button type="button" onClick={() => c.answerQuery(false)}>{t('common.no')}</button>
        <button type="button" className="primary" autoFocus onClick={() => c.answerQuery(true)}>{t('common.yes')}</button>
      </footer>
    </Modal>
  );
}

export function About({ c }: { c: Controller }) {
  return (
    <Modal c={c} title={t('about.title', { product: getProductName() })}>
      <p><strong>{getProductName()} {getDisplayVersion()}</strong></p>
      <p>{t('about.text', { product: getProductName() })}</p>
      <p className="muted">{t('about.based', { tag: upstream.tag })}</p>
      <footer><button onClick={() => c.setDialog(null)}>Close</button></footer>
    </Modal>
  );
}

/** The web shell's File > Clear Data: a warning before everything stored in this browser is deleted. */
export function ClearData({ c }: { c: Controller }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal c={c} title={t('cleardata.title')}>
      <p><strong>{t('cleardata.text')}</strong></p>
      <p className="muted">{t('cleardata.secondary')}</p>
      <footer>
        <button type="button" autoFocus disabled={busy} onClick={() => c.setDialog(null)}>{t('common.cancel')}</button>
        <button type="button" className="danger-primary" disabled={busy} onClick={() => { setBusy(true); void c.clearData(); }}>{t('cleardata.confirm')}</button>
      </footer>
    </Modal>
  );
}

/** An app's product name (Writer, Calc), the same in every language. */
const appName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/**
 * What Workspace > Export and Import take: the settings, the documents and templates, of every app
 * or of this one; with each app's documents, templates and their size, and the size chosen.
 */
function WorkspaceChoices({ c, summary, settings, settingsCount, ok, busy = false, onSubmit }: {
  c: Controller; summary: WorkspaceAppSummary[] | null; settings: boolean; settingsCount?: number; ok: string; busy?: boolean;
  onSubmit: (o: WorkspaceOptions) => void;
}) {
  const hasDocs = summary !== null && summary.some((s) => s.documents + s.templates > 0);
  const [withSettings, setWithSettings] = useState(settings);
  const [withDocs, setWithDocs] = useState(true);
  const [allApps, setAllApps] = useState(true);
  const docs = withDocs && hasDocs;
  const inScope = (s: WorkspaceAppSummary) => allApps || s.app === c.app.id;
  const total = (summary ?? []).filter(inScope).reduce((n, s) => n + s.size, 0);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!withSettings && !docs) return;
    onSubmit({ settings: withSettings && settings, documents: docs, apps: allApps ? APPS.map((a) => a.id) : [c.app.id] });
  };
  return (
    <form onSubmit={submit} className="workspace">
      <fieldset><legend>{t('workspace.include')}</legend>
        <label className="check"><input type="checkbox" name="settings" checked={withSettings && settings} disabled={!settings} onChange={(e) => setWithSettings(e.target.checked)} /> {settingsCount === undefined ? t('workspace.settings') : t('workspace.settingsN', { n: settingsCount })}</label>
        <label className="check"><input type="checkbox" name="documents" checked={docs} disabled={!hasDocs} onChange={(e) => setWithDocs(e.target.checked)} /> {t('workspace.documents')}</label>
      </fieldset>
      <fieldset><legend>{t('workspace.apps')}</legend>
        <label className="check"><input type="radio" name="apps" value="all" checked={allApps} onChange={() => setAllApps(true)} /> {t('workspace.allApps')}</label>
        <label className="check"><input type="radio" name="apps" value="current" checked={!allApps} onChange={() => setAllApps(false)} /> {t('workspace.currentApp', { app: appName(c.app.id) })}</label>
      </fieldset>
      {summary === null ? <p>{t('workspace.loading')}</p> : (
        <div className="doclist workspace-summary"><table>
          <thead><tr><th scope="col">{t('workspace.app')}</th><th scope="col" className="num">{t('workspace.docCount')}</th><th scope="col" className="num">{t('workspace.templateCount')}</th><th scope="col" className="num">{t('docs.size')}</th></tr></thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.app} className={inScope(s) && docs ? undefined : 'muted'} data-app={s.app}>
                <td>{appName(s.app)}</td><td className="num">{s.documents}</td><td className="num">{s.templates}</td><td className="num">{formatMB(s.size)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3}><strong>{t('workspace.selected')}</strong></td><td className="num" data-testid="workspace-total"><strong>{formatMB(docs ? total : 0)}</strong></td></tr></tfoot>
        </table></div>
      )}
      <footer>
        <button type="button" disabled={busy} onClick={() => c.setDialog(null)}>{t('common.cancel')}</button>
        <button type="submit" className="primary" disabled={busy || (!(withSettings && settings) && !docs)}>{ok}</button>
      </footer>
    </form>
  );
}

/** Workspace > Export: what goes into the .workspacez file. */
export function WorkspaceExport({ c }: { c: Controller }) {
  const [summary, setSummary] = useState<WorkspaceAppSummary[] | null>(null);
  useEffect(() => { void storedSummary().then(setSummary); }, []);
  return (
    <Modal c={c} title={t('workspace.export.title')}>
      <p className="muted">{t('workspace.export.text')}</p>
      <WorkspaceChoices c={c} summary={summary} settings ok={t('workspace.export.ok')} onSubmit={(o) => { c.setDialog(null); void c.exportWorkspace(o); }} />
    </Modal>
  );
}

/** Workspace > Import: what a workspace file holds, and what of it to import. */
export function WorkspaceImport({ c }: { c: Controller }) {
  const w = c.pendingWorkspace as { name: string; file: WorkspaceFile } | null;
  const [busy, setBusy] = useState(false);
  if (!w) return null;
  return (
    <Modal c={c} title={t('workspace.import.title')}>
      <p><strong>{w.name}</strong>{w.file.created ? <span className="muted"> · {new Date(w.file.created).toLocaleString()}</span> : null}</p>
      <p className="muted">{t('workspace.import.text')}</p>
      <WorkspaceChoices c={c} summary={w.file.summary} settings={w.file.settings !== null} settingsCount={w.file.settingsCount} ok={t('workspace.import.ok')} busy={busy}
        onSubmit={(o) => { setBusy(true); void c.applyWorkspace(o); }} />
    </Modal>
  );
}

/** sfx2/uiconfig/ui/querysavedialog.ui: save the changes before another document replaces this one. */
export function QuerySave({ c }: { c: Controller }) {
  return (
    <Modal c={c} title={t('querysave.title')}>
      <p><strong>{t('querysave.text', { doc: c.name })}</strong></p>
      <p className="muted">{t('querysave.secondary')}</p>
      <footer>
        <button type="button" onClick={() => void c.answerQuerySave('discard')}>{t('querysave.discard')}</button>
        <button type="button" onClick={() => void c.answerQuerySave(false)}>{t('common.cancel')}</button>
        <button type="button" className="primary" autoFocus onClick={() => void c.answerQuerySave('save')}>{t('querysave.save')}</button>
      </footer>
    </Modal>
  );
}

/**
 * uui's RequestPackageReparation query (ERRCODE_UUI_IO_BROKENPACKAGE): the file's package is
 * broken; Repair opens it with its entries recovered.
 */
export function RepairPackage({ c }: { c: Controller }) {
  const name = c.repairQuery?.name ?? '';
  return (
    <Modal c={c} title={t('repair.title')}>
      <p><strong>{t('repair.text', { name })}</strong></p>
      <p className="muted">{t('repair.secondary')}</p>
      <p>{t('repair.question')}</p>
      <footer>
        <button type="button" onClick={() => c.answerRepair(false)}>{t('repair.no')}</button>
        <button type="button" className="primary" autoFocus onClick={() => c.answerRepair(true)}>{t('repair.yes')}</button>
      </footer>
    </Modal>
  );
}

/** cui/uiconfig/ui/optuserpage.ui, reduced to the name used for new comments. */
/** A row of tabs (or the sidebar's list) with arrow-key navigation, as weld::Notebook / the options tree. */
export function Tabs({ ids, labels, current, onChange, vertical, label }: { ids: string[]; labels: Record<string, string>; current: string; onChange: (id: string) => void; vertical?: boolean; label: string }) {
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
export const Panel = ({ id, current, children }: { id: string; current: string; children: ReactNode }) => (
  <section role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={current !== id}>{children}</section>
);

/**
 * Tools > Options (the options dialog's tree, reduced to the pages that are ported): a list of
 * pages beside the selected page.
 */
export function Options({ c }: { c: Controller }) {
  const own = appRegistry().optionsPages ?? [];
  const key = appKey(c.app.id, 'optionspage');
  const [page, setPage] = useState(() => { try { return sessionStorage.getItem(key) ?? 'user'; } catch { return 'user'; } });
  const choose = (p: string) => { setPage(p); try { sessionStorage.setItem(key, p); } catch { /* storage unavailable */ } };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.author = String(f.get('name')).trim();
    for (const p of own) p.apply?.(c, f);
    // OptLanguageToolTabPage::FillItemSet: an empty base URL is the free server's; with a user
    // name and API key, the free server's URL becomes the premium one (tdf#150494, tdf#159395).
    const ltServer = f.get('ltengine') === 'server';
    let baseURL = String(f.get('ltbaseurl') ?? '').trim();
    const username = String(f.get('ltusername') ?? '').trim(), apiKey = String(f.get('ltapikey') ?? '').trim();
    if (baseURL === '' || (username === '' && apiKey === '' && baseURL === LANGUAGETOOLPLUS_DEFAULT_URL)) baseURL = LANGUAGETOOL_DEFAULT_URL;
    if (username !== '' && apiKey !== '' && baseURL === LANGUAGETOOL_DEFAULT_URL) baseURL = LANGUAGETOOLPLUS_DEFAULT_URL;
    c.setLanguageToolCfg({ IsEnabled: f.get('ltactivate') === 'on', BaseURL: ltServer ? baseURL : LOCAL_LANGUAGETOOL_URL, ServerURL: baseURL, Username: username, ApiKey: apiKey, RestProtocol: String(f.get('ltrest') ?? '').trim() });
    const theme = String(f.get('icontheme'));
    if (theme !== c.iconTheme && (ICON_THEMES as readonly string[]).includes(theme)) c.setIconTheme(theme as IconTheme);
    c.setDialog(null);
    c.notify();
  };
  // The shared pages, with the app's after the page each names.
  const pages = ['user', 'view', 'fonts', 'languagetool', 'keyboard'];
  for (const p of own) pages.splice(p.after && pages.includes(p.after) ? pages.indexOf(p.after) + 1 : pages.length, 0, p.id);
  const labels: Record<string, string> = { user: t('options.user'), view: t('options.view'), fonts: t('fonts.title'), languagetool: t('lt.title'), keyboard: t('keys.title') };
  for (const p of own) labels[p.id] = p.label();
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
          {/* LibreOffice > View: the icon theme. */}
          <Panel id="view" current={page}>
            <h3>{t('options.view')}</h3>
            <Field label={t('options.iconTheme')}>
              <select name="icontheme" defaultValue={c.iconTheme}>
                {ICON_THEMES.map((th) => <option key={th} value={th}>{t(`iconTheme.${th}`)}</option>)}
              </select>
            </Field>
            <p className="muted">{t('options.iconThemeHint')}</p>
          </Panel>
          <Panel id="fonts" current={page}><FontSettings c={c} /></Panel>
          {own.map((p) => <Panel key={p.id} id={p.id} current={page}>{p.render(c)}</Panel>)}
          <Panel id="languagetool" current={page}><LanguageToolSettings c={c} /></Panel>
          <Panel id="keyboard" current={page}><KeyboardSettings c={c} /></Panel>
        </div>
        <Actions c={c} />
      </form>
    </Modal>
  );
}

/**
 * Tools > Options > Language Settings > LanguageTool Server (cui/uiconfig/ui/langtoolconfigpage.ui),
 * with a choice of where LanguageTool runs: in this browser (the default; nothing is sent
 * anywhere) or on a server, with upstream's server settings.
 */
export function LanguageToolSettings({ c }: { c: Controller }) {
  const cfg = c.languageToolCfg;
  const [on, setOn] = useState(cfg.IsEnabled);
  const [server, setServer] = useState(cfg.BaseURL !== LOCAL_LANGUAGETOOL_URL);
  return (
    <>
      <h3>{t('lt.title')}</h3>
      <label className="check"><input type="checkbox" name="ltactivate" checked={on} onChange={(e) => setOn(e.target.checked)} /> {t('lt.activate')}</label>
      <p className="muted">{t('lt.activateHint')}</p>
      <fieldset disabled={!on} className="lt-engine">
        <label className="check"><input type="radio" name="ltengine" value="browser" checked={!server} onChange={() => setServer(false)} /> {t('lt.browser')}</label>
        <p className="muted">{t('lt.browserHint')}</p>
        <label className="check"><input type="radio" name="ltengine" value="server" checked={server} onChange={() => setServer(true)} /> {t('lt.server')}</label>
        <div hidden={!server}>
          <p className="muted">{t('lt.disclaimer')} <a href="https://languagetool.org/legal/privacy" target="_blank" rel="noreferrer">{t('lt.policy')}</a></p>
          <Field label={t('lt.base')}><input name="ltbaseurl" defaultValue={cfg.ServerURL || ''} placeholder={LANGUAGETOOL_DEFAULT_URL} /></Field>
          <p className="muted">{t('lt.urldesc')}</p>
          <Field label={t('lt.username')}><input name="ltusername" defaultValue={cfg.Username} placeholder={t('lt.leaveEmpty')} autoComplete="off" /></Field>
          <p className="muted">{t('lt.usernamedesc')}</p>
          <Field label={t('lt.apikey')}><input name="ltapikey" type="password" defaultValue={cfg.ApiKey} placeholder={t('lt.leaveEmpty')} autoComplete="off" /></Field>
          <p className="muted">{t('lt.apikeydesc')}</p>
          <Field label={t('lt.rest')}><input name="ltrest" defaultValue={cfg.RestProtocol} placeholder={t('lt.restLeaveEmpty')} /></Field>
          <p className="muted">{t('lt.restdesc')}</p>
        </div>
      </fieldset>
    </>
  );
}

/**
 * Tools > Options > Fonts: the font replacement profile (LibreOffice's fonts, Google Fonts, or the
 * user's own), its replacement table and default fonts, import and export, and the font list.
 */
export function FontSettings({ c }: { c: Controller }) {
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
              <td><FontNameField c={c} label={t('fonts.font')} value={from} readOnly={ro} onChange={(v) => setRow(k, v, to)} /></td>
              <td><FontNameField c={c} label={t('fonts.replacement')} value={to} readOnly={ro} onChange={(v) => setRow(k, from, v)} /></td>
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
          <FontNameField c={c} label={t(`fonts.${k}`)} value={p.defaults[k]} readOnly={ro} onChange={(v) => change({ ...p, defaults: { ...p.defaults, [k]: v } })} />
        </Field>
      ))}
      <label className="check"><input type="checkbox" checked={fs.alwaysReplace} onChange={(e) => { fs.setAlwaysReplace(e.target.checked); update(); }} /> {t('fonts.always')}</label>
      </Panel>
      <Panel id="list" current={tab}>
      <label className="check"><input type="checkbox" checked={fs.showAll} onChange={(e) => { fs.setShowAll(e.target.checked); update(); c.notify(); }} /> {t('fonts.showAll')}</label>
      <p className="muted">{t('fonts.showAllHint')}</p>
      <label className="check"><input type="checkbox" checked={fs.preview && !fs.showAll} disabled={fs.showAll} onChange={(e) => { fs.setPreview(e.target.checked); update(); c.notify(); }} /> {t('fonts.preview')}</label>
      <p className="muted">{t('fonts.previewHint')}</p>
      </Panel>
    </div>
  );
}

/** sfx2 ConvertWhiteSpaces_Impl: line breaks and tabs as blanks, for the list. */
const ConvertWhiteSpaces_Impl = (rText: string) => rText.replace(/[\n\t]/g, ' ');

/**
 * sfx2/uiconfig/ui/versioncommentdialog.ui (SfxViewVersionDialog_Impl): the comment of a new
 * version to enter, or of a saved one to read.
 */
export function VersionComment({ info, edit, onDone }: { info: { date?: Date; author: string; comment: string }; edit: boolean; onDone: (comment: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const title = edit ? t('versions.insertComment') : t('versions.viewComment');
  return (
    <dialog ref={ref} className="version-comment" aria-label={title} onClose={() => onDone(null)} onClick={(e) => e.stopPropagation()}>
      <h2>{title}</h2>
      <form onSubmit={(e) => { e.preventDefault(); onDone(text.current?.value ?? ''); }}>
        {!edit && info.date && <p>{t('versions.timestamp')}{info.date.toLocaleString()}</p>}
        <p>{t('versions.author')}{info.author || t('versions.noName')}</p>
        <textarea ref={text} rows={7} cols={40} defaultValue={info.comment} readOnly={!edit} autoFocus={edit} aria-label={t('versions.comments')}
          onKeyDown={(e) => { if (edit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <footer>
          {edit ? (
            <><button type="button" onClick={() => onDone(null)}>{t('common.cancel')}</button><button type="submit" className="primary">{t('common.ok')}</button></>
          ) : <button type="button" className="primary" autoFocus onClick={() => onDone(null)}>{t('versions.close')}</button>}
        </footer>
      </form>
    </dialog>
  );
}

/** The web shell's File > Save New Version (Ctrl+Alt+V): the comment, then a new version. */
export function SaveVersion({ c }: { c: Controller }) {
  return <VersionComment info={{ author: c.userFullName, comment: '' }} edit onDone={(r) => { c.setDialog(null); if (r !== null) void c.saveVersionCommand(r); }} />;
}

/** sfx2/uiconfig/ui/versionsofdialog.ui (SfxVersionDialog): File > Versions. */
export function Versions({ c }: { c: Controller }) {
  const versions = c.versions;
  // Init_Impl: the newest version is selected.
  const [sel, setSel] = useState(versions.length - 1);
  const [sub, setSub] = useState<'save' | 'show' | null>(null);
  const [busy, setBusy] = useState(false);
  const nEntry = sel >= 0 && sel < versions.length ? sel : -1;
  const cur = nEntry !== -1 ? versions[nEntry] : undefined;
  const save = async (comment: string | null) => {
    setSub(null);
    if (comment === null) return;
    setBusy(true);
    await c.saveNewVersion(comment);
    setBusy(false);
    setSel(c.versions.length - 1);
  };
  const remove = () => {
    if (!cur) return;
    c.deleteVersion(cur.Identifier);
    setSel(c.versions.length - 1);
  };
  return (
    <Modal c={c} title={t('versions.title', { doc: c.name })} wide>
      <div className="versions">
        <fieldset><legend>{t('versions.new')}</legend>
          <button type="button" disabled={busy} onClick={() => setSub('save')}>{t('versions.save')}</button>
          <label className="check"><input type="checkbox" checked={c.saveVersionOnClose} onChange={(e) => { c.saveVersionOnClose = e.currentTarget.checked; }} /> {t('versions.always')}</label>
          {c.autoSave && <p className="muted">{t('versions.autosave')}</p>}
        </fieldset>
        <fieldset><legend>{t('versions.existing')}</legend>
          {versions.length === 0 ? <p className="muted">{t('versions.none')}</p> : (
            <div className="changes-scroll"><table className="changes" role="grid">
              <thead><tr><th>{t('versions.datetime')}</th><th>{t('versions.savedby')}</th><th>{t('versions.comments')}</th></tr></thead>
              <tbody>
                {versions.map((v, i) => (
                  <tr key={v.Identifier} aria-selected={i === nEntry} className={i === nEntry ? 'selected' : undefined} onClick={() => setSel(i)} onDoubleClick={() => void c.openVersion(i)}>
                    <td>{dateOf(v.TimeStamp).toLocaleString()}</td><td>{v.Author}</td><td className="excerpt">{ConvertWhiteSpaces_Impl(v.Comment)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </fieldset>
        <footer>
          <button type="button" disabled={!cur} onClick={remove}>{t('versions.delete')}</button>
          <button type="button" disabled={!versions.length} onClick={() => { c.deleteAllVersions(); setSel(-1); }}>{t('versions.deleteAll')}</button>
          <button type="button" disabled title={t('versions.compareMissing')}>{t('versions.compare')}</button>
          <button type="button" disabled={!cur} onClick={() => setSub('show')}>{t('versions.show')}</button>
          <button type="button" disabled={!cur} onClick={() => void c.openVersion(nEntry)}>{t('versions.open')}</button>
          <button type="button" className="primary" onClick={() => c.setDialog(null)}>{t('versions.close')}</button>
        </footer>
      </div>
      {sub === 'save' && <VersionComment info={{ author: c.userFullName, comment: '' }} edit onDone={(r) => void save(r)} />}
      {sub === 'show' && cur && <VersionComment info={{ date: dateOf(cur.TimeStamp), author: cur.Author, comment: cur.Comment }} edit={false} onDone={() => setSub(null)} />}
    </Modal>
  );
}

/** The file types the shell writes, for Download As. */
function FormatSelect({ c, format = c.app.docType.id, onChange }: { c: Controller; format?: string; onChange?: (format: FileFormat) => void }) {
  return (
    <select name="format" defaultValue={format} onChange={onChange && ((e) => onChange(e.currentTarget.value as FileFormat))}>
      {c.app.saveTypes.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
    </select>
  );
}

/**
 * File > Download As (.uno:ExportTo): a copy of the document, in a chosen format, in the browser's
 * downloads. For an ODT or OTT of a document with versions, "Include version history" (on by
 * default) chooses whether the file carries them.
 */
export function Download({ c }: { c: Controller }) {
  const [format, setFormat] = useState<FileFormat>(c.fileFormat());
  const n = c.versions.length;
  const carriesVersions = n > 0 && (format === c.app.docType.id || format === c.app.templateType.id);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    c.setDialog(null);
    void c.download(String(f.get('name') ?? '').trim() || c.name, String(f.get('format')) as FileFormat, !carriesVersions || f.get('versions') === 'on');
  };
  return (
    <Modal c={c} title={t('download.title')}>
      <form onSubmit={submit}>
        <Field label={t('download.name')}><input name="name" defaultValue={c.name} autoFocus /></Field>
        <Field label={t('download.format')}><FormatSelect c={c} format={c.fileFormat()} onChange={setFormat} /></Field>
        {carriesVersions && <label className="check"><input type="checkbox" name="versions" defaultChecked /> {t(n === 1 ? 'download.versions1' : 'download.versions', { n })}</label>}
        <Actions c={c} ok={t('download.ok')} />
      </form>
    </Modal>
  );
}

/** The web shell's File > Create Copy: the name of the copy stored in the browser. */
export function CreateCopy({ c }: { c: Controller }) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    c.setDialog(null);
    void c.createCopy(name);
  };
  return (
    <Modal c={c} title={t('createcopy.title')}>
      <form onSubmit={submit}>
        <Field label={t('createcopy.name')}><input name="name" required defaultValue={t('createcopy.default', { name: c.name })} autoFocus onFocus={(e) => e.currentTarget.select()} /></Field>
        <Actions c={c} ok={t('createcopy.ok')} />
      </form>
    </Modal>
  );
}

/** The shared dialogs (ShellDialogId) as `c.dialog` opens them; null for the app's own. */
export function ShellDialogs({ c }: { c: Controller }) {
  switch (c.dialog) {
    case 'documents': return <Documents c={c} />;
    case 'query': return <MessageQuery c={c} />;
    case 'about': return <About c={c} />;
    case 'querysave': return <QuerySave c={c} />;
    case 'repairpackage': return <RepairPackage c={c} />;
    case 'cleardata': return <ClearData c={c} />;
    case 'workspaceexport': return <WorkspaceExport c={c} />;
    case 'workspaceimport': return <WorkspaceImport c={c} />;
    case 'createcopy': return <CreateCopy c={c} />;
    case 'saveversion': return <SaveVersion c={c} />;
    case 'commandpopup': return <CommandPopup c={c} />;
    case 'options': return <Options c={c} />;
    case 'versions': return <Versions c={c} />;
    case 'download': return <Download c={c} />;
    default: return null;
  }
}
