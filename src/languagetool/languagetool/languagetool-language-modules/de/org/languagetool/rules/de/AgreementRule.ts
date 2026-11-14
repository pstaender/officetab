// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/AgreementRule.java faithful
// The nested enums are exported: GrammarCategory (with a display name) as a class with static
// instances, ReplacementType as a const object; both are also static members of AgreementRule.
// allAntiPatterns is collected on first use. The three getCompoundError overloads are one method
// told apart by their arguments (see there). Import cycles: AgreementTools and AgreementSuggestor2
// read GrammarCategory / ReplacementType only inside methods, so either may be loaded first.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { German } from '../../language/German.ts';
import { POSType } from '../../tagging/de/GermanToken.ts';
import { AgreementRuleAntiPatterns1 } from './AgreementRuleAntiPatterns1.ts';
import { AgreementRuleAntiPatterns2 } from './AgreementRuleAntiPatterns2.ts';
import { AgreementRuleAntiPatterns3 } from './AgreementRuleAntiPatterns3.ts';
import { AgreementSuggestor2 } from './AgreementSuggestor2.ts';
import { AgreementTools } from './AgreementTools.ts';
import { hasReadingOfType } from './GermanHelper.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import { StringUtils_isNumeric } from '../../../../../../../jdk/java/lang/Exceptions.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const startsWithUppercase = (str: string): boolean => StringTools.startsWithUppercase(str);

/** StringUtils.equalsAny */
const StringUtils_equalsAny = (s: string, ...searchStrings: string[]): boolean => searchStrings.includes(s);
/** StringUtils.endsWithAny */
const StringUtils_endsWithAny = (s: string, ...searchStrings: string[]): boolean => searchStrings.some((k) => s.endsWith(k));

const MIT_MIR_ETC = Pattern.compile('mit (mir|dir|ihm|ihr|ihnen|uns|euch)');
const OHNE_MICH_ETC = Pattern.compile('ohne (mich|dich|ihn|sie|uns|euch)');
const ZUGESCHRIEBENEN_GENANNTEN = Pattern.compile('zugeschriebenen?|genannten?');
const VIEL_WEIT = Pattern.compile('viel|weit');
const WENIGER_EHER = Pattern.compile('weniger|eher');
const HERR_FRAU = Pattern.compile('Herr|Frau');

export class GrammarCategory {
  static readonly KASUS = new GrammarCategory("Kasus (Fall: Wer/Was, Wessen, Wem, Wen/Was - Beispiel: 'das Fahrrads' statt 'des Fahrrads')");
  static readonly GENUS = new GrammarCategory("Genus (männlich, weiblich, sächlich - Beispiel: 'der Fahrrad' statt 'das Fahrrad')");
  static readonly NUMERUS = new GrammarCategory("Numerus (Einzahl, Mehrzahl - Beispiel: 'das Fahrräder' statt 'die Fahrräder')");

  readonly displayName: string;
  private constructor(displayName: string) {
    this.displayName = displayName;
  }
}
const INS_REPLACEMENT = [new AnalyzedToken('das', 'ART:DEF:AKK:SIN:NEU', 'das')];
const ZUR_REPLACEMENT = [new AnalyzedToken('der', 'ART:DEF:DAT:SIN:FEM', 'der')];

export const ReplacementType = {
  Ins: 'Ins', Zur: 'Zur',
} as const;
export type ReplacementType = typeof ReplacementType[keyof typeof ReplacementType];

/*
private static final String MSG = "Möglicherweise fehlende grammatische Übereinstimmung " +
  "von Kasus, Numerus oder Genus. Beispiel: 'mein kleiner Haus' statt 'mein kleines Haus'";
private static final String MSG2 = "Möglicherweise fehlende grammatische Übereinstimmung " +
  "von Kasus, Numerus oder Genus. Beispiel: 'mein schönes kleiner Haus' statt 'mein schönes kleines Haus'";
private static final String SHORT_MSG = "Evtl. keine Übereinstimmung von Kasus, Numerus oder Genus";
*/

const MSG = 'Möglicherweise passen das Nomen und die Wörter, die das Nomen beschreiben, grammatisch nicht zusammen.';
const MSG2 = 'Möglicherweise passen das Nomen und die Wörter, die das Nomen beschreiben, grammatisch nicht zusammen.';
const SHORT_MSG = 'Evtl. passen Wörter grammatisch nicht zusammen.';

const MODIFIERS = new Set<string>([
  'zu',
  'überraschend',
  'ungeahnt',
  'absolut',
  'ausgesprochen',
  'außergewöhnlich',
  'außerordentlich',
  'äußerst',
  'besonders',
  'dringend',
  'echt',
  'einigermaßen',
  'enorm',
  'extrem',
  'fast',
  'ganz',
  'entschieden',
  'geradezu',
  'zeitweise',
  'halbwegs',
  'höchst',
  'komplett',
  'laufend',
  'recht',
  'relativ',
  'sehr',
  'total',
  'überaus',
  'ungewöhnlich',
  'unglaublich',
  //"viel",    // "xxx, die viel Platz..."
  'völlig',
  'weit',
  'wirklich',
  'gerade',
  'vereint',
  'überwiegend',
  'gewollt',
  'angestrengt',
  'ziemlich',
]);

const VIELE_WENIGE_LOWERCASE = new Set<string>([
  'manche',
  'jegliche',
  'jeglicher',
  'andere',
  'anderer',
  'anderen',
  'sämtliche',
  'sämtlicher',
  'etliche',
  'etlicher',
  'viele',
  'vieler',
  'wenige',
  'weniger',
  'einige',
  'einiger',
  'mehrerer',
  'mehrere',
]);

const REL_PRONOUN_LEMMAS = ['der', 'welch'];

const PRONOUNS_TO_BE_IGNORED = new Set<string>([
  'nichts',
  'alles',   // "Ruhe vor dem alles verheerenden Sturm", "Alles Große und Edle ist einfacher Art."
  'dies',
  'ebendies',
  'ich',
  'dir',
  'dich',
  'du',
  'd',
  'er', 'sie', 'es',
  'wir',
  'mich',
  'mir',
  'uns',
  'ihnen',
  'euch',
  'ihm',
  'ihr',
  'ihn',
  'dessen',
  'deren',
  'denen',
  'sich',
  'aller',
  'allen',  // "das allen bekannte Wollnashorn"
  'man',
  'beide',
  'beiden',
  'beider',
  'wessen',
  'a',
  'alle',
  'etwas',
  'irgendetwas',
  'irgendwas',
  'irgendwer',
  'was',
  'wer',
  'wem',
  'jenen',      // "...und mit jenen anderer Arbeitsgruppen verwoben"
  'diejenigen',
  'irgendjemand', 'irgendjemandes',
  'jemand', 'jemandes',
  'niemand', 'niemandes',
]);

const NOUNS_TO_BE_IGNORED = new Set<string>([
  'A',
  'Prozent',   // Plural "Prozente", trotzdem ist "mehrere Prozent" korrekt
  'Wollen',  // das Wollen
  'Gramm',
  'Kilogramm',
  'Flippers', // Band, die Flippers
  'Standart', // Caught by speller
  'Stellungsname', // Caught by speller
  'Kündigungsscheiben', // Caught by speller
  'Piepen', // Die Piepen
  'Badlands',
  'Visual', // englisch
  'Special', // englisch
  'Multiple', // englisch
  'Chief', // Chief Executive Officer
  'Carina', // Name
  'Wüstenrot', // Name
  'Rückgrad', // found by speller
  'Rückgrads', // found by speller
  'Anteilname', // found by speller
  'Aalen', // Plural form of "Aal" but also large city in Germany
  'Meter', // Das Meter (Objekt zum Messen)
  'Boots', // "Die neuen Boots" (englisch Stiefel)
  'Taxameter', // Beides erlaubt "Das" und "Die"
  'Bild', // die Bild (Zeitung)
  'Emirates', // "Mit einem Flug der Emirates" (Fluggesellschaft)
  'Uhr',   // "um ein Uhr"
  'cm', // "Die letzten cm" können
  'km',
  'Nr',
  'KSC', // Abk
  'ANC', // Abk
  'DJK', // Der DJK Schweinfurt
  'RP', // "Die RP (Rheinische Post)"
]);

let allAntiPatternsValue: PatternToken[][] | null = null;
function allAntiPatterns(): PatternToken[][] {
  return (allAntiPatternsValue ??=
    [AgreementRuleAntiPatterns1.ANTI_PATTERNS, AgreementRuleAntiPatterns2.ANTI_PATTERNS, AgreementRuleAntiPatterns3.ANTI_PATTERNS]
      .flat());
}

/** Set.retainAll */
function retainAll(set: Set<string>, other: ReadonlySet<string>): void {
  for (const s of set) {
    if (!other.has(s)) {
      set.delete(s);
    }
  }
}

/**
 * Simple agreement checker for German noun phrases. Checks agreement in:
 *
 * <ul>
 *  <li>DET/PRO NOUN: e.g. "mein Auto", "der Mann", "die Frau" (correct), "die Haus" (incorrect)</li>
 *  <li>DET/PRO ADJ NOUN: e.g. "der riesige Tisch" (correct), "die riesigen Tisch" (incorrect)</li>
 *  <li>DET/PRO ADJ ADJ NOUN: e.g. "der große riesige Tisch" (correct), "die große riesige Tisch" (incorrect)</li>
 * </ul>
 *
 * Note that this rule only checks agreement inside the noun phrase, not whether
 * e.g. the correct case is used. For example, "Es ist das Haus dem Mann" is not
 * detected as incorrect.
 *
 * <p>TODO: the implementation could use a re-write that first detects the relevant noun phrases and then checks agreement
 *
 * @author Daniel Naber
 */
export class AgreementRule extends Rule {

  static readonly GrammarCategory = GrammarCategory;
  static readonly ReplacementType = ReplacementType;

  private readonly language: German;
  private readonly antiPatterns: () => DisambiguationPatternRule[];

  private lt: JLanguageTool | null = null;

  constructor(messages: ResourceBundle, language: German) {
    super();
    this.language = language;
    this.setCategory(Categories.GRAMMAR.getCategory(messages));
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/de/beitrag/deklination/'));
    this.addExamplePair(Example.wrong('<marker>Der Haus</marker> wurde letztes Jahr gebaut.'),
                   Example.fixed('<marker>Das Haus</marker> wurde letztes Jahr gebaut.'));
    this.antiPatterns = AgreementRule.cacheAntiPatterns(language, allAntiPatterns());
  }

  override getId(): string {
    return 'DE_AGREEMENT';
  }

  override estimateContextForSureMatch(): number {
    return allAntiPatterns().reduce((max, l) => Math.max(max, l.length), 0);
  }

  override getDescription(): string {
    return "Kongruenz von Nominalphrasen (unvollständig!), z.B. 'mein kleiner (kleines) Haus'";
  }

  private replacePrepositionsByArticle(tokens: AnalyzedTokenReadings[]): Map<number, ReplacementType> {
    const map = new Map<number, ReplacementType>();
    for (let i = 0; i < tokens.length; i++) {
      if (StringUtils_equalsAny(tokens[i]!.getToken(), 'ins', 'ans', 'aufs', 'vors', 'durchs', 'hinters', 'unters', 'übers', 'fürs', 'ums')) {
        tokens[i] = new AnalyzedTokenReadings(INS_REPLACEMENT, tokens[i]!.getStartPos());
        map.set(i, ReplacementType.Ins);
      } else if (StringUtils_equalsAny(tokens[i]!.getToken(), 'zur')) {
        tokens[i] = new AnalyzedTokenReadings(ZUR_REPLACEMENT, tokens[i]!.getStartPos());
        map.set(i, ReplacementType.Zur);
      }
    }
    return map;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
    const origTokens = [...tokens];
    const replMap = this.replacePrepositionsByArticle(tokens);
    for (let i = 0; i < tokens.length; i++) {
      const posToken = tokens[i]!.getAnalyzedToken(0).getPOSTag();  //TODO: check for all readings?
      if (JLanguageTool.SENTENCE_START_TAGNAME === posToken || tokens[i]!.isImmunized() || origTokens[i]!.isImmunized()) {
        continue;
      }
      if (this.couldBeRelativeOrDependentClause(tokens, i)) {
        continue;
      }
      if (i > 0) {
        const prevToken = tokens[i - 1]!.getToken().toLowerCase();
        if (StringUtils_equalsAny(prevToken, 'der', 'die', 'das', 'des', 'dieses') &&
            StringUtils_equalsAny(tokens[i]!.getToken(), 'eine', 'einen')) {
          // z.B. "Auf der einen Seite endlose Dünen"
          // TODO: "der eine Polizist" -> nicht ignorieren, sondern "der polizist" checken; "auf der einen Seite"
          // TODO: "Leute, die eine gewissen Sicherheit brauchen." -> nicht ignorieren
          continue;
        }
      }
      // avoid false alarm on "nichts Gutes" and "alles Gute"
      const tokenReadings = tokens[i]!;
      // avoid false alarm on "Art. 1" and "bisherigen Art. 1" (Art. = Artikel):
      const detAbbrev = i < tokens.length - 2 && tokens[i + 1]!.getToken() === 'Art' && tokens[i + 2]!.getToken() === '.';
      const detAdjAbbrev = i < tokens.length - 3 && tokens[i + 2]!.getToken() === 'Art' && tokens[i + 3]!.getToken() === '.';
      // "einen Hochwasser führenden Fluss", "die Gott zugeschriebenen Eigenschaften":
      const followingParticiple = i < tokens.length - 3 && (tokens[i + 2]!.hasPartialPosTag('PA1') || ZUGESCHRIEBENEN_GENANNTEN.matcher(tokens[i + 2]!.getToken()).matches());
      if (detAbbrev || detAdjAbbrev || followingParticiple) {
        continue;
      }
      if (hasReadingOfType(tokenReadings, POSType.DETERMINER) || this.isRelevantPronoun(tokens, i)) {
        const tokenPosAfterModifier = this.getPosAfterModifier(i + 1, tokens);
        let skippedStr: string | null = null;
        if (tokenPosAfterModifier > i + 1) {
          skippedStr = sentence.getText().substring(tokens[i + 1]!.getStartPos(), tokens[tokenPosAfterModifier - 1]!.getEndPos());
        }
        let tokenPos = tokenPosAfterModifier;
        if (tokenPos >= tokens.length) {
          break;
        }
        const nextToken = tokens[tokenPos]!;
        let maybePreposition = i - 1 >= 0 ? tokens[i - 1]! : null;
        if (i - 2 >= 0 && StringEqualsIgnoreCase('was', tokens[i - 2]!.getToken())) {
          maybePreposition = null;  // avoid preposition filtering on "Was für eine schöner Sonnenuntergang!"
        }
        if (this.isNonPredicativeAdjective(nextToken) || this.isParticiple(nextToken)) {
          tokenPos = tokenPosAfterModifier + 1;
          if (tokenPos >= tokens.length) {
            break;
          }
          if (hasReadingOfType(tokens[tokenPos]!, POSType.NOMEN)) {
            // TODO: add a case (checkAdjNounAgreement) for special cases like "deren",
            // e.g. "deren komisches Geschenke" isn't yet detected as incorrect
            if (i >= 2 && hasReadingOfType(tokens[i - 2]!, POSType.ADJEKTIV)
                       && 'als' === tokens[i - 1]!.getToken()
                       && 'das' === tokens[i]!.getToken()) {
              // avoid false alarm for e.g. "weniger farbenprächtig als das anderer Papageien"
              continue;
            }
            const allowSuggestion = tokenPos === i + 2;  // prevent incomplete suggestion for e.g. "einen 142 Meter hoher Obelisken" (-> "einen hohen Obelisken")
            const ruleMatch = this.checkDetAdjNounAgreement(maybePreposition, tokens[i]!,
                nextToken, tokens[tokenPos]!, sentence, i, allowSuggestion ? replMap : null, skippedStr);
            if (ruleMatch != null) {
              ruleMatches.push(ruleMatch);
            }
          } else if (tokenPos + 1 < tokens.length && hasReadingOfType(tokens[tokenPos + 1]!, POSType.NOMEN) && hasReadingOfType(tokens[tokenPos]!, POSType.ADJEKTIV)) {
            const ruleMatch = this.checkDetAdjAdjNounAgreement(maybePreposition, tokens[i]!,
              nextToken, tokens[tokenPos]!, tokens[tokenPos + 1]!, sentence, i, replMap, skippedStr);
            if (ruleMatch != null) {
              ruleMatches.push(ruleMatch);
            }
          }
        } else if (hasReadingOfType(nextToken, POSType.NOMEN) && 'Herr' !== nextToken.getToken()) {
          const ruleMatch = this.checkDetNounAgreement(maybePreposition, tokens[i]!, nextToken, sentence, i, replMap, skippedStr);
          if (ruleMatch != null) {
            ruleMatches.push(ruleMatch);
          }
        }
      }
    } // for each token
    return this.toRuleMatchArray(ruleMatches);
  }

  /**
   * Search for modifiers (such as "sehr", "1,4 Meter") which can expand a
   * determiner - adjective - noun group ("ein hohes Haus" -> "ein sehr hohes Haus",
   * "ein 500 Meter hohes Haus") and return the index of the first non-modifier token ("Haus")
   * @param startAt index of array where to start searching for modifier
   * @return index of first non-modifier token
   */
  private getPosAfterModifier(startAt: number, tokens: AnalyzedTokenReadings[]): number {
    if (startAt < tokens.length && tokens[startAt]!.getToken() === 'relativ' && startAt + 1 < tokens.length && tokens[startAt + 1]!.getToken() === 'gesehen') {
      startAt += 2;
    }
    if (startAt < tokens.length && VIEL_WEIT.matcher(tokens[startAt]!.getToken()).matches() && startAt + 1 < tokens.length && WENIGER_EHER.matcher(tokens[startAt + 1]!.getToken()).matches()) {
      startAt += 2;
    } else if (startAt + 1 < tokens.length && MODIFIERS.has(tokens[startAt]!.getToken())) {
      startAt++;
    }
    if (startAt + 1 < tokens.length) {
      const phrase = tokens[startAt]!.getToken() + ' ' + tokens[startAt + 1]!.getToken();
      if (MIT_MIR_ETC.matcher(phrase.toLowerCase()).matches()) {
        startAt += 2;
      } else if (OHNE_MICH_ETC.matcher(phrase.toLowerCase()).matches()) {
        startAt += 2;
      }
    }
    if (startAt + 1 < tokens.length && (StringUtils_isNumeric(tokens[startAt]!.getToken()) || tokens[startAt]!.hasPosTag('ZAL'))) {
      let posAfterModifier = startAt + 1;
      if (startAt + 3 < tokens.length && ',' === tokens[startAt + 1]!.getToken() && StringUtils_isNumeric(tokens[startAt + 2]!.getToken())) {
        posAfterModifier = startAt + 3;
      }
      if (StringUtils_endsWithAny(tokens[posAfterModifier]!.getToken(), 'gramm', 'Gramm', 'Meter', 'meter')) {
        return posAfterModifier + 1;
      }
    }
    return startAt;
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns();
  }

  private isNonPredicativeAdjective(tokensReadings: AnalyzedTokenReadings): boolean {
    for (const reading of tokensReadings.getReadings()) {
      const posTag = reading.getPOSTag();
      if (posTag != null && posTag.startsWith('ADJ') && !posTag.includes('PRD')) {
        return true;
      }
    }
    return false;
  }

  private isParticiple(tokensReadings: AnalyzedTokenReadings): boolean {
    return tokensReadings.hasPartialPosTag('PA1') || tokensReadings.hasPartialPosTag('PA2');
  }

  private isRelevantPronoun(tokens: AnalyzedTokenReadings[], pos: number): boolean {
    const analyzedToken = tokens[pos]!;
    let relevantPronoun = hasReadingOfType(analyzedToken, POSType.PRONOMEN);
    // avoid false alarms:
    const token = tokens[pos]!.getToken();
    if (PRONOUNS_TO_BE_IGNORED.has(token.toLowerCase()) ||
        (pos > 0 && StringEqualsIgnoreCase(tokens[pos - 1]!.getToken(), 'vor') && StringEqualsIgnoreCase(token, 'allem'))) {
      relevantPronoun = false;
    }
    return relevantPronoun;
  }

  // TODO: improve this so it only returns true for real relative clauses
  private couldBeRelativeOrDependentClause(tokens: AnalyzedTokenReadings[], pos: number): boolean {
    let comma: boolean;
    let relPronoun: boolean;
    if (pos >= 1) {
      // avoid false alarm: "Das Wahlrecht, das Frauen zugesprochen bekamen." etc:
      comma = tokens[pos - 1]!.getToken() === ',';
      relPronoun = comma && tokens[pos]!.hasAnyLemma(...REL_PRONOUN_LEMMAS);
      if (relPronoun && pos + 3 < tokens.length) {
        return true;
      }
    }
    if (pos >= 2) {
      // avoid false alarm: "Der Mann, in dem quadratische Fische schwammen."
      // or: "Die Polizei erwischte die Diebin, weil diese Ausweis und Visitenkarte hinterließ."
      comma = tokens[pos - 2]!.getToken() === ',';
      if (comma) {
        const prep = tokens[pos - 1]!.hasPosTagStartingWith('PRP:');
        relPronoun = tokens[pos]!.hasAnyLemma(...REL_PRONOUN_LEMMAS);
        return prep && relPronoun || (tokens[pos - 1]!.hasPosTag('KON:UNT') && (tokens[pos]!.hasLemma('jen') || tokens[pos]!.hasLemma('dies') || tokens[pos]!.hasLemma('ebendies')));
      }
    }
    return false;
  }

  private checkDetNounAgreement(maybePreposition: AnalyzedTokenReadings | null, token1: AnalyzedTokenReadings,
                                token2: AnalyzedTokenReadings, sentence: AnalyzedSentence, tokenPos: number, replMap: Map<number, ReplacementType>,
                                skippedStr: string | null): RuleMatch | null {
    // TODO: remove "-".equals(token2.getToken()) after the bug fix
    // see Daniel's comment from 20.12.2016 at https://github.com/languagetool-org/languagetool/issues/635
    if (token2.isImmunized() || NOUNS_TO_BE_IGNORED.has(token2.getToken()) || '-' === token2.getToken()) {
      return null;
    }

    let set1: Set<string>;
    if (token1.getReadings().length === 1 &&
        token1.getReadings()[0]!.getPOSTag() != null &&
        token1.getReadings()[0]!.getPOSTag()!.endsWith(':STV')) {
      // catch the error in "Meiner Chef raucht."
      set1 = new Set();
    } else {
      set1 = this.getAgreementCategories(token1);
    }
    const set2 = this.getAgreementCategories(token2);
    retainAll(set1, set2);
    let ruleMatch: RuleMatch | null = null;
    if (set1.size === 0 && !this.isException(token1, token2)) {
      const compoundMatch = this.getCompoundError(token1, token2, tokenPos, sentence);
      if (compoundMatch != null) {
        return compoundMatch;
      }
      /*
      List<String> errorCategories = getCategoriesCausingError(token1, token2);
      String errorDetails = errorCategories.isEmpty() ?
            "Kasus, Genus oder Numerus" : String.join(" und ", errorCategories);
      String msg = "Möglicherweise fehlende grammatische Übereinstimmung des " + errorDetails + ".";
      String shortMsg = "Evtl. keine Übereinstimmung von Kasus, Genus oder Numerus";
      */

      const msg = 'Möglicherweise passen das Nomen und die Wörter, die das Nomen beschreiben, grammatisch nicht zusammen.';
      const shortMsg = 'Evtl. passen Wörter grammatisch nicht zusammen.';
      ruleMatch = new RuleMatch(this, sentence, token1.getStartPos(), token2.getEndPos(), msg, shortMsg);
      // this will not give a match for compounds that are not in the dictionary...
      //ruleMatch.setUrl(Tools.getUrl("https://www.korrekturen.de/flexion/deklination/" + token2.getToken() + "/"));
      const suggestor = new AgreementSuggestor2(this.language.getSynthesizer()!, token1, token2, replMap.get(tokenPos));
      suggestor.setPreposition(maybePreposition);
      suggestor.setSkipped(skippedStr);
      ruleMatch.setSuggestedReplacements(suggestor.getSuggestions(true));
    }
    return ruleMatch;
  }

  /**
   * The three overloads of upstream, told apart by their arguments:
   * (token1, token2, tokenPos, sentence): z.B. "die Original Mail" -> "die Originalmail";
   * (token1, token2, token3, tokenPos, sentence): z.B. "die neue Original Mail" -> "die neue Originalmail";
   * (token1, token2, token3, token4, tokenPos, sentence, skippedStr): z.B. "die ganz neue Original Mail" -> "die ganz neue Originalmail",
   * "Es ist ein sehr interessantes kostenloses Slot Spiel" -> "ein sehr interessantes kostenloses Slot-Spiel"
   */
  private getCompoundError(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings, tokenPos: number, sentence: AnalyzedSentence): RuleMatch | null;
  private getCompoundError(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings, token3: AnalyzedTokenReadings,
                           tokenPos: number, sentence: AnalyzedSentence): RuleMatch | null;
  private getCompoundError(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings, token3: AnalyzedTokenReadings,
                           token4: AnalyzedTokenReadings, tokenPos: number, sentence: AnalyzedSentence, skippedStr: string | null): RuleMatch | null;
  private getCompoundError(...args: unknown[]): RuleMatch | null {
    if (args.length === 4) {
      return this.getCompoundError2(...(args as [AnalyzedTokenReadings, AnalyzedTokenReadings, number, AnalyzedSentence]));
    } else if (args.length === 5) {
      return this.getCompoundError3(...(args as [AnalyzedTokenReadings, AnalyzedTokenReadings, AnalyzedTokenReadings, number, AnalyzedSentence]));
    }
    return this.getCompoundError4(...(args as [AnalyzedTokenReadings, AnalyzedTokenReadings, AnalyzedTokenReadings, AnalyzedTokenReadings, number, AnalyzedSentence, string | null]));
  }

  // z.B. "die Original Mail" -> "die Originalmail"
  private getCompoundError2(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings, tokenPos: number, sentence: AnalyzedSentence): RuleMatch | null {
    if (tokenPos !== -1 && tokenPos + 2 < sentence.getTokensWithoutWhitespace().length) {
      const nextToken = sentence.getTokensWithoutWhitespace()[tokenPos + 2]!;
      if (startsWithUppercase(nextToken.getToken())) {
        if (token2.getStartPos() === nextToken.getStartPos()) {
          // avoids a strange bug that suggests e.g. "Pflegende-Pflegende" in sentence like this:
          // "Das passiert nur, wenn der zu Pflegende bereit ist."
          return null;
        }
        const potentialCompound = token2.getToken() + StringTools.lowercaseFirstChar(nextToken.getToken());
        const origToken1 = sentence.getTokensWithoutWhitespace()[tokenPos]!.getToken();  // before 'ins' etc. replacement
        const testPhrase = origToken1 + ' ' + potentialCompound;
        const hyphenPotentialCompound = token2.getToken() + '-' + nextToken.getToken();
        const hyphenTestPhrase = origToken1 + ' ' + hyphenPotentialCompound;
        return this.getRuleMatch(token1, nextToken, sentence, testPhrase, hyphenTestPhrase);
      }
    }
    return null;
  }

  // z.B. "die neue Original Mail" -> "die neue Originalmail"
  private getCompoundError3(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings, token3: AnalyzedTokenReadings,
                            tokenPos: number, sentence: AnalyzedSentence): RuleMatch | null {
    if (tokenPos !== -1 && tokenPos + 3 < sentence.getTokensWithoutWhitespace().length) {
      const nextToken = sentence.getTokensWithoutWhitespace()[tokenPos + 3]!;
      if (startsWithUppercase(nextToken.getToken())) {
        if (token3.getStartPos() === nextToken.getStartPos()) {
          // avoids a strange bug, see above
          return null;
        }
        const potentialCompound = token3.getToken() + StringTools.lowercaseFirstChar(nextToken.getToken());
        const origToken1 = sentence.getTokensWithoutWhitespace()[tokenPos]!.getToken();  // before 'ins' etc. replacement
        const testPhrase = origToken1 + ' ' + token2.getToken() + ' ' + potentialCompound;
        const hyphenPotentialCompound = token3.getToken() + '-' + nextToken.getToken();
        const hyphenTestPhrase = origToken1 + ' ' + token2.getToken() + ' ' + hyphenPotentialCompound;
        return this.getRuleMatch(token1, nextToken, sentence, testPhrase, hyphenTestPhrase);
      }
    }
    return null;
  }

  // z.B. "die ganz neue Original Mail" -> "die ganz neue Originalmail",
  // "Es ist ein sehr interessantes kostenloses Slot Spiel" -> "ein sehr interessantes kostenloses Slot-Spiel"
  private getCompoundError4(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings, token3: AnalyzedTokenReadings,
                            token4: AnalyzedTokenReadings, tokenPos: number, sentence: AnalyzedSentence, skippedStr: string | null): RuleMatch | null {
    const idx = tokenPos + 4 + (skippedStr != null ? 1 : 0);
    if (tokenPos !== -1 && idx < sentence.getTokensWithoutWhitespace().length) {
      const nextToken = sentence.getTokensWithoutWhitespace()[idx]!;
      const potentialCompound = token4.getToken() + StringTools.lowercaseFirstChar(nextToken.getToken());
      if (startsWithUppercase(token4.getToken()) && startsWithUppercase(nextToken.getToken())) {
        if (token4.getStartPos() === nextToken.getStartPos()) {
          // avoids a strange bug that suggests e.g. "Machtmach" in sentences like this:
          // "Denn die einzelnen sehen sich einer sehr verschieden starken Macht des..."
          return null;
        }
        const origToken1 = sentence.getTokensWithoutWhitespace()[tokenPos]!.getToken();  // before 'ins' etc. replacement
        const testPhrase = origToken1 + (skippedStr != null ? ' ' + skippedStr + ' ' : ' ') + token2.getToken() + ' ' + token3.getToken() + ' ' + potentialCompound;
        const hyphenPotentialCompound = token4.getToken() + '-' + nextToken.getToken();
        const hyphenTestPhrase = origToken1 + (skippedStr != null ? ' ' + skippedStr + ' ' : ' ') + token2.getToken() + ' ' + token3.getToken() + ' ' + hyphenPotentialCompound;
        return this.getRuleMatch(token1, nextToken, sentence, testPhrase, hyphenTestPhrase);
      }
    }
    return null;
  }

  private getRuleMatch(token: AnalyzedTokenReadings, token2: AnalyzedTokenReadings, sentence: AnalyzedSentence, testPhrase: string, hyphenTestPhrase: string): RuleMatch | null {
    this.initLt();
    if (token2.getReadings().every((k) => k.getPOSTag() != null && !k.getPOSTag()!.startsWith('SUB'))) {
      return null;
    }
    const replacements: string[] = [];
    if (this.lt!.check(testPhrase).length === 0 && token2.isTagged()) {
      replacements.push(testPhrase);
    }
    if (this.lt!.check(hyphenTestPhrase).length === 0 && token2.isTagged()) {
      replacements.push(hyphenTestPhrase);
    }
    if (replacements.length > 0) {
      const message = 'Wenn es sich um ein zusammengesetztes Nomen handelt, wird es zusammengeschrieben.';
      const ruleMatch = new RuleMatch(this, sentence, token.getStartPos(), token2.getEndPos(), message);
      ruleMatch.addSuggestedReplacements(replacements);
      ruleMatch.setUrl(Tools.getUrl('https://dict.leo.org/grammatik/deutsch/Rechtschreibung/Regeln/Getrennt-zusammen/Nomen.html#grammarAnchor-Nomen-49575'));
      return ruleMatch;
    }
    return null;
  }

  private initLt(): void {
    if (this.lt == null) {
      this.lt = new JLanguageTool(this.language);
      for (const rule of this.lt.getAllActiveRules()) {
        if (rule.getId() !== 'DE_AGREEMENT' && rule.getId() !== 'GERMAN_SPELLER_RULE') {
          this.lt.disableRule(rule.getId());
        }
      }
    }
  }

  private isException(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings): boolean {
    return 'allen' === token1.getToken() && 'Grund' === token2.getToken();
  }

  getCategoriesCausingError(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings): string[] {
    const categories: string[] = [];
    const categoriesToCheck = [GrammarCategory.KASUS, GrammarCategory.GENUS, GrammarCategory.NUMERUS];
    for (const category of categoriesToCheck) {
      if (this.agreementWithCategoryRelaxation(token1, token2, category)) {
        categories.push(category.displayName);
      }
    }
    return categories;
  }

  private checkDetAdjNounAgreement(maybePreposition: AnalyzedTokenReadings | null, token1: AnalyzedTokenReadings,
                                   token2: AnalyzedTokenReadings, token3: AnalyzedTokenReadings | null, sentence: AnalyzedSentence,
                                   tokenPos: number, replMap: Map<number, ReplacementType> | null, skippedStr: string | null): RuleMatch | null {
    // TODO: remove (token3 == null || token3.getToken().length() < 2)
    // see Daniel's comment from 20.12.2016 at https://github.com/languagetool-org/languagetool/issues/635
    if (token3 == null || token3.getToken().length < 2) {
      return null;
    }
    const set = this.retainCommonCategories(token1, token2, token3);
    let ruleMatch: RuleMatch | null = null;
    if (set.size === 0) {
      if (HERR_FRAU.matcher(token3.getToken()).matches() && tokenPos + 3 < sentence.getTokensWithoutWhitespace().length) {
        const token4 = sentence.getTokensWithoutWhitespace()[tokenPos + 3]!;
        if (!token4.isTagged() || token4.hasPosTagStartingWith('EIG:')) {
          // 'Aber das ignorierte Herr Grey bewusst.'
          return null;
        }
      }
      if (tokenPos + 4 < sentence.getTokensWithoutWhitespace().length) {
        const compoundMatch = this.getCompoundError(sentence.getTokensWithoutWhitespace()[tokenPos]!,
                sentence.getTokensWithoutWhitespace()[tokenPos + 1]!,
                sentence.getTokensWithoutWhitespace()[tokenPos + 2]!,
                sentence.getTokensWithoutWhitespace()[tokenPos + 3]!, tokenPos, sentence, null);
        if (compoundMatch != null) {
          return compoundMatch;
        }
      }
      const compoundMatch = this.getCompoundError(token1, token2, token3, tokenPos, sentence);
      if (compoundMatch != null) {
        return compoundMatch;
      }
      if (token3.hasPosTagStartingWith('ABK')) {
        return null;
      }
      ruleMatch = new RuleMatch(this, sentence, token1.getStartPos(), token3.getEndPos(), MSG, SHORT_MSG);
      const suggestor = new AgreementSuggestor2(this.language.getSynthesizer()!, token1, token2, token3, replMap != null ? replMap.get(tokenPos) : null);
      suggestor.setPreposition(maybePreposition);
      suggestor.setSkipped(skippedStr);
      ruleMatch.setSuggestedReplacements(suggestor.getSuggestions(true));
    }
    return ruleMatch;
  }

  private checkDetAdjAdjNounAgreement(maybePreposition: AnalyzedTokenReadings | null, token1: AnalyzedTokenReadings,
                                      token2: AnalyzedTokenReadings, token3: AnalyzedTokenReadings, token4: AnalyzedTokenReadings,
                                      sentence: AnalyzedSentence, tokenPos: number, replMap: Map<number, ReplacementType> | null, skippedStr: string | null): RuleMatch | null {
    const set = this.retainCommonCategories(token1, token2, token3, token4);
    let ruleMatch: RuleMatch | null = null;
    if (set.size === 0) {
      const compoundMatch = this.getCompoundError(token1, token2, token3, token4, tokenPos, sentence, skippedStr);
      if (compoundMatch != null) {
        return compoundMatch;
      }
      if (token4.hasPosTagStartingWith('ABK')) {
        return null;
      }
      ruleMatch = new RuleMatch(this, sentence, token1.getStartPos(), token4.getEndPos(), MSG2, SHORT_MSG);
      if (replMap != null) {
        const suggestor = new AgreementSuggestor2(this.language.getSynthesizer()!, token1, token2, token3, token4, replMap.get(tokenPos));
        suggestor.setPreposition(maybePreposition);
        suggestor.setSkipped(skippedStr);
        ruleMatch.setSuggestedReplacements(suggestor.getSuggestions(true));
      }
    }
    return ruleMatch;
  }

  private agreementWithCategoryRelaxation(token1: AnalyzedTokenReadings,
                                          token2: AnalyzedTokenReadings, categoryToRelax: GrammarCategory | null): boolean {
    let categoryToRelaxSet: Set<GrammarCategory>;
    if (categoryToRelax != null) {
      categoryToRelaxSet = new Set([categoryToRelax]);
    } else {
      categoryToRelaxSet = new Set();
    }
    const set1 = AgreementTools.getAgreementCategories(token1, categoryToRelaxSet, true);
    const set2 = AgreementTools.getAgreementCategories(token2, categoryToRelaxSet, true);
    retainAll(set1, set2);
    return set1.size !== 0;
  }

  /** The two overloads of upstream: (token1, token2, token3) and (token1, token2, token3, token4). */
  private retainCommonCategories(token1: AnalyzedTokenReadings,
                                 token2: AnalyzedTokenReadings, token3: AnalyzedTokenReadings, token4?: AnalyzedTokenReadings): Set<string> {
    if (token4 === undefined) {
      const categoryToRelaxSet = new Set<GrammarCategory>();
      const skipSol = !VIELE_WENIGE_LOWERCASE.has(token1.getToken().toLowerCase());
      const set1 = AgreementTools.getAgreementCategories(token1, categoryToRelaxSet, skipSol);
      const set2 = AgreementTools.getAgreementCategories(token2, categoryToRelaxSet, skipSol);
      const set3 = AgreementTools.getAgreementCategories(token3, categoryToRelaxSet, true);
      retainAll(set1, set2);
      retainAll(set1, set3);
      return set1;
    }
    const categoryToRelaxSet = new Set<GrammarCategory>();
    const skipSol = !VIELE_WENIGE_LOWERCASE.has(token1.getToken().toLowerCase());
    const set1 = AgreementTools.getAgreementCategories(token1, categoryToRelaxSet, skipSol);
    const set2 = AgreementTools.getAgreementCategories(token2, categoryToRelaxSet, skipSol);
    const set3 = AgreementTools.getAgreementCategories(token3, categoryToRelaxSet, skipSol);
    const set4 = AgreementTools.getAgreementCategories(token4, categoryToRelaxSet, true);
    retainAll(set1, set2);
    retainAll(set1, set3);
    retainAll(set1, set4);
    return set1;
  }

  private getAgreementCategories(aToken: AnalyzedTokenReadings): Set<string> {
    return AgreementTools.getAgreementCategories(aToken, new Set(), false);
  }

}
