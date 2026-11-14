// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/InsertCommaFilter.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { RuleFilter } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/RuleFilter.ts';
import { GermanTagger } from '../../tagging/de/GermanTagger.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const compile = (regex: string): Pattern => Pattern.compile(regex);

const WHITESPACE = compile('\\s');
const SAGT = compile('[Ss]agt?');
const DER_ETC = compile('der|die|das|seine|ihre|deine|unsere|meine|folgender|dieser');
const DENKE_ETC = compile('denke|dachte|glaube|schätze|vermute|behaupte');
const BEI_FUER_MIT = compile('bei|für|mit');
const DIR_ETC = compile('[Di]ir|[Dd]ich|[Ee]uer|[Ee]uch');

/**
 * Specific to {@code KOMMA_ZWISCHEN_HAUPT_UND_NEBENSATZ} - helps setting the comma suggestion, if easily possible.
 * @since 4.5
 */
export class InsertCommaFilter extends RuleFilter {

  override acceptRuleMatch(match: RuleMatch, _arguments: Map<string, string>, patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], _tokenPositions: number[] | null): RuleMatch | null {
    const ruleMatch = new RuleMatch(match.getRule(), match.getSentence(), match.getFromPos(), match.getToPos(), match.getMessage(), match.getShortMessage());
    const suggestions: string[] = [];
    for (const replacement of match.getSuggestedReplacements()) {
      const parts = WHITESPACE.split(replacement);
      if (parts.length === 2) {
        suggestions.push(parts[0] + ', ' + parts[1]);
      } else if (parts.length === 3) {
        const tags1 = InsertCommaFilter.getTag(0, parts);
        const tags2 = InsertCommaFilter.getTag(1, parts);
        const tags3 = InsertCommaFilter.getTag(2, parts);
        if (this.hasTag(tags1, 'VER:') && this.hasTag(tags2, 'PRO:PER:')) {
          // "Ich hoffe(,) es geht Ihnen gut."
          suggestions.push(parts[0] + ', ' + parts[1] + ' ' + parts[2]);
        } else if (SAGT.matcher(parts[0]!).matches() && parts[1] === 'mal' && this.hasTag(tags3, 'VER:')) {
          // "Sag mal(,) hast du"
          suggestions.push(parts[0] + ' ' + parts[1] + ', ' + parts[2]);
        } else if (this.hasTag(tags1, 'VER:') && this.hasTag(tags2, 'ADV:') && this.hasTag(tags3, 'VER:')) {
          // "Ich denke(,) hier kann aber auch ..."
          suggestions.push(parts[0] + ', ' + parts[1] + ' ' + parts[2]);
        }
      } else if (parts.length >= 4 && parts.length <= 7) {
        const tags1 = InsertCommaFilter.getTag(0, parts);
        const tags2 = InsertCommaFilter.getTag(1, parts);
        const tags3 = InsertCommaFilter.getTag(2, parts);
        const tags4 = InsertCommaFilter.getTag(3, parts);
        const rest1 = parts.slice(1, parts.length).join(' ');
        if (patternTokenPos <= 2 || (patternTokenPos === 3 && match.getSentence()!.getTokens().length >= 1 && match.getSentence()!.getTokens()[1]!.hasPosTagStartingWith('ADV:'))) {
          if (parts.length === 5 && this.hasTag(tags1, 'VER:') && this.hasTag(tags2, 'ART:') && this.hasTag(tags3, 'SUB:') && this.hasTag(InsertCommaFilter.getTag(3, parts), 'SUB:') && this.hasTag(InsertCommaFilter.getTag(4, parts), 'VER:')) {
            // "Ist der Kunde Verbraucher(,) gilt ..."
            suggestions.push(parts[0] + ' ' + parts[1] + ' ' + parts[2] + ' ' + parts[3] + ',');
          } else if (parts.length === 4 &&
            patternTokens[0]!.hasPosTagStartingWith('VER:') &&
            DER_ETC.matcher(patternTokens[1]!.getToken()).matches()) {
            // "Aristoteles meint(,) das Genussleben führe nicht zum Glück."
            suggestions.push(parts[0] + ', ' + rest1);
          } else if (this.hasTag(tags1, 'VER:') && this.hasTag(tags2, 'PRO:POS:') && this.hasTag(tags3, 'SUB:')) {
            // "Ich glaube(,) eure Premium-Accounts sind noch aktiv."
            suggestions.push(parts[0] + ', ' + rest1);
          } else if (this.hasTag(tags1, 'VER:') && this.hasTag(tags2, 'PRO:PER:') && this.hasTag(tags3, 'ADV:INR')) {
            // "Weißt du(,) warum diese Regel aus ist?"
            const rest2 = parts.slice(2, parts.length).join(' ');
            suggestions.push(parts[0] + ' ' + parts[1] + ', ' + rest2);
          } else if (this.hasTag(tags1, 'VER:') && this.hasTag(tags2, 'PRO:POS:') && this.hasTag(tags3, 'ADJ:')) {
            // "Ich glaube(,) eure individuellen Premium-Accounts sind noch aktiv."
            suggestions.push(parts[0] + ', ' + rest1);
          } else if (DENKE_ETC.matcher(parts[0]!).matches() && this.hasTag(tags2, 'PRO:DEM:') && this.hasTag(tags3, 'SUB:')) {
            // "Ich schätze(,) diese Krawatte passt gut zum Anzug."
            suggestions.push(parts[0] + ', ' + rest1);
          } else if (patternTokenPos === 1 && BEI_FUER_MIT.matcher(parts[1]!).matches() &&
                     DIR_ETC.matcher(parts[2]!).matches() && this.hasTag(tags4, 'VER:')) {
            // "Hoffe(,) bei euch ist alles gut."
            suggestions.push(parts[0] + ', ' + rest1);
          }
        }
      }
    }
    ruleMatch.setSuggestedReplacements(suggestions);
    ruleMatch.setType(match.getType());
    return ruleMatch;
  }

  private static getTag(i: number, parts: string[]): AnalyzedTokenReadings[] {
    return GermanTagger.INSTANCE.tag([parts[i]!]);
  }

  private hasTag(tags: AnalyzedTokenReadings[], tagStart: string): boolean {
    return tags.some((k) => k.hasPosTagStartingWith(tagStart));
  }
}

FilterRegistry.register('org.languagetool.rules.de.InsertCommaFilter', () => new InsertCommaFilter());
