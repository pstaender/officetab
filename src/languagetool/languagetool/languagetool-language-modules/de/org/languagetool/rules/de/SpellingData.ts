// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/SpellingData.java faithful
// AhoCorasickDoubleArrayTrie (com.hankcs) is AbstractDashRule's stand-in.
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import { AhoCorasickDoubleArrayTrie } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractDashRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { GermanSynthesizer } from '../../synthesis/GermanSynthesizer.ts';

const { startsWithLowercase, uppercaseFirstChar } = StringTools;

/**
 * Old to new spelling data and similar formats loaded from CSV.
 * @since 4.3
 */
export class SpellingData {

  private readonly trie = new AhoCorasickDoubleArrayTrie<string>();
  private readonly sentenceStartTrie = new AhoCorasickDoubleArrayTrie<string>();

  constructor(filePath: string) {
    this.trie.build(SpellingData.getCoherencyMap(filePath, false));
    this.sentenceStartTrie.build(SpellingData.getCoherencyMap(filePath, true));
  }

  private static getCoherencyMap(filePath: string, sentStartMode: boolean): Map<string, string> {
    const lines = JLanguageTool.getDataBroker().getFromResourceDirAsLines(filePath);
    const coherencyMap = new Map<string, string>();
    for (const line of lines) {
      if (line.startsWith('#')) {
        continue;
      }
      const parts = line.split(';');
      if (parts.length < 2) {
        throw new Error('Unexpected format in file ' + filePath + ': ' + line);
      }
      const oldSpelling = parts[0]!;
      const newSpelling = parts[1]!;
      SpellingData.sanityChecks(filePath, line, oldSpelling, newSpelling, coherencyMap);
      if (sentStartMode && startsWithLowercase(oldSpelling) && startsWithLowercase(newSpelling)) {
        // lowercase words can be uppercase at sentence start:
        coherencyMap.set(uppercaseFirstChar(oldSpelling)!, uppercaseFirstChar(newSpelling)!);
      } else {
        coherencyMap.set(oldSpelling, newSpelling);
      }
      if (oldSpelling.includes('ß') && oldSpelling.replaceAll('ß', 'ss') === newSpelling) {
        const forms = GermanSynthesizer.INSTANCE.synthesizeForPosTags(oldSpelling, (_s) => true);
        for (const form of forms) {
          if (!form.includes('ss')) {  // avoid e.g. "Schlüsse" as form of "Schluß", as that's the new spelling
            coherencyMap.set(form, form.replaceAll('ß', 'ss'));
          }
        }
      }
    }
    return coherencyMap;
  }

  private static sanityChecks(filePath: string, line: string, oldSpelling: string, newSpelling: string, coherencyMap: Map<string, string>): void {
    if (oldSpelling === newSpelling) {
      throw new Error('Old and new spelling are the same in ' + filePath + ': ' + line);
    }
    const lookup = coherencyMap.get(newSpelling);
    if (lookup != null && lookup === oldSpelling) {
      throw new Error('Contradictory entry in ' + filePath + ": '" + oldSpelling + "' suggests '" + lookup + "' and vice versa");
    }
    if (coherencyMap.has(oldSpelling) && coherencyMap.get(oldSpelling) !== newSpelling) {
      throw new Error('Duplicate key in ' + filePath + ': ' + oldSpelling + ', val: ' + coherencyMap.get(oldSpelling) + ' vs. ' + newSpelling);
    }
  }

  getTrie(): AhoCorasickDoubleArrayTrie<string> {
    return this.trie;
  }

  getSentenceStartTrie(): AhoCorasickDoubleArrayTrie<string> {
    return this.sentenceStartTrie;
  }

}
