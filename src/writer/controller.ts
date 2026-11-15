// Owns the open document and everything the React tree renders from it.
import {
  AppController, LOCAL_LANGUAGETOOL_URL, NOTICE_TIMEOUT, newId, type AppDescription, type AppFileType, type FileHandle, type LanguageToolSettings,
  type PackageImport, type PickerWindow,
} from '@shell/appcontroller.ts';
import { readSetting, suiteKey } from '@shell/settings.ts';
import type { SwTextNode } from '@lo/sw/inc/ndtxt.ts';
import type { SwTextFormatColl } from '@lo/sw/inc/format.ts';
import type { SwAttrSet } from '@lo/sw/inc/hintids.ts';
import { ImportMarkdown } from '@lo/sw/source/filter/md/swmd.ts';
import { ExportMarkdown } from '@lo/sw/source/filter/md/wrtmd.ts';
import { ImportHTML } from '@lo/sw/source/filter/html/swhtml.ts';
import { ExportHTML } from '@lo/sw/source/filter/html/wrthtml.ts';
import { t } from '@shell/i18n.ts';
import { SwDoc, type SwChangeRange, type SwFlyClip, type SwViewData } from '@lo/sw/inc/doc.ts';
import { CH_TXTATR_BREAKWORD } from '@lo/sw/inc/hintids.ts';
import { SwWrtShell } from '@lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { CanvasTextMeasurer, GetFontStacksGeneration, SetFontFamilies, cssFont } from '@lo/vcl/source/outdev/text.ts';
import { GetPrefSize, GraphicManager, ImportBitmap, SetSvgDecoder } from '@lo/vcl/source/graphic/Manager.ts';
import { IsEMF, IsWMF } from '@lo/vcl/source/filter/wmf/wmf.ts';
import { ExecuteGrfFilter, GrfFilterTable } from '@lo/svx/source/dialog/grfflt.ts';
import { ExportODT, ImportODT, type ImportResult } from '@lo/sw/source/filter/xml/odt.ts';
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { ResetFromTemplate } from '@lo/sfx2/source/doc/objcont.ts';
import { SfxMedium } from '@lo/sfx2/source/doc/docfile.ts';
import { ExportText, ImportText } from '@lo/sw/source/filter/ascii/ascii.ts';
import { ImportDOCX } from '@lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { ImportDOC } from '@lo/sw/source/filter/ww8/ww8par.ts';
import { DOCX_MIME, ExportDOCX } from '@lo/sw/source/filter/ww8/docxexport.ts';
import { getDefaultTemplate, isBuiltIn, listTemplates, renderThumbnail, setDefaultTemplate, templateBytes } from './templates.ts';
import { LoadStylesFromFile, ReaderOptions, type SfxTemplateFlags } from '@lo/sw/source/uibase/app/docsh2.ts';
import type { ZipEntry } from '@lo/package/source/zipapi/zip.ts';
import { readZip } from '@lo/package/source/zipapi/zip.ts';
import { SpellChecker, LANGUAGE_NONE } from '@lo/lingucomponent/source/spellcheck/spell/sspellimp.ts';
import { findDictionary, isDictionaryCached, loadDictionary } from '@shell/spell.ts';
import { LANGUAGETOOL_DEFAULT_URL, LanguageToolGrammarChecker } from '@lo/lingucomponent/source/spellcheck/languagetool/languagetoolimp.ts';
import { GrammarCheckingIterator } from '@lo/linguistic/source/gciterator.ts';
import { LOCAL_LANGUAGETOOL_LOCALES, localLanguageTool } from '@shell/languagetool.ts';
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

export { LOCAL_LANGUAGETOOL_URL, type LanguageToolSettings };
export { dateOf } from '@shell/appcontroller.ts';
export type { UiMode } from '@shell/appcontroller.ts';

export type DialogId = 'documents' | 'character' | 'paragraph' | 'page' | 'find' | 'wordcount' | 'about' | 'table' | 'hyperlink' | 'specialchar' | 'options' | 'style' | 'newstyle' | 'toc' | 'fly' | 'redlines' | 'section' | 'sections' | 'columns' | 'break' | 'download' | 'spelling' | 'compress' | 'imagefilter' | 'objname' | 'alttext' | 'numbullet' | 'titlepage' | 'watermark' | 'docinfo' | 'sizecheck' | 'insrows' | 'inscols' | 'splitcells' | 'mergetable' | 'splittable' | 'rowheight' | 'colwidth' | 'tableprops' | 'autoformat' | 'texttotable' | 'tabletotext' | 'tablesort' | 'numformat' | 'caption' | 'formula' | 'contour' | 'querysave' | 'versions' | 'cleardata' | 'autocorrect' | 'createcopy' | 'saveversion' | 'templates' | 'saveastemplate' | 'loadstyles' | 'commandpopup' | 'repairpackage' | 'gotopage' | 'pagenumber' | 'signatureline' | 'signatureline-edit' | 'crossref' | 'fields' | 'bookmark' | 'pageheader' | 'pagefooter' | 'hfborder-header' | 'hfborder-footer' | 'query' | 'fieldinput' | 'idxentry-insert' | 'idxentry-edit' | 'authentry-insert' | 'authentry-edit' | null;

/**
 * Where a document was left: its view settings and, when the browser kept them, the cursor's node
 * and content index, which do not depend on the layout (fonts still loading move the lines).
 */
export interface ViewPosition { view: SwViewData; node?: number; content?: number }
/** The formats a document is saved or downloaded in. */
export type FileFormat = 'odt' | 'ott' | 'docx' | 'txt' | 'md' | 'html';
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const OTT_MIME = 'application/vnd.oasis.opendocument.text-template';
/** The file types File > Save to Computer and Download As offer, the document's own first. */
const saveTypes: AppFileType[] = [
  { id: 'odt', label: 'ODF Text Document (.odt)', description: 'OpenDocument Text', mime: ODT_MIME, exts: ['odt'] },
  { id: 'ott', label: 'ODF Text Document Template (.ott)', description: 'OpenDocument Text Template', mime: OTT_MIME, exts: ['ott'] },
  { id: 'docx', label: 'Word Document (.docx)', description: 'Word Document', mime: DOCX_MIME, exts: ['docx'] },
  { id: 'txt', label: 'Text (.txt)', description: 'Text', mime: 'text/plain', exts: ['txt'] },
  { id: 'md', label: 'Markdown (.md)', description: 'Markdown', mime: 'text/markdown', exts: ['md', 'markdown'] },
  { id: 'html', label: 'HTML Document (.html)', description: 'HTML Document', mime: 'text/html', exts: ['html', 'htm'] },
];
/** Writer for the shell: its storage and settings, and the file types it reads and writes. */
export const WRITER: AppDescription = {
  id: 'writer',
  name: 'Writer',
  docType: saveTypes[0]!,
  templateType: saveTypes[1]!,
  saveTypes,
  openTypes: [
    { description: 'Documents', accept: { [ODT_MIME]: ['.odt'], [OTT_MIME]: ['.ott'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.template': ['.dotx'], 'application/msword': ['.doc', '.dot'], 'text/plain': ['.txt'], 'text/markdown': ['.md', '.markdown'], 'text/html': ['.html', '.htm', '.xhtml'] } },
  ],
  openAccept: '.odt,.ott,.docx,.dotx,.doc,.dot,.txt,.md,.markdown,.html,.htm,.xhtml',
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

/** How long opening waits for a document's web fonts before laying it out without them. */
const FONT_PRELOAD_MS = 3000;

/** The text each paragraph had when its words were last collected for word completion. */
const collectedWords = new WeakMap<SwTextNode, string>();

export class Controller extends AppController<SwDoc, Exclude<DialogId, null>, ViewPosition> {
  readonly measurer = new CanvasTextMeasurer();
  /** Decoded graphics; replaced with the document so that bitmaps of a closed document are freed. */
  graphics = new GraphicManager();
  sh: SwWrtShell;
  /** View > Comments > Resolved Comments. */
  showResolvedComments = true;
  /** The author of new changes is the user (SwModule::GetRedlineAuthor). */
  protected override authorChanged(): void {
    this.sh.m_pDoc.m_pDocumentRedlineManager.m_sAuthor = this.author;
  }
  /** The spell checker shared by all documents, and the state of each dictionary by locale. */
  readonly spell = new SpellChecker();
  dictionaries = new Map<string, 'loading' | 'ready' | 'error'>();
  /** The grammar checker (LanguageTool), while it is enabled in Tools > Options > LanguageTool. */
  grammar: GrammarCheckingIterator | null = null;
  /** Set by the edit window: paints again (without moving to the caret). */
  onRepaint: () => void = () => {};
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
      const v = JSON.parse(readSetting(LS_VIEW_OPTIONS) ?? 'null') as StoredViewOptions | null;
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
  navigator = (() => { try { return readSetting('writer:navigator') === 'true'; } catch { return false; } })();
  toggleNavigator(on = !this.navigator): void {
    this.navigator = on;
    try { localStorage.setItem('writer:navigator', String(on)); } catch { /* storage may be unavailable */ }
    this.notify();
  }
  /** Clone Formatting (SwFormatClipboard): formatting copied, waiting to be applied by the next selection. */
  formatClipboard: { chars: import('@lo/sw/inc/hintids.ts').SwCharAttrSet; para: import('@lo/sw/inc/hintids.ts').SwAttrSet; coll: string } | null = null;
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
  get numberRecognition(): boolean { try { return readSetting('writer:numberRecognition') === 'true'; } catch { return false; } }
  set numberRecognition(on: boolean) {
    try { localStorage.setItem('writer:numberRecognition', String(on)); } catch { /* storage may be unavailable */ }
    this.sh.m_bInsTableFormatNum = on;
    this.notify();
  }
  private unsubscribeDoc: () => void = () => {};
  /** The input field the Input Field dialog edits (SwWrtShell::StartInputFieldDlg), by node index and position. */
  inputField: { nNode: number; nAt: number } | null = null;

  /** SwWrtShell::StartInputFieldDlg: the Input Field dialog for the input field at a position. */
  StartInputFieldDlg(nNode: number, nAt: number): void {
    this.inputField = { nNode, nAt };
    this.setDialog('fieldinput');
  }
  /**
   * The page style the page dialog and the header's or footer's border dialog edit, when another
   * than the cursor's (the header/footer button of a page); null for the cursor's.
   */
  dialogPageStyle: string | null = null;
  /** Set by the edit window: scrolls the caret into view after the next paint. */
  onEdit: () => void = () => {};

  constructor() {
    super(WRITER);
    try { for (const w of JSON.parse(readSetting(suiteKey('userwords')) ?? '[]') as string[]) this.spell.AddWord(w); } catch { /* none */ }
    // SvxAutoCorrCfg: the options, the lists of the languages in use, and the spell checker that
    // keeps correctly spelt words from being "corrected" (FnCapitalStartWord).
    initAutoCorrect(navigator.language || 'en-US', (w, l) => (this.spell.hasLanguage(l) ? this.spell.isValid(w, l) ?? undefined : undefined), () => this.notify());
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
  override fontsChanged(): void {
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
  private async preloadFonts(doc: SwDoc, bInstall = true): Promise<void> {
    if (typeof document === 'undefined') return;
    if (bInstall) SetFontFamilies(doc.m_aFontFamilies);
    const loads: Promise<unknown>[] = [];
    for (const family of documentFontsOf(doc)) {
      for (const [bold, italic] of [[false, false], [true, false]] as const) loads.push(document.fonts.load(cssFont({ family, size: 240, bold, italic })).catch(() => []));
    }
    await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, FONT_PRELOAD_MS))]);
  }

  /** The font names the document uses: in its defaults, styles and text (for the font list). */
  override documentFonts(): Set<string> { return documentFontsOf(this.sh.m_pDoc); }

  /** A new document in the user's language, so that spelling uses their dictionary. */
  protected newDoc(): SwDoc {
    const doc = new SwDoc();
    // SfxPickListImpl, SfxEventHintId::CreateDoc: the author and creation date of a new document.
    doc.m_xDocProps.setAuthor(this.userFullName);
    doc.m_xDocProps.setCreationDate(DateTimeNow());
    const d = findDictionary(navigator.language || 'en-US');
    doc.FindTextFormatCollByName('Standard')!.m_aSet.RES_CHRATR_LANGUAGE = d?.locale ?? (navigator.language || 'en-US');
    return doc;
  }

  // --- spelling (SwView::ExecLingu, the Tools > Language menus and the status bar's language) ---

  /** Tools > Automatic Spell Checking, remembered across sessions. */
  get onlineSpell(): boolean {
    try { return readSetting(suiteKey('autospell')) !== 'false'; } catch { return true; }
  }
  set onlineSpell(on: boolean) {
    try { localStorage.setItem(suiteKey('autospell'), String(on)); } catch { /* storage may be unavailable */ }
    this.sh.m_bOnlineSpell = on;
    if (on) void this.loadUsedDictionaries(true);
    this.notify();
  }

  /** Tools > Options > LanguageTool changed: the grammar checker starts again with the settings. */
  protected override languageToolChanged(cfg: LanguageToolSettings): void {
    this.initGrammar();
    if (!cfg.IsEnabled) void this.loadUsedDictionaries();
    this.onRepaint();
  }

  /** Starts (or stops) the grammar checker with the current settings. */
  private initGrammar(): void {
    this.grammar?.dispose();
    this.grammar = null;
    const cfg = this.languageToolCfg;
    if (cfg.IsEnabled && cfg.BaseURL) {
      const checker = new LanguageToolGrammarChecker(cfg, (url, init) => (url.startsWith(LOCAL_LANGUAGETOOL_URL) ? localLanguageTool(url, init) : fetch(url, init)),
        (message, server) => this.setMessage(t('languagetool.unreachable', { server, message })),
        cfg.BaseURL === LOCAL_LANGUAGETOOL_URL ? LOCAL_LANGUAGETOOL_LOCALES : null);
      // The free server takes 20 requests a minute.
      const free = cfg.BaseURL.replace(/\/+$/, '') === LANGUAGETOOL_DEFAULT_URL && !cfg.ApiKey;
      const local = cfg.BaseURL === LOCAL_LANGUAGETOOL_URL;
      this.grammar = new GrammarCheckingIterator(checker, () => this.onRepaint(), { nMaxRequestsPerMinute: free ? 18 : 0, nDelay: local ? 300 : 800 });
    }
    this.sh.m_pGrammar = this.grammar;
  }

  /**
   * Checks the whole document with the grammar checker, for Tools > Spelling. As upstream's
   * Spelling dialog, this does not depend on Tools > Automatic Spell Checking: LanguageTool also
   * checks the spelling of its languages, so without it the dialog would find nothing.
   */
  async proofreadAll(): Promise<void> {
    const gc = this.grammar;
    if (!gc) return;
    const nodes = this.sh.m_pDoc.GetNodes();
    for (let n = nodes.GoNext(nodes.BodyStart() - 1); n; n = nodes.GoNext(n.GetIndex())) this.sh.GetWrongList(n);
    await gc.WhenIdle();
  }

  /** Loads the dictionary for a language (downloading it once); the document is checked again. */
  async ensureDictionary(lang: string): Promise<void> {
    if (!lang || lang === LANGUAGE_NONE) return;
    // LanguageTool checks the spelling of its languages instead.
    if (this.grammar?.hasLocale(lang)) return;
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
    try { localStorage.setItem(suiteKey('userwords'), JSON.stringify([...this.spell.m_aUserWords])); } catch { /* storage may be unavailable */ }
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

  protected attach(): void {
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
    if (!this.grammar && this.languageToolCfg.IsEnabled) this.initGrammar();
    this.sh.m_pGrammar = this.grammar;
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

  override notify(): void {
    // SwCursorShell::CheckTableBoxContent: a box the cursor has left is checked for a number.
    this.sh.CheckTableBoxContent();
    super.notify();
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

  /** The open document's model (SwDoc). */
  get document(): SwDoc { return this.sh.m_pDoc; }

  override setDialog(d: DialogId): void {
    if (d === null) this.dialogPageStyle = null;
    super.setDialog(d);
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
  protected installDocument(doc: SwDoc): void {
    const onLoaded = this.graphics.onLoaded;
    this.graphics = new GraphicManager();
    this.graphics.onLoaded = onLoaded;
    // The fallback of fonts the system lacks follows their family in the document's font table.
    SetFontFamilies(doc.m_aFontFamilies);
    this.sh = new SwWrtShell(doc, this.measurer);
    this.laidOutWith = this.fontState();
  }

  /** Where the document is now: its view settings and the cursor's node and content index. */
  protected currentViewPosition(): ViewPosition | null {
    const d = this.sh.GetViewData();
    if (!d) return null;
    const pt = this.sh.m_pCursor.GetPoint();
    return { view: d, node: pt.GetNodeIndex(), content: pt.GetContentIndex() };
  }

  /** Where the document's file says it was left (settings.xml's view settings). */
  protected documentViewPosition(): ViewPosition | null {
    const d = this.sh.m_pDoc.m_aViewData;
    return d ? { view: d } : null;
  }

  protected readPackage(bytes: Uint8Array, bRepairPackage?: boolean): Promise<PackageImport<SwDoc>> { return ImportODT(bytes, bRepairPackage); }
  protected exportPackage(doc: SwDoc, extra: readonly ZipEntry[], template: boolean): Promise<Uint8Array> { return ExportODT(doc, [...extra], template); }
  /** The web fonts a document uses, before it is laid out. */
  protected override prepareDocument(doc: SwDoc): Promise<void> { return this.preloadFonts(doc); }
  /** A style preview is not stored. */
  protected override beforeSerialise(): void { this.endParaStylePreview(); }

  /** File > New > Text Document from the default template, when there is one. */
  protected override async newFromDefaultTemplate(): Promise<boolean> {
    const def = getDefaultTemplate();
    return !!def && (await this.installFromTemplate(def));
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
      await this.storage.putDoc({ id, name, updated: Date.now(), bytes, category: region, ...(thumbnail ? { thumbnail } : {}) });
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
        await this.storage.putDoc({ id: newId(), name, updated: Date.now(), bytes, category: region, ...(thumbnail ? { thumbnail } : {}) });
      } catch { failed.push(file.name); }
    }
    return failed;
  }

  /** Copies a template into a category (moving one of LibreOffice's own, which cannot move). */
  async copyTemplate(id: string, region: string): Promise<void> {
    const tpl = await templateBytes(id);
    if (!tpl) return;
    const thumb = (await readZip(tpl.bytes)).get('Thumbnails/thumbnail.png');
    await this.storage.putDoc({ id: newId(), name: tpl.name, updated: Date.now(), bytes: tpl.bytes, category: region, ...(thumb ? { thumbnail: thumb } : {}) });
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

  /**
   * SwWrtShell::ChangeHeaderOrFooter with bShowWarning: turning off a header or footer that is on
   * asks first (DeleteHeaderDialog, DeleteFooterDialog); an empty `desc` means every page style.
   */
  async changeHeaderOrFooter(bHeader: boolean, bOn: boolean, desc = this.sh.GetCurPageDesc().m_aName): Promise<void> {
    if (!bOn) {
      const names = desc === '' ? [...this.sh.m_pDoc.m_aPageDescs.keys()] : [desc];
      if (names.some((n) => this.sh.IsHeaderOn(bHeader, n))
        && !(await this.queryYesNo(t(bHeader ? 'hf.deleteHeaderTitle' : 'hf.deleteFooterTitle'), t(bHeader ? 'hf.deleteHeaderText' : 'hf.deleteFooterText')))) return;
    }
    this.sh.ChangeHeaderOrFooter(bHeader, bOn, true, desc);
    this.notify();
    this.focusEditor();
  }

  /** Opens a file of any type Writer reads (the shell's openFile); false when it is not opened. */
  protected async importFile(file: File, handle: FileHandle | null): Promise<boolean> {
    {
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
        if (!r) return false;
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
        if (!r) return false;
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
        this.openedAsCopy(lost);
      } else if (/\.do[ct]x$/i.test(file.name)) {
        // A Word template (.dotx) is the same package: it opens as a new document, as in Word.
        // Word files are never written back: they are stored as ODT, and Download As writes Word again.
        const data = new Uint8Array(await file.arrayBuffer());
        const r = await this.importPackage(file.name, (repair) => ImportDOCX(data, repair));
        if (!r) return false;
        const { doc, lost } = r.result;
        await this.preloadFonts(doc);
        this.install(doc, file.name.replace(/\.do[ct]x$/i, ''), newId(), null);
        this.openedAsCopy(lost);
      } else {
        this.setMessage(`${file.name}: this file type is not supported yet. Writer can open .odt, .ott, .docx, .dotx, .doc, .dot, .html, .md and .txt files.`);
        return false;
      }
      return true;
    }
  }

  /** The document in Writer's other formats (Text, Markdown, HTML, Word); null for ODT and OTT. */
  protected async exportFile(filename: string): Promise<Blob | null> {
    if (/\.txt$/i.test(filename)) return new Blob([ExportText(this.sh.m_pDoc)], { type: 'text/plain' });
    if (/\.(md|markdown)$/i.test(filename)) return new Blob([ExportMarkdown(this.sh.m_pDoc)], { type: 'text/markdown' });
    if (/\.html?$/i.test(filename)) return new Blob([ExportHTML(this.sh.m_pDoc)], { type: 'text/html' });
    if (/\.docx$/i.test(filename)) return new Blob([(await ExportDOCX(this.sh.m_pDoc)) as BlobPart], { type: DOCX_MIME });
    return null;
  }

  /** A template's thumbnail shows it as saved (not after every change autosave stores). */
  protected override async afterSave(): Promise<void> {
    if (this.template) {
      const { docId } = this;
      const thumbnail = await renderThumbnail(this.sh.m_pDoc).catch(() => null);
      if (thumbnail) await this.storage.updateDoc(docId, { thumbnail });
    }
  }

  /** The document's own file format: its file's on disk, else OpenDocument (a template's .ott). */
  override fileFormat(): FileFormat { return super.fileFormat() as FileFormat; }

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

  /**
   * SfxFilterMatcher::GuessFilter and the filter's reader for Insert > Content from Document: the
   * file read into a document of its own, or null for a type no filter reads (or a broken package
   * the user does not have repaired).
   */
  private async readDocument(file: File): Promise<{ doc: SwDoc; lost: string[] } | null> {
    if (/\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown') {
      const { mdParse } = await import('./markdown.ts');
      return ImportMarkdown(await file.text(), mdParse);
    }
    if (/\.(html?|xhtml)$/i.test(file.name) || file.type === 'text/html' || file.type === 'application/xhtml+xml') return ImportHTML(new Uint8Array(await file.arrayBuffer()));
    if (/\.txt$/i.test(file.name) || file.type === 'text/plain') return { doc: ImportText(await file.text()), lost: [] };
    const data = new Uint8Array(await file.arrayBuffer());
    if (/\.o[dt]t$/i.test(file.name)) return (await this.importPackage(file.name, (repair) => ImportODT(data, repair)))?.result ?? null;
    if (/\.do[ct]$/i.test(file.name) || file.type === 'application/msword') return ImportDOC(data);
    if (/\.do[ct]x$/i.test(file.name)) return (await this.importPackage(file.name, (repair) => ImportDOCX(data, repair)))?.result ?? null;
    this.setMessage(t('insertdoc.unsupported', { name: file.name }));
    return null;
  }

  /**
   * SwView::InsertMedium for SID_INSERTDOC: the document's content goes in at the cursor, in
   * place of a selection. What its filter does not support yet is reported.
   */
  async insertDocFile(file: File): Promise<void> {
    try {
      const r = await this.readDocument(file);
      if (!r) return;
      // The fonts it brings, before the layout uses them.
      await this.preloadFonts(r.doc, false);
      this.sh.InsertMedium(r.doc);
      if (r.lost.length) this.setMessage(t('insertdoc.lost', { name: file.name, what: r.lost.join('; ') }));
      this.notify();
    } catch (e) {
      this.setMessage(t('insertdoc.failed', { name: file.name, error: (e as Error).message }));
    }
  }

  /** SID_INSERTDOC without a file name: SwView::InsertDoc's file dialog (DocumentInserter). */
  insertDocFromDisk(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.odt,.ott,.docx,.dotx,.doc,.dot,.txt,.md,.markdown,.html,.htm,.xhtml';
    input.onchange = () => { if (input.files?.[0]) void this.insertDocFile(input.files[0]); };
    input.click();
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

  /** Replaces the page geometry and re-lays out the document. */
  applyPage(f: (pd: SwDoc['m_aPageDesc']) => void, desc = this.sh.GetCurPageDesc()): void { f(desc); this.sh.m_pDoc.m_nFormatVersion++; this.sh.m_pDoc.Changed(); }
}
