// Generates src/app/generated/upstream-ui.json from upstream's own UI definitions, so that the
// web UI exposes exactly the commands, labels and shortcuts of the desktop application.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE, ROOT, requireCore } from './lib.ts';

requireCore();
const read = (p: string) => readFileSync(join(CORE, p), 'utf8');

interface XmlNode { tag: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Minimal parser, sufficient for the machine-written configuration files read here. */
function parseXml(src: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(src)); ) {
    const top = stack[stack.length - 1]!;
    if (m[5] !== undefined) { top.text += decode(m[5]); continue; }
    if (!m[2]) continue;
    if (m[1]) { stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const a of m[3]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]!] = decode(a[2] ?? a[3] ?? '');
    const node: XmlNode = { tag: m[2], attrs, children: [], text: '' };
    top.children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

const find = (n: XmlNode, name: string) => n.children.find((c) => c.attrs['oor:name'] === name);
const enUS = (prop?: XmlNode) => {
  const vs = prop?.children ?? [];
  return (vs.find((v) => v.attrs['xml:lang'] === 'en-US') ?? vs.find((v) => !v.attrs['xml:lang']))?.text;
};

interface Cmd { label?: string; context?: string; popup?: string; tooltip?: string }
const commands: Record<string, Cmd> = {};
function collectCommands(file: string): void {
  const walk = (n: XmlNode) => {
    const name = n.attrs['oor:name'];
    if (n.tag === 'node' && name?.startsWith('.uno:')) {
      const props: Record<string, string | undefined> = {};
      for (const p of n.children) if (p.tag === 'prop') props[p.attrs['oor:name']!] = enUS(p);
      const c: Cmd = commands[name] ?? {};
      c.label = props.Label ?? c.label;
      c.context = props.ContextLabel ?? c.context;
      c.popup = props.PopupLabel ?? c.popup;
      c.tooltip = props.TooltipLabel ?? c.tooltip;
      commands[name] = c;
    }
    n.children.forEach(walk);
  };
  walk(parseXml(read(file)));
}
// Later files win, mirroring how a Writer module label overrides a generic one.
collectCommands('officecfg/registry/data/org/openoffice/Office/UI/GenericCommands.xcu');
collectCommands('officecfg/registry/data/org/openoffice/Office/UI/WriterCommands.xcu');

export type MenuNode = { sep: true } | { cmd: string; items?: MenuNode[] };
// Menu items whose submenu a popup menu controller fills from a popupmenu file
// (officecfg Controller.xcu registers these controllers for the commands).
const POPUP_CONTROLLERS: Record<string, string> = { '.uno:InsertFieldCtrl': 'insertfield' };
// Menu items that framework's ToolbarAsMenuController fills with the items of a Writer toolbar
// (Insert > Shape > Basic Shapes...): Controller.xcu names the toolbar in its Value.
const TOOLBAR_MENUS: Record<string, string> = {};
{
  const walk = (n: XmlNode) => {
    if (n.tag === 'node') {
      const prop = (k: string) => n.children.find((p) => p.tag === 'prop' && p.attrs['oor:name'] === k)?.children[0]?.text;
      if (prop('Controller') === 'com.sun.star.comp.framework.ToolbarAsMenuController') {
        const cmd = prop('Command'), bar = prop('Value');
        if (cmd && bar && existsSync(join(CORE, `sw/uiconfig/swriter/toolbar/${bar}.xml`))) TOOLBAR_MENUS[cmd] = bar;
      }
    }
    n.children.forEach(walk);
  };
  walk(parseXml(read('officecfg/registry/data/org/openoffice/Office/UI/Controller.xcu')));
}
function menuItems(n: XmlNode): MenuNode[] {
  const out: MenuNode[] = [];
  for (const c of n.children) {
    if (c.tag === 'menu:menuseparator') out.push({ sep: true });
    else if (c.tag === 'menu:menuitem' && TOOLBAR_MENUS[c.attrs['menu:id']!]) {
      const items = toolbar(TOOLBAR_MENUS[c.attrs['menu:id']!]!).map((t): MenuNode => ('sep' in t ? t : { cmd: t.cmd }));
      out.push({ cmd: c.attrs['menu:id']!, items });
    }
    else if (c.tag === 'menu:menuitem' && POPUP_CONTROLLERS[c.attrs['menu:id']!]) {
      const popup = parseXml(read(`sw/uiconfig/swriter/popupmenu/${POPUP_CONTROLLERS[c.attrs['menu:id']!]}.xml`)).children.find((x) => x.tag === 'menu:menupopup')!;
      out.push({ cmd: c.attrs['menu:id']!, items: menuItems(popup) });
    } else if (c.tag === 'menu:menuitem') out.push({ cmd: c.attrs['menu:id']! });
    else if (c.tag === 'menu:menu') {
      const popup = c.children.find((x) => x.tag === 'menu:menupopup');
      out.push({ cmd: c.attrs['menu:id']!, items: popup ? menuItems(popup) : [] });
    }
  }
  return out;
}
const menubarRoot = parseXml(read('sw/uiconfig/swriter/menubar/menubar.xml')).children.find((c) => c.tag === 'menu:menubar')!;
const menubar = menuItems(menubarRoot);
// The context menus the shells register (SFX_POPUPMENU / RegisterPopupMenu): text, table, graphic …
const POPUP_MENUS = ['text', 'table', 'graphic', 'frame', 'draw', 'drawtext', 'annotation', 'oleobject', 'media'];
const popupmenus: Record<string, MenuNode[]> = {};
for (const name of POPUP_MENUS) {
  const root = parseXml(read(`sw/uiconfig/swriter/popupmenu/${name}.xml`)).children.find((c) => c.tag === 'menu:menupopup')!;
  popupmenus[name] = menuItems(root);
}

type ToolItem = { sep: true } | { cmd: string; visible: boolean };
function toolbar(name: string): ToolItem[] {
  const root = parseXml(read(`sw/uiconfig/swriter/toolbar/${name}.xml`)).children.find((c) => c.tag === 'toolbar:toolbar')!;
  return root.children.flatMap((c): ToolItem[] => {
    if (c.tag === 'toolbar:toolbarseparator') return [{ sep: true }];
    if (c.tag === 'toolbar:toolbaritem') return [{ cmd: c.attrs['xlink:href']!, visible: c.attrs['toolbar:visible'] !== 'false' }];
    return [];
  });
}

// Accelerators: module keys override global ones, primary keys override secondary ones.
const accel = parseXml(read('officecfg/registry/data/org/openoffice/Office/Accelerators.xcu')).children[0]!;
const shortcuts: Record<string, string> = {};
function addKeys(group?: XmlNode): void {
  for (const k of group?.children ?? []) {
    const cmd = enUS(find(k, 'Command'));
    if (cmd?.startsWith('.uno:')) shortcuts[k.attrs['oor:name']!] = cmd.split('?')[0]!;
  }
}
for (const tier of ['SecondaryKeys', 'PrimaryKeys']) {
  const t = find(accel, tier);
  addKeys(t && find(t, 'Global'));
  const mods = t && find(t, 'Modules');
  addKeys(mods && find(mods, 'com.sun.star.text.TextDocument'));
}

// The Tabbed user interface (sw notebookbar.ui, as sfx2's NotebookBar builds it): each tab with its
// label, the contexts it is shown for (context-* style classes; vcl's NotebookbarTabControl hides
// the others), and the commands of its tool buttons in order (in the tab's sfxlo-PriorityMergedHBox),
// grouped as the vertical separators divide them. The tab menus (svtlo-ManagedMenuButton) are left out.
export interface RibbonTab { id: string; label: string; contexts: string[]; groups: string[][] }
function ribbon(file: string): RibbonTab[] {
  const root = parseXml(read(file));
  const all = (n: XmlNode, f: (x: XmlNode) => boolean, out: XmlNode[] = []): XmlNode[] => { if (f(n)) out.push(n); n.children.forEach((c) => all(c, f, out)); return out; };
  const control = all(root, (n) => n.tag === 'object' && n.attrs.class === 'sfxlo-NotebookbarTabControl')[0]!;
  const tabs: RibbonTab[] = [];
  let page: XmlNode | undefined;
  for (const child of control.children.filter((c) => c.tag === 'child')) {
    const obj = child.children.find((c) => c.tag === 'object');
    if (!obj) continue;
    if (child.attrs.type !== 'tab') { page = obj; continue; }
    const label = (obj.children.find((p) => p.tag === 'property' && p.attrs.name === 'label')?.text ?? '').replace(/~/g, '');
    const contexts = all(obj, (n) => n.tag === 'class' && (n.attrs.name ?? '').startsWith('context-')).map((n) => n.attrs.name!.slice(8));
    const merged = page && all(page, (n) => n.tag === 'object' && n.attrs.class === 'sfxlo-PriorityMergedHBox')[0];
    // A GtkSeparator (the vertical line between sections) starts the next group.
    const groups: string[][] = [[]];
    const walk = (n: XmlNode) => {
      if (n.tag === 'object' && n.attrs.class === 'GtkSeparator' && groups[groups.length - 1]!.length) groups.push([]);
      const cmd = n.tag === 'property' && n.attrs.name === 'action-name' ? n.text.trim() : '';
      if (cmd.startsWith('.uno:')) groups[groups.length - 1]!.push(cmd);
      n.children.forEach(walk);
    };
    if (merged) walk(merged);
    if (!groups[groups.length - 1]!.length) groups.pop();
    tabs.push({ id: obj.attrs.id!.replace(/Label$/, ''), label, contexts: contexts.length ? contexts : ['any'], groups });
  }
  return tabs;
}
const notebookbar = ribbon('sw/uiconfig/swriter/ui/notebookbar.ui');

const used = new Set<string>();
const visit = (ns: MenuNode[]) => ns.forEach((n) => { if ('cmd' in n) { used.add(n.cmd.split('?')[0]!); if (n.items) visit(n.items); } });
visit(menubar);
for (const m of Object.values(popupmenus)) visit(m);
const toolbars = { standardbar: toolbar('standardbar'), textobjectbar: toolbar('textobjectbar'), tableobjectbar: toolbar('tableobjectbar'), frameobjectbar: toolbar('frameobjectbar'), graphicobjectbar: toolbar('graphicobjectbar'), colorbar: toolbar('colorbar'), notebookbarshortcuts: toolbar('notebookbarshortcuts') };
for (const bar of Object.values(toolbars)) for (const i of bar) if ('cmd' in i) used.add(i.cmd.split('?')[0]!);
for (const c of Object.values(shortcuts)) used.add(c);
for (const tab of notebookbar) for (const g of tab.groups) for (const c of g) used.add(c.split('?')[0]!);

const labels: Record<string, Cmd> = {};
for (const c of [...used].sort()) if (commands[c]) labels[c] = commands[c];

// Colibre icons (CC0) for the visible toolbar commands; the UI falls back to text when one is missing.
const icons: Record<string, string> = {};
// links.txt maps icon names to the file that really holds the artwork.
const iconLinks = new Map<string, string>();
for (const line of read('icon-themes/colibre/links.txt').split('\n')) {
  const [from, to] = line.trim().split(/\s+/);
  if (from && to) iconLinks.set(from, to);
}
const iconCmds = [...Object.values(toolbars).flatMap((bar) => bar.flatMap((i) => ('cmd' in i ? [i.cmd] : []))), ...notebookbar.flatMap((t) => t.groups.flat())];
{
  for (const cmd of iconCmds) {
    const name = cmd.split('?')[0]!;
    let rel = `cmd/lc_${name.slice(5).toLowerCase()}.png`;
    for (let hops = 0; iconLinks.has(rel) && hops < 8; hops++) rel = iconLinks.get(rel)!;
    const file = join(CORE, 'icon-themes/colibre_svg', rel.replace(/\.png$/, '.svg'));
    if (existsSync(file)) icons[name] = readFileSync(file, 'utf8').replace(/\s*\n\s*/g, ' ').trim();
  }
  // The font colour and highlighting icons' colour areas, which the toolbar fills with the colour
  // at the cursor (svx ToolboxButtonColorUpdater): marked COLORBAR.
  if (icons['.uno:Color']) icons['.uno:Color'] = icons['.uno:Color'].replace('fill="#ed3d3b"', 'fill="COLORBAR"');
  if (icons['.uno:CharBackColor']) icons['.uno:CharBackColor'] = icons['.uno:CharBackColor'].replace('fill="#fb983b"', 'fill="COLORBAR"');
  // The shell's colour window: removing a colour (Clear Direct Formatting's icon) and a custom colour
  // (Color Settings').
  const APP_ICONS: Record<string, string> = { 'app:ColorRemove': 'cmd/lc_resetattributes.png', 'app:ColorCustom': 'cmd/lc_colorsettings.png' };
  for (const [key, png] of Object.entries(APP_ICONS)) {
    let rel = png;
    for (let hops = 0; iconLinks.has(rel) && hops < 8; hops++) rel = iconLinks.get(rel)!;
    icons[key] = readFileSync(join(CORE, 'icon-themes/colibre_svg', rel.replace(/\.png$/, '.svg')), 'utf8').replace(/\s*\n\s*/g, ' ').trim();
  }
}

mkdirSync(join(ROOT, 'src/app/generated'), { recursive: true });
writeFileSync(join(ROOT, 'src/app/generated/icons.json'), `${JSON.stringify(icons)}\n`);
writeFileSync(join(ROOT, 'src/app/generated/upstream-ui.json'), `${JSON.stringify({ menubar, popupmenus, toolbars, notebookbar, labels, shortcuts })}\n`);
console.log(`menubar roots: ${menubar.length}, referenced commands: ${used.size}, with labels: ${Object.keys(labels).length}, shortcuts: ${Object.keys(shortcuts).length}`);
