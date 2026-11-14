// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/CaseRule.java faithful
// StringUtils.equalsAny/equalsAnyIgnoreCase/isNumeric/removeEnd are local functions. The static
// exceptionPatterns (from CaseRuleExceptions) are created on first use. The anti-patterns
// (CaseRuleAntiPatterns.ANTI_PATTERNS) are only read in the constructor and in
// estimateContextForSureMatch, never at module load.
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { German } from '../../language/German.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Rule } from '../../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import type { StringMatcher } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/StringMatcher.ts';
import type { GermanTagger } from '../../tagging/de/GermanTagger.ts';
import { POSType } from '../../tagging/de/GermanToken.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Pattern, StringMatches } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import { Character } from '../../../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { CaseRuleAntiPatterns } from './CaseRuleAntiPatterns.ts';
import { CaseRuleExceptions } from './CaseRuleExceptions.ts';
import { GermanHelper } from './GermanHelper.ts';
import { LanguageNames } from './LanguageNames.ts';

/** StringUtils.equalsAny(string, searchStrings...) */
function StringUtils_equalsAny(string: string | null, ...searchStrings: string[]): boolean {
  return searchStrings.some((s) => s === string);
}

/** StringUtils.equalsAnyIgnoreCase(string, searchStrings...) (String.equalsIgnoreCase per char) */
function StringUtils_equalsAnyIgnoreCase(string: string | null, ...searchStrings: string[]): boolean {
  return string != null && searchStrings.some((s) => equalsIgnoreCase(s, string));
}

/** String.equalsIgnoreCase: equal lengths and every char equal in upper or lower case. */
function equalsIgnoreCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const c1 = a.charAt(i), c2 = b.charAt(i);
    if (c1 === c2) continue;
    const u1 = Character.toUpperCase(c1), u2 = Character.toUpperCase(c2);
    if (u1 === u2 || Character.toLowerCase(u1) === Character.toLowerCase(u2)) continue;
    return false;
  }
  return true;
}

/** StringUtils.isNumeric: not empty, and only Unicode digits. */
function StringUtils_isNumeric(cs: string | null): boolean {
  if (cs == null || cs.length === 0) return false;
  for (let i = 0; i < cs.length; i++) {
    if (!Character.isDigit(cs.charAt(i))) return false;
  }
  return true;
}

/** StringUtils.removeEnd(str, remove) */
function StringUtils_removeEnd(str: string, remove: string): string {
  if (str.length === 0 || remove.length === 0) return str;
  return str.endsWith(remove) ? str.substring(0, str.length - remove.length) : str;
}

/**
 * Check that adjectives and verbs are not written with an uppercase
 * first letter (except at the start of a sentence) and cases
 * like this: <code>Das laufen f&auml;llt mir leicht.</code> (<code>laufen</code> needs
 * to be uppercased).
 *
 * @author Daniel Naber
 */
export class CaseRule extends Rule {

  private static readonly NUMERALS_EN =
          Pattern.compile("[a-z]|[0-9]+|(m{0,4}(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3}))$");
  private static readonly TWO_UPPERCASE_CHARS = Pattern.compile("[A-ZÖÄÜ][A-ZÖÄÜ][a-zöäüß-]+");

  // wenn hinter diesen Wörtern ein Verb steht, ist es wohl ein substantiviertes Verb,
  // muss also groß geschrieben werden:
  private static readonly nounIndicators = new Set<string>();

  private static readonly UPPERCASE_MESSAGE = "Außer am Satzanfang werden nur Nomen und Eigennamen großgeschrieben.";
  private static readonly LOWERCASE_MESSAGE = "Falls es sich um ein substantiviertes Verb handelt, wird es großgeschrieben.";
  private static readonly COLON_MESSAGE = "Folgt dem Doppelpunkt weder ein Substantiv noch eine wörtliche Rede oder ein vollständiger Hauptsatz, schreibt man klein weiter.";
  private static readonly VERHALTEN = Pattern.compile(".+verhalten");
  private static readonly IRGEND_ETC = Pattern.compile("irgendwelche|irgendwas|irgendein|weniger?|einiger?|mehr|aufs");
  private static readonly VER_MOD_AUX = Pattern.compile("VER:(MOD|AUX):[1-3]:.*");

  static {
    CaseRule.nounIndicators.add("das");
    CaseRule.nounIndicators.add("sein");
    //nounIndicators.add("ihr");    // would cause false alarm e.g. "Auf ihr stehen die Ruinen...", "Ich dachte, dass ihr kommen würdet.", "Ich verdanke ihr meinen Erfolg."
    CaseRule.nounIndicators.add("mein");
    CaseRule.nounIndicators.add("dein");
    CaseRule.nounIndicators.add("euer");
    CaseRule.nounIndicators.add("unser");
  }

  private static readonly SENTENCE_START_EXCEPTIONS = ["(", "\"", "'", "‘", "„", "«", "»", "‚", ".", "!", "?"];

  private static readonly UNDEFINED_QUANTIFIERS = ["viel", "nichts", "nix", "wenig", "allerlei"];

  // Used for subordinate clause detection after verbs (e.g. "Überlegen, wie man...")

  private static readonly INTERROGATIVE_PARTICLES = ["was", "wodurch", "wofür", "womit", "woran", "worauf", "woraus", "wovon", "wie"];

  private static readonly POSSESSIVE_INDICATORS = ["einer", "eines", "der", "des", "dieser", "dieses"];

  private static readonly DAS_VERB_EXCEPTIONS = ["nur", "sogar", "auch", "die", "alle", "viele", "zu"];

  // Used for short question fragments after a colon (e.g. "Ich frage mich: Warum?")
  // Intentionally different from INTERROGATIVE_PARTICLES, which targets subordinate clauses.

  private static readonly COLON_QUESTION_WORDS = ["warum", "wieso", "weshalb", "wer", "was", "wann", "wo", "wie", "wozu"];

  private static readonly COLON_QUESTION_CONJUNCTIONS = ["und", "oder", "aber", "denn"];

  /*
   * These are words that Morphy only knows as non-nouns (or not at all).
   * The proper solution is to add all those to our Morphy data, but as a simple
   * workaround to avoid false alarms, these words can be added here.
   */
  private static readonly exceptions: string[] = [
    "Bedienstete",
    "Bediensteter",
    "Feierwütiger",
    "Feierwütige",
    "Feierwütigen",
    "Dritten",
    "Berufstätige",
    "Berufstätigen",
    "Erwerbstätige",
    "Erwerbstätigen",
    "Tatverdächtige",
    "Tatverdächtigen",
    "Konsumierende",
    "Konsumierenden",
    "Verliebter",
    "Verliebte",
    "Beängstigendes",
    "Oppositioneller",
    "Oppositionelle",
    "Verantwortlicher",
    "Verantwortliche",
    "Verantwortlichen",
    "Beschuldigte",
    "Beschuldigten",
    "Beklagte",
    "Beklagten",
    "Befragte",
    "Befragten",
    "Hingerichtete",
    "Lehrende",
    "Lehrender",
    "Vertrauter",
    "Out", // eng
    "Packet", // misspelling of "Paket" (caught by spell checker)
    "Adult", // eng
    "Apart", // eng
    "Universal", // eng
    "Multinational", // eng
    "Additional", // eng
    "Smart", // eng
    "Adverse", // eng
    "Different", // eng
    "Light", // eng
    "Legal", // eng
    "Computational", // eng
    "Holder", // eng
    "Just", // eng
    "Lost", // eng
    "Fundamental", // eng
    "Quick", // eng
    "Infernal", // eng
    "Fit", // eng
    "Fair", // eng
    "Viral", // eng
    "Tough", // eng
    "Indoor", // eng
    "Superb", // eng und Automodell
    "Resilient", // eng
    "Hexagonal", // eng
    "Responsive", // eng
    "Anno", // Name
    "Mo",
    "Di",
    "Mi",
    "Do",   // "Di. und Do. um 18 Uhr"
    "Fr",   // "Fr. Dr. Müller"
    "Sa",   // Sa. 12 - 16 Uhr
    "Gr",   // "Gr. 12" (Größe)
    "Mag",   // "Mag. Helke Müller"
    "Nov",
    "Diss",
    "Invalide",
    "Invalider",
    "Invaliden",
    "Sehende",
    "Sehender",
    "Sehenden",
    "Schutzheilige",
    "Schutzheiliger",
    "Schutzheiligen",
    "Lila",
    "Langzeitarbeitslose",
    "Langzeitarbeitslosen",
    "Langzeitarbeitsloser",
    "Linksintellektuelle",
    "Linksintellektueller",
    "Linksintellektuellen",
    "Beschuldigte",
    "Beschuldigten",
    "Drogenabhängige",
    "Drogenabhängiger",
    "Drogenabhängiger",
    "Drogenabhängigen",
    "Asylsuchender",
    "Asylsuchende",
    "Asylsuchenden",
    "Landtagsabgeordnete",
    "Landtagsabgeordneter",
    "Landtagsabgeordneten",
    "Stadtverordnete",
    "Stadtverordneter",
    "Stadtverordneten",
    "Veränderliche",
    "Veränderlicher",
    "Veränderlichen",
    "Werbetreibende",
    "Werbetreibender",
    "Werbetreibenden",
    "Verletzter",
    "Verletzten",
    "Werktätige",
    "Werktätiger",
    "Werktätigen",
    "Getestete", // temporary fix
    "Getesteten", // temporary fix
    "Genesene", // temporary fix
    "Genesenen", // temporary fix
    "Geimpfte", // temporary fix
    "Geboosterte", // temporary fix
    "Ungeimpfte", // temporary fix
    "Geimpften", // temporary fix
    "Geboosterten", // temporary fix
    "Ungeimpften", // temporary fix
    "Geflüchtete", // temporary fix
    "Geflüchteten", // temporary fix
    "Projektbeteiligte", // temporary fix
    "Projektbeteiligten", // temporary fix
    "Heranwachsende", // temporary fix
    "Heranwachsenden", // temporary fix
    "Interessierte", // temporary fix
    "Interessierten", // temporary fix
    "Infizierte", // temporary fix
    "Infizierten", // temporary fix
    "Gehörlose", // temporary fix
    "Gehörlosen", // temporary fix
    "Drücke",
    "Klecks",
    "Quatsch",
    "Speis",
    "Flash",
    "Suhl",
    "Müh",
    "Bims",
    "Wisch",
    "Außenputz",
    "Rinderhack",
    "Hack",
    "Schlitz",
    "Frevler",
    "Zementputz",
    "Hurst",  // Name
    "Bombardier",  // Name
    "Kraus",  // Nachname
    "Strunz",  // Nachname
    "Bell",  // Nachname
    "Melk",  // Nachname
    "Klopp",  // Nachname
    "Walz",  // Nachname
    "Schiel",  // Nachname
    "Dusch",  // Nachname
    "Penn",  // Nachname
    "Dörr",  // Nachname
    "Kies",
    "Koks",
    "Dell",  // Name
    "Wall",
    "Beige",
    "Zoom",
    "Perl",
    "Parallele",
    "Parallelen",
    "Rutsch",
    "Spar",
    "Merz",
    "Gefahren",
    "Minderjährige",
    "Minderjähriger",
    "Minderjährigen",
    "Scheinselbstständige",
    "Bundestagsabgeordneter",
    "Bundestagsabgeordneten",
    "Bundestagsabgeordnete",
    "Reichstagsabgeordneter",
    "Reichstagsabgeordneten",
    "Reichstagsabgeordnete",
    "Medienschaffende",
    "Medienschaffenden",
    "Medienschaffender",
    "Lehrende",
    "Lehrenden",
    "Vertretene",
    "Vertretenen",
    "Vorstandsvorsitzender",
    "Vorstandsvorsitzenden",
    "Vorstandsvorsitzende",
    "Demonstrierende",
    "Demonstrierenden",
    "Marketingtreibende",
    "Marketingtreibender",
    "Marketingtreibenden",
    "Strafgefangenen",
    "Strafgefangener",
    "Strafgefangene",
    "Pädophile",
    "Pädophiler",
    "Pädophilen",
    "Lehrbeauftragte",
    "Lehrbeauftragter",
    "Lehrbeauftragten",
    "Erkrankte",
    "Erkrankter",
    "Erkrankten",
    "Eigner",
    "Polizeibeamten",
    "Polizeibeamter",
    "Polizeibeamte",
    "Kriegsversehrte",
    "Kriegsversehrter",
    "Kriegsversehrten",
    "Demenzkranke",
    "Demenzkranker",
    "Demenzkranken",
    "Parteivorsitzende",
    "Parteivorsitzender",
    "Parteivorsitzenden",
    "Kriegsgefangene",
    "Kriegsgefangener",
    "Kriegsgefangenen",
    "Ehrenvorsitzende",
    "Ehrenvorsitzender",
    "Ehrenvorsitzenden",
    "Oberkommandierende",
    "Oberkommandierender",
    "Oberkommandierenden",
    "Werbungtreibende",
    "Werbungtreibenden",
    "Mitangeklagte",
    "Schuhfilz",
    "Mix",
    "Rahm",
    "Flansch",
    "WhatsApp",
    "Verschleiß",
    "Schutzsuchende", // gendered form
    "Schutzsuchenden", // gendered form
    "Versicherte",
    "Versicherten", // gendered form
    "Cyberkriminelle",
    "Cyberkriminellen",
    "Kriminelle",
    "Kriminellen",
    "Auszubildenden",
    "Auszubildende",
    "Auszubildender",
    "Lernende", // gendered form
    "Lernender", // gendered form
    "Lernenden", // gendered form
    "Teilnehmende", // gendered form
    "Teilnehmenden", // gendered form
    "Radfahrende", // gendered form
    "Radfahrenden", // gendered form
    "Autofahrende", // gendered form
    "Autofahrenden", // gendered form
    "Auszubildene", // gendered form
    "Auszubildenen", // gendered form
    "Absolvierende", // gendered form
    "Absolvierenden", // gendered form
    "Einheimische",
    "Einheimischen",
    "Einheimischer",
    "Wehrbeauftragter",
    "Wehrbeauftragte",
    "Wehrbeauftragten",
    "Wehrbeauftragtem",
    "Prozessbevollmächtigter",
    "Prozessbevollmächtigte",
    "Prozessbevollmächtigten",
    "Prozessbevollmächtigtem",
    "Bundesbeamte",
    "Bundesbeamter",
    "Bundesbeamten",
    "Bundesbeamtem",
    "Datenschutzbeauftragter",
    "Datenschutzbeauftragte",
    "Datenschutzbeauftragten",
    "Datenschutzbeauftragtem",
    "Steuerbevollmächtigte",
    "Steuerbevollmächtigter",
    "Steuerbevollmächtigten",
    "Steuerbevollmächtigtem",
    "Suchtkranken",
    "Suchtkranke",
    "Suchtkranker",
    "Filmschaffende",
    "Filmschaffender",
    "Filmschaffenden",
    "Filmschaffendem",
    "Arbeitssuchende",
    "Arbeitssuchender",
    "Arbeitssuchenden",
    "Arbeitssuchendem",
    "Bausachverständige",
    "Bausachverständiger",
    "Bausachverständigen",
    "Bausachverständigem",
    "Heurige",
    "Ratsuchende",
    "Ratsuchender",
    "Ratsuchenden",
    "Verwundete",
    "Verwundeter",
    "Verwundeten",
    "Vollzugsbeamte",
    "Vollzugsbeamter",
    "Vollzugsbeamten",
    "Schutzbefohlene",
    "Schutzbefohlener",
    "Schutzbefohlenen",
    "Verfahrensbeteiligte",
    "Verfahrensbeteiligter",
    "Verfahrensbeteiligten",
    "Kolonialbeamte",
    "Kolonialbeamter",
    "Kolonialbeamten",
    "Verwaltungsbeamte",
    "Verwaltungsbeamter",
    "Verwaltungsbeamten",
    "Verdächtige",
    "Verdächtiger",
    "Verdächtigen",
    "Leichtverletzte",
    "Leichtverletzten",
    "Leichtverletzte",
    "Dozierende",
    "Dozierenden",
    "Studierende",
    "Studierender",
    "Studierenden",
    "Suchbegriffen",
    "Plattdeutsch",
    "Wallet",
    "Str",
    "Priest",
    "Simple",
    "Legend",
    "Golden",
    "Forward",
    "Unverzagt", // österreichisches Adelsgeschlecht
    "Auszubildende",
    "Auszubildender",
    "Gelehrte",
    "Gelehrter",
    "Gelehrten",
    "Vorstehende",
    "Vorstehender",
    "Mitwirkende",
    "Mitwirkender",
    "Mitwirkenden",
    "Tabellenletzte",
    "Tabellenletzter",
    "Familienangehörige",
    "Familienangehöriger",
    "Zeitreisende",
    "Zeitreisender",
    "Zeitreisenden",
    "Erwerbstätige",
    "Erwerbstätigen",
    "Erwerbstätiger",
    "Selbstständige",
    "Selbstständigen",
    "Selbstständiger",
    "Selbständige",
    "Selbständigen",
    "Selbständiger",
    "Genaueres",
    "Äußersten",
    "Dienstreisender",
    "Verletzte",
    "Vermisste",
    "Äußeres",
    "Abseits",
    "Unschuldige",
    "Unschuldiger",
    "Unschuldigen",
    "Mitarbeitende",
    "Mitarbeitender",
    "Mitarbeitenden",
    "Beschäftigter",
    "Beschäftigte",
    "Beschäftigten",
    "Beschäftigtem",
    "Bekannter",
    "Bekannte",
    "Bevollmächtigte",
    "Bevollmächtigter",
    "Bevollmächtigten",
    "Brecht",
    "Tel",  // Tel. = Telefon
    "Unschuldiger",
    "Vorgesetzter",
    "Abs",   // Abs. = Abkürzung für Absatz, Absender, ...
    "Klappe",
    "Vorfahre",
    "Mittler",
    "Hr",   // Hr. = Abkürzung für Herr
    "Schwarz",
    "Genese",
    "Rosa",
    "Auftrieb",
    "Zuschnitt",
    "Geschossen",
    "Vortrieb",
    "Abtrieb",
    "Gesandter",
    "Durchfahrt",
    "Durchgriff",
    "Überfahrt",
    "Zeche",
    "Sparte",
    "Sparten",
    "Heiliger",
    "Reisender",
    "Pest",
    "Schwinge",
    "Verlies",
    "Nachfolge",
    "Stift",
    "Belange",
    "Geistlicher",
    "Google",
    "Hu", // name
    "Jenseits",
    "Abends",
    "Stimmberechtigte",
    "Stimmberechtigten",
    "Stimmberechtigter",
    "Alleinerziehende",
    "Alleinerziehenden",
    "Alleinerziehender",
    "Abgeordneter",
    "Abgeordnete",
    "Abgeordneten",
    "Angestellter",
    "Angestellte",
    "Angestellten",
    "Armeeangehörige",
    "Armeeangehörigen",
    "Armeeangehöriger",
    "Liberaler",
    "Abriss",
    "Ahne",
    "Ähnlichem",
    "Ähnliches",   // je nach Kontext groß (TODO), z.B. "Er hat Ähnliches erlebt" 
    "Allerlei",
    "Anklang",
    "Verlobter",
    "Anstrich",
    "Armes",
    "Ausdrücke",
    "Auswüchsen",
    "Bände",
    "Bänden",
    "Beauftragter",
    "Belange",
    "Biss",
    "De",    // "De Morgan" etc
    "Diesseits", // "im Diesseits"
    "Dr",
    "Durcheinander",
    "Eindrücke",
    "Erwachsener",
    "Familienangehörige", // "Brüder und solche Familienangehörige, die..."
    "Flöße",
    "Folgendes",   // je nach Kontext groß (TODO)...
    "Fort",
    "Fraß",
    "Fristende",
    "Frevel",
    "Genüge",
    "Gefallen", // Gefallen finden
    "Gläubige",
    "Gläubiger",
    "Gläubigen",
    "Hechte",
    "Herzöge",
    "Herzögen",
    "Hinfahrt",
    "Hilfsstoff",
    "Hilfsstoffe",
    "Hundert",   // groß und klein möglich 
    "Zehntausend",   // groß und klein möglich 
    "Hunderttausend",   // groß und klein möglich 
    "Hyperwallet", // Anglizismus
    "Ihnen",
    "Ihrerseits",
    "Ihr",
    "Ihre",
    "Ihrem",
    "Ihren",
    "Ihrer",
    "Ihres",
    "Infrarot",
    "Jenseits",
    "Jugendliche",
    "Jugendlichen",
    "Jugendlicher",
    "Jünger",
    "Kant", //Immanuel
    "Klaue",
    "Konditional",
    "Krähe",
    "Kurzem",
    "Landwirtschaft",
    "Langem",
    "Längerem",
    "Lausitz",
    "Le",    // "Le Monde" etc
    "Lehrlingsunterweisung",
    // "Leichter", // Leichter = ein Schiff in oben offener Bauweise ohne Eigenantrieb
    "Letzt",
    "Letzt",      // "zu guter Letzt"
    "Letztere",
    "Letzterer",
    "Letzteres",
    "Link",
    "Links",
    "Löhne",
    "Luden",
    "Milk", // Englisches Wort und eine Form von "melken"
    "Mitfahrt",
    "Mr",
    "Mrd",
    "Mrs",
    "Nachfrage",
    "Nachts",   // "des Nachts", "eines Nachts"
    "Nachspann",
    "Nähte",
    "Nähten",
    "Narkoseverfahren",
    "Neuem",
    "Neugeborene",
    "Neugeborenen",
    "Neugeborenes",
    "Nr",
    "Nutze",   // zu Nutze
    "Obdachlose",
    "Obdachloser",
    "Obdachlosen",
    "Oder",   // der Fluss
    "Ohrfeige",
    "Patsche",
    "Pfiffe",
    "Pfiffen",
    "Press", // University Press
    "Prof",
    "Puste",
    "Sachverständiger",
    "Sankt",
    "Schaulustige",
    "Schaulustigen",
    "Schaulustiger",
    "Scheine",
    "Scheiße",
    "Schuft",
    "Schufte",
    "Schuld",
    "Schwangere",
    "Schwangeren",
    "Schwärme",
    "Schwarzes",    // Schwarzes Brett
    "Sie",
    "Skype",
    "Spitz",
    "Spott",
    "St",   // Paris St. Germain
    "Stereotyp",
    "Störe",
    "Tausend",   // je nach Kontext groß (TODO)
    "Tischende",
    "Toter",
    "Übrigen",   // je nach Kontext groß (TODO), z.B. "im Übrigen"
    "Unentschieden",
    "Unvorhergesehenes",   // je nach Kontext groß (TODO), z.B. "etwas Unvorhergesehenes"
    "Verantwortlicher",
    "Verlass",
    "Verwandter",
    "Verstorbenen",
    "Verstorbene",
    "Vielfache",
    "Vielfaches",
    "Vorsitzender",
    "Fraktionsvorsitzender",
    "Verletzte",
    "Verletzten",
    "Walt",
    "Weitem",
    "Weiteres",
    "Wohlen", // Stadt in der Schweiz
    "Wicht",
    "Wichtiges",
    "Wider",    // "das Für und Wider"
    "Wild",
    "Zeche",
    "Zusage",
    "Zwinge",
    "Zirkusrund",
    "Tertiär",  // geologischer Zeitabschnitt

    "Erster",   // "er wurde Erster im Langlauf"
    "Zweiter",
    "Dritter",
    "Vierter",
    "Fünfter",
    "Sechster",
    "Siebter",
    "Achter",
    "Neunter",
    "Erste",   // "sie wurde Erste im Langlauf"
    "Zweite",
    "Dritte",
    "Vierte",
    "Fünfte",
    "Sechste",
    "Siebte",
    "Achte",
    "Neunte",

    // Änderungen an der Rechtschreibreform 2006 erlauben hier Großschreibung:
    "Dein",
    "Deine",
    "Deinem",
    "Deinen",
    "Deiner",
    "Deines",
    "Deinerseits",
    "Dich",
    "Dir",
    "Du",
    "Euch",
    "Euer",
    "Eure",
    "Euern",
    "Eurem",
    "Euren",
    "Eures",
    "Eueren",
    "Euerem",
    "Eueres",
    "Euerer",
    "Eurerseits",
    "Euerseits"
  ];

  private static _exceptionPatterns: Set<StringMatcher[]> | null = null;
  private static get exceptionPatterns(): Set<StringMatcher[]> {
    return (CaseRule._exceptionPatterns ??= CaseRuleExceptions.getExceptionPatterns());
  }

  private static readonly substVerbenExceptions = new Set<string>();
  static {
    CaseRule.substVerbenExceptions.add("hinziehen");
    CaseRule.substVerbenExceptions.add("helfen");
    CaseRule.substVerbenExceptions.add("lassen");
    CaseRule.substVerbenExceptions.add("passieren");  // "das Schlimmste, das passieren könnte"
    CaseRule.substVerbenExceptions.add("haben");  // "Das haben schon viele versucht."
    CaseRule.substVerbenExceptions.add("passiert");  // "Das passiert..."
    CaseRule.substVerbenExceptions.add("beschränkt");  // "Das beschränkt sich..."
    CaseRule.substVerbenExceptions.add("wiederholt");
    CaseRule.substVerbenExceptions.add("scheinen");
    CaseRule.substVerbenExceptions.add("klar");
    CaseRule.substVerbenExceptions.add("heißen");
    CaseRule.substVerbenExceptions.add("einen");
    CaseRule.substVerbenExceptions.add("gehören");
    CaseRule.substVerbenExceptions.add("bedeutet");    // "und das bedeutet..."
    CaseRule.substVerbenExceptions.add("ermöglicht");    // "und das ermöglicht..."
    CaseRule.substVerbenExceptions.add("funktioniert");    // "Das funktioniert..."
    CaseRule.substVerbenExceptions.add("sollen");
    CaseRule.substVerbenExceptions.add("werden");
    CaseRule.substVerbenExceptions.add("dürfen");
    CaseRule.substVerbenExceptions.add("müssen");
    CaseRule.substVerbenExceptions.add("so");
    CaseRule.substVerbenExceptions.add("ist");
    CaseRule.substVerbenExceptions.add("können");
    CaseRule.substVerbenExceptions.add("mein"); // "etwas, das mein Interesse geweckt hat"
    CaseRule.substVerbenExceptions.add("sein");
    CaseRule.substVerbenExceptions.add("muss");
    CaseRule.substVerbenExceptions.add("muß");
    CaseRule.substVerbenExceptions.add("wollen");
    CaseRule.substVerbenExceptions.add("habe");
    CaseRule.substVerbenExceptions.add("ein");   // nicht "einen" (Verb)
    CaseRule.substVerbenExceptions.add("tun");   // "...dann wird er das tun."
    CaseRule.substVerbenExceptions.add("bestätigt");
    CaseRule.substVerbenExceptions.add("bestätigte");
    CaseRule.substVerbenExceptions.add("bestätigten");
    CaseRule.substVerbenExceptions.add("bekommen");
    CaseRule.substVerbenExceptions.add("sauer");
    CaseRule.substVerbenExceptions.add("bedeuten");
  }

  private readonly antiPatterns: () => DisambiguationPatternRule[];
  private readonly language: German;

  constructor(messages: ResourceBundle, german: German) {
    super();
    this.language = german;
    super.setCategory(Categories.CASING.getCategory(messages));
    this.setUrl(Tools.getUrl("https://languagetool.org/insights/de/beitrag/gross-klein-schreibung-rechtschreibung/#1-nomen-werden-gro%C3%9Falle-anderen-wortarten-kleingeschrieben"));
    this.antiPatterns = Rule.cacheAntiPatterns(german, CaseRuleAntiPatterns.ANTI_PATTERNS);
    this.addExamplePair(Example.wrong("<marker>Das laufen</marker> fällt mir schwer."),
                   Example.fixed("<marker>Das Laufen</marker> fällt mir schwer."));
  }

  override getId(): string {
    return "DE_CASE";
  }

  override estimateContextForSureMatch(): number {
    return CaseRuleAntiPatterns.ANTI_PATTERNS.reduce((max, l) => Math.max(max, l.length), 0);
  }

  override getUrl(): string | null {
    return Tools.getUrl("https://dict.leo.org/grammatik/deutsch/Rechtschreibung/Regeln/Gross-klein/index.html");
  }

  override getDescription(): string {
    return "Großschreibung von Nomen und substantivierten Verben";
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();

    let prevTokenIsDas = false;
    let isPrecededByModalOrAuxiliary = false;
    for (let i = 0; i < tokens.length; i++) {
      //Note: defaulting to the first analysis is only save if we only query for sentence start
      const posToken = tokens[i]!.getAnalyzedToken(0).getPOSTag();
      if (JLanguageTool.SENTENCE_START_TAGNAME === posToken) {
        continue;
      }
      if (i === 1) {   // don't care about first word, UppercaseSentenceStartRule does this already
        prevTokenIsDas = CaseRule.nounIndicators.has(tokens[1]!.getToken().toLowerCase());
        continue;
      }
      if (i > 0 && (this.isSalutation(tokens[i-1]!.getToken()) || this.isCompany(tokens[i-1]!.getToken()))) {   // e.g. "Frau Stieg" could be a name, ignore
        continue;
      }

      // 1.1 Technische Dokumentation
      if (i > 2 && CaseRule.NUMERALS_EN.matcher(tokens[i-1]!.getToken()).matches() && this.isDot(tokens[i-2]!.getToken()) && CaseRule.NUMERALS_EN.matcher(tokens[i-3]!.getToken()).matches()) {
        continue;
      }

      const analyzedToken = tokens[i]!;
      const token = analyzedToken.getToken();

      const isBaseform = analyzedToken.getReadingsLength() >= 1 && analyzedToken.hasLemma(token);
      if ((analyzedToken.getAnalyzedToken(0).getPOSTag() == null || GermanHelper.hasReadingOfType(analyzedToken, POSType.VERB))
          && isBaseform) {
        let nextTokenIsPersonalOrReflexivePronoun = false;
        if (i < tokens.length - 1) {
          const nextToken = tokens[i + 1]!;
          // avoid false alarm for "Das haben wir getan." etc:
          nextTokenIsPersonalOrReflexivePronoun = nextToken.hasPartialPosTag("PRO:PER") || StringUtils_equalsAny(nextToken.getToken(), "sich", "Sie");
          if (nextToken.hasPosTag("PKT")) {
            // avoid false alarm for "So sollte das funktionieren." (might also remove true alarms...)
            continue;
          }
          if (prevTokenIsDas
              && (StringUtils_equalsAny(nextToken.getToken(), ...CaseRule.DAS_VERB_EXCEPTIONS) ||
                  this.isFollowedByRelativeOrSubordinateClause(i, tokens)) ||
                  (i > 1 && this.hasPartialTag(tokens[i-2]!, "VER:AUX", "VER:MOD"))) {
            // avoid false alarm for "Er kann ihr das bieten, was sie verdient."
            // avoid false alarm for "Das wissen die meisten." / "Um das sagen zu können, ..."
            // avoid false alarm for "Du musst/solltest/könntest das wissen, damit du die Prüfung bestehst / weil wir das gestern besprochen haben."
            // avoid false alarm for "Wir werden das stoppen."
            // avoid false alarm for "Wahre Liebe muss das aushalten."
            continue;
          }
        }
        if (this.isPrevProbablyRelativePronoun(tokens, i) ||
            (prevTokenIsDas && this.getTokensWithPosTagStartingWithCount(tokens, "VER") === 1)) {// ignore sentences containing a single verb, e.g., "Das wissen viele nicht."
          continue;
        }
        this.potentiallyAddLowercaseMatch(ruleMatches, tokens[i]!, prevTokenIsDas, token, nextTokenIsPersonalOrReflexivePronoun, sentence);
      }
      prevTokenIsDas = CaseRule.nounIndicators.has(tokens[i]!.getToken().toLowerCase());
      if (analyzedToken.matchesPosTagRegex(CaseRule.VER_MOD_AUX)) {
        isPrecededByModalOrAuxiliary = true;
      }
      const lowercaseReadings = (this.language.getTagger() as GermanTagger).lookup(token.toLowerCase());
      if (this.hasNounReading(analyzedToken)) { // it's the spell checker's task to check that nouns are uppercase
        if (!this.isPotentialUpperCaseError(i, tokens, lowercaseReadings, isPrecededByModalOrAuxiliary)) {
          continue;
        }
      } else if (analyzedToken.hasPosTagStartingWith("SUB:") &&
                 i < tokens.length-1 &&
                 Character.isLowerCase(tokens[i+1]!.getToken().charAt(0)) &&
                 tokens[i+1]!.matchesPosTagRegex("(VER:[123]:|PA2).+")) {
        // "Viele Minderjährige sind" but not "Das wirklich Wichtige Verfahren ist"
        continue;
      }
      if (analyzedToken.getAnalyzedToken(0).getPOSTag() == null && lowercaseReadings == null) {
        continue;
      }
      if (analyzedToken.getAnalyzedToken(0).getPOSTag() == null && lowercaseReadings != null
          && (lowercaseReadings.getAnalyzedToken(0).getPOSTag() == null || analyzedToken.getToken().endsWith("innen"))) {
        continue;  // unknown word, probably a name etc.
      }
      this.potentiallyAddUppercaseMatch(ruleMatches, tokens, i, analyzedToken, token, lowercaseReadings, sentence);
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private getTokensWithPosTagStartingWithCount(tokens: AnalyzedTokenReadings[], partialPosTag: string): number {
    return tokens.filter((token) => token.hasPosTagStartingWith(partialPosTag)).length;
  }

  private isPotentialUpperCaseError(pos: number, tokens: AnalyzedTokenReadings[],
      lowercaseReadings: AnalyzedTokenReadings | null, isPrecededByModalOrAuxiliary: boolean): boolean {
    if (pos <= 1) {
      return false;
    }

    // "Das ist zu Prüfen." but not "Das geht zu Herzen."
    if ("zu" === tokens[pos-1]!.getToken() &&
      !tokens[pos]!.matchesPosTagRegex(".*(NEU|MAS|FEM)$") &&
      lowercaseReadings != null &&
      lowercaseReadings.hasPosTagStartingWith("VER:INF")) {
      return true;
    }
    if (CaseRule.VERHALTEN.matcher(tokens[pos]!.getToken()).matches()) {
      return false;
    }
    // find error in: "Man müsse Überlegen, wie man das Problem löst."
    let isPotentialError = pos < tokens.length - 3
        && tokens[pos+1]!.getToken() === ","
        && StringUtils_equalsAny(tokens[pos+2]!.getToken(), ...CaseRule.INTERROGATIVE_PARTICLES)
        && tokens[pos-1]!.hasPosTagStartingWith("VER:MOD")
        && !tokens[pos-1]!.hasLemma("mögen")
        && !(tokens[pos+3]!.getToken() === "zum");
    if (!isPotentialError &&
        lowercaseReadings != null
        && tokens[pos]!.hasAnyPartialPosTag("SUB:NOM:SIN:NEU:INF", "SUB:DAT:PLU:")
        && ("zu" === tokens[pos-1]!.getToken() || this.hasPartialTag(tokens[pos-1]!, "SUB", "EIG", "VER:AUX:3:", "ADV:TMP", "ABK"))) {
      // find error in: "Der Brief wird morgen Übergeben." / "Die Ausgaben haben eine Mrd. Euro Überschritten."
      isPotentialError ||= lowercaseReadings.hasPosTag("PA2:PRD:GRU:VER") && !tokens[pos-1]!.hasPosTagStartingWith("VER:AUX:3") && !lowercaseReadings.hasPosTag("VER:3:PLU:PRT:NON");
      // find error in: "Er lässt das Arktisbohrverbot Überprüfen."
      // find error in: "Sie bat ihn, es zu Überprüfen."
      // find error in: "Das Geld wird Überwiesen."
      isPotentialError ||= (pos >= tokens.length - 2 || "," === tokens[pos+1]!.getToken())
        && ("zu" === tokens[pos-1]!.getToken() || isPrecededByModalOrAuxiliary)
        && tokens[pos]!.getToken().startsWith("Über")
        && lowercaseReadings.hasAnyPartialPosTag("VER:INF:", "PA2:PRD:GRU:VER");
      }
    return isPotentialError;
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns();
  }

  // e.g. "Ein Kaninchen, das zaubern kann" - avoid false alarm here
  //                          ^^^^^^^
  private isPrevProbablyRelativePronoun(tokens: AnalyzedTokenReadings[], i: number): boolean {
    return i >= 3 &&
      tokens[i-1]!.getToken() === "das" &&
      tokens[i-2]!.getToken() === "," &&
      tokens[i-3]!.matchesPosTagRegex("SUB:...:SIN:NEU");
  }

  private isSalutation(token: string): boolean {
    return StringUtils_equalsAny(token, "Herr", "Hr", "Herrn", "Frau", "Fr", "Fräulein");
  }

  private isCompany(token: string): boolean {
    return StringUtils_equalsAny(token, "Firma", "Familie", "Unternehmen", "Firmen", "Bäckerei", "Metzgerei", "Fa");
  }

  private isDot(token: string): boolean {
    return token === ".";
  }

  private hasNounReading(readings: AnalyzedTokenReadings | null): boolean {
    if (readings != null) {
      // Anmeldung bis Fr. 1.12. (Fr. as abbreviation of Freitag is has a noun reading!)
      if (readings.hasPosTagStartingWith("ABK") && readings.hasPartialPosTag("SUB")) {
        return true;
      }
      // "Die Schöne Tür": "Schöne" also has a noun reading but like "SUB:AKK:SIN:FEM:ADJ", ignore that:
      const allReadings = this.lookup(readings.getToken().replaceAll("­", ""));  // unification in disambiguation.xml removes reading, so look up again, removing soft hyphens
      if (allReadings != null) {
        for (const reading of allReadings.getReadings()) {
          const posTag = reading.getPOSTag();
          if (posTag != null && posTag.includes("SUB:") && !posTag.includes(":ADJ")) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private potentiallyAddLowercaseMatch(ruleMatches: RuleMatch[], tokenReadings: AnalyzedTokenReadings, prevTokenIsDas: boolean, token: string, nextTokenIsPersonalOrReflexivePronoun: boolean, sentence: AnalyzedSentence): void {
    // e.g. essen -> Essen
    if (prevTokenIsDas &&
        !nextTokenIsPersonalOrReflexivePronoun &&
        Character.isLowerCase(token.charAt(0)) &&
        !CaseRule.substVerbenExceptions.has(token) &&
        tokenReadings.hasPosTagStartingWith("VER:INF") &&
        !tokenReadings.isIgnoredBySpeller() &&
        !tokenReadings.isImmunized()) {
      this.addRuleMatch(ruleMatches, sentence, CaseRule.LOWERCASE_MESSAGE, tokenReadings, StringTools.uppercaseFirstChar(tokenReadings.getToken())!);
    }
  }

  private potentiallyAddUppercaseMatch(ruleMatches: RuleMatch[], tokens: AnalyzedTokenReadings[], i: number, analyzedToken: AnalyzedTokenReadings, token: string, lowercaseReadings: AnalyzedTokenReadings | null, sentence: AnalyzedSentence): void {
    const isUpperFirst = Character.isUpperCase(token.charAt(0));
    const lcWord = StringTools.lowercaseFirstChar(tokens[i]!.getToken());
    if (isUpperFirst &&
        token.length > 1 &&     // length limit = ignore abbreviations
        !tokens[i]!.isIgnoredBySpeller() &&
        !tokens[i]!.isImmunized() &&
        !StringUtils_equalsAny(tokens[i - 1]!.getToken(), ...CaseRule.SENTENCE_START_EXCEPTIONS) &&
        !StringUtils_equalsAny(token, ...CaseRule.exceptions) &&
        !StringTools.isAllUppercase(token) &&
        !this.isLanguage(i, tokens, token) &&
        !this.isProbablyCity(i, tokens, token) &&
        !GermanHelper.hasReadingOfType(analyzedToken, POSType.PROPER_NOUN) &&
        !analyzedToken.isSentenceEnd() &&
        !this.isEllipsis(i, tokens) &&
        !this.isNumbering(i, tokens) &&
        !this.isNominalization(i, tokens, token, lowercaseReadings) &&
        !this.isAdverbAndNominalization(i, tokens) &&
        !this.isSpecialCase(i, tokens) &&
        !this.isAdjectiveAsNoun(i, tokens, lowercaseReadings) &&
        !this.isSingularImperative(lowercaseReadings, tokens[i]!) &&  // too many names like "Kusch", "Klemm" etc.
        !this.isExceptionPhrase(i, tokens) &&
        !(i === 2 && "“" === tokens[i-1]!.getToken()) &&   // closing quote at sentence start (https://github.com/languagetool-org/languagetool/issues/2558)
        !this.isCaseTypo(tokens[i]!.getToken()) &&
        !this.followedByGenderGap(tokens, i) &&
        !this.isNounWithVerbReading(i, tokens) &&
        !this.isInvisibleSeparator(i-1, tokens) &&
        !this.language.getDefaultSpellingRule().isMisspelled(lcWord)) {
      if (":" === tokens[i - 1]!.getToken()) {
        // allow short question sentences like "Warum? Und warum?" after colon
        if (this.isQuestionEquivalentAfterColon(i, tokens)) {
          return;
        }

        const subarray: AnalyzedTokenReadings[] = tokens.slice(0, i);

        if (this.isVerbFollowing(i, tokens, lowercaseReadings) || this.getTokensWithPosTagStartingWithCount(subarray, "VER") === 0) {
        } else {
          this.addRuleMatch(ruleMatches, sentence, CaseRule.COLON_MESSAGE, tokens[i]!, lcWord);
        }
        return;
      }
      this.addRuleMatch(ruleMatches, sentence, CaseRule.UPPERCASE_MESSAGE, tokens[i]!, lcWord);
    }
  }

  private followedByGenderGap(tokens: AnalyzedTokenReadings[], i: number): boolean {
    if (i + 2 < tokens.length && tokens[i+1]!.getToken() === ":" && StringMatches(tokens[i+2]!.getToken(), "in|innen")) {
      return true;
    }
    return false;
  }

  private isCaseTypo(token: string): boolean {
    return CaseRule.TWO_UPPERCASE_CHARS.matcher(token).matches();   // e.g. "WUrzeln"
  }

  private isSingularImperative(lowercaseReadings: AnalyzedTokenReadings | null, token: AnalyzedTokenReadings): boolean {
    return lowercaseReadings != null && lowercaseReadings.hasPosTagStartingWith("VER:IMP:SIN") &&
              !("Ein" === token.getToken()) && !("Eine" === token.getToken());
  }

  private isNounWithVerbReading(i: number, tokens: AnalyzedTokenReadings[]): boolean {
    return tokens[i]!.hasPosTagStartingWith("SUB") &&
        tokens[i]!.hasPosTagStartingWith("VER:INF");
  }

  private isInvisibleSeparator(i: number, tokens: AnalyzedTokenReadings[]): boolean {  // u2063 is used internally by our browser add-on
    return i >= 0 && i < tokens.length && tokens[i]!.getToken().length > 0 && tokens[i]!.getToken().charAt(0) === '⁣';
  }

  private isVerbFollowing(i: number, tokens: AnalyzedTokenReadings[], lowercaseReadings: AnalyzedTokenReadings | null): boolean {
    const subarray: AnalyzedTokenReadings[] = tokens.slice(i);
    if (lowercaseReadings != null) {
      subarray[0] = lowercaseReadings;
    }
    // capitalization after ":" requires an independent clause to follow
    // if there is not a single verb, the tokens cannot be part of an independent clause
    return this.getTokensWithPosTagStartingWithCount(subarray, "VER:") !== 0;
}

  private isColonQuestionWord(word: string): boolean {
    return StringUtils_equalsAnyIgnoreCase(word, ...CaseRule.COLON_QUESTION_WORDS);
  }

  private addRuleMatch(ruleMatches: RuleMatch[], sentence: AnalyzedSentence, msg: string, tokenReadings: AnalyzedTokenReadings, fixedWord: string): void {
    const ruleMatch = new RuleMatch(this, sentence, tokenReadings.getStartPos(), tokenReadings.getEndPos(), msg);
    ruleMatch.setSuggestedReplacement(fixedWord);
    ruleMatches.push(ruleMatch);
  }

  // e.g. "a) bla bla"
  private isNumbering(i: number, tokens: AnalyzedTokenReadings[]): boolean {
    return i >= 2
            && StringUtils_equalsAny(tokens[i-1]!.getToken(), ")", "]")
            && CaseRule.NUMERALS_EN.matcher(tokens[i-2]!.getToken()).matches()
            && !(i > 3 && tokens[i-3]!.getToken() === "("
              && tokens[i-4]!.hasPosTagStartingWith("SUB:")); // no numbering "Der Vater (51) fuhr nach Rom."
  }

  private isEllipsis(i: number, tokens: AnalyzedTokenReadings[]): boolean {
    return StringUtils_equalsAny(tokens[i-1]!.getToken(), "]", ")") && // sentence starts with […]
           ((i === 4 && tokens[i-2]!.getToken() === "…") || (i === 6 && tokens[i-2]!.getToken() === "."));
  }

  private isNominalization(i: number, tokens: AnalyzedTokenReadings[], token: string, lowercaseReadings: AnalyzedTokenReadings | null): boolean {
    const nextReadings = i < tokens.length-1 ? tokens[i+1]! : null;
    // TODO: "vor Schlimmerem", "Er hatte Schlimmes zu befürchten"
    // TODO: wir finden den Fehler in "Die moderne Wissenschaftlich" nicht, weil nicht alle
    // Substantivierungen in den Morphy-Daten stehen (z.B. "Größte" fehlt) und wir deshalb nur
    // eine Abfrage machen, ob der erste Buchstabe groß ist.
    if (StringTools.startsWithUppercase(token) && !this.isNumber(token) && !(this.hasNounReading(nextReadings) ||
        (nextReadings != null && StringUtils_isNumeric(nextReadings.getToken()))) && !StringMatches(token, "Alle[nm]")) {
      if (lowercaseReadings != null && lowercaseReadings.hasPosTag("PRP:LOK+TMP+CAU:DAT+AKK")) {
        return false;
      }
      // Ignore "das Dümmste, was je..." but not "das Dümmste Kind"
      const prevToken = i > 0 ? tokens[i-1]! : null;
      const prevPrevToken = i >= 2 ? tokens[i-2]! : null;
      const prevPrevPrevToken = i >= 3 ? tokens[i-3]! : null;
      const prevTokenStr = prevToken != null ? prevToken.getToken() : "";
      if (StringUtils_equalsAny(prevTokenStr, "und", "oder", "beziehungsweise") && prevPrevToken != null &&
          (tokens[i]!.hasPartialPosTag("SUB") && tokens[i]!.hasPartialPosTag(":ADJ")) || //"das dabei Erlernte und Erlebte ist ..." -> 'Erlebte' is correct here
          (prevPrevToken!.hasPartialPosTag("SUB") && !this.hasNounReading(nextReadings) && // "die Ausgaben für Umweltschutz und Soziales"
              lowercaseReadings != null && lowercaseReadings.hasPartialPosTag("ADJ") && !(prevTokenStr === ","))) {
       return true;
     }
      if (lowercaseReadings != null && lowercaseReadings.hasPosTag("PA1:PRD:GRU:VER")) {
        // "aus sechs Überwiegend muslimischen Ländern"
        return false;
      }
      return ((prevToken != null && CaseRule.IRGEND_ETC.matcher(prevTokenStr).matches() && tokens[i]!.hasPartialPosTag("SUB"))
              || this.isNumber(prevTokenStr)) ||
         (this.hasPartialTag(prevToken, "ART", "PRO:") && !(((i < 4 && tokens.length > 4) || prevToken!.getReadings().length === 1 || prevPrevToken!.hasLemma("sein")) && prevToken!.hasPosTagStartingWith("PRO:PER:NOM:"))  && !prevToken!.hasPartialPosTag(":STD")) ||  // "die Verurteilten", "etwas Verrücktes", "ihr Bestes"
         (this.hasPartialTag(prevPrevPrevToken, "ART") && this.hasPartialTag(prevPrevToken, "PRP") && this.hasPartialTag(prevToken, "SUB")) || // "die zum Tode Verurteilten"
         (this.hasPartialTag(prevPrevToken, "PRO:", "PRP") && this.hasPartialTag(prevToken, "ADJ", "ADV", "PA2", "PA1")) ||  // "etwas schön Verrücktes", "mit aufgewühltem Innerem"
         (this.hasPartialTag(prevPrevPrevToken, "PRO:", "PRP") && this.hasPartialTag(prevPrevToken, "ADJ", "ADV") && this.hasPartialTag(prevToken, "ADJ", "ADV", "PA2")) || // "etwas ganz schön Verrücktes"
         (tokens[i]!.hasPosTagStartingWith("SUB:") && this.hasPartialTag(prevToken, "GEN") && !this.hasPartialTag(nextReadings, "PKT")); // "Parks Vertraute Choi Soon Sil ist zu drei Jahren Haft verurteilt worden."
    }
    return false;
  }

  private isNumber(token: string): boolean {
    if (StringUtils_isNumeric(token)) {
      return true;
    }
    const lookup = this.lookup(StringTools.lowercaseFirstChar(token));
    return lookup != null && lookup.hasPosTag("ZAL");
  }

  private isAdverbAndNominalization(i: number, tokens: AnalyzedTokenReadings[]): boolean {
    const prevPrevToken = i > 1 ? tokens[i-2]!.getToken() : "";
    const prevToken = i > 0 ? tokens[i-1]! : null;
    const token = tokens[i]!.getToken();
    const nextReadings = i < tokens.length-1 ? tokens[i+1]! : null;
    // ignore "das wirklich Wichtige":
    return equalsIgnoreCase("das", prevPrevToken) && this.hasPartialTag(prevToken, "ADV")
            && StringTools.startsWithUppercase(token) && !this.hasNounReading(nextReadings);
  }

  private hasPartialTag(token: AnalyzedTokenReadings | null, ...posTags: string[]): boolean {
    if (token != null) {
      for (const posTag of posTags) {
        if (token.hasPartialPosTag(posTag)) {
          return true;
        }
      }
    }
    return false;
  }

  private isSpecialCase(i: number, tokens: AnalyzedTokenReadings[]): boolean {
    const prevToken = i > 1 ? tokens[i-1]!.getToken() : "";
    const token = tokens[i]!.getToken();
    const nextReadings = i < tokens.length-1 ? tokens[i+1]! : null;
    // ignore "im Allgemeinen gilt" but not "im Allgemeinen Fall":
    return equalsIgnoreCase("im", prevToken) && "Allgemeinen" === token && !this.hasNounReading(nextReadings);
  }

  private isAdjectiveAsNoun(i: number, tokens: AnalyzedTokenReadings[], lowercaseReadings: AnalyzedTokenReadings | null): boolean {
    const prevToken = i > 0 ? tokens[i-1]! : null;
    const nextReadings = i < tokens.length-1 ? tokens[i+1]! : null;
    let prevLowercaseReadings: AnalyzedTokenReadings | null = null;

    if (i > 1 && StringUtils_equalsAny(tokens[i-2]!.getToken(), ...CaseRule.SENTENCE_START_EXCEPTIONS)) {
      prevLowercaseReadings = this.lookup(prevToken!.getToken().toLowerCase());
    }

    // ignore "Der Versuch, Neues zu lernen / Gutes zu tun / Spannendes auszuprobieren"
    const isPossiblyFollowedByInfinitive = nextReadings != null && nextReadings.getToken() === "zu";
    const isFollowedByInfinitive = nextReadings != null && !isPossiblyFollowedByInfinitive && nextReadings.hasPartialPosTag("EIZ");
    const isFollowedByPossessiveIndicator = nextReadings != null && StringUtils_equalsAny(nextReadings.getToken(),...CaseRule.POSSESSIVE_INDICATORS);

    const isUndefQuantifier = prevToken != null && StringUtils_equalsAny(prevToken.getToken().toLowerCase(), ...CaseRule.UNDEFINED_QUANTIFIERS);
    const isPrevDeterminer = prevToken != null
                               && (this.hasPartialTag(prevToken, "ART", "PRP", "ZAL") || this.hasPartialTag(prevLowercaseReadings, "ART", "PRP", "ZAL"))
                               && !prevToken.hasPartialPosTag(":STD");
    const isPrecededByVerb = prevToken != null && prevToken.matchesPosTagRegex("VER:(MOD:|AUX:)?[1-3]:.*") && !prevToken.hasLemma("sein");
    if (!isPrevDeterminer && !isUndefQuantifier && !(isPossiblyFollowedByInfinitive || isFollowedByInfinitive)
        && !(isPrecededByVerb && lowercaseReadings != null && this.hasPartialTag(lowercaseReadings, "ADJ:", "PA") && nextReadings != null &&
             !StringUtils_equalsAny(nextReadings.getToken(), "und", "oder", ","))
        && !(isFollowedByPossessiveIndicator && this.hasPartialTag(lowercaseReadings, "ADJ", "VER")) // "Wacht auf, Verdammte dieser Welt!"
        && !(prevToken != null && prevToken.hasPosTag("KON:UNT") && !this.hasNounReading(nextReadings) && nextReadings != null && !nextReadings.hasPosTag("KON:NEB"))) {
      const prevPrevToken = i > 1 && prevToken != null && prevToken.hasPartialPosTag("ADJ") ? tokens[i-2]! : null;
      // Another check to avoid false alarms for "eine Gruppe Aufständischer starb"
      if (!isPrecededByVerb && lowercaseReadings != null && prevToken != null) {
        if (prevToken.hasPartialPosTag("SUB:") && lowercaseReadings.matchesPosTagRegex("(ADJ|PA2):GEN:PLU:MAS:GRU:SOL.*")) {
          return nextReadings != null && !nextReadings.hasPartialPosTag("SUB:");
        } else if (nextReadings != null && nextReadings.getReadingsLength() === 1 && prevToken.hasPosTagStartingWith("PRO:PER:NOM:") && nextReadings.hasPosTag("ADJ:PRD:GRU")) {
          // avoid false alarm "Weil er Unmündige sexuell missbraucht haben soll,..."
          return true;
        }
      }
      // Another check to avoid false alarms for "ein politischer Revolutionär"
      if (!this.hasPartialTag(prevPrevToken, "ART", "PRP", "ZAL")) {
        return false;
      }
    }

    // ignore "die Ausgewählten" but not "die Ausgewählten Leute":
    for (const reading of tokens[i]!.getReadings()) {
      const posTag = reading.getPOSTag();
      if ((posTag == null || posTag.includes("ADJ")) && !this.hasNounReading(nextReadings) && !StringUtils_isNumeric(nextReadings != null ? nextReadings.getToken() : "")) {
        if(posTag == null && this.hasPartialTag(lowercaseReadings, "PRP:LOK", "PA2:PRD:GRU:VER", "PA1:PRD:GRU:VER", "ADJ:PRD:KOM", "ADV:TMP")) {
          // skip to avoid a false true for, e.g. "Die Zahl ging auf Über 1.000 zurück."/ "Dies gilt schon lange als Überholt." / "Bis Bald!"
          // but not for "Er versuchte, Neues zu wagen."
        } else {
          return true;
        }
      }
    }

    return false;
  }

  private isLanguage(i: number, tokens: AnalyzedTokenReadings[], token: string): boolean {
    const maybeLanguage = (token.endsWith("sch") && LanguageNames.get().has(token)) ||
                            LanguageNames.get().has(StringUtils_removeEnd(StringUtils_removeEnd(token, "n"), "e"));   // z.B. "im Japanischen" / z.B. "ins Japanische übersetzt"
    const prevToken = i > 0 ? tokens[i-1]! : null;
    const nextReadings = i < tokens.length-1 ? tokens[i+1]! : null;
    return maybeLanguage && (!this.hasNounReading(nextReadings) || (prevToken != null && prevToken.getToken() === "auf"));
  }

  private isProbablyCity(i: number, tokens: AnalyzedTokenReadings[], token: string): boolean {
    const hasCityPrefix = StringUtils_equalsAny(token, "Klein", "Groß", "Neu");
    if (hasCityPrefix) {
      const nextReadings = i < tokens.length-1 ? tokens[i+1]! : null;
      return nextReadings != null && (!nextReadings.isTagged() || nextReadings.hasPosTagStartingWith("EIG"));
    }
    return false;
  }

  private isFollowedByRelativeOrSubordinateClause(i: number, tokens: AnalyzedTokenReadings[]): boolean {
    if (i < tokens.length - 4) {
      return "," === tokens[i+1]!.getToken()
             && (StringUtils_equalsAny(tokens[i+2]!.getToken(),...CaseRule.INTERROGATIVE_PARTICLES) || tokens[i+2]!.hasPosTag("KON:UNT"));
    }
    return false;
  }

  private isExceptionPhrase(i: number, tokens: AnalyzedTokenReadings[]): boolean {
    for (const patterns of CaseRule.exceptionPatterns) {
      for (let j = 0; j < patterns.length; j++) {
        if (patterns[j]!.matches(tokens[i]!.getToken())) {
          const startIndex = i-j;
          if (CaseRule.compareLists(tokens, startIndex, startIndex+patterns.length-1, ...patterns)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** @VisibleForTesting */
  static compareLists(tokens: AnalyzedTokenReadings[], startIndex: number, endIndex: number, ...patterns: StringMatcher[]): boolean {
    if (startIndex < 0) {
      return false;
    }
    let i = 0;
    for (let j = startIndex; j <= endIndex; j++) {
      if (i >= patterns.length || j >= tokens.length || !patterns[i]!.matches(tokens[j]!.getToken())) {
        return false;
      }
      i++;
    }
    return true;
  }

  /**
   * Returns true if the token at position i starts a short question fragment
   * that forms a valid Satzäquivalent after a colon, per Duden rules.
   * Handles:
   *   single word:          "Ich frage mich: Warum?"
   *   with conjunction:     "Ich frage mich: Und warum?"
   * @VisibleForTesting
   */
  isQuestionEquivalentAfterColon(i: number, tokens: AnalyzedTokenReadings[]): boolean {
    if (i < tokens.length - 1) {
      const word = tokens[i]!.getToken();
      const next = tokens[i + 1]!.getToken();
      // "Warum?"
      if (this.isColonQuestionWord(word) && "?" === next) {
        return true;
      }
      // "Und warum?"
      if (StringUtils_equalsAnyIgnoreCase(word, ...CaseRule.COLON_QUESTION_CONJUNCTIONS)
          && i < tokens.length - 2
          && this.isColonQuestionWord(tokens[i + 1]!.getToken())
          && "?" === tokens[i + 2]!.getToken()) {
        return true;
      }
    }
    return false;
  }

  private lookup(word: string): AnalyzedTokenReadings | null {
    return (this.language.getTagger() as GermanTagger).lookup(word);
  }
}
