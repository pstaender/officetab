// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/CategoryId.java faithful
// hashCode is left out: sets and maps of category ids are keyed by toString().
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

/**
 * Identifier for a category.
 * @since 3.3
 */
export class CategoryId {

  private readonly id: string;

  constructor(id: string) {
    Objects_requireNonNull(id, 'Category id must not be null.');
    if (StringTrim(id).length === 0) {
      throw new Error("IllegalArgumentException: Category id must not be empty: '" + id + "'");
    }
    this.id = id;
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof CategoryId) || o.constructor !== this.constructor) return false;
    const other = o;
    return this.id === other.id;
  }

  toString(): string {
    return this.id;
  }
}
