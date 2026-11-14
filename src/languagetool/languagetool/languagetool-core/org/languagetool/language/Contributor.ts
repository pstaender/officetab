// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/language/Contributor.java faithful
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

/**
 * A person that contributed rules or code to LanguageTool.
 */
export class Contributor {

  private readonly name: string;
  private readonly url: string | null;

  /**
   * @param name full name
   * @param url URL to homepage or similar (optional)
   */
  constructor(name: string, url: string | null = null) {
    this.name = Objects_requireNonNull(name, 'name cannot be null');
    this.url = url;
  }

  getName(): string {
    return this.name;
  }

  getUrl(): string | null {
    return this.url;
  }

  toString(): string {
    return this.name;
  }
}
