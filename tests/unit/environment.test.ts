// File > Work Environment and settings.json: default settings for the suite and per app, the
// settings exported as JSON and imported again, and the File menu's Work Environment submenu.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import writerUi from '../../src/writer/generated/upstream-ui.json';
import { KeymapStore } from '../../src/shell/keymaps.ts';
import { DEFAULT_KEYMAP } from '../../src/writer/keymaps.ts';
import { createAppUi, type MenuEntry, type UpstreamUi } from '../../src/shell/ui/labels.ts';

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

const APPS = ['writer', 'calc'];
const settings = () => import('../../src/shell/settings.ts');

describe('settings.json', () => {
  let store: MemoryStorage;
  beforeEach(() => { store = new MemoryStorage(); vi.stubGlobal('localStorage', store); vi.resetModules(); });
  afterEach(() => vi.unstubAllGlobals());

  it("takes suite settings and apps' objects, with aliases and comments", async () => {
    const { parseSettingsJson } = await settings();
    const m = parseSettingsJson({
      '// note': 'ignored', $schema: 'x',
      menuBarStyle: 'ribbon', autoSave: false, languageTool: { IsEnabled: true },
      writer: { menuBarStyle: 'classic', navigator: true },
      calc: { iconTheme: 'keyline' },
    }, APPS);
    expect(Object.fromEntries(m)).toEqual({
      'officetab:ui-mode': 'ribbon',
      'officetab:autosave': 'false',
      'officetab:languagetool': '{"IsEnabled":true}',
      'writer:ui-mode': 'classic',
      'writer:navigator': 'true',
      'calc:icon-theme': 'keyline',
    });
    expect(() => parseSettingsJson([1, 2])).toThrow();
  });

  it("are the defaults: the user's setting, then the app's default, then the suite's", async () => {
    const { setDefaultSettings, readSetting, suiteKey, appKey } = await settings();
    setDefaultSettings({ menuBarStyle: 'classic', author: 'Default', calc: { menuBarStyle: 'ribbon' }, writer: { autoSave: false } }, 'writer', APPS);
    expect(readSetting(appKey('writer', 'ui-mode'))).toBe('classic');
    expect(readSetting(appKey('calc', 'ui-mode'))).toBe('ribbon');
    expect(readSetting(suiteKey('author'))).toBe('Default');
    // A suite setting takes the reading app's default first.
    expect(readSetting(suiteKey('autosave'))).toBe('false');
    expect(readSetting(suiteKey('unknown'))).toBeNull();
    store.setItem('writer:ui-mode', 'ribbon');
    store.setItem('officetab:author', 'Ada');
    expect(readSetting(appKey('writer', 'ui-mode'))).toBe('ribbon');
    expect(readSetting(suiteKey('author'))).toBe('Ada');
  });

  it("let a suite-wide setting stand for an app's one the user has not set", async () => {
    const { setDefaultSettings, readSetting, appKey } = await settings();
    setDefaultSettings({}, 'calc', APPS);
    store.setItem('officetab:ui-mode', 'classic');
    expect(readSetting(appKey('calc', 'ui-mode'))).toBe('classic');
    store.setItem('calc:ui-mode', 'ribbon');
    expect(readSetting(appKey('calc', 'ui-mode'))).toBe('ribbon');
  });

  it('are exported in the same form and imported again unchanged', async () => {
    const { exportSettings, importSettings } = await settings();
    store.setItem('officetab:author', 'Ada');
    store.setItem('officetab:autosave', 'false');
    store.setItem('officetab:userwords', '["Lovelace"]');
    store.setItem('officetab:quoted', '"a string"');
    store.setItem('officetab:digits', '123');
    store.setItem('writer:ui-mode', 'classic');
    store.setItem('writer:view-positions', '{"a":1}');
    store.setItem('calc:keymap', '{"F2":".uno:SetInputMode"}');
    store.setItem('lo-writer-last-doc', 'x');
    store.setItem('other:thing', 'y');
    const json = exportSettings();
    expect(json).toEqual({
      author: 'Ada', autoSave: false, userDictionary: ['Lovelace'], quoted: '"a string"', digits: 123,
      writer: { menuBarStyle: 'classic' },
      calc: { keymap: { F2: '.uno:SetInputMode' } },
    });
    expect(exportSettings(true)).toMatchObject({ writer: { 'view-positions': { a: 1 } } });
    const before = new Map(store.data);
    store.clear();
    expect(importSettings(JSON.parse(JSON.stringify(json)))).toBe(7);
    expect(store.data.size).toBe(7);
    for (const [k, v] of store.data) expect(before.get(k)).toBe(v);
  });
});

describe('File > Work Environment', () => {
  it('holds Import, Export, Export Settings as JSON and Clear Data, last in the File menu', () => {
    const ui = createAppUi(writerUi as UpstreamUi, new KeymapStore(null, { ids: ['default'], maps: { default: DEFAULT_KEYMAP } }, 'x:keymap'));
    const file = ui.menubar.find((m) => m.cmd === '.uno:PickList')!;
    const items = file.items!.filter((i: MenuEntry) => !i.sep);
    const env = items.at(-1)!;
    expect(env.cmd).toBe('app:WorkEnvironment');
    expect(env.items!.map((i) => i.cmd ?? '-')).toEqual(['app:WorkEnvImport', 'app:WorkEnvExport', 'app:WorkEnvExportSettings', '-', 'app:ClearData']);
    expect(items.some((i) => i.cmd === 'app:ClearData')).toBe(false);
    expect(ui.menuLabel('app:WorkEnvironment')).toBe('Work Environment');
  });
});
