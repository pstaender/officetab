// Hunspell compiled to WebAssembly (the emscripten build shipped in hunspell-asm), driven through
// its C API as hunspell-asm's hunspellLoader does. Loading the emscripten module directly avoids
// that package's ESM wrapper, which bundlers cannot call.
// @ts-expect-error The emscripten preamble is CommonJS without types; its export is the module factory.
import createModule from 'hunspell-asm/dist/esm/lib/browser/hunspell.js';
import type { Hunspell } from '@lo/lingucomponent/source/spellcheck/spell/sspellimp.ts';

interface AsmModule {
  cwrap(name: string, ret: string | null, args: string[]): (...a: number[]) => number;
  FS: { mkdir(p: string): void; writeFile(p: string, data: Uint8Array): void };
  allocateUTF8(s: string): number;
  UTF8ToString(p: number): string;
  getValue(p: number, type: string): number;
  _malloc(n: number): number;
  _free(p: number): void;
}

export interface HunspellFactory { create(aff: Uint8Array, dic: Uint8Array, name: string): Hunspell }

let loading: Promise<HunspellFactory> | null = null;

export function loadHunspell(): Promise<HunspellFactory> {
  // The emscripten module object is a thenable (MODULARIZE's Module.then): resolving a promise
  // with it would recurse forever, so it travels wrapped.
  loading ??= new Promise<{ m: AsmModule }>((resolve, reject) => {
    const m: AsmModule = createModule({
      onRuntimeInitialized: () => resolve({ m }),
      onAbort: (r: unknown) => reject(r instanceof Error ? r : new Error(String(r))),
    });
  }).then(({ m }) => {
    const create = m.cwrap('Hunspell_create', 'number', ['number', 'number']);
    const spell = m.cwrap('Hunspell_spell', 'number', ['number', 'number']);
    const suggest = m.cwrap('Hunspell_suggest', 'number', ['number', 'number', 'number']);
    const freeList = m.cwrap('Hunspell_free_list', null, ['number', 'number', 'number']);
    m.FS.mkdir('/dict');
    /** Calls with a UTF-8 copy of the word, freed afterwards. */
    const withWord = <T,>(w: string, f: (p: number) => T): T => { const p = m.allocateUTF8(w.normalize()); try { return f(p); } finally { m._free(p); } };
    return {
      create: (aff, dic, name) => {
        m.FS.writeFile(`/dict/${name}.aff`, aff);
        m.FS.writeFile(`/dict/${name}.dic`, dic);
        const h = create(m.allocateUTF8(`/dict/${name}.aff`), m.allocateUTF8(`/dict/${name}.dic`));
        return {
          spell: (w) => !!withWord(w, (p) => spell(h, p)),
          suggest: (w) => {
            const list = m._malloc(4);
            const n = withWord(w, (p) => suggest(h, list, p));
            const arr = m.getValue(list, '*');
            const out = Array.from({ length: Math.max(0, n) }, (_, i) => m.UTF8ToString(m.getValue(arr + i * 4, '*')));
            freeList(h, list, n);
            m._free(list);
            return out;
          },
        };
      },
    };
  });
  return loading;
}
