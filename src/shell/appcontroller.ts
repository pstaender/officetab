// The part of an app's controller that is the same in every app of the suite (sfx2's share of a
// document shell and its frame, and the web shell around them): it owns the open document's
// storage, file handle, versions and autosave, and the state the React tree renders from (dialogs,
// messages, UI mode, zoom). An app's controller (src/writer/controller.ts) extends it with its
// document model and view, through the abstract hooks below.
import { DEFAULT_ICON_THEME, ICON_THEMES, setIconTheme, type IconTheme } from './icons.ts';
import { AutosaveDelay, SLOW_SAVE_MS } from './autosave.ts';
import { FontService } from './fonts.ts';
import { t } from './i18n.ts';
import { appStorage, clearAllData, type AppStorage } from './storage.ts';
import { appKey, suiteKey } from './settings.ts';
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { IsSaveVersionOnClose, SetSaveVersionOnClose, UpdateDocInfoForSave, type SfxObjectShell } from '@lo/sfx2/source/doc/objcont.ts';
import { SfxMedium } from '@lo/sfx2/source/doc/docfile.ts';
import { SaveTo_Impl, type SaveToArgs } from '@lo/sfx2/source/doc/objstor.ts';
import type { RevisionTag } from '@lo/xmloff/source/meta/xmlversion.ts';
import type { ZipEntry } from '@lo/package/source/zipapi/zip.ts';
import { BrokenPackageError } from '@lo/package/source/zipapi/zip.ts';
import type { LanguageToolCfg } from '@lo/lingucomponent/source/spellcheck/languagetool/languagetoolimp.ts';

/**
 * The base URL that stands for LanguageTool running in this browser (src/languagetool, in a Web
 * Worker): requests to it are answered by the worker in the HTTP API's format.
 */
export const LOCAL_LANGUAGETOOL_URL = 'languagetool:browser/v2';

/** The LanguageTool settings: upstream's, and the server's URL kept while the browser is chosen. */
export type LanguageToolSettings = LanguageToolCfg & { ServerURL: string };

/** The dialogs every app has; an app's own dialog ids are added to them (AppController's `D`). */
export type ShellDialogId = 'documents' | 'about' | 'options' | 'query' | 'querysave' | 'repairpackage' | 'cleardata' | 'createcopy' | 'saveversion' | 'versions' | 'download' | 'commandpopup';

/** What the base controller needs of a document model: sfx2's SfxObjectShell, and SetUnmodified. */
export type ShellDocument = SfxObjectShell & { SetUnmodified(): void };

/** An app's import of its own package format (ImportODT's result). */
export interface PackageImport<TDoc> { doc: TDoc; lost: string[]; storage?: Map<string, Uint8Array>; template?: boolean }

/**
 * A file type an app reads or writes: its id (`odt`), the Download As list's label, the save
 * dialog's description, its media type and its extensions (the first is the one written).
 */
export interface AppFileType { id: string; label: string; description: string; mime: string; exts: readonly string[] }

/** What the base controller needs to know of an app. */
export interface AppDescription {
  /** The app's id in APPS (`writer`): its storage (`lo-writer`) and settings (`writer:…`). */
  id: string;
  /** Its name, in the window title (`Writer`). */
  name: string;
  /** Its own document format (ODT) and template format (OTT), stored in the browser. */
  docType: AppFileType;
  templateType: AppFileType;
  /** The types File > Save to Computer and Download As offer (the own formats among them). */
  saveTypes: readonly AppFileType[];
  /** The types File > Open offers, as showOpenFilePicker takes them, and as an input's accept. */
  openTypes: readonly { description: string; accept: Record<string, string[]> }[];
  openAccept: string;
}

/** File > Autosave, kept for every document opened later (suite-wide). */
const LS_AUTOSAVE = 'autosave';
/** Where each stored document was left (by document id), the most recent last. */
const LS_VIEW_POSITIONS = 'view-positions';
const MAX_VIEW_POSITIONS = 100;
/** How long a passing notice (Save's versions) stays before it dismisses itself. */
export const NOTICE_TIMEOUT = 3000;
/**
 * Autosave's automatic versions: the state an editing session starts from is kept as a version,
 * unless the newest version is less than this much older than that state.
 */
const AUTO_VERSION_INTERVAL = 10 * 60 * 1000;
/** A css::util::DateTime as a Date, in local time. */
export const dateOf = (t: RevisionTag['TimeStamp']): Date => new Date(t.Year, t.Month - 1, t.Day, t.Hours, t.Minutes, t.Seconds);
const LS_UI_MODE = 'ui-mode';
const LS_ICON_THEME = 'icon-theme';
/** Menu > Classic (menu bar and toolbars) or Ribbon (the tabbed notebookbar). */
export type UiMode = 'classic' | 'ribbon';

export type FileHandle = FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> };
export type PickerWindow = typeof window & {
  showOpenFilePicker?: (o: unknown) => Promise<FileHandle[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
};

// crypto.randomUUID needs a secure context; getRandomValues also works on plain-http hosts.
export const newId = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Files from this size up show the loading indicator while they open. */
const LARGE_FILE = 300_000;

/** A file type's extensions as a regular expression's alternatives. */
const extsOf = (types: readonly AppFileType[]) => types.flatMap((f) => f.exts).join('|');

/**
 * The controller of an app: `TDoc` is its document model, `D` its own dialog ids (besides
 * ShellDialogId), `TView` where a document was left (its view settings and cursor).
 */
export abstract class AppController<TDoc extends ShellDocument = ShellDocument, D extends string = ShellDialogId, TView = unknown> {
  readonly app: AppDescription;
  /** The app's documents and templates in this browser (`lo-<app>`). */
  readonly storage: AppStorage;
  docId = newId();
  name = 'Untitled';
  handle: FileHandle | null = null;
  /** The open document is a template (.ott): it is stored, saved and downloaded as one. */
  template = false;
  /** The medium of the open document (SfxMedium): its version list and versions. */
  medium = new SfxMedium();
  zoom = 1;
  /** Tools > Options > User Data: the author of new comments and changes (suite-wide). */
  get author(): string {
    try { return localStorage.getItem(suiteKey('author')) || 'Unknown Author'; } catch { return 'Unknown Author'; }
  }
  /** SvtUserOptions::GetFullName: the user's name, empty when none is set. */
  get userFullName(): string {
    try { return localStorage.getItem(suiteKey('author')) ?? ''; } catch { return ''; }
  }
  set author(name: string) {
    try { localStorage.setItem(suiteKey('author'), name); } catch { /* storage may be unavailable */ }
    this.authorChanged();
    this.notify();
  }
  /** The user's name changed: the app passes it on (the author of new tracked changes). */
  protected authorChanged(): void {}

  dialog: D | ShellDialogId | null = null;
  message: string | null = null;
  /** Bumped on any change; React reads it through useSyncExternalStore. */
  version = 0;
  private listeners = new Set<() => void>();
  protected saveTimer: ReturnType<typeof setTimeout> | undefined;
  private canPersist = false;
  /** File > Autosave: every change is stored in the browser at once; off, only File > Save stores it. */
  autoSave = (() => { try { return localStorage.getItem(suiteKey(LS_AUTOSAVE)) !== 'false'; } catch { return true; } })();
  /** Menu > Classic or Ribbon (the default), kept for later sessions (per app). */
  uiMode: UiMode;
  /** Tools > Options > View > Icon theme (Fluent's outlines by default), kept for later sessions. */
  iconTheme: IconTheme = (() => {
    let v: string | null = null;
    try { v = localStorage.getItem(suiteKey(LS_ICON_THEME)); } catch { /* storage may be unavailable */ }
    const th = (ICON_THEMES as readonly string[]).includes(v ?? '') ? (v as IconTheme) : DEFAULT_ICON_THEME;
    setIconTheme(th, () => this.notify());
    return th;
  })();
  /** Changes made to the open document, and how many of them the browser's copy holds. */
  protected edits = 0;
  /** Counts the document's changes (for views that refresh after them, like the Navigator). */
  get editCount(): number { return this.edits; }
  private savedEdits = 0;
  /** One autosave runs at a time; changes made meanwhile are stored by one more run. */
  private saving = false;
  private saveAgain = false;
  /** Writes of the package, one after another: each copies the versions the one before wrote. */
  protected persistQueue: Promise<unknown> = Promise.resolve();
  /**
   * Autosave's versioning: the open document as it was loaded (package and time), kept as a version
   * when the first change of this session is stored; then the version waiting to be stored.
   */
  protected sessionBase: { bytes: Promise<Uint8Array>; time: Date } | null = null;
  protected pendingAutoVersion: { bytes: Promise<Uint8Array>; time: Date } | null = null;
  /** The change count when a version was last saved by hand: Save makes no version of the same state. */
  private versionEdits = 0;
  /** The answer awaited from the "Save Document?" query. */
  private querySave: ((go: boolean) => void) | null = null;
  /** The file the repair query asks about, and its awaited answer (RequestPackageReparation). */
  repairQuery: { name: string; resolve: (repair: boolean) => void } | null = null;
  /** A yes/no message dialog (weld::MessageDialogController) and its awaited answer. */
  messageQuery: { title: string; text: string; resolve: (yes: boolean) => void } | null = null;
  /** Set by the edit window: returns keyboard focus to the document. */
  focusEditor: () => void = () => {};

  /** Font profiles and web fonts (Tools > Options > Fonts). */
  readonly fonts = new FontService();

  constructor(app: AppDescription) {
    this.app = app;
    this.storage = appStorage(app.id);
    this.uiMode = (() => { try { return localStorage.getItem(appKey(app.id, LS_UI_MODE)) === 'classic' ? 'classic' : 'ribbon'; } catch { return 'ribbon'; } })();
    // The font mapping must be in place before the first layout measures text.
    this.fonts.install();
    this.fonts.watchLoading();
    this.fonts.onChange(() => this.fontsChanged());
    // A store waiting for a pause in typing happens at once when the tab is hidden or closed.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(); });
      addEventListener('pagehide', () => this.flush());
    }
  }

  // --- the app's hooks ---

  /** The open document's model. */
  abstract get document(): TDoc;
  /** A new, empty document (File > New without a default template). */
  protected abstract newDoc(): TDoc;
  /** Makes a document the open one: its view, before the shell installs its own state. */
  protected abstract installDocument(doc: TDoc): void;
  /** Connects the open document's view to the shell (its change listener, settings), after install. */
  protected abstract attach(): void;
  /** Reads the app's own package (ImportODT); `bRepairPackage` recovers a broken one. */
  protected abstract readPackage(bytes: Uint8Array, bRepairPackage?: boolean): Promise<PackageImport<TDoc>>;
  /** Writes the app's own package (ExportODT), with `extra` entries, as a template or a document. */
  protected abstract exportPackage(doc: TDoc, extra: readonly ZipEntry[], template: boolean): Promise<Uint8Array>;
  /**
   * Opens a file of any type the app reads (File > Open): installs it, reporting what it lost
   * (openedAsCopy); false when it is not opened (an unsupported type, a broken package not repaired).
   */
  protected abstract importFile(file: File, handle: FileHandle | null): Promise<boolean>;
  /** The document in another format than the app's own (by the file name's extension); null for the own formats. */
  protected abstract exportFile(filename: string): Promise<Blob | null>;
  /** Where the open document is now (kept when it is left), and where its file says it was left. */
  protected abstract currentViewPosition(): TView | null;
  protected abstract documentViewPosition(): TView | null;

  /** Before a document read from a package is installed (Writer loads its web fonts). */
  protected prepareDocument(_doc: TDoc): Promise<void> { return Promise.resolve(); }
  /** Before the document is written (Writer ends a style preview). */
  protected beforeSerialise(): void {}
  /** After Save stored the document (Writer renders a template's thumbnail). */
  protected afterSave(): Promise<void> { return Promise.resolve(); }
  /** File > New from the default template: false when there is none. */
  protected newFromDefaultTemplate(): Promise<boolean> { return Promise.resolve(false); }
  /** Tools > Options > LanguageTool changed: the app restarts its grammar checking. */
  protected languageToolChanged(_cfg: LanguageToolSettings): void {}
  /** Web fonts finished loading or the font profile changed: the app lays out again. */
  fontsChanged(): void {}
  /** The font names the document uses (for the font lists). */
  documentFonts(): Set<string> { return new Set(); }

  // --- settings shared by the suite ---

  /**
   * Tools > Options > Security: "Ctrl-click required to open hyperlinks"
   * (SvtSecurityOptions::EOption::CtrlClickHyperlink, on by default), remembered across sessions.
   */
  get ctrlClickHyperlink(): boolean {
    try { return localStorage.getItem(suiteKey('ctrlclick')) !== 'false'; } catch { return true; }
  }
  set ctrlClickHyperlink(on: boolean) {
    try { localStorage.setItem(suiteKey('ctrlclick'), String(on)); } catch { /* storage may be unavailable */ }
  }

  /**
   * Tools > Options > LanguageTool (officecfg's GrammarChecking/LanguageTool), kept in this
   * browser. LanguageTool runs in the browser by default, so that no text leaves the computer
   * unless the user chooses a server.
   */
  get languageToolCfg(): LanguageToolSettings {
    const def: LanguageToolSettings = { IsEnabled: false, BaseURL: LOCAL_LANGUAGETOOL_URL, ServerURL: '', Username: '', ApiKey: '', RestProtocol: '' };
    try { return { ...def, ...(JSON.parse(localStorage.getItem(suiteKey('languagetool')) ?? '{}') as Partial<LanguageToolSettings>) }; } catch { return def; }
  }
  setLanguageToolCfg(cfg: LanguageToolSettings): void {
    try { localStorage.setItem(suiteKey('languagetool'), JSON.stringify(cfg)); } catch { /* storage may be unavailable */ }
    this.languageToolChanged(cfg);
    this.notify();
  }

  // --- view state ---

  /** The file being opened, while it is read and laid out (the loading indicator shows it). */
  opening: string | null = null;

  /**
   * Shows the loading indicator for a large file, and lets it paint before the import and the
   * layout hold up the page.
   */
  protected async showOpening(name: string, size: number): Promise<void> {
    if (size < LARGE_FILE) return;
    this.opening = name;
    this.notify();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  }

  subscribe = (f: () => void): (() => void) => { this.listeners.add(f); return () => this.listeners.delete(f); };
  getVersion = (): number => this.version;
  notify(): void {
    this.version++;
    for (const f of this.listeners) f();
  }

  /** Whether the open document has changes not saved (the title's dot). */
  isModified(): boolean { return this.document.IsModified(); }
  get title(): string { return `${this.isModified() ? '● ' : ''}${this.name}`; }
  setDialog(d: D | ShellDialogId | null): void {
    // The "Save Document?" query closed without an answer (Escape) cancels.
    if (this.dialog === 'querysave' && d !== 'querysave' && this.querySave) void this.answerQuerySave(false);
    if (this.dialog === 'repairpackage' && d !== 'repairpackage' && this.repairQuery) this.answerRepair(false);
    if (this.dialog === 'query' && d !== 'query' && this.messageQuery) this.answerQuery(false);
    this.dialog = d;
    this.notify();
    // A dialog unmounted by state skips its close event: return focus once it has gone.
    if (d === null) setTimeout(() => this.focusEditor(), 0);
  }
  /** Buttons of the current message (an info bar's actions). */
  messageActions: { label: string; run: () => void }[] = [];
  /**
   * How long the current message (a toast over the document) stays, in milliseconds; 0 until
   * dismissed.
   */
  messageTimeout = 0;
  /** Counts messages, so that the same text shown again starts its time anew. */
  messageSeq = 0;
  setMessage(m: string | null, actions: { label: string; run: () => void }[] = [], timeout = 0): void {
    this.message = m; this.messageActions = actions; this.messageTimeout = m ? timeout : 0; this.messageSeq++; this.notify();
  }

  /**
   * The info bar of a document opened as a copy: it is edited right away and kept in this
   * browser (as the app's own format, like every document here); the file on disk stays as it was.
   * `word`: the file is Microsoft's format (the text says so).
   */
  protected openedAsCopy(lost: string[], foreign: boolean | 'word' | 'excel' = false): void {
    const key = foreign === 'excel' ? 'copy.openedExcel' : foreign ? 'copy.openedWord' : 'copy.opened';
    const text = `${t(key)}${lost.length ? ` ${t('copy.lost', { what: lost.join('; ') })}` : ''}`;
    this.setMessage(text, [
      { label: t('copy.edit'), run: () => { this.setMessage(null); this.focusEditor(); } },
      { label: t('copy.downloadAs'), run: () => this.setDialog('download') },
    ]);
  }
  setZoom(z: number): void { this.zoom = Math.min(6, Math.max(0.2, z)); this.notify(); }

  protected install(doc: TDoc, name: string, id: string, handle: FileHandle | null, storage: Map<string, Uint8Array> | null = null, savedAt?: number, template = false): void {
    this.installDocument(doc);
    this.opening = null;
    this.name = name;
    this.docId = id;
    this.handle = handle;
    this.template = template;
    this.medium = new SfxMedium(storage);
    this.edits = this.savedEdits = 0;
    // Save makes a version only of changes: the document as opened has none.
    this.versionEdits = 0;
    // Autosave stores every change over the last: the state a session starts from is kept as a
    // version (the export reads the document at once, before any change can come).
    this.pendingAutoVersion = null;
    this.sessionBase = this.autoSave && savedAt !== undefined ? { bytes: this.exportPackage(doc, [], template), time: new Date(savedAt) } : null;
    this.sessionBase?.bytes.catch(() => { this.sessionBase = this.pendingAutoVersion = null; });
    this.attach();
    this.storage.setLastDocId(id);
    this.notify();
  }

  /**
   * Where the document was left, for the editor to go to once it has laid the document out
   * (SwView::ReadUserDataSequence); the editor takes it.
   */
  restoreView: TView | null = null;

  /**
   * Remembers where the document was left: its file has the position of its last store
   * (settings.xml's view settings), the browser the position when the tab was hidden or another
   * document opened, without storing the document again.
   */
  private keepViewPosition(): void {
    const pos = this.currentViewPosition();
    if (!pos || !this.docId) return;
    try {
      const key = appKey(this.app.id, LS_VIEW_POSITIONS);
      const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, TView>;
      delete all[this.docId];
      all[this.docId] = pos;
      const ids = Object.keys(all);
      for (const id of ids.slice(0, Math.max(0, ids.length - MAX_VIEW_POSITIONS))) delete all[id];
      localStorage.setItem(key, JSON.stringify(all));
    } catch { /* storage may be unavailable */ }
  }

  /** SwView::ReadUserDataSequence: the cursor and the visible area where the document was left. */
  protected restoreViewPosition(id: string): void {
    let kept: TView | undefined;
    try { kept = (JSON.parse(localStorage.getItem(appKey(this.app.id, LS_VIEW_POSITIONS)) ?? '{}') as Record<string, TView>)[id]; } catch { /* storage may be unavailable */ }
    this.restoreView = kept ?? this.documentViewPosition();
  }

  /** Whether the open document has changes the browser's copy does not hold. */
  get unsaved(): boolean { return this.edits !== this.savedEdits; }

  /** File > Autosave: turned on, the changes not stored yet are stored at once. */
  setAutoSave(on: boolean): void {
    this.autoSave = on;
    try { localStorage.setItem(suiteKey(LS_AUTOSAVE), String(on)); } catch { /* storage may be unavailable */ }
    if (on && this.unsaved) this.scheduleSave();
    this.setMessage(t(on ? 'autosave.on' : 'autosave.off'));
  }

  /** Tools > Options > View > Icon theme. */
  setIconTheme(th: IconTheme): void {
    this.iconTheme = th;
    setIconTheme(th, () => this.notify());
    try { localStorage.setItem(suiteKey(LS_ICON_THEME), th); } catch { /* storage may be unavailable */ }
    this.notify();
  }

  /** Menu > Classic or Ribbon: switches the menus and toolbars at once. */
  setUiMode(mode: UiMode): void {
    this.uiMode = mode;
    try { localStorage.setItem(appKey(this.app.id, LS_UI_MODE), mode); } catch { /* storage may be unavailable */ }
    this.notify();
  }

  /**
   * Before another document replaces the open one: without autosave and with unsaved changes,
   * the "Save Document?" query (sfx2 QueryCloseDialog) asks to save them, discard them or cancel.
   */
  async confirmClose(): Promise<boolean> {
    if (this.autoSave || !this.unsaved) return true;
    const go = await new Promise<boolean>((resolve) => { this.querySave = resolve; this.setDialog('querysave'); });
    return go;
  }

  /** The query's answer: save first, discard (true without saving), or cancel (false). */
  async answerQuerySave(answer: 'save' | 'discard' | false): Promise<void> {
    const resolve = this.querySave;
    this.querySave = null;
    if (!resolve) return;
    if (this.dialog === 'querysave') { this.dialog = null; this.notify(); }
    // SfxObjectShell::PrepareClose: with "Always save a new version on closing", as a version.
    if (answer === 'save') await this.save(this.saveVersionOnClose ? t('versions.automatic') : undefined);
    resolve(answer === 'discard' || (answer === 'save' && !this.unsaved));
  }

  /**
   * File > New: made from the default template (Templates > Set as Default,
   * SfxObjectFactory::GetStandardTemplate) when there is one, else empty.
   */
  async newDocument(): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    if (await this.newFromDefaultTemplate()) return;
    this.install(this.newDoc(), 'Untitled', newId(), null);
  }

  /** Asks a yes/no question in a message dialog; No, Escape and closing answer false. */
  queryYesNo(title: string, text: string): Promise<boolean> {
    this.messageQuery?.resolve(false);
    return new Promise<boolean>((resolve) => { this.messageQuery = { title, text, resolve }; this.setDialog('query'); });
  }

  /** The yes/no query's answer. */
  answerQuery(yes: boolean): void {
    const q = this.messageQuery;
    this.messageQuery = null;
    if (this.dialog === 'query') { this.dialog = null; this.notify(); setTimeout(() => this.focusEditor(), 0); }
    q?.resolve(yes);
  }

  /** The repair query's answer. */
  answerRepair(repair: boolean): void {
    const q = this.repairQuery;
    this.repairQuery = null;
    if (this.dialog === 'repairpackage') { this.dialog = null; this.notify(); }
    q?.resolve(repair);
  }

  /**
   * SfxBaseModel::load's second try: a package whose directory is broken (BrokenPackageError)
   * opens, if the user agrees (RequestPackageReparation), with its entries recovered from their
   * local headers (RepairPackage), as a new document titled with the file's name (SID_TEMPLATE,
   * SID_DOCINFO_TITLE). Null when the user declines; a package that cannot be repaired either
   * reports so (NotifyBrokenPackage) and gives null.
   */
  protected async importPackage<R>(name: string, load: (bRepairPackage: boolean) => Promise<R>): Promise<{ result: R; repaired: boolean } | null> {
    try {
      return { result: await load(false), repaired: false };
    } catch (e) {
      if (!(e instanceof BrokenPackageError)) throw e;
    }
    const opening = this.opening;
    this.opening = null;
    const repair = await new Promise<boolean>((resolve) => { this.repairQuery = { name, resolve }; this.setDialog('repairpackage'); });
    if (!repair) return null;
    if (opening) { this.opening = opening; this.notify(); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); }
    try {
      return { result: await load(true), repaired: true };
    } catch {
      this.setMessage(t('repair.cantRepair', { name }));
      return null;
    }
  }

  /** Reopens the last document, or stays on the empty one. */
  async restore(): Promise<void> {
    this.canPersist = true;
    const id = this.storage.getLastDocId();
    if (!id) return;
    try {
      const stored = await this.storage.getDoc(id);
      if (stored) await this.loadBytes(stored.bytes, stored.name, stored.id, null, stored.updated);
    } catch (e) {
      this.setMessage(`The last document could not be restored: ${(e as Error).message}`);
    }
  }

  protected async loadBytes(bytes: Uint8Array, name: string, id: string, handle: FileHandle | null, savedAt?: number): Promise<void> {
    await this.showOpening(name, bytes.length);
    let r: PackageImport<TDoc>;
    try {
      r = await this.readPackage(bytes);
      await this.prepareDocument(r.doc);
    } catch (e) {
      if (this.opening) { this.opening = null; this.notify(); }
      throw e;
    }
    const { doc, lost, storage, template } = r;
    // A file with unsupported content opens detached: saving must never overwrite the richer original.
    this.install(doc, name, id, lost.length ? null : handle, storage ?? null, savedAt, template);
    if (lost.length) this.openedAsCopy(lost);
  }

  async openStored(id: string): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    const stored = await this.storage.getDoc(id);
    if (stored) await this.loadBytes(stored.bytes, stored.name, stored.id, null, stored.updated);
    this.setDialog(null);
  }

  async openFile(file: File, handle: FileHandle | null): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    try {
      await this.showOpening(file.name, file.size);
      if (!(await this.importFile(file, handle))) return;
      this.setDialog(null);
    } catch (e) {
      this.setMessage(`${file.name} could not be opened: ${(e as Error).message}`);
    } finally {
      if (this.opening) { this.opening = null; this.notify(); }
    }
  }

  async openFromDisk(): Promise<void> {
    const w = window as PickerWindow;
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker({ types: this.app.openTypes });
        if (h) await this.openFile(await h.getFile(), h);
      } catch (e) { if ((e as DOMException).name !== 'AbortError') this.setMessage((e as Error).message); }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = this.app.openAccept;
    input.onchange = () => { if (input.files?.[0]) void this.openFile(input.files[0], null); };
    input.click();
  }

  /** Autosave has changes it has not stored yet (waiting for a pause, or storing). */
  get savePending(): boolean { return this.autoSave && (this.saveTimer !== undefined || this.saving); }

  /** How long the last autosave took: a document that takes long to store waits for a pause. */
  private lastSaveMs = 0;
  /** When the oldest change not stored yet was made, for the longest wait (0: none waiting). */
  private pendingSince = 0;

  /**
   * Autosave: the change is stored once the operation that made it has finished (the changes of
   * one operation arrive together), never two saves at once; a document that takes long to store
   * waits for a pause in typing, but not too long (AutosaveDelay).
   */
  protected scheduleSave(): void {
    if (!this.canPersist || !this.autoSave) return;
    const now = performance.now();
    if (!this.pendingSince) this.pendingSince = now;
    if (this.lastSaveMs > SLOW_SAVE_MS) {
      clearTimeout(this.saveTimer);
      const wait = AutosaveDelay(this.lastSaveMs, this.pendingSince, now);
      this.saveTimer = setTimeout(() => { this.saveTimer = undefined; void this.autosaveNow(); }, wait);
      return;
    }
    if (this.saveTimer !== undefined) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = undefined; void this.autosaveNow(); }, 0);
  }

  private async autosaveNow(): Promise<void> {
    if (this.saving) { this.saveAgain = true; return; }
    this.saving = true;
    try {
      do {
        this.saveAgain = false;
        this.pendingSince = 0;
        const t0 = performance.now();
        await this.persist();
        this.lastSaveMs = performance.now() - t0;
      } while (this.saveAgain);
    } finally { this.saving = false; }
  }

  /** Runs a pending autosave immediately, for example before switching documents. */
  flushSave(): void { this.flush(); }
  protected flush(): void {
    this.keepViewPosition();
    if (this.saveTimer !== undefined) { clearTimeout(this.saveTimer); this.saveTimer = undefined; void this.autosaveNow(); }
  }

  /**
   * Stores the document in the browser, with its versions; `version` also stores a new version
   * (SID_DOCINFO_COMMENTS). Returns the package, or null when it could not be stored.
   */
  private persist(version?: SaveToArgs): Promise<Uint8Array | null> {
    if (this.cleared) return Promise.resolve(null);
    // The document as it is now: another may be open by the time the write before this one ends.
    const ctx = { doc: this.document, docId: this.docId, name: this.name, medium: this.medium, template: this.template, at: this.edits, auto: this.pendingAutoVersion };
    this.pendingAutoVersion = null;
    const run = this.persistQueue.then(() => this.persistNow(ctx, version));
    this.persistQueue = run;
    return run;
  }

  private async persistNow(
    { doc, docId, name, medium, template, at, auto }: { doc: TDoc; docId: string; name: string; medium: SfxMedium; template: boolean; at: number; auto: { bytes: Promise<Uint8Array>; time: Date } | null },
    version?: SaveToArgs,
  ): Promise<Uint8Array | null> {
    try {
      // Autosave's versioning: the state this session started from, unless a version is that recent
      // (before a version saved now, which is newer).
      if (auto) {
        const last = medium.GetVersionList(true).at(-1);
        if (!last || auto.time.getTime() - dateOf(last.TimeStamp).getTime() >= AUTO_VERSION_INTERVAL) {
          const args: SaveToArgs = { pVersionItem: t('versions.automatic'), aUserName: this.userFullName, aVersionStream: await auto.bytes, aVersionTime: { ...DateTimeNow(auto.time), NanoSeconds: 0 } };
          if (!version) version = args;
          else await this.package(doc, medium, args, template);
        }
      }
      const bytes = await this.package(doc, medium, version, template);
      await this.storage.putDoc({ id: docId, name, updated: Date.now(), bytes });
      this.storage.setLastDocId(docId);
      if (this.docId === docId && at > this.savedEdits) { this.savedEdits = at; this.notify(); }
      return bytes;
    } catch (e) {
      this.setMessage(`Autosave failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** SfxObjectShell::SaveTo_Impl: the document in the app's own format, with its versions. */
  protected package(doc: TDoc = this.document, medium: SfxMedium = this.medium, args?: SaveToArgs, template = this.template, more: ZipEntry[] = []): Promise<Uint8Array> {
    // A style preview is not stored.
    this.beforeSerialise();
    return SaveTo_Impl((extra) => this.exportPackage(doc, [...extra, ...more], template), medium, args);
  }

  /** Whether a file name is of the app's own formats (ODT, OTT), which carry the versions. */
  protected isOwnFormat(filename: string): boolean {
    return new RegExp(`\\.(${extsOf([this.app.docType, this.app.templateType])})$`, 'i').test(filename);
  }

  private async serialise(filename: string): Promise<Blob> {
    this.beforeSerialise();
    const other = await this.exportFile(filename);
    if (other) return other;
    // The OpenDocument formats differ only in their media type: a template downloads as a document too.
    const template = new RegExp(`\\.(${extsOf([this.app.templateType])})$`, 'i').test(filename);
    return new Blob([(await this.package(undefined, undefined, undefined, template)) as BlobPart], { type: template ? this.app.templateType.mime : this.app.docType.mime });
  }

  private async writeHandle(h: FileHandle): Promise<void> {
    const s = await h.createWritable();
    await s.write(await this.serialise(h.name));
    await s.close();
  }

  /**
   * Saves to the browser, and also to the file on disk when one is attached; with a comment
   * (SID_DOCINFO_COMMENTS), the saved state is also stored as a new version.
   */
  async save(versionComment?: string): Promise<void> {
    try {
      UpdateDocInfoForSave(this.document, this.userFullName);
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      const bytes = await this.persist(versionComment !== undefined ? { pVersionItem: versionComment, aUserName: this.userFullName } : undefined);
      if (!bytes) return;
      if (this.handle) {
        // The own format carries the versions; other formats are written as they are.
        if (this.isOwnFormat(this.handle.name)) {
          const s = await this.handle.createWritable();
          await s.write(new Blob([bytes as BlobPart], { type: this.template ? this.app.templateType.mime : this.app.docType.mime }));
          await s.close();
        } else await this.writeHandle(this.handle);
      }
      this.document.SetUnmodified();
      this.notify();
      await this.afterSave();
    } catch (e) { this.setMessage(`Save failed: ${(e as Error).message}`); }
  }

  // --- File > Versions (SfxVersionDialog) ---

  /** The versions of the open document, oldest first. */
  get versions(): readonly RevisionTag[] { return this.medium.GetVersionList(true); }

  /** "Always save a new version on closing" (SfxObjectShell::IsSaveVersionOnClose). */
  get saveVersionOnClose(): boolean { return IsSaveVersionOnClose(this.document); }
  set saveVersionOnClose(on: boolean) { this.notEditing(() => SetSaveVersionOnClose(this.document, on)); this.notify(); }

  /**
   * Marks the document modified for a change to its versions, which is not editing: autosave's
   * versioning still waits for the first edit of the session.
   */
  private notEditing(f: () => void): void {
    const base = this.sessionBase;
    // Nor is it a change Save would make a version of.
    const unchanged = this.edits === this.versionEdits;
    this.sessionBase = null;
    try { f(); } finally {
      this.sessionBase = base;
      if (unchanged) this.versionEdits = this.edits;
    }
  }

  /** Save New Version: the document is saved, and its state kept as a version with the comment. */
  async saveNewVersion(comment: string): Promise<void> {
    this.notEditing(() => this.document.SetModified());
    // At once: a Save pressed while this one is still writing makes no second version of it.
    this.versionEdits = this.edits;
    await this.save(comment);
  }

  /**
   * .uno:Save (File > Save, Ctrl+S). Without autosave it stores the document. With autosave every
   * change is stored already, so Save keeps the current state as a version, without asking for a
   * comment (Versions' Save New Version asks for one); unchanged since the last version, it only
   * writes the attached file, if any.
   */
  async saveCommand(): Promise<void> {
    if (!this.autoSave) { await this.save(); return; }
    if (this.edits === this.versionEdits) { await this.save(); return; }
    await this.saveNewVersion('');
    this.versionSavedNotice();
  }

  /** File > Save New Version (Ctrl+Alt+V), once its comment is given: always a new version. */
  async saveVersionCommand(comment: string): Promise<void> {
    await this.saveNewVersion(comment);
    this.versionSavedNotice();
  }

  /** The toast after Save made a version; `timeout` longer for trying out its look (?test-toast). */
  versionSavedNotice(timeout = NOTICE_TIMEOUT): void {
    this.setMessage(t('versions.saved'), [{ label: t('versions.list'), run: () => { this.setMessage(null); this.setDialog('versions'); } }], timeout);
  }

  /** Delete: the version is removed when the document is stored next (at once with autosave). */
  deleteVersion(identifier: string): void {
    this.medium.RemoveVersion_Impl(identifier);
    this.notEditing(() => this.document.SetModified());
    this.notify();
  }

  /** Delete All (not upstream): every version, removed as Delete removes one. */
  deleteAllVersions(): void {
    for (const v of [...this.versions]) this.medium.RemoveVersion_Impl(v.Identifier);
    this.notEditing(() => this.document.SetModified());
    this.notify();
  }

  /**
   * Open (SID_OPENDOC with SID_VERSION): the version opens as a document of its own. Upstream
   * opens it read-only in another window; here it replaces the open document as an unsaved copy,
   * with a way back.
   */
  async openVersion(index: number): Promise<void> {
    const tag = this.versions[index];
    const bytes = this.medium.GetVersionStorage_Impl(index + 1);
    if (!tag || !bytes) return;
    if (!(await this.confirmClose())) return;
    this.flush();
    const { name, docId } = this;
    try {
      const { doc, storage } = await this.readPackage(bytes);
      const when = dateOf(tag.TimeStamp).toLocaleString();
      this.install(doc, `${name} (${when})`, newId(), null, storage ?? null);
      this.setDialog(null);
      this.setMessage(t('versions.opened', { doc: name, date: when }), [
        { label: t('versions.back'), run: () => { this.setMessage(null); void this.openStored(docId); } },
        { label: t('copy.downloadAs'), run: () => this.setDialog('download') },
      ]);
    } catch (e) {
      this.setMessage(`${name}: ${(e as Error).message}`);
    }
  }

  /**
   * File > Save to Computer (.uno:SaveAs, in browsers with a save dialog): saves the document to a
   * file on disk and keeps it, so Save writes there from now on, as after opening that file.
   */
  async saveToComputer(): Promise<void> {
    const w = window as PickerWindow;
    const format = this.fileFormat();
    const saveTypes = this.app.saveTypes.map((f) => ({ description: f.description, accept: { [f.mime]: f.exts.map((e) => `.${e}`) } }));
    try {
      const first = Math.max(0, this.app.saveTypes.findIndex((f) => f.id === format));
      const types = [saveTypes[first]!, ...saveTypes.filter((_, i) => i !== first)];
      const h = await w.showSaveFilePicker!({ suggestedName: `${this.name}.${format}`, types });
      UpdateDocInfoForSave(this.document, this.userFullName);
      await this.writeHandle(h);
      this.handle = h;
      // Saved as .ott, the document is a template from now on; saved as .odt, it no longer is one.
      if (this.isOwnFormat(h.name)) this.template = new RegExp(`\\.(${extsOf([this.app.templateType])})$`, 'i').test(h.name);
      this.name = h.name.replace(new RegExp(`\\.(${extsOf(this.app.saveTypes)})$`, 'i'), '');
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      await this.persist();
      this.document.SetUnmodified();
      this.notify();
    } catch (e) { if ((e as DOMException).name !== 'AbortError') this.setMessage(`Save failed: ${(e as Error).message}`); }
  }

  /**
   * File > Download and Download As (.uno:SaveACopy, .uno:ExportTo): the document as a file
   * in the browser's downloads. Like Save a Copy and Export, it leaves the document as it is: its name, file on disk and modified state.
   * Without `withVersions`, an ODT or OTT leaves out the versions (File > Versions); the document keeps them.
   */
  async download(name: string, format: string, withVersions = true): Promise<void> {
    try {
      const { docType, templateType } = this.app;
      if (withVersions || (format !== docType.id && format !== templateType.id)) { await this.downloadFile(`${name}.${format}`); return; }
      const bytes = await this.package(this.document, new SfxMedium(), undefined, format === templateType.id);
      this.saveBlob(new Blob([bytes as BlobPart], { type: format === templateType.id ? templateType.mime : docType.mime }), `${name}.${format}`);
    } catch (e) { this.setMessage(`Download failed: ${(e as Error).message}`); }
  }

  /**
   * File > Create Copy: stores the document as it is now as a new document in the browser, under
   * `name` and without its versions (File > Versions). The document stays open; the message offers
   * to open the copy.
   */
  async createCopy(name: string): Promise<void> {
    try {
      const bytes = await this.package(this.document, new SfxMedium(), undefined, this.template);
      const id = newId();
      await this.storage.putDoc({ id, name, updated: Date.now(), bytes });
      this.setMessage(t('createcopy.done', { name }), [
        { label: t('createcopy.open'), run: () => { this.setMessage(null); void this.openStored(id); } },
      ]);
    } catch (e) {
      this.setMessage(t('createcopy.failed', { error: (e as Error).message }));
    }
  }

  /** Set by File > Clear Data: nothing is stored any more, and the page is about to reload. */
  cleared = false;

  /**
   * File > Clear Data, once confirmed: deletes the documents, settings, fonts and dictionaries
   * stored in this browser (of every app of the suite), then starts afresh with a reload.
   */
  async clearData(): Promise<void> {
    this.cleared = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    // A write under way must not store the document again after the deletion.
    await this.persistQueue.catch(() => undefined);
    try { await clearAllData(); } catch (e) {
      this.cleared = false;
      this.setDialog(null);
      this.setMessage(`Clearing the data failed: ${(e as Error).message}`);
      return;
    }
    location.reload();
  }

  /** The document's own file format: its file's on disk, else the app's own (a template's .ott). */
  fileFormat(): string {
    const ext = new RegExp(`\\.(${extsOf(this.app.saveTypes)})$`, 'i').exec(this.handle?.name ?? '')?.[1]?.toLowerCase();
    const type = ext ? this.app.saveTypes.find((f) => f.exts.includes(ext)) : undefined;
    return type?.id ?? (this.template ? this.app.templateType.id : this.app.docType.id);
  }

  private async downloadFile(filename: string): Promise<void> {
    this.saveBlob(await this.serialise(filename), filename);
  }

  protected saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  rename(name: string): void { this.name = name || 'Untitled'; this.edits++; this.scheduleSave(); this.notify(); }
}

/** Any app's controller, as the shared UI takes it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyController = AppController<any, any, any>;
