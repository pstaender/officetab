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

const used = new Set<string>();
const visit = (ns: MenuNode[]) => ns.forEach((n) => { if ('cmd' in n) { used.add(n.cmd.split('?')[0]!); if (n.items) visit(n.items); } });
visit(menubar);
const toolbars = { standardbar: toolbar('standardbar'), textobjectbar: toolbar('textobjectbar'), tableobjectbar: toolbar('tableobjectbar'), frameobjectbar: toolbar('frameobjectbar') };
for (const bar of Object.values(toolbars)) for (const i of bar) if ('cmd' in i) used.add(i.cmd.split('?')[0]!);
for (const c of Object.values(shortcuts)) used.add(c);

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
for (const bar of Object.values(toolbars)) {
  for (const i of bar) {
    if (!('cmd' in i)) continue;
    const name = i.cmd.split('?')[0]!;
    let rel = `cmd/lc_${name.slice(5).toLowerCase()}.png`;
    for (let hops = 0; iconLinks.has(rel) && hops < 8; hops++) rel = iconLinks.get(rel)!;
    const file = join(CORE, 'icon-themes/colibre_svg', rel.replace(/\.png$/, '.svg'));
    if (existsSync(file)) icons[name] = readFileSync(file, 'utf8').replace(/\s*\n\s*/g, ' ').trim();
  }
}

mkdirSync(join(ROOT, 'src/app/generated'), { recursive: true });
writeFileSync(join(ROOT, 'src/app/generated/icons.json'), `${JSON.stringify(icons)}\n`);
writeFileSync(join(ROOT, 'src/app/generated/upstream-ui.json'), `${JSON.stringify({ menubar, toolbars, labels, shortcuts })}\n`);
console.log(`menubar roots: ${menubar.length}, referenced commands: ${used.size}, with labels: ${Object.keys(labels).length}, shortcuts: ${Object.keys(shortcuts).length}`);
