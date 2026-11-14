// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/OldSpellingRule.java faithful
// AhoCorasickDoubleArrayTrie (com.hankcs) is AbstractDashRule's stand-in. DATA and CHARS are
// created on first use.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { Hit } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractDashRule.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { StringRegionMatches } from '../../../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import { SpellingData } from './SpellingData.ts';

/** StringUtils.replaceOnce */
function replaceOnce(text: string, searchString: string, replacement: string): string {
  const i = text.indexOf(searchString);
  return i < 0 ? text : text.substring(0, i) + replacement + text.substring(i + searchString.length);
}

const FILE_PATH = '/de/alt_neu.csv';
const EXCEPTIONS: readonly string[] = [
  'Schloß Holte',
  'Schloß Neuhaus',
  'Schloß Ricklingen',
  'Schloß-Nauses',
  'Schloß Rötteln',
  'Klinikum Schloß Winnenden',
  'Grazer Schloßberg',
  'Höchster Schloß',
  'Bell Telephone',
  'Telephone Company',
  'American Telephone',
  'England Telephone',
  'Mobile Telephone',
  'Cordless Telephone',
  'Telephone Line',
  'World Telephone',
  'Tip Top',
  'Hans Joachim Blaß',
  'kurz fassen'
];
let data: SpellingData | null = null;
const DATA = { get: (): SpellingData => data ??= new SpellingData(FILE_PATH) };
let chars: Pattern | null = null;
const CHARS = (): Pattern => chars ??= Pattern.compile('[a-zA-Zöäüß]');

/**
 * Finds spellings that were only correct in the pre-reform orthography.
 * @since 3.8
 */
export class OldSpellingRule extends Rule {

  private readonly language: Language;

  constructor(messages: ResourceBundle, language: Language) {
    super();
    this.language = language;
    this.setCategory(Categories.TYPOS.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
    this.addExamplePair(Example.wrong('Der <marker>Abfluß</marker> ist schon wieder verstopft.'),
                   Example.fixed('Der <marker>Abfluss</marker> ist schon wieder verstopft.'));
  }

  override getId(): string {
    return 'OLD_SPELLING_RULE';
  }

  override getDescription(): string {
    return 'Findet Schreibweisen, die nur in der alten Rechtschreibung gültig waren';
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const matches: RuleMatch[] = [];
    const text = sentence.getText();
    const hits = DATA.get().getTrie().parseText(text);
    const sentStartHits = DATA.get().getSentenceStartTrie().parseText(text);
    const startPositions = new Set<number>();
    hits.reverse();  // work on longest matches first
    for (const hit of hits) {
      if (startPositions.has(hit.begin)) {
        continue;   // avoid overlapping matches
      }
      if (!this.ignoreMatch(hit, text)) {
        this.addMatch(sentence, hit, matches);
        startPositions.add(hit.begin);
      }
    }
    for (const hit of sentStartHits) {
      if (startPositions.has(hit.begin)) {
        continue;   // avoid overlapping matches
      }
      if (hit.begin === 0 && !this.ignoreMatch(hit, text)) {   // e.g. "Läßt du das bitte", i.e. uppercase at start of sentence
        this.addMatch(sentence, hit, matches);
        break;  // there can only be one match at the start of a sentence
      }
    }
    return this.toRuleMatchArray(matches);
  }

  private addMatch(sentence: AnalyzedSentence, hit: Hit<string>, matches: RuleMatch[]): void {
    const message = 'Diese Schreibweise war nur in der alten Rechtschreibung korrekt.';
    const match = new RuleMatch(this, sentence, hit.begin, hit.end, message, 'Alte Rechtschreibung');
    const suggestions = hit.value.split('|');
    match.setSuggestedReplacements([...suggestions]);
    const covered = sentence.getText().substring(hit.begin, hit.end);
    if (suggestions.length > 0 && replaceOnce(suggestions[0]!, 'ss', 'ß') === covered) {
      if (this.language.getShortCodeWithCountryAndVariant() === 'de-AT' && covered.toLowerCase().includes('geschoß')) {
        // special case for Austria: "Geschoß" is correct in both old and new spelling in de-AT (because of the pronunciation)
        return;
      } else {
        match.setMessage(message + " Das Wort wird mit 'ss' geschrieben, wenn davor eine kurz gesprochene Silbe steht.");
      }
    }
    matches.push(match);
  }

  private ignoreMatch(hit: Hit<string>, text: string): boolean {
    for (const exception of EXCEPTIONS) {
      if (StringRegionMatches(text, true, hit.begin, exception, 0, exception.length) ||
        StringRegionMatches(text, true, hit.end - exception.length, exception, 0, exception.length)) {
        return true;
      }
    }
    if (hit.begin > 0 && !this.isBoundary(text.substring(hit.begin-1, hit.begin))) {  // prevent substring matches
      return true;
    }
    if (hit.end < text.length && !this.isBoundary(text.substring(hit.end, hit.end+1))) {  // prevent substring matches, e.g. "Foto" for "Photons"
      return true;
    }
    if (hit.begin-6 >= 0) {
      if (text.startsWith('Prof.', hit.begin-6)) {
        return true;
      }
    }
    if (hit.begin-5 >= 0) {
      const before5 = text.substring(hit.begin-5, hit.begin-1);
      if (before5 === 'Herr' || before5 === 'Frau') {
        return true;
      }
    }
    if (hit.begin-4 >= 0) {
      const before4 = text.substring(hit.begin-4, hit.begin-1);
      if (before4 === 'Hr.' || before4 === 'Fr.' || before4 === 'Dr.') {
        return true;
      }
    }
    return false;
  }

  private isBoundary(s: string): boolean {
    return !CHARS().matcher(s).matches();
  }
  
}
