// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/Category.java faithful
// The constructor overloads are one constructor with optional parameters.
import type { CategoryId } from './CategoryId.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

export const Location = {
  /** The rules in this category are part of the main distribution of
   * LanguageTool and are thus available on <a href="http://community.languagetool.org">community.languagetool.org</a>. */
  INTERNAL: 'INTERNAL',
  /** The rules in this category are not part of the main distribution of LanguageTool. */
  EXTERNAL: 'EXTERNAL',
} as const;
export type Location = typeof Location[keyof typeof Location];

/**
 * A rule's category. Categories are used to group rules for
 * a better overview.
 */
export class Category {

  static readonly Location = Location;

  private readonly name: string;
  private readonly id: CategoryId;
  private readonly location: Location;
  private readonly defaultOff: boolean;
  private readonly tabName: string | null;

  /** @since 3.3 (tabName since 4.3) */
  constructor(id: CategoryId, name: string, location: Location = Location.INTERNAL, onByDefault = true, tabName: string | null = null) {
    this.id = Objects_requireNonNull(id);
    this.name = Objects_requireNonNull(name);
    this.location = location;
    this.defaultOff = !onByDefault;
    this.tabName = tabName;
  }

  /** @since 3.3 */
  getId(): CategoryId {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  toString(): string {
    return this.name;
  }

  /** @since 4.3 */
  getTabName(): string | null {
    return this.tabName;
  }

  /**
   * Checks whether the category has been turned off
   * by default by the category author.
   * @return True if the category is turned off by default.
   */
  isDefaultOff(): boolean {
    return this.defaultOff;
  }

  /**
   * @since 2.8
   */
  getLocation(): Location {
    return this.location;
  }

}
