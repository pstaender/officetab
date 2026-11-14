// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/SubjectVerbAgreementRule.java faithful
// The static ANTI_PATTERNS are created on first use. List.contains of ChunkTags uses Java's equals
// (List_contains). StringUtils.equalsAny is a local function. The nested class SingularPluralPair
// is a module-level class.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import { ChunkTag } from '../../../../../../languagetool-core/org/languagetool/chunking/ChunkTag.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternTokenBuilder.ts';
import { csRegex, csToken, pos, posRegex, regex, token, tokenRegex } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleBuilderHelper.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { List_contains } from '../../../../../../../jdk/java/util/Objects.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import type { German } from '../../language/German.ts';
import type { GermanTagger } from '../../tagging/de/GermanTagger.ts';

/** StringUtils.equalsAny(cs, searchCharSequences...) */
function StringUtils_equalsAny(cs: string | null, ...searchCharSequences: string[]): boolean {
  return searchCharSequences.some((s) => s === cs);
}

class SingularPluralPair {
  singular: string;
  plural: string;
  constructor(singular: string, plural: string) {
    this.singular = singular;
    this.plural = plural;
  }
}

const NPS = new ChunkTag("NPS"); // noun phrase singular
const NPP = new ChunkTag("NPP"); // noun phrase plural
const PP = new ChunkTag("PP");   // prepositional phrase etc.
const QUESTION_PRONOUNS: readonly string[] = ["wie"];
const CURRENCIES: readonly string[] = ["Dollar", "Euro", "Yen"];

const PAIRS: readonly SingularPluralPair[] = [
  new SingularPluralPair("ist", "sind"),
  new SingularPluralPair("war", "waren")
  //new SingularPluralPair("geht", "gehen")  // false alarm: "Wohin möchtest du nächsten Sonntag gehen?"
  // add more pairs here to activate more cases step by step
];

let antiPatternList: PatternToken[][] | null = null;
const ANTI_PATTERNS = (): PatternToken[][] => (antiPatternList ??= [
    [
      // "Zwei Schülern war aufgefallen, dass man im Fernsehen..."
      pos("ZAL"),
      posRegex("SUB:DAT:PLU:.*"),
      csRegex("war|ist"),
      new PatternTokenBuilder().posRegex("NEG|PA2:.+").build()
    ],
    [  // "Wie viel Prozent der Menschen sind total bescheuert?"
      token("Prozent"),
      token("der"),
      posRegex("SUB:.*:PLU:.*"),
      csRegex("sind|waren")
    ],
    [  // "Die meisten der Spieler sind nicht vermögend"
      token("meisten"),
      token("der"),
      posRegex("SUB:.*:PLU:.*"),
      csRegex("sind|waren")
    ],
    [  // "er bemerkte, dass Experimente nicht gerade sein Ding sind"
      posRegex("SUB:.*:PLU:.*"),
      new PatternTokenBuilder().token("nicht").setSkip(1).build(),
      posRegex("PRO:.*"),
      csRegex("Ding"),
      csRegex("sind|waren")
    ],
    [  // "Wenn Sie kein Teil der Lösung sind, ..."
      token("Teil"),
      token("der"),
      token("Lösung"),
      csRegex("sind|waren")
    ],
    [
      // "Auch Studien zu Zink sind vielversprechend."
      posRegex("SUB:NOM:PLU:.*"),
      token("zu"),
      posRegex("SUB:.*"),
      tokenRegex("sind|waren")
    ],
    [
      // "Glaubt wirklich jemand, dass gute Fotos keine Arbeit sind?"
      posRegex("SUB:.*:PLU:.*"),
      regex("keine|wenig|kaum|viel"),
      posRegex("SUB:.*:SIN:.*"),
      token("sind")
    ],
    [
      // "Auch die Zehn Gebote sind Ausdruck davon."
      token("Zehn"),
      token("Gebote"),
      token("sind")
    ],
    [
      // "All diesen Stadtteilen ist die Nähe zum Hamburger Hafen..."
      token("all"),
      tokenRegex("d(ies)?en"),
      posRegex("SUB:.*PLU.*"),
      token("ist"),
      posRegex("ART:.*"),
      posRegex("SUB:.*SIN.*")
    ],
    [
      // "Personen ist der Zugriff auf diese Daten verboten."
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      new PatternTokenBuilder().token("Solchen").min(0).build(),
      posRegex("SUB:.*PLU.*"),
      token("ist"),
      posRegex("ART:.*"),
      posRegex("SUB:.*SIN.*")
    ],
    [
      // "Auch die Reste eines sehr großen Insektenfressers sind unter den Fossilien." - Chunker zu fixen wäre die bessere Lösung...
      tokenRegex("Reste|Überreste"),
      tokenRegex("eines|des"),
      posRegex("ADV:.*"),
      posRegex("ADJ:.*"),
      posRegex("SUB:.*SIN.*"),
      tokenRegex("sind")
    ],
    [
      // "Die eiförmigen und oben abgerundeten Blätter sind grün." - Chunker zu fixen wäre die bessere Lösung...
      posRegex("ADJ:.*"),
      tokenRegex("und|sowie"),
      posRegex("ADV:.*"),
      posRegex("PA2:.*"),
      posRegex("SUB:.*PLU.*"),
      tokenRegex("sind")
    ],
    [
      // Gründer und Leiter des Zentrums ist der Rabbiner Marvin Hier, sein Stellvertreter ist Rabbi Abraham Cooper.
      tokenRegex("Gründer(in)?|Gesellschafter(in)?|Leiter(in)?|Geschäftsführer(in)?|Chef(in)?"),
      tokenRegex("und|sowie|&"),
      new PatternTokenBuilder().tokenRegex("Gründer(in)?|Gesellschafter(in)?|Leiter(in)?|Geschäftsführer(in)?|Chef(in)?").setSkip(4).build(),
      tokenRegex("ist")
    ],
    [
      tokenRegex("ist|war"),
      token("gemeinsam")
    ],
    [
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      pos("ZAL"),
      tokenRegex("Minuten|Stunden|Tage|Monate|Jahre|Jahrzehnte"),
      posRegex("VER:3:SIN:.*")
    ],
    [
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      tokenRegex("einige|viele|wenige|mehrere"),
      tokenRegex("Minuten|Stunden|Tage|Monate|Jahre|Jahrzehnte"),
      posRegex("VER:3:SIN:.*")
    ],
    [
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      posRegex("ADV:MOD|ADJ:PRD:GRU"),
      pos("ZAL"),
      tokenRegex("Minuten|Stunden|Tage|Monate|Jahre|Jahrzehnte"),
      posRegex("VER:3:SIN:.*")
    ],
    [
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      new PatternTokenBuilder().pos("PRP:CAU:GEN").setSkip(4).build(),
      new PatternTokenBuilder().csToken("und").setSkip(4).build(),
      tokenRegex("ist|war")
    ],
    [
      posRegex(JLanguageTool.SENTENCE_START_TAGNAME+"|KON:UNT"),
      posRegex("(EIG|SUB):.*"),
      new PatternTokenBuilder().csToken("und").setSkip(3).build(),
      tokenRegex("sind|waren")
    ],
    [
      pos("KON:UNT"),
      new PatternTokenBuilder().token("sie").setSkip(3).build(),
      tokenRegex("sind|waren")
    ],
    [ //Bei komplexen und andauernden Störungen ist der Stress-Stoffwechsel des Hundes entgleist.
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      new PatternTokenBuilder().posRegex("PRP:.+").setSkip(4).build(),
      tokenRegex("ist|war"),
      tokenRegex("d(as|er)|eine?")
    ],
    [
      posRegex("SUB:NOM:PLU:.+"),
      csToken("vor"),
      csToken("Ort"),
      tokenRegex("sind|waren")
    ],
    [
      token("zu"),
      csRegex("Fuß|Hause|Bein|Besuch"),
      tokenRegex("sind|waren")
    ],
    [ //Eltern ist der bisherige Kita-Öffnungsplan zu unkonkret
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      pos("SUB:DAT:PLU:NOG"),
      tokenRegex("ist|war"),
      posRegex(".+:NOM:.+")
    ],
    [ // Das Gestell, sowie der komplette Tisch sind leicht zu montieren.
      posRegex("SUB:.+"),
      new PatternTokenBuilder().pos("PKT").min(0).build(),
      token("sowie"),
      posRegex("ART.*"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      posRegex("SUB:.+"),
      tokenRegex("sind|waren")
    ],
    [ // Das saisonale Obst und Gemüse ist köstlich und oft deutlich günstiger als in der Stadt.
      tokenRegex("das"),
      posRegex("(ADJ|PA[12]).*NEU.*"),
      posRegex("SUB:.*NEU.*"),
      tokenRegex("und"),
      posRegex("SUB:.*NEU.*"),
      tokenRegex("ist|war")
    ],
    [ // Das saisonale Obst und Gemüse ist köstlich und oft deutlich günstiger als in der Stadt.
      tokenRegex("der"),
      posRegex("(ADJ|PA[12]).*MAS.*"),
      posRegex("SUB:.*MAS.*"),
      tokenRegex("und"),
      posRegex("SUB:.*MAS.*"),
      tokenRegex("ist|war")
    ],
    [ // Das saisonale Obst und Gemüse ist köstlich und oft deutlich günstiger als in der Stadt.
      tokenRegex("die"),
      posRegex("(ADJ|PA[12]).*FEM.*"),
      posRegex("SUB:.*FEM.*"),
      tokenRegex("und"),
      posRegex("SUB:.*FEM.*"),
      tokenRegex("ist|war")
    ],
    [ // Einer der bedeutendsten Māori-Autoren der Gegenwart ist Witi Ihimaera.
      tokenRegex("(irgend)?einer?|meisten|viele|einige|Betreiber|(Mit)?Gründer|Inhaber"),
      new PatternTokenBuilder().tokenRegex("der|dieser").setSkip(4).build(),
      tokenRegex("ist|war")
    ],
    [ // Dank unserer Kunden, Freunde, Partner und unserer Mitarbeiter ist Alpenwahnsinn zur Heimatadresse für schöne Trachtenmode geworden.
      new PatternTokenBuilder().token("dank").setSkip(-1).build(),
      tokenRegex("ist|war"),
      posRegex("EIG.*|SUB.*SIN.*")
    ],
    [ // Start und Ziel ist Innsbruck
      token("Start"),
      token("und"),
      token("Ziel"),
      tokenRegex("ist|war")
    ],
    [ // Abschluss und Höhepunkt ist der Festumzug
      posRegex("SUB.*SIN.*"),
      token("und"),
      posRegex("SUB.*SIN.*"),
      tokenRegex("ist|war")
    ],
    [ // Frisches Obst und Gemüse ist gut für die Gesundheit.
      token("Obst"),
      token("und"),
      token("Gemüse")
    ],
    [
      token("Sport"),
      token("und"),
      token("Spiel")
    ],
    [ // Das bedeutendste Bauwerk und Wahrzeichen der Stadt ist die …
      token("das"),
      posRegex("(ADJ|PA[12]).*NEU.*"),
      posRegex("SUB.*NEU.*"),
      token("und"),
      posRegex("SUB.*NEU.*"),
      tokenRegex("der|dieser"),
      posRegex("SUB.*"),
      tokenRegex("ist|war")
    ],
    [ // Die bedeutendsten Bauwerke und Wahrzeichen der Stadt ist die …
      token("die"),
      posRegex("(ADJ|PA[12]).*PLU.*"),
      posRegex("SUB.*PLU.*"),
      token("und"),
      posRegex("SUB.*PLU.*"),
      tokenRegex("der|dieser"),
      posRegex("SUB.*"),
      tokenRegex("sind|waren")
    ],
    [ // Die neueste Auflage von Toms Kindheitserinnerungen ist schon wieder vergriffen.
      posRegex("(ADJ|PA[12]|ART).*SIN.*"),
      posRegex("SUB.*SIN.*"),
      posRegex("PRP.*"),
      posRegex("EIG.*GEN.*"),
      posRegex("SUB.*"),
      tokenRegex("ist|war")
    ],
    [ // Die Aussichten für Japans Zukunft sind düster.
      posRegex("(ADJ|PA[12]|ART).*PLU.*"),
      posRegex("SUB.*PLU.*"),
      posRegex("PRP.*"),
      posRegex("EIG.*GEN.*"),
      posRegex("SUB.*"),
      tokenRegex("sind|waren")
    ],
    [ // Anfänger wie auch Fortgeschrittene sind herzlich willkommen!
      posRegex("SUB.*PLU.*"),
      token("wie"),
      token("auch"),
      tokenRegex(".+"),
      tokenRegex("sind|waren")
    ],
    [
      // "Heute ist sie lieb."
      tokenRegex("ist|war|wäre?"),
      posRegex("EIG:NOM:SIN.*|PRO:PER:NOM:SIN.*"),
      posRegex("ADJ:PRD:GRU")
    ],
    [
      // "Heute bist du lieb."
      tokenRegex("bist|w[äa]rst"),
      tokenRegex("du"),
      posRegex("ADJ:PRD:GRU")
    ],
    [
      // "Heute waren sie lieb."
      tokenRegex("sind|w[äa]ren|seid"),
      posRegex("PRO:PER:NOM:PLU.*"),
      posRegex("ADJ:PRD:GRU")
    ],
    [ // Der Eifer der Männer und Frauen ist enorm.
      pos("SUB:NOM:SIN:MAS"),
      posRegex("ART:...:GEN:PLU:MAS"),
      posRegex("SUB:GEN:PLU:.+"),
      pos("KON:NEB"),
      posRegex("SUB:GEN:PLU:.+"),
      tokenRegex("ist|w[äa]r")
    ],
    [ // Einer der bedeutendsten Māori-Autoren der Gegenwart ist Witi Ihimaera.
      new PatternTokenBuilder().csToken("Laut").setSkip(4).build(),
      new PatternTokenBuilder().csToken("und").setSkip(5).build(),
      tokenRegex("ist|war"),
      tokenRegex("d(er|ie|as)"),
      posRegex("SUB:NOM:SIN:.+")
    ],
    [ // Für Tunesiens Tourismusindustrie mit seinen Stränden, Oasen und antiken Kulturschätzen ist das Attentat ein verheerender Rückschlag.
      tokenRegex("ist|war"),
      tokenRegex("d(er|ie|as)"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      posRegex("SUB:NOM:SIN:.+"),
      posRegex("(ART|PRO:POS).*SIN.*"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      posRegex("SUB:NOM:SIN:.+")
    ],
    [ // Die gute Nachricht vorweg: Die Mehrheit der Ehen sind tatsächlich ein Bund fürs Leben.
      tokenRegex("die"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      tokenRegex("Mehrheit"),
      tokenRegex("der|dieser|aller|unse?rer|[dsm]einer|euer|eurer|ihrer"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      posRegex("SUB.*NOM.*PLU.*"),
      tokenRegex("sind|w[äa]ren")
    ],
    [ // Man darf jedoch auch nicht glauben, weil die Brustvergrößerungscremes ein Allheilmittel sind, jedoch sind Sie optimal um Ihr Selbstvertrauen zu erhöhen
      tokenRegex("weil|da|denn|dass"),
      tokenRegex("die|diese|solche|alle|viele|beide|einige|[mkds]eine|eure|unse?re|ihre"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      posRegex("SUB.*NOM.*PLU.*"),
      tokenRegex("ein"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      posRegex("SUB.*NOM.*SIN.*"),
      tokenRegex("sind|w[äa]ren")
    ],
    [ // Die Rechte der Kinder sind universell.
      tokenRegex("alle|die(se)?|einige|keine|viele|solche"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      posRegex("SUB.*NOM.*PLU.*"),
      tokenRegex("der|unse?rer|euer|eurer|[dsm]einer|dieser|solcher|aller|einiger|vieler|ihrer|beider"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      posRegex("SUB.*GEN.*PLU.*"),
      posRegex("VER.*PLU.*")
    ],
    [
      // Ich verspreche dir, dass wir ein tolles Team sind.
      tokenRegex("wir|sie|die|alle|diese|einige|manche|viele|sonstige"),
      posRegex("ART.*|PRO:(POS|DEM|IND).*"),
      new PatternTokenBuilder().posRegex("(ADJ|PA[12]).*").min(0).build(),
      posRegex("SUB.*SIN.*"),
      posRegex("VER.*PLU.*")
    ],
    [
      // Ich verspreche dir, dass wir ein wirklich tolles Team sind.
      tokenRegex("wir|sie|die|alle|diese|einige|manche|viele|sonstige"),
      posRegex("ART.*|PRO:(POS|DEM|IND).*"),
      posRegex("(ADJ|PA[12]).*|ADV.*"),
      posRegex("(ADJ|PA[12]).*"),
      posRegex("SUB.*SIN.*"),
      posRegex("VER.*PLU.*")
    ],
    [
      new PatternTokenBuilder().token("sie").setSkip(-1).build(),
      tokenRegex("sind|w[äa]ren")
    ],
    [
      tokenRegex("weder"),
      tokenRegex("er|es|sie"),
      new PatternTokenBuilder().token("noch").setSkip(-1).build(),
      tokenRegex("sind|w[äa]ren")
    ],
    [
      new PatternTokenBuilder().posRegex("SUB.*PLU.*").setSkip(5).build(),
      tokenRegex("sind|w[äa]ren")
    ],
    [
      // Halte ich für unwahrscheinlich, dass es Spannungsspitzen sind.
      new PatternTokenBuilder().posRegex("SUB.*INF|SUB.*PLU.*").build(),
      tokenRegex("sind|w[äa]ren")
    ],
    [
      tokenRegex("Teile"),
      tokenRegex("de[rs]|diese[sr]|[msd]?eine[rs]"),
      new PatternTokenBuilder().posRegex("SUB.*|EIG.*|UNKNOWN").setSkip(-1).build(),
      tokenRegex("sind|w[äa]ren")
    ],
    [
      tokenRegex("viele|alle"),
      new PatternTokenBuilder().posRegex("SUB.*ADJ").tokenRegex(".+e").build(),
      tokenRegex("sind|w[äa]ren")
    ],
    [
      // Sinn und Zweck dieser Prüfung ist, herauszufinden, ob der Druck
      tokenRegex("Sinn"),
      tokenRegex("und"),
      new PatternTokenBuilder().tokenRegex("Zweck").setSkip(-1).build(),
      tokenRegex("ist|war")

    ]
  ]);

/**
 * Check subject verb agreement for verb forms "ist", "sind", "war" and "waren".
 * For example, it detects the errors in:
 * <ul>
 *   <li>Das Auto sind schnell.</li>
 *   <li>Das Auto waren schnell.</li>
 *   <li>Die Autos ist schnell.</li>
 *   <li>Die Katze und der Hund ist schön.</li>
 * </ul>
 * See <a href="http://wiki.languagetool.org/german-agreement-check">our wiki</a>
 * for documentation of the steps this rule relies on.
 * @since 2.9
 */
export class SubjectVerbAgreementRule extends Rule {

  private readonly singular = new Set<string>();
  private readonly plural = new Set<string>();

  private readonly antiPatterns: () => DisambiguationPatternRule[];
  private readonly language: German;

  constructor(messages: ResourceBundle, language: German) {
    super();
    this.language = language;
    super.setCategory(Categories.GRAMMAR.getCategory(messages));
    for (const pair of PAIRS) {
      this.singular.add(pair.singular);
      this.plural.add(pair.plural);
    }
    this.addExamplePair(Example.wrong("Die Autos <marker>ist</marker> schnell."),
                   Example.fixed("Die Autos <marker>sind</marker> schnell."));
    this.antiPatterns = SubjectVerbAgreementRule.cacheAntiPatterns(language, ANTI_PATTERNS());
  }

  override getId(): string {
    return "DE_SUBJECT_VERB_AGREEMENT";
  }

  override getDescription(): string {
    return "Kongruenz von Subjekt und Prädikat (unvollständig)";
  }

  override estimateContextForSureMatch(): number {
    return ANTI_PATTERNS().reduce((max, l) => Math.max(max, l.length), 0);
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns();
  }

  override getUrl(): string | null {
    return Tools.getUrl("https://dict.leo.org/grammatik/deutsch/Wort/Verb/Kategorien/Numerus-Person/ProblemNum.html");
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
    for (let i = 1; i < tokens.length; i++) {   // start at 1 to skip SENT_START
      if (tokens[i]!.isImmunized()) {
        continue;
      }
      const tokenStr = tokens[i]!.getToken();
      // Detect e.g. "Der Hund und die Katze ist":
      const singularMatch = this.getSingularMatchOrNull(tokens, i, tokens[i]!, tokenStr, sentence);
      if (singularMatch != null) {
        ruleMatches.push(singularMatch);
      }
      // Detect e.g. "Der Hund sind":
      const pluralMatch = this.getPluralMatchOrNull(tokens, i, tokens[i]!, tokenStr, sentence);
      if (pluralMatch != null) {
        ruleMatches.push(pluralMatch);
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private getSingularMatchOrNull(tokens: AnalyzedTokenReadings[], i: number, token: AnalyzedTokenReadings, tokenStr: string, sentence: AnalyzedSentence): RuleMatch | null {
    if (this.singular.has(tokenStr)) {
      const prevToken = tokens[i - 1]!;
      const nextToken = i + 1 < tokens.length ? tokens[i + 1]! : null;
      const prevChunkTags = prevToken.getChunkTags();
      const match = List_contains(prevChunkTags, NPP)
                      && !List_contains(prevChunkTags, PP)
                      && prevToken.getToken() !== "Uhr"   // 'um 18 Uhr ist Feierabend'
                      && !this.isCurrency(prevToken)
                      && !(nextToken != null && nextToken.getToken() === "es")   // 'zehn Jahre ist es her'
                      && this.prevChunkIsNominative(tokens, i-1)
                      && !this.hasUnknownTokenToTheLeft(tokens, i)
                      && !this.hasQuestionPronounToTheLeft(tokens, i-1)
                      && !this.hasVerbToTheLeft(tokens, i-1)
                      && !this.containsRegexToTheLeft("wer|(?i)alle[nr]?|(?i)jede[rs]?|(?i)manche[nrs]?", tokens, i-1)
                      && !this.containsOnlyInfinitivesToTheLeft(tokens, i-1);
      if (match) {
        const message = "Bitte prüfen, ob hier <suggestion>" + this.getPluralFor(tokenStr) + "</suggestion> stehen sollte.";
        return new RuleMatch(this, sentence, token.getStartPos(), token.getEndPos(), message);
      }
    }
    return null;
  }

  private getPluralMatchOrNull(tokens: AnalyzedTokenReadings[], i: number, token: AnalyzedTokenReadings, tokenStr: string, sentence: AnalyzedSentence): RuleMatch | null {
    if (this.plural.has(tokenStr)) {
      const prevToken = tokens[i - 1]!;
      const prevChunkTags = prevToken.getChunkTags();
      const nextToken = i + 1 < tokens.length ? tokens[i + 1]! : null;
      const match = List_contains(prevChunkTags, NPS)
                      && !(nextToken != null && nextToken.getToken() === "Sie")   // 'Eine Persönlichkeit sind Sie selbst.'
                      && !List_contains(prevChunkTags, NPP)
                      && !List_contains(prevChunkTags, PP)
                      && !this.isCurrency(prevToken)
                      && this.prevChunkIsNominative(tokens, i-1)
                      && !this.hasUnknownTokenToTheLeft(tokens, i)
                      && !this.hasUnknownTokenToTheRight(tokens, i+1)
                      && !StringUtils_equalsAny(tokens[1]!.getToken(), "Alle", "Viele") // "Viele Brunnen in Italiens Hauptstadt sind bereits abgeschaltet."
                      && !this.isFollowedByNominativePlural(tokens, i+1);  // z.B. "Die Zielgruppe sind Männer." - beides Nominativ, aber 'Männer' ist das Subjekt
      if (match) {
        const message = "Bitte prüfen, ob hier <suggestion>" + this.getSingularFor(tokenStr) + "</suggestion> stehen sollte.";
        return new RuleMatch(this, sentence, token.getStartPos(), token.getEndPos(), message);
      }
    }
    return null;
  }

  private isCurrency(token: AnalyzedTokenReadings): boolean {
    return CURRENCIES.includes(token.getToken());
  }

  prevChunkIsNominative(tokens: AnalyzedTokenReadings[], startPos: number): boolean {
    for (let i = startPos; i > 0; i--) {
      const chunkTags = tokens[i]!.getChunkTags();
      if (List_contains(chunkTags, NPS) || List_contains(chunkTags, NPP)) {
        if (tokens[i]!.hasPartialPosTag("NOM")) {
          return true;
        }
      } else {
        return false;
      }
    }
    return false;
  }

  // needed to avoid false alarms, because we cannot unify noun phrases if we cannot analyse a noun
  private hasUnknownTokenToTheLeft(tokens: AnalyzedTokenReadings[], startPos: number): boolean {
    return this.hasUnknownTokenAt(tokens, 0, startPos);
  }

  private hasUnknownTokenToTheRight(tokens: AnalyzedTokenReadings[], startPos: number): boolean {
    return this.hasUnknownTokenAt(tokens, startPos, tokens.length-1);
  }

  private hasUnknownTokenAt(tokens: AnalyzedTokenReadings[], startPos: number, endPos: number): boolean {
    for (let i = startPos; i < endPos; i++) {
      const token = tokens[i]!;
      for (const analyzedToken of token.getReadings()) {
        if (analyzedToken.hasNoTag()) {
          return true;
        }
      }
    }
    return false;
  }

  private hasQuestionPronounToTheLeft(tokens: AnalyzedTokenReadings[], startPos: number): boolean {
    for (let i = startPos; i > 0; i--) {
      if (QUESTION_PRONOUNS.includes(tokens[i]!.getToken().toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  private hasVerbToTheLeft(tokens: AnalyzedTokenReadings[], startPos: number): boolean {
    for (let i = startPos; i > 0; i--) {
      if (tokens[i]!.matchesPosTagRegex("VER:[1-3]:.+")) {
        return true;
      }
    }
    return false;
  }

  private containsRegexToTheLeft(regex: string, tokens: AnalyzedTokenReadings[], startPos: number): boolean {
    const p = Pattern.compile(regex);
    for (let i = startPos; i > 0; i--) {
      if (p.matcher(tokens[i]!.getToken()).matches()) {
        return true;
      }
    }
    return false;
  }

  // No false alarm on ""Das Kopieren und Einfügen ist sehr nützlich." etc.
  private containsOnlyInfinitivesToTheLeft(tokens: AnalyzedTokenReadings[], startPos: number): boolean {
    let infinitives = 0;
    for (let i = startPos; i > 0; i--) {
      const token = tokens[i]!.getToken();
      if (tokens[i]!.hasPartialPosTag("SUB:")) {
        const lookup = (this.language.getTagger() as GermanTagger).lookup(token.toLowerCase());
        if (lookup != null && lookup.hasPosTagStartingWith("VER:INF")) {
          infinitives++;
        } else {
          return false;
        }
      }
    }
    return infinitives >= 2;
  }

  isFollowedByNominativePlural(tokens: AnalyzedTokenReadings[], startPos: number): boolean {
    for (let i = startPos; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.hasAnyPartialPosTag("SUB", "PRO")
          && (token.hasPartialPosTag("NOM:PLU") || List_contains(token.getChunkTags(), NPP))) {  // NPP catches 'und' phrases
        return true;
      }
    }
    return false;
  }

  private getSingularFor(token: string): string {
    for (const pair of PAIRS) {
      if (pair.plural === token) {
        return pair.singular;
      }
    }
    throw new Error("RuntimeException: No singular found for '" + token + "'");
  }

  private getPluralFor(token: string): string {
    for (const pair of PAIRS) {
      if (pair.singular === token) {
        return pair.plural;
      }
    }
    throw new Error("RuntimeException: No plural found for '" + token + "'");
  }
}
