// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanTools.java faithful

export class GermanTools {

  private constructor() {
  }

  static isVowel(c: string): boolean {
    return 'aeiouyAEIOUYäöüÄÖÜ'.indexOf(c) >= 0;
  }

}
