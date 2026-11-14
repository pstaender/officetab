// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/VerbAgreementRule.java faithful
// The static ANTI_PATTERNS and COMMA are created on first use. The private overload
// match(AnalyzedSentence, int, AnalyzedSentence) is matchPartialSentence (TypeScript has one
// match). The suggestions of getVerbSuggestions go through a Java HashSet, whose iteration order
// (by String.hashCode bucket) decides the order of equally similar suggestions: HashSet_toList
// reproduces it. StringUtils.equalsAny and LevenshteinDistance are local functions.
import { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { TextLevelRule } from '../../../../../../languagetool-core/org/languagetool/rules/TextLevelRule.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternTokenBuilder.ts';
import { csToken, pos, posRegex, regex, token, tokenRegex } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleBuilderHelper.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Character } from '../../../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import type { German } from '../../language/German.ts';

/** StringUtils.equalsAny(cs, searchCharSequences...) */
function StringUtils_equalsAny(cs: string | null, ...searchCharSequences: string[]): boolean {
  return searchCharSequences.some((s) => s === cs);
}

/** LevenshteinDistance.getDefaultInstance().apply(left, right) (Apache Commons Text, no threshold). */
function LevenshteinDistance_apply(left: string, right: string): number {
  let n = left.length;
  let m = right.length;
  if (n === 0) return m;
  if (m === 0) return n;
  if (n > m) {
    const tmp = left;
    left = right;
    right = tmp;
    n = m;
    m = right.length;
  }
  const p = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) p[i] = i;
  for (let j = 1; j <= m; j++) {
    let upperLeft = p[0]!;
    const rightJ = right.charAt(j - 1);
    p[0] = j;
    for (let i = 1; i <= n; i++) {
      const upper = p[i]!;
      const cost = left.charAt(i - 1) === rightJ ? 0 : 1;
      p[i] = Math.min(Math.min(p[i - 1]! + 1, p[i]! + 1), upperLeft + cost);
      upperLeft = upper;
    }
  }
  return p[n]!;
}

/** String.hashCode */
function stringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * new ArrayList<>(new HashSet<>(c)): the distinct elements in java.util.HashSet's iteration
 * order (table of tableSizeFor(max(c.size() / .75 + 1, 16)) buckets, which addAll never resizes;
 * bucket (h ^ h >>> 16) & (n - 1), insertion order within a bucket).
 */
function HashSet_toList(c: readonly string[]): string[] {
  const initialCapacity = Math.max(Math.trunc(c.length / 0.75) + 1, 16);
  let n = 1;
  while (n < initialCapacity) n <<= 1;
  const buckets = new Map<number, string[]>();
  const seen = new Set<string>();
  for (const s of c) {
    if (seen.has(s)) continue;
    seen.add(s);
    const h = stringHashCode(s);
    const index = (h ^ (h >>> 16)) & (n - 1);
    let bucket = buckets.get(index);
    if (bucket === undefined) buckets.set(index, bucket = []);
    bucket.push(s);
  }
  return [...buckets.keys()].sort((a, b) => a - b).flatMap((k) => buckets.get(k)!);
}

class BooleanAndFiniteVerb {
  verbDoesMatchPersonAndNumber: boolean;
  finiteVerb: AnalyzedTokenReadings | null;
  constructor(verbDoesMatchPersonAndNumber: boolean, finiteVerb: AnalyzedTokenReadings | null) {
    this.verbDoesMatchPersonAndNumber = verbDoesMatchPersonAndNumber;
    this.finiteVerb = finiteVerb;
  }
}

let antiPatternList: PatternToken[][] | null = null;
const ANTI_PATTERNS = (): PatternToken[][] => (antiPatternList ??= [
    [ // "Ken dachte, du wärst ich."
      token("du"),
      token("wärst"),
      token("ich")
    ],
    [ // "*runterguck* das ist aber tief" (Inflektiv)
      token("*"),
      posRegex("VER:1:SIN:PRÄ:.*"),
      token("*")
    ],
    [ // "Weder Peter noch ich wollen das."
      new PatternTokenBuilder().token("weder").setSkip(8).build(),
      token("noch"),
      token("ich")
    ],
    [ // "Kümmerst dich ja gar nicht um sie." (okay for colloquial language)
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      posRegex("VER:2:SIN:PRÄ:.*"),
      posRegex("PRO:.*")
    ],
    [ // "Stehst einfach nicht zu mir." (okay for colloquial language)
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      posRegex("VER:2:SIN:PRÄ:.*"),
      tokenRegex("einfach|denn|schon")
    ],
    [ // "Stellst für deinen Dad etwas zu Essen bereit." (okay for colloquial language)
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      posRegex("VER:2:SIN:PRÄ:.*"),
      posRegex("PRP:.*")
    ],
    [ // "Springst weit, oder?" (okay for colloquial language)
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      posRegex("VER:2:SIN:PRÄ:.*"),
      posRegex("ADJ:PRD:.*")
    ],
    [ // "Siehst aus wie ein Wachhund." (okay for colloquial language)
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      posRegex("VER:2:SIN:PRÄ:.*"),
      pos("ZUS")
    ],
    [ // "Könntest was erfinden, wie dein Papa." (okay for colloquial language)
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      pos("VER:MOD:2:SIN:KJ2"),
      posRegex("PRO:.*")
    ],
    [ // "Darfst nicht so reden, Franz!" (okay for colloquial language)
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      pos("VER:MOD:2:SIN:PRÄ"),
      new PatternTokenBuilder().token("ich|er|sie|es|wir|ihr|sie").negate().build()
    ],
    [  // "sobald wir frische und neue Akkus haben."
      token("wir"),
      token("frische")
    ],
    [  // "wo der Stadtrat gleich mal zum Du übergeht."
      token("zum"),
      csToken("Du"),
      new PatternTokenBuilder().tokenRegex("wechseln|übergehen|schwenken").matchInflectedForms().build()
    ],
    [
      token("ich"),
      token("schlafen"),
      token("gehe")
    ],
    [
      // Ich bin du
      token("ich"),
      tokenRegex("bin|war"),
      token("du")
    ],
    [
      // Dann beende du den Auftrag und bring sie ihrem Vater.
      tokenRegex("darum|deswegen|dann|bitte|so|,|-"),
      posRegex("VER:IMP:SIN.*"),
      token("du")
    ],
    [
      // - Wirst du ausflippen?
      tokenRegex("[-–]"),
      posRegex("VER:.*(AUX|MOD).*"),
      token("du"),
      posRegex("VER:INF.*")
    ],
    [
      tokenRegex("-(du|ich|er|sie|wir|ihr)"),
      posRegex("VER.*")
    ],
    [
      tokenRegex("bin|war|wär"),
      tokenRegex("i|icke?")
    ],
    [
      tokenRegex("i|icke?"),
      tokenRegex("bin|war|wär")
    ],
    [
      token("du"),
      token("schlafen"),
      token("gehst")
    ],
    [
      token("per"),
      token("du"),
      tokenRegex("sind|waren|sein|wären|war|ist|gewesen")
    ],
    [
      token("schnellst"),
      token("möglich")
    ],
    [
      // "Da freut er sich, wenn er schlafen geht und was findet."
      token("er"),
      token("schlafen"),
      token("geht")
    ],
    [
      token("vermittelst")  // "Sie befestigen die Regalbretter vermittelst dreier Schrauben."
    ],
    [
      token("du"),
      token("denkst"),
      token("ich")
    ],
    [
      token("na"),
      token("komm")
    ],
    [
      tokenRegex("muß|mußten?|müßt?en?"), // alte rechtschreibung (andere fehler)
      tokenRegex("ich|wir|sie|er|es")
    ],
    [
      tokenRegex("ich|wir|sie|er|es"),
      posRegex("VER.*INF.*"),
      tokenRegex("muß|mußten?|müßt?en?") // alte rechtschreibung (andere fehler)
    ],
    [
      tokenRegex("mußt|müßtest|mußtest"), // alte rechtschreibung (andere fehler)
      token("du")
    ],
    [
      token("du"),
      posRegex("VER.*INF.*"),
      tokenRegex("mußt|müßtest|mußtest") // alte rechtschreibung (andere fehler)
    ],
    [
      token("ich"),
      tokenRegex("würd|könnt|werd|wollt|sollt|müsst|fürcht"),
      tokenRegex("['’`´‘]")
    ],
    [
      tokenRegex("wir|sie|zu"),
      tokenRegex("seh|steh|geh"),
      tokenRegex("['’`´‘]"),
      token("n")
    ],
    [
      token("ick"), // different error (berlinerisch)
      tokenRegex("bin|war|wär|hab|hatte")
    ],
    [
      // hash tag
      token("#"),
      posRegex("VER.*")
    ],
    [
      // wie du war ich auch
      token("wie"),
      tokenRegex("du|ihr|er|es|sie"),
      posRegex("VER.*")
    ],
    [
      tokenRegex("[-:]"),
      posRegex("VER.*(MOD|AUX).*")
    ],
    [
      // Arabic names: Aryat Abraha bin Sabah Kaaba
      posRegex("UNKNOWN|EIG.*"),
      token("bin"),
      posRegex("UNKNOWN|EIG.*")
    ],
    [
      // Du scheiß Idiot
      tokenRegex("du|sie"),
      tokenRegex("schei(ß|ss)"),
      posRegex("SUB.*|UNKNOWN")
    ],
     [
       token("Du"),
       tokenRegex("bist|warst|wärst")
     ],
     [
       token("als"),
       token("auch"),
       tokenRegex("er|sie|wir|du|ich|ihr")
     ],
     [
       tokenRegex("so|wie|zu"),
       token("lange"),
       tokenRegex("er|sie|wir|du|ich|ihr")
     ],
     [
       // Ich will nicht so wie er enden.
       new PatternTokenBuilder().tokenRegex("so|genauso|ähnlich").matchInflectedForms().setSkip(2).build(),
       token("wie"),
       tokenRegex("er|sie|du|ihr|ich"),
       posRegex("VER.*")
     ],
     [
       // Ich will wie er aussehen
       posRegex("VER.*(MOD|AUX).*"),
       token("wie"),
       tokenRegex("er|sie|du|ihr|ich"),
       posRegex("VER.*INF.*")
     ],
     [
       // Ich will wie er aussehen
       token("wie"),
       posRegex("ADJ:PRD:GRU.*"),
       tokenRegex("er|sie|du|ihr|ich"),
       posRegex("VER.*")
     ],
    [
      // "Bekommst sogar eine Sicherheitszulage"
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      posRegex("VER:2:SIN:.*"),
      posRegex("ART.*|ADV.*|PRO:POS.*")
    ],
    [
      // "A, B und auch ich"
      token(","),
      posRegex("EIG:.*|UNKNOWN"),
      regex("und|oder"),
      token("auch"),
      token("ich")
    ],
    [
      // "Dallun sagte nur, dass er gleich kommen wird und legte wieder auf."
      // "Sie fragte, ob er bereit für die zweite Runde ist."
      posRegex("VER.*"),  // z.B. "Bist"
      tokenRegex("er|sie|ich|wir|du|es|ihr"),
      tokenRegex("gleich|bereit|lange|schnelle?|halt|bitte|dank")  // ist hier kein Verb
    ],
    [
      // "Dallun sagte nur, dass er gleich kommen wird und legte wieder auf."
      posRegex("ADV.*|KON.*"),
      tokenRegex("er|sie|ich|wir|du|es|ihr"),
      tokenRegex("gleich|bereit|lange|schnelle?|halt|bitte|dank")  // ist hier kein Verb
    ],
    [
      // "Woraufhin ich verlegen lächelte"
      posRegex("ADV.*|KON.*"),
      tokenRegex("er|sie|ich|wir|du|es|ihr"),
      tokenRegex("verlegen"),
      posRegex("VER.*")
    ],
    [
      // "Bringst nicht einmal so etwas Einfaches zustande!"
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      posRegex("VER:2:SIN:.*"),
      token("nicht")
    ],
    [
      // "Da machte er auch vor dem eigenen Volk nicht halt."
      new PatternTokenBuilder().token("machen").matchInflectedForms().setSkip(-1).build(),
      token("halt")
    ],
    [  // "Ich hoffe du auch."
      posRegex("VER:.*"),
      tokenRegex("du|ihr"),
      token("auch")
    ],
    [
      // "Für Sie mache ich eine Ausnahme."
      token("für"),
      token("Sie"),
      pos("VER:3:SIN:KJ1:SFT"),
      token("ich")
      ],
    [
      // "Einer wie du kennt ...", "Aber wenn jemand wie Du daherkommt"
      tokenRegex("(irgend)?einer?|(irgend)?jemand"),
      token("wie"),
      token("du"),
      posRegex("VER:3:.*")
    ],
    [
      // "Kannst mich gerne anrufen" (ugs.)
      pos("VER:MOD:2:SIN:PRÄ"),
      posRegex("PRO:PER:.*")
    ],
    [
      tokenRegex("die|welche"),
      tokenRegex(".*"),
      tokenRegex("mehr|weniger"),
      token("als"),
      tokenRegex("ich|du|e[rs]|sie")
    ],
    [
      token("wenn"),
      token("du"),
      token("anstelle")
    ],
    [ // "Ok bin ab morgen bei euch." (umgangssprachlich, benötigt eigene Regel)
      tokenRegex("ok(ay)?|ja|nein|vielleicht|oh"),
      tokenRegex("bin|sind")
    ],
    [
      token("das"),
      csToken("Du"),
      new PatternTokenBuilder().token("anbieten").matchInflectedForms().build()
    ],
    [
      csToken("Du"),  // "jemanden mit Du anreden"
      new PatternTokenBuilder().tokenRegex("anreden|ansprechen").matchInflectedForms().build()
    ],
    [
      posRegex("SUB:.*PLU.*"),
      token("wie"),  // "Schreibtischtäter wie Du sind doch eher selten."
      token("Du"),
      posRegex("VER:3:PLU.*")
    ],
    [
      token("würd"),
      tokenRegex("[nm]ich|man|ichs|'")
    ],
    [
      token(","),
      posRegex("VER:MOD:2:.*")
    ],
    [
      csToken("Soll"),
      token("ich")
    ],
    [
      csToken("Solltest"),
      token("du")
    ],
    [
      csToken("Müsstest"), // Müsstest dir das mal genauer anschauen.
      token("dir")
    ],
    [
      csToken("Könntest"), // Könntest dir mal eine Scheibe davon abschneiden!
      token("dir")
    ],
    [
      csToken("Sollte"),
      tokenRegex("er|sie")
    ],
    [
      pos(JLanguageTool.SENTENCE_START_TAGNAME),  // "Bin gleich wieder da"
      tokenRegex("Bin|Kannst|Musst")
    ],
    [
      token(","),  // "..., hast aber keine Ahnung!"
      tokenRegex("bin|hast|kannst|musst")
    ],
    [
      token("er"),  // "egal, was er sagen wird, ..."
      posRegex("VER:.*"),
      token("wird")
    ],
    [
      tokenRegex("wie|als"),  // "Ein Mann wie ich braucht einen Hut"
      token("ich"),
      posRegex("VER:.*")
    ],
    [
      tokenRegex("glaube?|denke?|hoffe?|vermute?|behaupte?|wette?"),  // "Wir haben da ein monatliches Limit, in das wir glaube ich schon für September reingelaufen sind."
      token("ich"),
      posRegex("ADV.*|SUB.*|UNKNOWN|ADJ.*|PA[12].*|ART.*|PRP.*|PRO.*")
    ],
    [
      tokenRegex("ich"),  // "Ich weiß, was ich tun werde, falls etwas geschehen sollte."
      pos("VER:INF:NON"),
      token("werde")
    ],
    [
      posRegex("VER:IMP:SIN:.*"),  // "Kümmere du dich mal nicht darum!"
      token("du"),
      tokenRegex("dich|dein|deine[srnm]?|mal")
    ],
    [
      posRegex("VER:IMP:SIN:.*"),  // "Nee, geh du!"
      token("du"),
      token("!")
    ],
    [
      token("sei"),
      token("du"),
      token("selbst")
    ],
    [
      token("bin"),
      tokenRegex("dran|dabei")
    ],
    [
      token("als"),  // "Du bist in dem Moment angekommen, als ich gegangen bin."
      token("ich"),
      posRegex("PA2:.*"),
      token("bin")
    ],
    [
     token("als"),
     tokenRegex("du|e[rs]|sie|ich"),
     new PatternTokenBuilder().token("sein").matchInflectedForms().build(),
     tokenRegex("[\\.,]")
    ],
    [ // Musst du gehen?
     tokenRegex("D[au]rf.*|Muss.*"),
     posRegex("PRO:PER:NOM:.+"),
     posRegex("VER:INF:.+"),
     pos("PKT"),
     tokenRegex("(?!die).+")
    ],
    [
     csToken("("),
     posRegex("VER:2:SIN:.+"),
     csToken(")")
    ],
    [
     posRegex("VER:MOD:1:PLU:.+"),
     csToken("wir"),
     csToken("bitte")
    ],
    [ // Ohne sie hätte ich das nie geschafft.
     token("ohne"),
     token("sie"),
     token("hätte"),
     token("ich")
    ],
    [ // Geh du mal!
      pos(JLanguageTool.SENTENCE_START_TAGNAME),
      posRegex("VER:IMP:SIN.+"),
      token("du"),
      new PatternTokenBuilder().csToken("?").negate().build()
    ],
    [ // -Du fühlst dich unsicher?
      tokenRegex("[^a-zäöüß]+du"),
      pos("VER:2:SIN:PRÄ:SFT")
    ],
    [ // Mir ist bewusst, dass viele Menschen wie du empfinden.
      posRegex("PRO:IND.*"),
      posRegex("SUB:.+:PLU.*"),
      tokenRegex("wie|als"),
      posRegex("PRO:PER.+"),
      posRegex("VER:[1-3]:PLU.*")
    ],
    [ //Weniger als du arbeitet keiner.
      pos("ADV:MOD"),
      tokenRegex("als"),
      posRegex("PRO:PER.+"),
      posRegex("VER:3:SIN.*"),
      posRegex("PRO:IND:NOM:SIN.*")
    ],
    [ //So was wie er könnte ich nicht machen, dich einfach dann zu verlassen
      posRegex("PRO:IND.*"),
      tokenRegex("wie"),
      posRegex("PRO:PER.+"),
      posRegex("VER:.*:SIN.*"),
      posRegex("PRO:PER:NOM:SIN.*")
    ],
    [ //Kein anderer als du kann mich glücklich machen
      tokenRegex("kein|keine"),
      tokenRegex("anderer|andere"),
      token("als"),
      tokenRegex("ich|du|er|sie|es"),
      posRegex("VER:MOD.*:PRÄ")
    ],
    [ // Ich will nicht die gleiche Luft wie er einatmen
      posRegex("ART:DEF.*"),
      tokenRegex("gleich(e|en)|selb(e|en)"),
      posRegex("SUB:.+"),
      token("wie"),
      posRegex("PRO:PER:NOM:SIN.*"),
      posRegex("VER:INF.*")
    ],
    [ // Was würdest du sagen, wenn du ich wärst?
      token("wenn"),
      posRegex("PRO:PER:NOM:SIN.+"),
      posRegex("PRO:PER:NOM.+"),
      posRegex("VER:AUX:[1-3]:SIN:KJ2")
    ],
    [ // Was würdet ihr sagen, wenn ihr ich wärt?
      token("wenn"),
      posRegex("PRO:PER:NOM:PLU.+"),
      posRegex("PRO:PER:NOM.+"),
      posRegex("VER:AUX:[1-3]:PLU:KJ2")
    ],
    [ //Wenn du gehen willst, dann geh!
      token("wenn"),
      token("du"),
      token("gehen"),
      token("willst"),
      token(","),
      token("dann"),
      token("geh")
    ],
    [ //Ich habe mich noch nicht entschieden, ob ich studieren oder arbeiten gehen soll.
      token("ob"),
      token("ich"),
      posRegex("VER:1.+"),
      token("oder"),
      posRegex("VER:1.+"),
      new PatternTokenBuilder().token("gehen").matchInflectedForms().build(),
      posRegex("VER:MOD:1.*")
    ],
    [ //Mal seh’n, wie’s Wetter wird.
      token("mal"),
      token("seh"),
      tokenRegex("’|'"),
      token("n")
    ]
  ]);

// Words that prevent a rule match when they occur directly before "bin":
const BIN_IGNORE: ReadonlySet<string> = new Set([
  "Suleiman",
  "Mohamed",
  "Muhammad",
  "Muhammed",
  "Mohammed",
  "Mohammad",
  "Mansour",
  "Qaboos",
  "Qabus",
  "Tamim",
  "Majid",
  "Salman",
  "Ghazi",
  "Mahathir",
  "Madschid",
  "Maktum",
  "al-Aziz",
  "Asis",
  "Numan",
  "Hussein",
  "Abdul",
  "Abdulla",
  "Abdullah",
  "Isa",
  "Osama",
  "Said",
  "Zayid",
  "Zayed",
  "Hamad",
  "Chalifa",
  "Raschid",
  "Turki",
  "/"
]);

const CONJUNCTIONS: ReadonlySet<string> = new Set([
  "weil",
  "obwohl",
  "dass",
  "indem",
  "sodass"/*,
  "damit",
  "wenn"*/
]);

const QUOTATION_MARKS: ReadonlySet<string> = new Set([
  "\"", "„"
]);
let comma: Pattern | null = null;
const COMMA = (): Pattern => (comma ??= Pattern.compile("‚", Pattern.LITERAL));

/**
 * Simple agreement checker for German verbs and subject. Checks agreement in:
 * 
 * <ul>
 *  <li>VER:1:SIN w/o ich: e.g. "Max bin da." (incorrect) [same for VER:2:SIN w/o du, VER:1:PLU w/o wir]</li>
 *  <li>ich + VER:[123]:.* (not VER:1:SIN): e.g. "ich bist" (incorrect) [same for du, er, wir]</li> 
 * </ul>
 * 
 * TODO:
 * <ul>
 * <li>wenn nur ein mögliches finites Verb -&gt; das nehmen (Max machen das.)
 * <li>Sie (i&gt;1)
 * <li>bei ich/du/er/wir sofort prüfen, damit alle vorkommen geprüft werden (Ich geht jetzt nach Hause und dort gehe ich sofort unter die Dusche.) [aber: isNear]
 * <li>Alle Verbvorkommen merken (Er präsentieren wollte und Video hätte keine Pläne.)
 * </ul>
 * 
 * @author Markus Brenneis
 */
export class VerbAgreementRule extends TextLevelRule {

  private readonly language: German;
  private readonly antiPatterns: () => DisambiguationPatternRule[];

  constructor(messages: ResourceBundle, language: German) {
    super();
    this.language = language;
    super.setCategory(Categories.GRAMMAR.getCategory(messages));
    this.addExamplePair(Example.wrong("Ich <marker>bist</marker> über die Entwicklung sehr froh."),
                   Example.fixed("Ich <marker>bin</marker> über die Entwicklung sehr froh."));
    this.antiPatterns = VerbAgreementRule.cacheAntiPatterns(language, ANTI_PATTERNS());
  }
  
  override getId(): string {
    return "DE_VERBAGREEMENT";
  }
  
  override getDescription(): string {
    return "Kongruenz von Subjekt und Prädikat (nur 1. u. 2. Person oder m. Personalpronomen), z.B. 'Er bist (ist)'";
  }
  
  override match(sentences: AnalyzedSentence[] | AnalyzedSentence): RuleMatch[] {
    if (!Array.isArray(sentences)) {
      throw new Error("Not implemented for a text-level rule");
    }
    const ruleMatches: RuleMatch[] = [];
    let pos = 0;
    for (const sentence of sentences) {
      let idx = 0;
      const tokens = sentence.getTokens();
      let partialSentence: AnalyzedSentence;
      for (let i = 2; i < tokens.length; i++) {
        if ("," === tokens[i-2]!.getToken() && CONJUNCTIONS.has(tokens[i]!.getToken())) {
          partialSentence = new AnalyzedSentence(tokens.slice(idx, i));
          ruleMatches.push(...this.matchPartialSentence(partialSentence, pos, sentence));
          idx = i;
        }
      }
      partialSentence = new AnalyzedSentence(tokens.slice(idx, tokens.length));
      ruleMatches.push(...this.matchPartialSentence(partialSentence, pos, sentence));
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  /** The private match(AnalyzedSentence sentence, int pos, AnalyzedSentence wholeSentence). */
  private matchPartialSentence(sentence: AnalyzedSentence, pos: number, wholeSentence: AnalyzedSentence): RuleMatch[] {

    const finiteVerb: AnalyzedTokenReadings | null = null;
    const ruleMatches: RuleMatch[] = [];
    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
    
    if (tokens.length < 4) { // ignore one-word sentences (3 tokens: SENT_START, one word, SENT_END)
      return ruleMatches;
    }
    
    // position of the pronouns:
    let posIch = -1;
    let posDu = -1;
    let posEr = -1;
    let posWir = -1;
    // positions of verbs which do match in person and number, and do not match any other person nor number:
    let posVer1Sin = -1;
    let posVer2Sin = -1;
    let posVer1Plu = -1;
    /*int posVer2Plu = -1;*/
    // positions of verbs which do match in person and number:
    let posPossibleVer1Sin = -1;
    let posPossibleVer2Sin = -1;
    let posPossibleVer3Sin = -1;
    let posPossibleVer1Plu = -1;
    /*int posPossibleVer2Plu = -1;*/
    
    for (let i = 1; i < tokens.length; ++i) { // ignore SENT_START

      let strToken = tokens[i]!.getToken().toLowerCase();
      strToken = COMMA().matcher(strToken).replaceAll("");

      switch (strToken) {
        case "ich":
          posIch = i;
          break;
        case "du":
          posDu = i;
          break;
        case "er":
          posEr = i;
          break;
        case "wir":
          posWir = i;
          break;
      }
      
      if (tokens[i]!.hasPartialPosTag("VER")
          && (Character.isLowerCase(tokens[i]!.getToken().charAt(0)) || i === 1 || this.isQuotationMark(tokens[i-1]!)) ) {
        if (this.hasUnambiguouslyPersonAndNumber(tokens[i]!, "1", "SIN")
            && !(strToken === "bin" && (BIN_IGNORE.has(tokens[i-1]!.getToken())
                  || (tokens.length !== i + 1 && tokens[i+1]!.getToken().startsWith("Laden")) ))) {
          posVer1Sin = i;
        } 
        else if (this.hasUnambiguouslyPersonAndNumber(tokens[i]!, "2", "SIN") && "Probst" !== tokens[i]!.getToken()) {
          posVer2Sin = i;
        } else if (this.hasUnambiguouslyPersonAndNumber(tokens[i]!, "1", "PLU")) {
          posVer1Plu = i;
//      } else if (hasUnambiguouslyPersonAndNumber(tokens[i], "2", "PLU")) {
//        posVer2Plu = i;
        }
        
        if (tokens[i]!.hasPartialPosTag(":1:SIN")) {
          posPossibleVer1Sin = i;
        }
        if (tokens[i]!.hasPartialPosTag(":2:SIN")) {
          posPossibleVer2Sin = i;
        }
        if (tokens[i]!.hasPartialPosTag(":3:SIN")) {
          posPossibleVer3Sin = i;
        }
        if (tokens[i]!.hasPartialPosTag(":1:PLU")) {
          posPossibleVer1Plu = i;
        }
//      if (tokens[i].hasPartialPosTag(":2:PLU"))
//        posPossibleVer2Plu = i;
        
      }
           
    } // for each token
      
    // "ich", "du", and "wir" must be subject (no other interpretation possible)
    // "ich", "du", "er", and "wir" must have a matching verb

    if (posVer1Sin !== -1 && posIch === -1 && !this.isQuotationMark(tokens[posVer1Sin-1]!)) { // 1st pers sg verb but no "ich"
      if (!tokens[posVer1Sin]!.isImmunized()) {
        ruleMatches.push(this.ruleMatchWrongVerb(tokens[posVer1Sin]!, pos, wholeSentence));
      }
    } else if (posIch > 0 && !this.isNear(posPossibleVer1Sin, posIch) // check whether verb next to "ich" is 1st pers sg
               && (tokens[posIch]!.getToken() === "ich" || tokens[posIch]!.getStartPos() <= 1 ||
                   (tokens[posIch]!.getToken() === "Ich" && posIch >= 2 && tokens[posIch-2]!.getToken() === ":") ||
                   (tokens[posIch]!.getToken() === "Ich" && posIch >= 1 && tokens[posIch-1]!.getToken() === ":")) // ignore "lyrisches Ich" etc.
               && (!this.isQuotationMark(tokens[posIch-1]!) || posIch < 3 || (posIch > 1 && tokens[posIch-2]!.getToken() === ":"))) {
      const plus1 = ((posIch + 1) === tokens.length) ? 0 : +1; // prevent posIch+1 segfault
      const check = this.verbDoesMatchPersonAndNumber(tokens[posIch - 1]!, tokens[posIch + plus1]!, "1", "SIN", finiteVerb);
      if (!check.verbDoesMatchPersonAndNumber && !this.nextButOneIsModal(tokens, posIch) && "äußerst" !== check.finiteVerb!.getToken()) {
        if (!tokens[posIch]!.isImmunized()) {
          ruleMatches.push(this.ruleMatchWrongVerbSubject(tokens[posIch]!, check.finiteVerb!, "1:SIN", pos, wholeSentence));
        }
      }
    }
    
    if (posVer2Sin !== -1 && posDu === -1 && !this.isQuotationMark(tokens[posVer2Sin-1]!)) {
      if (!tokens[posVer2Sin]!.isImmunized()) {
        ruleMatches.push(this.ruleMatchWrongVerb(tokens[posVer2Sin]!, pos, wholeSentence));
      }
    } else if (posDu > 0 && !this.isNear(posPossibleVer2Sin, posDu)
               &&(!this.isQuotationMark(tokens[posDu-1]!) || posDu < 3 || (posDu > 1 && tokens[posDu-2]!.getToken() === ":"))) {
      const plus1 = ((posDu + 1) === tokens.length) ? 0 : +1;
      const check = this.verbDoesMatchPersonAndNumber(tokens[posDu - 1]!, tokens[posDu + plus1]!, "2", "SIN", finiteVerb);
      if (!check.verbDoesMatchPersonAndNumber &&
          !tokens[posDu+plus1]!.hasPosTagStartingWith("VER:1:SIN:KJ2") && // "Wenn ich du wäre"
          !(tokens[posDu+plus1]!.hasPosTagStartingWith("ADJ:") && !tokens[posDu+plus1]!.hasPosTag("ADJ:PRD:GRU"))&& // "dass du billige Klamotten..."
          !tokens[posDu-1]!.hasPosTagStartingWith("VER:1:SIN:KJ2") &&
          !this.nextButOneIsModal(tokens, posDu) &&
          !tokens[posDu]!.isImmunized()
      ) {
        ruleMatches.push(this.ruleMatchWrongVerbSubject(tokens[posDu]!, check.finiteVerb!, "2:SIN", pos, wholeSentence));
      }
    }
    
    if (posEr > 0 && !this.isNear(posPossibleVer3Sin, posEr)
        && (!this.isQuotationMark(tokens[posEr-1]!)  || posEr < 3 || (posEr > 1 && tokens[posEr-2]!.getToken() === ":"))) {
      const plus1 = ((posEr + 1) === tokens.length) ? 0 : +1;
      const check = this.verbDoesMatchPersonAndNumber(tokens[posEr - 1]!, tokens[posEr + plus1]!, "3", "SIN", finiteVerb);
      if (!check.verbDoesMatchPersonAndNumber 
              && !this.nextButOneIsModal(tokens, posEr)
              && "äußerst" !== check.finiteVerb!.getToken()
              && "regen" !== check.finiteVerb!.getToken()  // "wo er regen Anteil nahm"
              && !tokens[posEr]!.isImmunized()
          ) {
        ruleMatches.push(this.ruleMatchWrongVerbSubject(tokens[posEr]!, check.finiteVerb!, "3:SIN", pos, wholeSentence));
      }
    }
    
    if (posVer1Plu !== -1 && posWir === -1 && !this.isQuotationMark(tokens[posVer1Plu-1]!)) {
      if (!tokens[posVer1Plu]!.isImmunized()) {
        ruleMatches.push(this.ruleMatchWrongVerb(tokens[posVer1Plu]!, pos, wholeSentence));
      }
    } else if (posWir > 0 && !this.isNear(posPossibleVer1Plu, posWir) && !this.isQuotationMark(tokens[posWir-1]!)) {
      const plus1 = ((posWir + 1) === tokens.length) ? 0 : +1;
      const check = this.verbDoesMatchPersonAndNumber(tokens[posWir - 1]!, tokens[posWir + plus1]!, "1", "PLU", finiteVerb);
      if (!check.verbDoesMatchPersonAndNumber && !this.nextButOneIsModal(tokens, posWir) && !tokens[posWir]!.isImmunized() &&
          check.finiteVerb!.getToken() !== "äußerst") {
        ruleMatches.push(this.ruleMatchWrongVerbSubject(tokens[posWir]!, check.finiteVerb!, "1:PLU", pos, wholeSentence));
      }
    }
    
    return ruleMatches;
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns();
  }

  // avoid false alarm on 'wenn ich sterben sollte ...':
  private nextButOneIsModal(tokens: AnalyzedTokenReadings[], pos: number): boolean {
    return pos < tokens.length - 2 && tokens[pos+2]!.hasPartialPosTag(":MOD:");
  }

  /**
   * @return true if |a - b| < 5, and a != -1 
   */
  private isNear(a: number, b: number): boolean {
    return a !== -1 && (Math.abs(a - b) < 5);
  }
  
  private isQuotationMark(token: AnalyzedTokenReadings): boolean {
    return QUOTATION_MARKS.has(token.getToken());
  }
  
  /**
   * @return true if the verb @param token (if it is a verb) matches @param person and @param number, and matches no other person/number
   */
  private hasUnambiguouslyPersonAndNumber(tokenReadings: AnalyzedTokenReadings, person: string, number: string): boolean {
    if (tokenReadings.getToken().length === 0
        || (Character.isUpperCase(tokenReadings.getToken().charAt(0)) && tokenReadings.getStartPos() !== 0)
        || !tokenReadings.hasPosTagStartingWith("VER")) {
      return false;
    }
    for (const analyzedToken of tokenReadings) {
      const postag = analyzedToken.getPOSTag();
      if (postag == null || postag.endsWith("_END")) { // ignore SENT_END and PARA_END
        continue;
      }
      if (!postag.includes(":" + person + ":" + number)) {
        return false;
      }
    }
    return true;
  }
  
  /**
   * @return true if @param token is a finite verb, and it is no participle, pronoun or number
   */
  private isFiniteVerb(token: AnalyzedTokenReadings): boolean {
    if (token.getToken().length === 0
        || (Character.isUpperCase(token.getToken().charAt(0)) && token.getStartPos() !== 0)
        || !token.hasPosTagStartingWith("VER")
        || token.hasAnyPartialPosTag("PA2", "PRO:", "ZAL")
        || "einst" === token.getToken()) {
      return false;
    }
    return token.hasAnyPartialPosTag(":1:", ":2:", ":3:");
  }
  
  /**
   * @return false if neither the verb @param token1 (if any) nor @param token2 match @param person and @param number, and none of them is "und" or ","
   * if a finite verb is found, it is saved in finiteVerb
   */
  private verbDoesMatchPersonAndNumber(token1: AnalyzedTokenReadings, token2: AnalyzedTokenReadings,
                                               person: string, number: string, finiteVerb: AnalyzedTokenReadings | null): BooleanAndFiniteVerb {
    if (StringUtils_equalsAny(token1.getToken(), ",", "und", "sowie", "&") ||
    		StringUtils_equalsAny(token2.getToken(), ",", "und", "sowie", "&")) {
      return new BooleanAndFiniteVerb(true, finiteVerb);
    }
   
    let foundFiniteVerb = false;
    
    if (this.isFiniteVerb(token1)) {
      foundFiniteVerb = true;
      finiteVerb = token1;
      if (token1.hasPartialPosTag(":" + person + ":" + number)) {
        return new BooleanAndFiniteVerb(true, finiteVerb);
      }
    }
    
    if (this.isFiniteVerb(token2)) {
      foundFiniteVerb = true;
      finiteVerb = token2;
      if (token2.hasPartialPosTag(":" + person + ":" + number)) {
        return new BooleanAndFiniteVerb(true, finiteVerb);
      }
    }
    
    return new BooleanAndFiniteVerb(!foundFiniteVerb, finiteVerb);
  }
  
  /**
   * @return a list of forms of @param verb which match @param expectedVerbPOS (person:number)
   * @param toUppercase true when the suggestions should be capitalized
   */
  private getVerbSuggestions(verb: AnalyzedTokenReadings, expectedVerbPOS: string, toUppercase: boolean): string[] {
    // find the first verb reading
    let verbToken = new AnalyzedToken("", "", "");
    for (const token of verb.getReadings()) {
      //noinspection ConstantConditions
      if (token.getPOSTag()!.startsWith("VER:")) {
        verbToken = token;
        break;
      }
    }
    
    const synthesized = this.language.getSynthesizer()!.synthesize(verbToken, "VER.*:"+expectedVerbPOS+".*", true);
    const suggestions = HashSet_toList(synthesized);  // remove duplicates
    if (toUppercase) {
      for (let i = 0; i < suggestions.length; ++i) {
        suggestions[i] = StringTools.uppercaseFirstChar(suggestions[i]!)!;
      }
    }
    return suggestions;
  }
  
  /**
   * @return a list of pronouns which match the person and number of @param verb
   * @param toUppercase true when the suggestions should be capitalized
   */
  private getPronounSuggestions(verb: AnalyzedTokenReadings, toUppercase: boolean): string[] {
    const result: string[] = [];
    if (verb.hasPartialPosTag(":1:SIN")) {
      result.push("ich");
    }
    if (verb.hasPartialPosTag(":2:SIN")) {
      result.push("du");
    }
    if (verb.hasPartialPosTag(":3:SIN")) {
      result.push("er");
      result.push("sie");
      result.push("es");
    }
    if (verb.hasPartialPosTag(":1:PLU")) {
      result.push("wir");
    }
    if (verb.hasPartialPosTag(":2:PLU")) {
      result.push("ihr");
    }
    if (verb.hasPartialPosTag(":3:PLU") && !result.includes("sie")) { // do not add "sie" twice
      result.push("sie");
    }
    if (toUppercase) {
      for (let i = 0; i < result.length; ++i) {
        result[i] = StringTools.uppercaseFirstChar(result[i]!)!;
      }
    }
    return result;
  }
  
  private ruleMatchWrongVerb(token: AnalyzedTokenReadings, pos: number, sentence: AnalyzedSentence): RuleMatch {
    const msg = "Möglicherweise fehlende grammatische Übereinstimmung zwischen Subjekt und Prädikat (" +
      token.getToken() + ") bezüglich Person oder Numerus (Einzahl, Mehrzahl - Beispiel: " +
      "'Max bist' statt 'Max ist').";
    return new RuleMatch(this, sentence, pos+token.getStartPos(), pos+token.getEndPos(), msg);
  }
  
  private ruleMatchWrongVerbSubject(subject: AnalyzedTokenReadings, verb: AnalyzedTokenReadings, expectedVerbPOS: string, pos: number, sentence: AnalyzedSentence): RuleMatch {
    const msg = "Möglicherweise fehlende grammatische Übereinstimmung zwischen Subjekt (" + subject.getToken() +
      ") und Prädikat (" + verb.getToken() + ") bezüglich Person oder Numerus (Einzahl, Mehrzahl - Beispiel: " +
      "'ich sind' statt 'ich bin').";
    
    const suggestions: string[] = [];
    const verbSuggestions: string[] = [];
    const pronounSuggestions: string[] = [];
    
    let ruleMatch: RuleMatch;
    if (subject.getStartPos() < verb.getStartPos()) {
      ruleMatch = new RuleMatch(this, sentence, pos+subject.getStartPos(), pos+verb.getStartPos()+verb.getToken().length, msg);
      verbSuggestions.push(...this.getVerbSuggestions(verb, expectedVerbPOS, false));
      for (const verbSuggestion of verbSuggestions) {
        suggestions.push(subject.getToken() + " " + verbSuggestion);
      }
      pronounSuggestions.push(...this.getPronounSuggestions(verb, Character.isUpperCase(subject.getToken().charAt(0))));
      for (const pronounSuggestion of pronounSuggestions) {
        suggestions.push(pronounSuggestion + " " + verb.getToken());
      }
      const markedText = sentence.getText().substring(subject.getStartPos(), verb.getStartPos()+verb.getToken().length);
      this.sortBySimilarity(suggestions, markedText);
      ruleMatch.setSuggestedReplacements(suggestions);
    } else {
      ruleMatch = new RuleMatch(this, sentence, pos+verb.getStartPos(), pos+subject.getStartPos()+subject.getToken().length, msg);
      verbSuggestions.push(...this.getVerbSuggestions(verb, expectedVerbPOS, Character.isUpperCase(verb.getToken().charAt(0))));
      for (const verbSuggestion of verbSuggestions) {
        suggestions.push(verbSuggestion + " " + subject.getToken());
      }
      pronounSuggestions.push(...this.getPronounSuggestions(verb, false));
      for (const pronounSuggestion of pronounSuggestions) {
        suggestions.push(verb.getToken() + " " + pronounSuggestion);
      }
      const markedText = sentence.getText().substring(verb.getStartPos(), subject.getStartPos()+subject.getToken().length);
      this.sortBySimilarity(suggestions, markedText);
      ruleMatch.setSuggestedReplacements(suggestions);
    }
    
    return ruleMatch;
  }

  private sortBySimilarity(suggestions: string[], markedText: string): void {
    suggestions.sort((o1, o2) => {
      const diff1 = LevenshteinDistance_apply(markedText, o1);
      const diff2 = LevenshteinDistance_apply(markedText, o2);
      return diff1 - diff2;
    });
  }

  override minToCheckParagraph(): number {
    return 0;
  }
}
