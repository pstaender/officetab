// File > Work Environment: everything the suite keeps for the user in this browser, as one zip to
// download (Export) and to bring into another browser (Import): every app's stored documents and
// templates (with their versions, which are in their packages), and the settings.
//
// The archive:
//   environment.json           what it is (`format`), when and by which version it was made, and
//                              each app's documents: id, name, updated, category, format, file, thumbnail
//   settings.json              the settings, as Export Settings as JSON writes them (settings.ts)
//   <app>/<name>-<id>.<ext>    each document's package (.odt, .ott, .ods, …), openable as it is
//   <app>/<id>.thumbnail.png   a template's thumbnail
//
// Import adds the archive's documents to those in the browser (one with the same id is replaced)
// and sets its settings; what the browser has besides stays.
import { readZip, writeZip, type ZipEntry } from '@lo/package/source/zipapi/zip.ts';
import { APPS } from './apps.ts';
import { appStorage, packageMediaType, type StoredDoc } from './storage.ts';
import { exportSettings, importSettings } from './settings.ts';

export const ENVIRONMENT_FORMAT = 'officetab-environment';
const MANIFEST = 'environment.json';
const SETTINGS = 'settings.json';

interface ManifestDoc {
  id: string; name: string; updated: number; category?: string; format?: string;
  /** The package's path in the archive. */
  file: string;
  /** The thumbnail's path in the archive. */
  thumbnail?: string;
}
interface Manifest {
  format: typeof ENVIRONMENT_FORMAT;
  version: 1;
  created: string;
  product?: string;
  documents: Record<string, ManifestDoc[]>;
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

/** Every app's documents and templates and the settings, as a zip. */
export async function exportEnvironment(product?: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const documents: Record<string, ManifestDoc[]> = {};
  for (const app of APPS) {
    const st = appStorage(app.id);
    const list: ManifestDoc[] = [];
    for (const info of await st.listAll()) {
      const d = await st.getDoc(info.id);
      if (!d) continue;
      const ext = ODF_EXT[packageMediaType(d.bytes)] ?? 'zip';
      const file = `${app.id}/${fileName(d.name)}-${d.id}.${ext}`;
      // Packages are zips already: stored, not compressed again.
      entries.push({ name: file, data: d.bytes, store: true });
      const m: ManifestDoc = { id: d.id, name: d.name, updated: d.updated, file };
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
  const manifest: Manifest = { format: ENVIRONMENT_FORMAT, version: 1, created: new Date().toISOString(), documents };
  if (product) manifest.product = product;
  entries.unshift(
    { name: MANIFEST, data: enc.encode(JSON.stringify(manifest, null, 2)) },
    { name: SETTINGS, data: enc.encode(JSON.stringify(exportSettings(true), null, 2)) },
  );
  return writeZip(entries);
}

/** What an import brought in. */
export interface EnvironmentImport { documents: number; settings: number }

/**
 * Imports a work environment: an archive of exportEnvironment, or settings alone (a settings JSON
 * file, as Export Settings as JSON writes it).
 */
export async function importEnvironment(bytes: Uint8Array): Promise<EnvironmentImport> {
  const dec = new TextDecoder();
  // A JSON file: settings only.
  const first = bytes.findIndex((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09 && b !== 0xef && b !== 0xbb && b !== 0xbf);
  if (bytes[first] === 0x7b /* { */) return { documents: 0, settings: importSettings(JSON.parse(dec.decode(bytes)) as unknown) };

  const files = await readZip(bytes);
  const raw = files.get(MANIFEST);
  if (!raw) throw new Error('This is not a work environment (environment.json is missing).');
  const manifest = JSON.parse(dec.decode(raw)) as Partial<Manifest>;
  if (manifest.format !== ENVIRONMENT_FORMAT) throw new Error('This is not a work environment.');
  if ((manifest.version ?? 1) > 1) throw new Error('This work environment was made by a newer version.');

  // Check every document first, so that a broken archive changes nothing.
  const docs: [string, StoredDoc][] = [];
  for (const [appId, list] of Object.entries(manifest.documents ?? {})) {
    if (!APPS.some((a) => a.id === appId) || !Array.isArray(list)) continue;
    for (const m of list) {
      const data = typeof m.file === 'string' ? files.get(m.file) : undefined;
      if (!data || typeof m.id !== 'string' || !m.id) throw new Error(`The archive misses a document (${String(m.name)}).`);
      const d: StoredDoc = { id: m.id, name: String(m.name ?? 'Untitled'), updated: Number(m.updated) || Date.now(), bytes: data };
      if (typeof m.category === 'string') d.category = m.category;
      if (typeof m.format === 'string') d.format = m.format;
      const thumb = typeof m.thumbnail === 'string' ? files.get(m.thumbnail) : undefined;
      if (thumb) d.thumbnail = thumb;
      docs.push([appId, d]);
    }
  }
  const settingsRaw = files.get(SETTINGS);
  const settings = settingsRaw ? (JSON.parse(dec.decode(settingsRaw)) as unknown) : null;

  for (const [appId, d] of docs) await appStorage(appId).putDoc(d);
  return { documents: docs.length, settings: settings ? importSettings(settings) : 0 };
}
