// Owns the open document and everything the React tree renders from it.
import { DEFAULT_ICON_THEME, ICON_THEMES, setIconTheme, type IconTheme } from './icons.ts';
import { ImportMarkdown } from '@lo/sw/source/filter/md/swmd.ts';
import { ExportMarkdown } from '@lo/sw/source/filter/md/wrtmd.ts';
import { FontService } from './fonts.ts';
import { t } from './i18n.ts';
import { SwDoc } from '@lo/sw/inc/doc.ts';
import { SwWrtShell } from '@lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { CanvasTextMeasurer, SetFontFamilies } from '@lo/vcl/source/outdev/text.ts';
import { GetPrefSize, GraphicManager, ImportBitmap, SetSvgDecoder } from '@lo/vcl/source/graphic/Manager.ts';
import { IsEMF, IsWMF } from '@lo/vcl/source/filter/wmf/wmf.ts';
import { ExecuteGrfFilter, GrfFilterTable } from '@lo/svx/source/dialog/grfflt.ts';
import { ExportODT, ImportODT } from '@lo/sw/source/filter/xml/odt.ts';
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { IsSaveVersionOnClose, SetSaveVersionOnClose, UpdateDocInfoForSave } from '@lo/sfx2/source/doc/objcont.ts';
import { SfxMedium } from '@lo/sfx2/source/doc/docfile.ts';
import { SaveTo_Impl, type SaveToArgs } from '@lo/sfx2/source/doc/objstor.ts';
import type { RevisionTag } from '@lo/xmloff/source/meta/xmlversion.ts';
import { ExportText, ImportText } from '@lo/sw/source/filter/ascii/ascii.ts';
import { ImportDOCX } from '@lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ImportDOC } from '@lo/sw/source/filter/ww8/ww8par.ts';
import { DOCX_MIME, ExportDOCX } from '@lo/sw/source/filter/ww8/docxexport.ts';
import { clearAllData, getDoc, getLastDocId, putDoc, setLastDocId } from './storage.ts';
import { SpellChecker, LANGUAGE_NONE } from '@lo/lingucomponent/source/spellcheck/spell/sspellimp.ts';
import { findDictionary, isDictionaryCached, loadDictionary } from './spell.ts';
import { autoCompleteWords, ensureLists, initAutoCorrect } from './autocorrect.ts';
import { SvxAutoCorrCfg } from '@lo/editeng/source/misc/acorrcfg.ts';
import type { SvxAutoCorrect } from '@lo/editeng/source/misc/svxacorr.ts';
import { CollectAutoCmplWrds } from '@lo/sw/source/core/txtnode/txtedt.ts';

export type DialogId = 'documents' | 'character' | 'paragraph' | 'page' | 'find' | 'wordcount' | 'about' | 'table' | 'hyperlink' | 'specialchar' | 'options' | 'style' | 'newstyle' | 'toc' | 'fly' | 'redlines' | 'section' | 'sections' | 'columns' | 'break' | 'download' | 'spelling' | 'compress' | 'imagefilter' | 'objname' | 'alttext' | 'numbullet' | 'titlepage' | 'watermark' | 'docinfo' | 'sizecheck' | 'insrows' | 'inscols' | 'splitcells' | 'mergetable' | 'splittable' | 'rowheight' | 'colwidth' | 'tableprops' | 'autoformat' | 'texttotable' | 'tabletotext' | 'tablesort' | 'numformat' | 'caption' | 'formula' | 'contour' | 'querysave' | 'versions' | 'cleardata' | 'autocorrect' | null;

/** File > Autosave, kept for every document opened later. */
const LS_AUTOSAVE = 'writer:autosave';
/** How long a passing notice (Save's versions) stays before it dismisses itself. */
const NOTICE_TIMEOUT = 3000;
/**
 * Autosave's automatic versions: the state an editing session starts from is kept as a version,
 * unless the newest version is less than this much older than that state.
 */
const AUTO_VERSION_INTERVAL = 10 * 60 * 1000;
/** A css::util::DateTime as a Date, in local time. */
export const dateOf = (t: RevisionTag['TimeStamp']): Date => new Date(t.Year, t.Month - 1, t.Day, t.Hours, t.Minutes, t.Seconds);
const LS_UI_MODE = 'writer:ui-mode';
const LS_ICON_THEME = 'writer:icon-theme';
/** Menu > Classic (menu bar and toolbars) or Ribbon (the tabbed notebookbar). */
export type UiMode = 'classic' | 'ribbon';
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const OTT_MIME = 'application/vnd.oasis.opendocument.text-template';
/** The formats a document is saved or downloaded in. */
export type FileFormat = 'odt' | 'ott' | 'docx' | 'txt' | 'md';
/** The file types File > Save to Computer offers, the document's own first. */
const saveTypes = [
  { description: 'OpenDocument Text', accept: { [ODT_MIME]: ['.odt'] } },
  { description: 'OpenDocument Text Template', accept: { [OTT_MIME]: ['.ott'] } },
  { description: 'Word Document', accept: { [DOCX_MIME]: ['.docx'] } },
  { description: 'Text', accept: { 'text/plain': ['.txt'] } },
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } },
];
const openTypes = [
  { description: 'Documents', accept: { [ODT_MIME]: ['.odt'], [OTT_MIME]: ['.ott'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.template': ['.dotx'], 'application/msword': ['.doc', '.dot'], 'text/plain': ['.txt'], 'text/markdown': ['.md', '.markdown'] } },
];

type FileHandle = FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> };
type PickerWindow = typeof window & {
  showOpenFilePicker?: (o: unknown) => Promise<FileHandle[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
};

/** The graphic's mime type: the file's, or WMF and EMF by their header (browsers do not name them alike). */
const graphicMime = (data: Uint8Array, type: string): string => (IsWMF(data) ? 'image/x-wmf' : IsEMF(data) ? 'image/x-emf' : type || 'image/png');

// createImageBitmap does not decode SVG in every browser (graphics in SVG, and WMF and EMF drawn
// as SVG): an image element decodes it, drawn on a canvas of the requested size.
SetSvgDecoder(async (svg, width, height) => {
  const url = URL.createObjectURL(svg);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = width ?? (img.naturalWidth || 300), h = height ?? (img.naturalHeight || 150);
    const cv = new OffscreenCanvas(w, h);
    cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return cv.transferToImageBitmap();
  } finally {
    URL.revokeObjectURL(url);
  }
});

// crypto.randomUUID needs a secure context; getRandomValues also works on plain-http hosts.
const newId = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

export class Controller {
  readonly measurer = new CanvasTextMeasurer();
  /** Decoded graphics; replaced with the document so that bitmaps of a closed document are freed. */
  graphics = new GraphicManager();
  sh: SwWrtShell;
  docId = newId();
  name = 'Untitled';
  handle: FileHandle | null = null;
  /** The open document is a text template (.ott): it is stored, saved and downloaded as one. */
  template = false;
  /** The medium of the open document (SfxMedium): its version list and versions. */
  medium = new SfxMedium();
  zoom = 1;
  /** View > Comments > Resolved Comments. */
  showResolvedComments = true;
  /** Tools > Options > User Data: the author of new comments. */
  get author(): string {
    try { return localStorage.getItem('writer:author') || 'Unknown Author'; } catch { return 'Unknown Author'; }
  }
  /** SvtUserOptions::GetFullName: the user's name, empty when none is set. */
  get userFullName(): string {
    try { return localStorage.getItem('writer:author') ?? ''; } catch { return ''; }
  }
  set author(name: string) {
    try { localStorage.setItem('writer:author', name); } catch { /* storage may be unavailable */ }
    this.sh.m_pDoc.m_pDocumentRedlineManager.m_sAuthor = this.author;
    this.notify();
  }
  /** The spell checker shared by all documents, and the state of each dictionary by locale. */
  readonly spell = new SpellChecker();
  dictionaries = new Map<string, 'loading' | 'ready' | 'error'>();
  /** View > Formatting Marks (SwViewOption::IsViewMetaChars). */
  showControlCodes = false;
  /** Clone Formatting (SwFormatClipboard): formatting copied, waiting to be applied by the next selection. */
  formatClipboard: { chars: import('@lo/sw/inc/hintids.ts').SwCharAttrSet; para: import('@lo/sw/inc/hintids.ts').SwAttrSet; coll: string } | null = null;
  dialog: DialogId = null;
  /** A shape command waiting for the mouse to draw its shape (SwView's draw function). */
  drawShape: string | null = null;
  /** SID_OBJECT_CROP: the selected graphic's handles crop it instead of resizing it. */
  cropMode = false;
  /** SwEditWin's chain mode: the next click on a frame links the selected frame to it. */
  chainMode = false;
  /** The image filter whose dialog is open (`imagefilter`). */
  filterCommand = '';
  /** SID_OBJECT_ROTATE: the selected object's handles rotate it about its centre. */
  rotateMode = false;
  /** Format > Image > Color: the colorbar is shown while an image is selected. */
  showColorBar = false;
  /** Table > Insert Formula and AutoSum: the input window (SwInputWindow) and its text, or null. */
  formulaBar: { text: string } | null = null;
  /** Table > Number Recognition (FN_SET_MODOPT_TBLNUMFMT, a module option). */
  get numberRecognition(): boolean { try { return localStorage.getItem('writer:numberRecognition') === 'true'; } catch { return false; } }
  set numberRecognition(on: boolean) {
    try { localStorage.setItem('writer:numberRecognition', String(on)); } catch { /* storage may be unavailable */ }
    this.sh.m_bInsTableFormatNum = on;
    this.notify();
  }
  message: string | null = null;
  /** Bumped on any change; React reads it through useSyncExternalStore. */
  version = 0;
  private listeners = new Set<() => void>();
  private unsubscribeDoc: () => void = () => {};
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private canPersist = false;
  /** File > Autosave: every change is stored in the browser at once; off, only File > Save stores it. */
  autoSave = (() => { try { return localStorage.getItem(LS_AUTOSAVE) !== 'false'; } catch { return true; } })();
  /** Menu > Classic or Ribbon (the default), kept for later sessions. */
  uiMode: UiMode = (() => { try { return localStorage.getItem(LS_UI_MODE) === 'classic' ? 'classic' : 'ribbon'; } catch { return 'ribbon'; } })();
  /** Tools > Options > View > Icon theme (Fluent's outlines by default), kept for later sessions. */
  iconTheme: IconTheme = (() => {
    let v: string | null = null;
    try { v = localStorage.getItem(LS_ICON_THEME); } catch { /* storage may be unavailable */ }
    const th = (ICON_THEMES as readonly string[]).includes(v ?? '') ? (v as IconTheme) : DEFAULT_ICON_THEME;
    setIconTheme(th, () => this.notify());
    return th;
  })();
  /** Changes made to the open document, and how many of them the browser's copy holds. */
  private edits = 0;
  private savedEdits = 0;
  /** One autosave runs at a time; changes made meanwhile are stored by one more run. */
  private saving = false;
  private saveAgain = false;
  /** Writes of the package, one after another: each copies the versions the one before wrote. */
  private persistQueue: Promise<unknown> = Promise.resolve();
  /**
   * Autosave's versioning: the open document as it was loaded (package and time), kept as a version
   * when the first change of this session is stored; then the version waiting to be stored.
   */
  private sessionBase: { bytes: Promise<Uint8Array>; time: Date } | null = null;
  private pendingAutoVersion: { bytes: Promise<Uint8Array>; time: Date } | null = null;
  /** The change count when a version was last saved by hand: Save makes no version of the same state. */
  private versionEdits = 0;
  /** The answer awaited from the "Save Document?" query. */
  private querySave: ((go: boolean) => void) | null = null;
  /** Set by the edit window: scrolls the caret into view after the next paint. */
  onEdit: () => void = () => {};
  /** Set by the edit window: returns keyboard focus to the document. */
  focusEditor: () => void = () => {};

  /** Font profiles and web fonts (Tools > Options > Fonts). */
  readonly fonts = new FontService();

  constructor() {
    try { for (const w of JSON.parse(localStorage.getItem('writer:userwords') ?? '[]') as string[]) this.spell.AddWord(w); } catch { /* none */ }
    // SvxAutoCorrCfg: the options, the lists of the languages in use, and the spell checker that
    // keeps correctly spelt words from being "corrected" (FnCapitalStartWord).
    initAutoCorrect(navigator.language || 'en-US', (w, l) => (this.spell.hasLanguage(l) ? this.spell.isValid(w, l) ?? undefined : undefined), () => this.notify());
    // The font mapping must be in place before the first layout measures text.
    this.fonts.install();
    this.fonts.watchLoading();
    this.fonts.onChange(() => this.fontsChanged());
    this.sh = new SwWrtShell(this.newDoc(), this.measurer);
    this.attach();
  }

  /** Web fonts finished loading or the font profile changed: measure and lay out again. */
  fontsChanged(): void {
    this.measurer.Invalidate();
    this.sh.m_pRoot.InvalidateFonts();
    this.sh.m_pRoot.Layout();
    this.notify();
  }

  /** The font names the document uses: in its defaults, styles and text (for the font list). */
  documentFonts(): Set<string> {
    const doc = this.sh.m_pDoc, out = new Set<string>();
    const add = (f: unknown) => { if (typeof f === 'string' && f) out.add(f); };
    add(doc.m_aDefaults.RES_CHRATR_FONT);
    for (const c of doc.m_aTextFormatColls.values()) add(c.m_aSet.RES_CHRATR_FONT);
    for (const c of doc.m_aCharFormats.values()) add(c.m_aSet.RES_CHRATR_FONT);
    const nodes = doc.GetNodes();
    for (let i = 0; i < nodes.Count(); i++) {
      const n = nodes.node(i);
      if (!n.IsTextNode()) continue;
      add(n.m_aSet.RES_CHRATR_FONT);
      for (const h of n.m_aHints) add(h.aAttrs.RES_CHRATR_FONT);
    }
    return out;
  }

  /** A new document in the user's language, so that spelling uses their dictionary. */
  private newDoc(): SwDoc {
    const doc = new SwDoc();
    // SfxPickListImpl, SfxEventHintId::CreateDoc: the author and creation date of a new document.
    doc.m_xDocProps.setAuthor(this.userFullName);
    doc.m_xDocProps.setCreationDate(DateTimeNow());
    const d = findDictionary(navigator.language || 'en-US');
    doc.FindTextFormatCollByName('Standard')!.m_aSet.RES_CHRATR_LANGUAGE = d?.locale ?? (navigator.language || 'en-US');
    return doc;
  }

  // --- spelling (SwView::ExecLingu, the Tools > Language menus and the status bar's language) ---

  /**
   * Tools > Options > Security: "Ctrl-click required to open hyperlinks"
   * (SvtSecurityOptions::EOption::CtrlClickHyperlink, on by default), remembered across sessions.
   */
  get ctrlClickHyperlink(): boolean {
    try { return localStorage.getItem('writer:ctrlclick') !== 'false'; } catch { return true; }
  }
  set ctrlClickHyperlink(on: boolean) {
    try { localStorage.setItem('writer:ctrlclick', String(on)); } catch { /* storage may be unavailable */ }
  }

  /** Tools > Automatic Spell Checking, remembered across sessions. */
  get onlineSpell(): boolean {
    try { return localStorage.getItem('writer:autospell') !== 'false'; } catch { return true; }
  }
  set onlineSpell(on: boolean) {
    try { localStorage.setItem('writer:autospell', String(on)); } catch { /* storage may be unavailable */ }
    this.sh.m_bOnlineSpell = on;
    if (on) void this.loadUsedDictionaries(true);
    this.notify();
  }

  /** Loads the dictionary for a language (downloading it once); the document is checked again. */
  async ensureDictionary(lang: string): Promise<void> {
    if (!lang || lang === LANGUAGE_NONE) return;
    const d = findDictionary(lang);
    if (!d || this.dictionaries.has(d.locale)) return;
    this.dictionaries.set(d.locale, 'loading');
    this.notify();
    try {
      this.spell.SetDictionary(d.locale, await loadDictionary(d));
      this.dictionaries.set(d.locale, 'ready');
    } catch (e) {
      this.dictionaries.set(d.locale, 'error');
      this.setMessage(`The ${d.locale} dictionary could not be loaded: ${(e as Error).message}`);
    }
    this.onEdit();
    this.notify();
  }

  /**
   * The dictionaries of the languages the document uses: those already in the browser load by
   * themselves; others only when asked (`download`), as they may be several megabytes.
   */
  async loadUsedDictionaries(download = false): Promise<void> {
    if (!this.onlineSpell && !download) return;
    const langs = new Set<string>();
    const nodes = this.sh.m_pDoc.GetNodes();
    for (let n = nodes.GoNext(0); n; n = nodes.GoNext(n.GetIndex())) {
      langs.add(n.GetAttr('RES_CHRATR_LANGUAGE'));
      for (const h of n.m_aHints) if (h.aAttrs.RES_CHRATR_LANGUAGE) langs.add(h.aAttrs.RES_CHRATR_LANGUAGE);
    }
    for (const lang of langs) {
      const d = findDictionary(lang);
      if (d && (download || await isDictionaryCached(d))) await this.ensureDictionary(lang);
    }
  }

  /** Sets the text language (of the selection, else all text) and loads its dictionary. */
  setLanguage(lang: string, scope?: 'selection' | 'paragraph' | 'all'): void {
    this.sh.SetLanguage(lang, scope ?? (this.sh.HasSelection() ? 'selection' : 'all'));
    void this.ensureDictionary(lang);
    void ensureLists(lang);
    this.notify();
  }

  /** Add to Dictionary: the word goes into the user dictionary, kept in this browser. */
  addToDictionary(word: string): void {
    this.spell.AddWord(word);
    try { localStorage.setItem('writer:userwords', JSON.stringify([...this.spell.m_aUserWords])); } catch { /* storage may be unavailable */ }
    this.onEdit();
    this.notify();
  }

  /** SvxAutoCorrCfg::Get().GetAutoCorrect() */
  get acorr(): SvxAutoCorrect { return SvxAutoCorrCfg.Get().GetAutoCorrect(); }
  /** Tools > AutoCorrect > While Typing (FN_AUTOFORMAT_AUTO, SvxAutoCorrCfg::IsAutoFormatByInput). */
  get autoFormatByInput(): boolean { return SvxAutoCorrCfg.Get().IsAutoFormatByInput(); }
  set autoFormatByInput(on: boolean) { SvxAutoCorrCfg.Get().SetAutoFormatByInput(on); this.notify(); }

  /** The document the collected words of word completion belong to. */
  private wordsDoc: string | null = null;
  private collectTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * SwTextFrame::CollectAutoCmplWrds for all paragraphs, at idle time (upstream collects while
   * formatting); the word at the cursor is left out until it is finished.
   */
  collectWords(): void {
    clearTimeout(this.collectTimer);
    this.collectTimer = setTimeout(() => {
      const f = this.acorr.GetSwFlags();
      if (!f.bAutoCompleteWords || !f.bAutoCmpltCollectWords) return;
      const nodes = this.sh.m_pDoc.GetNodes(), pt = this.sh.m_pCursor.GetPoint();
      for (let n = nodes.GoNext(0); n; n = nodes.GoNext(n.GetIndex()))
        CollectAutoCmplWrds(n, autoCompleteWords, this.docId, n === pt.GetNode() ? pt.GetContentIndex() : -1);
    }, 600);
  }

  /** The AutoCorrect lists of the languages the document uses. */
  private loadAutoCorrectLists(): void {
    const langs = new Set<string>();
    const nodes = this.sh.m_pDoc.GetNodes();
    for (let n = nodes.GoNext(0); n; n = nodes.GoNext(n.GetIndex())) langs.add(n.GetAttr('RES_CHRATR_LANGUAGE'));
    for (const l of langs) void ensureLists(l);
  }

  private attach(): void {
    // The author of new changes is the user (SwModule::GetRedlineAuthor).
    this.loadAutoCorrectLists();
    // "When closing a document, remove the words collected from it from the list".
    if (this.wordsDoc && this.wordsDoc !== this.docId && !this.acorr.GetSwFlags().bAutoCmpltKeepList) autoCompleteWords.DocumentDying(this.wordsDoc);
    this.wordsDoc = this.docId;
    this.collectWords();
    this.sh.m_pDoc.m_pDocumentRedlineManager.m_sAuthor = this.author;
    this.sh.m_pSpell = this.spell;
    this.sh.m_bOnlineSpell = this.onlineSpell;
    this.sh.m_fnReadonly = () => this.setMessage(t('table.readonly'));
    this.sh.m_bInsTableFormatNum = this.numberRecognition;
    void this.loadUsedDictionaries();
    this.unsubscribeDoc();
    this.unsubscribeDoc = this.sh.m_pDoc.Subscribe(() => {
      this.edits++;
      if (this.sessionBase) { this.pendingAutoVersion = this.sessionBase; this.sessionBase = null; }
      this.onEdit();
      this.scheduleSave();
      this.collectWords();
      this.notify();
    });
  }

  subscribe = (f: () => void): (() => void) => { this.listeners.add(f); return () => this.listeners.delete(f); };
  getVersion = (): number => this.version;
  notify(): void {
    // SwCursorShell::CheckTableBoxContent: a box the cursor has left is checked for a number.
    this.sh.CheckTableBoxContent();
    this.version++;
    for (const f of this.listeners) f();
  }

  get title(): string { return `${this.sh.m_pDoc.IsModified() ? '● ' : ''}${this.name}`; }
  setDialog(d: DialogId): void {
    // The "Save Document?" query closed without an answer (Escape) cancels.
    if (this.dialog === 'querysave' && d !== 'querysave' && this.querySave) this.answerQuerySave(false);
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
   * browser (as ODT, like every document here); the file on disk stays as it was.
   */
  private openedAsCopy(lost: string[], word = false): void {
    const text = `${t(word ? 'copy.openedWord' : 'copy.opened')}${lost.length ? ` ${t('copy.lost', { what: lost.join('; ') })}` : ''}`;
    this.setMessage(text, [
      { label: t('copy.edit'), run: () => { this.setMessage(null); this.focusEditor(); } },
      { label: t('copy.downloadAs'), run: () => this.setDialog('download') },
    ]);
  }
  /** Arms (or with null, cancels) drawing a shape of a type with the mouse. */
  setDrawShape(type: string | null): void {
    this.drawShape = type;
    this.message = type ? t('shape.drag') : null;
    this.notify();
  }
  setZoom(z: number): void { this.zoom = Math.min(6, Math.max(0.2, z)); this.notify(); }

  private install(doc: SwDoc, name: string, id: string, handle: FileHandle | null, storage: Map<string, Uint8Array> | null = null, savedAt?: number, template = false): void {
    const onLoaded = this.graphics.onLoaded;
    this.graphics = new GraphicManager();
    this.graphics.onLoaded = onLoaded;
    // The fallback of fonts the system lacks follows their family in the document's font table.
    SetFontFamilies(doc.m_aFontFamilies);
    this.sh = new SwWrtShell(doc, this.measurer);
    this.name = name;
    this.docId = id;
    this.handle = handle;
    this.template = template;
    this.medium = new SfxMedium(storage);
    this.edits = this.savedEdits = 0;
    // Save makes a version only of changes: the document as opened has none.
    this.versionEdits = 0;
    // Autosave stores every change over the last: the state a session starts from is kept as a
    // version (ExportODT reads the document at once, before any change can come).
    this.pendingAutoVersion = null;
    this.sessionBase = this.autoSave && savedAt !== undefined ? { bytes: ExportODT(doc, [], template), time: new Date(savedAt) } : null;
    this.sessionBase?.bytes.catch(() => { this.sessionBase = this.pendingAutoVersion = null; });
    this.attach();
    setLastDocId(id);
    this.notify();
  }

  /** Whether the open document has changes the browser's copy does not hold. */
  get unsaved(): boolean { return this.edits !== this.savedEdits; }

  /** File > Autosave: turned on, the changes not stored yet are stored at once. */
  setAutoSave(on: boolean): void {
    this.autoSave = on;
    try { localStorage.setItem(LS_AUTOSAVE, String(on)); } catch { /* storage may be unavailable */ }
    if (on && this.unsaved) this.scheduleSave();
    this.setMessage(t(on ? 'autosave.on' : 'autosave.off'));
  }

  /** Tools > Options > View > Icon theme. */
  setIconTheme(th: IconTheme): void {
    this.iconTheme = th;
    setIconTheme(th, () => this.notify());
    try { localStorage.setItem(LS_ICON_THEME, th); } catch { /* storage may be unavailable */ }
    this.notify();
  }

  /** Menu > Classic or Ribbon: switches the menus and toolbars at once. */
  setUiMode(mode: UiMode): void {
    this.uiMode = mode;
    try { localStorage.setItem(LS_UI_MODE, mode); } catch { /* storage may be unavailable */ }
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

  async newDocument(): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    this.install(this.newDoc(), 'Untitled', newId(), null);
  }

  /**
   * New > Template: a blank text template, as File > Templates > Save as Template makes one. It
   * is stored as a template and saved and downloaded as .ott; opening an .ott starts a new
   * document from it.
   */
  async newTemplate(): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    this.install(this.newDoc(), t('new.untitledTemplate'), newId(), null, null, undefined, true);
  }

  /** Reopens the last document, or stays on the empty one. */
  async restore(): Promise<void> {
    this.canPersist = true;
    const id = getLastDocId();
    if (!id) return;
    try {
      const stored = await getDoc(id);
      if (stored) await this.loadBytes(stored.bytes, stored.name, stored.id, null, stored.updated);
    } catch (e) {
      this.setMessage(`The last document could not be restored: ${(e as Error).message}`);
    }
  }

  private async loadBytes(bytes: Uint8Array, name: string, id: string, handle: FileHandle | null, savedAt?: number): Promise<void> {
    const { doc, lost, storage, template } = await ImportODT(bytes);
    // A file with unsupported content opens detached: saving must never overwrite the richer original.
    this.install(doc, name, id, lost.length ? null : handle, storage ?? null, savedAt, template);
    if (lost.length) this.openedAsCopy(lost);
  }

  async openStored(id: string): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    const stored = await getDoc(id);
    if (stored) await this.loadBytes(stored.bytes, stored.name, stored.id, null, stored.updated);
    this.setDialog(null);
  }

  async openFile(file: File, handle: FileHandle | null): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    try {
      if (/\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown') {
        // MarkdownReader: the parser is loaded with the first Markdown file.
        const { mdParse } = await import('./markdown.ts');
        const { doc, lost } = ImportMarkdown(await file.text(), mdParse);
        this.install(doc, file.name.replace(/\.(md|markdown)$/i, ''), newId(), lost.length ? null : handle);
        if (lost.length) this.openedAsCopy(lost);
      } else if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
        this.install(ImportText(await file.text()), file.name.replace(/\.txt$/i, ''), newId(), handle);
      } else if (/\.odt$/i.test(file.name)) {
        await this.loadBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.odt$/i, ''), newId(), handle, file.lastModified);
      } else if (/\.ott$/i.test(file.name)) {
        // A template opens as a new, untitled document made from it (SfxObjectShell's AsTemplate).
        const { doc, lost } = await ImportODT(new Uint8Array(await file.arrayBuffer()));
        this.install(doc, file.name.replace(/\.ott$/i, ''), newId(), null);
        if (lost.length) this.openedAsCopy(lost);
      } else if (/\.do[ct]$/i.test(file.name) || file.type === 'application/msword') {
        // Word 6.0 to 2003 (.doc, and .dot templates, which open as new documents): never written back.
        const { doc, lost } = await ImportDOC(new Uint8Array(await file.arrayBuffer()));
        this.install(doc, file.name.replace(/\.do[ct]$/i, ''), newId(), null);
        this.openedAsCopy(lost, true);
      } else if (/\.do[ct]x$/i.test(file.name)) {
        // A Word template (.dotx) is the same package: it opens as a new document, as in Word.
        // Word files are never written back: they are stored as ODT, and Download As writes Word again.
        const { doc, lost } = await ImportDOCX(new Uint8Array(await file.arrayBuffer()));
        this.install(doc, file.name.replace(/\.do[ct]x$/i, ''), newId(), null);
        this.openedAsCopy(lost, true);
      } else {
        this.setMessage(`${file.name}: this file type is not supported yet. Writer can open .odt, .ott, .docx, .dotx, .doc, .dot, .md and .txt files.`);
        return;
      }
      this.setDialog(null);
    } catch (e) {
      this.setMessage(`${file.name} could not be opened: ${(e as Error).message}`);
    }
  }

  async openFromDisk(): Promise<void> {
    const w = window as PickerWindow;
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker({ types: openTypes });
        if (h) await this.openFile(await h.getFile(), h);
      } catch (e) { if ((e as DOMException).name !== 'AbortError') this.setMessage((e as Error).message); }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.odt,.ott,.docx,.dotx,.doc,.dot,.txt,.md,.markdown';
    input.onchange = () => { if (input.files?.[0]) void this.openFile(input.files[0], null); };
    input.click();
  }

  /**
   * Autosave: the change is stored once the operation that made it has finished (the changes of
   * one operation arrive together), never two saves at once.
   */
  private scheduleSave(): void {
    if (!this.canPersist || !this.autoSave || this.saveTimer !== undefined) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = undefined; void this.autosaveNow(); }, 0);
  }

  private async autosaveNow(): Promise<void> {
    if (this.saving) { this.saveAgain = true; return; }
    this.saving = true;
    try {
      do { this.saveAgain = false; await this.persist(); } while (this.saveAgain);
    } finally { this.saving = false; }
  }

  /** Runs a pending autosave immediately, for example before switching documents. */
  private flush(): void {
    if (this.saveTimer !== undefined) { clearTimeout(this.saveTimer); this.saveTimer = undefined; void this.autosaveNow(); }
  }

  /**
   * Stores the document in the browser, with its versions; `version` also stores a new version
   * (SID_DOCINFO_COMMENTS). Returns the package, or null when it could not be stored.
   */
  private persist(version?: SaveToArgs): Promise<Uint8Array | null> {
    if (this.cleared) return Promise.resolve(null);
    // The document as it is now: another may be open by the time the write before this one ends.
    const ctx = { doc: this.sh.m_pDoc, docId: this.docId, name: this.name, medium: this.medium, template: this.template, at: this.edits, auto: this.pendingAutoVersion };
    this.pendingAutoVersion = null;
    const run = this.persistQueue.then(() => this.persistNow(ctx, version));
    this.persistQueue = run;
    return run;
  }

  private async persistNow(
    { doc, docId, name, medium, template, at, auto }: { doc: SwDoc; docId: string; name: string; medium: SfxMedium; template: boolean; at: number; auto: { bytes: Promise<Uint8Array>; time: Date } | null },
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
      await putDoc({ id: docId, name, updated: Date.now(), bytes });
      setLastDocId(docId);
      if (this.docId === docId && at > this.savedEdits) { this.savedEdits = at; this.notify(); }
      return bytes;
    } catch (e) {
      this.setMessage(`Autosave failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** SfxObjectShell::SaveTo_Impl: the document as ODT, with its versions. */
  private package(doc = this.sh.m_pDoc, medium = this.medium, args?: SaveToArgs, template = this.template): Promise<Uint8Array> {
    return SaveTo_Impl((extra) => ExportODT(doc, extra, template), medium, args);
  }

  private async serialise(filename: string): Promise<Blob> {
    if (/\.txt$/i.test(filename)) return new Blob([ExportText(this.sh.m_pDoc)], { type: 'text/plain' });
    if (/\.(md|markdown)$/i.test(filename)) return new Blob([ExportMarkdown(this.sh.m_pDoc)], { type: 'text/markdown' });
    if (/\.docx$/i.test(filename)) return new Blob([(await ExportDOCX(this.sh.m_pDoc)) as BlobPart], { type: DOCX_MIME });
    // The OpenDocument formats differ only in their media type: a template downloads as a document too.
    const template = /\.ott$/i.test(filename);
    return new Blob([(await this.package(undefined, undefined, undefined, template)) as BlobPart], { type: template ? OTT_MIME : ODT_MIME });
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
      UpdateDocInfoForSave(this.sh.m_pDoc, this.userFullName);
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      const bytes = await this.persist(versionComment !== undefined ? { pVersionItem: versionComment, aUserName: this.userFullName } : undefined);
      if (!bytes) return;
      if (this.handle) {
        // The own format carries the versions; other formats are written as they are.
        if (/\.o[dt]t$/i.test(this.handle.name)) {
          const s = await this.handle.createWritable();
          await s.write(new Blob([bytes as BlobPart], { type: this.template ? OTT_MIME : ODT_MIME }));
          await s.close();
        } else await this.writeHandle(this.handle);
      }
      this.sh.m_pDoc.SetUnmodified();
      this.notify();
    } catch (e) { this.setMessage(`Save failed: ${(e as Error).message}`); }
  }

  // --- File > Versions (SfxVersionDialog) ---

  /** The versions of the open document, oldest first. */
  get versions(): readonly RevisionTag[] { return this.medium.GetVersionList(true); }

  /** "Always save a new version on closing" (SfxObjectShell::IsSaveVersionOnClose). */
  get saveVersionOnClose(): boolean { return IsSaveVersionOnClose(this.sh.m_pDoc); }
  set saveVersionOnClose(on: boolean) { this.notEditing(() => SetSaveVersionOnClose(this.sh.m_pDoc, on)); this.notify(); }

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
    this.notEditing(() => this.sh.m_pDoc.SetModified());
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

  /** The toast after Save made a version; `timeout` longer for trying out its look (?test-toast). */
  versionSavedNotice(timeout = NOTICE_TIMEOUT): void {
    this.setMessage(t('versions.saved'), [{ label: t('versions.list'), run: () => { this.setMessage(null); this.setDialog('versions'); } }], timeout);
  }

  /** Delete: the version is removed when the document is stored next (at once with autosave). */
  deleteVersion(identifier: string): void {
    this.medium.RemoveVersion_Impl(identifier);
    this.notEditing(() => this.sh.m_pDoc.SetModified());
    this.notify();
  }

  /** Delete All (not upstream): every version, removed as Delete removes one. */
  deleteAllVersions(): void {
    for (const v of [...this.versions]) this.medium.RemoveVersion_Impl(v.Identifier);
    this.notEditing(() => this.sh.m_pDoc.SetModified());
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
      const { doc, storage } = await ImportODT(bytes);
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
    try {
      const first = ({ odt: 0, ott: 1, docx: 2, txt: 3, md: 4 } as const)[format];
      const types = [saveTypes[first]!, ...saveTypes.filter((_, i) => i !== first)];
      const h = await w.showSaveFilePicker!({ suggestedName: `${this.name}.${format}`, types });
      UpdateDocInfoForSave(this.sh.m_pDoc, this.userFullName);
      await this.writeHandle(h);
      this.handle = h;
      // Saved as .ott, the document is a template from now on; saved as .odt, it no longer is one.
      if (/\.o[dt]t$/i.test(h.name)) this.template = /\.ott$/i.test(h.name);
      this.name = h.name.replace(/\.(odt|ott|docx|txt|md|markdown)$/i, '');
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      await this.persist();
      this.sh.m_pDoc.SetUnmodified();
      this.notify();
    } catch (e) { if ((e as DOMException).name !== 'AbortError') this.setMessage(`Save failed: ${(e as Error).message}`); }
  }

  /**
   * File > Download and Download As (.uno:SaveACopy, .uno:ExportTo): the document as a file
   * in the browser's downloads. Like Save a Copy and Export, it leaves the document as it is: its name, file on disk and modified state.
   */
  async download(name: string, format: FileFormat): Promise<void> {
    try { await this.downloadFile(`${name}.${format}`); } catch (e) { this.setMessage(`Download failed: ${(e as Error).message}`); }
  }

  /**
   * File > Download without Version History: the document in its own format, as Download gives
   * it, but without the versions an ODT or OTT carries (File > Versions). The document keeps them.
   */
  async downloadWithoutVersions(): Promise<void> {
    const format = this.fileFormat();
    try {
      // Only the own formats (ODT, OTT) carry versions.
      if (format !== 'odt' && format !== 'ott') { await this.downloadFile(`${this.name}.${format}`); return; }
      const bytes = await this.package(this.sh.m_pDoc, new SfxMedium(), undefined, format === 'ott');
      this.saveBlob(new Blob([bytes as BlobPart], { type: format === 'ott' ? OTT_MIME : ODT_MIME }), `${this.name}.${format}`);
    } catch (e) { this.setMessage(`Download failed: ${(e as Error).message}`); }
  }

  /** Set by File > Clear Data: nothing is stored any more, and the page is about to reload. */
  cleared = false;

  /**
   * File > Clear Data, once confirmed: deletes the documents, settings, fonts and dictionaries
   * stored in this browser, then starts afresh with a reload.
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

  /** The document's own file format: its file's on disk, else OpenDocument (a template's .ott). */
  fileFormat(): FileFormat {
    const ext = /\.(odt|ott|docx|txt|md|markdown)$/i.exec(this.handle?.name ?? '')?.[1]?.toLowerCase();
    return ext === 'markdown' ? 'md' : (ext as FileFormat | undefined) ?? (this.template ? 'ott' : 'odt');
  }

  private async downloadFile(filename: string): Promise<void> {
    this.saveBlob(await this.serialise(filename), filename);
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Inserts an image file at the cursor, anchored as character. */
  async insertImageFile(file: Blob): Promise<void> {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const mime = graphicMime(data, file.type);
      const size = await GetPrefSize(data, mime);
      this.sh.InsertGraphic(data, mime, size);
    } catch {
      this.setMessage('This image could not be read. Writer can insert PNG, JPEG, GIF, WebP, AVIF and SVG images.');
    }
  }

  /** FN_INSERT_GRAPHIC: picks an image file to insert. */
  insertImageFromDisk(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,image/bmp,image/tiff,.tif,.tiff,.wmf,.emf';
    input.onchange = () => { if (input.files?.[0]) void this.insertImageFile(input.files[0]); };
    input.click();
  }

  /** The selected graphic's data, or null when no graphic is selected. */
  selectedGraphic(): { data: Uint8Array; mime: string; name: string } | null {
    const f = this.sh.GetFlyFrameFormat();
    const g = f?.graphic !== undefined ? this.sh.m_pDoc.m_aGraphics.get(f.graphic) : undefined;
    return g && f ? { ...g, name: f.m_aName } : null;
  }

  /** SID_CHANGE_PICTURE: picks an image file that replaces the selected one, in its frame. */
  replaceImageFromDisk(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,image/bmp,image/tiff,.tif,.tiff,.wmf,.emf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const mime = graphicMime(data, file.type);
        await GetPrefSize(data, mime); // only images that decode
        this.sh.ReRead(data, mime);
      } catch { this.setMessage(t('image.unreadable')); }
    };
    input.click();
  }

  /** SID_SAVE_GRAPHIC (GraphicHelper::ExportGraphic): saves the selected image as it is stored. */
  async saveImage(): Promise<void> {
    const g = this.selectedGraphic();
    if (!g) return;
    const ext = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tif', 'image/x-wmf': 'wmf', 'image/x-emf': 'emf' } as Record<string, string>)[g.mime] ?? 'png';
    const suggestedName = `${g.name.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
    const blob = new Blob([g.data as BlobPart], { type: g.mime });
    const w = window as PickerWindow;
    try {
      if (w.showSaveFilePicker) {
        const h = await w.showSaveFilePicker({ suggestedName, types: [{ description: g.mime, accept: { [g.mime]: [`.${ext}`] } }] });
        const st = await h.createWritable();
        await st.write(blob);
        await st.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = suggestedName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e) { if ((e as DOMException).name !== 'AbortError') this.setMessage(`Save failed: ${(e as Error).message}`); }
  }

  /** SID_OBJECT_ROTATE: switches the selected object's rotation mode. */
  setRotateMode(on: boolean): void {
    this.rotateMode = on;
    if (on) this.cropMode = false;
    this.message = on ? t('object.rotate') : null;
    this.notify();
  }

  /** FN_FRAME_CHAIN: switches the chain mode (SwEditWin::SetChainMode). */
  setChainMode(on: boolean): void {
    this.chainMode = on;
    this.message = on ? t('frame.chain') : null;
    this.notify();
  }

  /** SID_OBJECT_CROP: switches the selected graphic's crop mode. */
  setCropMode(on: boolean): void {
    this.cropMode = on;
    if (on) this.rotateMode = false;
    this.message = on ? t('image.crop') : null;
    this.notify();
  }

  /** The selected graphic decoded into RGBA pixels, for the image filters and compression. */
  async selectedBitmap(): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
    const g = this.selectedGraphic();
    if (!g) return null;
    const b = await ImportBitmap(g.data, g.mime);
    const cv = new OffscreenCanvas(b.width, b.height);
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(b, 0, 0);
    b.close();
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    return { width: img.width, height: img.height, data: img.data };
  }

  /**
   * SvxGraphicFilter::ExecuteGrfFilterSlot: filters the selected image and puts the result in its
   * place (SwGrfShell's ReRead), as a PNG.
   */
  async applyImageFilter(command: string, params: Record<string, number | boolean | string> = {}): Promise<void> {
    const bmp = await this.selectedBitmap();
    if (!bmp) return;
    const out = ExecuteGrfFilter(command, bmp, params);
    if (!out) return;
    this.sh.ReRead(await this.encodeBitmap(out), 'image/png');
  }

  /** Runs a filter without a dialog at once, or opens the filter's dialog. */
  imageFilter(command: string): void {
    if (!GrfFilterTable[command]?.dialog) { void this.applyImageFilter(command); return; }
    this.filterCommand = command;
    this.setDialog('imagefilter');
  }

  /** Encodes RGBA pixels as PNG (lossless) or JPEG with a quality from 0 to 100. */
  async encodeBitmap(bmp: { width: number; height: number; data: Uint8ClampedArray }, mime = 'image/png', quality?: number): Promise<Uint8Array> {
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bmp.data), bmp.width, bmp.height), 0, 0);
    const blob = await cv.convertToBlob({ type: mime, ...(quality !== undefined ? { quality: quality / 100 } : {}) });
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * Opens a hyperlink in a new browsing context, without giving it access to this one. A link
   * into the document ("#mark") jumps there (SwWrtShell::LoadURL, SwView::JumpToSwMark).
   */
  openURL(url: string): void {
    if (url.startsWith('#')) {
      if (!this.sh.JumpToSwMark(url.slice(1))) this.setMessage(t('link.targetMissing', { target: url.slice(1) }));
      this.notify();
      return;
    }
    if (/^(javascript|data|vbscript):/i.test(url)) { this.setMessage(`Links of this kind are not opened: ${url}`); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  rename(name: string): void { this.name = name || 'Untitled'; this.edits++; this.scheduleSave(); this.notify(); }

  /** Replaces the page geometry and re-lays out the document. */
  applyPage(f: (pd: SwDoc['m_aPageDesc']) => void, desc = this.sh.GetCurPageDesc()): void { f(desc); this.sh.m_pDoc.m_nFormatVersion++; this.sh.m_pDoc.Changed(); }
}
