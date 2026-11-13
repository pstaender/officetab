// Documents live in IndexedDB as ODT bytes, so everything works offline and survives reloads.
// Templates (.ott packages) are stored alongside, with their category and a thumbnail.
export interface StoredDoc {
  id: string; name: string; updated: number; bytes: Uint8Array;
  /** A template's category in the template manager (its folder upstream); see templates.ts. */
  category?: string;
  /** A template's thumbnail (PNG), as the template manager shows it. */
  thumbnail?: Uint8Array;
}
/**
 * A stored document without its package; `size` is the package's in bytes, `template` whether the
 * package is a template (by its media type).
 */
export type StoredDocInfo = Omit<StoredDoc, 'bytes'> & { size: number; template: boolean };

const DB = 'lo-writer';
const STORE = 'documents';
const OTT_MIME = 'application/vnd.oasis.opendocument.text-template';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = f(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  }));
}

/** The media type of a package: the stored first entry `mimetype` of an ODF zip, else ''. */
export function packageMediaType(b: Uint8Array): string {
  if (b.length < 30 || b[0] !== 0x50 || b[1] !== 0x4b || b[2] !== 3 || b[3] !== 4) return '';
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint16(8, true) !== 0) return '';
  const size = v.getUint32(18, true), nameLen = v.getUint16(26, true), extra = v.getUint16(28, true);
  const dec = new TextDecoder();
  if (dec.decode(b.subarray(30, 30 + nameLen)) !== 'mimetype') return '';
  const at = 30 + nameLen + extra;
  return dec.decode(b.subarray(at, at + size));
}
export const isTemplatePackage = (b: Uint8Array): boolean => packageMediaType(b) === OTT_MIME;

/**
 * Stores a document; a template keeps its category and thumbnail unless they are given (the
 * open template is stored on every change without them).
 */
export function putDoc(d: StoredDoc): Promise<IDBValidKey> {
  return open().then((db) => new Promise<IDBValidKey>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    let key: IDBValidKey = d.id;
    const get = s.get(d.id);
    get.onsuccess = () => {
      const old = get.result as StoredDoc | undefined;
      const rec: StoredDoc = { ...d };
      if (old?.category !== undefined && rec.category === undefined) rec.category = old.category;
      if (old?.thumbnail && rec.thumbnail === undefined) rec.thumbnail = old.thumbnail;
      const put = s.put(rec);
      put.onsuccess = () => { key = put.result; };
    };
    t.oncomplete = () => { db.close(); resolve(key); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  }));
}
export const getDoc = (id: string): Promise<StoredDoc | undefined> => tx('readonly', (s) => s.get(id));
export const deleteDoc = (id: string): Promise<undefined> => tx('readwrite', (s) => s.delete(id));

/** Changes a stored document's name or category, without its package. */
export function updateDoc(id: string, change: Partial<Pick<StoredDoc, 'name' | 'category' | 'thumbnail'>>): Promise<void> {
  return open().then((db) => new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    const get = s.get(id);
    get.onsuccess = () => { if (get.result) s.put({ ...(get.result as StoredDoc), ...change }); };
    t.oncomplete = () => { db.close(); resolve(); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  }));
}

/** The stored documents and templates, newest first. */
export async function listAll(): Promise<StoredDocInfo[]> {
  const all = await tx<StoredDoc[]>('readonly', (s) => s.getAll());
  return all.map(({ bytes, ...rest }) => ({ ...rest, size: bytes.byteLength, template: isTemplatePackage(bytes) })).sort((a, b) => b.updated - a.updated);
}

/** The stored documents (templates are in the template manager), newest first. */
export async function listDocs(): Promise<StoredDocInfo[]> {
  return (await listAll()).filter((d) => !d.template);
}

const LAST = 'lo-writer-last-doc';
export function getLastDocId(): string | null { try { return localStorage.getItem(LAST); } catch { return null; } }
export function setLastDocId(id: string): void { try { localStorage.setItem(LAST, id); } catch { /* private mode */ } }

/**
 * File > Clear Data: removes everything the application keeps in this browser: the stored
 * documents and templates, the settings (local and session storage) and the downloaded fonts and
 * dictionaries. The application's own files (Cache Storage `lo-writer-*`) stay, so it keeps
 * working offline.
 */
export async function clearAllData(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // Another tab still has the database open: it is deleted once that tab closes it.
    req.onblocked = () => resolve();
  });
  try { localStorage.clear(); } catch { /* storage may be unavailable */ }
  try { sessionStorage.clear(); } catch { /* storage may be unavailable */ }
  try {
    for (const k of await caches.keys()) if (!k.startsWith('lo-writer-')) await caches.delete(k);
  } catch { /* no Cache Storage (insecure context) */ }
}
