// Generates each module's src/<app>/generated/upstream-ui.json (Writer's, Calc's) from upstream's
// own UI definitions, so that the web UI exposes exactly the commands, labels and shortcuts of the
// desktop application, and src/shell/generated/icons.json, the icons of those commands (shared by
// every app of the suite: the union of the commands of all modules).
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

/** What differs between the modules (sw, sc): where their UI configuration lives. */
interface Module {
  /** The module's uiconfig directory (sw/uiconfig/swriter). */
  uiconfig: string;
  /** Its officecfg command labels (WriterCommands.xcu), overriding GenericCommands.xcu. */
  commandsXcu: string;
  /** Its Accelerators.xcu module (com.sun.star.text.TextDocument). */
  acceleratorModule: string;
  /**
   * Menu items whose submenu a popup menu controller fills from a popupmenu file
   * (officecfg Controller.xcu registers these controllers for the commands).
   */
  popupControllers: Record<string, string>;
  /** The context menus the shells register (SFX_POPUPMENU / RegisterPopupMenu, or ExecutePopup). */
  popupMenus: string[];
  /** The toolbars the web UI uses. */
  toolbars: string[];
  /** Where the module's upstream-ui.json goes. */
  out: string;
}

const MODULES: Module[] = [
  {
    uiconfig: 'sw/uiconfig/swriter',
    commandsXcu: 'officecfg/registry/data/org/openoffice/Office/UI/WriterCommands.xcu',
    acceleratorModule: 'com.sun.star.text.TextDocument',
    popupControllers: { '.uno:InsertFieldCtrl': 'insertfield' },
    // text, table, graphic …
    popupMenus: ['text', 'table', 'graphic', 'frame', 'draw', 'drawtext', 'annotation', 'oleobject', 'media'],
    toolbars: ['standardbar', 'textobjectbar', 'tableobjectbar', 'frameobjectbar', 'graphicobjectbar', 'colorbar', 'notebookbarshortcuts'],
    out: 'src/writer/generated/upstream-ui.json',
  },
  {
    uiconfig: 'sc/uiconfig/scalc',
    commandsXcu: 'officecfg/registry/data/org/openoffice/Office/UI/CalcCommands.xcu',
    acceleratorModule: 'com.sun.star.sheet.SpreadsheetDocument',
    // The ResourceMenuControllers of Controller.xcu for any module or com.sun.star.sheet.SpreadsheetDocument
    // whose popupmenu file sc has.
    popupControllers: {
      '.uno:ConditionalFormatMenu': 'conditional', '.uno:FreezePanesMenu': 'freezepanes', '.uno:AnchorMenu': 'anchor',
      '.uno:ColumnOperations': 'column_operations', '.uno:RowOperations': 'row_operations', '.uno:PrintRangesMenu': 'printranges',
    },
    // RegisterPopupMenu: cell (ScCellShell), celledit (ScEditShell), pagebreak, pivot, audit, sparkline,
    // draw, drawtext, graphic, oleobject (chart and OLE shells), media, form, preview (ScPreviewShell);
    // ExecutePopup: colheader / rowheader (ScHeaderControl), sheettab (ScTabControl), formulabar (ScInputWindow).
    popupMenus: ['cell', 'celledit', 'colheader', 'rowheader', 'sheettab', 'formulabar', 'pagebreak', 'pivot', 'audit', 'sparkline', 'graphic', 'draw', 'drawtext', 'oleobject', 'media', 'form', 'preview'],
    // CalcWindowState.xcu's visible docked toolbars (but the forms and Fontwork ones), the colour bar
    // and the Tabbed interface's quick access toolbox, as for Writer.
    toolbars: ['standardbar', 'formatobjectbar', 'textobjectbar', 'drawobjectbar', 'graphicobjectbar', 'mediaobjectbar', 'previewbar', 'colorbar', 'notebookbarshortcuts'],
    out: 'src/calc/generated/upstream-ui.json',
  },
];

interface Cmd { label?: string; context?: string; popup?: string; tooltip?: string }
function collectCommands(commands: Record<string, Cmd>, file: string): void {
  const walk = (n: XmlNode) => {
    const name = n.attrs['oor:name'];
    // Menus also hold non-.uno: commands (Edit > Find..., vnd.sun.star.findbar:FocusToFindbar).
    if (n.tag === 'node' && (name?.startsWith('.uno:') || name?.startsWith('vnd.sun.star.'))) {
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

const controllerXcu = parseXml(read('officecfg/registry/data/org/openoffice/Office/UI/Controller.xcu'));
const accel = parseXml(read('officecfg/registry/data/org/openoffice/Office/Accelerators.xcu')).children[0]!;

export type MenuNode = { sep: true } | { cmd: string; items?: MenuNode[] };
type ToolItem = { sep: true } | { cmd: string; visible: boolean };

// The Tabbed user interface (notebookbar.ui, as sfx2's NotebookBar builds it): each tab with its
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
      // GtkBuilder reads '_' in a property name as '-': Calc's file spells it action_name.
      const cmd = n.tag === 'property' && n.attrs.name?.replace(/_/g, '-') === 'action-name' ? n.text.trim() : '';
      if (cmd.startsWith('.uno:')) groups[groups.length - 1]!.push(cmd);
      n.children.forEach(walk);
    };
    if (merged) walk(merged);
    if (!groups[groups.length - 1]!.length) groups.pop();
    tabs.push({ id: obj.attrs.id!.replace(/Label$/, ''), label, contexts: contexts.length ? contexts : ['any'], groups });
  }
  return tabs;
}

/** Writes the module's upstream-ui.json; returns the commands that want icons (toolbars, ribbon). */
function generate(mod: Module): string[] {
  const commands: Record<string, Cmd> = {};
  // Later files win, mirroring how a module label (Writer's, Calc's) overrides a generic one.
  collectCommands(commands, 'officecfg/registry/data/org/openoffice/Office/UI/GenericCommands.xcu');
  collectCommands(commands, mod.commandsXcu);

  // Menu items that framework's ToolbarAsMenuController fills with the items of a toolbar of the
  // module (Insert > Shape > Basic Shapes...): Controller.xcu names the toolbar in its Value.
  const TOOLBAR_MENUS: Record<string, string> = {};
  {
    const walk = (n: XmlNode) => {
      if (n.tag === 'node') {
        const prop = (k: string) => n.children.find((p) => p.tag === 'prop' && p.attrs['oor:name'] === k)?.children[0]?.text;
        if (prop('Controller') === 'com.sun.star.comp.framework.ToolbarAsMenuController') {
          const cmd = prop('Command'), bar = prop('Value');
          if (cmd && bar && existsSync(join(CORE, `${mod.uiconfig}/toolbar/${bar}.xml`))) TOOLBAR_MENUS[cmd] = bar;
        }
      }
      n.children.forEach(walk);
    };
    walk(controllerXcu);
  }
  const POPUP_CONTROLLERS = mod.popupControllers;
  function menuItems(n: XmlNode): MenuNode[] {
    const out: MenuNode[] = [];
    for (const c of n.children) {
      if (c.tag === 'menu:menuseparator') out.push({ sep: true });
      else if (c.tag === 'menu:menuitem' && TOOLBAR_MENUS[c.attrs['menu:id']!]) {
        const items = toolbar(TOOLBAR_MENUS[c.attrs['menu:id']!]!).map((t): MenuNode => ('sep' in t ? t : { cmd: t.cmd }));
        out.push({ cmd: c.attrs['menu:id']!, items });
      }
      else if (c.tag === 'menu:menuitem' && POPUP_CONTROLLERS[c.attrs['menu:id']!]) {
        const popup = parseXml(read(`${mod.uiconfig}/popupmenu/${POPUP_CONTROLLERS[c.attrs['menu:id']!]}.xml`)).children.find((x) => x.tag === 'menu:menupopup')!;
        out.push({ cmd: c.attrs['menu:id']!, items: menuItems(popup) });
      } else if (c.tag === 'menu:menuitem') out.push({ cmd: c.attrs['menu:id']! });
      else if (c.tag === 'menu:menu') {
        const popup = c.children.find((x) => x.tag === 'menu:menupopup');
        out.push({ cmd: c.attrs['menu:id']!, items: popup ? menuItems(popup) : [] });
      }
    }
    return out;
  }
  function toolbar(name: string): ToolItem[] {
    const root = parseXml(read(`${mod.uiconfig}/toolbar/${name}.xml`)).children.find((c) => c.tag === 'toolbar:toolbar')!;
    return root.children.flatMap((c): ToolItem[] => {
      if (c.tag === 'toolbar:toolbarseparator') return [{ sep: true }];
      if (c.tag === 'toolbar:toolbaritem') return [{ cmd: c.attrs['xlink:href']!, visible: c.attrs['toolbar:visible'] !== 'false' }];
      return [];
    });
  }

  const menubarRoot = parseXml(read(`${mod.uiconfig}/menubar/menubar.xml`)).children.find((c) => c.tag === 'menu:menubar')!;
  const menubar = menuItems(menubarRoot);
  const popupmenus: Record<string, MenuNode[]> = {};
  for (const name of mod.popupMenus) {
    const root = parseXml(read(`${mod.uiconfig}/popupmenu/${name}.xml`)).children.find((c) => c.tag === 'menu:menupopup')!;
    popupmenus[name] = menuItems(root);
  }

  // Accelerators: module keys override global ones, primary keys override secondary ones.
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
    addKeys(mods && find(mods, mod.acceleratorModule));
  }

  const notebookbar = ribbon(`${mod.uiconfig}/ui/notebookbar.ui`);

  const used = new Set<string>();
  const visit = (ns: MenuNode[]) => ns.forEach((n) => { if ('cmd' in n) { used.add(n.cmd.split('?')[0]!); if (n.items) visit(n.items); } });
  visit(menubar);
  for (const m of Object.values(popupmenus)) visit(m);
  const toolbars: Record<string, ToolItem[]> = {};
  for (const name of mod.toolbars) toolbars[name] = toolbar(name);
  for (const bar of Object.values(toolbars)) for (const i of bar) if ('cmd' in i) used.add(i.cmd.split('?')[0]!);
  for (const c of Object.values(shortcuts)) used.add(c);
  for (const tab of notebookbar) for (const g of tab.groups) for (const c of g) used.add(c.split('?')[0]!);

  const labels: Record<string, Cmd> = {};
  for (const c of [...used].sort()) if (commands[c]) labels[c] = commands[c];

  const out = join(ROOT, mod.out);
  mkdirSync(join(out, '..'), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ menubar, popupmenus, toolbars, notebookbar, labels, shortcuts })}\n`);
  console.log(`${mod.out}: menubar roots: ${menubar.length}, referenced commands: ${used.size}, with labels: ${Object.keys(labels).length}, shortcuts: ${Object.keys(shortcuts).length}`);

  return [...Object.values(toolbars).flatMap((bar) => bar.flatMap((i) => ('cmd' in i ? [i.cmd] : []))), ...notebookbar.flatMap((t) => t.groups.flat())];
}

const iconCmdsByModule = MODULES.map(generate);

// Colibre icons (CC0) for the visible toolbar commands; the UI falls back to text when one is missing.
// The first module's (Writer's) come first, with the shell's own after them; the others add theirs.
const icons: Record<string, string> = {};
// links.txt maps icon names to the file that really holds the artwork.
const iconLinks = new Map<string, string>();
for (const line of read('icon-themes/colibre/links.txt').split('\n')) {
  const [from, to] = line.trim().split(/\s+/);
  if (from && to) iconLinks.set(from, to);
}
const addIcons = (iconCmds: string[]) => {
  for (const cmd of iconCmds) {
    const name = cmd.split('?')[0]!;
    if (name in icons) continue;
    let rel = `cmd/lc_${name.slice(5).toLowerCase()}.png`;
    for (let hops = 0; iconLinks.has(rel) && hops < 8; hops++) rel = iconLinks.get(rel)!;
    const file = join(CORE, 'icon-themes/colibre_svg', rel.replace(/\.png$/, '.svg'));
    if (existsSync(file)) icons[name] = readFileSync(file, 'utf8').replace(/\s*\n\s*/g, ' ').trim();
  }
};
{
  addIcons(iconCmdsByModule[0]!);
  // The font colour and highlighting icons' colour areas, which the toolbar fills with the colour
  // at the cursor (svx ToolboxButtonColorUpdater): marked COLORBAR.
  if (icons['.uno:Color']) icons['.uno:Color'] = icons['.uno:Color'].replace('fill="#ed3d3b"', 'fill="COLORBAR"');
  if (icons['.uno:CharBackColor']) icons['.uno:CharBackColor'] = icons['.uno:CharBackColor'].replace('fill="#fb983b"', 'fill="COLORBAR"');
  // The shell's colour window: removing a colour (Clear Direct Formatting's icon) and a custom colour
  // (Color Settings'); and the ribbon's New button, a plain document (New's own, which Colibre draws without a plus).
  const APP_ICONS: Record<string, string> = { 'app:ColorRemove': 'cmd/lc_resetattributes.png', 'app:ColorCustom': 'cmd/lc_colorsettings.png', 'app:New': 'cmd/lc_adddirect.png' };
  for (const [key, png] of Object.entries(APP_ICONS)) {
    let rel = png;
    for (let hops = 0; iconLinks.has(rel) && hops < 8; hops++) rel = iconLinks.get(rel)!;
    icons[key] = readFileSync(join(CORE, 'icon-themes/colibre_svg', rel.replace(/\.png$/, '.svg')), 'utf8').replace(/\s*\n\s*/g, ' ').trim();
  }
  // The shell's File > Download (.uno:SaveACopy) in the ribbon's quick access toolbox:
  // Colibre has no download icon, so this one is drawn in its colours (grey tray, blue arrow).
  icons['.uno:SaveACopy'] = '<svg height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="m3 14h2v5h14v-5h2v6c0 .554-.446 1-1 1h-16c-.554 0-1-.446-1-1z" fill="#3a3a38"/>'
    + '<path d="m11 3h2v10.586l3.293-3.293 1.414 1.414-5.707 5.707-5.707-5.707 1.414-1.414 3.293 3.293z" fill="#1e8bcd"/></svg>';
  for (const iconCmds of iconCmdsByModule.slice(1)) addIcons(iconCmds);
}

mkdirSync(join(ROOT, 'src/shell/generated'), { recursive: true });
writeFileSync(join(ROOT, 'src/shell/generated/icons.json'), `${JSON.stringify(icons)}\n`);
console.log(`icons: ${Object.keys(icons).length}`);
