// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/hunspell/DumontsHunspellDictionary.java reduced
// Java drives the native Hunspell through the JNI bindings of com.gitlab.dumonts.hunspell; here
// the native Hunspell is hunspell-asm's emscripten build (WebAssembly), driven through its C API
// (Hunspell_create/spell/suggest/add/free_list/destroy) with cwrap. The class NativeHunspell
// below stands in for com.gitlab.dumonts.hunspell.Hunspell.
// The WebAssembly module loads asynchronously: await DumontsHunspellDictionary.init() once
// before the first dictionary is created (the constructor throws otherwise, as Java's does when
// the native library cannot be linked). In Node, pass hunspell-asm's Node build to init(): the
// default is the browser build, which only runs in a window or worker.
// The constructor takes the dictionary and affix contents instead of paths: they are written to
// the emscripten file system, read by Hunspell_create (which loads both files completely) and
// removed again, so deleteOnClose (temporary files) has nothing left to do.
// @ts-expect-error The emscripten preamble is CommonJS without types; its export is the module factory.
import createBrowserModule from 'hunspell-asm/dist/esm/lib/browser/hunspell.js';
import type { HunspellDictionary } from './HunspellDictionary.ts';

/** The parts of the emscripten module that are used. */
interface AsmModule {
  cwrap(name: string, ret: string | null, args: string[]): (...a: number[]) => number;
  FS: { mkdir(p: string): void; writeFile(p: string, data: Uint8Array): void; unlink(p: string): void };
  allocateUTF8(s: string): number;
  UTF8ToString(p: number): string;
  getValue(p: number, type: string): number;
  _malloc(n: number): number;
  _free(p: number): void;
}

/** An emscripten module factory (MODULARIZE): hunspell-asm's lib/browser/hunspell.js or lib/node/hunspell.js. */
export type HunspellModuleFactory = (moduleArg: object) => unknown;

interface Api {
  m: AsmModule;
  create: (aff: number, dic: number) => number;
  destroy: (h: number) => number;
  spell: (h: number, w: number) => number;
  suggest: (h: number, list: number, w: number) => number;
  add: (h: number, w: number) => number;
  freeList: (h: number, list: number, n: number) => number;
}

let api: Api | null = null;
let loading: Promise<void> | null = null;
let fileCounter = 0;

/** com.gitlab.dumonts.hunspell.Hunspell over the WebAssembly build. */
class NativeHunspell {
  private handle: number;

  constructor(dictionary: Uint8Array, affix: Uint8Array) {
    if (api == null) {
      throw new Error('UnsatisfiedLinkError: hunspell-asm is not loaded: await DumontsHunspellDictionary.init() first');
    }
    const { m } = api;
    const name = '/hunspell/' + (fileCounter++);
    m.FS.writeFile(name + '.aff', affix);
    m.FS.writeFile(name + '.dic', dictionary);
    const affPtr = m.allocateUTF8(name + '.aff');
    const dicPtr = m.allocateUTF8(name + '.dic');
    try {
      this.handle = api.create(affPtr, dicPtr);
    } finally {
      m._free(affPtr);
      m._free(dicPtr);
      m.FS.unlink(name + '.aff');
      m.FS.unlink(name + '.dic');
    }
  }

  /** Calls f with a UTF-8 copy of the word, freed afterwards. */
  private withWord<T>(word: string, f: (p: number) => T): T {
    const p = api!.m.allocateUTF8(word);
    try {
      return f(p);
    } finally {
      api!.m._free(p);
    }
  }

  spell(word: string): boolean {
    return this.withWord(word, (p) => api!.spell(this.handle, p)) !== 0;
  }

  add(word: string): void {
    this.withWord(word, (p) => api!.add(this.handle, p));
  }

  suggest(word: string): string[] {
    const { m } = api!;
    const list = m._malloc(4);
    try {
      const n = this.withWord(word, (p) => api!.suggest(this.handle, list, p));
      const arr = m.getValue(list, '*');
      const result: string[] = [];
      for (let i = 0; i < n; i++) {
        result.push(m.UTF8ToString(m.getValue(arr + i * 4, '*')));
      }
      if (n > 0) api!.freeList(this.handle, list, n);
      return result;
    } finally {
      m._free(list);
    }
  }

  close(): void {
    if (this.handle !== 0) {
      api!.destroy(this.handle);
      this.handle = 0;
    }
  }
}

export class DumontsHunspellDictionary implements HunspellDictionary {
  private readonly hunspell: NativeHunspell;
  private readonly deleteOnClose: boolean;
  private closed = false;

  /**
   * Loads hunspell-asm's WebAssembly module (once). Await this before creating dictionaries.
   * @param factory the emscripten module factory; by default hunspell-asm's browser build
   */
  static init(factory: HunspellModuleFactory = createBrowserModule as HunspellModuleFactory): Promise<void> {
    // The emscripten module object is a thenable (MODULARIZE's Module.then): resolving a promise
    // with it would recurse forever, so it travels wrapped.
    loading ??= new Promise<{ m: AsmModule }>((resolve, reject) => {
      // The browser build only recognizes a window or a classic worker (importScripts); a module
      // worker has no importScripts, so one is lent while the module detects its environment
      // (it embeds the WebAssembly as a data: URI and loads nothing).
      const g = globalThis as { importScripts?: unknown; window?: unknown; process?: { versions?: { node?: string } } };
      const lend = g.window === undefined && g.importScripts === undefined && g.process?.versions?.node === undefined;
      if (lend) g.importScripts = () => { throw new Error('importScripts is not available in a module worker'); };
      try {
        const m = factory({
          onRuntimeInitialized: () => resolve({ m }),
          onAbort: (r: unknown) => reject(r instanceof Error ? r : new Error(String(r))),
        }) as AsmModule;
      } finally {
        if (lend) delete g.importScripts;
      }
    }).then(({ m }) => {
      m.FS.mkdir('/hunspell');
      api = {
        m,
        create: m.cwrap('Hunspell_create', 'number', ['number', 'number']),
        destroy: m.cwrap('Hunspell_destroy', null, ['number']),
        spell: m.cwrap('Hunspell_spell', 'number', ['number', 'number']),
        suggest: m.cwrap('Hunspell_suggest', 'number', ['number', 'number', 'number']),
        add: m.cwrap('Hunspell_add', 'number', ['number', 'number']),
        freeList: m.cwrap('Hunspell_free_list', null, ['number', 'number', 'number']),
      };
    });
    loading.catch(() => { loading = null; });
    return loading;
  }

  /** Whether {@link init} has completed. */
  static isInitialized(): boolean {
    return api != null;
  }

  constructor(dictionary: Uint8Array, affix: Uint8Array, deleteOnClose = false) {
    this.deleteOnClose = deleteOnClose;
    try {
      this.hunspell = new NativeHunspell(dictionary, affix);
    } catch (e) {
      throw new Error('RuntimeException: Could not create hunspell instance.', { cause: e });
    }
  }

  isDeleteOnClose(): boolean {
    return this.deleteOnClose;
  }

  isClosed(): boolean {
    return this.closed;
  }

  spell(word: string): boolean {
    if (this.closed) {
      throw new Error('RuntimeException: Attempt to use hunspell instance after closing');
    }
    return this.hunspell.spell(word);
  }

  add(word: string): void {
    if (this.closed) {
      throw new Error('RuntimeException: Attempt to use hunspell instance after closing');
    }
    this.hunspell.add(word);
  }

  suggest(word: string): string[] {
    if (this.closed) {
      throw new Error('RuntimeException: Attempt to use hunspell instance after closing');
    }
    return this.hunspell.suggest(word);
  }

  close(): void {
    this.closed = true;
    this.hunspell.close();
  }
}
