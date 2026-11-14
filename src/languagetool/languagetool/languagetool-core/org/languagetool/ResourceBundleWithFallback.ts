// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/ResourceBundleWithFallback.java faithful
// hashCode is left out.
import { ResourceBundle } from '../../../../jdk/java/util/ResourceBundle.ts';
import { StringTrim } from '../../../../jdk/java/lang/Character.ts';
import { Objects_equals } from '../../../../jdk/java/util/Objects.ts';

/**
 * A resource bundle that uses its fallback resource bundle if the
 * value from the original bundle is null or empty.
 */
export class ResourceBundleWithFallback extends ResourceBundle {

  private readonly bundle: ResourceBundle;
  private readonly fallbackBundle: ResourceBundle;

  constructor(bundle: ResourceBundle, fallbackBundle: ResourceBundle) {
    super();
    this.bundle = bundle;
    this.fallbackBundle = fallbackBundle;
    this.setLocale(bundle.getLocale());
  }

  override handleGetObject(key: string): unknown {
    const s = this.bundle.getString(key);
    if (StringTrim(s).length === 0) {
      return this.fallbackBundle.getString(key);
    }
    return s;
  }

  override getKeys(): Iterable<string> {
    return this.bundle.getKeys();
  }

  equals(o: unknown): boolean {
    if (o === this) return true;
    if (!(o instanceof ResourceBundleWithFallback)) return false;
    const that = o;
    return Objects_equals(this.bundle, that.bundle) && Objects_equals(this.fallbackBundle, that.fallbackBundle);
  }
}
