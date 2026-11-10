// Documents live in IndexedDB as ODT bytes, so everything works offline and survives reloads.
export interface StoredDoc { id: string; name: string; updated: number; bytes: Uint8Array }
export type StoredDocInfo = Omit<StoredDoc, 'bytes'>;

const DB = 'lo-writer';
const STORE = 'documents';

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

export const putDoc = (d: StoredDoc): Promise<IDBValidKey> => tx('readwrite', (s) => s.put(d));
export const getDoc = (id: string): Promise<StoredDoc | undefined> => tx('readonly', (s) => s.get(id));
export const deleteDoc = (id: string): Promise<undefined> => tx('readwrite', (s) => s.delete(id));

export async function listDocs(): Promise<StoredDocInfo[]> {
  const all = await tx<StoredDoc[]>('readonly', (s) => s.getAll());
  return all.map(({ id, name, updated }) => ({ id, name, updated })).sort((a, b) => b.updated - a.updated);
}

const LAST = 'lo-writer-last-doc';
export function getLastDocId(): string | null { try { return localStorage.getItem(LAST); } catch { return null; } }
export function setLastDocId(id: string): void { try { localStorage.setItem(LAST, id); } catch { /* private mode */ } }
