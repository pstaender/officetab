// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanWordRepeatRule.java faithful
// The static ANTI_PATTERNS are created on first use.
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { WordRepeatRule } from '../../../../../../languagetool-core/org/languagetool/rules/WordRepeatRule.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternTokenBuilder.ts';
import { csToken, posRegex, token, tokenRegex } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleBuilderHelper.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const SINGLE_CHAR = Pattern.compile('(?i)^[a-z]$');

let antiPatternList: PatternToken[][] | null = null;
const ANTI_PATTERNS = (): PatternToken[][] => (antiPatternList ??= [

    [
      csToken("please"),
      csToken("please"),
      csToken("please")
    ],
    [
      csToken("Late"),
      csToken("Late"),
      csToken("Show")
    ],
    [
      csToken("Wenn"),
      csToken("hinter"),
      csToken("Robben"),
      csToken("Robben"),
      csToken("robben"),
      csToken(","),
      csToken("robben"),
      csToken("Robben"),
      csToken("Robben"),
      csToken("hinterher")
    ],
    [
      tokenRegex("tägliche(n|m|s)?"),
      csToken("klein"),
      csToken("klein")
    ],
    [
      csToken("Bora"),
      csToken("Bora")
    ],
    [
      csToken("Tuk"),
      csToken("Tuk")
    ],
    [
      csToken("Miu"),
      csToken("Miu")
    ],
    [
      token("Moin"),
      token("Moin")
    ],
    [
      token("Na"),
      token("na")
    ],
    [ // La La Land / la la la ...
      token("la"),
      token("la")
    ],
    [ // "Bei Fragen fragen"
      csToken("Fragen"),
      csToken("fragen")
    ],
    [
      token("ha"),
      token("ha")
    ],
    [
      token("teils"),
      token("teils")
    ],
    [
      token("Marsch"),
      token("Marsch")
    ],
    [
      token("hip"),
      token("hip"),
      token("hurra")
    ],
    [
      token("möp"),
      token("möp")
    ],
    [
      token("gout"),
      token("gout")
    ],
    [
      token("piep"),
      token("piep")
    ],
    [
      token("bla"),
      token("bla")
    ],
    [
      token("blah"),
      token("blah")
    ],
    [
      token("oh"),
      token("oh")
    ],
    [
      token("klopf"),
      token("klopf")
    ],
    [
      token("ne"),
      token("ne")
    ],
    [
      token("Fakten"),
      token("Fakten"),
      token("Fakten")
    ],
    [
      token("Top"),
      token("Top"),
      token("Top")
    ],
    [
      token("Toi"),
      token("Toi"),
      token("Toi")
    ],
    [
      token("und"),
      token("und"),
      token("und")
    ],
    [
      token("man"),
      token("man"),
      token("man")
    ],
    [
      tokenRegex("wenn|falls"),
      token("das"),
      token("das"),
      token("nächste"),
      token("mal")
    ],
    [
      token("Arbeit"),
      token("Arbeit"),
      token("Arbeit")
    ],
    [ // Art Direktor*in in der ...
      tokenRegex("\\*|:|\\/"),
      token("in"),
      token("in")
    ],
    [
      token("Üben"),
      token("Üben"),
      token("Üben")
    ],
    [
      token("cha"),
      token("cha")
    ],
    [
      token("zack"),
      token("zack")
    ],
    [
      token("sapiens"),
      token("sapiens")
    ],
    [
      token("peng"),
      token("peng")
    ],
    [
      token("bye"),
      token("bye")
    ],
    [ // Man kann nicht nicht kommunizieren
      token("nicht"),
      token("nicht"),
      token("kommunizieren")
    ],
    [ // Dee Dee Ramone
      token("Dee"),
      tokenRegex("Dees?")
    ],
    [ // Phi Phi Islands
      token("Phi"),
      token("Phi")
    ],
    [ // Ich weiß, wer wer ist!
      tokenRegex(",|wei(ß|ss)|nicht"),
      token("wer"),
      token("wer"),
      tokenRegex("war|ist|sein")
    ],
    [ // Wahrscheinlich ist das das Problem.
      tokenRegex("ist|war|wäre?|für|dass"),
      token("das"),
      token("das"),
      posRegex(".*SUB:.*NEU.*")
    ],
    [ // Wahrscheinlich ist das das Problem.
      tokenRegex("ist|war|wäre?|für|dass"),
      token("das"),
      token("das"),
      posRegex("ADJ:.*"),
      posRegex(".*SUB:.*NEU.*")
    ],
    [ // Wahrscheinlich ist das das Problem.
      tokenRegex("ist|war|wäre?|für|dass"),
      token("das"),
      token("das"),
      posRegex("ADJ:.*NEU.*"),
      posRegex("UNKNOWN")
    ],
    [ // Als wir das das erste Mal
      tokenRegex("als|wenn"),
      posRegex("(PRO|EIG):.*"),
      token("das"),
      token("das"),
      posRegex("ADJ:.*NEU.*"),
      posRegex(".*SUB:.*NEU.*")
    ],
    [ // Werden sie sie töten?
      tokenRegex("werden|würden|sollt?en|müsst?en|könnt?en"),
      token("sie"),
      token("sie"),
      posRegex("VER:1:PLU:.*")
    ],
    [ // Falls das das Problem ist, …
      tokenRegex("wenn|falls|ob"),
      token("das"),
      token("das"),
      posRegex("SUB:NOM:SIN:NEU.*"),
      new PatternTokenBuilder().tokenRegex("sein|haben").matchInflectedForms().build()
    ],
    [ // Falls das das neue Problem ist, …
      tokenRegex("wenn|falls|ob"),
      token("das"),
      token("das"),
      posRegex("(ADJ|PA[12]).*NEU.*"),
      posRegex("SUB:NOM:SIN:NEU.*"),
      new PatternTokenBuilder().tokenRegex("sein|haben").matchInflectedForms().build()
    ],
    [// "wie Honda und Samsung, die die Bezahlung ihrer Firmenchefs..."
      csToken(","),
      new PatternTokenBuilder().csToken("der").matchInflectedForms().build(),
      new PatternTokenBuilder().csToken("der").matchInflectedForms().build()
    ],
    [// "Alle die die"
      tokenRegex("alle|nur|obwohl|lediglich|für|zwar|aber"),
      new PatternTokenBuilder().csToken("die").build(),
      new PatternTokenBuilder().csToken("die").build()
    ],
    [// "Haben die die Elemente ..."
      posRegex("PKT|SENT_START|KON:NEB"),
      tokenRegex("haben|hatten"),
      new PatternTokenBuilder().csToken("die").build(),
      new PatternTokenBuilder().csToken("die").build(),
      posRegex(".*SUB.*PLU.*|UNKNOWN")
    ],
    [// "und ob die die Währungen ..."
      posRegex("PKT|SENT_START|KON:NEB"),
      tokenRegex("ob|falls"),
      new PatternTokenBuilder().csToken("die").build(),
      new PatternTokenBuilder().csToken("die").build(),
      posRegex(".*SUB.*PLU.*|UNKNOWN")
    ],
    [// "Das Haus, in das das Kind läuft."
      csToken(","),
      posRegex("PRP:.+"),
      new PatternTokenBuilder().csToken("der").matchInflectedForms().build(),
      new PatternTokenBuilder().csToken("der").matchInflectedForms().build()
    ],
    [// "Er will sein Leben leben"
      csToken("Leben"),
      csToken("leben")
    ],
    [// "Die markierten Stellen stellen die Aufnahmepunkte dar."
      csToken("Stellen"),
      csToken("stellen")
    ],
    [// "Wir reisen in die ferne Ferne."
      token("die"),
      csToken("ferne"),
      csToken("Ferne")
    ],
    [// "Er muss sein Essen essen"
      csToken("Essen"),
      csToken("essen")
    ],
    [
      tokenRegex("^[_]+$"),
      tokenRegex("^[_]+$")
    ],
    [// "Er gab ihr ihr Buch zurück."
      posRegex("VER:.*[123]:.+|PKT|ADV:INR"),
      csToken("ihr"),
      csToken("ihr"),
      posRegex("SUB.+")
    ]
  
  ]);

/**
 * Check if a word is repeated twice, taking into account an exception
 * for German where e.g. "..., die die ..." is often okay.
 *
 * @author Daniel Naber
 */
export class GermanWordRepeatRule extends WordRepeatRule {

  private readonly antiPatterns: () => DisambiguationPatternRule[];

  constructor(messages: ResourceBundle, language: Language) {
    super(messages, language);
    super.setCategory(Categories.REDUNDANCY.getCategory(messages));
    this.addExamplePair(Example.wrong('In diesem Satz <marker>ist ist</marker> ein Wort doppelt.'),
                   Example.fixed('In diesem Satz <marker>ist</marker> ein Wort doppelt.'));
    this.antiPatterns = GermanWordRepeatRule.cacheAntiPatterns(language, ANTI_PATTERNS());
  }

  override getId(): string {
    return 'GERMAN_WORD_REPEAT_RULE';
  }

  override ignore(tokens: AnalyzedTokenReadings[], position: number): boolean {
    // "Warum fragen Sie sie nicht selbst?"
    if (position !== 2 && tokens[position - 1]!.getToken() === 'Sie' && tokens[position]!.getToken() === 'sie' ||
        tokens[position - 1]!.getToken() === 'sie' && tokens[position]!.getToken() === 'Sie') {
      return true;
    }
    // "Ihre verbotenen Waren waren bisher nicht aufgeflogen"
    if (position !== 2 && tokens[position - 1]!.getToken() === 'Waren' && tokens[position]!.getToken() === 'waren' ||
        tokens[position - 1]!.getToken() === 'waren' && tokens[position]!.getToken() === 'Waren') {
      return true;
    }
    if (position > 2 && tokens[position - 1]!.getToken() === 'sie' && tokens[position]!.getToken() === 'sie') {
      if (tokens[position - 2]!.hasPosTag('KON:UNT')) {
        // "Sie tut das, damit sie sie nicht fortschickt"
        return true;
      }
      if (tokens.length - 1 > position
        && ((tokens[position - 2]!.hasPosTagStartingWith('VER:3:') && tokens[position + 1]!.hasPosTag('ZUS')) // "Dann warfen sie sie weg."
            || (tokens[position - 2]!.hasPosTagStartingWith('VER:MOD:3') && tokens[position + 1]!.hasPosTag('VER:INF:NON')))) {// "Dann konnte sie sie sehen."
          return true;
      }
    }
    if (SINGLE_CHAR.matcher(tokens[position]!.getToken()).matches() &&
          position > 1 &&
          SINGLE_CHAR.matcher(tokens[position - 2]!.getToken()).matches() &&
          (position + 1 < tokens.length) &&
          SINGLE_CHAR.matcher(tokens[position + 1]!.getToken()).matches()) {
      // spelling with spaces in between: "A B B A"
      return true;
    }
    return super.ignore(tokens, position);
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns();
  }
}
