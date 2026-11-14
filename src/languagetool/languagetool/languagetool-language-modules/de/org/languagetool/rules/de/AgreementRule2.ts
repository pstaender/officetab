// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/AgreementRule2.java faithful
// ANTI_PATTERNS is created on first use. Import cycle with AgreementRule (GrammarCategory is only a type here).
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternTokenBuilder.ts';
import { csRegex, csToken, pos, posRegex, regex, token, tokenRegex } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleBuilderHelper.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { GermanSynthesizer } from '../../synthesis/GermanSynthesizer.ts';
import type { GrammarCategory } from './AgreementRule.ts';
import { AgreementTools } from './AgreementTools.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const uppercaseFirstChar = (str: string): string => StringTools.uppercaseFirstChar(str)!;

const ADJ_GRU = 'Allgemein|Ausgiebig|Stilvoll|Link|Direkt|Gegenseitig|Offensichtlich|Weitgehend|Frei|Prinzipiell|Regelrecht|Kostenlos|Gleichzeitig|Ganzjährig|Überraschend|Entsprechend|Ordentlich|Gelangweilt';
let ANTI_PATTERNS_VALUE: PatternToken[][] | null = null;
const ANTI_PATTERNS = (): PatternToken[][] => (ANTI_PATTERNS_VALUE ??= antiPatterns());

function antiPatterns(): PatternToken[][] {
  return [
    [csRegex("Willkommen|Link|Aktuell|Diverse|Flächendeckend|Entsprechende|Angeblich|Gelegentlich|Antizyklisch|Unbedingt|Zusätzlich|Natürlich|Äußerlich|Erfolgreich|" +
      "Spät|Länger|Vorrangig|Rechtzeitig|Typisch|Allwöchentlich|Wöchentlich|Inhaltlich|Tagtäglich|Täglich|Komplett|" +
      "Genau|Gerade|Bewusst|Vereinzelt|Gänzlich|Ständig|Okay|Meist|Generell|Ausreichend|Genügend|Reichlich|" +
      "Regelmäßig(e|es)?|Unregelmäßig|Hauptsächlich"), posRegex("SUB:.*")],  // "Regelmäßig Kiwis und Ananas zu essen...", "Reichlich Inspiration bietet..."
    [csRegex(ADJ_GRU), posRegex("SUB:.*"), posRegex("VER:.*")],  // "Überraschend Besuch bekommt er dann von ..."
    [csRegex(ADJ_GRU), posRegex("SUB:.*"), posRegex("PRP.*")],  // "Prinzipiell Anrecht auf eine Vertretung..."
    [csRegex(ADJ_GRU), posRegex("SUB:.*"), token(",")],  // "Weitgehend Konsens, auch über ..."
    [csRegex("Gut|Schlecht|Existenziell|Ganz|Gering|Viel|Wenig"), posRegex("SUB:.*ADJ")],  // "Existenziell Bedrohte kriegen..."
    [regex("Nachhaltig|Direkt"), posRegex("SUB:NOM:.*"), posRegex("VER:INF:(SFT|NON)")],  // 'nachhaltig Yoga praktizieren'
    [regex("\\d0er"), regex("Jahren?")],
    [token("Liebe"), token("Mai")],   // Mai = auch Eigenname
    [token("Ganz"), token("Ohr")],
    [token("Klar"), token("Schiff")],
    [token("Echt"), tokenRegex("Scheiße|Mist")],
    [token("Dickes"), token("Danke")],
    [token("Personal"), token("Shopper")],
    [token("Schwäbisch"), token("Hall")],
    [token("Herzlich"), token("Willkommen")],
    [token("Gut"), tokenRegex("Ding|Holz")],  // "Gut Ding will Weile haben"
    [token("Urban"), token("Mining")],
    [token("Responsive"), token("Design")],
    [token("Dual"), token("Studierende")],
    [token("Deutsche"), csRegex("Grammophon|Wohnen")],
    [posRegex("ADJ.*"), tokenRegex(".+beamte")],  // "Alarmierte Polizeibeamte"
    [new PatternTokenBuilder().token("Anderen").setSkip(5).build(), posRegex("VER:INF:(SFT|NON)")],  // "Anderen Brot und Arbeit ermöglichen - ..."
    [regex("echt|absolut|voll|total"), regex("Wahnsinn|Klasse")],
    [pos("SENT_START"), pos("ADJ:PRD:GRU"), posRegex("SUB:NOM:SIN:NEU:INF")],  // "Ruhig Schlafen & Zentral Wohnen"
    [tokenRegex("voll|voller"), posRegex("SUB:NOM:SIN:.*")],  // "Voller Mitleid", "Voller Mitleid"
    [token("einzig"), posRegex("SUB:NOM:.*")],  // "Einzig Fernschüsse brachten Erfolgsaussichten"
    [tokenRegex("Intelligent|Urban"), token("Design")],
    [token("Alternativ"), token("Berufserfahrung")],  // "Alternativ Berufserfahrung im Bereich ..."
    [token("Maritim"), token("Hotel")],
    [csToken("Russisch"), csToken("Brot")],
    [token("ruhig"), csToken("Blut")],
    [token("Blind"), regex("Dates?")],
    [token("Fair"), token("Trade")],
    [token("Frei"), token("Haus")],
    [token("Global"), token("Player")],
    [token("psychisch"), regex("Kranken?")],
    [token("sportlich"), regex("Aktiven?")],
    [token("politisch"), regex("Interessierten?")],
    [token("voraussichtlich"), regex("Ende|Anfang")],
    [regex("gesetzlich|privat|freiwillig"), regex("(Kranken)?Versicherten?")],
    [token("typisch"), posRegex("SUB:.*"), regex("[!?.]")],  // "Typisch November!"
    [token("lecker"), token("Essen")],  // "Lecker Essen an Weihnachten."
    [token("erneut"), posRegex("SUB:.*")],  // "Erneut Ausgangssperre beschlossen"
    [token("Gesetzlich"), regex("Krankenversicherten?")],
    [token("weitgehend"), token("Einigkeit")],      // feste Phrase
    [token("Ernst")],      // Vorname
    [token("Anders")],     // Vorname
    [token("wirklich")],   // "Wirklich Frieden herrscht aber noch nicht"
    [token("gemeinsam")],   // "Gemeinsam Sportler anfeuern"
    [token("wenig")],      // "Wenig Geld - ..."
    [token("weniger")],      // "Weniger Geld - ..."
    [token("unaufgefordert")],      // Unaufgefordert Dinge erledigen
    [token("richtig")],    // "Richtig Kaffee kochen ..."
    [token("weiß")],       // "Weiß Papa, dass ..."
    [token("speziell")],   // "Speziell Flugfähigkeit hat sich unabhängig voneinander ..."
    [token("proaktiv")],   // "Speziell Flugfähigkeit hat sich unabhängig voneinander ..."
    [token("halb")],       // "Halb Traum, halb Wirklichkeit"
    [token("hinter")],     // "Hinter Bäumen"
    [token("vermutlich")], // "Vermutlich Ende 1813 erkrankte..."
    [token("eventuell")], // "Eventuell Ende 1813 erkrankte..."
    [token("ausschließlich")],
    [token("ausschliesslich")],
    [token("bloß")],       // "Bloß Anhängerkupplung und solche Dinge..."
    [token("einfach")],    // "Einfach Bescheid sagen ..."
    [token("egal")],
    [token("endlich")],    // "Endlich Mittagspause!"
    [token("unbemerkt")],    // "Unbemerkt Süßigkeiten essen"
    [token("Typisch"), tokenRegex("Mann|Frau")],    // "Einfach Bescheid sagen ..."
    [token("Ausreichend"), tokenRegex("Bewegung")],    // "Ausreichend Bewegung ..."
    [token("Genau"), token("Null")],
    [token("wohl")],       // "Wohl Anfang 1725 begegnete Bach ..."
    [token("erst")],       // "Erst X, dann ..."
    [token("lieber")],     // "Lieber X als Y"
    [token("besser")],     // "Besser Brot ohne Butter..."
    [token("laut")],       // "Laut Fernsehen"
    [token("research")],   // engl.
    [token("researchs")],  // engl.
    [token("security")],   // engl.
    [token("business")],   // oft engl.
    [token("Universal")],   // oft engl.
    [token("voll"), token("Sorge")],
    [token("Total"), tokenRegex("Tankstellen?")],
    [token("Ganz"), token("Gentleman")],
    [token("Kurz"), token("Zeit"), tokenRegex("für|um")], // Kurz Zeit für einen Call?
    [token("Golden"), token("Gate")],
    [token("Wirtschaftlich"), tokenRegex("Berechtigte[rn]?")],
    [token("Russisch"), token("Roulette")],
    [token("Clever"), tokenRegex("Shuttles?")], // name
    [token("Personal"), tokenRegex("(Computer|Coach|Trainer|Brand).*")],
    [tokenRegex("Digital|Fair|Regional|Global|Bilingual|International|National|Visual|Final|Rapid|Dual|Golden|Human"), tokenRegex("(Initiative|Office|Connection|Bootcamp|Leadership|Sales|Community|Service|Management|Board|Identity|City|Paper|Transfer|Transformation|Power|Shopping|Brand|Master|Gate|Drive|Learning|Publishing|Signage|Value|Entertainment|Museum|Register|Society|Union|Institute|Symposium|Style|Design|Edition).*")],
    [token("Smart")],
    [token("International"), tokenRegex("Society|Olympic|Space")],
    [token("GmbH")]
  ];
}

/**
 * Simple agreement checker for German noun phrases. Checks agreement in:
 *
 * <ul>
 *  <li>SENT_START ADJ NOUN: e.g. "Wirtschaftlicher Wachstum" (incorrect), "Wirtschaftliches Wachstum" (correct)</li>
 * </ul>
 *
 * @author Daniel Naber
 */
export class AgreementRule2 extends Rule {

  private readonly antiPatterns: () => DisambiguationPatternRule[];

  constructor(messages: ResourceBundle, language: Language) {
    super();
    this.setCategory(Categories.GRAMMAR.getCategory(messages));
    this.addExamplePair(Example.wrong('<marker>Kleiner Haus</marker> am Waldrand'),
                   Example.fixed('<marker>Kleines Haus</marker> am Waldrand'));
    this.antiPatterns = AgreementRule2.cacheAntiPatterns(language, ANTI_PATTERNS());
  }

  override getId(): string {
    return 'DE_AGREEMENT2';
  }

  override getDescription(): string {
    return "Kongruenz von Adjektiv und Nomen (unvollständig!), z.B. 'kleiner (kleines) Haus'";
  }

  override estimateContextForSureMatch(): number {
    return ANTI_PATTERNS().reduce((max, l) => Math.max(max, l.length), 0);
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns();
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!.getToken();
      if (!tokens[i]!.isSentenceStart() && !['"', '„', '»', '«'].includes(token)) {
        // skip quotes, as these are not relevant
        if (i + 1 < tokens.length && tokens[i]!.hasPosTagStartingWith('ADJ') && tokens[i + 1]!.hasPosTagStartingWith('SUB') && !tokens[i + 1]!.hasPosTagStartingWith('EIG')) {
          if (tokens[i]!.isImmunized() || tokens[i + 1]!.isImmunized() || StringEqualsIgnoreCase(tokens[i]!.getToken(), 'unter')) {
            continue;
          }
          const nextToken = i + 2 < tokens.length ? tokens[i + 2]! : null;
          if (nextToken != null && nextToken.hasPosTagStartingWith('SUB')) {
            // no alarm for e.g. "Deutscher Taschenbuch Verlag"
            break;
          }
          const ruleMatch = this.checkAdjNounAgreement(tokens[i]!, tokens[i + 1]!, sentence);
          if (ruleMatch != null) {
            const suggestions = this.getSuggestions(tokens, i);
            ruleMatch.setSuggestedReplacements(suggestions);
            ruleMatches.push(ruleMatch);
            break;
          }
        } else {
          // rule only works at sentence start (minus quotes)
          break;
        }
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private getSuggestions(tokens: AnalyzedTokenReadings[], i: number): string[] {
    const suggestions: string[] = [];
    const adjToken = tokens[i]!.getAnalyzedToken(0);
    for (const nounToken of tokens[i + 1]!.getReadings()) {
      if (nounToken.getPOSTag() == null) {
        continue;
      }
      const gender = AgreementRule2.getGender(nounToken);
      if (gender == null) {
        continue;
      }
      const number = AgreementRule2.getNumber(nounToken);
      if (number == null) {
        continue;
      }
      const forms = GermanSynthesizer.INSTANCE.synthesize(adjToken, 'ADJ:NOM:' + number + ':' + gender + ':GRU:SOL', true);
      for (const s of forms) {
        const fullSugg = uppercaseFirstChar(s) + ' ' + nounToken.getToken();
        if (!suggestions.includes(fullSugg)) {
          suggestions.push(fullSugg);
        }
      }
    }
    return suggestions;
  }

  private static getGender(nounToken: AnalyzedToken): string | null {
    let gender: string;
    if (nounToken.getPOSTag()!.includes(':MAS')) {
      gender = 'MAS';
    } else if (nounToken.getPOSTag()!.includes(':FEM')) {
      gender = 'FEM';
    } else if (nounToken.getPOSTag()!.includes(':NEU')) {
      gender = 'NEU';
    } else {
      return null;
    }
    return gender;
  }

  private static getNumber(nounToken: AnalyzedToken): string | null {
    let number: string;
    if (nounToken.getPOSTag()!.includes(':SIN:')) {
      number = 'SIN';
    } else if (nounToken.getPOSTag()!.includes(':PLU:')) {
      number = 'PLU';
    } else {
      return null;
    }
    return number;
  }

  private checkAdjNounAgreement(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings, sentence: AnalyzedSentence): RuleMatch | null {
    const set = this.retainCommonCategories(token1, token2);
    let ruleMatch: RuleMatch | null = null;
    if (set.size === 0) {
      const msg = 'Möglicherweise fehlende grammatikalische Übereinstimmung zwischen Adjektiv und ' +
            "Nomen bezüglich Kasus, Numerus oder Genus. Beispiel: 'kleiner Haus' statt 'kleines Haus'";
      const shortMsg = 'Möglicherweise keine Übereinstimmung bezüglich Kasus, Numerus oder Genus';
      ruleMatch = new RuleMatch(this, sentence, token1.getStartPos(), token2.getEndPos(), msg, shortMsg);
    }
    return ruleMatch;
  }

  private retainCommonCategories(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings): Set<string> {
    const categoryToRelaxSet = new Set<GrammarCategory>();
    // finds more error but also more false alarms? see commented out cases in testSuggestion():
    //Set<String> set1 = AgreementTools.getAgreementSOLCategories(token1, categoryToRelaxSet);
    const set1 = AgreementTools.getAgreementCategories(token1, categoryToRelaxSet, false);
    //System.out.println(token1 + " -> " + set1);
    const set2 = AgreementTools.getAgreementCategories(token2, categoryToRelaxSet, false);
    //System.out.println(token2 + " -> " + set2);
    for (const s of set1) {  // set1.retainAll(set2)
      if (!set2.has(s)) {
        set1.delete(s);
      }
    }
    //System.out.println("==>"+set1);
    return set1;
  }

}
