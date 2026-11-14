// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/broker/DefaultResourceDataBroker.java reduced
// Java reads resources synchronously from the class path. Here the class path is an in-memory
// cache, keyed by the class path ("/org/languagetool/rules/en/grammar.xml"), which the async
// preload()/preloadLanguage() fill by fetch() before checking, as listed in
// src/languagetool/generated/resources.json: resources from the repository come from jsDelivr
// (`cdn` + `modules[module]` + path), the Maven data (`local`) from the application
// (`<localBaseUrl>languagetool` + path). put() fills it directly (the Node tests do so from
// the upstream checkout, see tests/unit/languagetool/broker.ts).
// Whether a resource exists is answered from the manifest, without loading it; reading a resource
// that exists but has not been preloaded throws an error naming it. A resource that is neither in
// the manifest nor put() does not exist (getAsStream returns null, as Java's getResourceAsStream).
// Left out: the URL methods (see ResourceDataBroker.ts).
import manifestJson from '../../../../../generated/resources.json';
import type { Locale } from '../../../../../jdk/java/util/Locale.ts';
import { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { RESOURCE_DIR, RULES_DIR, type ResourceDataBroker } from './ResourceDataBroker.ts';

/** The shape of generated/resources.json. */
export interface ResourceManifest {
  cdn: string;
  /** Tried when the CDN refuses a file (jsDelivr limits the size of a GitHub repository). */
  fallback?: string;
  modules: Record<string, string>;
  resources: Record<string, string>;
  local: string[];
}

/**
 * Responsible for getting any items from LanguageTool's resource
 * directories. This default data broker assumes that they are accessible
 * directly via class-path and the directory names are like specified in:
 *
 * <ul>
 * <li>{@link ResourceDataBroker#RESOURCE_DIR}</li>
 * <li>{@link ResourceDataBroker#RULES_DIR}</li>
 * </ul>
 */
export class DefaultResourceDataBroker implements ResourceDataBroker {

  /**
   * The directory's name of LanguageTool's resource directory. The
   * default value equals {@link ResourceDataBroker#RESOURCE_DIR}.
   */
  private readonly resourceDir: string;

  /**
   * The directory's name of LanguageTool's rules directory. The
   * default value equals {@link ResourceDataBroker#RULES_DIR}.
   */
  private readonly rulesDir: string;

  /** The class path: complete path to content. */
  private readonly cache = new Map<string, Uint8Array>();
  private readonly manifest: ResourceManifest;
  private readonly known: Set<string>;
  private localBaseUrl = '/';
  private fetchFn: (url: string) => Promise<Response> = (url) => fetch(url);

  /**
   * Instantiates this data broker with the passed resource directory names
   * (default {@link ResourceDataBroker#RESOURCE_DIR} and {@link ResourceDataBroker#RULES_DIR}).
   * @param manifest where the resources come from (default: generated/resources.json)
   */
  constructor(resourceDir: string | null = RESOURCE_DIR, rulesDir: string | null = RULES_DIR, manifest: ResourceManifest = manifestJson as ResourceManifest) {
    this.resourceDir = (resourceDir == null) ? '' : resourceDir;
    this.rulesDir = (rulesDir == null) ? '' : rulesDir;
    this.manifest = manifest;
    this.known = new Set([...Object.keys(manifest.resources), ...manifest.local]);
  }

  // ---------------------------------------------------------------- loading (not in Java)

  /** The base URL of the application, under which `languagetool/` serves the Maven data. */
  setLocalBaseUrl(url: string): void {
    this.localBaseUrl = url.endsWith('/') ? url : url + '/';
  }

  /** Replaces fetch() (e.g. to read from a cache). */
  setFetch(fetchFn: (url: string) => Promise<Response>): void {
    this.fetchFn = fetchFn;
  }

  /** Adds a resource to the class path. */
  put(path: string, content: Uint8Array | string): void {
    this.cache.set(path, typeof content === 'string' ? new TextEncoder().encode(content) : content);
    this.known.add(path);
  }

  /** Whether the resource is in memory. */
  isLoaded(path: string): boolean {
    return this.cache.has(path);
  }

  /** All class paths this broker knows (loaded or not). */
  getKnownPaths(): string[] {
    return [...this.known];
  }

  /** The URL a class path resource is fetched from, or null if it is not in the manifest. */
  getUrlFor(path: string): string | null {
    const module = this.manifest.resources[path];
    if (module !== undefined) {
      return this.manifest.cdn + '/' + this.manifest.modules[module] + path;
    }
    if (this.manifest.local.includes(path)) {
      return this.localBaseUrl + 'languagetool' + path;
    }
    return null;
  }

  /** The second address of a repository resource (the manifest's `fallback`), or null. */
  getFallbackUrlFor(path: string): string | null {
    const module = this.manifest.resources[path];
    if (module === undefined || !this.manifest.fallback) return null;
    return this.manifest.fallback + '/' + this.manifest.modules[module] + path;
  }

  /** Fetches the given class path resources (complete paths) into memory. */
  async preload(paths: Iterable<string>): Promise<void> {
    const todo = [...new Set(paths)].filter((p) => !this.cache.has(p));
    await Promise.all(todo.map(async (path) => {
      const url = this.getUrlFor(path);
      if (url == null) {
        throw new Error('LanguageTool resource ' + path + ' is not in generated/resources.json');
      }
      let response = await this.fetchFn(url).catch(() => null);
      // jsDelivr refuses files of large repositories now and then (HTTP 403): GitHub serves them.
      const fallback = this.getFallbackUrlFor(path);
      if (!response?.ok && fallback != null) {
        response = await this.fetchFn(fallback).catch(() => null);
      }
      if (!response) {
        throw new Error('Could not fetch LanguageTool resource ' + path + ' from ' + url);
      }
      if (!response.ok) {
        throw new Error('Could not fetch LanguageTool resource ' + path + ' from ' + url + ': HTTP ' + response.status);
      }
      this.cache.set(path, new Uint8Array(await response.arrayBuffer()));
    }));
  }

  /**
   * The class path resources a language needs: the core's (message bundles, sentence
   * segmentation, global disambiguation and spelling files, false friends) and every resource of
   * the language (`/<code>/` in the resource and rules directories, `/<code>-*.bin` models).
   * Documentation and build scripts (.awk, .sh, readme files, XML schemas) are left out.
   * @param shortCode e.g. "en"
   */
  getLanguagePaths(shortCode: string): string[] {
    const isDoc = (p: string) => /\.(awk|sh|xsd|dtd|css|xsl|html|README)$/.test(p) || /readme/i.test(p);
    const core = [
      '/org/languagetool/MessagesBundle.properties',
      '/org/languagetool/MessagesBundle_' + shortCode + '.properties',
      this.resourceDir + '/segment.srx',
      this.resourceDir + '/org/languagetool/tokenizers/segment-simple.srx',
      this.resourceDir + '/disambiguation-global.xml',
      this.resourceDir + '/spelling_global.txt',
      this.rulesDir + '/false-friends.xml',
    ];
    const result = core.filter((p) => this.known.has(p));
    for (const p of this.known) {
      if (isDoc(p) || result.includes(p)) continue;
      if (p.startsWith(this.resourceDir + '/' + shortCode + '/') || p.startsWith(this.rulesDir + '/' + shortCode + '/')
        || (p.startsWith('/' + shortCode + '-') && p.endsWith('.bin'))) {
        result.push(p);
      }
    }
    return result;
  }

  /** Fetches the resources of a language ({@link getLanguagePaths}), optionally filtered. */
  async preloadLanguage(shortCode: string, filter: (path: string) => boolean = () => true): Promise<void> {
    await this.preload(this.getLanguagePaths(shortCode).filter(filter));
  }

  // ---------------------------------------------------------------- ResourceDataBroker

  /**
   * See:
   * {@link ResourceDataBroker#getFromResourceDirAsStream(String)}
   *
   * @param path
   *            The relative path to the item inside of the {@code /resource}
   *            directory. Please start your path information with {@code /}
   *            because it will be concatenated with the directory's name:
   *            /resource<b>/yourpath</b>.
   * @throws RuntimeException if path cannot be found
   */
  getFromResourceDirAsStream(path: string): Uint8Array {
    const completePath = this.getCompleteResourceUrl(path);
    const resourceAsStream = this.getAsStream(completePath);
    this.assertNotNull(resourceAsStream, path, completePath);
    return resourceAsStream!;
  }

  /**
   * See:
   * {@link ResourceDataBroker#getFromResourceDirAsStream(String)}
   *
   * @param path The relative path to the item inside of the {@code /resource}, e.g. {@code /xx/filename}
   * @return An list of strings, one per line
   * @throws RuntimeException if path cannot be found
   * @since 4.9
   */
  getFromResourceDirAsLines(path: string): string[] {
    const text = new TextDecoder('utf-8').decode(this.getFromResourceDirAsStream(path));
    // BufferedReader.readLine: \n, \r or \r\n end a line; no empty last line after a final break
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /**
   * {@inheritDoc}
   * @throws Error if the resource exists but has not been preloaded
   */
  getAsStream(path: string): Uint8Array | null {
    const content = this.cache.get(path);
    if (content !== undefined) return content;
    if (this.known.has(path)) {
      throw new Error('LanguageTool resource ' + path + ' not preloaded: call JLanguageTool.getDataBroker().preload() or preloadLanguage() first');
    }
    return null;
  }

  /**
   * Concatenates the passed resource path with the currently set {@code
   * resource} directory path.
   */
  private getCompleteResourceUrl(path: string): string {
    return this.appendPath(this.resourceDir, path);
  }

  /**
   * See:
   * {@link ResourceDataBroker#getFromRulesDirAsStream(String)}
   *
   * @param path The relative path to the item inside of the {@code /rules}
   *  directory. Please start your path information with {@code /} because it
   *  will be concatenated with the directory's name: /rules<b>/yourpath</b>.
   * @throws RuntimeException if path cannot be found
   */
  getFromRulesDirAsStream(path: string): Uint8Array {
    const completePath = this.getCompleteRulesUrl(path);
    const resourceAsStream = this.getAsStream(completePath);
    this.assertNotNull(resourceAsStream, path, completePath);
    return resourceAsStream!;
  }

  private assertNotNull(object: unknown, path: string, completePath: string): void {
    if (object == null) {
      throw new Error('RuntimeException: Path ' + path + ' not found in class path at ' + completePath);
    }
  }

  /**
   * Concatenates the passed resource path with the currently set {@code
   * rules} directory path.
   */
  private getCompleteRulesUrl(path: string): string {
    return this.appendPath(this.rulesDir, path);
  }

  private appendPath(baseDir: string, path: string): string {
    let completePath = baseDir;
    if (!this.rulesDir.endsWith('/') && !path.startsWith('/')) {
      completePath += '/';
    }
    if (this.rulesDir.endsWith('/') && path.startsWith('/') && path.length > 1) {
      completePath += path.substring(1);
    } else {
      completePath += path;
    }
    return completePath;
  }

  /**
   * See: {@link ResourceDataBroker#resourceExists(String)}
   *
   * Checks if a resource in LanguageTool's {@code /resource} exists.
   * @param path Path to an item from the {@code /resource} directory.
   * @return {@code true} if the resource file exists.
   */
  resourceExists(path: string): boolean {
    const completePath = this.getCompleteResourceUrl(path);
    return this.known.has(completePath);
  }

  /**
   * See: {@link ResourceDataBroker#ruleFileExists(String)}
   *
   * Checks if a resource in LanguageTool's {@code /rules} exists.
   * @param path Path to an item from the {@code /rules} directory.
   * @return {@code true} if the resource file exists.
   */
  ruleFileExists(path: string): boolean {
    const completePath = this.getCompleteRulesUrl(path);
    return this.known.has(completePath);
  }

  /**
   * @return The directory's name of LanguageTool's resource directory.
   *         The default value equals {@link ResourceDataBroker#RESOURCE_DIR}.
   */
  getResourceDir(): string {
    return this.resourceDir;
  }

  /**
   * @return The directory's name of the grammar checker's rules directory.
   *         The default value equals {@link ResourceDataBroker#RULES_DIR}.
   */
  getRulesDir(): string {
    return this.rulesDir;
  }

  /**
   * {@inheritDoc}
   * @exception MissingResourceException if no resource bundle for the specified base name can be found
   */
  getResourceBundle(baseName: string, locale: Locale): ResourceBundle {
    return ResourceBundle.getBundle(baseName, locale, (name) => this.known.has('/' + name) ? this.getAsStream('/' + name) : null);
  }
}

