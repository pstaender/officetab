// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/CompoundCheckFilter.java faithful
// MostlySingularMultiMap (a memory-saving Map<K, List<V>>) is a Map of arrays; StringInterner.intern
// is the identity; the Scanner reading the file line by line is a split of the decoded text.
// The Lazy holder is a module variable loaded on first use.
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { RuleFilter } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/RuleFilter.ts';
import { StringTrim } from '../../../../../../../jdk/java/lang/Character.ts';
import { StringReplaceAll, StringSplit } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const FILE_ENCODING = 'utf-8';

let relevantWords: Map<string, string[]> | null = null;  // Lazy.relevantWords

export class CompoundCheckFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, arguments_: Map<string, string>, _patternTokenPos: number,
                           _patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[]): RuleMatch | null {

    const part1 = arguments_.get('part1')!.toLowerCase();
    const part2 = arguments_.get('part2')!.toLowerCase();
    relevantWords ??= CompoundCheckFilter.loadWords('/de/addedCompound.txt');
    const list = relevantWords.get(part1);
    return list != null && list.includes(part2) ? match : null;
  }

  private static loadWords(path: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const inputStream = JLanguageTool.getDataBroker().getFromRulesDirAsStream(path);
    const scanner = new TextDecoder(FILE_ENCODING).decode(inputStream).split(/\r\n|[\n\r\u2028\u2029\u0085]/);
    for (const nextLine of scanner) {
      const line = StringTrim(StringReplaceAll(nextLine, '#.*$', '')); // replace comments
      if (line.length === 0) {
        continue;
      }
      const parts = StringSplit(line, ';');
      if (parts.length !== 2) {
        throw new Error('RuntimeException: Format error in file ' + path + ', line: '
                + line + ', ' + 'expected 2 semicolon-separated parts, got '
                + parts.length);
      }
      const part0 = StringTrim(parts[0]!).toLowerCase();
      const part1 = StringTrim(parts[1]!).toLowerCase();
      let list = map.get(part0);
      if (list === undefined) {
        list = [];
        map.set(part0, list);
      }
      list.push(part1);
    }
    return map;
  }
}

FilterRegistry.register('org.languagetool.rules.de.CompoundCheckFilter', () => new CompoundCheckFilter());
