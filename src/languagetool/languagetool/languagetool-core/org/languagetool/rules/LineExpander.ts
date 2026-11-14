// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/LineExpander.java faithful

export interface LineExpander {

  /**
   * Expand a line read from a file into several lines, e.g. to interpret flags like "/S".
   */
  expandLine(line: string): string[];

}
