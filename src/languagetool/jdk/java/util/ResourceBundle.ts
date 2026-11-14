// SPDX-License-Identifier: MPL-2.0
// java.util.ResourceBundle for the LanguageTool ports: not a port, the JDK's API as they use it.
// getBundle looks up "<baseName>_<locale>.properties" through a loader function (the ports pass
// the ResourceDataBroker) instead of the class path, with Java's candidate list (language,
// country, variant, then the default locale, then the base bundle) and parent chain.
// .properties files are read as UTF-8 (as PropertyResourceBundle does since Java 9), falling back
// to ISO 8859-1 if they are not valid UTF-8.
import { Locale } from './Locale.ts';
import { Properties } from './Properties.ts';

export class MissingResourceException extends Error {
  private readonly className: string;
  private readonly key: string;
  constructor(s: string, className: string, key: string) {
    super(s);
    this.name = 'MissingResourceException';
    this.className = className;
    this.key = key;
  }
  getClassName(): string { return this.className; }
  getKey(): string { return this.key; }
}

/** Reads a resource by its path ("org/languagetool/MessagesBundle_en.properties"); null if missing. */
export type ResourceLoader = (path: string) => Uint8Array | null;

export abstract class ResourceBundle {
  protected parent: ResourceBundle | null = null;
  private locale: Locale = Locale.ROOT;

  /** The value for the key in this bundle only, or null. (Protected in Java.) */
  abstract handleGetObject(key: string): unknown;

  /** The keys of this bundle and its parents. */
  abstract getKeys(): Iterable<string>;

  getString(key: string): string {
    return this.getObject(key) as string;
  }

  getObject(key: string): unknown {
    let obj: unknown = this.handleGetObject(key);
    if (obj == null) {
      if (this.parent != null) obj = this.parent.getObject(key);
      if (obj == null) {
        throw new MissingResourceException("Can't find resource for bundle " + this.constructor.name + ', key ' + key, this.constructor.name, key);
      }
    }
    return obj;
  }

  containsKey(key: string): boolean {
    for (let rb: ResourceBundle | null = this; rb != null; rb = rb.parent) {
      if (rb.handleKeySet().has(key)) return true;
    }
    return false;
  }

  /** The keys of this bundle only: those of getKeys() for which handleGetObject is not null. */
  protected handleKeySet(): Set<string> {
    const keys = new Set<string>();
    for (const key of this.getKeys()) {
      if (this.handleGetObject(key) != null) keys.add(key);
    }
    return keys;
  }

  keySet(): Set<string> { return new Set(this.getKeys()); }

  getLocale(): Locale { return this.locale; }

  protected setParent(parent: ResourceBundle | null): void { this.parent = parent; }

  private static readonly cache = new Map<string, ResourceBundle | null>();

  /** Forgets the bundles read so far (after the loader's data changed). */
  static clearCache(): void { ResourceBundle.cache.clear(); }

  /**
   * ResourceBundle.getBundle(baseName, locale): baseName is a dotted name
   * ("org.languagetool.MessagesBundle"), resolved to "org/languagetool/MessagesBundle_xx.properties".
   */
  static getBundle(baseName: string, locale: Locale, loader: ResourceLoader): ResourceBundle {
    const candidates = (l: Locale): Locale[] => {
      const list: Locale[] = [];
      if (l.getVariant() !== '') list.push(new Locale(l.getLanguage(), l.getCountry(), l.getVariant()));
      if (l.getCountry() !== '') list.push(new Locale(l.getLanguage(), l.getCountry()));
      if (l.getLanguage() !== '') list.push(new Locale(l.getLanguage()));
      list.push(Locale.ROOT);
      return list;
    };
    const load = (l: Locale): ResourceBundle | null => {
      const name = baseName.replace(/\./g, '/') + (l.toString() === '' ? '' : '_' + l.toString()) + '.properties';
      const key = name;
      if (ResourceBundle.cache.has(key)) return ResourceBundle.cache.get(key)!;
      const bytes = loader(name);
      const bundle = bytes == null ? null : new PropertyResourceBundle(bytes);
      if (bundle) bundle.setLocale(l);
      ResourceBundle.cache.set(key, bundle);
      return bundle;
    };
    const chain = (list: Locale[]): ResourceBundle | null => {
      let first: ResourceBundle | null = null;
      let last: ResourceBundle | null = null;
      for (const l of list) {
        const b = load(l);
        if (b == null) continue;
        // a fresh link, so that the cached bundles' parents are not changed
        const link = new ChainedBundle(b);
        if (last) last.setParent(link); else first = link;
        last = link;
      }
      return first;
    };
    let result = chain(candidates(locale));
    // only the base bundle found: try the default locale first, as Java does
    if ((result == null || result.getLocale().getLanguage() === '') && !Locale.getDefault().equals(locale)) {
      const fromDefault = chain(candidates(Locale.getDefault()));
      if (fromDefault != null && fromDefault.getLocale().getLanguage() !== '') result = fromDefault;
    }
    if (result == null) {
      throw new MissingResourceException("Can't find bundle for base name " + baseName + ', locale ' + locale.toString(), baseName + '_' + locale.toString(), '');
    }
    return result;
  }

  /** @internal used by getBundle */
  protected setLocale(locale: Locale): void { this.locale = locale; }
}

/** java.util.PropertyResourceBundle: a bundle read from a .properties file. */
export class PropertyResourceBundle extends ResourceBundle {
  private readonly lookup: Map<string, string>;

  constructor(input: Uint8Array | string) {
    super();
    const props = new Properties();
    if (typeof input === 'string') {
      props.load(input);
    } else {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(input);
      } catch {
        text = new TextDecoder('iso-8859-1').decode(input);
      }
      props.load(text);
    }
    this.lookup = new Map();
    for (const key of props.stringPropertyNames()) this.lookup.set(key, props.getProperty(key)!);
  }

  handleGetObject(key: string): unknown { return this.lookup.get(key) ?? null; }

  getKeys(): Iterable<string> {
    const keys = new Set(this.lookup.keys());
    if (this.parent) for (const k of this.parent.getKeys()) keys.add(k);
    return keys;
  }
}

/** One link of a bundle chain returned by getBundle (the cached bundle with its parent). */
class ChainedBundle extends ResourceBundle {
  private readonly bundle: ResourceBundle;
  constructor(bundle: ResourceBundle) {
    super();
    this.bundle = bundle;
    this.setLocale(bundle.getLocale());
  }
  handleGetObject(key: string): unknown {
    return this.bundle.handleGetObject(key);
  }
  override setParent(parent: ResourceBundle | null): void { super.setParent(parent); }
  getKeys(): Iterable<string> {
    const keys = new Set(this.bundle.getKeys());
    if (this.parent) for (const k of this.parent.getKeys()) keys.add(k);
    return keys;
  }
}
