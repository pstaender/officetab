// The Workspace menu: what the suite keeps for the user in this browser, as one file to download
// (Export) and to bring into another browser (Import): the user's settings, and the stored documents
// and templates (with their versions, which are in their packages), of every app or of one. The
// export and import dialogs choose what goes in and what comes out, and show the documents' sizes.
//
// The file (`.workspacez`) is a zip:
//   workspace.json             what it is (`format`), when and by which version it was made, and
//                              each app's documents: id, name, updated, category, format, size, file, thumbnail
//   settings.json              the settings, in defaultSettings.json's form (settings.ts), if included
//   <app>/<name>-<id>.<ext>    each document's package (.odt, .ott, .ods, …), openable as it is
//   <app>/<id>.thumbnail.png   a template's thumbnail
//
// Import adds the documents to those in the browser (one with the same id is replaced) and sets the
// settings; what the browser has besides stays. A settings JSON file imports as settings alone.
import { readZip, writeZip, type ZipEntry } from '@lo/package/source/zipapi/zip.ts';
import { APPS } from './apps.ts';
import { appStorage, isTemplatePackage, packageMediaType, type StoredDoc } from './storage.ts';
import { exportSettings, filterSettings, importSettings, parseSettingsJson } from './settings.ts';

export const WORKSPACE_FORMAT = 'officetab-workspace';
/** The extension of a workspace file. */
export const WORKSPACE_EXT = 'workspacez';
const MANIFEST = 'workspace.json';
const SETTINGS = 'settings.json';

/** What to export or import: the settings, the documents and templates, and of which apps. */
export interface WorkspaceOptions { settings: boolean; documents: boolean; apps: readonly string[] }

/** An app's documents and templates in the browser or in a workspace file, and their size in bytes. */
export interface WorkspaceAppSummary { app: string; documents: number; templates: number; size: number }

interface ManifestDoc {
  id: string; name: string; updated: number; category?: string; format?: string;
  /** The package's size in bytes, and whether it is a template. */
  size: number; template: boolean;
  /** The package's path in the file. */
  file: string;
  /** The thumbnail's path in the file. */
  thumbnail?: string;
}
interface Manifest {
  format: typeof WORKSPACE_FORMAT;
  version: 1;
  created: string;
  product?: string;
  /** Whether the file has settings.json. */
  settings: boolean;
  documents: Record<string, ManifestDoc[]>;
}

/** A workspace file as read, before anything of it is imported. */
export interface WorkspaceFile {
  created?: string;
  product?: string;
  /** Its settings (defaultSettings.json's form), null when it has none. */
  settings: Record<string, unknown> | null;
  /** How many settings it has, of every app. */
  settingsCount: number;
  docs: { app: string; doc: StoredDoc; template: boolean }[];
  summary: WorkspaceAppSummary[];
}

/** The file extension of an OpenDocument package by its media type. */
const ODF_EXT: Record<string, string> = {
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.text-template': 'ott',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.spreadsheet-template': 'ots',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.presentation-template': 'otp',
};

/** A document's name as a file name in the archive (its id keeps it unique). */
const fileName = (name: string): string => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'document';

function summarise(docs: readonly { app: string; size: number; template: boolean }[]): WorkspaceAppSummary[] {
  return APPS.map(({ id }) => {
    const mine = docs.filter((d) => d.app === id);
    return { app: id, documents: mine.filter((d) => !d.template).length, templates: mine.filter((d) => d.template).length, size: mine.reduce((n, d) => n + d.size, 0) };
  });
}

/** The documents and templates each app keeps in this browser, for the export dialog. */
export async function storedSummary(): Promise<WorkspaceAppSummary[]> {
  const all: { app: string; size: number; template: boolean }[] = [];
  for (const app of APPS) for (const d of await appStorage(app.id).listAll()) all.push({ app: app.id, size: d.size, template: d.template });
  return summarise(all);
}

/** The settings of every app (when `apps` is not given) or of `apps`, with the suite's. */
export const settingsOf = (apps?: readonly string[]): Record<string, unknown> => (apps ? filterSettings(exportSettings(true), apps) : exportSettings(true));

/** The workspace as a `.workspacez` file: the settings, documents and templates `o` chooses. */
export async function exportWorkspace(o: WorkspaceOptions, product?: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const documents: Record<string, ManifestDoc[]> = {};
  if (o.documents) {
    for (const app of APPS.filter((a) => o.apps.includes(a.id))) {
      const st = appStorage(app.id);
      const list: ManifestDoc[] = [];
      for (const info of await st.listAll()) {
        const d = await st.getDoc(info.id);
        if (!d) continue;
        const ext = ODF_EXT[packageMediaType(d.bytes)] ?? 'zip';
        const file = `${app.id}/${fileName(d.name)}-${d.id}.${ext}`;
        // Packages are zips already: stored, not compressed again.
        entries.push({ name: file, data: d.bytes, store: true });
        const m: ManifestDoc = { id: d.id, name: d.name, updated: d.updated, size: d.bytes.byteLength, template: info.template, file };
        if (d.category !== undefined) m.category = d.category;
        if (d.format !== undefined) m.format = d.format;
        if (d.thumbnail) {
          m.thumbnail = `${app.id}/${d.id}.thumbnail.png`;
          entries.push({ name: m.thumbnail, data: d.thumbnail, store: true });
        }
        list.push(m);
      }
      documents[app.id] = list;
    }
  }
  const manifest: Manifest = { format: WORKSPACE_FORMAT, version: 1, created: new Date().toISOString(), settings: o.settings, documents };
  if (product) manifest.product = product;
  const head: ZipEntry[] = [{ name: MANIFEST, data: enc.encode(JSON.stringify(manifest, null, 2)) }];
  if (o.settings) head.push({ name: SETTINGS, data: enc.encode(JSON.stringify(settingsOf(o.apps), null, 2)) });
  return writeZip([...head, ...entries]);
}

const settingsCount = (json: Record<string, unknown>): number => parseSettingsJson(json).size;

/**
 * Reads a workspace file (or a settings JSON file) for the import dialog; throws when it is
 * neither, or when the workspace misses a document it lists.
 */
export async function readWorkspace(bytes: Uint8Array): Promise<WorkspaceFile> {
  const dec = new TextDecoder();
  const first = bytes.findIndex((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09 && b !== 0xef && b !== 0xbb && b !== 0xbf);
  if (bytes[first] === 0x7b /* { */) {
    const settings = JSON.parse(dec.decode(bytes)) as Record<string, unknown>;
    return { settings, settingsCount: settingsCount(settings), docs: [], summary: summarise([]) };
  }
  const files = await readZip(bytes);
  const raw = files.get(MANIFEST);
  if (!raw) throw new Error('This is not a workspace file (workspace.json is missing).');
  const manifest = JSON.parse(dec.decode(raw)) as Partial<Manifest>;
  if (manifest.format !== WORKSPACE_FORMAT) throw new Error('This is not a workspace file.');
  if ((manifest.version ?? 1) > 1) throw new Error('This workspace was made by a newer version.');

  const docs: WorkspaceFile['docs'] = [];
  for (const [appId, list] of Object.entries(manifest.documents ?? {})) {
    if (!APPS.some((a) => a.id === appId) || !Array.isArray(list)) continue;
    for (const m of list) {
      const data = typeof m.file === 'string' ? files.get(m.file) : undefined;
      if (!data || typeof m.id !== 'string' || !m.id) throw new Error(`The workspace misses a document (${String(m.name)}).`);
      const d: StoredDoc = { id: m.id, name: String(m.name ?? 'Untitled'), updated: Number(m.updated) || Date.now(), bytes: data };
      if (typeof m.category === 'string') d.category = m.category;
      if (typeof m.format === 'string') d.format = m.format;
      const thumb = typeof m.thumbnail === 'string' ? files.get(m.thumbnail) : undefined;
      if (thumb) d.thumbnail = thumb;
      docs.push({ app: appId, doc: d, template: isTemplatePackage(data) });
    }
  }
  const settingsRaw = files.get(SETTINGS);
  const settings = settingsRaw ? (JSON.parse(dec.decode(settingsRaw)) as Record<string, unknown>) : null;
  return {
    created: manifest.created, product: manifest.product,
    settings, settingsCount: settings ? settingsCount(settings) : 0,
    docs, summary: summarise(docs.map((d) => ({ app: d.app, size: d.doc.bytes.byteLength, template: d.template }))),
  };
}

/** What an import brought in. */
export interface WorkspaceImport { documents: number; settings: number }

/** Imports what `o` chooses of a workspace file read by readWorkspace. */
export async function importWorkspace(w: WorkspaceFile, o: WorkspaceOptions): Promise<WorkspaceImport> {
  let documents = 0, settings = 0;
  if (o.documents) {
    for (const { app, doc } of w.docs) {
      if (!o.apps.includes(app)) continue;
      await appStorage(app).putDoc(doc);
      documents++;
    }
  }
  if (o.settings && w.settings) settings = importSettings(filterSettings(w.settings, o.apps));
  return { documents, settings };
}
