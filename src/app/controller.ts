// Owns the open document and everything the React tree renders from it.
import { DEFAULT_ICON_THEME, ICON_THEMES, setIconTheme, type IconTheme } from './icons.ts';
import { AutosaveDelay, SLOW_SAVE_MS } from './autosave.ts';
import type { SwTextNode } from '@lo/sw/inc/ndtxt.ts';
import type { SwTextFormatColl } from '@lo/sw/inc/format.ts';
import type { SwAttrSet } from '@lo/sw/inc/hintids.ts';
import { ImportMarkdown } from '@lo/sw/source/filter/md/swmd.ts';
import { ExportMarkdown } from '@lo/sw/source/filter/md/wrtmd.ts';
import { ImportHTML } from '@lo/sw/source/filter/html/swhtml.ts';
import { ExportHTML } from '@lo/sw/source/filter/html/wrthtml.ts';
import { FontService } from './fonts.ts';
import { t } from './i18n.ts';
import { SwDoc, type SwChangeRange, type SwFlyClip, type SwViewData } from '@lo/sw/inc/doc.ts';
import { CH_TXTATR_BREAKWORD } from '@lo/sw/inc/hintids.ts';
import { SwWrtShell } from '@lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { CanvasTextMeasurer, GetFontStacksGeneration, SetFontFamilies, cssFont } from '@lo/vcl/source/outdev/text.ts';
import { GetPrefSize, GraphicManager, ImportBitmap, SetSvgDecoder } from '@lo/vcl/source/graphic/Manager.ts';
import { IsEMF, IsWMF } from '@lo/vcl/source/filter/wmf/wmf.ts';
import { ExecuteGrfFilter, GrfFilterTable } from '@lo/svx/source/dialog/grfflt.ts';
import { ExportODT, ImportODT, type ImportResult } from '@lo/sw/source/filter/xml/odt.ts';
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { IsSaveVersionOnClose, ResetFromTemplate, SetSaveVersionOnClose, UpdateDocInfoForSave } from '@lo/sfx2/source/doc/objcont.ts';
import { SfxMedium } from '@lo/sfx2/source/doc/docfile.ts';
import { SaveTo_Impl, type SaveToArgs } from '@lo/sfx2/source/doc/objstor.ts';
import type { RevisionTag } from '@lo/xmloff/source/meta/xmlversion.ts';
import { ExportText, ImportText } from '@lo/sw/source/filter/ascii/ascii.ts';
import { ImportDOCX } from '@lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ImportDOC } from '@lo/sw/source/filter/ww8/ww8par.ts';
import { DOCX_MIME, ExportDOCX } from '@lo/sw/source/filter/ww8/docxexport.ts';
import { clearAllData, getDoc, getLastDocId, putDoc, setLastDocId, updateDoc } from './storage.ts';
import { getDefaultTemplate, isBuiltIn, listTemplates, renderThumbnail, setDefaultTemplate, templateBytes } from './templates.ts';
import { LoadStylesFromFile, ReaderOptions, type SfxTemplateFlags } from '@lo/sw/source/uibase/app/docsh2.ts';
import type { ZipEntry } from '@lo/package/source/zipapi/zip.ts';
import { BrokenPackageError, readZip } from '@lo/package/source/zipapi/zip.ts';
import { SpellChecker, LANGUAGE_NONE } from '@lo/lingucomponent/source/spellcheck/spell/sspellimp.ts';
import { findDictionary, isDictionaryCached, loadDictionary } from './spell.ts';
import { autoCompleteWords, ensureLists, initAutoCorrect } from './autocorrect.ts';
import { SvxAutoCorrCfg } from '@lo/editeng/source/misc/acorrcfg.ts';
import type { SvxAutoCorrect } from '@lo/editeng/source/misc/svxacorr.ts';
import { CollectAutoCmplWrds } from '@lo/sw/source/core/txtnode/txtedt.ts';
import { SwViewOption } from '@lo/sw/inc/viewopt.ts';

/** The view options kept in the user profile (SwMasterUsrPref): rulers and grid. */
const LS_VIEW_OPTIONS = 'writer:viewoptions';
interface StoredViewOptions { anyRuler: boolean; hRuler: boolean; vRuler: boolean; grid: boolean; snap: boolean; crossHair: boolean }

/** SwView::ExecDraw's SID_DRAW_TEXT and SID_DRAW_TEXT_VERTICAL, armed as the shape to draw. */
export const DRAW_TEXT = 'SID_DRAW_TEXT', DRAW_TEXT_VERTICAL = 'SID_DRAW_TEXT_VERTICAL';

export type DialogId = 'documents' | 'character' | 'paragraph' | 'page' | 'find' | 'wordcount' | 'about' | 'table' | 'hyperlink' | 'specialchar' | 'options' | 'style' | 'newstyle' | 'toc' | 'fly' | 'redlines' | 'section' | 'sections' | 'columns' | 'break' | 'download' | 'spelling' | 'compress' | 'imagefilter' | 'objname' | 'alttext' | 'numbullet' | 'titlepage' | 'watermark' | 'docinfo' | 'sizecheck' | 'insrows' | 'inscols' | 'splitcells' | 'mergetable' | 'splittable' | 'rowheight' | 'colwidth' | 'tableprops' | 'autoformat' | 'texttotable' | 'tabletotext' | 'tablesort' | 'numformat' | 'caption' | 'formula' | 'contour' | 'querysave' | 'versions' | 'cleardata' | 'autocorrect' | 'createcopy' | 'saveversion' | 'templates' | 'saveastemplate' | 'loadstyles' | 'commandpopup' | 'repairpackage' | 'gotopage' | 'pagenumber' | 'signatureline' | 'signatureline-edit' | 'crossref' | 'fields' | null;

/** File > Autosave, kept for every document opened later. */
const LS_AUTOSAVE = 'writer:autosave';
/** Where each stored document was left (SwViewData by document id), the most recent last. */
const LS_VIEW_POSITIONS = 'writer:view-positions';
const MAX_VIEW_POSITIONS = 100;
/**
 * Where a document was left: its view settings and, when the browser kept them, the cursor's node
 * and content index, which do not depend on the layout (fonts still loading move the lines).
 */
export interface ViewPosition { view: SwViewData; node?: number; content?: number }
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
export type FileFormat = 'odt' | 'ott' | 'docx' | 'txt' | 'md' | 'html';
/** The file types File > Save to Computer offers, the document's own first. */
const saveTypes = [
  { description: 'OpenDocument Text', accept: { [ODT_MIME]: ['.odt'] } },
  { description: 'OpenDocument Text Template', accept: { [OTT_MIME]: ['.ott'] } },
  { description: 'Word Document', accept: { [DOCX_MIME]: ['.docx'] } },
  { description: 'Text', accept: { 'text/plain': ['.txt'] } },
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } },
  { description: 'HTML Document', accept: { 'text/html': ['.html', '.htm'] } },
];
const openTypes = [
  { description: 'Documents', accept: { [ODT_MIME]: ['.odt'], [OTT_MIME]: ['.ott'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.template': ['.dotx'], 'application/msword': ['.doc', '.dot'], 'text/plain': ['.txt'], 'text/markdown': ['.md', '.markdown'], 'text/html': ['.html', '.htm', '.xhtml'] } },
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

/** The font names a document uses: in its defaults, styles and text (for the font list). */
function documentFontsOf(doc: SwDoc): Set<string> {
  const out = new Set<string>();
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

/** Files from this size up show the loading indicator while they open. */
const LARGE_FILE = 300_000;
/** How long opening waits for a document's web fonts before laying it out without them. */
const FONT_PRELOAD_MS = 3000;

/** The text each paragraph had when its words were last collected for word completion. */
const collectedWords = new WeakMap<SwTextNode, string>();

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
  /**
   * The view's options (SwView's SwViewOption), shared by every document's layout: View > Screen
   * View, Rulers and Grid and Helplines. Rulers and grid are kept in this browser, as LibreOffice
   * keeps them in the user profile; every document starts in Paper View.
   */
  readonly viewOpt = (() => {
    const o = new SwViewOption();
    // The rulers start hidden (LibreOffice shows the horizontal one); View > Rulers > Rulers shows
    // the horizontal ruler.
    o.SetViewAnyRuler(false);
    try {
      const v = JSON.parse(localStorage.getItem(LS_VIEW_OPTIONS) ?? 'null') as StoredViewOptions | null;
      if (v) {
        o.SetViewAnyRuler(v.anyRuler); o.SetViewHRuler(v.hRuler); o.SetViewVRuler(v.vRuler);
        o.SetGridVisible(v.grid); o.SetSnap(v.snap); o.SetCrossHair(v.crossHair);
      }
    } catch { /* defaults */ }
    return o;
  })();
  /** SwView::ExecViewOptions: applies a changed view option, laying out again for Screen View. */
  applyViewOptions(relayout = false): void {
    const o = this.viewOpt;
    const v: StoredViewOptions = { anyRuler: o.IsViewAnyRuler(), hRuler: o.IsViewHRuler(true), vRuler: o.IsViewVRuler(true), grid: o.m_nCoreOptions.bGridVisible, snap: o.IsSnap(), crossHair: o.IsCrossHair() };
    try { localStorage.setItem(LS_VIEW_OPTIONS, JSON.stringify(v)); } catch { /* storage may be unavailable */ }
    if (relayout) this.sh.m_pRoot.Layout();
    this.notify();
  }
  /** View > Formatting Marks (SwViewOption::IsViewMetaChars). */
  showControlCodes = false;
  /** View > Navigator (F5): the Navigator beside the document, kept for later sessions. */
  navigator = (() => { try { return localStorage.getItem('writer:navigator') === 'true'; } catch { return false; } })();
  toggleNavigator(on = !this.navigator): void {
    this.navigator = on;
    try { localStorage.setItem('writer:navigator', String(on)); } catch { /* storage may be unavailable */ }
    this.notify();
  }
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
  /** Counts the document's changes (for views that refresh after them, like the Navigator). */
  get editCount(): number { return this.edits; }
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
  /** The file the repair query asks about, and its awaited answer (RequestPackageReparation). */
  repairQuery: { name: string; resolve: (repair: boolean) => void } | null = null;
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
    // A store waiting for a pause in typing happens at once when the tab is hidden or closed.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(); });
      addEventListener('pagehide', () => this.flush());
    }
    this.sh = new SwWrtShell(this.newDoc(), this.measurer);
    this.attach();
  }

  /** The font faces loaded and the font mapping the layout was made with. */
  private laidOutWith = '';
  private fontState(): string {
    let loaded = 0;
    if (typeof document === 'undefined') return '';
    document.fonts.forEach((f) => { if (f.status === 'loaded') loaded++; });
    return `${loaded}/${GetFontStacksGeneration()}`;
  }

  /**
   * Web fonts finished loading or the font profile changed: measure and lay out again. Nothing
   * is done when no face loaded and the mapping stayed since the last layout (a long document
   * takes seconds to lay out).
   */
  fontsChanged(): void {
    const state = this.fontState();
    if (state === this.laidOutWith) return;
    this.laidOutWith = state;
    this.measurer.Invalidate();
    this.sh.m_pRoot.InvalidateFonts();
    this.sh.m_pRoot.Layout();
    this.notify();
  }

  /**
   * The web fonts a document uses, loaded before it is laid out (for at most a few seconds), so
   * that it is laid out once with them rather than again when they arrive.
   */
  private async preloadFonts(doc: SwDoc): Promise<void> {
    if (typeof document === 'undefined') return;
    SetFontFamilies(doc.m_aFontFamilies);
    const loads: Promise<unknown>[] = [];
    for (const family of documentFontsOf(doc)) {
      for (const [bold, italic] of [[false, false], [true, false]] as const) loads.push(document.fonts.load(cssFont({ family, size: 240, bold, italic })).catch(() => []));
    }
    await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, FONT_PRELOAD_MS))]);
  }

  /** The file being opened, while it is read and laid out (the loading indicator shows it). */
  opening: string | null = null;

  /**
   * Shows the loading indicator for a large file, and lets it paint before the import and the
   * layout hold up the page.
   */
  private async showOpening(name: string, size: number): Promise<void> {
    if (size < LARGE_FILE) return;
    this.opening = name;
    this.notify();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  }

  /** The font names the document uses: in its defaults, styles and text (for the font list). */
  documentFonts(): Set<string> { return documentFontsOf(this.sh.m_pDoc); }

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
      // SwTextNode's autocomplete dirty flag: a paragraph is collected again only when its text
      // changed; the paragraphs are gone through in slices, so that a long document never holds
      // up typing (sw's idle handler, SwLayIdle::DoIdleJob's AUTOCOMPLETE_WORDS).
      const sh = this.sh, nodes = sh.m_pDoc.GetNodes();
      let n = nodes.GoNext(0);
      const slice = () => {
        if (sh !== this.sh) return;
        const pt = sh.m_pCursor.GetPoint();
        const until = performance.now() + 8;
        for (; n && performance.now() < until; n = nodes.GoNext(n.GetIndex())) {
          const text = n.GetText();
          if (collectedWords.get(n) === text && n !== pt.GetNode()) continue;
          CollectAutoCmplWrds(n, autoCompleteWords, this.docId, n === pt.GetNode() ? pt.GetContentIndex() : -1);
          collectedWords.set(n, text);
        }
        if (n) this.collectTimer = setTimeout(slice, 0);
      };
      slice();
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
    // The document's view settings come from its view (SwXMLExport::GetViewSettings).
    const sh = this.sh;
    sh.m_pDoc.m_fnGetViewData = () => sh.GetViewData();
    this.restoreViewPosition(this.docId);
    this.sh.m_pSpell = this.spell;
    this.sh.m_bOnlineSpell = this.onlineSpell;
    this.sh.m_fnReadonly = () => this.setMessage(t('table.readonly'));
    this.sh.m_bInsTableFormatNum = this.numberRecognition;
    // The document opens in Paper View; it does not keep Screen View.
    this.viewOpt.setBrowseMode(false);
    this.sh.m_pRoot.m_pViewOpt = this.viewOpt;
    void this.loadUsedDictionaries();
    this.unsubscribeDoc();
    this.unsubscribeDoc = this.sh.m_pDoc.Subscribe(() => {
      // A style preview is no edit: the view follows it, but nothing is stored or counted.
      if (this.previewing) { this.notify(); return; }
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

  /**
   * The style preview of the paragraph style list (the web shell's, not LibreOffice's): the
   * selected paragraphs show the style the pointer is on, as SwDoc::SetTextFormatColl would set it,
   * but outside undo and without marking the document modified. Each keeps its style and own
   * attributes to get back when the preview ends.
   */
  private stylePreview: { saved: { n: SwTextNode; coll: SwTextFormatColl; set: SwAttrSet }[]; ranges: SwChangeRange[] } | null = null;
  private previewing = false;

  /** Shows the selected paragraphs in paragraph style `name`; only with a selection of text. */
  previewParaStyle(name: string): void {
    const restored = this.restoreParaStyles();
    const sh = this.sh, doc = sh.m_pDoc;
    const coll = doc.FindTextFormatCollByName(name);
    if (!coll || !sh.HasSelection() || sh.IsTableMode() || sh.IsFrameSelected()) { if (restored) this.previewChanged(restored); return; }
    const nodes = doc.GetNodes();
    const first = sh.m_pCursor.Start().GetNodeIndex(), last = sh.m_pCursor.End().GetNodeIndex();
    const saved: { n: SwTextNode; coll: SwTextFormatColl; set: SwAttrSet }[] = [];
    for (let i = first; i <= last; i++) {
      const n = nodes.node(i);
      if (!n.IsTextNode()) continue;
      saved.push({ n, coll: n.m_pColl, set: n.m_aSet });
      // As SwDoc::SetTextFormatColl: the paragraph loses its own attributes, apart from a tracked paragraph end.
      n.m_pColl = coll;
      n.m_aSet = n.m_aSet.RES_PARATR_REDLINE ? { RES_PARATR_REDLINE: n.m_aSet.RES_PARATR_REDLINE } : {};
      n.m_nVersion++;
    }
    const ranges = [{ prev: first > 0 ? nodes.node(first - 1) : null, next: nodes.node(last + 1) }];
    this.stylePreview = { saved, ranges };
    // Moving from one style to the next, the same paragraphs change.
    const same = !restored || (restored.length === 1 && restored[0]!.prev === ranges[0]!.prev && restored[0]!.next === ranges[0]!.next);
    this.previewChanged(same ? ranges : null);
  }

  /** Ends the style preview: the paragraphs have their styles and attributes back. */
  endParaStylePreview(): void {
    const restored = this.restoreParaStyles();
    if (restored) this.previewChanged(restored);
  }

  private restoreParaStyles(): SwChangeRange[] | null {
    const p = this.stylePreview;
    if (!p) return null;
    this.stylePreview = null;
    for (const { n, coll, set } of p.saved) { n.m_pColl = coll; n.m_aSet = set; n.m_nVersion++; }
    return p.ranges;
  }

  /** Lays out what the preview changed (null: the whole document) and shows it. */
  private previewChanged(ranges: SwChangeRange[] | null): void {
    this.previewing = true;
    try { this.sh.m_pDoc.Changed(ranges); } finally { this.previewing = false; }
  }

  get title(): string { return `${this.sh.m_pDoc.IsModified() ? '● ' : ''}${this.name}`; }
  setDialog(d: DialogId): void {
    // The "Save Document?" query closed without an answer (Escape) cancels.
    if (this.dialog === 'querysave' && d !== 'querysave' && this.querySave) this.answerQuerySave(false);
    if (this.dialog === 'repairpackage' && d !== 'repairpackage' && this.repairQuery) this.answerRepair(false);
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
  /**
   * Arms (or with null, cancels) drawing a shape of a type with the mouse; DRAW_TEXT and
   * DRAW_TEXT_VERTICAL draw a text object.
   */
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
    this.laidOutWith = this.fontState();
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
    // version (ExportODT reads the document at once, before any change can come).
    this.pendingAutoVersion = null;
    this.sessionBase = this.autoSave && savedAt !== undefined ? { bytes: ExportODT(doc, [], template), time: new Date(savedAt) } : null;
    this.sessionBase?.bytes.catch(() => { this.sessionBase = this.pendingAutoVersion = null; });
    this.attach();
    setLastDocId(id);
    this.notify();
  }

  /**
   * Where the document was left, for the editor to go to once it has laid the document out
   * (SwView::ReadUserDataSequence); the editor takes it.
   */
  restoreView: ViewPosition | null = null;

  /**
   * Remembers where the document was left: its file has the position of its last store
   * (settings.xml's view settings), the browser the position when the tab was hidden or another
   * document opened, without storing the document again.
   */
  private keepViewPosition(): void {
    const d = this.sh.GetViewData();
    if (!d || !this.docId) return;
    const pt = this.sh.m_pCursor.GetPoint();
    try {
      const all = JSON.parse(localStorage.getItem(LS_VIEW_POSITIONS) ?? '{}') as Record<string, ViewPosition>;
      delete all[this.docId];
      all[this.docId] = { view: d, node: pt.GetNodeIndex(), content: pt.GetContentIndex() };
      const ids = Object.keys(all);
      for (const id of ids.slice(0, Math.max(0, ids.length - MAX_VIEW_POSITIONS))) delete all[id];
      localStorage.setItem(LS_VIEW_POSITIONS, JSON.stringify(all));
    } catch { /* storage may be unavailable */ }
  }

  /** SwView::ReadUserDataSequence: the cursor and the visible area where the document was left. */
  private restoreViewPosition(id: string): void {
    const d = this.sh.m_pDoc.m_aViewData;
    let kept: ViewPosition | undefined;
    try { kept = (JSON.parse(localStorage.getItem(LS_VIEW_POSITIONS) ?? '{}') as Record<string, ViewPosition>)[id]; } catch { /* storage may be unavailable */ }
    this.restoreView = kept?.view ? kept : d ? { view: d } : null;
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

  /**
   * File > New > Text Document: made from the default template (Templates > Set as Default,
   * SfxObjectFactory::GetStandardTemplate) when there is one, else empty.
   */
  async newDocument(): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    const def = getDefaultTemplate();
    if (def && (await this.installFromTemplate(def))) return;
    this.install(this.newDoc(), 'Untitled', newId(), null);
  }

  // --- Templates (sfx2's template manager, Save as Template, Edit Template, Load Styles) ---

  /**
   * A new, untitled document from a template's package (opened AsTemplate): its content and
   * styles, with ResetFromTemplate's document properties. False when the template is missing.
   */
  private async installFromTemplate(id: string): Promise<boolean> {
    let tpl: { bytes: Uint8Array; name: string } | null = null;
    try { tpl = await templateBytes(id); } catch { tpl = null; }
    if (!tpl) return false;
    try {
      const { doc, lost } = await ImportODT(tpl.bytes);
      ResetFromTemplate(doc, tpl.name, `${tpl.name}.ott`);
      this.install(doc, 'Untitled', newId(), null);
      if (lost.length) this.setMessage(t('templates.lost', { name: tpl.name, what: lost.join('; ') }));
      return true;
    } catch (e) {
      this.setMessage(t('templates.openFailed', { name: tpl.name, error: (e as Error).message }));
      return true;
    }
  }

  /** The template manager's Open (OpenTemplateHdl): a new document from the template. */
  async newFromTemplate(id: string): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    if (!(await this.installFromTemplate(id))) this.setMessage(t('templates.missing'));
  }

  /**
   * The template manager's Edit (EditTemplateHdl, AsTemplate false): the template itself opens,
   * and is stored as it is edited. LibreOffice's own templates are read-only: one opens as a new
   * template, stored in My Templates once changed.
   */
  async editTemplate(id: string): Promise<void> {
    if (!isBuiltIn(id)) { await this.openStored(id); return; }
    const tpl = await templateBytes(id).catch(() => null);
    if (!tpl) { this.setMessage(t('templates.missing')); return; }
    if (!(await this.confirmClose())) return;
    this.flush();
    const { doc, lost, storage } = await ImportODT(tpl.bytes);
    this.install(doc, tpl.name, newId(), null, storage ?? null, undefined, true);
    this.setMessage(lost.length ? t('templates.lost', { name: tpl.name, what: lost.join('; ') }) : t('templates.editBuiltIn', { name: tpl.name }));
  }

  /**
   * Save as Template (SfxSaveAsTemplateDialog::SaveTemplate): the document as a template, with a
   * thumbnail, stored under `name` in `region`, replacing the template `replace` when given; with
   * `setDefault`, new documents are made from it. The document stays as it is.
   */
  async saveAsTemplate(name: string, region: string, setDefault: boolean, replace?: string): Promise<void> {
    try {
      const thumbnail = await renderThumbnail(this.sh.m_pDoc).catch(() => null);
      const bytes = await this.package(this.sh.m_pDoc, new SfxMedium(), undefined, true, thumbnail ? [{ name: 'Thumbnails/thumbnail.png', data: thumbnail, store: true }] : []);
      const id = replace ?? newId();
      await putDoc({ id, name, updated: Date.now(), bytes, category: region, ...(thumbnail ? { thumbnail } : {}) });
      if (setDefault) setDefaultTemplate(id);
      this.setMessage(t('templates.saved', { name }), [], NOTICE_TIMEOUT);
    } catch (e) {
      this.setMessage(t('templates.saveFailed', { name, error: (e as Error).message }));
    }
  }

  /** The template manager's Export: each template downloads as an .ott file. */
  async exportTemplates(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const tpl = await templateBytes(id).catch(() => null);
      if (tpl) this.saveBlob(new Blob([tpl.bytes as BlobPart], { type: OTT_MIME }), `${tpl.name}.ott`);
    }
  }

  /**
   * The template manager's Import (OnTemplateImportCategory): template files into a category. An
   * OpenDocument template is stored as it is; a Word template (.dotx, .dot) is converted, as
   * upstream stores a template it cannot copy through its filters. Returns the files that failed.
   */
  async importTemplates(files: readonly File[], region: string): Promise<string[]> {
    const failed: string[] = [];
    for (const file of files) {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const base = file.name.replace(/\.[^.]*$/, '');
        let bytes: Uint8Array, doc: SwDoc;
        if (/\.ot[th]$/i.test(file.name) || /\.od[th]$/i.test(file.name)) {
          const r = await ImportODT(data);
          doc = r.doc;
          bytes = r.template ? data : await ExportODT(doc, [], true);
        } else if (/\.dotx?$/i.test(file.name) || /\.docx?$/i.test(file.name)) {
          doc = /\.do[ct]$/i.test(file.name) ? (await ImportDOC(data)).doc : (await ImportDOCX(data)).doc;
          bytes = await ExportODT(doc, [], true);
        } else { failed.push(file.name); continue; }
        // SfxDocTplService's GetTitleFromURL: the document's title, else the file's name.
        const name = doc.m_xDocProps.getTitle() || base;
        const own = (await readZip(bytes)).get('Thumbnails/thumbnail.png');
        const thumbnail = own ?? (await renderThumbnail(doc).catch(() => null)) ?? undefined;
        await putDoc({ id: newId(), name, updated: Date.now(), bytes, category: region, ...(thumbnail ? { thumbnail } : {}) });
      } catch { failed.push(file.name); }
    }
    return failed;
  }

  /** Copies a template into a category (moving one of LibreOffice's own, which cannot move). */
  async copyTemplate(id: string, region: string): Promise<void> {
    const tpl = await templateBytes(id);
    if (!tpl) return;
    const thumb = (await readZip(tpl.bytes)).get('Thumbnails/thumbnail.png');
    await putDoc({ id: newId(), name: tpl.name, updated: Date.now(), bytes: tpl.bytes, category: region, ...(thumb ? { thumbnail: thumb } : {}) });
  }

  /**
   * File > Templates > Edit Template (SID_OPENTEMPLATE): a template file opens for editing itself,
   * not as a new document; Save writes back to it where the browser allows.
   */
  async openTemplateFile(): Promise<void> {
    const w = window as PickerWindow;
    const open = async (file: File, handle: FileHandle | null) => {
      if (!(await this.confirmClose())) return;
      this.flush();
      try {
        await this.loadBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.ott$/i, ''), newId(), handle, file.lastModified);
      } catch (e) { this.setMessage(`${file.name} could not be opened: ${(e as Error).message}`); }
    };
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker({ types: [saveTypes[1]] });
        if (h) await open(await h.getFile(), h);
      } catch (e) { if ((e as DOMException).name !== 'AbortError') this.setMessage((e as Error).message); }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ott';
    input.onchange = () => { if (input.files?.[0]) void open(input.files[0], null); };
    input.click();
  }

  /**
   * Styles > Load Styles from Template (SID_TEMPLATE_LOAD): the styles of a template, or of an
   * OpenDocument file, loaded into the document as the flags choose.
   */
  async loadStyles(source: { id: string } | { file: File }, nFlags: SfxTemplateFlags): Promise<void> {
    try {
      const bytes = 'id' in source ? (await templateBytes(source.id))?.bytes : new Uint8Array(await source.file.arrayBuffer());
      if (!bytes) { this.setMessage(t('templates.missing')); return; }
      const ok = await LoadStylesFromFile(this.sh.m_pDoc, this.sh.m_pCursor, bytes, ReaderOptions(nFlags));
      if (!ok) this.setMessage(t('loadstyles.notOwn', { name: 'file' in source ? source.file.name : '' }));
      this.notify();
    } catch (e) {
      this.setMessage(t('loadstyles.failed', { error: (e as Error).message }));
    }
  }

  /** The templates for the dialogs. */
  listTemplates = listTemplates;

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
  private async importPackage(name: string, load: (bRepairPackage: boolean) => Promise<ImportResult>): Promise<{ result: ImportResult; repaired: boolean } | null> {
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
    await this.showOpening(name, bytes.length);
    let r: ImportResult;
    try {
      r = await ImportODT(bytes);
      await this.preloadFonts(r.doc);
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
    const stored = await getDoc(id);
    if (stored) await this.loadBytes(stored.bytes, stored.name, stored.id, null, stored.updated);
    this.setDialog(null);
  }

  async openFile(file: File, handle: FileHandle | null): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.flush();
    try {
      await this.showOpening(file.name, file.size);
      if (/\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown') {
        // MarkdownReader: the parser is loaded with the first Markdown file.
        const { mdParse } = await import('./markdown.ts');
        const { doc, lost } = ImportMarkdown(await file.text(), mdParse);
        await this.preloadFonts(doc);
        this.install(doc, file.name.replace(/\.(md|markdown)$/i, ''), newId(), lost.length ? null : handle);
        if (lost.length) this.openedAsCopy(lost);
      } else if (/\.(html?|xhtml)$/i.test(file.name) || file.type === 'text/html' || file.type === 'application/xhtml+xml') {
        // HTMLReader: content the filter does not port opens the document as a copy.
        const { doc, lost } = ImportHTML(new Uint8Array(await file.arrayBuffer()));
        await this.preloadFonts(doc);
        this.install(doc, file.name.replace(/\.(html?|xhtml)$/i, ''), newId(), lost.length || /\.xhtml$/i.test(file.name) ? null : handle);
        if (lost.length) this.openedAsCopy(lost);
      } else if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
        const doc = ImportText(await file.text());
        await this.preloadFonts(doc);
        this.install(doc, file.name.replace(/\.txt$/i, ''), newId(), handle);
      } else if (/\.odt$/i.test(file.name)) {
        const data = new Uint8Array(await file.arrayBuffer());
        const r = await this.importPackage(file.name, (repair) => ImportODT(data, repair));
        if (!r) return;
        const { doc, lost, storage, template } = r.result;
        // A repaired document is a new one: saving must not overwrite the broken file.
        const keep = !r.repaired && !lost.length;
        await this.preloadFonts(doc);
        this.install(doc, file.name.replace(/\.odt$/i, ''), newId(), keep ? handle : null, storage ?? null, file.lastModified, template);
        if (lost.length) this.openedAsCopy(lost);
      } else if (/\.ott$/i.test(file.name)) {
        // A template opens as a new, untitled document made from it (SfxObjectShell's AsTemplate).
        const data = new Uint8Array(await file.arrayBuffer());
        const r = await this.importPackage(file.name, (repair) => ImportODT(data, repair));
        if (!r) return;
        const { doc, lost } = r.result;
        ResetFromTemplate(doc, doc.m_xDocProps.getTitle() || file.name.replace(/\.ott$/i, ''), file.name);
        await this.preloadFonts(doc);
        this.install(doc, file.name.replace(/\.ott$/i, ''), newId(), null);
        if (lost.length) this.openedAsCopy(lost);
      } else if (/\.do[ct]$/i.test(file.name) || file.type === 'application/msword') {
        // Word 6.0 to 2003 (.doc, and .dot templates, which open as new documents): never written back.
        const { doc, lost } = await ImportDOC(new Uint8Array(await file.arrayBuffer()));
        await this.preloadFonts(doc);
        this.install(doc, file.name.replace(/\.do[ct]$/i, ''), newId(), null);
        this.openedAsCopy(lost, true);
      } else if (/\.do[ct]x$/i.test(file.name)) {
        // A Word template (.dotx) is the same package: it opens as a new document, as in Word.
        // Word files are never written back: they are stored as ODT, and Download As writes Word again.
        const data = new Uint8Array(await file.arrayBuffer());
        const r = await this.importPackage(file.name, (repair) => ImportDOCX(data, repair));
        if (!r) return;
        const { doc, lost } = r.result;
        await this.preloadFonts(doc);
        this.install(doc, file.name.replace(/\.do[ct]x$/i, ''), newId(), null);
        this.openedAsCopy(lost, true);
      } else {
        this.setMessage(`${file.name}: this file type is not supported yet. Writer can open .odt, .ott, .docx, .dotx, .doc, .dot, .html, .md and .txt files.`);
        return;
      }
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
        const [h] = await w.showOpenFilePicker({ types: openTypes });
        if (h) await this.openFile(await h.getFile(), h);
      } catch (e) { if ((e as DOMException).name !== 'AbortError') this.setMessage((e as Error).message); }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.odt,.ott,.docx,.dotx,.doc,.dot,.txt,.md,.markdown,.html,.htm,.xhtml';
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
  private scheduleSave(): void {
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
  private flush(): void {
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
  private package(doc = this.sh.m_pDoc, medium = this.medium, args?: SaveToArgs, template = this.template, more: ZipEntry[] = []): Promise<Uint8Array> {
    // A style preview is not stored.
    this.endParaStylePreview();
    return SaveTo_Impl((extra) => ExportODT(doc, [...extra, ...more], template), medium, args);
  }

  private async serialise(filename: string): Promise<Blob> {
    this.endParaStylePreview();
    if (/\.txt$/i.test(filename)) return new Blob([ExportText(this.sh.m_pDoc)], { type: 'text/plain' });
    if (/\.(md|markdown)$/i.test(filename)) return new Blob([ExportMarkdown(this.sh.m_pDoc)], { type: 'text/markdown' });
    if (/\.html?$/i.test(filename)) return new Blob([ExportHTML(this.sh.m_pDoc)], { type: 'text/html' });
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
      // A template's thumbnail shows it as saved (not after every change autosave stores).
      if (this.template) {
        const { docId } = this;
        const thumbnail = await renderThumbnail(this.sh.m_pDoc).catch(() => null);
        if (thumbnail) await updateDoc(docId, { thumbnail });
      }
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
      const first = ({ odt: 0, ott: 1, docx: 2, txt: 3, md: 4, html: 5 } as const)[format];
      const types = [saveTypes[first]!, ...saveTypes.filter((_, i) => i !== first)];
      const h = await w.showSaveFilePicker!({ suggestedName: `${this.name}.${format}`, types });
      UpdateDocInfoForSave(this.sh.m_pDoc, this.userFullName);
      await this.writeHandle(h);
      this.handle = h;
      // Saved as .ott, the document is a template from now on; saved as .odt, it no longer is one.
      if (/\.o[dt]t$/i.test(h.name)) this.template = /\.ott$/i.test(h.name);
      this.name = h.name.replace(/\.(odt|ott|docx|txt|md|markdown|html?)$/i, '');
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
   * Without `withVersions`, an ODT or OTT leaves out the versions (File > Versions); the document keeps them.
   */
  async download(name: string, format: FileFormat, withVersions = true): Promise<void> {
    try {
      if (withVersions || (format !== 'odt' && format !== 'ott')) { await this.downloadFile(`${name}.${format}`); return; }
      const bytes = await this.package(this.sh.m_pDoc, new SfxMedium(), undefined, format === 'ott');
      this.saveBlob(new Blob([bytes as BlobPart], { type: format === 'ott' ? OTT_MIME : ODT_MIME }), `${name}.${format}`);
    } catch (e) { this.setMessage(`Download failed: ${(e as Error).message}`); }
  }

  /**
   * File > Create Copy: stores the document as it is now as a new document in the browser, under
   * `name` and without its versions (File > Versions). The document stays open; the message offers
   * to open the copy.
   */
  async createCopy(name: string): Promise<void> {
    try {
      const bytes = await this.package(this.sh.m_pDoc, new SfxMedium(), undefined, this.template);
      const id = newId();
      await putDoc({ id, name, updated: Date.now(), bytes });
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
    const ext = /\.(odt|ott|docx|txt|md|markdown|html?)$/i.exec(this.handle?.name ?? '')?.[1]?.toLowerCase();
    return ext === 'markdown' ? 'md' : ext === 'htm' ? 'html' : (ext as FileFormat | undefined) ?? (this.template ? 'ott' : 'odt');
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

  /**
   * The object last copied or cut (SwTransferable's clipboard document). The system clipboard
   * gets HTML carrying its token: a paste uses this object only while the token is still there.
   */
  flyClipboard: { clip: SwFlyClip; token: string } | null = null;

  /**
   * Copies (or cuts) the selected object: kept in `flyClipboard`, and offered to other
   * applications as HTML (an image's picture, a formula's text) and plain text. Null without one.
   */
  copyFly(cut: boolean): { html: string; text: string } | null {
    const clip = this.sh.CopyFly();
    if (!clip) return null;
    const token = Math.random().toString(36).slice(2);
    this.flyClipboard = { clip, token };
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const f = clip.fmt;
    const lines = f.m_pMath ? [f.m_pMath.m_sText] : clip.text ? clip.text.map((p) => p.text.split(CH_TXTATR_BREAKWORD).join('')) : [f.alt ?? ''];
    let html: string;
    if (clip.graphic) {
      let bin = '';
      const d = clip.graphic.data;
      for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
      html = `<img data-lo-clip="${token}" alt="${esc(f.alt ?? '')}" src="data:${clip.graphic.mime};base64,${btoa(bin)}">`;
    } else html = `<div data-lo-clip="${token}">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
    if (cut) this.sh.DelSelectedFly();
    return { html, text: lines.join('\n') };
  }

  /** Pastes the copied object when the clipboard's HTML still carries its token; false otherwise. */
  pasteFly(html: string): boolean {
    const fc = this.flyClipboard;
    if (!fc || !html.includes(`data-lo-clip="${fc.token}"`)) return false;
    this.sh.PasteFly(fc.clip);
    return true;
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
