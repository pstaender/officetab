// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/CompoundRuleData.java faithful
// The three constructors are one: (path...) or (expander, path...).
import { JLanguageTool } from '../JLanguageTool.ts';
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { StringReplaceFirst, StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';
import type { LineExpander } from './LineExpander.ts';

/** AbstractCompoundRule.MAX_TERMS (not imported, to keep this module free of Rule). */
const MAX_TERMS = 5;

/**
 * Data about words that are compounds and should thus not be written
 * as separate words.
 * @since 3.0
 */
export class CompoundRuleData {

  private readonly incorrectCompounds = new Set<string>();
  private readonly joinedSuggestion = new Set<string>();
  private readonly joinedLowerCaseSuggestion = new Set<string>();
  private readonly dashSuggestion = new Set<string>();
  private readonly expander: LineExpander | null;
  private _hasDigitPatterns = false;

  constructor(expanderOrPath: LineExpander | string | null, ...paths: string[]) {
    if (typeof expanderOrPath === 'string') {
      paths = [expanderOrPath, ...paths];
      this.expander = null;
    } else {
      this.expander = expanderOrPath;
    }
    for (const path of paths) {
      try {
        this.loadCompoundFile(path);
      } catch (e) {
        throw new Error('RuntimeException: Could not load compound data from ' + path, { cause: e });
      }
    }
  }

  getIncorrectCompounds(): ReadonlySet<string> {
    return this.incorrectCompounds;
  }

  getJoinedSuggestion(): ReadonlySet<string> {
    return this.joinedSuggestion;
  }

  getDashSuggestion(): ReadonlySet<string> {
    return this.dashSuggestion;
  }

  getJoinedLowerCaseSuggestion(): ReadonlySet<string> {
    return this.joinedLowerCaseSuggestion;
  }

  hasDigitPatterns(): boolean {
    return this._hasDigitPatterns;
  }

  private loadCompoundFile(path: string): void {
    const lines = JLanguageTool.getDataBroker().getFromResourceDirAsLines(path);
    for (let line of lines) {
      if (line.length === 0 || line.startsWith('#')) {
        continue;     // ignore comments
      }
      line = StringTrim(StringReplaceFirst(line, '#.*$', ''));
      let expandedLines: string[] = [];
      if (this.expander != null) {
        expandedLines = this.expander.expandLine(line);
      } else {
        expandedLines.push(line);
      }
      for (let expLine of expandedLines) {
        expLine = expLine.replaceAll('-', ' ');  // the set contains the incorrect spellings, i.e. the ones without hyphen
        this.validateLine(path, expLine);
        if (expLine.endsWith('+')) {
          expLine = this.removeLastCharacter(expLine);
          this.joinedSuggestion.add(expLine);
        } else if (expLine.endsWith('*')) {
          expLine = this.removeLastCharacter(expLine);
          this.dashSuggestion.add(expLine);
        } else if (expLine.endsWith('?')) { // github issue #779
          expLine = this.removeLastCharacter(expLine);
          this.joinedSuggestion.add(expLine);
          this.joinedLowerCaseSuggestion.add(expLine);
        } else if (expLine.endsWith('$')) { // github issue #779
          expLine = this.removeLastCharacter(expLine);
          this.joinedSuggestion.add(expLine);
          this.dashSuggestion.add(expLine);
          this.joinedLowerCaseSuggestion.add(expLine);
        } else {
          this.joinedSuggestion.add(expLine);
          this.dashSuggestion.add(expLine);
        }
        this.incorrectCompounds.add(expLine);
        if (expLine.includes('\\d')) {
          this._hasDigitPatterns = true;
        }
      }
    }
  }

  private validateLine(path: string, line: string): void {
    const parts = StringSplit(line, ' ');
    if (parts.length === 1) {
      throw new Error('IllegalArgumentException: Not a compound in file ' + path + ': ' + line);
    }
    if (parts.length > MAX_TERMS) {
      throw new Error('IllegalArgumentException: Too many compound parts in file ' + path + ': ' + line + ', maximum allowed: ' + MAX_TERMS);
    }
    if (this.incorrectCompounds.has(line.toLowerCase())) {
      throw new Error('IllegalArgumentException: Duplicated word in file ' + path + ': ' + line);
    }
  }

  private removeLastCharacter(str: string): string {
    return str.substring(0, str.length - 1);
  }

}
