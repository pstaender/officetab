// The web shell's templates: what SfxDocumentTemplates and the template folders are upstream.
// LibreOffice's own Writer templates come with the application (src/writer/generated/templates,
// read-only, as upstream's internal templates); the user's templates are stored in the browser
// (storage.ts) with their category. A category is a built-in folder's short name (`standard` is
// My Templates; TEMPLATE_SHORT_NAMES_ARY), shown by its long name, or a category the user made.
import { readZip } from '@lo/package/source/zipapi/zip.ts';
import type { SwDoc } from '@lo/sw/inc/doc.ts';
import { SwRootFrame } from '@lo/sw/source/core/layout/pagechg.ts';
import { CanvasTextMeasurer } from '@lo/vcl/source/outdev/text.ts';
import { ImportBitmap } from '@lo/vcl/source/graphic/Manager.ts';
import { PaintPageContent } from '@lo/sw/source/core/view/paint.ts';
import { t } from '@shell/i18n.ts';
import { deleteDoc, getDoc, listAll, updateDoc, type StoredDocInfo } from '@shell/storage.ts';
import builtIn from './generated/templates/templates.json';

const URLS = import.meta.glob('./generated/templates/**/*.ott', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** SfxDocTplService's TEMPLATE_SHORT_NAMES_ARY: the built-in folders, in their order. */
export const BUILTIN_REGIONS = ['standard', 'styles', 'officorr', 'offimisc', 'personal', 'presnt', 'draw', 'l10n'] as const;
/** The category templates are saved in unless another is chosen: My Templates. */
export const MY_TEMPLATES = 'standard';
const BUILTIN_PREFIX = 'builtin:';
const LS_CATEGORIES = 'writer:template-categories';
const LS_DEFAULT = 'writer:default-template';

/** SfxDocTplService::getLongName: a category's name as shown. */
export const regionName = (region: string): string => ((BUILTIN_REGIONS as readonly string[]).includes(region) ? t(`templates.region.${region}`) : region);

/** A template of the template manager (TemplateItemProperties). */
export interface TemplateItem {
  /** A stored template's id, or `builtin:` and the file of one of LibreOffice's. */
  id: string;
  name: string;
  /** Its category (see regionName). */
  region: string;
  /** One of LibreOffice's own templates (TemplateLocalView::IsInternalTemplate): it cannot be renamed or deleted. */
  builtIn: boolean;
  updated: number;
  size: number;
}

const BUILTIN_ITEMS: TemplateItem[] = builtIn.map((b) => ({ id: `${BUILTIN_PREFIX}${b.file}`, name: b.title, region: b.region, builtIn: true, updated: 0, size: 0 }));
const builtInUrl = (id: string) => URLS[`./generated/templates/${id.slice(BUILTIN_PREFIX.length)}`];
export const isBuiltIn = (id: string): boolean => id.startsWith(BUILTIN_PREFIX);

const toItem = (d: StoredDocInfo): TemplateItem => ({ id: d.id, name: d.name, region: d.category ?? MY_TEMPLATES, builtIn: false, updated: d.updated, size: d.size });

/** Every template: LibreOffice's, then the stored ones, each by name. */
export async function listTemplates(): Promise<TemplateItem[]> {
  const stored = (await listAll()).filter((d) => d.template).map(toItem);
  return [...BUILTIN_ITEMS, ...stored.sort((a, b) => a.name.localeCompare(b.name))];
}

function readCategories(): string[] {
  try { const v = JSON.parse(localStorage.getItem(LS_CATEGORIES) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
function writeCategories(list: string[]): void {
  try { localStorage.setItem(LS_CATEGORIES, JSON.stringify(list)); } catch { /* storage may be unavailable */ }
}

/**
 * The categories (TemplateLocalView::getFolderNames): My Templates and the built-in folders that
 * have templates, in upstream's order, then the user's in the order they were made.
 */
export function categories(items: readonly TemplateItem[]): string[] {
  const used = new Set(items.map((i) => i.region));
  const builtInRegions = BUILTIN_REGIONS.filter((r) => r === MY_TEMPLATES || used.has(r));
  const own = readCategories();
  for (const r of used) if (!(BUILTIN_REGIONS as readonly string[]).includes(r) && !own.includes(r)) own.push(r);
  return [...builtInRegions, ...own];
}

/** TemplateLocalView::IsBuiltInRegion: a built-in folder, which cannot be renamed or deleted. */
export const isBuiltInRegion = (region: string): boolean => (BUILTIN_REGIONS as readonly string[]).includes(region);

/** The category of a name as shown (a built-in one's long name gives its short name). */
export function regionOf(name: string, items: readonly TemplateItem[]): string | undefined {
  return categories(items).find((r) => regionName(r) === name || r === name);
}

/** TemplateLocalView::createRegion: false for an empty name or one that exists. */
export function createRegion(name: string, items: readonly TemplateItem[]): boolean {
  const n = name.trim();
  if (!n || regionOf(n, items) !== undefined) return false;
  writeCategories([...readCategories(), n]);
  return true;
}

/** TemplateLocalView::renameRegion: the category and its templates; not a built-in one. */
export async function renameRegion(region: string, name: string, items: readonly TemplateItem[]): Promise<boolean> {
  const n = name.trim();
  if (!n || isBuiltInRegion(region) || (n !== region && regionOf(n, items) !== undefined)) return false;
  const list = readCategories();
  const k = list.indexOf(region);
  if (k >= 0) list[k] = n; else list.push(n);
  writeCategories(list);
  for (const i of items) if (!i.builtIn && i.region === region) await updateDoc(i.id, { category: n });
  return true;
}

/** TemplateLocalView::removeRegion: the category with its templates; not a built-in one. */
export async function removeRegion(region: string, items: readonly TemplateItem[]): Promise<boolean> {
  if (isBuiltInRegion(region) || items.some((i) => i.region === region && i.builtIn)) return false;
  for (const i of items) if (i.region === region) await removeTemplate(i.id);
  writeCategories(readCategories().filter((r) => r !== region));
  return true;
}

/** TemplateLocalView::removeTemplate: a stored template; LibreOffice's cannot be deleted. */
export async function removeTemplate(id: string): Promise<boolean> {
  if (isBuiltIn(id)) return false;
  if (getDefaultTemplate() === id) setDefaultTemplate(null);
  await deleteDoc(id);
  return true;
}

/** TemplateLocalView::renameItem */
export async function renameTemplate(id: string, name: string): Promise<boolean> {
  if (isBuiltIn(id) || !name.trim()) return false;
  await updateDoc(id, { name: name.trim() });
  return true;
}

/** TemplateLocalView::moveTemplates: stored templates move; LibreOffice's are copied (as upstream, where a move fails). */
export async function moveTemplate(id: string, region: string, copy: (id: string, region: string) => Promise<void>): Promise<void> {
  if (isBuiltIn(id)) await copy(id, region);
  else await updateDoc(id, { category: region });
}

/** SfxObjectFactory::GetStandardTemplate: the template new text documents are made from. */
export function getDefaultTemplate(): string | null {
  try { return localStorage.getItem(LS_DEFAULT); } catch { return null; }
}
/** SfxObjectFactory::SetStandardTemplate; null resets it (new documents are empty). */
export function setDefaultTemplate(id: string | null): void {
  try { if (id) localStorage.setItem(LS_DEFAULT, id); else localStorage.removeItem(LS_DEFAULT); } catch { /* storage may be unavailable */ }
}

/** The package of a template. */
export async function templateBytes(id: string): Promise<{ bytes: Uint8Array; name: string } | null> {
  if (isBuiltIn(id)) {
    const url = builtInUrl(id);
    const item = BUILTIN_ITEMS.find((i) => i.id === id);
    if (!url || !item) return null;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${item.name}: ${r.status} ${r.statusText}`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), name: item.name };
  }
  const d = await getDoc(id);
  return d ? { bytes: d.bytes, name: d.name } : null;
}

const thumbs = new Map<string, Promise<string | null>>();
/**
 * A template's thumbnail as a URL: the stored one, else the package's Thumbnails/thumbnail.png
 * (ThumbnailView::readThumbnail), or null.
 */
export function thumbnailUrl(id: string, updated = 0): Promise<string | null> {
  const key = `${id}@${updated}`;
  let p = thumbs.get(key);
  if (!p) {
    p = (async () => {
      const stored = isBuiltIn(id) ? undefined : await getDoc(id);
      let png = stored?.thumbnail;
      if (!png) {
        const pkg = stored?.bytes ?? (await templateBytes(id))?.bytes;
        if (pkg) png = (await readZip(pkg)).get('Thumbnails/thumbnail.png');
      }
      return png ? URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })) : null;
    })().catch(() => null);
    thumbs.set(key, p);
  }
  return p;
}

/** sfx2's THUMBNAIL size: the larger side of a thumbnail (SfxObjectShell::CreatePreview_Impl's nMaximumExtent / 2). */
const THUMBNAIL_EXTENT = 256;

/**
 * SfxObjectShell::GetPreviewBitmap, reduced: the first page painted as the editor paints it, as a
 * PNG of at most 256 pixels. The document is laid out again once its fonts have loaded.
 */
export async function renderThumbnail(doc: SwDoc): Promise<Uint8Array | null> {
  // A layout of its own, which the document does not update (SwWrtShell's would be).
  const layout = () => { const root = new SwRootFrame(doc, new CanvasTextMeasurer()); root.Layout(); return root; };
  if (!layout().pages.length) return null;
  await document.fonts.ready;
  const page = layout().pages[0];
  if (!page) return null;
  const images = new Map<string, ImageBitmap>();
  await Promise.all([...doc.m_aGraphics].map(async ([key, g]) => { try { images.set(key, await ImportBitmap(g.data, g.mime)); } catch { /* left out */ } }));
  const r = page.aFrame;
  const scale = THUMBNAIL_EXTENT / Math.max(r.Width(), r.Height());
  const cv = new OffscreenCanvas(Math.max(1, Math.round(r.Width() * scale)), Math.max(1, Math.round(r.Height() * scale)));
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(scale, 0, 0, scale, -r.Left() * scale, -r.Top() * scale);
  PaintPageContent(ctx as unknown as CanvasRenderingContext2D, page, { autoColor: '#000000', fieldShading: null, bounds: null, graphic: (key) => images.get(key) ?? null });
  const blob = await cv.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
