// SPDX-License-Identifier: MPL-2.0
// Node-side data broker for the LanguageTool tests: not a port. It answers every class path
// resource of generated/resources.json from the upstream checkout (upstream/languagetool/languagetool,
// repository resources) or public/languagetool/ (the Maven data), reading each file on first use,
// so tests need no preloading. Extra roots (directories laid out like the class path) can be added.
// Importing it also loads Hunspell (hunspell-asm's Node build) for the Hunspell-based spellers.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import manifestJson from '../../../src/languagetool/generated/resources.json';
import { JLanguageTool } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import {
  DefaultResourceDataBroker, type ResourceManifest,
} from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/broker/DefaultResourceDataBroker.ts';
import { DumontsHunspellDictionary } from '../../../src/languagetool/languagetool/languagetool-core/org/languagetool/rules/spelling/hunspell/DumontsHunspellDictionary.ts';
// @ts-expect-error The emscripten preamble is CommonJS without types; its export is the module factory.
import createHunspellNodeModule from 'hunspell-asm/dist/cjs/lib/node/hunspell.js';

// hunspell-asm's browser build (DumontsHunspellDictionary's default) does not run in Node.
await DumontsHunspellDictionary.init(createHunspellNodeModule);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = manifestJson as ResourceManifest;

/** The file of a class path resource ("/org/languagetool/..."), or null if it is not in the manifest. */
export function fileForResource(path: string): string | null {
  const module = manifest.resources[path];
  if (module !== undefined) return join(ROOT, 'upstream/languagetool/languagetool', manifest.modules[module]!, path);
  if (manifest.local.includes(path)) return join(ROOT, 'public/languagetool', path);
  return null;
}

/** A DefaultResourceDataBroker that loads resources from disk when they are first read. */
export class NodeResourceDataBroker extends DefaultResourceDataBroker {
  private readonly roots: string[];

  /** @param roots further directories laid out like the class path (searched after the manifest) */
  constructor(roots: string[] = []) {
    super();
    this.roots = roots;
  }

  override getAsStream(path: string): Uint8Array | null {
    if (!this.isLoaded(path)) {
      let file = fileForResource(path);
      if (file == null || !existsSync(file)) {
        file = this.roots.map((r) => join(r, path)).find((f) => existsSync(f)) ?? null;
      }
      if (file != null && existsSync(file)) this.put(path, new Uint8Array(readFileSync(file)));
    }
    return super.getAsStream(path);
  }

  override resourceExists(path: string): boolean {
    return super.resourceExists(path) || this.roots.some((r) => existsSync(join(r, this.getResourceDir(), path)));
  }

  override ruleFileExists(path: string): boolean {
    return super.ruleFileExists(path) || this.roots.some((r) => existsSync(join(r, this.getRulesDir(), path)));
  }
}

/** Creates a NodeResourceDataBroker and makes it JLanguageTool's data broker. */
export function installNodeBroker(roots: string[] = []): NodeResourceDataBroker {
  const broker = new NodeResourceDataBroker(roots);
  JLanguageTool.setDataBroker(broker);
  return broker;
}
