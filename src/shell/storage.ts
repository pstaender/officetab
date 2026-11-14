// Documents live in IndexedDB as packages of the app's own format (ODT for Writer), so everything
// works offline and survives reloads. Templates (.ott packages) are stored alongside, with their
// category and a thumbnail. Each app of the suite has a database of its own (`lo-<app>`: Writer's
// is `lo-writer`), as each LibreOffice module opens only its own documents.
import { APPS } from './apps.ts';

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

const STORE = 'documents';

/** An app's database. */
const dbName = (app: string) => `lo-${app}`;

function openDb(DB: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(DB: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb(DB).then((db) => new Promise<T>((resolve, reject) => {
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
/** An OpenDocument template (its media type is the document's with `-template`, as .ott and .ots). */
export const isTemplatePackage = (b: Uint8Array): boolean => packageMediaType(b).endsWith('-template');

/** The documents and templates an app keeps in the browser (its database), and its last document. */
export interface AppStorage {
  putDoc(d: StoredDoc): Promise<IDBValidKey>;
  getDoc(id: string): Promise<StoredDoc | undefined>;
  deleteDoc(id: string): Promise<undefined>;
  updateDoc(id: string, change: Partial<Pick<StoredDoc, 'name' | 'category' | 'thumbnail'>>): Promise<void>;
  listAll(): Promise<StoredDocInfo[]>;
  listDocs(): Promise<StoredDocInfo[]>;
  getLastDocId(): string | null;
  setLastDocId(id: string): void;
}

const stores = new Map<string, AppStorage>();

/** The storage of an app of the suite (`writer`). */
export function appStorage(app: string): AppStorage {
  let st = stores.get(app);
  if (st) return st;
  const DB = dbName(app);
  const LAST = `lo-${app}-last-doc`;

  /**
   * Stores a document; a template keeps its category and thumbnail unless they are given (the
   * open template is stored on every change without them).
   */
  function putDoc(d: StoredDoc): Promise<IDBValidKey> {
    return openDb(DB).then((db) => new Promise<IDBValidKey>((resolve, reject) => {
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
  const getDoc = (id: string): Promise<StoredDoc | undefined> => tx(DB, 'readonly', (s) => s.get(id));
  const deleteDoc = (id: string): Promise<undefined> => tx(DB, 'readwrite', (s) => s.delete(id));

  /** Changes a stored document's name or category, without its package. */
  function updateDoc(id: string, change: Partial<Pick<StoredDoc, 'name' | 'category' | 'thumbnail'>>): Promise<void> {
    return openDb(DB).then((db) => new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      const s = t.objectStore(STORE);
      const get = s.get(id);
      get.onsuccess = () => { if (get.result) s.put({ ...(get.result as StoredDoc), ...change }); };
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = t.onabort = () => { db.close(); reject(t.error); };
    }));
  }

  /** The stored documents and templates, newest first. */
  async function listAll(): Promise<StoredDocInfo[]> {
    const all = await tx<StoredDoc[]>(DB, 'readonly', (s) => s.getAll());
    return all.map(({ bytes, ...rest }) => ({ ...rest, size: bytes.byteLength, template: isTemplatePackage(bytes) })).sort((a, b) => b.updated - a.updated);
  }

  /** The stored documents (templates are in the template manager), newest first. */
  async function listDocs(): Promise<StoredDocInfo[]> {
    return (await listAll()).filter((d) => !d.template);
  }

  function getLastDocId(): string | null { try { return localStorage.getItem(LAST); } catch { return null; } }
  function setLastDocId(id: string): void { try { localStorage.setItem(LAST, id); } catch { /* private mode */ } }
  st = { putDoc, getDoc, deleteDoc, updateDoc, listAll, listDocs, getLastDocId, setLastDocId };
  stores.set(app, st);
  return st;
}

/**
 * File > Clear Data: removes everything the suite keeps in this browser: every app's stored
 * documents and templates, the settings (local and session storage) and the downloaded fonts and
 * dictionaries. The suite's own files (Cache Storage `officetab-*`, before `lo-writer-*`) stay, so
 * it keeps working offline.
 */
export async function clearAllData(): Promise<void> {
  for (const app of APPS) {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName(app.id));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      // Another tab still has the database open: it is deleted once that tab closes it.
      req.onblocked = () => resolve();
    });
  }
  try { localStorage.clear(); } catch { /* storage may be unavailable */ }
  try { sessionStorage.clear(); } catch { /* storage may be unavailable */ }
  try {
    for (const k of await caches.keys()) if (!k.startsWith('officetab-') && !k.startsWith('lo-writer-')) await caches.delete(k);
  } catch { /* no Cache Storage (insecure context) */ }
}
