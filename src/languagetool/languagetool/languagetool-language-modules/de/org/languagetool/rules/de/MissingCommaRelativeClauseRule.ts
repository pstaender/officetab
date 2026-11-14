// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/MissingCommaRelativeClauseRule.java faithful
// The constructors are one (behind = false by default). The static patterns and ANTI_PATTERNS are
// created on first use; GermanyGerman.getInstance() is Languages.getLanguageForShortCode('de-DE')
// (what it does): German imports this rule, so a value import of GermanyGerman (a subclass of
// German) would be an import cycle. The two isPerfect overloads are one method with an optional
// third verb position. StringUtils.equalsAny(IgnoreCase) are local functions.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { Category, Location } from '../../../../../../languagetool-core/org/languagetool/rules/Category.ts';
import { CategoryId } from '../../../../../../languagetool-core/org/languagetool/rules/CategoryId.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternTokenBuilder.ts';
import { csToken, pos, posRegex, regex, token } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleBuilderHelper.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const compile = Pattern.compile;

/** StringUtils.equalsAny(cs, searchCharSequences...) */
function StringUtils_equalsAny(cs: string | null, ...searchCharSequences: string[]): boolean {
  return searchCharSequences.some((s) => s === cs);
}

/** StringUtils.equalsAnyIgnoreCase(cs, searchCharSequences...) */
function StringUtils_equalsAnyIgnoreCase(cs: string | null, ...searchCharSequences: string[]): boolean {
  return cs != null && searchCharSequences.some((s) => StringEqualsIgnoreCase(cs, s));
}

let patterns: { MARKS_REGEX: Pattern; PRONOUN: Pattern; verbPattern: Pattern; zalEtcPattern: Pattern } | null = null;
const P = () => (patterns ??= {
  MARKS_REGEX: compile("[,;.:?•!-–—’'\"„“”…»«‚‘›‹()\\/\\[\\]]"),
  PRONOUN: compile("(d(e[mnr]|ie|as|e([nr]|ss)en)|welche[mrs]?|wessen|was)"),
  verbPattern: Pattern.compile("(VER:[1-3]:|VER:.*:[1-3]:).*"),
  zalEtcPattern: Pattern.compile("(ZAL|AD[JV]|ART|SUB|PRO:POS|PRP).*"),
});

let antiPatternList: PatternToken[][] | null = null;
const ANTI_PATTERN_LIST = (): PatternToken[][] => (antiPatternList ??= [
      [
        regex("gerade|wenn"),
        token("das")
      ],
      [
        token("anstelle"),
        regex("diese[rsm]|de[rsm]|dessen|jene[rsm]|[dms]?eine[rsm]|ihre[rs]|eure[sr]|unse?re[sr]")
      ],
      [
        token("im"),
        token("Zuge"),
        token("dessen")
      ],
      [
        csToken("mit"),
        regex("de[mr]"),
        regex("de[mrs]"),
        posRegex("SUB:.+"),
        csToken("verbindet")
      ],
      [
        regex("eine"),
        csToken("menge"),
        posRegex("SUB:.+")
      ],
      [ // dass sich wie folgt formulieren lässt
        regex("wie"),
        csToken("folgt"),
        posRegex("VER:.+")
      ],
      [ // das sollte gut überlegt sein
        regex("gut"),
        csToken("überlegt"),
        csToken("sein")
      ],
      [ // samt Auftraggeber
        csToken("samt"),
        posRegex("SUB:DAT.*")
      ],
      [ // ... denen sie ausgesetzt sind.
        posRegex("PA2:PRD:GRU:VER|VER:PA2.*"),
        csToken("sind"),
        posRegex("PKT")
      ],
      [
        csToken("am"),
        pos("ADJ:PRD:SUP"),
        posRegex("PRP:.+"),
        regex("d(e[mnr]|ie|as|e([nr]|ss)en)")
      ],
      [ // Aber denen etwas beibringen zu müssen, die sich sträuben, das ist die wahre Hölle.
        pos("SENT_START"),
        token("Aber"),
        regex("der|die|denen|das|jenen|einigen|anderen|vielen|manchen|allen")
      ],
      [ // Aus diesem Grund sind die Wörter nicht direkt übersetzt, stattdessen wird der Zustand oder die Situation beschrieben in der die Wörter benutzt werden.
        posRegex("PA2.*|VER:PA2.*"),
        token("werden"),
        regex("[\\.\\!\\?…\\:;]+")
      ],
      [ // Plan von Maßnahmen, mit denen das Ansteckungsrisiko während des Aufenthalts an einem Ort verringert werden soll
        token("werden"),
        new PatternTokenBuilder().posRegex("SENT_END").matchInflectedForms().tokenRegex("sollen|können|müssen").build()
      ],
      [ // Aus diesem Grund sind die Wörter nicht direkt übersetzt, stattdessen wird der Zustand oder die Situation beschrieben in der die Wörter benutzt werden.
        posRegex("PA2.*|VER:PA2.*"),
        new PatternTokenBuilder().posRegex("SENT_END").matchInflectedForms().tokenRegex("haben|werden").build()
      ],
      [ // Es würde noch sehr helfen eine Kopie der Google Slide dort zu verlinken damit wir das direkt nachstellen können
        posRegex("VER:INF.*"),
        new PatternTokenBuilder().posRegex("SENT_END").matchInflectedForms().tokenRegex("können|werden|sollen|dürfen|müssen|wollen|mögen").build()
      ],
      [
        // Komma an der falschen Stelle
        regex("ja|mal"),
        csToken("was")
      ],
      [
        // Komma an der falschen Stelle
        posRegex("SENT_START|PKT"),
        csToken("aber"),
        regex("solange|wenn|wo|wie|was"),
        regex("du|er|sie|sich|man|euch|uns|die|der|das")
      ],
      [
        // Komma an der falschen Stelle
        csToken("selbst"),
        csToken("wenn"),
        regex("du|er|sie|sich|man|euch|uns|die|der|das"),
        regex("die|der|das")
      ],
      [
        // Komma an der falschen Stelle
        csToken("wie"),
        regex("die|der|das")
      ],
      [
        // Kein Komma in "weder ... noch ..."
        new PatternTokenBuilder().setSkip(12).matchInflectedForms().token("weder").build(),
        token("noch")
      ],
      [
        posRegex("VER:.*1:SIN:KJ1:.+"),
        posRegex("VER:MOD:[12]:.+"),
        posRegex("PKT|KON:NEB")
      ],
      [
        // Er warnt auch vor Autos, die soeben überholt haben bzw. überholt wurden.
        posRegex("VER:.+"),
        csToken("bzw"),
        csToken("."),
        posRegex("VER:.+")
      ],
      // … Planungen, die sich noch auf die ganze Stadt bezogen wurden aufgegeben.
      [
        regex("w[eu]rden"),
        posRegex("PA2:PRD:GRU:VER|VER:PA2.*"),
        pos("PKT")
      ],
      // Der Beitrag, den Sie versucht haben aufzurufen, existiert nicht mehr oder wurde verschoben.
      [
        posRegex("PA2:PRD:GRU:VER|VER:PA2.*"),
        regex("haben?|hatten?"),
        posRegex("VER:EIZ.*"),
        pos("PKT")
      ],
      [
        posRegex("VER.*"),
        regex("\\u2063")
      ]
  ]);

/**
 * A rule checks a sentence for a missing comma before or after a relative clause (only for German language).
 * @author Fred Kruse
 */
export class MissingCommaRelativeClauseRule extends Rule {

  private readonly behind: boolean;

  private static ANTI_PATTERNS: DisambiguationPatternRule[] | null = null;

  constructor(messages: ResourceBundle, behind = false) {
    super(messages);
    super.setCategory(new Category(new CategoryId("HILFESTELLUNG_KOMMASETZUNG"),
        "Kommasetzung", Location.INTERNAL, true));
    this.behind = behind;
  }

  override getId(): string {
    return (this.behind ? "COMMA_BEHIND_RELATIVE_CLAUSE" : "COMMA_IN_FRONT_RELATIVE_CLAUSE");
  }

  override getDescription(): string {
    return (this.behind ? "Fehlendes Komma nach Relativsatz" : "Fehlendes Komma vor Relativsatz");
  }

  /**
   * is a separator
   */
  private static isSeparator(token: string): boolean {
    return (P().MARKS_REGEX.matcher(token).matches() || token === "und" || token === "oder");
  }

  /**
   * get the position of the next separator
   */
  private static nextSeparator(tokens: AnalyzedTokenReadings[], start: number): number {
    for (let i = start; i < tokens.length; i++) {
      if (MissingCommaRelativeClauseRule.isSeparator(tokens[i]!.getToken())) {
        return i;
      }
    }
    return tokens.length - 1;
  }

  /**
   * is preposition
   */
  private static isPrp(token: AnalyzedTokenReadings): boolean {
    return token.hasPosTagStartingWith("PRP:") && !token.isImmunized();
  }

  /**
   * is a potential verb used in sentence or subclause
   */
  private static isVerb(tokens: AnalyzedTokenReadings[], n: number): boolean {
    return (tokens[n]!.matchesPosTagRegex(P().verbPattern)
        && !tokens[n]!.matchesPosTagRegex(P().zalEtcPattern)
        && (!tokens[n]!.hasPosTagStartingWith("VER:INF:") || tokens[n-1]!.getToken() !== "zu")
        && !tokens[n]!.isImmunized()
      );
  }

  /**
   * is any verb but not an "Infinitiv mit zu"
   */
  private static isAnyVerb(tokens: AnalyzedTokenReadings[], n: number): boolean {
    return tokens[n]!.hasPosTagStartingWith("VER:")
        || (n < tokens.length - 1
            && ((tokens[n]!.getToken() === "zu" && tokens[n+1]!.hasPosTagStartingWith("VER:INF:"))
             || (tokens[n]!.hasPosTag("NEG") && tokens[n+1]!.hasPosTagStartingWith("VER:"))));
  }

  /**
   * is a verb after sub clause
   */
  static isVerbBehind(tokens: AnalyzedTokenReadings[], end: number): boolean {
    return (end < tokens.length - 1 && tokens[end]!.getToken() === "," && tokens[end+1]!.hasPosTagStartingWith("VER:"));
  }

  /**
   * gives the positions of verbs in a subclause
   */
  private static verbPos(tokens: AnalyzedTokenReadings[], start: number, end: number): number[] {
    const verbs: number[] = [];
    for (let i = start; i < end; i++) {
      if (MissingCommaRelativeClauseRule.isVerb(tokens, i)) {
        if (tokens[i]!.hasPosTagStartingWith("PA")) {
          const gender = MissingCommaRelativeClauseRule.getGender(tokens[i]!);
          const sStr = "(ADJ|PA[12]):.*" + gender +".*";
          let j: number;
          for (j = i + 1; j < end && tokens[j]!.matchesPosTagRegex(sStr); j++);
          if (!tokens[j]!.matchesPosTagRegex("(SUB|EIG):.*" + gender +".*") && !tokens[j]!.isPosTagUnknown()) {
            verbs.push(i);
          }
        } else {
          verbs.push(i);
        }
      }
    }
    return verbs;
  }

  /**
   * first token initiate a subclause
   */
  private static isKonUnt(token: AnalyzedTokenReadings): boolean {
    return (token.hasPosTag("KON:UNT")
        || StringUtils_equalsAnyIgnoreCase(token.getToken(), "wer", "wo", "wohin"));
  }


  /**
   * checks to what position a test of relative clause should done
   * return -1 if no potential relative clause is assumed
   */
  private static hasPotentialSubclause(tokens: AnalyzedTokenReadings[], start: number, end: number): number {
    const R = MissingCommaRelativeClauseRule;
    const verbs = R.verbPos(tokens, start, end);
    if (verbs.length === 1 && end < tokens.length - 2 && verbs[0] === end - 1) {
      const nextEnd = R.nextSeparator(tokens, end + 1);
      const nextVerbs = R.verbPos(tokens, end + 1, nextEnd);
      if (R.isKonUnt(tokens[start]!)) {
        if (nextVerbs.length > 1 || (nextVerbs.length === 1 && nextVerbs[0] === end - 1)) {
          return verbs[0]!;
        }
      } else if (nextVerbs.length > 0) {
        return verbs[0]!;
      }
      return -1;
    }
    if (verbs.length === 2) {
      if (tokens[verbs[0]!]!.matchesPosTagRegex("VER:(MOD|AUX):.*") && tokens[verbs[1]!]!.hasPosTagStartingWith("VER:INF:")) {
        return verbs[0]!;
      }
      if (tokens[verbs[0]!]!.hasPosTagStartingWith("VER:AUX:") && tokens[verbs[1]!]!.hasPosTagStartingWith("VER:PA2:")) {
        return -1;
      }
      if (end === tokens.length - 1 && verbs[0] === end - 2
          && tokens[verbs[0]!]!.hasPosTagStartingWith("VER:INF:") && tokens[verbs[1]!]!.hasPosTagStartingWith("VER:MOD:")) {
        return -1;
      }
    }
    if (verbs.length === 3) {
      if (tokens[verbs[0]!]!.hasPosTagStartingWith("VER:MOD:")
          && ((tokens[verbs[2]! - 1]!.matchesPosTagRegex("VER:(INF|PA2):.*") && tokens[verbs[2]!]!.hasPosTagStartingWith("VER:INF:"))
              || (tokens[verbs[1]! - 1]!.getToken() === "weder" && tokens[verbs[1]!]!.hasPosTagStartingWith("VER:INF:")
                  && tokens[verbs[2]! - 1]!.getToken() === "noch" && tokens[verbs[1]!]!.hasPosTagStartingWith("VER:INF:")))
        ) {
        return -1;
      }
    }
    if (verbs.length > 1) {
      return verbs[verbs.length - 1]!;
    }
    return -1;
  }

  /**
   * is potential relative pronoun
   */
  private static isPronoun(tokens: AnalyzedTokenReadings[], n: number): boolean {
    return (P().PRONOUN.matcher(tokens[n]!.getToken()).matches()
            && tokens[n - 1]!.getToken() !== "sowie");
  }

  /**
   * get the gender of of a token
   */
  private static getGender(token: AnalyzedTokenReadings): string {
    let nMatches = 0;
    let ret = "";
    if (token.matchesPosTagRegex(".*:SIN:FEM.*")) {
      ret += "SIN:FEM";
      nMatches++;
    }
    if (token.matchesPosTagRegex(".*:SIN:MAS.*")) {
      if (nMatches > 0) {
        ret += "|";
      }
      ret += "SIN:MAS";
      nMatches++;
    }
    if (token.matchesPosTagRegex(".*:SIN:NEU.*")) {
      if (nMatches > 0) {
        ret += "|";
      }
      ret += "SIN:NEU";
      nMatches++;
    }
    if (token.matchesPosTagRegex(".*:PLU.*")) {
      if (nMatches > 0) {
        ret += "|";
      }
      ret += "PLU";
      nMatches++;
    }
    if (nMatches > 1) {
      ret = "(" + ret + ")";
    }
    return ret;
  }

  /**
   * does the gender match with a subject or name?
   */
  private static matchesGender(gender: string, tokens: AnalyzedTokenReadings[], from: number, to: number): boolean {
    let mStr: string;
    if (gender.length === 0) {
      mStr = "PRO:DEM:.*SIN:NEU.*";
    } else {
      mStr = "(SUB|EIG):.*" + gender +".*";
    }
    for (let i = to - 1; i >= from; i-- ) {
      if (tokens[i]!.matchesPosTagRegex(mStr) && (i !== 1 || !tokens[i]!.hasPosTagStartingWith("VER:"))) {
        return true;
      }
    }
    return false;
  }

  /**
   * is the token a potential article without a noun
   */
  private static isArticleWithoutSub(gender: string, tokens: AnalyzedTokenReadings[], n: number): boolean {
    if (gender.length === 0) {
      return false;
    }
    return tokens[n]!.hasPosTagStartingWith("VER:") && tokens[n - 1]!.matchesPosTagRegex("(ADJ|PA[12]|PRO:POS):.*" + gender + ".*");
  }

  /**
   * skip tokens till the next noun
   * check for e.g. "das in die dunkle Garage fahrende Auto" -> "das" is article
   */
  private static skipSub(tokens: AnalyzedTokenReadings[], n: number, to: number): number {
    const gender = MissingCommaRelativeClauseRule.getGender(tokens[n]!);
    for (let i = n + 1; i < to; i++) {
      if (tokens[i]!.matchesPosTagRegex("(SUB|EIG):.*" + gender + ".*")) {
        return i;
      }
    }
    return -1;
  }

  /**
   * skip tokens till the next noun
   * check for e.g. "das in die dunkle Garage fahrende Auto" -> "das" is article
   */
  private static skipToSub(gender: string, tokens: AnalyzedTokenReadings[], n: number, to: number): number {
    if (tokens[n+1]!.matchesPosTagRegex("PA[12]:.*" + gender + ".*")) {
      return n+1;
    }
    for (let i = n + 1; i < to; i++) {
      if (tokens[i]!.matchesPosTagRegex("(ADJ|PA[12]):.*" + gender + ".*") || tokens[i]!.isPosTagUnknown()) {
        return i;
      }
      if (tokens[i]!.hasPosTagStartingWith("ART")) {
        i = MissingCommaRelativeClauseRule.skipSub(tokens, i, to);
        if (i < 0) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * check if token is potentially an article
   */
  private static isArticle(gender: string, tokens: AnalyzedTokenReadings[], from: number, to: number): boolean {
    if (gender.length === 0) {
      return false;
    }
    const sSub = "(SUB|EIG):.*" + gender +".*";
    const sAdj = "(ZAL|PRP:|KON:|ADV:|ADJ:PRD:|(ADJ|PA[12]|PRO:(POS|DEM|IND)):.*" + gender +").*";
    for (let i = from + 1; i < to; i++ ) {
      if (tokens[i]!.matchesPosTagRegex(sSub) || tokens[i]!.isPosTagUnknown()) {
        return true;
      }
      if ((tokens[i]!.hasPosTagStartingWith("ART")) || !tokens[i]!.matchesPosTagRegex(sAdj)) {
        if (MissingCommaRelativeClauseRule.isArticleWithoutSub(gender, tokens, i)) {
          return true;
        }
        const skipTo = MissingCommaRelativeClauseRule.skipToSub(gender, tokens, i, to);
        if (skipTo > 0) {
          i = skipTo;
        } else {
          return false;
        }
      }
    }
    return to < tokens.length && MissingCommaRelativeClauseRule.isArticleWithoutSub(gender, tokens, to);
  }

  /**
   * gives back position where a comma is missed
   * PRP has to be treated separately
   */
  private static missedCommaInFront(tokens: AnalyzedTokenReadings[], start: number, end: number, lastVerb: number): number {
    const R = MissingCommaRelativeClauseRule;
    for (let i = start; i < lastVerb - 1; i++) {
      if (tokens[i]!.isImmunized()) {
        continue;
      }
      if (R.isPronoun(tokens, i)) {
        const gender = R.getGender(tokens[i]!);
        if (gender != null && !R.isAnyVerb(tokens, i + 1)
            && R.matchesGender(gender, tokens, start, i) && !R.isArticle(gender, tokens, i, lastVerb)) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * is a special combination of two verbs combination
   */
  private static isTwoCombinedVerbs(first: AnalyzedTokenReadings, second: AnalyzedTokenReadings): boolean {
    return first.matchesPosTagRegex("(VER:.*INF|.*PA[12]:).*") && second.hasPosTagStartingWith("VER:");
  }

  /**
   * is a special combination of three verbs combination
   */
  private static isThreeCombinedVerbs(tokens: AnalyzedTokenReadings[], first: number, last: number): boolean {
    return tokens[first]!.matchesPosTagRegex("VER:(AUX|INF|PA[12]).*") && tokens[first + 1]!.matchesPosTagRegex("VER:(.*INF|PA[12]).*")
        && tokens[last]!.matchesPosTagRegex("VER:(MOD|AUX).*");
  }

  /**
   * is a special combination of four verbs combination
   */
  private static isFourCombinedVerbs(tokens: AnalyzedTokenReadings[], first: number, last: number): boolean {
    return tokens[first]!.hasPartialPosTag("KJ2") && tokens[first + 1]!.hasPartialPosTag("PA2")
        && tokens[first + 2]!.matchesPosTagRegex("VER:(.*INF|PA[12]).*")
        && tokens[last]!.matchesPosTagRegex("VER:(MOD|AUX).*");
  }

  /**
   * is participle
   */
  private static isPar(token: AnalyzedTokenReadings): boolean {
    return token.hasPosTagStartingWith("PA2:") || token.hasPosTagStartingWith("VER:PA2");
  }

  /**
   * is participle plus special combination of two verbs combination
   */
  private static isInfinitivZu(tokens: AnalyzedTokenReadings[], last: number): boolean {
    return tokens[last - 1 ]!.getToken() === "zu" && tokens[last]!.matchesPosTagRegex("VER:.*INF.*");
  }

  /**
   * is verb plus special combination of two verbs combination
   */
  private static isTwoPlusCombinedVerbs(tokens: AnalyzedTokenReadings[], first: number, last: number): boolean {
    return tokens[first]!.matchesPosTagRegex(".*PA[12]:.*") && tokens[last-1]!.matchesPosTagRegex("VER:.*INF.*");
  }

  /**
   * conjunction follows last verb
   */
  private static isKonAfterVerb(tokens: AnalyzedTokenReadings[], start: number, end: number): boolean {
    if (tokens[start]!.matchesPosTagRegex("VER:(MOD|AUX).*") && tokens[start + 1]!.matchesPosTagRegex("(KON|PRP).*")) {
      if (start + 3 === end) {
        return true;
      }
      for (let i = start + 2; i < end; i++) {
        if (tokens[i]!.matchesPosTagRegex("(SUB|PRO:PER).*")) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * two infinitive verbs as pair
   */
  private static isSpecialPair(tokens: AnalyzedTokenReadings[], first: number, second: number): boolean {
    if (first + 3 >= second && tokens[first]!.matchesPosTagRegex("VER:.*INF.*")
        && StringUtils_equalsAny(tokens[first+1]!.getToken(), "als", "noch")
        && tokens[first + 2]!.matchesPosTagRegex("VER:.*INF.*")) {
      if (first + 2 === second) {
        return true;
      }
      return MissingCommaRelativeClauseRule.isTwoCombinedVerbs(tokens[second - 1]!, tokens[second]!);
    }
    return false;
  }

  /**
   * is a pair of verbs to build the perfect
   * (with third: is a pair of verbs to build the perfect)
   */
  private static isPerfect(tokens: AnalyzedTokenReadings[], first: number, second: number, third?: number): boolean {
    if (third !== undefined) {
      return tokens[second]!.matchesPosTagRegex("VER:.*INF.*") && MissingCommaRelativeClauseRule.isPerfect(tokens, first, third);
    }
    return tokens[first]!.hasPosTagStartingWith("VER:AUX:") && tokens[second]!.matchesPosTagRegex("VER:.*(INF|PA2).*");
  }

  /**
   * is Infinitive in combination with substantiv
   */
  private static isSpecialInf(tokens: AnalyzedTokenReadings[], first: number, second: number, start: number): boolean {
    if (!tokens[first]!.hasPosTagStartingWith("VER:INF")) {
      return false;
    }
    for (let i = first - 1; i > start; i--) {
      if (tokens[i]!.hasPosTagStartingWith("ART")) {
        i = MissingCommaRelativeClauseRule.skipSub(tokens, i, second);
        return i > 0;
      }
    }
    return false;
  }

  /**
   * is separator or VER:INF
   */
  private static isSeparatorOrInf(tokens: AnalyzedTokenReadings[], n: number): boolean {
    return MissingCommaRelativeClauseRule.isSeparator(tokens[n]!.getToken()) || tokens[n]!.hasPosTagStartingWith("VER:INF")
        || (tokens.length > n + 1 && tokens[n]!.getToken() === "zu" && tokens[n + 1]!.matchesPosTagRegex("VER:.*INF.*"));
  }

  /**
   * gives back position where a comma is missed
   */
  private static getCommaBehind(tokens: AnalyzedTokenReadings[], verbs: number[], start: number, end: number): number {
    const R = MissingCommaRelativeClauseRule;
    if (verbs.length === 1) {
      if (R.isSeparator(tokens[verbs[0]! + 1]!.getToken())) {
        return -1;
      }
      return verbs[0]!;
    } else if (verbs.length === 2) {
      if (R.isSpecialPair(tokens, verbs[0]!, verbs[1]!)) {
        if (R.isSeparatorOrInf(tokens, verbs[1]! + 1)) {
          return -1;
        }
        return verbs[1]!;
      } else if (verbs[0]! + 1 === verbs[1]) {
        if (R.isTwoCombinedVerbs(tokens[verbs[0]!]!, tokens[verbs[1]!]!)) {
          if (R.isSeparatorOrInf(tokens, verbs[1]! + 1) || R.isKonAfterVerb(tokens, verbs[1]!, end)) {
            return -1;
          }
          return verbs[1]!;
        }
      } else if (verbs[0]! + 2 === verbs[1]) {
        if (R.isThreeCombinedVerbs(tokens, verbs[0]!, verbs[1]!)) {
          if (R.isSeparatorOrInf(tokens, verbs[1]! + 1)) {
            return -1;
          }
          return verbs[1]!;
        }
      }
      if (R.isPar(tokens[verbs[0]!]!) || R.isPerfect(tokens, verbs[0]!, verbs[1]!)
          || R.isInfinitivZu(tokens, verbs[1]!) || R.isSpecialInf(tokens, verbs[0]!, verbs[1]!, start)) {
        if (R.isSeparatorOrInf(tokens, verbs[1]! + 1)) {
          return -1;
        }
        return verbs[1]!;
      }
    } else if (verbs.length === 3) {
      if (R.isTwoPlusCombinedVerbs(tokens, verbs[0]!, verbs[2]!)) {
        if (R.isSeparatorOrInf(tokens, verbs[2]! + 1)) {
          return -1;
        }
        return verbs[2]!;
      } else if (verbs[0]! + 2 === verbs[2]) {
        if (verbs[0]! + 1 === verbs[1] && R.isThreeCombinedVerbs(tokens, verbs[0]!, verbs[2]!)) {
          if (R.isSeparatorOrInf(tokens, verbs[2]! + 1)) {
            return -1;
          }
          return verbs[2]!;
        }
      } else if (verbs[0]! + 3 === verbs[2] && R.isFourCombinedVerbs(tokens, verbs[0]!, verbs[2]!)) {
        if (R.isSeparatorOrInf(tokens, verbs[2]! + 1)) {
          return -1;
        }
        return verbs[2]!;
      } else if (tokens[verbs[2]!]!.hasPosTagStartingWith("VER:MOD:")
          && R.isSpecialPair(tokens, verbs[0]!, verbs[1]!)) {
        if (R.isSeparatorOrInf(tokens, verbs[2]! + 1)) {
          return -1;
        }
        return verbs[2]!;
      }
      if (R.isPerfect(tokens, verbs[0]!, verbs[1]!, verbs[2]!)) {
        if (R.isSeparatorOrInf(tokens, verbs[2]! + 1)) {
          return -1;
        }
        return verbs[1]!;
      }
    }
    return verbs[0]!;
  }

  /**
   * gives back position where a comma is missed
   * PRP has to be treated separately
   */
  private static missedCommaBehind(tokens: AnalyzedTokenReadings[], inFront: number, start: number, end: number): number {
    const R = MissingCommaRelativeClauseRule;
    for (let i = start; i < end; i++) {
      if (R.isPronoun(tokens, i)) {
        const verbs = R.verbPos(tokens, i, end);
        if (verbs.length > 0) {
          const gender = R.getGender(tokens[i]!);
          if (gender != null && !R.isAnyVerb(tokens, i + 1)
              && R.matchesGender(gender, tokens, inFront, i - 1) && !R.isArticle(gender, tokens, i, verbs[verbs.length - 1]!)) {
            return R.getCommaBehind(tokens, verbs, i, end);
          }
        }
      }
    }
    return -1;
  }

  /**
   * checks if personal pronoun is singular or plural
   * gives back null if token is not a  personal pronoun
   */
  private static getSinOrPluOfPro(token: AnalyzedTokenReadings): string | null {
    if (!token.hasPartialPosTag("PRO:PER:") && !token.hasPosTagStartingWith("IND:")) {
      return null;
    }
    let ret = "";
    let nMatches = 0;
    if (token.matchesPosTagRegex(".*:SIN.*")) {
      ret += "SIN";
      nMatches++;
    }
    if (token.matchesPosTagRegex(".*:PLU.*")) {
      if (ret.length !== 0) {
        ret += "|";
      }
      ret += "PLU";
      nMatches++;
    }
    if (nMatches > 1) {
      ret = "(" + ret + ")";
    }
    return ret;
  }

  private static isVerbProPair(tokens: AnalyzedTokenReadings[], n: number): boolean {
    const sinOrPlu = MissingCommaRelativeClauseRule.getSinOrPluOfPro(tokens[n+1]!);
    if (sinOrPlu == null) {
      return false;
    }
    return tokens[n]!.matchesPosTagRegex("VER:.*" + sinOrPlu + ".*");
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const R = MissingCommaRelativeClauseRule;
    const ruleMatches: RuleMatch[] = [];
    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
    if (tokens.length <= 1) {
      return this.toRuleMatchArray(ruleMatches);
    }
    let subStart = 1;
    if (R.isSeparator(tokens[subStart]!.getToken())) {
      subStart++;
    }
    if (this.behind) {
      let subInFront = subStart;
      subStart = R.nextSeparator(tokens, subInFront) + 1;
      while (subStart < tokens.length) {
        const subEnd = R.nextSeparator(tokens, subStart);
        const lastVerb = R.hasPotentialSubclause(tokens, subStart, subEnd);
        if (lastVerb > 0) {
          const nToken = R.missedCommaBehind(tokens, subInFront, subStart, subEnd);
          if ( nToken > 0) {
            if (R.isVerbProPair(tokens, nToken)) {
              const match = new RuleMatch(this, sentence, tokens[nToken - 1]!.getStartPos(), tokens[nToken + 1]!.getEndPos(),
                  "Sollten Sie hier ein Komma einfügen oder zwei?");
              const suggestedReplacements: string[] = [];
              suggestedReplacements.push(tokens[nToken - 1]!.getToken() + ", "
                                  + tokens[nToken]!.getToken() + " " + tokens[nToken + 1]!.getToken() + ",");
              suggestedReplacements.push(tokens[nToken - 1]!.getToken() + " "
                                  + tokens[nToken]!.getToken() + " " + tokens[nToken + 1]!.getToken() + ",");
              suggestedReplacements.push(tokens[nToken - 1]!.getToken() + " "
                                  + tokens[nToken]!.getToken() + ", " + tokens[nToken + 1]!.getToken());
              match.setSuggestedReplacements(suggestedReplacements);
              ruleMatches.push(match);
            } else {
              const match = new RuleMatch(this, sentence, tokens[nToken]!.getStartPos(), tokens[nToken + 1]!.getEndPos(),
                  "Sollten Sie hier ein Komma einfügen?");
              match.setSuggestedReplacement(tokens[nToken]!.getToken() + ", " + tokens[nToken + 1]!.getToken());
              ruleMatches.push(match);
            }
          }
        }
        subInFront = subStart;
        subStart = subEnd + 1;
      }
    } else {
      while (subStart < tokens.length) {
        const subEnd = R.nextSeparator(tokens, subStart);
        const lastVerb = R.hasPotentialSubclause(tokens, subStart, subEnd);
        if (lastVerb > 0) {
          const nToken = R.missedCommaInFront(tokens, subStart, subEnd, lastVerb);
          if ( nToken > 0) {
            const startToken = nToken - (R.isPrp(tokens[nToken - 1]!) ? 2 : 1);
            const match = new RuleMatch(this, sentence, tokens[startToken]!.getStartPos(), tokens[nToken]!.getEndPos(),
              "Sowohl angehängte als auch eingeschobene Relativsätze werden durch Kommas vom Hauptsatz getrennt.");
            if (nToken - startToken > 1) {
              match.setSuggestedReplacement(tokens[startToken]!.getToken() + ", " + tokens[nToken - 1]!.getToken() + " " + tokens[nToken]!.getToken());
            } else {
              match.setSuggestedReplacement(tokens[startToken]!.getToken() + ", " + tokens[nToken]!.getToken());
            }
            ruleMatches.push(match);
          }
        }
        subStart = subEnd + 1;
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return MissingCommaRelativeClauseRule.ANTI_PATTERNS ??= MissingCommaRelativeClauseRule.makeAntiPatterns(ANTI_PATTERN_LIST(), Languages.getLanguageForShortCode("de-DE"));
  }
}
