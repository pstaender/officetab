// Owns the open document and everything the React tree renders from it.
import { ImportMarkdown } from '@lo/sw/source/filter/md/swmd.ts';
import { ExportMarkdown } from '@lo/sw/source/filter/md/wrtmd.ts';
import { FontService } from './fonts.ts';
import { t } from './i18n.ts';
import { SwDoc } from '@lo/sw/inc/doc.ts';
import { SwWrtShell } from '@lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { CanvasTextMeasurer } from '@lo/vcl/source/outdev/text.ts';
import { GetPrefSize, GraphicManager } from '@lo/vcl/source/graphic/Manager.ts';
import { ExecuteGrfFilter, GrfFilterTable } from '@lo/svx/source/dialog/grfflt.ts';
import { ExportODT, ImportODT } from '@lo/sw/source/filter/xml/odt.ts';
import { DateTimeNow } from '@lo/sfx2/source/doc/SfxDocumentMetaData.ts';
import { UpdateDocInfoForSave } from '@lo/sfx2/source/doc/objcont.ts';
import { ExportText, ImportText } from '@lo/sw/source/filter/ascii/ascii.ts';
import { ImportDOCX } from '@lo/sw/source/writerfilter/dmapper/DomainMapper.ts';
import { DOCX_MIME, ExportDOCX } from '@lo/sw/source/filter/ww8/docxexport.ts';
import { getDoc, getLastDocId, putDoc, setLastDocId } from './storage.ts';
import { SpellChecker, LANGUAGE_NONE } from '@lo/lingucomponent/source/spellcheck/spell/sspellimp.ts';
import { findDictionary, isDictionaryCached, loadDictionary } from './spell.ts';

export type DialogId = 'documents' | 'character' | 'paragraph' | 'page' | 'find' | 'wordcount' | 'about' | 'table' | 'hyperlink' | 'specialchar' | 'options' | 'style' | 'newstyle' | 'toc' | 'fly' | 'redlines' | 'section' | 'sections' | 'columns' | 'break' | 'saveas' | 'spelling' | 'compress' | 'imagefilter' | 'objname' | 'alttext' | 'numbullet' | 'titlepage' | 'watermark' | 'docinfo' | 'sizecheck' | 'insrows' | 'inscols' | 'splitcells' | 'mergetable' | 'splittable' | null;

const AUTOSAVE_MS = 1200;
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const pickerTypes = [
  { description: 'OpenDocument Text', accept: { [ODT_MIME]: ['.odt'] } },
  { description: 'Word Document', accept: { [DOCX_MIME]: ['.docx'] } },
  { description: 'Text', accept: { 'text/plain': ['.txt'] } },
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } },
];
const openTypes = [
  { description: 'Documents', accept: { [ODT_MIME]: ['.odt'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.template': ['.dotx'], 'text/plain': ['.txt'], 'text/markdown': ['.md', '.markdown'] } },
];

type FileHandle = FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> };
type PickerWindow = typeof window & {
  showOpenFilePicker?: (o: unknown) => Promise<FileHandle[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
};

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
  /** The image filter whose dialog is open (`imagefilter`). */
  filterCommand = '';
  /** SID_OBJECT_ROTATE: the selected object's handles rotate it about its centre. */
  rotateMode = false;
  /** Format > Image > Color: the colorbar is shown while an image is selected. */
  showColorBar = false;
  message: string | null = null;
  /** Bumped on any change; React reads it through useSyncExternalStore. */
  version = 0;
  private listeners = new Set<() => void>();
  private unsubscribeDoc: () => void = () => {};
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private canPersist = false;
  /** Set by the edit window: scrolls the caret into view after the next paint. */
  onEdit: () => void = () => {};
  /** Set by the edit window: returns keyboard focus to the document. */
  focusEditor: () => void = () => {};

  /** Font profiles and web fonts (Tools > Options > Fonts). */
  readonly fonts = new FontService();

  constructor() {
    try { for (const w of JSON.parse(localStorage.getItem('writer:userwords') ?? '[]') as string[]) this.spell.AddWord(w); } catch { /* none */ }
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
    this.notify();
  }

  /** Add to Dictionary: the word goes into the user dictionary, kept in this browser. */
  addToDictionary(word: string): void {
    this.spell.AddWord(word);
    try { localStorage.setItem('writer:userwords', JSON.stringify([...this.spell.m_aUserWords])); } catch { /* storage may be unavailable */ }
    this.onEdit();
    this.notify();
  }

  private attach(): void {
    // The author of new changes is the user (SwModule::GetRedlineAuthor).
    this.sh.m_pDoc.m_pDocumentRedlineManager.m_sAuthor = this.author;
    this.sh.m_pSpell = this.spell;
    this.sh.m_bOnlineSpell = this.onlineSpell;
    void this.loadUsedDictionaries();
    this.unsubscribeDoc();
    this.unsubscribeDoc = this.sh.m_pDoc.Subscribe(() => {
      this.onEdit();
      this.scheduleSave();
      this.notify();
    });
  }

  subscribe = (f: () => void): (() => void) => { this.listeners.add(f); return () => this.listeners.delete(f); };
  getVersion = (): number => this.version;
  notify(): void { this.version++; for (const f of this.listeners) f(); }

  get title(): string { return `${this.sh.m_pDoc.IsModified() ? '● ' : ''}${this.name}`; }
  setDialog(d: DialogId): void {
    this.dialog = d;
    this.notify();
    // A dialog unmounted by state skips its close event: return focus once it has gone.
    if (d === null) setTimeout(() => this.focusEditor(), 0);
  }
  /** Buttons of the current message (an info bar's actions). */
  messageActions: { label: string; run: () => void }[] = [];
  setMessage(m: string | null, actions: { label: string; run: () => void }[] = []): void { this.message = m; this.messageActions = actions; this.notify(); }

  /**
   * The info bar of a document opened as a copy: it is edited right away and kept in this
   * browser (as ODT, like every document here); the file on disk stays as it was.
   */
  private openedAsCopy(lost: string[], word = false): void {
    const text = `${t(word ? 'copy.openedWord' : 'copy.opened')}${lost.length ? ` ${t('copy.lost', { what: lost.join('; ') })}` : ''}`;
    this.setMessage(text, [
      { label: t('copy.edit'), run: () => { this.setMessage(null); this.focusEditor(); } },
      { label: t('copy.saveAs'), run: () => { this.setMessage(null); void this.saveAs(); } },
    ]);
  }
  /** Arms (or with null, cancels) drawing a shape of a type with the mouse. */
  setDrawShape(type: string | null): void {
    this.drawShape = type;
    this.message = type ? t('shape.drag') : null;
    this.notify();
  }
  setZoom(z: number): void { this.zoom = Math.min(6, Math.max(0.2, z)); this.notify(); }

  private install(doc: SwDoc, name: string, id: string, handle: FileHandle | null): void {
    const onLoaded = this.graphics.onLoaded;
    this.graphics = new GraphicManager();
    this.graphics.onLoaded = onLoaded;
    this.sh = new SwWrtShell(doc, this.measurer);
    this.name = name;
    this.docId = id;
    this.handle = handle;
    this.attach();
    setLastDocId(id);
    this.notify();
  }

  newDocument(): void {
    this.flush();
    this.install(this.newDoc(), 'Untitled', newId(), null);
  }

  /** Reopens the last document, or stays on the empty one. */
  async restore(): Promise<void> {
    this.canPersist = true;
    const id = getLastDocId();
    if (!id) return;
    try {
      const stored = await getDoc(id);
      if (stored) await this.loadBytes(stored.bytes, stored.name, stored.id, null);
    } catch (e) {
      this.setMessage(`The last document could not be restored: ${(e as Error).message}`);
    }
  }

  private async loadBytes(bytes: Uint8Array, name: string, id: string, handle: FileHandle | null): Promise<void> {
    const { doc, lost } = await ImportODT(bytes);
    // A file with unsupported content opens detached: saving must never overwrite the richer original.
    this.install(doc, name, id, lost.length ? null : handle);
    if (lost.length) this.openedAsCopy(lost);
  }

  async openStored(id: string): Promise<void> {
    this.flush();
    const stored = await getDoc(id);
    if (stored) await this.loadBytes(stored.bytes, stored.name, stored.id, null);
    this.setDialog(null);
  }

  async openFile(file: File, handle: FileHandle | null): Promise<void> {
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
        await this.loadBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.odt$/i, ''), newId(), handle);
      } else if (/\.do[ct]x$/i.test(file.name)) {
        // A Word template (.dotx) is the same package: it opens as a new document, as in Word.
        // Word files are never written back: Save As stores them as ODT.
        const { doc, lost } = await ImportDOCX(new Uint8Array(await file.arrayBuffer()));
        this.install(doc, file.name.replace(/\.do[ct]x$/i, ''), newId(), null);
        this.openedAsCopy(lost, true);
      } else {
        this.setMessage(`${file.name}: this file type is not supported yet. Writer can open .odt, .docx, .dotx, .md and .txt files.`);
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
    input.accept = '.odt,.docx,.dotx,.txt,.md,.markdown';
    input.onchange = () => { if (input.files?.[0]) void this.openFile(input.files[0], null); };
    input.click();
  }

  private scheduleSave(): void {
    if (!this.canPersist) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.persist(), AUTOSAVE_MS);
  }

  /** Runs a pending autosave immediately, for example before switching documents. */
  private flush(): void {
    if (this.saveTimer !== undefined) { clearTimeout(this.saveTimer); this.saveTimer = undefined; void this.persist(); }
  }

  private async persist(): Promise<void> {
    const { sh, docId, name } = this;
    try {
      await putDoc({ id: docId, name, updated: Date.now(), bytes: await ExportODT(sh.m_pDoc) });
      setLastDocId(docId);
    } catch (e) {
      this.setMessage(`Autosave failed: ${(e as Error).message}`);
    }
  }

  private async serialise(filename: string): Promise<Blob> {
    if (/\.txt$/i.test(filename)) return new Blob([ExportText(this.sh.m_pDoc)], { type: 'text/plain' });
    if (/\.(md|markdown)$/i.test(filename)) return new Blob([ExportMarkdown(this.sh.m_pDoc)], { type: 'text/markdown' });
    if (/\.docx$/i.test(filename)) return new Blob([(await ExportDOCX(this.sh.m_pDoc)) as BlobPart], { type: DOCX_MIME });
    return new Blob([(await ExportODT(this.sh.m_pDoc)) as BlobPart], { type: ODT_MIME });
  }

  private async writeHandle(h: FileHandle): Promise<void> {
    const s = await h.createWritable();
    await s.write(await this.serialise(h.name));
    await s.close();
  }

  /** Saves to the browser, and also to the file on disk when one is attached. */
  async save(): Promise<void> {
    try {
      UpdateDocInfoForSave(this.sh.m_pDoc, this.userFullName);
      if (this.handle) await this.writeHandle(this.handle);
      clearTimeout(this.saveTimer);
      await this.persist();
      this.sh.m_pDoc.SetUnmodified();
      this.notify();
    } catch (e) { this.setMessage(`Save failed: ${(e as Error).message}`); }
  }

  /** File > Save As: the browser's save dialog where there is one, else ours with a format choice. */
  async saveAs(format?: 'odt' | 'docx' | 'txt' | 'md'): Promise<void> {
    const w = window as PickerWindow;
    if (!w.showSaveFilePicker && !format) { this.setDialog('saveas'); return; }
    const suggestedName = `${this.name}.${format ?? 'odt'}`;
    try {
      if (w.showSaveFilePicker) {
        // The chosen format's type first, so the picker suggests it.
        const first = ({ odt: 0, docx: 1, txt: 2, md: 3 } as Record<string, number>)[format ?? 'odt'] ?? 0;
        const types = [pickerTypes[first]!, ...pickerTypes.filter((_, i) => i !== first)];
        const h = await w.showSaveFilePicker({ suggestedName, types });
        UpdateDocInfoForSave(this.sh.m_pDoc, this.userFullName);
        await this.writeHandle(h);
        this.handle = h;
        this.name = h.name.replace(/\.(odt|docx|txt|md|markdown)$/i, '');
      } else {
        UpdateDocInfoForSave(this.sh.m_pDoc, this.userFullName);
        const url = URL.createObjectURL(await this.serialise(suggestedName));
        const a = document.createElement('a');
        a.href = url; a.download = suggestedName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      clearTimeout(this.saveTimer);
      await this.persist();
      this.sh.m_pDoc.SetUnmodified();
      this.notify();
    } catch (e) { if ((e as DOMException).name !== 'AbortError') this.setMessage(`Save failed: ${(e as Error).message}`); }
  }

  /** Inserts an image file at the cursor, anchored as character. */
  async insertImageFile(file: Blob): Promise<void> {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const size = await GetPrefSize(data, file.type);
      this.sh.InsertGraphic(data, file.type || 'image/png', size);
    } catch {
      this.setMessage('This image could not be read. Writer can insert PNG, JPEG, GIF, WebP, AVIF and SVG images.');
    }
  }

  /** FN_INSERT_GRAPHIC: picks an image file to insert. */
  insertImageFromDisk(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,image/bmp';
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
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,image/bmp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        await GetPrefSize(data, file.type); // only images that decode
        this.sh.ReRead(data, file.type || 'image/png');
      } catch { this.setMessage(t('image.unreadable')); }
    };
    input.click();
  }

  /** SID_SAVE_GRAPHIC (GraphicHelper::ExportGraphic): saves the selected image as it is stored. */
  async saveImage(): Promise<void> {
    const g = this.selectedGraphic();
    if (!g) return;
    const ext = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp' } as Record<string, string>)[g.mime] ?? 'png';
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
    const b = await createImageBitmap(new Blob([g.data as BlobPart], { type: g.mime }));
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

  /** Opens a hyperlink in a new browsing context, without giving it access to this one. */
  openURL(url: string): void {
    if (/^(javascript|data|vbscript):/i.test(url)) { this.setMessage(`Links of this kind are not opened: ${url}`); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  rename(name: string): void { this.name = name || 'Untitled'; this.scheduleSave(); this.notify(); }

  /** Replaces the page geometry and re-lays out the document. */
  applyPage(f: (pd: SwDoc['m_aPageDesc']) => void, desc = this.sh.GetCurPageDesc()): void { f(desc); this.sh.m_pDoc.m_nFormatVersion++; this.sh.m_pDoc.Changed(); }
}
