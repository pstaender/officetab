// Owns the open document and everything the React tree renders from it.
import { SwDoc } from '@lo/sw/inc/doc.ts';
import { SwWrtShell } from '@lo/sw/source/uibase/wrtsh/wrtsh.ts';
import { CanvasTextMeasurer } from '@lo/vcl/source/outdev/text.ts';
import { GetPrefSize, GraphicManager } from '@lo/vcl/source/graphic/Manager.ts';
import { ExportODT, ImportODT } from '@lo/sw/source/filter/xml/odt.ts';
import { ExportText, ImportText } from '@lo/sw/source/filter/ascii/ascii.ts';
import { getDoc, getLastDocId, putDoc, setLastDocId } from './storage.ts';

export type DialogId = 'documents' | 'character' | 'paragraph' | 'page' | 'find' | 'wordcount' | 'about' | 'table' | 'hyperlink' | 'specialchar' | 'options' | null;

const AUTOSAVE_MS = 1200;
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const pickerTypes = [
  { description: 'OpenDocument Text', accept: { [ODT_MIME]: ['.odt'] } },
  { description: 'Text', accept: { 'text/plain': ['.txt'] } },
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
  set author(name: string) {
    try { localStorage.setItem('writer:author', name); } catch { /* storage may be unavailable */ }
    this.notify();
  }
  /** View > Formatting Marks (SwViewOption::IsViewMetaChars). */
  showControlCodes = false;
  /** Clone Formatting (SwFormatClipboard): formatting copied, waiting to be applied by the next selection. */
  formatClipboard: { chars: import('@lo/sw/inc/hintids.ts').SwCharAttrSet; para: import('@lo/sw/inc/hintids.ts').SwAttrSet; coll: string } | null = null;
  dialog: DialogId = null;
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

  constructor() {
    this.sh = new SwWrtShell(new SwDoc(), this.measurer);
    this.attach();
  }

  private attach(): void {
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
  setMessage(m: string | null): void { this.message = m; this.notify(); }
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
    this.install(new SwDoc(), 'Untitled', newId(), null);
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
    if (lost.length) this.setMessage(`Opened as a copy, your original file stays untouched. Not supported yet and missing here: ${lost.join('; ')}.`);
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
      if (/\.txt$/i.test(file.name) || file.type === 'text/plain') {
        this.install(ImportText(await file.text()), file.name.replace(/\.txt$/i, ''), newId(), handle);
      } else if (/\.odt$/i.test(file.name)) {
        await this.loadBytes(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.odt$/i, ''), newId(), handle);
      } else {
        this.setMessage(`${file.name}: this file type is not supported yet. Writer can open .odt and .txt files.`);
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
        const [h] = await w.showOpenFilePicker({ types: pickerTypes });
        if (h) await this.openFile(await h.getFile(), h);
      } catch (e) { if ((e as DOMException).name !== 'AbortError') this.setMessage((e as Error).message); }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.odt,.txt';
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
      if (this.handle) await this.writeHandle(this.handle);
      clearTimeout(this.saveTimer);
      await this.persist();
      this.sh.m_pDoc.SetUnmodified();
      this.notify();
    } catch (e) { this.setMessage(`Save failed: ${(e as Error).message}`); }
  }

  async saveAs(): Promise<void> {
    const w = window as PickerWindow;
    const suggestedName = `${this.name}.odt`;
    try {
      if (w.showSaveFilePicker) {
        const h = await w.showSaveFilePicker({ suggestedName, types: pickerTypes });
        await this.writeHandle(h);
        this.handle = h;
        this.name = h.name.replace(/\.(odt|txt)$/i, '');
      } else {
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

  /** Opens a hyperlink in a new browsing context, without giving it access to this one. */
  openURL(url: string): void {
    if (/^(javascript|data|vbscript):/i.test(url)) { this.setMessage(`Links of this kind are not opened: ${url}`); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  rename(name: string): void { this.name = name || 'Untitled'; this.scheduleSave(); this.notify(); }

  /** Replaces the page geometry and re-lays out the document. */
  applyPage(f: (pd: SwDoc['m_aPageDesc']) => void): void { f(this.sh.m_pDoc.m_aPageDesc); this.sh.m_pDoc.Changed(); }
}
