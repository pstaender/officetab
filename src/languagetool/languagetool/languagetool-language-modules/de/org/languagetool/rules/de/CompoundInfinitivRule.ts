// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/CompoundInfinitivRule.java faithful
// The static ANTI_PATTERNS are created on first use. LinguServices (the office extension's speller)
// is not ported: UserConfig.getLinguServices() is typed unknown here, used through a minimal
// interface. StringUtils.equalsAny and lowerCase are local functions.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternTokenBuilder.ts';
import { posRegex, tokenRegex } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleBuilderHelper.ts';
import { MorfologikSpeller } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/morfologik/MorfologikSpeller.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Speller } from '../../../../../../../morfologik-stemming/morfologik-speller/morfologik/speller/Speller.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/** org.languagetool.LinguServices, as far as this rule uses it (not ported). */
interface LinguServices {
  isCorrectSpell(word: string, lang: Language): boolean;
}

/** StringUtils.equalsAny(cs, searchCharSequences...) */
function StringUtils_equalsAny(cs: string | null, ...searchCharSequences: string[]): boolean {
  return searchCharSequences.some((s) => s === cs);
}

/** StringUtils.lowerCase(str) */
function StringUtils_lowerCase(str: string | null): string | null {
  return str == null ? null : str.toLowerCase();
}

let antiPatternList: PatternToken[][] | null = null;
const ANTI_PATTERNS = (): PatternToken[][] => (antiPatternList ??= [
    //
    // NOTE: antipatterns only work when they cover "zu":
    //
    [
      token("auf"),
      token("Nummer"),
      token("sicher"),
      token("zu")
    ],
    [   // "Den richtigen Weg zu gehen bedeutet ab und an zu erkennen, dass man eventuell auf der falschen Spur ist."
      token("ab"),
      tokenRegex("und|&"),
      token("an"),
      token("zu")
    ],
    [  // "Der diensthabende Kollege hatte ganz schön zu tun."
      token("ganz"),
      token("schön"),
      token("zu")
    ],
    [  // "Fang dort an zu lesen, wo du aufgehört hast."
      tokenRegex("fang|fängst|fängt|fangt|fangen|fing|fingen"),
      posRegex("ADV.*"),
      token("an"),
      token("zu")
    ],
    [
      tokenRegex("dazu|darüber"),
      token("zu"),
      token("machen")
    ],
    [ //Da Frauen keine Gelegenheit übersehen, sich schön zu machen, pflückte sie eine Orchidee und steckte sie in ihr Haar. (compounding optional)
      token("schön"),
      token("zu"),
      token("machen")
    ],
    [
      token("kurz"),
      token("davor"),
      token("zu")
    ],
    [
      tokenRegex("Jahr|Monat|Zeit"),
      token("über"),
      token("zu")
    ],
    [
      token("endlich"),
      token("wieder"),
      token("zu")
    ],
    [
      token("bis"),
      token("hin"),
      token("zu")
    ],
    [
      token("von"),
      tokenRegex(".*[a-z].*"),
      token("her"),
      token("zu")
    ],
    [
      tokenRegex("sehr|ganz|äu(ss|ß)erst|zu|nicht|absolut|total|wirklich|möglichst"),
      posRegex("ADJ.*"),
      token("zu")
    ],
    [
      token("Schritt"),
      token("weiter"),
      token("zu")
    ],
    [
      token("und"),
      token("so"),
      token("weiter")
    ],
    [
      token("darauf"),
      token("zu"),
      posRegex("VER.*"),
      token("dass")
    ],
    [
      token("darauf"),
      token("zu"),
      posRegex("VER.*"),
      token(",")
    ],
    [  // "um dort die Nacht über zu stehen."
      tokenRegex("Spiel|Tag|Nacht|Morgen|Nachmittag|Abend|Zeit|.+zeit|Jahr(zehnt)?|Monat|.+tag|Mittwoch|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember"),
      token("über"),
      token("zu")
    ],
    [
      token("kurz"),
      token("zu"),
      token("machen")
    ],
    [
      // "ohne die Erlaubnis dazu zu haben"
      token("dazu"),
      token("zu"),
      token("haben")
    ],
    [
      // "Er hatte nichts weiter zu sagen"
      tokenRegex("deutlich|viel|Stück|nichts|nix|noch"),
      token("weiter"),
      token("zu")
    ],
    [
      // "Auf und ab zu schreiten"
      token("auf"),
      tokenRegex("und|&|oder|\\/"),
      new PatternTokenBuilder().posRegex("ADV.*").min(0).build(),
      token("ab"),
      token("zu")
    ],
    [
      token("zu"),
      posRegex("ADJ.*"),
      token("zu")
    ],
    [
      // "Hin und her zu laufen"
      token("hin"),
      tokenRegex("und|&|oder|\\/"),
      new PatternTokenBuilder().posRegex("ADV.*").min(0).build(),
      token("her"),
      token("zu")
    ],
    [
      // "Hoch und runter zu laufen"
      tokenRegex("rauf|hoch"),
      tokenRegex("und|&|oder|\\/"),
      new PatternTokenBuilder().posRegex("ADV.*").min(0).build(),
      token("runter"),
      token("zu")
    ],
    [
      // Sie scheint aus Spanien heraus zu kaufen
      new PatternTokenBuilder().token("aus").setSkip(3).build(),
      token("heraus"),
      token("zu")
    ]
  ]);

const ADJ_EXCEPTION: readonly string[] = [
    "schwer",
    "klar",
    "verloren",
    "bekannt",
    "rot",
    "blau",
    "gelb",
    "grün",
    "schwarz",
    "weiß",
    "fertig",
    "neu"
  ];

function token(s: string): PatternToken {
  return new PatternTokenBuilder().token(s).build();
}

/**
 * Checks the compound spelling of infinitive clause (Erweiterter Infinitiv mit zu)
 *
 * @author Fred Kruse
 * @since 4.4
 */
export class CompoundInfinitivRule extends Rule {

  private readonly linguServices: LinguServices | null;
  private readonly lang: Language;
  private readonly antiPatterns: () => DisambiguationPatternRule[];

  private speller: Speller | null = null;

  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null) {
    super();
    super.setCategory(Categories.COMPOUNDING.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
    this.addExamplePair(Example.wrong("Er überprüfte die Rechnungen noch einmal, um <marker>sicher zu gehen</marker>."),
                   Example.fixed("Er überprüfte die Rechnungen noch einmal, um <marker>sicherzugehen</marker>."));
    this.lang = lang;
    if (userConfig != null) {
      this.linguServices = userConfig.getLinguServices() as LinguServices | null;
    } else {
      this.linguServices = null;
    }
    this.setUrl(Tools.getUrl("https://languagetool.org/insights/de/beitrag/zu-zusammen-oder-getrennt/"));
    this.antiPatterns = CompoundInfinitivRule.cacheAntiPatterns(lang, ANTI_PATTERNS());
  }

  override getId(): string {
    return "COMPOUND_INFINITIV_RULE";
  }

  override getDescription(): string {
    return "Erweiterter Infinitiv mit zu (Zusammenschreibung)";
  }

  private static isInfinitiv(token: AnalyzedTokenReadings): boolean {
    return token.hasPosTagStartingWith("VER:INF");
  }

  private isMisspelled(word: string): boolean {
    word = StringTools.lowercaseFirstChar(word);
    if (this.linguServices == null && this.speller != null) {
      return this.speller.isMisspelled(word);
    } else if (this.linguServices != null) {
      return !this.linguServices.isCorrectSpell(word, this.lang);
    }
    throw new Error("IllegalStateException: LinguServices or Speller must be not null to check spelling in CompoundInfinitivRule");
  }

  private isRelevant(token: AnalyzedTokenReadings): boolean {
    return token.hasPosTag("ZUS") && !StringEqualsIgnoreCase("um", token.getToken());
  }

  private getLemma(token: AnalyzedTokenReadings | null): string | null {
    if (token != null) {
      const readings = token.getReadings();
      for (const reading of readings) {
        const lemma = reading.getLemma();
        if (lemma != null) {
          return lemma;
        }
      }
    }
    return null;
  }

  private isException(tokens: AnalyzedTokenReadings[], n: number): boolean {
    if (tokens[n - 2]!.hasPosTagStartingWith("VER")) {
      return true;
    }
    for (const word of ADJ_EXCEPTION) {
      if (tokens[n - 1]!.getToken() === word) {
        return true;
      }
    }
    if ("sagen" === tokens[n + 1]!.getToken() &&
            ("weiter" === tokens[n - 1]!.getToken() || "dazu" === tokens[n - 1]!.getToken())) {
      return true;
    }
    if (("tragen" === tokens[n + 1]!.getToken() || "machen" === tokens[n + 1]!.getToken())
            && "davon" === tokens[n - 1]!.getToken()) {
      return true;
    }
    if ("geben" === tokens[n + 1]!.getToken() && "daran" === tokens[n - 1]!.getToken()) {
      return true;
    }
    if ("gehen" === tokens[n + 1]!.getToken() && "ab" === tokens[n - 1]!.getToken()) {
      return true;
    }
    if ("errichten" === tokens[n + 1]!.getToken() && "wieder" === tokens[n - 1]!.getToken()) {
      return true;
    }
    let verb: string | null = null;
    for (let i = n - 2; i > 0 && !this.isPunctuation(tokens[i]!.getToken()); i--) {
      if (tokens[i]!.hasPosTagStartingWith("VER:IMP")) {
        verb = StringUtils_lowerCase(this.getLemma(tokens[i]!));
      } else if (tokens[i]!.hasPosTagStartingWith("VER")) {
        verb = tokens[i]!.getToken().toLowerCase();
      } else if ("Fang" === tokens[i]!.getToken()) {
        verb = "fangen";
      }
      if (verb != null) {
        if (!this.isMisspelled(tokens[n - 1]!.getToken() + verb)) {
          return true;
        } else {
          break;
        }
      }
    }
    if ("aus" === tokens[n - 1]!.getToken() || "an" === tokens[n - 1]!.getToken()) {
      for (let i = n - 2; i > 0 && !this.isPunctuation(tokens[i]!.getToken()); i--) {
        if ("von" === tokens[i]!.getToken() || "vom" === tokens[i]!.getToken()) {
          return true;
        }
      }
    }
    if ("her" === tokens[n - 1]!.getToken()) {
      for (let i = n - 2; i > 0 && !this.isPunctuation(tokens[i]!.getToken()); i--) {
        if ("vor" === tokens[i]!.getToken()) {
          return true;
        }
      }
    }
    return false;
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns();
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    if (this.linguServices == null && this.speller == null) {
      // speller can not initialized by constructor because of temporary initialization of LanguageTool in other rules,
      // which leads to problems in LO/OO extension
      this.speller = new Speller(MorfologikSpeller.getDictionaryWithCaching("/de/hunspell/de_DE.dict"));
    }
    const ruleMatches: RuleMatch[] = [];
    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
    for (let i = 2; i < tokens.length - 1; i++) {
      if ("zu" === tokens[i]!.getToken()
        && CompoundInfinitivRule.isInfinitiv(tokens[i + 1]!)
        && this.isRelevant(tokens[i - 1]!)
        && !tokens[i]!.isImmunized()
        && !this.isException(tokens, i)
        && !this.isMisspelled(tokens[i - 1]!.getToken() + tokens[i + 1]!.getToken())) {
        const msg = "Wenn der erweiterte Infinitiv von dem Verb '" + tokens[i - 1]!.getToken() + tokens[i + 1]!.getToken()
                   + "' abgeleitet ist, sollte er zusammengeschrieben werden.";
        const ruleMatch = new RuleMatch(this, sentence, tokens[i - 1]!.getStartPos(), tokens[i + 1]!.getEndPos(), msg);
        const suggestions: string[] = [];
        suggestions.push(tokens[i - 1]!.getToken() + tokens[i]!.getToken() + tokens[i + 1]!.getToken());
        ruleMatch.setSuggestedReplacements(suggestions);
        ruleMatches.push(ruleMatch);
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private isPunctuation(word: string | null): boolean {
    return word != null
           && word.length === 1
           && StringUtils_equalsAny(word, ".", "?", "!", "…", ":", ";", ",", "(", ")", "[", "]");
  }
}
