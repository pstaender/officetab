// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanSpellerRule.java faithful
// The constructors are one: (messages, language[, userConfig, languageVariantPlainTextDict[,
// altLanguages, languageModel]]). The static patterns are compiled on first use (P()), the static
// initializer (ADDITIONAL_SUGGESTIONS, PREVENT_SUGGESTION_PATTERNS) runs when the first rule is
// constructed, and jwordsplitter's splitter is created on first use, as the resources are only
// loaded by then. Checked IOExceptions and their try/catch wrappers disappear. getSpeller reads the
// plain text files as lines (CompoundAwareHunspellRule.getStreams); ExpandingReader extends
// MorfologikMultiSpeller's LineReader instead of BufferedReader. The static imports of StringTools
// and StringUtils/RegExUtils helpers are local functions. Java's toLowerCase(Locale) is
// toLowerCase() (the German locale lowercases as the root locale does).
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { RuleMatch } from '../../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { SuggestedReplacement } from '../../../../../../languagetool-core/org/languagetool/rules/SuggestedReplacement.ts';
import { StringMatcher } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/StringMatcher.ts';
import { CommonFileTypes } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/CommonFileTypes.ts';
import { CompoundAwareHunspellRule } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/hunspell/CompoundAwareHunspellRule.ts';
import { LineReader, MorfologikMultiSpeller } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/morfologik/MorfologikMultiSpeller.ts';
import type { Synthesizer } from '../../../../../../languagetool-core/org/languagetool/synthesis/Synthesizer.ts';
import type { Tagger } from '../../../../../../languagetool-core/org/languagetool/tagging/Tagger.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import type { German } from '../../language/German.ts';
import { GermanCompoundTokenizer } from '../../tokenizers/de/GermanCompoundTokenizer.ts';
import { GermanTools } from './GermanTools.ts';
import { LineExpander } from './LineExpander.ts';
import { GermanWordSplitter } from '../../../../../../../jwordsplitter/de/danielnaber/jwordsplitter/GermanWordSplitter.ts';
import { InputTooLongException } from '../../../../../../../jwordsplitter/de/danielnaber/jwordsplitter/InputTooLongException.ts';
import { Character, StringTrim } from '../../../../../../../jdk/java/lang/Character.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringMatches, StringReplaceAll, StringReplaceFirst, StringSplit } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const compile = (regex: string): Pattern => Pattern.compile(regex);

// static imports (StringTools.*, SuggestedReplacement.topMatch, StringUtils.removeEnd)
const uppercaseFirstChar = (s: string): string => StringTools.uppercaseFirstChar(s)!;
const lowercaseFirstChar = (s: string): string => StringTools.lowercaseFirstChar(s);
const startsWithUppercase = (s: string): boolean => StringTools.startsWithUppercase(s);
const startsWithLowercase = (s: string): boolean => StringTools.startsWithLowercase(s);
const isAllUppercase = (s: string): boolean => StringTools.isAllUppercase(s);
const topMatch = (word: string, shortDesc: string | null = null): SuggestedReplacement[] => SuggestedReplacement.topMatch(word, shortDesc);

/** StringUtils.removeEnd */
function removeEnd(str: string | null, remove: string): string | null {
  if (str == null || str.length === 0 || remove.length === 0) return str;
  return str.endsWith(remove) ? str.substring(0, str.length - remove.length) : str;
}

/** StringUtils.replaceOnce */
function replaceOnce(text: string, searchString: string, replacement: string): string {
  const i = text.indexOf(searchString);
  return i < 0 || searchString.length === 0 ? text : text.substring(0, i) + replacement + text.substring(i + searchString.length);
}

/** StringUtils.startsWithAny */
function startsWithAny(s: string, ...prefixes: string[]): boolean {
  return prefixes.some((p) => s.startsWith(p));
}

/** StringUtils.endsWithAny */
function endsWithAny(s: string, ...suffixes: string[]): boolean {
  return suffixes.some((p) => s.endsWith(p));
}

/** StringUtils.equalsAny */
function equalsAny(s: string, ...strings: string[]): boolean {
  return strings.includes(s);
}

/** StringUtils.uncapitalize */
function uncapitalize(s: string): string {
  return s.length === 0 ? s : Character.toLowerCase(s.charAt(0)) + s.substring(1);
}

/** StringUtils.capitalize */
function capitalize(s: string): string {
  return s.length === 0 ? s : Character.toTitleCase(s.charAt(0)) + s.substring(1);
}

/** StringUtils.substringAfter */
function substringAfter(s: string, separator: string): string {
  const pos = s.indexOf(separator);
  return pos < 0 ? '' : s.substring(pos + separator.length);
}

/** StringUtils.isAllUpperCase */
function isAllUpperCaseCommons(s: string): boolean {
  if (s.length === 0) return false;
  for (const c of s) if (!Character.isUpperCase(c)) return false;
  return true;
}

/** StringUtils.isAllLowerCase */
function isAllLowerCaseCommons(s: string): boolean {
  if (s.length === 0) return false;
  for (const c of s) if (!Character.isLowerCase(c)) return false;
  return true;
}

/** Collection.removeIf */
function removeIf<T>(list: T[], filter: (t: T) => boolean): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (filter(list[i]!)) list.splice(i, 1);
  }
}

/** RegExUtils.removePattern (DOTALL) */
function removePattern(text: string, regex: string): string {
  return Pattern.compile(regex, Pattern.DOTALL).matcher(text).replaceAll('');
}

export const RULE_ID = 'GERMAN_SPELLER_RULE';

const MIN_WORD_LENGTH   = 5;
const MAX_WORD_LENGTH   = 40;
const MAX_EDIT_DISTANCE = 2;

const adjSuffix = "(affin|basiert|konform|widrig|fähig|haltig|bedingt|gerecht|würdig|relevant|" +
  "übergreifend|tauglich|untauglich|artig|bezogen|orientiert|fremd|liebend|hassend|bildend|hemmend|abhängig|zentriert|" +
  "förmig|mäßig|pflichtig|ähnlich|spezifisch|verträglich|technisch|typisch|frei|arm|freundlich|feindlich|gemäß|neutral|seitig|begeistert|geeignet|ungeeignet|berechtigt|sicher|süchtig|resistent|verachtend|schädigend)";

const lcDoNotSuggestWords = new Set<string>([
  // some of these are taken from hunspell's dictionary where non-suggested words use tag "/n":
  "verjuden", "verjudet", "verjudeter", "verjudetes", "verjudeter", "verjudeten", "verjudetem",
  "entjuden", "entjudet", "entjudete", "entjudetes", "entjudeter", "entjudeten", "entjudetem",
  "auschwitzmythos",
  "judensippe", "judensippen",
  "judensippschaft", "judensippschaften",
  "nigger", "niggern", "niggers", "neger", "negers", "negern",
  "rassejude", "rassejuden", "rassejüdin", "rassejüdinnen",
  "möse", "mösen", "fotze", "fotzen",
  "judenfrei", "judenfreie", "judenfreier", "judenfreies", "judenfreien", "judenfreiem",
  "judenrein", "judenreine", "judenreiner", "judenreines", "judenreinen", "judenreinem",
  "judenmord", "judenmorden", "judenmörder"
]);

const MAX_TOKEN_LENGTH = 200;

function createPatterns() {
  return {
    missingAdjPattern:  compile("[a-zöäüß]{3,25}" + adjSuffix + "(er|es|en|em|e)?"),
    compoundPatternWithHeit: compile(".*(heit|keit|ion|ität|schaft|ung|tät)s"),
    compoundPatternWithAction: compile("Action|Session|Champion|Jung|Wahrung"),
    compoundPatternWithFirst: compile("First|Firsten"),  // First/First are too easy to mix up
    compoundPatternSpecialEnding: compile(".*(mus|ss|z|ß|innen|chen)"),
    GENDER_STAR_PATTERN: compile("([A-ZÖÄÜ][a-zöäüß]{1,25}|[A-ZÖÄÜ]{1,10}-[A-ZÖÄÜ][a-zöäüß]{1,25})[*:_][a-zöäüß]{1,25}"),  // z.B. "Jurist:innenausbildung"
    FILE_UNDERLINE_PATTERN: compile("[a-zA-Z0-9-]{1,25}_[a-zA-Z0-9-]{1,25}\\.[a-zA-Z]{1,5}"),
    MENTION_UNDERLINE_PATTERN: compile("@[a-zA-Z0-9-]{1,25}_[a-zA-Z0-9_-]{1,25}"),
    FIRST_UPPER_CASE: compile("[A-ZÖÄÜ][a-zöäüß-]+"),
    HYPHENED_UPPER_WORD: compile("[A-ZÖÄÜ][a-zöäüß]+-[\\\\-\\\\s]?[a-zöäüß]+"),
    HYPHENED_WORD: compile("[a-zöäüß]+-[\\-\\s][A-ZÖÄÜa-zöäüß]+"),
    START_WITH_SPIEL: compile("Spielzugs?|Spielzugangs?|Spielzuganges|Spielzugbuchs?|Spielzugbüchern?|Spielzuges|Spielzugverluste?|Spielzugverluste[ns]"),
    END_WITH_SCHAFTE: compile( ("[A-ZÖÄÜ][a-zöäß-]+schafte")),
    WORD_WITH_PUNCT: compile("\\w\\p{Punct}?"),
    LOWER_CASE_WORD: compile("[a-zöäü]-.+"),
    SPECIAL_CASE: compile(".{3,25}(tum|ing|ling|heit|keit|schaft|ung|ion|tät|at|um)"),
    SPECIAL_CASE_WITH_S: compile(".{3,25}(tum|ing|ling|heit|keit|schaft|ung|ion|tät|at|um)s"),
    AUTENTISCH_WITH_CASES: compile("[Aa]utentisch(e[nmsr]?|ste[nmsr]?|ere[nmsr]?)?"),
    SYMPHATISCH: compile("symphatisch(e[nmsr]?|ste[nmsr]?|ere[nmsr]?)?"),
    BRILLIANT_WITH_CASES: compile("brilliant(e[nmsr]?|ere[nmsr]?|este[nmsr]?)?"),
    RECHTMASIG_WITH_CASES: compile("rechtmässig(e[nmsr]?|ere[nmsr]?|ste[nmsr]?)?"),
    HOLZ_SPIEGEL_PANEL_COMPOUND: compile("(Holz|Spiegel)panel(s|en?)?"),
    SBHAN_PREFIX: compile("SBahn(en|hofs?|zug(e?s)?|zügen?|höfen?|netz(e[ns]?)?|tunnel[sn]?|linien?)?"),
    UBAHN_PREFIX: compile("UBahn(en|hofs?|zug(e?s)?|zügen?|höfen?|netz(e[ns]?)?|tunnel[sn]?|linien?)?"),
    SCHAF_PATTERN: compile(".{3,}schaf(s|en)?"),
    SCHAFE_PATTERN: compile("(Alpenschaf|Berberschaf|Bergschaf|Blauschaf|Brillenschaf|Dachsteinschaf|Deichschaf|Dickhornschaf|Feinwollschaf|Fettschwanzschaf|Fleischschaf|Fuchsschaf|Glücksschaf|Hausschaf|Jungschaf|Karakulschaf|Klonschaf|Merinoschaf|Milchschaf|Mondschaf|Nutzschaf|Rhönschaf|Riesenwildschaf|Schaukelschaf|Schneeschaf|Steinschaf|Steppenschaf|Superschaf|Waldschaf|Weideschaf|Wildschaf|Wollschaf|Zackelschaf|Zuchtschaf|Zwergblauschaf)(s|en)?"),
    START_WITH_NEGER: compile("neger.*"),
    CONTAINS_NEGER: compile(".+neger(s|n|in|innen)?"),
    CONTAINS_NEGER_2: compile(".+-neger(s|n|in|innen)?-.+"),
    CONTAINS_UNCOMMON_LOWERCASED_NOUN_AT_BEGINNING: compile("^(hunger|zeit|käse|zwiebel|kommoden?|lager|angst|freund|feind)\\s.+"),
    CONTAINS_UNCOMMON_LOWERCASED_NOUN_AT_END: compile(".+\\s(hunger|zeit|käse|zwiebel|kommoden?|lager|angst|freund|feind)$"),
    ENDS_WITH_IBELKEIT_IBLICHKEIT: compile(".*ibel[hk]eit$"),
    ALLMAHLLIG: compile("[aA]llmähll?i(g|ch)(e[mnrs]?)?"),
    CONTAINS_MAYONNAISE: compile(".*[mM]a[jy]onn?[äe]se.*"),
    CONTAINS_MASZNAME: compile(".*[mM]a(ss|ß)namen?.*"),
    CONTAINS_RESERVIERUNG: compile(".*[rR]es(a|er)[vw]i[he]?rung(en)?"),
    STARTS_WITH_RESCHASCHIER: compile("[rR]eschaschier.+"),
    ENDS_WITH_LABORANTS: compile(".*[lL]aborants$"),
    PROFESSIONELL: compile("[pP]roff?ess?ion([äe])h?ll?(e[mnrs]?)?"),
    VERSTANDNIS: compile("[vV]erstehendniss?(es?)?"),
    STARTS_WITH_DIAGNOSZIER: compile("diagno[sz]ier.*"),
    STARTING_WITH_SINGLE_CHAR: compile("\\p{L} \\p{L}+"),
    SPECIAL_CASE_THIRD: compile("[A-ZÖÄÜ][a-zöäüß]{2,}(ei|öl)$"),
    ZB: compile("z[bB]"),
    STARTS_WITH_ZB: compile("z[bB]."),
    DIRECTION: compile("nord|ost|süd|west"),
    WOCHENTAGE: compile("Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag"),
    WOCHENTAGE_S: compile("(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)s"),
    CAMEL_CASE: compile(".*(\\p{Ll}\\p{Lu}|\\p{Lu}{2,}\\p{Ll}).*"),
    COMPOUND_TYPOS: compile("([Ee]mail|[Ii]reland|[Kk]reissaal|[Mm]akeup|[Ss]tandart).*"),
    COMPOUND_END_TYPOS: compile(".*(gruße|schaf(s|en)?)$"),
    INFIX_S_SUFFIXES: compile(".*(heit|(s|[^c]t|x)ion|ität|keit|ling|ung|schaft|tum)$"),
    WECHSELINFIX: compile("(arbeit|dienstag|donnerstag|freitag|montag|mittwoch|link|recht|samstag|sonntag|verband)s?"),
    CONFUSED_PREFIXES: compile("bach|bade?|wi(e)?der"),
    NEEDS_TO_BE_PLURAL: compile("absolvent(in)?|adressat|aktie|antenne|apache|arbeitnehmer(in)?|ärztin|assistent(in)?|astronom(in)?|asylant(in)?|autor(in)?|azteke|bakterie|ballade|bauer|billion|bisexuelle|blume|bonze|börse|bot(e|in)|buche|bürg(e|in)|bürokrat(in)?|chrysantheme|dän(e|in)?|debatte|debitor(in)?|decke|diakon(in)?|diktator(in)?|direktor(in)?|doktorand(in)?|domäne|dozent(in)?|drohne|druid(e|in)?|düne|ehre|eibe|elefant|elektron|ellipse|emittent(in)?|elfe|elle|enge|erbse|eremit|erde|erste|esche|exot(e|in)?|expert(e|in)?|extremist(in)?|fabrikant(in)?|falke|fassade|farbe|fasan|favorit(in)?|felge|ferien|figur|fluor|frage|franz(ose|ösin)|frau|frisur|förde|galle|gatt(e|in)?|gerät|gepard|gezeit|gigant|gilde|göttin|griech(e|in)?|halt|heid(e|in)?|herde|historie|hölle|höhle|hose|hugenott(e|in)?|hund|hündin|immigrant(in)?|investor(in)?|irokes(e|in)|islamist(in)?|jesuit(in)?|jungfer|jungfrau|junggesell(e|in)|juror(in)?|kadett|kante|kaskade|kathode|katholik(in)?|katze|kette|kid|klasse|kirche|klaue|klient(in)?|klinge|knappe|koeffizient|kojote|komet|kommentator(in)?|komödie|kompliz(e|in)|konkurrent(in)?|konfirmand(in)?|konsonant|kontrahent(in)?|krake|kralle|kranke|krähe|kraut|krippe|kurd(e|in)|kuriosität|kurve|kusine|küste|laie|laterne|laute|legende|lehne|leise|lektor(in)?|leopard|lerche|leserin|lieferant(in)?|lippe|loge|lotse|länge|läuse|löwe|lücke|luke|made|mädel|maske|maßnahme|matriarchin|menge|mensch|metapher|methode|metropole|miene|miete|migrant(in)?|million|mitte|maus|moderator(in)?|monarch(in)?|mongol(e|in)|mormone|mücke|mühle|musikant(in)?|mysterium|nerv|niederlage|nixe|nonne|note|obdachlose|ode|organist|panne|papagei|parzelle|pastor(in)?|pate|patient|patriarch(in)?|petze|pfadfinderin|pfanne|pfaffe|pfau|pfeife|platte|polle|pomade|pomeranze|posse|praktikant(in)?|prinz(essin)?|prise|produzent(in)?|prominente|prophet(in)?|prototyp|prälat|psychopath(in)?|puppe|pädophile|pygmäe|rabe|radikale|rakete|rampe|ranke|rassist(in)?|rate|raupe|rendite|repressalie|rest|riese|rinde|rind|robbe|robe|romanist|rose|ross|route|nummer|runde|russ(e|in)?|röhre|rübe|salbe|schabe|schale|scheide|schelle|schenke|schere|sphäre|dicke|kröte|schauspielerin|schimpans(e|in)|schlampe|schlange|schluchte|schmiere|schnake|schnalle|schneide|schnelle|schokolade|schotte|schurke|schwabe|schwalbe|schwede|schwule|seele|seide|seite|senator(in)?|serb(e|in)?|serie|silbe|skulptur|sonne|sorge|sorte|spanne|sparte|spatz|sperre|spitze|sproße|spule|stalaktit|steppe|straße|streife|studie|stunde|stütze|tabelle|therapeut(in)?|tinte|tote|toilette|torte|traube|treffe|treppe|truhe|träne|tunte|tüte|tyrann|urne|utensil|vandal(e|in)|vasall(in)?|vene|versicherte|verwandte|veteran(in)?|virtuose|vorname|waffe|wanne|ware|watte|wehe|welle|welpe|wiese|wirtin|zar(in)?|zentrum|zutat"),
    SUBNOMPLUFEM_EXCEPTIONS: compile(".+(atie|lyse|metrie|sophie|omie)|absage|accessoire|allergie|analogie|anästhesie|anatomie|anomalie|archäologie|aufnahme|balance|barriere|batterie|creme|deponie|dürre|einlage|energie|folklore|franchise|gemeinde|glu[ck]ose|gülle|hanse|hefe|hirse|infanterie|kolonie|kontrolle|lounge|massage|mathe|melodie|nässe|parfümerie|pharmazie|pflege|pipeline|poesie|psychotherapie|regie|renaissance|säure|single|sprache|spree|stärke|suche|teilnahme|theorie|therapie|vanille|wiederaufnahme|wende"),
    CITIES_EXCEPTIONS: compile("bahnhof|flughafen|haupt"),
    INVALID_COMP_PART_1: compile("adresse|ahmen|kamp|kontrolle|leuchte|norden|osten|perspektive|schule|sprache|stelle|suche|süden|westen"),  // words that can never be the first part of a compound (e. g. 'Sprache') or rare words that belong to a common confusion pair (e. g. Kamp/Kampf)
    INVALID_COMP_PART_2: compile("kamp"),  // 'kamp' will most likely be typo for 'kampf'
    SUBINF_SINGULAR_OBJECT: compile("putzen|rauchen|sein|spielen"),
    ARBEIT_COMP: compile("(gebe|nehme)(r(s|n|innen|in)?|nde[mnr]?)"),
    BACH_COMP: compile("aue|bett|biograph(ie|in)?|chor|forelle|gesellschaft|kantate|lauf|niederung|stelze|tal|verein"),
    BAD_COMP: compile("accessoire|architektur|besitzer(in)?|design|eintritt|fenster|größe|grund|kollektion|konzept|lösung|maß|möbel|nutzer(in)?|regal|spezialist(in)?|spiegel|straße|tür|utensil"),
    LINK_COMP: compile("element|inhalt|liste|portal|text|titel|tracking|verzeichnis"),
    LINKS_COMP: compile("abbieger(in)?|abweichler(in)?|anwalt|anwältin|anwaltschaft|ausfall|auslage|ausleger(in)?|au(ss|ß)en|bündnis|drall|drehung|extremer?|extremis(t|tin|mus)|faschis(t|tin|mus)|fraktion|galopp|gewinde|händ(er|erin|igkeit)|hörnchen|innen|intellektueller?|katholizis(t|tin|mus)|koalition|konter|kurs|kurve|lastigkeit|lenker|nationalis(t|tin|mus)|opposition|orientierung|partei|populis(t|tin|mus)|radikal(e|er|ismus|ist|istin)|regierung|ruck|rutsch|schnitt|schuss|schwenk(ung)?|sektierer(in)?|steuerung|terror(t|tin|ismus)|verbinder(in)?|verkehr|wendung|wichser"),
    PERSON_SUFFIXES: compile(".+([dlt]ant(in)?|arch(in)?|graf(in)?|gog(e|in)|([bdfghnoptuvxyz]|he|([inrt]a|o)(l)|(for|ga|i)m|[^f]r)(ist)(in)?|krat(in)?|man(e|in)|naut(in)?|olog(e|in)|(d|[pt]i|r)ent(in)?|seur(in)?|soph(in)?|tit(in)?|.+[^b]urg(in)?)$"),
    RECHT_COMP: compile("bank|eck|fertigung|gläubigkeit|haber|haberei|leitung|losigkeit|mäßigkeit|winkligkeit|zeitigkeit"),
    RECHTS_COMP: compile("abbieger(in)?|abteilung|akt|akte|angelegenheit|ansicht|anspruch|anwalt|anwalts|anwaltschaft|anwendung|anwältin|auffassung|aufsicht|auskunft|ausleger(in)?|ausschuss|au(ss|ß)en|begehren|begriff|behelf|beistand|berater|beratung|bereich|beschwerde|beugung|beziehung|brecher|bruch|dienst|drall|durchsetzung|empfinden|entwicklung|setzung|experte|experten|extremer?|extremis(t|tin|mus)|fall|fehler|folge|form|fortbildung|frage|fähigkeit|gebiet|gebieten|gelehrte|gelehrter|geschichte|geschäft|gewinde|gleichheit|grund|grundlage|grundsatz|gründen|gut|gutachten|gültigkeit|güter|handlung|hilfe|händ(er|erin|igkeit)|hängigkeit|inhaber|institut|katholizis(t|tin|mus)|klick|konformität|kraft|kreis|kurve|lage|lastigkeit|lehre|lenker|medizin|mediziner|meinung|missbrauch|mittel|mitteln|mängel|nachfolge|nachfolger|nachfolgerin|nationalis(t|tin|mus)|natur|norm|ordnung|persönlichkeit|pflege|pfleger|pflicht|philosophie|politik|populis(t|tin|mus)|position|praxis|problem|quelle|radikal(e|er|ismus|ist|istin)|rahmen|rat|ratgeber(in)?|ruck|rutsch|sache|sachen|satz|schutz|sicherheit|sinn|sprache|soziologie|sprechung|staat|staatlichkeit|stand|status|stellung|streit|streitigkeit|system|terroris(t|tin|ismus)|texte|texter|thema|theorie|tipp|titel|träger|unsicherheit|verfolgung|vergleichung|verhältnis|verkehr|verletzung|verletzungen|verordnung|verstoß|verständnis|verteidiger|verteidigung|vertreter|vertretung|vorschrift|wahl|weg|wesen|widrigkeit|wirksamkeit|wirkung|wissenschaft|wissenschaften|wissenschaftler|zug|änderung"),
    VERBAND_COMP: compile("klammer|kasten|kiste|mull|material|päckchen|platz|raum|schere|zeug|zimmer"),
    VERBANDS_COMP: compile("chef(in)?|flug|funktionär(in)?|kasse|klage|leben|leitung|leiter(in)?|ligist(in)|material|päckchen|präsident(in)?|presse|spiel|vertreter(in)|vorsitzender?|vorstand|wechsel|zeichen|zeit(schrift|ung)"),
    WIDER_COMP: compile("glanz|hall|haken|klage|klang|lager|rechtliche|ruf|spiel|spruch|sehen|stand|streit|wille"),
    WOCHENTAG_COMP: compile("abend|mittag|morgen|nachmittag|vormittag"),
    POTENTIAL_BINNEN_I: compile(".*((?<=(\\w))In).*"),
    GENDER_NEUTRAL_SPECIAL_CHRS_SIN: compile(".*[\\*:_/]in$"),
    GENDER_NEUTRAL_SPECIAL_CHRS_PLU: compile(".*[\\*:_/]in.+"),
    GENDER_NEUTRAL_SLASH_HYPHEN: compile(".*/-in.+"),
    GENDER_STAR: compile("((?<=(\\w))In|[\\*:_]in|/-in)"),
    GENDER2_STAR2: compile(".*((?<=(\\w))In|[\\*:_]in|/-in).*"),
    WECHSELNUMERUS: compile("wort|welt"),
    WELTEN_COMP: compile("Brand|Bummler(in)?|Drama|Wende"),
    WOERTER_COMP: compile("Buch|Liste|Verzeichnis"),
    EXPAND_PATTERN: compile(".*/[ESNAPFT]"),
  };
}
let patterns: ReturnType<typeof createPatterns> | null = null;
const P = () => (patterns ??= createPatterns());


const PREVENT_SUGGESTION_PATTERNS: Pattern[] = [];
const verbStems                  = new Set<string>();
const verbPrefixes               = new Set<string>();
const otherPrefixes              = new Set<string>();
const oldSpelling                = new Set<string>();
const ADDITIONAL_SUGGESTIONS = new Map<StringMatcher, (w: string) => string[]>();

function putRepl(wordPattern: string, pattern: string, replacement: string): void {
  ADDITIONAL_SUGGESTIONS.set(StringMatcher.regexp(wordPattern), (w) => [StringReplaceFirst(w, pattern, replacement)]);
}

/** The overloads put(String, String) and put(String, Function). */
function put(pattern: string, replacement: string | ((w: string) => string[])): void {
  if (typeof replacement === 'string') {
    ADDITIONAL_SUGGESTIONS.set(StringMatcher.regexp(pattern), (_w) => [replacement]);
  } else {
    ADDITIONAL_SUGGESTIONS.set(StringMatcher.regexp(pattern), replacement);
  }
}

let staticInitialized = false;

/** The static initializer: run when the first GermanSpellerRule is constructed. */
function staticInit(): void {
  if (staticInitialized) {
    return;
  }
  staticInitialized = true;
    put("lieder", (w) => ["leider", "Lieder"]);
    put("vorbreiten", (w) => ["vorbereiten", "verbreiten"]);
    put("Hungen", (w) => ["Hunger", "Hungern"]);
    put("Topfen", "Tropfen");
    put("gepart", (w) => ["gespart", "gepaart"]);
    put("frägst", "fragst");
    put("totkrank", "todkrank");
    put("todtkrank", "todkrank");
    put("sähte", "säte");
    put("säht", "sät");
    put("sähtest", "sätest");
    put("sähten", "säten");
    put("sähtet", "sätet");
    put("gesäht", "gesät");
    put("sähend", "säend");
    put("Impflicht", "Impfpflicht");
    put("Wandererin", "Wanderin");
    put("daß", "dass");
    put("eien", "eine");
    put("wiederrum", "wiederum");
    put("ne", (w) => ["'ne", "eine", "nein", "oder"]);
    put("ner", "einer");
    put("isses", (w) => ["ist es", "Risses"]);
    put("isser", "ist er");
    put("Vieleicht", "Vielleicht");
    put("inbetracht", "in Betracht");
    put("überwhatsapp", "über WhatsApp");
    put("überzoom", "über Zoom");
    put("überweißt", "überweist");
    put("übergoogle", "über Google");
    put("einlogen", "einloggen");
    put("Kruks", "Krux");
    put("Filterbubble", "Filterblase");
    put("Filterbubbles", "Filterblasen");
    put("Telefones", "Telefons");
    putRepl(".+telefones", "telefones", "telefons");
    putRepl(".+tips", "tip", "tipp");
    putRepl("Hifi-.+", "Hifi", "HiFi");
    putRepl("Analgen.*", "Analgen", "Anlagen");
    putRepl("wiedersteh(en|st|t)", "wieder", "wider");
    putRepl("wiederstan(d|den|dest)", "wieder", "wider");
    putRepl("wiedersprech(e|t|en)?", "wieder", "wider");
    putRepl("wiedersprich(st|t)?", "wieder", "wider");
    putRepl("wiedersprach(st|t|en)?", "wieder", "wider");
    putRepl("wiederruf(e|st|t|en)?", "wieder", "wider");
    putRepl("wiederrief(st|t|en)?", "wieder", "wider");
    putRepl("wiederleg(e|st|t|en|te|ten)?", "wieder", "wider");
    putRepl("wiederhall(e|st|t|en|te|ten)?", "wieder", "wider");
    putRepl("wiedersetz(e|t|en|te|ten)?", "wieder", "wider");
    putRepl("wiederstreb(e|st|t|en|te|ten)?", "wieder", "wider");
    putRepl("zurück(ge|zu)?koppe?l(e|n|t(e(st|n)?)?|nd(e(r|s|m|n)?)?|st|)?", "zurück", "rück");
    put("bekomms", "bekomm es");
    put("Latin", "Latein");
    put("liegts", "liegt es");
    put("gesynct", "synchronisiert");
    put("gesynced", "synchronisiert");
    put("gesyncht", "synchronisiert");
    put("gesyngt", "synchronisiert");
    put("synce", "synchronisiere");
    put("synche", "synchronisiere");
    put("syncen", "synchronisieren");
    put("synchen", "synchronisieren");
    put("wiederspiegelten", "widerspiegelten");
    put("wiedererwarten", "wider Erwarten");
    put("widerholen", "wiederholen");
    put("wiederhohlen", "wiederholen");
    put("herrunterladen", "herunterladen");
    put("dastellen", "darstellen");
    put("zuviel", "zu viel");
    put("abgekatertes", "abgekartetes");
    put("wiederspiegelt", "widerspiegelt");
    put("Komplexheit", "Komplexität");
    put("unterschiedet", "unterscheidet");
    put("einzigst", "einzig");
    put("Einzigst", "Einzig");
    put("geschumpfen", "geschimpft");
    put("Geschumpfen", "Geschimpft");
    put("Oke", "Okay");
    put("Mü", "My");
    put("packs", "pack es");
    put("abschiednehmen", "Abschied nehmen");
    put("wars", (w) => ["war es", "warst"]);
    put("[aA]wa", (w) => ["AWA", "ach was", "aber"]);
    put("[aA]lsallerersten?s", (w) => [StringReplaceFirst(w, "lsallerersten?s", "ls allererstes"), StringReplaceFirst(w, "lsallerersten?s", "ls Allererstes")]);
    putRepl("(an|auf|ein|zu)gehangen(e[mnrs]?)?$", "hangen", "hängt");
    putRepl("[oO]key", "ey$", "ay");
    put("packet", "Paket");
    put("Thanks", "Danke");
    put("Ghanesen?", "Ghanaer");
    put("Thumberg", "Thunberg");
    put("Allalei", "Allerlei");
    put("geupdate[dt]$", "upgedatet");
    //put("gefaked", "gefakt");  -- don't suggest
    put("[pP]roblemhaft(e[nmrs]?)?", (w) => [replaceOnce(w,"haft", "behaftet"), replaceOnce(w,"haft", "atisch")]);
    put("rosane[mnrs]?$", (w) => ["rosa", StringReplaceFirst(w, "^rosan", "rosafarben")]);
    put("Erbung", (w) => ["Vererbung", "Erbschaft"]);
    put("Energiesparung", (w) => ["Energieeinsparung", "Energieersparnis"]);
    put("Abbrechung", "Abbruch");
    put("Abbrechungen", (w) => ["Abbrüche", "Abbrüchen"]);
    put("Urteilung", (w) => ["Urteil", "Verurteilung"]);
    put("allmöglichen?", (w) => ["alle möglichen", "alle mögliche"]);
    put("Krankenhausen", (w) => ["Krankenhäusern", "Krankenhäuser"]);
    put("vorr?auss?etzlich", (w) => ["voraussichtlich", "vorausgesetzt"]);
    put("nichtmals", (w) => ["nicht mal", "nicht einmal"]);
    put("eingepeilt", "angepeilt");
    put("gekukt", "geguckt");
    put("nem", (w) => ["'nem", "einem"]);
    put("nen", (w) => ["'nen", "einen"]);
    put("geb", "gebe");
    put("überhaut", "überhaupt");
    put("nacher", "nachher");
    put("jeztz", "jetzt");
    put("les", "lese");
    put("wr", "wir");
    put("bezweifel", "bezweifle");
    put("verzweifel", "verzweifle");
    put("zweifel", "zweifle");
    put("[wW]ah?rscheindlichkeit", "Wahrscheinlichkeit");
    put("Hijab", "Hidschāb");
    put("[lL]eerequiment", "Leerequipment");
    put("unauslässlich", (w) => ["unerlässlich", "unablässig", "unauslöschlich"]);
    put("klappts", (w) => ["klappt’s", "klappt es", "klappst"]);
    put("Klappts", (w) => ["Klappt’s", "Klappt es", "Klappst"]);
    put("schicks", (w) => ["schick’s", "schick es", "schickst"]);
    put("Schicks", (w) => ["Schick’s", "Schick es", "Schickst"]);
    put("Registration", "Registrierung");
    put("Registrationen", "Registrierungen");
    put("Spinnenweben", "Spinnweben");
    put("[Tt]uneup", "TuneUp");
    putRepl("[Ww]ar ne", "ne", "eine");
    putRepl("[Ää]nliche[rnms]?", "nlich", "hnlich");
    putRepl("[Gg]arnix", "nix", "nichts");
    putRepl("[Ww]i", "i", "ie");
    putRepl("[uU]nauslässlich(e[mnrs]?)?", "aus", "er");
    putRepl("[vV]erewiglicht(e[mnrs]?)?", "lich", "");
    putRepl("[zZ]eritifiert(e[mnrs]?)?", "eritifiert", "ertifiziert");
    putRepl("gerähten?", "geräht", "Gerät");
    putRepl("leptops?", "lep", "Lap");
    putRepl("[pP]ie?rsings?", "[pP]ie?rsing", "Piercing");
    putRepl("for?melar(en?)?", "for?me", "Formu");
    putRepl("näste[mnrs]?$", "^näs", "nächs");
    putRepl("Erdogans?$", "^Erdogan", "Erdoğan");
    put("Germanistiker[ns]", "Germanisten");
    put("Sodastream", "SodaStream");
    put("Soda-Stream", "SodaStream");
    put("Sodastreams", "SodaStreams");
    put("Soda-Streams", "SodaStreams");
    put("Motor-Flugzeug", "Motorflugzeug");
    put("Motor-Flugzeugs", "Motorflugzeugs");
    put("Motor-Flugzeuge", "Motorflugzeuge");
    put("Motor-Flugzeugen", "Motorflugzeugen");
    putRepl("Germanistikerin(nen)?", "Germanistiker", "Germanist");
    putRepl("[iI]ns?z[ie]nie?rung(en)?", "[iI]ns?z[ie]nie?", "Inszenie");
    putRepl("[eE]rhöherung(en)?", "[eE]rhöherung", "Erhöhung");
    putRepl("[vV]erspäterung(en)?", "später", "spät");
    putRepl("[vV]orallendingen", "orallendingen", "or allen Dingen");
    putRepl("[aA]ufjede[nm]fall", "jede[nm]fall$", " jeden Fall");
    putRepl("[aA]us[vf]ersehen[dt]lich", "[vf]ersehen[dt]lich", " Versehen");
    putRepl("^funk?z[ou]nier.+", "funk?z[ou]nier", "funktionier");
    putRepl("[wW]öruber", "öru", "orü");
    putRepl("[lL]einensamens?", "[lL]einen", "Lein");
    putRepl("Feinleiner[ns]?", "Feinlei", "Fineli");
    putRepl("[hH]eilei[td]s?", "[hH]eilei[td]", "Highlight");
    putRepl("Oldheimer[ns]?", "he", "t");
    putRepl("[tT]räner[ns]?", "[tT]rä", "Trai");
    putRepl("[tT]eimings?", "[tT]e", "T");
    putRepl("unternehmensl[uü]stig(e[mnrs]?)?", "mensl[uü]st", "mungslust"); // "unternehmenslüstig" -> "unternehmungslustig"
    putRepl("proff?ess?ional(e[mnrs]?)?", "ff?ess?ional", "fessionell");
    putRepl("zuverlässlich(e[mnrs]?)?", "lich", "ig");
    putRepl("fluoreszenzierend(e[mnrs]?)?", "zen", "");
    putRepl("revalierend(e[mnrs]?)?", "^reval", "rivalis");
    putRepl("verhäuft(e[mnrs]?)?", "^ver", "ge");
    putRepl("stürmig(e[mnrs]?)?", "mig", "misch");
    putRepl("größeste[mnrs]?", "ßes", "ß");
    putRepl("n[aä]heste[mnrs]?", "n[aä]he", "näch");
    putRepl("gesundlich(e[mnrs]?)?", "lich", "heitlich");
    putRepl("eckel(e|t(en?)?|st)?", "^eck", "ek");
    putRepl("unhervorgesehen(e[mnrs]?)?", "hervor", "vorher");
    putRepl("entt?euscht(e[mnrs]?)?", "entt?eusch", "enttäusch");
    putRepl("Phählen?", "^Ph", "Pf");
    putRepl("Kattermesser[ns]?", "Ka", "Cu");
    putRepl("gehe?rr?t(e[mnrs]?)?", "he?rr?", "ehr"); // "geherte" -> "geehrte"
    putRepl("gehrter?", "^ge", "gee");
    putRepl("[nN]amenhaft(e[mnrs]?)?", "amen", "am");
    putRepl("hom(o?e|ö)ophatisch(e[mnrs]?)?", "hom(o?e|ö)ophat", "homöopath");
    putRepl("Geschwindlichkeit(en)?", "lich", "ig");
    putRepl("Jänners?", "Jänner", "Januar");
    putRepl("[äÄ]hlich(e[mnrs]?)?", "lich", "nlich");
    putRepl("entf[ai]ngen?", "ent", "emp");
    putRepl("entf[äi]ngs?t", "ent", "emp");
    putRepl("[Bb]ehilfreich(e[rnms]?)", "reich", "lich");
    putRepl("[Bb]zgl", "zgl", "zgl.");
    putRepl("kaltnass(e[rnms]?)", "kaltnass", "nasskalt");
    putRepl("Kaltnass(e[rnms]?)", "Kaltnass", "Nasskalt");
    put("check", "checke");
    put("Rückrad", "Rückgrat");
    put("ala", "à la");
    put("Ala", "À la");
    put("Reinfolge", "Reihenfolge");
    put("Schloß", "Schloss");
    put("Investion", "Investition");
    put("Beleidung", "Beleidigung");
    put("Bole", "Bowle");
    put("letzens", "letztens");
    put("Pakur", (w) => ["Parcours", "Parkuhr"]);
    put("Dez", (w) => ["Dez.", "Der"]);
    put("Jun", "Jun.");
    put("Sept", "Sept.");
    put("Aug", (w) => ["Aug.", "Auge"]);
    put("Erstsemesterin", (w) => ["Erstsemester", "Erstsemesters", "Erstsemesterstudentin"]);
    put("Erstsemesterinnen", (w) => ["Erstsemesterstudentinnen", "Erstsemester", "Erstsemestern"]);
    put("kreativlos(e[nmrs]?)?", (w) => [replaceOnce(w,"kreativ", "fantasie"), replaceOnce(w,"kreativ", "einfalls"), replaceOnce(w,"kreativlos", "unkreativ"), replaceOnce(w,"kreativlos", "uninspiriert")]);
    put("Kreativlosigkeit", "Unkreativität");
    put("hinund?her", "hin und her");
    put("[lL]ymph?trie?nasche", "Lymphdrainage");
    put("Interdeterminismus", "Indeterminismus");
    put("elektrität", "Elektrizität");
    put("ausgeboten", "ausgebootet");
    put("nocheinmall", "noch einmal");
    put("aüßerst", "äußerst");
    put("Grrösse", "Größe");
    put("misverständniss", "Missverständnis");
    put("warheit", "Wahrheit");
    put("[pP]okemon", "Pokémon");
    put("kreigt", "kriegt");
    put("Fritöse", "Fritteuse");
    put("unerkennlich", "unkenntlich");
    put("rückg[äe]nglich", "rückgängig");
    put("em?men[sz]", "immens");
    put("verhing", "verhängte");
    put("verhingen", "verhängten");
    put("fangte", "fing");
    put("fangten", "fingen");
    put("schlie[sß]te", "schloss");
    put("schlie[sß]ten", "schlossen");
    put("past", "passt");
    put("eingetragt", "eingetragen");
    put("getrunkt", "getrunken");
    put("veräht", "verrät");
    put("helfte", "half");
    put("helften", "halfen");
    put("lad", "lade");
    put("befehlte", "befahl");
    put("befehlten", "befahlen");
    put("angelügt", "angelogen");
    put("Bitet", "Bittet");
    put("dagen", "sagen");
    put("ändenr", "ändern");
    put("übetragen", "übertragen");
    put("Ihrn", "Ihren");
    put("Emal", "E-Mail");
    put("Emai", "E-Mail");
    put("schuen", "schauen");
    put("Hasue", "Haus");
    put("leier", "leider");
    put("Meschen", "Menschen");
    put("unsen", "unseren");
    put("biiten", "bitten");
    put("geläscht", "gelöscht");
    put("Kundein", "Kundin");
    put("amch", "mach");
    put("amche", "mache");
    put("forfahren", "fortfahren");
    put("verate", "verrate");
    put("interen", "interne");
    put("Budge", "Budget");
    put("weiso", "wieso");
    put("Parter", "Partner");
    put("wiet", (w) => ["weit", "wie"]);
    put("beid", (w) => ["beide", "seid", "beim", "bei"]);
    put("Theam", (w) => ["Thema", "Team"]);
    put("ind", (w) => ["und", "ins", "in", "sind"]);
    put("us", (w) => ["US", "aus"]);
    put("soch", (w) => ["doch", "sich", "noch"]);
    put("Abe", (w) => ["Aber", "Ab", "ABE", "Aue"]);
    put("lügte", "log");
    put("lügten", "logen");
    put("bratete", "briet");
    put("brateten", "brieten");
    put("gefahl", "gefiel");
    put("Komplexibilität", "Komplexität");
    put("abbonement", "Abonnement");
    put("zugegebenerweise", "zugegebenermaßen");
    put("perse", "per se");
    put("Schwitch", "Switch");
    put("[aA]nwesenzeiten", "Anwesenheitszeiten");
    put("[gG]eizigkeit", "Geiz");
    put("[fF]leißigkeit", "Fleiß");
    put("[bB]equemheit", "Bequemlichkeit");
    put("[mM]issionarie?sie?rung", "Missionierung");
    put("[sS]chee?selonge?", "Chaiselongue");
    put("Re[kc]amiere", "Récamière");
    put("Singel", "Single");
    put("legen[td]lich", "lediglich");
    put("ein[ua]ndhalb", "eineinhalb");
    put("[mM]illion(en)?mal", (w) => [uppercaseFirstChar(replaceOnce(w,"mal", " Mal"))]);
    put("Mysql", "MySQL");
    put("MWST", "MwSt");
    put("Opelarena", "Opel Arena");
    put("Toll-Collect", "Toll Collect");
    put("[pP][qQ]-Formel", "p-q-Formel");
    put("desweitere?m", "des Weiteren");
    put("handzuhaben", "zu handhaben");
    put("nachvollzuziehe?n", "nachzuvollziehen");
    put("Porto?folien", "Portfolios");
    put("[sS]chwie?ri?chkeiten", "Schwierigkeiten");
    put("[üÜ]bergrifflichkeiten", "Übergriffigkeiten");
    put("[aA]r?th?rie?th?is", "Arthritis");
    put("zugesand", "zugesandt");
    put("weibt", "weißt");
    put("fress", "friss");
    put("Mamma", "Mama");
    put("Präse", "Präsentation");
    put("Präsen", "Präsentationen");
    put("Orga", "Organisation");
    put("Orgas", "Organisationen");
    put("Reorga", "Reorganisation");
    put("Reorgas", "Reorganisationen");
    put("instande?zusetzen", "instand zu setzen");
    put("Lia(si|is)onen", "Liaisons");
    put("[cC]asemana?ge?ment", "Case Management");
    put("[aA]nn?[ou]ll?ie?rung", "Annullierung");
    put("[sS]charm", "Charme");
    put("[zZ]auberlich(e[mnrs]?)?", (w) => [replaceOnce(w,"lich", "isch"), replaceOnce(w,"lich", "haft")]);
    put("[eE]rledung", "Erledigung");
    put("erledigigung", "Erledigung");
    put("woltest", "wolltest");
    put("[iI]ntranzparentheit", "Intransparenz");
    put("dunkellilane[mnrs]?", "dunkellila");
    put("helllilane[mnrs]?", "helllila");
    put("Behauptungsthese", "Behauptung");
    put("genzut", "genutzt");
    put("[eEäÄ]klerung", "Erklärung");
    put("[wW]eh?wechen", "Wehwehchen");
    put("nocheinmals", "noch einmal");
    put("unverantwortungs?los(e[mnrs]?)?", (w) => [StringReplaceFirst(w, "unverantwortungs?", "verantwortungs"), StringReplaceFirst(w, "ungs?los", "lich")]);
    putRepl("[eE]rhaltbar(e[mnrs]?)?", "haltbar", "hältlich");
    putRepl("[aA]ufkeinenfall?", "keinenfall?", " keinen Fall");
    putRepl("[Dd]rumrum", "rum$", "herum");
    putRepl("([uU]n)?proff?esionn?ell?(e[mnrs]?)?", "proff?esionn?ell?", "professionell");
    putRepl("[kK]inderlich(e[mnrs]?)?", "inder", "ind");
    putRepl("[wW]iedersprichs?t", "ieder", "ider");
    putRepl("[wW]hite-?[Ll]abels", "[wW]hite-?[Ll]abel", "White Label");
    putRepl("[wW]iederstand", "ieder", "ider");
    putRepl("[kK]önntes", "es$", "est");
    putRepl("[aA]ssess?oare?s?", "[aA]ssess?oare?", "Accessoire");
    putRepl("indifiziert(e[mnrs]?)?", "ind", "ident");
    putRepl("dreite[mnrs]?", "dreit", "dritt");
    putRepl("verblüte[mnrs]?", "blü", "blüh");
    putRepl("Einzigste[mnrs]?", "zigst", "zig");
    putRepl("Invests?", "Invest", "Investment");
    putRepl("(aller)?einzie?gste[mnrs]?", "(aller)?einzie?gst", "einzig");
    putRepl("[iI]nterkurell(e[nmrs]?)?", "ku", "kultu");
    putRepl("[iI]ntersannt(e[mnrs]?)?", "sannt", "essant");
    putRepl("ubera(g|sch)end(e[nmrs]?)?", "uber", "überr");
    putRepl("[Hh]ello", "ello", "allo");
    putRepl("[Gg]etagged", "gged", "ggt");
    putRepl("[wW]olt$", "lt", "llt");
    putRepl("[zZ]uende", "ue", "u E");
    putRepl("[iI]nbälde", "nb", "n B");
    putRepl("[lL]etztenendes", "ene", "en E");
    putRepl("[nN]achwievor", "wievor", " wie vor");
    putRepl("[zZ]umbeispiel", "beispiel", " Beispiel");
    putRepl("[gG]ottseidank", "[gG]ottseidank", "Gott sei Dank");
    putRepl("[gG]rundauf", "[gG]rundauf", "Grund auf");
    putRepl("[aA]nsichtnach", "[aA]nsicht", "Ansicht ");
    putRepl("[uU]n[sz]war", "[sz]war", "d zwar");
    putRepl("[wW]aschte(s?t)?", "aschte", "usch");
    putRepl("[wW]aschten", "ascht", "usch");
    putRepl("Probiren?", "ir", "ier");
    putRepl("[gG]esetztreu(e[nmrs]?)?", "tz", "tzes");
    putRepl("[wW]ikich(e[nmrs]?)?", "k", "rkl");
    putRepl("[uU]naufbesichtigt(e[nmrs]?)?", "aufbe", "beauf");
    putRepl("[nN]utzvoll(e[nmrs]?)?", "utzvoll", "ützlich");
    putRepl("Lezte[mnrs]?", "Lez", "Letz");
    putRepl("Letze[mnrs]?", "Letz", "Letzt");
    putRepl("[nN]i[vw]os?", "[nN]i[vw]o", "Niveau");
    putRepl("[dD]illetant(en)?", "[dD]ille", "Dilet");
    putRepl("Frauenhofer-(Institut|Gesellschaft)", "Frauen", "Fraun");
    putRepl("Add-?Ons?", "Add-?On", "Add-on");
    putRepl("Addons?", "on", "-on");
    putRepl("Internetkaffees?", "kaffee", "café");
    putRepl("[gG]ehorsamkeitsverweigerung(en)?", "[gG]ehorsamkeit", "Gehorsam");
    putRepl("[wW]ochende[ns]?", "[wW]ochend", "Wochenend");
    putRepl("[kK]ongratulier(en?|t(en?)?|st)", "[kK]on", "");
    putRepl("[wWkKdD]an$", "n$", "nn");
    putRepl("geh?neh?m[ie]gung(en)?", "geh?neh?m[ie]gung", "Genehmigung");
    putRepl("Korrigierung(en)?", "igierung", "ektur");
    putRepl("[kK]orregierung(en)?", "[kK]orregierung", "Korrektur");
    putRepl("[kK]orrie?girung(en)?", "[kK]orrie?girung", "Korrektur");
    putRepl("[nN]ocheimal", "eimal", " einmal");
    putRepl("[aA]benzu", "enzu", " und zu");
    putRepl("[kK]onflikation(en)?", "[kK]onfli", "Kompli");
    putRepl("[mM]itanader", "ana", "einan");
    putRepl("[mM]itenand", "enand", "einander");
    putRepl("Gelangenheitsbestätigung(en)?", "heit", "");
    putRepl("[jJ]edwillige[mnrs]?", "willig", "wed");
    putRepl("[qQ]ualitäts?bewußt(e[mnrs]?)?", "ts?bewußt", "tsbewusst");
    putRepl("[vV]oraussichtig(e[nmrs]?)?", "sichtig", "sichtlich");
    putRepl("[gG]leichrechtig(e[nmrs]?)?", "rechtig", "berechtigt");
    putRepl("[uU]nnützlich(e[nmrs]?)?", "nützlich", "nütz");
    putRepl("[uU]nzerbrechbar(e[nmrs]?)?", "bar", "lich");
    putRepl("kolegen?", "ko", "Kol");
    putRepl("tableten?", "tablet", "Tablett");
    putRepl("verswinde(n|s?t)", "^vers", "versch");
    putRepl("unverantwortungsvoll(e[nmrs]?)?", "unverantwortungsvoll", "verantwortungslos");
    putRepl("[gG]erechtlichkeit", "[gG]erechtlich", "Gerechtig");
    putRepl("[zZ]uverlässlichkeit", "lich", "ig");
    putRepl("[uU]nverzeilig(e[mnrs]?)?", "zeilig", "zeihlich");
    putRepl("[zZ]uk(ue?|ü)nftlich(e[mnrs]?)?", "uk(ue?|ü)nftlich", "ukünftig");
    putRepl("[rR]eligiösisch(e[nmrs]?)?", "isch", "");
    putRepl("[fF]olklorisch(e[nmrs]?)?", "isch", "istisch");
    putRepl("[eE]infühlsvoll(e[nmrs]?)?", "voll", "am");
    putRepl("Unstimmlichkeit(en)?", "lich", "ig");
    putRepl("Strebergartens?", "Stre", "Schre");
    putRepl("[hH]ähern(e[mnrs]?)?", "ähern", "ären");
    putRepl("todesbedroh(end|lich)(e[nmrs]?)?", "todes", "lebens");
    putRepl("^[uU]nabsichtig(e[nmrs]?)?", "ig", "lich");
    putRepl("[aA]ntisemitistisch(e[mnrs]?)?", "tist", "t");
    putRepl("[uU]nvorsehbar(e[mnrs]?)?", "vor", "vorher");
    putRepl("([eE]r|[bB]e|unter|[aA]uf)?hälst", "hälst", "hältst");
    put("[wW]ohlfühlseins?", (w) => ["Wellness", StringReplaceFirst(w, "[wW]ohlfühlsein", "Wohlbefinden"), StringReplaceFirst(w, "[wW]ohlfühlsein", "Wohlfühlen")]);
    putRepl("[sS]chmett?e?rling(s|en?)?", "[sS]chmett?e?rling", "Schmetterling");
    putRepl("^[eE]inlamie?nie?r(st|en?|(t(e[nmrs]?)?))?", "^einlamie?nie?r", "laminier");
    putRepl("[bB]ravurös(e[nrms]?)?", "vur", "vour");
    putRepl("[aA]ss?ecoires?", "[aA]ss?ec", "Access");
    putRepl("[aA]ufwechse?lungsreich(er|st)?(e[nmrs]?)?", "ufwechse?lung", "bwechslung");
    putRepl("[iI]nordnung", "ordnung", " Ordnung");
    putRepl("[iI]mmoment", "moment", " Moment");
    putRepl("[hH]euteabend", "abend", " Abend");
    putRepl("[wW]ienerschnitzel[ns]?", "[wW]ieners", "Wiener S");
    putRepl("[sS]chwarzwälderkirschtorten?", "[sS]chwarzwälderk", "Schwarzwälder K");
    putRepl("[kK]oxial(e[nmrs]?)?", "x", "ax");
    putRepl("([üÜ]ber|[uU]unter)?[dD]urs?chnitt?lich(e[nmrs]?)?", "s?chnitt?", "chschnitt");
    putRepl("[dD]urs?chnitts?", "s?chnitt", "chschnitt");
    putRepl("[sS]triktlich(e[mnrs]?)?", "lich", "");
    putRepl("[hH]öchstwahrlich(e[mnrs]?)?", "wahr", "wahrschein");
    putRepl("[oO]rganisativ(e[nmrs]?)?", "tiv", "torisch");
    putRepl("[kK]ontaktfreundlich(e[nmrs]?)?", "ndlich", "dig");
    putRepl("Helfer?s-Helfer[ns]?", "Helfer?s-H", "Helfersh");
    putRepl("[iI]ntell?igentsbestien?", "[iI]ntell?igents", "Intelligenz");
    putRepl("[aA]vantgardisch(e[mnrs]?)?", "gard", "gardist");
    putRepl("[gG]ewohnheitsbedürftig(e[mnrs]?)?", "wohnheit", "wöhnung");
    putRepl("[eE]infühlungsvoll(e[mnrs]?)?", "fühlungsvoll", "fühlsam");
    putRepl("[vV]erwant(e[mnrs]?)?", "want", "wandt");
    putRepl("[bB]eanstandigung(en)?", "ig", "");
    putRepl("[eE]inba(hn|nd)frei(e[mnrs]?)?", "ba(hn|nd)", "wand");
    putRepl("[äÄaAeE]rtzten?", "[äÄaAeE]rt", "Är");
    putRepl("pdf-Datei(en)?", "pdf", "PDF");
    putRepl("rumänern?", "rumäner", "Rumäne");
    putRepl("[cCKk]o?usengs?", "[cCKk]o?useng", "Cousin");
    putRepl("Influenzer(in(nen)?|[ns])?", "zer", "cer");
    putRepl("[vV]ersantdienstleister[ns]?", "[vV]ersant", "Versand");
    putRepl("[pP]atrolier(s?t|t?en?)", "atrolier", "atrouillier");
    putRepl("[pP]ropagandiert(e[mnrs]?)?", "and", "");
    putRepl("[pP]ropagandier(en|st)", "and", "");
    putRepl("[kK]app?erzität(en)?", "^[kK]app?er", "Kapa");
    putRepl("känzel(n|s?t)", "känzel", "cancel");
    put("gekänzelt", "gecancelt");
    putRepl("[üÜ]berstreitung(en)?", "[üÜ]berst", "Übersch");
    putRepl("anschliess?lich(e(mnrs)?)?", "anschliess?lich", "anschließend");
    putRepl("[rR]ethorisch(e(mnrs)?)?", "eth", "het");
    putRepl("änlich(e(mnrs)?)?", "än", "ähn");
    putRepl("spätmöglichste(mnrs)?", "spätmöglichst", "spätestmöglich");
    put("mogen", "morgen");
    put("[fF]uss?ill?ien", "Fossilien");
    put("übrings", "übrigens");
    put("[rR]evü", "Revue");
    put("eingänglich", "eingangs");
    put("geerthe", "geehrte");
    put("interrese", "Interesse");
    put("[rR]eschärschen", "Recherchen");
    put("[rR]eschärsche", "Recherche");
    put("ic", "ich");
    put("w[eä]hret", "wäret");
    put("mahte", "Mathe");
    put("letzdenendes", "letzten Endes");
    put("aufgesteht", "aufgestanden");
    put("ganichts", "gar nichts");
    put("gesich", "Gesicht");
    put("glass", "Glas");
    put("muter", "Mutter");
    put("[pP]appa", "Papa");
    put("dier", "dir");
    put("Referenz-Nr", "Referenz-Nr.");
    put("Matrikelnr.", "Matrikel-Nr.");
    put("Rekrutings?prozess", "Recruitingprozess");
    put("sumarum", "summarum");
    put("schein", "scheine");
    put("Innzahlung", (w) => ["In Zahlung", "in Zahlung"]);
    put("änderen", (w) => ["ändern", "anderen"]);
    put("wanderen", (w) => ["wandern", "Wanderern"]);
    put("Dutzen", (w) => ["Duzen", "Dutzend"]);
    put("patien", (w) => ["Partien", "Patient"]);
    put("Teammitgliederinnen", (w) => ["Teammitgliedern", "Teammitglieder"]);
    put("beidige[mnrs]?", (w) => [replaceOnce(w,"ig", ""), replaceOnce(w,"beid", "beiderseit"), "beeidigen"]); //beide, beiderseitige, beeidigen
    put("Wissbegierigkeit", (w) => ["Wissbegier", "Wissbegierde"]);
    put("Nabend", "'n Abend");
    put("gie?bts", "gibt's");
    put("vs", "vs.");
    put("[kK]affeeteria", "Cafeteria");
    put("[kK]affeeterien", "Cafeterien");
    put("berücksicht", "berücksichtigt");
    put("must", "musst");
    put("kaffe", "Kaffee");
    put("zetel", "Zettel");
    put("wie?daholung", "Wiederholung");
    put("vie?d(er|a)sehen", "wiedersehen");
    put("pr[eä]ventiert", "verhindert");
    put("pr[eä]ventieren", "verhindern");
    put("zur?verfügung", "zur Verfügung");
    put("Verwahrlosigkeit", "Verwahrlosung");
    put("[oO]r?ganisazion", "Organisation");
    put("[oO]rganisative", "Organisation");
    put("Emall?iearbeit", "Emaillearbeit");
    put("[aA]petitt", "Appetit");
    put("bezuggenommen", "Bezug genommen");
    put("mägt", "mögt");
    put("frug", "fragte");
    put("gesäht", "gesät");
    put("verennt", "verrennt");
    put("überrant", "überrannt");
    put("Gallop", "Galopp");
    put("Stop", "Stopp");
    put("Schertz", "Scherz");
    put("geschied", "geschieht");
    put("Aku", "Akku");
    put("Migrationspackt", "Migrationspakt");
    put("[zZ]ulaufror", "Zulaufrohr");
    put("[gG]ebrauchss?puhren", "Gebrauchsspuren");
    put("[pP]reisnachlassung", "Preisnachlass");
    put("[mM]edikamentation", "Medikation");
    put("[nN][ei]gliche", "Negligé");
    put("palletten?", (w) => [replaceOnce(w,"pall", "Pal"), replaceOnce(w,"pa", "Pai")]);
    put("[pP]allete", "Palette");
    put("Geräuch", (w) => ["Geräusch", "Gesträuch"]);
    put("Eon", (w) => ["Ein", "E.ON", "Von"]);
    put("[sS]chull?igung", "Entschuldigung");
    put("Geerte", "geehrte");
    put("versichen", "versichern");
    put("hobb?ies", "Hobbys");
    put("Begierigkeiten", "Begehrlichkeiten");
    put("selblosigkeit", "Selbstlosigkeit");
    put("gestyled", "gestylt");
    put("umstimigkeiten", "Unstimmigkeiten");
    put("unann?äh?ml?ichkeiten", "Unannehmlichkeiten");
    put("unn?ann?ehmichkeiten", "Unannehmlichkeiten");
    put("übertr[äa]gte", "übertrug");
    put("übertr[äa]gten", "übertrugen");
    put("NodeJS", "Node.js");
    put("Express", "Express.js");
    put("erlas", "Erlass");
    put("schlagte", "schlug");
    put("schlagten", "schlugen");
    put("überwissen", "überwiesen");
    put("einpar", "ein paar");
    put("sreiben", "schreiben");
    put("routiene", "Routine");
    put("ect", "etc");
    put("giept", "gibt");
    put("Pann?acott?a", "Panna cotta");
    put("Fußgängerunterwegs?", "Fußgängerunterführung");
    put("angeschriehen", "angeschrien");
    put("vieviel", "wie viel");
    put("entäscht", "enttäuscht");
    put("Rämchen", "Rähmchen");
    put("Seminarbeit", "Seminararbeit");
    put("Seminarbeiten", "Seminararbeiten");
    put("[eE]ngangment", "Engagement");
    put("[lL]eichtah?tleh?t", "Leichtathlet");
    put("[pP]fane", "Pfanne");
    put("[iI]ngini?eue?r", "Ingenieur");
    put("[aA]nligen", "Anliegen");
    put("Tankungen", (w) => ["Betankungen", "Tankvorgänge"]);
    put("Ärcker", (w) => ["Erker", "Ärger"]);
    put("überlasstet", (w) => ["überlastet", "überließt"]);
    put("zeren", (w) => ["zerren", "zehren"]);
    put("Hänchen", (w) => ["Hähnchen", "Hänschen"]);
    put("[sS]itwazion", "Situation");
    put("geschriehen", "geschrien");
    put("beratete", "beriet");
    put("Hälst", "Hältst");
    put("[kK]aos", "Chaos");
    put("[pP]upatät", "Pubertät");
    put("überwendet", "überwindet");
    put("[bB]esichtung", "Besichtigung");
    put("[hH]ell?owi[eh]?n", "Halloween");
    put("geschmelt?zt", "geschmolzen");
    put("gewunschen", "gewünscht");
    put("bittete", "bat");
    put("nehm", "nimm");
    put("möchst", "möchtest");
    put("Win", "Windows");
    put("anschein[dt]", "anscheinend");
    put("Subvestitionen", "Subventionen");
    put("angeschaffen", "angeschafft");
    put("Rechtspruch", "Rechtsspruch");
    put("Second-Hand", "Secondhand");
    put("[jJ]ahundert", "Jahrhundert");
    put("Gesochse", "Gesocks");
    put("Vorraus", "Voraus");
    put("[vV]orgensweise", "Vorgehensweise");
    put("[kK]autsch", "Couch");
    put("guterletzt", "guter Letzt");
    put("Seminares", "Seminars");
    put("Mousepad", "Mauspad");
    put("Mousepads", "Mauspads");
    put("Wi[Ff]i-Router", "Wi-Fi-Router");
    putRepl("[Ll]ilane[srm]?", "ilane[srm]?", "ila");
    putRepl("[zZ]uguterletzt", "guterletzt", " guter Letzt");
    putRepl("Nootbooks?", "Noot", "Note");
    putRepl("[vV]ersendlich(e[mnrs]?)?", "send", "sehent");
    putRepl("[uU]nfäh?r(e[mnrs]?)?", "fäh?r", "fair");
    putRepl("[mM]edikatös(e[mnrs]?)?", "ka", "kamen");
    putRepl("(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)undhalb", "und", "ein");
    putRepl("[gG]roßzüge[mnrs]?", "züg", "zügig");
    putRepl("[äÄ]rtlich(e[mnrs]?)?", "rt", "rzt");
    putRepl("[sS]chnelligkeitsfehler[ns]?", "[sS]chnell", "Flücht");
    putRepl("[sS]chweinerosane[mnrs]?", "weinerosane[mnrs]?", "weinchenrosa");
    putRepl("[aA]nstecklich(e[mnrs]?)?", "lich", "end");
    putRepl("[gG]eflechtet(e[mnrs]?)?", "flechtet", "flochten");
    putRepl("[gG]enrealistisch(e[mnrs]?)?", "re", "er");
    putRepl("überträgt(e[mnrs]?)?", "^überträgt", "übertragen");
    putRepl("[iI]nterresent(e[mnrs]?)?", "rresent", "ressant");
    putRepl("Simkartenleser[ns]?", "^Simkartenl", "SIM-Karten-L");
    putRepl("Hilfstmittel[ns]?", "^Hilfst", "Hilfs");
    putRepl("trationell(e[mnrs]?)?", "^tra", "tradi");
    putRepl("[bB]erreichs?", "^[bB]er", "Be");
    putRepl("[fF]uscher[ns]?", "^[fF]u", "Pfu");
    putRepl("[uU]nausweichbar(e[mnrs]?)?", "bar", "lich");
    putRepl("[uU]nabdinglich(e[mnrs]?)?", "lich", "bar");
    putRepl("[eE]ingänglich(e[mnrs]?)?", "lich", "ig");
    putRepl("ausgewöh?nlich(e[mnrs]?)?", "^ausgewöh?n", "außergewöhn");
    putRepl("achsial(e[mnrs]?)?", "^achs", "ax");
    putRepl("famielen?", "^famiel", "Famili");
    putRepl("miter[ns]?", "^mi", "Mie");
    putRepl("besig(t(e[mnrs]?)?|en?)", "sig", "sieg");
    putRepl("[vV]erziehr(t(e[mnrs]?)?|en?)", "ieh", "ie");
    putRepl("^[pP]iek(s?t|en?)", "iek", "ik");
    putRepl("[mM]atschscheiben?", "[mM]atschsch", "Mattsch");
    put("schafen?", (w) => [replaceOnce(w,"sch", "schl"), replaceOnce(w,"af", "arf"), replaceOnce(w,"af", "aff")]);
    put("zuschafen", "zu schaffen");
    putRepl("[hH]ofen?", "of", "off");
    putRepl("[sS]ommerverien?", "[sS]ommerverien?", "Sommerferien");
    putRepl("[rR]ecourcen?", "[rR]ec", "Ress");
    putRepl("[fF]amm?ill?i?[aä]risch(e[mnrs]?)?", "amm?ill?i?[aä]risch", "amiliär");
    putRepl("Sim-Karten?", "^Sim", "SIM");
    putRepl("Spax-Schrauben?", "^Spax", "SPAX");
    putRepl("[aA]leine", "l", "ll");
    putRepl("Kaput", "t", "tt");
    putRepl("[fF]estell(s?t|en?)", "est", "estst");
    putRepl("[Ee]igtl", "igtl", "igtl.");
    putRepl("(Baden-)?Würtenbergs?", "Würten", "Württem");
    putRepl("Betriebsratzimmer[ns]?", "rat", "rats");
    putRepl("Rechts?schreibungsfehler[ns]?", "Rechts?schreibungs", "Rechtschreib");
    putRepl("Open[aA]ir-Konzert(en?)?", "Open[aA]ir", "Open-Air");
    putRepl("Jugenschuhen?", "Jug", "Jung");
    putRepl("TODO-Listen?", "TODO", "To-do");
    putRepl("ausiehs?t", "aus", "auss");
    putRepl("unterbemittel(nd|t)(e[nmrs]?)?", "unterbemittel(nd|t)", "minderbemittelt");
    putRepl("[xX]te[mnrs]?", "te", "-te");
    putRepl("verheielt(e[mnrs]?)?", "heiel", "heil");
    putRepl("[rR]evolutionie?sier(s?t|en?)", "ie?s", "");
    putRepl("Kohleaustiegs?", "aus", "auss");
    putRepl("[jJ]urististisch(e[mnrs]?)?", "istist", "ist");
    putRepl("gehäckelt(e[nmrs]?)?", "ck", "k");
    putRepl("deutsprachig(e[nmrs]?)?", "deut", "deutsch");
    putRepl("angesehend(st)?e[nmrs]?", "end", "en");
    putRepl("[iI]slamophobisch(e[mnrs]?)?", "isch", "");
    putRepl("[vV]erharkt(e[mnrs]?)?", "ar", "a");
    putRepl("[dD]esöfterer?[nm]", "öfterer?[nm]", " Öfteren");
    putRepl("[dD]eswei[dt]ere?[mn]", "wei[dt]ere?[mn]", " Weiteren");
    putRepl("Einkaufstachen?", "ch", "sch");
    putRepl("Bortmesser[ns]?", "Bor", "Bro");
    putRepl("Makeupstylist(in(nen)?|en)?", "Makeups", "Make-up-S");
    putRepl("Fee?dbäcks?", "Fee?dbäck", "Feedback");
    putRepl("weirete[nmrs]?", "ret", "ter");
    putRepl("Ni[vw]oschalter[ns]?", "Ni[vw]o", "Niveau");
    putRepl("[eE]xhibitionisch(e[nmrs]?)?", "isch", "istisch");
    putRepl("(ein|aus)?[gG]eschalten(e[nmrs]?)?", "ten", "tet");
    putRepl("[uU]nterschiebene[nmrs]?", "sch", "schr");
    putRepl("[uU]nbequemlich(st)?e[nmrs]?", "lich", "");
    putRepl("[uU][nm]bekweh?m(e[nmrs]?)?", "[nm]bekweh?m", "nbequem");
    putRepl("[dD]esatör(s|en?)?", "satör", "serteur");
    put("Panelen?", (w) => [replaceOnce(w,"Panel", "Paneel"), "Panels"]);
    put("D[eèé]ja-?[vV]o?ue?", "Déjà-vu");
    put("Cr[eèé]me-?fra[iî]che", "Crème fraîche");
    put("[aA]rr?an?gemont", "Arrangement");
    put("[aA]ngagemon", "Engagement");
    put("Phyrr?ussieg", "Pyrrhussieg");
    put("Mio", "Mio.");
    put("Datein", "Dateien");
    put("[pP]u(zz|ss)el", "Puzzle");
    put("Smilies", "Smileys");
    put("[dD]iseing?", "Design");
    put("[lL]ieradd?ress?e", "Lieferadresse");
    put("[bB]o[yi]kutierung", "Boykottierung");
    put("Mouseclick", "Mausklick");
    put("[aA]ktuelli?esie?rung", "Aktualisierung");
    put("Händy", "Handy");
    put("gewertschätzt", "wertgeschätzt");
    put("tieger", "Tiger");
    put("Rollade", (w) => ["Rollladen", "Roulade"]);
    put("garnichtmehr", "gar nicht mehr");
    put("vileich", "vielleicht");
    put("vll?t", "vielleicht");
    put("aufgewägt", "aufgewogen");
    put("[rR]eflektion", "Reflexion");
    put("momentmal", "Moment mal");
    put("satzt", "Satz");
    put("Büff?(ee|é)", (w) => ["Buffet", "Büfett"]);
    put("[fF]rühstücksb[uü]ff?(é|ee)", "Frühstücksbuffet");
    put("[aA]lterego", "Alter Ego");
    put("Copyride", "Copyright");
    put("Analysierung", "Analyse");
    put("Exel", "Excel");
    put("Glücklichkeit", "Glück");
    put("Begierigkeit", "Begierde");
    put("voralem", "vor allem");
    put("Unorganisation", (w) => ["Desorganisation", "Unorganisiertheit"]);
    put("Cand(el|le)lightdinner", "Candle-Light-Dinner");
    put("wertgelegt", "Wert gelegt");
    put("antuhen", "antun");
    put("komen", "kommen");
    put("genißen", "genießen");
    put("Stationskrankenpflegerin", "Stationsschwester");
    put("[iIüÜuU]b[ea]w[ae]isung", "Überweisung");
    put("[bB]oxhorn", "Bockshorn");
    put("[zZ]oolophie", "Zoophilie");
    put("Makieren", "Markieren");
    put("Altersheimer", "Alzheimer");
    put("gesen", "gesehen");
    put("Neugierigkeit", (w) => ["Neugier", "Neugierde"]);
    put("[kK]onn?ekt?schen", "Connection");
    put("E-Maul", "E-Mail");
    put("E-Mauls", "E-Mails");
    put("E-Mal", "E-Mail");
    put("E-Mals", "E-Mails");
    put("[nN]ah?richt", "Nachricht");
    put("[nN]ah?richten", "Nachrichten");
    put("Getrixe", "Getrickse");
    put("Ausage", "Aussage");
    put("gelessen", "gelesen");
    put("Kanst", "Kannst");
    put("Unwohlbefinden", "Unwohlsein");
    put("leiwagen", "Leihwagen");
    put("krahn", "Kran");
    put("[hH]ifi", "Hi-Fi");
    put("chouch", "Couch");
    put("eh?rgeit?z", "Ehrgeiz");
    put("solltes", "solltest");
    put("geklabt", "geklappt");
    put("angefangt", "angefangen");
    put("beinhält", "beinhaltet");
    put("beinhielt", "beinhaltete");
    put("beinhielten", "beinhalteten");
    put("einhaltest", "einhältst");
    put("angeruft", "angerufen");
    put("erhaltete", "erhielt");
    put("übersäht", "übersät");
    put("staats?angehoe?rigkeit", "Staatsangehörigkeit");
    put("[uU]nangeneh?mheiten", "Unannehmlichkeiten");
    put("Humuspaste", "Hummuspaste");
    put("afarung", "Erfahrung");
    put("bescheid?t", "Bescheid");
    put("[mM]iteillung", "Mitteilung");
    put("Revisionierung", "Revision");
    put("[eE]infühlvermögen", "Einfühlungsvermögen");
    put("[sS]peziellisierung", "Spezialisierung");
    put("[cC]hangse", "Chance");
    put("untergangen", "untergegangen");
    put("geliegt", "gelegen");
    put("BluRay", "Blu-ray");
    put("Freiwilligerin", "Freiwillige");
    put("Mitgliederinnen", (w) => ["Mitglieder", "Mitgliedern"]);
    put("Hautreinheiten", "Hautunreinheiten");
    put("Durfüh?rung", "Durchführung");
    put("tuhen", "tun");
    put("tuhe", "tue");
    put("tip", "Tipp");
    put("ccm", "cm³");
    put("Kilimand?jaro", "Kilimandscharo");
    put("[hH]erausfor?dung", "Herausforderung");
    put("[bB]erücksichtung", "Berücksichtigung");
    put("artzt?", "Arzt");
    put("[tT]h?elepath?ie", "Telepathie");
    put("Wi-?Fi-Dire[ck]t", "Wi-Fi Direct");
    put("gans", "ganz");
    put("Pearl-Harbou?r", "Pearl Harbor");
    put("[aA]utonomität", "Autonomie");
    put("[fF]r[uü]h?st[uü]c?k", "Frühstück");
    putRepl("(ge)?fr[uü]h?st[uü](c?k|g)t", "fr[uü]h?st[uü](c?k|g)t", "frühstückt");
    put("zucc?h?inis?", "Zucchini");
    put("[mM]itag", "Mittag");
    put("Lexion", "Lexikon");
    put("[mM]otorisation", "Motorisierung");
    put("[fF]ormalisation", "Formalisierung");
    put("ausprache", "Aussprache");
    put("[mM]enegment", "Management");
    put("[gG]ebrauspuren", "Gebrauchsspuren");
    put("viedeo", "Video");
    put("[hH]erstammung", "Abstammung");
    put("[iI]nstall?atör", "Installateur");
    put("maletriert", "malträtiert");
    put("abgeschaffen", "abgeschafft");
    put("Verschiden", "Verschieden");
    put("Anschovis", "Anchovis");
    put("Bravur", "Bravour");
    put("Grisli", "Grizzly");
    put("Grislibär", "Grizzlybär");
    put("Grislibären", "Grizzlybären");
    put("Frotté", "Frottee");
    put("Joga", "Yoga");
    put("Kalvinismus", "Calvinismus");
    put("Kollier", "Collier");
    put("Kolliers", "Colliers");
    put("Ketschup", "Ketchup");
    put("Kommunikee", "Kommuniqué");
    put("Negligee", "Negligé");
    put("Nessessär", "Necessaire");
    put("passee", "passé");
    put("Varietee", "Varieté");
    put("Varietees", "Varietés");
    put("Wandalismus", "Vandalismus");
    put("Campagne", "Kampagne");
    put("Campagnen", "Kampagnen");
    put("Jockei", "Jockey");
    put("Roulett", "Roulette");
    put("Bestellungsdaten", "Bestelldaten");
    put("Package", "Paket");
    put("E-mail", "E-Mail");
    put("geleased", "geleast");
    put("released", "releast");
    putRepl("Ballets?", "llet", "llett");
    putRepl("Saudiarabiens?", "Saudiarabien", "Saudi-Arabien");
    putRepl("eMail-Adressen?", "eMail-", "E-Mail-");
    putRepl("[Ww]ieviele?", "ieviel", "ie viel");
    putRepl("[Aa]dhoc", "dhoc", "d hoc");
    put("As", "Ass");
    put("[bB]i[sß](s?[ij]|ch)en", "bisschen");
    putRepl("Todos?", "Todo", "To-do");
    put("Kovult", "Konvolut");
    putRepl("blog(t?en?|t(es?t)?)$", "g", "gg");
    put("Zombiefizierungen", "Zombifizierungen");
    put("Tret", (w) => ["Tritt", "Trete", "Trat"]);
    put("Hühne", (w) => ["Bühne", "Hüne", "Hühner"]);
    put("Hühnen", (w) => ["Bühnen", "Hünen", "Hühnern"]);
    put("tiptop", "tiptopp");
    put("Briese", "Brise");
    put("Rechtsschreibreformen", "Rechtschreibreformen");
    putRepl("gewertschätzte(([mnrs]|re[mnrs]?)?)$", "gewertschätzt", "wertgeschätzt");
    putRepl("knapps(t?en?|t(es?t)?)$", "pp", "p");
    put("geknappst", "geknapst");
    putRepl("gepiekste[mnrs]?$", "ie", "i");
    putRepl("Yings?", "ng", "n");
    put("Wiederstandes", "Widerstandes");
    putRepl("veganisch(e?[mnrs]?)$", "isch", "");
    putRepl("totlangweiligste[mnrs]?$", "tot", "tod");
    putRepl("tottraurigste[mnrs]?$", "tot", "tod");
    putRepl("kreir(n|e?nd)(e[mnrs]?)?$", "ire?n", "ieren");
    putRepl("Pepps?", "pp", "p");
    putRepl("Pariahs?", "h", "");
    putRepl("Oeuvres?", "Oe", "Œ");
    put("Margarite", "Margerite");
    put("Kücken", (w) => ["Rücken", "Küken"]);
    put("Kompanten", (w) => ["Kompasse", "Kompassen"]);
    put("Kandarren", "Kandaren");
    put("kniehen", "knien");
    putRepl("infisziertes?t$", "fisz", "fiz");
    putRepl("Imbusse(n|s)?$", "m", "n");
    put("Hollundern", "Holundern");
    putRepl("handgehabt(e?[mnrs]?)?$", "handgehabt", "gehandhabt");
    put("Funieres", "Furniers");
    put("Frohndiensts", "Frondiensts");
    put("fithälst", "fit hältst");
    putRepl("fitzuhalten(de?[mnrs]?)?$", "fitzuhalten", "fit zu halten");
    putRepl("(essen|schlafen|schwimmen|spazieren)zugehen$", "zugehen", " zu gehen");
    put("dilettant", (w) => ["Dilettant", "dilettantisch"]);
    putRepl("dilettante[mnrs]?$", "te", "tische");
    put("Disastern", "Desastern");
    putRepl("Brandwein(en?|s)$", "d", "nt");
    putRepl("Böhen?$", "h", "");
    putRepl("Aufständige[mnr]?$", "ig", "isch");
    putRepl("aufständig(e[mnrs]?)?$", "ig", "isch");
    putRepl("duzend(e[mnrs]?)?$", "uzend", "utzend");
    putRepl("unrelevant(e[mnrs]?)?$", "un", "ir");
    putRepl("Unrelevant(e[mnrs]?)?$", "Un", "Ir");
    put("aufgrundedessen", "aufgrund dessen");
    put("Amalgane", "Amalgame");
    put("Kafe", (w) => ["Kaffee", "Café"]);
    put("Dammbock", (w) => ["Dambock", "Rammbock"]);
    put("Dammhirsch", "Damhirsch");
    put("Fairnis", "Fairness");
    put("auschluss", (w) => ["Ausschluss", "Ausschuss"]);
    put("derikter", (w) => ["direkter", "Direktor"]);
    put("[iI]dentifierung", "Identifikation");
    put("[eE]mphatie", "Empathie");
    put("[eE]iskrem", "Eiscreme");
    put("[fF]lüchtung", "Flucht");
    put("einamen", "Einnahmen");
    put("[eE]inbu(ss|ß)ung", "Einbuße");
    put("[eE]inbu(ss|ß)ungen", "Einbußen");
    put("nachichten", "Nachrichten");
    put("gegehen", "gegangen");
    put("Ethnocid", "Ethnozid");
    put("Exikose", "Exsikkose");
    put("Schonvermögengrenze", "Schonvermögensgrenze");
    put("kontest", "konntest");
    put("pitza", "Pizza");
    put("Tütü", "Tutu");
    put("gebittet", "gebeten");
    put("gekricht", "gekriegt");
    put("Krankenheit", "Krankheit");
    put("Krankenheiten", "Krankheiten");
    put("[hH]udd[yi]", "Hoodie");
    put("Treibel", "Tribal");
    put("vorort", "vor Ort");
    put("Brotwürfelcro[uû]tons", "Croûtons");
    put("bess?tetigung", "Bestätigung");
    put("[mM]ayonaisse", "Mayonnaise");
    put("misverstaendnis", "Missverständnis");
    put("[vV]erlu(ss|ß)t", "Verlust");
    put("glückigerweise", "glücklicherweise");
    put("[sS]tandtart", "Standard");
    put("Mainzerstrasse", "Mainzer Straße");
    put("Genehmigerablauf", "Genehmigungsablauf");
    put("Bestellerurkunde", "Bestellungsurkunde");
    put("Selbstmitleidigkeit", "Selbstmitleid");
    put("[iI]ntuion", "Intuition");
    put("[cCkK]ontener", "Container");
    put("Barcadi", "Bacardi");
    put("Unnanehmigkeit", "Unannehmlichkeit");
    put("[wW]ischmöppen?", "Wischmopps");
    putRepl("[oO]rdnungswiedrichkeit(en)?", "[oO]rdnungswiedrich", "Ordnungswidrig");
    putRepl("Mauntenbiker[ns]?", "^Maunten", "Mountain");
    putRepl("Mauntenbikes?", "Maunten", "Mountain");
    putRepl("[nN]euhichkeit(en)?", "[nN]euhich", "Neuig");
    putRepl("Prokopfverbrauchs?", "Prokopfv", "Pro-Kopf-V"); // Duden
    putRepl("[Gg]ilst", "ilst", "iltst");
    putRepl("[vV]ollrichtung(en)?", "[vV]oll", "Ver");
    putRepl("[vV]ollrichtest", "oll", "er");
    putRepl("[vV]ollrichten?", "oll", "er");
    putRepl("[vV]ollrichtet(e([mnrs])?)?", "oll", "er");
    putRepl("[bB]edingslos(e([mnrs])?)?", "ding", "dingung");
    putRepl("[eE]insichtbar(e[mnrs]?)?", "sicht", "seh");
    putRepl("asymetrisch(ere|ste)[mnrs]?$", "ym", "ymm");
    putRepl("alterwürdig(ere|ste)[mnrs]?$", "lter", "ltehr");
    putRepl("aufständig(ere|ste)[mnrs]?$", "ig", "isch");
    putRepl("blutdurstig(ere|ste)[mnrs]?$", "ur", "ür");
    putRepl("dilettant(ere|este)[mnrs]?$", "nt", "ntisch");
    putRepl("eliptisch(ere|ste)[mnrs]?$", "l", "ll");
    putRepl("angegröhlt(e([mnrs])?)?$", "öh", "ö");
    putRepl("gothisch(ere|ste)[mnrs]?$", "th", "t");
    putRepl("kollossal(ere|ste)[mnrs]?$", "ll", "l");
    putRepl("paralel(lere|lste)[mnrs]?$", "paralel", "paralle");
    putRepl("symetrischste[mnrs]?$", "ym", "ymm");
    putRepl("rethorisch(ere|ste)[mnrs]?$", "rethor", "rhetor");
    putRepl("repetativ(ere|ste)[mnrs]?$", "repetat", "repetit");
    putRepl("voluptös(e|ere|este)?[mnrs]?$", "tös", "tuös");
    putRepl("[pP]flanzig(e[mnrs]?)?", "ig", "lich");
    putRepl("geblogt(e[mnrs]?)?$", "gt", "ggt");
    putRepl("herraus.*", "herraus", "heraus");
    putRepl("[aA]bbonier(en?|s?t|te[mnrst]?)", "bbo", "bon");
    putRepl("[aA]pelier(en?|s?t|te[nt]?)", "pel", "ppell");
    putRepl("[vV]oltie?schier(en?|s?t|te[nt]?)", "ie?sch", "ig");
    putRepl("[mM]eistverkaufteste[mnrs]?", "teste", "te");
    putRepl("[uU]nleshaft(e[mnrs]?)?", "haft", "erlich");
    putRepl("[gG]laubenswürdig(e[mnrs]?)?", "ens", "");
    putRepl("[nN]i[vw]ovoll(e[mnrs]?)?", "[vw]ovoll", "veauvoll");
    putRepl("[nN]otgezwungend?(e[mnrs]?)?", "zwungend?", "drungen");
    putRepl("[mM]isstraurig(e[mnrs]?)?", "rig", "isch");
    putRepl("[iI]nflagrantie?", "flagrantie?", " flagranti");
    putRepl("Aux-Anschl(uss(es)?|üssen?)", "Aux", "AUX");
    putRepl("desinfektiert(e[mnrs]?)?", "fekt", "fiz");
    putRepl("desinfektierend(e[mnrs]?)?", "fekt", "fiz");
    putRepl("desinfektieren?", "fekt", "fiz");
    putRepl("[dD]esinfektionier(en?|t(e[mnrs]?)?|st)", "fektionier", "fizier");
    putRepl("[dD]esinfektionierend(e[mnrs]?)?", "fektionier", "fizier");
    putRepl("[kK]ompensionier(en?|t(e[mnrs]?)?|st)", "ion", "");
    putRepl("neuliche[mnrs]?", "neu", "neuer");
    putRepl("ausbüchsen?", "chs", "x");
    putRepl("aus(ge)?büchst(en?)?", "chs", "x");
    putRepl("innoff?iziell?(e[mnrs]?)?", "innoff?iziell?", "inoffiziell");
    putRepl("[gG]roesste[mnrs]?", "oess", "öß");
    putRepl("[tT]efonisch(e[mnrs]?)?", "efon", "elefon");
    putRepl("[oO]ptimalisiert", "alis", "");
    putRepl("[iI]ntrovertisch(e[mnrs]?)?", "isch", "iert");
    putRepl("[aA]miert(e[mnrs]?)?", "mi", "rmi");
    putRepl("[vV]ersiehrt(e[mnrs]?)?", "h", "");
    putRepl("[dD]urchsichtbar(e[mnrs]?)?", "bar", "ig");
    putRepl("[oO]ffensichtig(e[mnrs]?)?", "ig", "lich");
    putRepl("[zZ]urverfühgung", "verfühgung", " Verfügung");
    putRepl("[sS]pendeangebot(e[ns]?)?", "[sS]pende", "Spenden");
    putRepl("gahrnichts?", "gahr", "gar ");
    putRepl("[aA]ugensichtlich(e[mnrs]?)?", "sicht", "schein");
    putRepl("[lL]eidensvoll(e[mnrs]?)?", "ens", "");
    putRepl("[bB]ewusstlich(e[mnrs]?)?", "lich", "");
    putRepl("[vV]erschmerzlich(e[mnrs]?)?", "lich", "bar");
    putRepl("Krankenbruders?", "bruder", "pfleger");
    putRepl("Krankenbrüdern?", "brüder", "pfleger");
    putRepl("Lan-(Kabel[ns]?|Verbindung)", "Lan", "LAN");
    putRepl("[sS]epalastschriftmandat(s|en?)?", "[sS]epal", "SEPA-L");
    putRepl("Pinn?eingaben?", "Pinn?e", "PIN-E");
    putRepl("[sS]imkarten?", "[sS]imk", "SIM-K");
    putRepl("[vV]orsich(geht|gehen|ging(en)?|gegangen)", "sich", " sich ");
    putRepl("mitsich(bringt|bringen|brachten?|gebracht)", "sich", " sich ");
    putRepl("[ck]arnivorisch(e[mnrs]?)?", "[ck]arnivorisch", "karnivor");
    putRepl("[pP]erfektest(e[mnrs]?)?", "est", "");
    putRepl("[gG]leichtig(e[mnrs]?)?", "tig", "zeitig");
    putRepl("[uU]n(her)?vorgesehen(e[mnrs]?)?", "(her)?vor", "vorher");
    putRepl("([cC]orona|[gG]rippe)viruss?es", "viruss?es", "virus");
    putRepl("Zaubererin(nen)?", "er", "");
    putRepl("Second-Hand-L[äa]dens?", "Second-Hand-L", "Secondhandl");
    putRepl("Second-Hand-Shops?", "Second-Hand-S", "Secondhands");
    putRepl("[mM]editerranisch(e[mnrs]?)?", "isch", "");
    putRepl("interplementier(s?t|en?)", "inter", "im");
    putRepl("[hH]ochalterlich(e[mnrs]?)?", "alter", "mittelalter");
    putRepl("posiniert(e[mnrs]?)?", "si", "sitio");
    putRepl("[rR]ussophobisch(e[mnrs]?)?", "isch", "");
    putRepl("[uU]nsachmä(ß|ss?)ig(e[mnrs]?)?", "mä(ß|ss?)ig", "gemäß");
    putRepl("[mM]odernisch(e[mnrs]?)?", "isch", "");
    putRepl("intapretation(en)?", "inta", "Inter");
    putRepl("[rR]ethorikkurs(e[ns]?)?", "eth", "het");
    putRepl("[uU]nterschreibungsfähig(e[mnrs]?)?", "schreibung", "schrift");
    putRepl("[eE]rrorier(en?|t(e[mnrs]?)?|st)", "ror", "u");
    putRepl("malediert(e[mnrs]?)?", "malediert", "malträtiert");
    putRepl("maletriert(e[mnrs]?)?", "maletriert", "malträtiert");
    putRepl("Ausbildereignerprüfung(en)?", "eigner", "eignungs");
    putRepl("abtrakt(e[mnrs]?)?", "ab", "abs");
    putRepl("unerfolgreich(e[mnrs]?)?", "unerfolgreich", "erfolglos");
    putRepl("[bB]attalion(en?|s)?", "[bB]attalion", "Bataillon");
    putRepl("[bB]esuchungsverbot(e[ns]?)?", "ung", "");
    putRepl("spätrig(e[mnrs]?)?", "rig", "er");
    putRepl("angehangene[mnrs]?", "hangen", "hängt");
    putRepl("[ck]amel[ie]onhaft(e[mnrs]?)?", "[ck]am[ie]lion", "chamäleon");
    putRepl("[wW]idersprüchig(e[mnrs]?)?", "ig", "lich");
    putRepl("[fF]austig(e[mnrs]?)?", "austig", "austdick");
    putRepl("Belastungsekgs?", "ekg", "-EKG");
    putRepl("gehardcode[dt](e[mnrs]?)?", "gehardcode", "hartkodier");
    putRepl("hardgecode[dt](e[mnrs]?)?", "gehardcode", "hartkodier");
    putRepl("Flektion(en)?", "Flektion", "Flexion");
    putRepl("Off-[Ss]hore-[A-Z].+", "Off-[Ss]hore-", "Offshore");
    putRepl("[Vv]ermißt.*", "ermißt", "ermisst");
    putRepl("EUfeindlich.*", "EUfeindlich", "EU-feindlich");
    put("Deis", "Dies");
    put("fr", "für");
    put("abe", (w) => ["habe", "aber", "ab"]);
    put("Oster", (w) => ["Ostern", "Osten"]);
    put("richen", (w) => ["riechen", "reichen", "richten"]);
    put("deien", (w) => ["deine", "dein"]);
    put("meien", (w) => ["meine", "mein", "meinen"]);
    put("berüht", (w) => ["berühmt", "berührt", "bemüht"]);
    put("herlich", (w) => ["ehrlich", "herrlich"]);
    put("erzeiht", (w) => ["erzieht", "verzeiht"]);
    put("schalfen", (w) => ["schlafen", "schaffen", "scharfen"]);
    put("Anfage", (w) => ["Anfrage", "Anlage"]);
    put("gehör", (w) => ["gehört", "Gehör", "gehöre"]);
    put("Sep", (w) => ["Sept.", "Sepp", "September", "Separator", "Sei"]);
    put("Formulares", "Formulars");
    put("Danl", "Dank");
    put("umbennen", "umbenennen");
    put("bevorzugs", "bevorzugst");
    put("einhergend", "einhergehend");
    put("dos", (w) => ["das", "des", "DOS", "DoS"]);
    put("mch", (w) => ["mich", "ich", "ach"]);
    put("Ihc", (w) => ["Ich", "Ihr", "Ihm"]);
    put("ihc", (w) => ["ich", "ihr", "ihm"]);
    put("ioch", "ich");
    put("of", "oft");
    put("mi", (w) => ["im", "mit", "mir"]);
    put("wier", (w) => ["wie", "wir", "vier", "hier", "wer"]);
    put("ander", (w) => ["an der", "andere", "änder", "anders"]);
    put("ech", (w) => ["euch", "ich"]);
    put("letzt", (w) => ["letzte", "jetzt"]);
    put("beu", (w) => ["bei", "peu", "neu"]);
    put("darn", (w) => ["daran", "darin", "dann", "dar"]);
    put("zwie", (w) => ["zwei", "wie", "sie", "sowie"]);
    put("gebten", (w) => ["gebeten", "gaben", "geboten", "gelten"]);
    put("dea", (w) => ["der", "den", "des", "dem"]);
    put("neune", (w) => ["neuen", "neue", "Neune"]);
    put("geren", (w) => ["gegen", "gerne", "gären"]);
    put("wuerden", (w) => ["würden", "wurden"]);
    put("wuerde", (w) => ["würde", "wurde"]);
    put("git", (w) => ["gut", "gibt", "gilt", "mit"]);
    put("voher", (w) => ["vorher", "woher", "hoher"]);
    put("hst", (w) => ["hast", "ist", "hat"]);
    put("Hst", (w) => ["Hast", "Ist", "Hat"]);
    put("herlichen", (w) => ["herzlichen", "ehrlichen", "herrlichen"]);
    put("Herlichen", (w) => ["Herzlichen", "Ehrlichen", "Herrlichen"]);
    put("herliche", (w) => ["herzliche", "ehrliche", "herrliche"]);
    put("Herliche", (w) => ["Herzliche", "Ehrliche", "Herrliche"]);
    put("it", (w) => ["ist", "IT", "in", "im"]);
    put("ads", (w) => ["das", "ADS", "Ads", "als", "aus"]);
    put("hats", (w) => ["hat es", "hast", "hat"]);
    put("Hats", (w) => ["Hat es", "Hast", "Hat"]);
    put("och", (w) => ["ich", "noch", "doch"]);
    put("bein", (w) => ["Bein", "beim", "ein", "bei"]);
    put("ser", (w) => ["der", "sehr", "er", "sei"]);
    put("Monatg", (w) => ["Montag", "Monate", "Monats"]);
    put("leiben", (w) => ["lieben", "bleiben", "leben"]);
    put("grad", (w) => ["grade", "Grad", "gerade"]);
    put("dnn", (w) => ["dann", "denn", "den"]);
    put("vn", (w) => ["von", "an", "in"]);
    put("sin", (w) => ["ein", "sind", "sie", "in"]);
    put("schein", (w) => ["scheine", "Schein", "scheint", "schien"]);
    put("wil", (w) => ["will", "wie", "weil", "wir"]);
    put("Ihen", (w) => ["Ihren", "Ihnen", "Ihn", "Iren"]);
    put("Iher", (w) => ["Ihre", "Ihr"]);
    put("neunen", (w) => ["neuen", "neunten"]);
    put("tole", (w) => ["tolle", "tote"]);
    put("tolen", (w) => ["tollen", "toten"]);
    put("wiel", (w) => ["weil", "wie", "viel"]);
    put("brauchts", (w) => ["braucht es", "brauchst", "braucht"]);
    put("schöen", (w) => ["schönen", "schön"]);
    put("ihne", (w) => ["ihn", "ihnen"]);
    put("af", (w) => ["auf", "an", "an", "als"]);
    put("mächte", (w) => ["möchte", "Mächte"]);
    put("öffen", (w) => ["öffnen", "offen"]);
    put("fernsehgucken", (w) => ["fernsehen", "Fernsehen gucken"]);
    put("Mien", (w) => ["Mein", "Wien", "Miene"]);
    put("abgeharkt", (w) => ["abgehakt", "abgehackt"]);
    put("beiten", (w) => ["beiden", "bieten"]);
    put("ber", (w) => ["über", "per", "der", "BER"]);
    put("ehr", (w) => ["eher", "mehr", "sehr", "er"]);
    put("Meien", (w) => ["Meine", "Meinen", "Mein", "Medien"]);
    put("neus", (w) => ["neues", "neue", "neu"]);
    put("Sunden", (w) => ["Sünden", "Stunden", "Kunden"]);
    put("Bitt", (w) => ["Bitte", "Bett", "Bist"]);
    put("bst", (w) => ["bist", "ist"]);
    put("ds", (w) => ["des", "das", "es"]);
    put("mn", (w) => ["man", "in", "an"]);
    put("hilt", (w) => ["gilt", "hilft", "hielt", "hält"]);
    put("nei", (w) => ["bei", "nie", "ein", "neu"]);
    put("riesen", (w) => ["riesigen", "diesen", "Riesen", "reisen"]);
    put("geduld", (w) => ["Geduld", "gedulde"]);
    put("bits", (w) => ["bist", "bis", "Bits"]);
    put("aheb", (w) => ["habe", "aber"]);
    put("versand", (w) => ["versandt", "Versand"]);
    put("os", (w) => ["so", "es", "OS"]);
    put("Kriese", (w) => ["Krise", "Kreise"]);
    put("Kriesen", (w) => ["Krisen", "Kreisen"]);
    put("aufteil", (w) => ["aufteile", "aufteilt", "auf Teil"]);
    put("fürn", (w) => ["für ein", "für den", "für", "fürs", "fern"]);
    put("Aliegen", (w) => ["Anliegen", "Fliegen"]);
    put("gaz", (w) => ["ganz", "gab"]);
    put("vllt", (w) => ["vielleicht", "vllt."]);
    put("rauch", (w) => ["Rauch", "rauche"]);
    put("liebs", (w) => ["liebe es", "liebes", "liebe"]);
    put("as", (w) => ["aß", "das", "als"]);
    put("bekommste", (w) => ["bekommst du", "bekommst"]);
    put("under", (w) => ["unser", "unter"]);
    put("dis", (w) => ["die", "dies"]);
    put("veil", (w) => ["viel", "weil", "teil"]);
    put("mak", (w) => ["mag", "mak", "lag"]);
    put("daum", (w) => ["da um", "darum", "kaum", "Raum"]);
    put("gechickt", (w) => ["geschickt", "gecheckt"]);
    put("gibs", (w) => ["gib es", "gibst"]);
    put("Gibs", (w) => ["Gib es", "Gibst", "Gips"]);
    put("Gutan", (w) => ["Gut an", "Guten", "Sudan"]);
    put("vol", (w) => ["von", "vom", "voll", "vor"]);
    put("einzulogen", (w) => ["einzuloggen", "einzulegen"]);
    put("Liben", (w) => ["Lieben", "Leben", "Libyen", "Ligen"]);
    put("bruchen", (w) => ["brauchen", "brachen", "brechen"]);
    put("gerner", (w) => ["gern", "gern er", "ferner"]);
    put("krige", (w) => ["kriege", "krieg"]);
    put("Geschnek", (w) => ["Geschenk", "Geschmack"]);
    put("meinste", (w) => ["meiste", "feinste", "meinte", "meinst du"]);
    put("Meinste", (w) => ["Meiste", "Feinste", "Meinte", "Meinst du"]);
    put("Telefones", (w) => ["Telefons", "Telefone"]);
    put("wusten", (w) => ["wussten", "wüsten"]);
    put("geschlaffen", (w) => ["geschlafen", "geschaffen", "geschliffen"]);
    put("Feb", (w) => ["Feb.", "Web", "Pep", "Geb", "Gäb"]);
    put("Mogen", (w) => ["Mögen", "Morgen", "Zogen"]);
    put("Dak", (w) => ["Dank", "Das", "Dock"]);
    put("Dake", (w) => ["Danke"]);
    put("dake", (w) => ["danke"]);
    put("Laola", (w) => ["La-Ola", "Paola", "Layla", "Lala"]);
    put("Laolas", (w) => ["La-Olas", "Paolas", "Laylas"]);
    put("übernohmen", (w) => ["übernehmen", "übernommen"]);
    put("augeschlossen", (w) => ["ausgeschlossen", "angeschlossen"]);
    put("Akteures", "Akteurs");
    put("popup", "Pop-up");
    put("Gedaken", "Gedanken");
    put("Wiso", "Wieso");
    put("gebs", "gebe es");
    put("angefordet", "angefordert");
    put("onlein", "online");
    put("Studen", "Stunden");
    put("weils", "weil es");
    put("unterscheid", "Unterschied");
    put("mags", "mag es");
    put("abzügl", "abzgl");
    put("as", "das");
    put("gefielts", "gefielt es");
    put("gefiels", "gefielt es");
    put("gefällts", "gefällt es");
    put("nummer", "Nummer");
    put("mitgetielt", "mitgeteilt");
    put("Artal", "Ahrtal");
    put("wuste", "wusste");
    put("Kuden", "Kunden");
    put("austehenden", "ausstehenden");
    put("eingelogt", "eingeloggt");
    put("kapput", "kaputt");
    put("geeehrte", "geehrte");
    put("geeehrter", "geehrter");
    put("startup", "Start-up");
    put("startups", "Start-ups");
    put("Biite", "Bitte");
    put("Gutn", "Guten");
    put("gutn", "guten");
    put("Ettiket", "Etikett");
    put("iht", "ihr");
    put("ligt", "liegt");
    put("gester", "gestern");
    put("veraten", "verraten");
    put("dienem", "deinem");
    put("Bite", "Bitte");
    put("Serh", "Sehr");
    put("serh", "sehr");
    put("fargen", "fragen");
    put("abrechen", "abbrechen");
    put("aufzeichen", "aufzeichnen");
    put("Geraet", "Gerät");
    put("Geraets", "Geräts");
    put("Geraete", "Geräte");
    put("Geraeten", "Geräten");
    put("Fals", "Falls");
    put("soche", "solche");
    put("verückt", "verrückt");
    put("austellen", "ausstellen");
    put("klapt", (w) => ["klappt", "klagt"]);
    put("denks", (w) => ["denkst", "denkt", "denke", "denk"]);
    put("geerhte", "geehrte");
    put("geerte", "geehrte");
    put("gehn", "gehen");
    put("Spß", "Spaß");
    put("kanst", "kannst");
    put("fregen", "fragen");
    put("Bingerloch", "Binger Loch");
    put("[nN]or[dt]rh?einwest(f|ph)alen", "Nordrhein-Westfalen");
    put("abzusolvieren", "zu absolvieren");
    put("Schutzfließ", "Schutzvlies");
    put("Simlock", "SIM-Lock");
    put("fäschungen", "Fälschungen");
    put("Weinverköstigung", "Weinverkostung");
    put("vertag", "Vertrag");
    put("geauessert", "geäußert");
    put("gefäh?ten", "Gefährten");
    put("gefäh?te", "Gefährte");
    put("immenoch", "immer noch");
    put("sevice", "Service");
    put("verhälst", "verhältst");
    put("[sS]äusche", "Seuche");
    put("Schalottenburg", "Charlottenburg");
    put("senora", "Señora");
    put("widerrum", "wiederum");
    put("[dD]epp?risonen", "Depressionen");
    put("Defribilator", "Defibrillator");
    put("Defribilatoren", "Defibrillatoren");
    put("SwatchGroup", "Swatch Group");
    put("achtungslo[ßs]", "achtlos");
    put("Boomerang", "Bumerang");
    put("Boomerangs", "Bumerangs");
    put("Lg", (w) => ["LG", "Liebe Grüße"]);
    put("gildet", "gilt");
    put("gleitete", "glitt");
    put("gleiteten", "glitten");
    put("Standbay", "Stand-by");
    put("[vV]ollkommnung", "Vervollkommnung");
    put("femist", "vermisst");
    put("stantepede", "stante pede");
    put("[kK]ostarika", "Costa Rica");
    put("[kK]ostarikas", "Costa Ricas");
    put("[aA]uthenzität", "Authentizität");
    put("anlässig", "anlässlich");
    put("[sS]tieft", "Stift");
    put("[Ii]nspruchnahme", "Inanspruchnahme");
    put("höstwah?rsch[ea]inlich", "höchstwahrscheinlich");
    put("[aA]lterschbeschränkung", "Altersbeschränkung");
    put("[kK]unstoff", "Kunststoff");
    put("[iI]nstergramm?", "Instagram");
    put("fleicht", "vielleicht");
    put("[eE]rartens", "Erachtens");
    put("laufte", "lief");
    put("lauften", "liefen");
    put("malzeit", "Mahlzeit");
    put("[wW]ahts?app", "WhatsApp");
    put("[wW]elan", (w) => ["WLAN", "W-LAN"]);
    put("Pinn", (w) => ["Pin", "PIN"]);
    put("Geldmachung", (w) => ["Geltendmachung", "Geldmacherei"]);
    put("[uU]nstimm?ichkeiten", "Unstimmigkeiten");
    put("Teilnehmung", "Teilnahme");
    put("Teilnehmungen", "Teilnahmen");
    put("waser", "Wasser");
    put("Bekennung", "Bekenntnis");
    put("[hH]irar?chie", "Hierarchie");
    put("Chr", "Chr.");
    put("Tiefbaumt", "Tiefbauamt");
    put("getäucht", "getäuscht");
    put("[hH]ähme", "Häme");
    put("Wochendruhezeiten", "Wochenendruhezeiten");
    put("Studiumplatzt?", "Studienplatz");
    put("Permanent-Make-Up", "Permanent-Make-up");
    put("woltet", "wolltet");
    put("Bäckei", "Bäckerei");
    put("Bäckeien", "Bäckereien");
    put("warmweis", "warmweiß");
    put("kaltweis", "kaltweiß");
    put("jez", "jetzt");
    put("hendis", "Handys");
    put("wie?derwarten", "wider Erwarten");
    put("[eE]ntercott?e", "Entrecôte");
    put("[eE]rwachtung", "Erwartung");
    put("[aA]nung", "Ahnung");
    put("[uU]nreimlichkeiten", "Ungereimtheiten");
    put("[uU]nangeneh?mlichkeiten", "Unannehmlichkeiten");
    put("Messy", "Messie");
    put("Polover", "Pullover");
    put("heilwegs", "halbwegs");
    put("undsoweiter", "und so weiter");
    put("Gladbeckerstrasse", "Gladbecker Straße");
    put("Bonnerstra(ß|ss)e", "Bonner Straße");
    put("[bB]range", "Branche");
    put("Gewebtrauma", "Gewebetrauma");
    put("Ehrenamtpauschale", "Ehrenamtspauschale");
    put("Essenzubereitung", "Essenszubereitung");
    put("[gG]eborgsamkeit", "Geborgenheit");
    put("gekommt", "gekommen");
    put("hinweißen", "hinweisen");
    put("Importation", "Import");
    put("lädest", "lädst");
    put("Themabereich", "Themenbereich");
    put("Werksresett", "Werksreset");
    put("wiederfahren", "widerfahren");
    put("wiederspiegelten", "widerspiegelten");
    put("weicheinlich", "wahrscheinlich");
    put("schnäpchen", "Schnäppchen");
    put("Hinduist", "Hindu");
    put("Hinduisten", "Hindus");
    put("Konzeptierung", "Konzipierung");
    put("Phyton", "Python");
    put("nochnichtmals?", "noch nicht einmal");
    put("Refelektion", "Reflexion");
    put("Refelektionen", "Reflexionen");
    put("[sS]chanse", "Chance");
    put("nich", (w) => ["nicht", "noch"]);
    put("Nich", (w) => ["Nicht", "Noch"]);
    put("wat", "was");
    put("[Ee][Ss]ports", "E-Sports");
    put("gerelaunch(ed|t)", "relauncht");
    put("Gerelaunch(ed|t)", "Relauncht");
    put("Bowl", "Bowle");
    put("Dark[Ww]eb", "Darknet");
    put("Sachs?en-Anhal?t", "Sachsen-Anhalt");
    put("[Ss]chalgen", "schlagen");
    put("[Ss]chalge", "schlage");
    put("[dD]eutsche?sprache", "deutsche Sprache");
    put("eigl", "eigtl");
    put("ma", "mal");
    put("leidete", "litt");
    put("leidetest", "littest");
    put("leideten", "litten");
    put("Hoody", "Hoodie");
    put("Hoodys", "Hoodies");
    put("Staatsexam", "Staatsexamen");
    put("Staatsexams", "Staatsexamens");
    put("Exam", "Examen");
    put("Exams", "Examens");
    put("[Rr]eviewing", "Review");
    put("[Bb]aldmöglich", "baldmöglichst");
    put("[Bb]rudi", "Bruder");
    put("ih", (w) => ["ich", "in", "im", "ah"]);
    put("Ih", (w) => ["Ich", "In", "Im", "Ah"]);
    put("[qQ]uicky", "Quickie");
    put("[qQ]uickys", "Quickies");
    put("bissl", (w) => ["bissel", "bisserl"]);
    put("Keywort", (w) => ["Keyword", "Stichwort"]);
    put("Keyworts", (w) => ["Keywords", "Stichworts"]);
    put("Keywörter", (w) => ["Keywords", "Stichwörter"]);
    put("strang", (w) => ["Strang", "strengte"]);
    put("Gym", (w) => ["Fitnessstudio", "Gymnasium"]);
    put("Wur", (w) => ["Wir", "Zur", "War", "Nur"]);
    put("wur", (w) => ["wir", "zur", "war", "nur"]);
    put("Gyms", (w) => ["Fitnessstudios", "Gymnasiums"]);
    put("gäng", (w) => ["ging", "gang"]);
    put("di", (w) => ["du", "die", "Di.", "der", "den"]);
    put("Di", (w) => ["Du", "Die", "Di.", "Der", "Den"]);
    put("Aufn", (w) => ["Auf den", "Auf einen", "Auf"]);
    put("aufn", (w) => ["auf den", "auf einen", "auf"]);
    put("Aufm", (w) => ["Auf dem", "Auf einem", "Auf"]);
    put("aufm", (w) => ["auf dem", "auf einem", "auf"]);
    put("Ausm", (w) => ["Aus dem", "Aus einem", "Aus"]);
    put("ausm", (w) => ["aus dem", "aus einem", "aus"]);
    put("best", (w) => ["beste", "bester", "Best"]);
    put("Bitet", (w) => ["Bitte", "Bittet", "Bidet", "Bietet"]);
    put("lage", (w) => ["lange", "Lage", "läge", "lache"]);
    put("mur", (w) => ["mir", "zur", "nur", "für"]);
    put("ass", (w) => ["Ass", "aß", "aus", "dass"]);
    put("Blat", (w) => ["Blatt", "Blut", "Bald", "Bat"]);
    put("much", (w) => ["mich", "auch", "Buch"]);
    put("scheibe", (w) => ["Scheibe", "schreibe"]);
    put("vielmal", (w) => ["Vielmal", "vielmals", "viermal", "viel mal"]);
    put("bachten", (w) => ["brachten", "beachten", "machten", "pachten"]);
    put("brache", (w) => ["brauche", "brachte", "brach", "bräche"]);
    put("beliebn", (w) => ["beliebt", "bleiben", "belieben"]);
    put("Kono", (w) => ["Kino", "Kongo", "Konto"]);
    put("aich", (w) => ["ich", "auch", "sich", "eich"]);
    put("anahme", (w) => ["Annahme", "nahmen", "nahe", "nahmen"]);
    put("anleigen", (w) => ["anlegen", "Anliegen", "anliegen", "anzeigen"]);
    put("besproch", (w) => ["besprach", "besprich", "bespreche", "besprochen"]);
    put("dan", (w) => ["dann", "den", "das", "an"]);
    put("lase", (w) => ["las", "lasse", "Nase"]);
    put("Shr", (w) => ["Sehr", "Ihr", "Uhr", "Sir"]);
    put("start", (w) => ["Start", "stark", "statt", "stand"]);
    put("neuse", (w) => ["neues", "neue"]);
    put("Standart", (w) => ["Standard", "Standort"]);
    put("wiessen", (w) => ["wissen", "weisen", "wiesen"]);
    put("schnells", (w) => ["schnell", "schnellst"]);
    put("sn", (w) => ["an", "in"]);
    put("eie", (w) => ["die", "wie", "eine", "sie"]);
    put("Mei", (w) => ["Mai", "Bei", "Sei", "Mein"]);
    put("bim", (w) => ["bin", "im", "bis", "beim"]);
    put("lehr", (w) => ["mehr", "lehrt", "sehr", "leer"]);
    put("sm", (w) => ["am", "im", "am", "SM"]);
    put("tuh", (w) => ["tun", "tut", "tue", "Kuh"]);
    put("wuden", (w) => ["wurden", "würden"]);
    put("Arzte", (w) => ["Ärzte", "Arzt"]);
    put("Arzten", "Ärzten");
    put("Alternatief", "Alternativ");
    put("Pkt", (w) => ["Pkt.", "Pakt", "Punkt", "Akt"]);
    put("intere", (w) => ["interne", "innere", "hintere", "untere"]);
    put("Eon", (w) => ["Ein", "E.ON"]);
    put("unterschiede", (w) => ["Unterschiede", "unterscheide", "unterschiebe", "unterschieden"]);
    put("bi", "bei");
    put("Aendert", "Ändert");
    put("aendert", "ändert");
    put("bizte", "bitte");
    put("korekkt", "korrekt");
    put("Erhlich", "Ehrlich");
    put("gestrest", "gestresst");
    put("rauschicken", "rausschicken");
    put("stoniren", "stornieren");
    put("drinen", "drinnen");
    put("gestigen", "gestiegen");
    put("prozes", "Prozess");
    put("Auschluss", "Ausschluss");
    put("Anbeot", "Angebot");
    put("Paleten", "Paletten");
    put("mächten", "möchten");
    put("auschreibung", "Ausschreibung");
    put("worter", "Wörter");
    put("Ihrerer", "Ihrer");
    put("Modelles", "Modells");
    put("entchuldigen", "entschuldigen");
    put("kundne", "Kunden");
    put("bestellun", "Bestellung");
    put("[Nn]umber", "Nummer");
    put("mirgen", "morgen");
    put("korekkt", "korrekt");
    put("Bs", "Bis");
    put("Biß", "Biss");
    put("bs", "bis");
    put("sehn", "sehen");
    put("zutun", "zu tun");
    put("Müllhalte", "Müllhalde");
    put("Entäuschung", "Enttäuschung");
    put("Entäuschungen", "Enttäuschungen");
    put("kanns", (w) => ["kann es", "kannst"]);
    put("verklinken", (w) => ["verklinkern", "verlinken", "verklingen"]);
    put("funktionierts", "funktioniert es");
    put("hbat", "habt");
    put("ichs", "ich es");
    put("folgendermassen", "folgendermaßen");
    put("Adon", "Add-on");
    put("Adons", "Add-ons");
    put("ud", "und");
    put("vertaggt", (w) => ["vertagt", "getaggt"]);
    put("keinsten", (w) => ["keinen", "kleinsten"]);
    put("Angehensweise", "Vorgehensweise");
    put("Angehensweisen", "Vorgehensweisen");
    put("Neudefinierung", "Neudefinition");
    put("Definierung", "Definition");
    put("Definierungen", "Definitionen");
    putRepl("[Üü]bergrifflich(e[mnrs]?)?", "lich", "ig");
    put("löchen", (w) => ["löschen", "löchern", "Köchen"]);
    put("wergen",  (w) => ["werfen", "werben", "werten"]);
    put("Wasn",  (w) => ["Was denn", "Was ein", "Was"]);
    putRepl("schammig(e[mnrs]?)?", "schamm", "schwamm");

    // some exceptions for changes to the spelling in 2017 - just a workaround so we don't have to touch the binary dict:
    PREVENT_SUGGESTION_PATTERNS.push(compile(
      ".*(Majonäse|Bravur|Anschovis|Belkanto|Campagne|Frotté|Grisli|Jockei|Joga|Kalvinismus|Kanossa|Kargo|Ketschup|" +
        "Kollier|Kommunikee|Masurka|Negligee|Nessessär|Poulard|Varietee|Wandalismus|kalvinist|[Ff]ick).*"));
    
    PREVENT_SUGGESTION_PATTERNS.push(compile(".+[*_:]in"));  // only suggested when using "..._in" in spelling.txt, so rather never offer this suggestion
    PREVENT_SUGGESTION_PATTERNS.push(compile(".+[*_:]innen"));
    PREVENT_SUGGESTION_PATTERNS.push(compile(".+\\szigste[srnm]?")); // do not suggest "ein zigste" for "einzigste"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[\\wöäüÖÄÜß]+ [a-zöäüß]-[\\wöäüÖÄÜß]+"));   // e.g. "Mediation s-Background"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[\\wöäüÖÄÜß]+- [\\wöäüÖÄÜß]+"));   // e.g. "Pseudo- Rebellentum"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[A-ZÄÖÜ][a-zäöüß]+-[a-zäöüß]+-[a-zäöüß]+"));   // e.g. "Kapuze-over-teil"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[A-ZÄÖÜ][a-zäöüß]+- [a-zäöüßA-ZÄÖÜ\\-]+"));   // e.g. "Tuchs-N-Harmonie"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[A-ZÄÖÜa-zäöüß\\-]+ [a-zäöüßA-ZÄÖÜ]-[a-zäöüßA-ZÄÖÜ\\-]+"));   // e.g. "Linke d-In-Artikel"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[A-ZÄÖÜa-zäöüß\\-]+ [a-zäöüß\\-]+-[A-ZÄÖÜ][a-zäöüß\\-]+"));   // e.g. "Sachsen hausend-Süd"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[\\wöäüÖÄÜß]+ -[\\wöäüÖÄÜß]+"));   // e.g. "ALT -TARIF"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[A-ZÄÖÜa-zäöüß\\-]+\\.[A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\\-]+"));   // e.g. "Bonzeugs.weine"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[A-ZÄÖÜa-zäöüß\\-]+\\.\\-[a-zäöüß\\-]+"));   // e.g. "Wikingerschiff.s"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[a-zöäüß]{3,20} [A-ZÄÖÜ][a-zäöüß]{2,20}liche[rnsm]"));   // e.g. "trage Freundlich"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[A-ZÄÖÜ][a-zäöüß]{2,20}-[a-zäöüß]{2,20}-"));   // prevent Xx-zzz-
    PREVENT_SUGGESTION_PATTERNS.push(compile("[a-zäöüß]{3,20}-[A-ZÄÖÜ][a-zäöüß\\-]{2,20}"));   // prevent "testen-Gut"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[a-zäöüß]{3,20}-[A-ZÄÖÜ\\-]{2,20}"));   // prevent "testen-URL"
    PREVENT_SUGGESTION_PATTERNS.push(compile("([skdm]?ein|viel|sitz|sing|web|hör|woh[nl]|kehr|adel|elektiv|wert|wein|wund|wurm|wand|weg|wett|gen|hei[lm]|kenn|vo[rnm]|fein|zu[rm]?|fehl|bei|peil|eckt?|mit|die|das|ehe|für|nur|eure[rn]?|unse?re?|e[sr]|fahr|bar|fern|warn|filz|oft|fort|bot|vote|käse|we[rnm]|was|gie(ss|ß)|haut|band|heiz|merk|mehr|z[äa]hl|knie|zie[lr]|braut|brat|park|reiz|wa[rs]|wo|ma(ß|ss)|kleb|gabel|brat|rast|rang|lesen?|arm|de[rnms]|sämig|sucht?|sägen?|steh|bahn|off|uff|auf|aß|also|anno|dank|back(en?)?|bl[oi]ck|fang|klär|macht?|haken?|[lw]agen?|messe?|bad(en?)?|pack|km|ecken?|bis|tauche?|tr?age?|segeln?|stei[lg]|stahl|da(nn)?|häng(en?)?[bt]oten?|plus|tat|lade?|tasten?|druck|fach|fragen?|lern|mag|facto|magre|bald|bau(en?)?|ich|sei[dtln]|gang|angeln?|[wl]ach|bist|[ge]ilt|warten?|turn|härten?|hold|[hg]alt|holt|angle|angab|ankam|anale?)-[A-ZÄÖÜa-zäöüß\\-]+"));   // prevent "weg-Arbeiten"
    PREVENT_SUGGESTION_PATTERNS.push(compile(".+-(gen|tu[etn]|l?ehrt?(en?)?|[fv]iele?n?|gärt?en?|igeln?|nein|ja|d?rum|erb(en?)?|vo[rnm]|vors|hat|gab(en)?|gabs?|gibt|km|geb(en?)?|nu[nr]|gay|kalt(e[snr]?)?|la[gd](en?)?|man|rängen?|nässen?|angle|angeln?|angst|stur(en?)?|oft|wo|wann|was|wer|mengen?|spie(ß|ss)en?|adeln?|näht?en?|ob|beide[rn]?|gärten|zweiten?|hütt?en?|kehrt?en?|h?orten?|messen?|tr[ea]u|trüb|trüben?|senden?|gr[uo]b|feinden?|wie|käsen?|ih[rmn](e[srnm]?)?|grau|trug(en?)?|weil|dass|sein?|zucken?|kanten?|s?ich|getan|hält|bald|ärgern?|fächern?|wart?(en?)?|leid|weit(e[snr]?)?|weiden?|ruf(en?)?|min|im|bin|zicken?|jo|siegeln?|[ao]ha|ganz|zäh|jäh|gehen?|ga[br]|kam|sah|[sr]itzen|kann|mit|ohne|ist|so|war|da[rh]in|über|unter|doof|bis|sie|er|aalen?|[lb]aden?|raten?|die|mit|bis|d[ea]s|eifern?|acker[tn]?|z[iu]cken?|j[oe]|jäh|haha|gerät|[wrbfk]etten?|tja|je|kau|nach|haben?|hab|gaga|kicken?|kick|heil|heilen?|altern?|wänden?|wert(e[rsnm]?)?|werben?|zoom|genug|gehen?|ums?|und|oder|[sn]ah|ha|de[mnsr]|sü(ß|ss)|ringen?|dingen?|seil|au[fs]|gurten?|munden?|eigen|wenden?|regen?|b?rechen?|legen?|fächern?|leger|g[ia]lt|heim|heimen?|[mksdw]?ein|[mksdw]?einen?|erden?|ändern?|ernten?|bänden?|ästen?|arten?|kanten?|eichen?|unken?|wunden?|kunden?|runden?|regeln?|kegeln?|krähen?|zechen?|mähen?|ehren?|ehen?|enden?|eng(e[srn]?)?|gut(e[srn]?)?|zielt?(en?)?|spielt?(en?)?|ätzt?(en?)?|riegeln?|segeln?|engt?|engen?|angeln?|kochen?|[lk]ehren?|festen?|essen?|steuern?|ekeln?|irren?|cum|de|da|du|raus|rein|dort|knien?|hin|zu[rm]?|ritten?|riss|rissen?|[tr]ast(en?)?|rasseln?|hieb|wässern?|putz|hängen?|zinken?|a[bnm]|bisher|schöne?|solo|haken?|dr[üu]ck(en?|tot)?|huren?|pries|hupen?|hüllen?|lang|joa|sei[dt]|weist|üben?|ufern?|iss|steck(en?)?|fort|mal|aal|darf|halt(en?)?|eifern?|van|guck(en?|t)?|ganze?|acht(en?)?|auch|solo|[zs]og|lagern?|baggern?|au|haut?|als|uns|bei[m]?|[dm]ir|dich|uni|ergo|eich(en?)?|spick(en?)?|e[rs]|spielt?|we[hg]|wart|wi[rl]d|neue[rns]?|mithin|tags?|eine[snmr]?|wiesen?|rei[sz]en?|wei[sh]en?|siegen?|sag(en?)?|sitzen?|tagen?|all(en?)?|zahlen?|rügen?|ruhen?|bar|hüben?|hick|arm|armen?|plan(en?)?|[fpl]assen?|per|reg|rinnen?|bringen?|öl(en?)?|alt(en?)?|elf(en?)?|kp|ward|apart|wer[dkt](en?)?|weis(en?)?|sind|mm|wand|wir|licht(en)?|lügen?|loch(en?)?|übel|peu|[wtm]isch(en?)?|fein(e[rns]?)?|a(ß|ss)|mol|neu(en?)?|[dm]ich|rang|obe[nr]|übe[nl]?|maxi?|hart(en?)?|hexen?|ab|zück(en?)?|zurück|köpf(en?)?|band(en?)?|schafft?en?|schalt?en?|giften?|sieben?|seil(en?)?|wehen?|sehen?|s[it]?eht?|stocken?|red|rät|ma(ß|ss)|schämen?|innen?|karren?|wer[tf]en?|werft|loch(en?)?|logen?|gossen?|steil(en?)?|fr?isch(en?)?|d[ea]nn|zelt(en?)?|luv|kauf(en?)?|lasch(en?)?|bei(ß|ss)(en?)?|leihen?|leid(en?)?|[drsl]icht(en?)?|opfern?|[wz]äh[mln]en?|wär(en?)?|À|à|fugen?|la[xs]|zahl(en?)?|[rf]all(en?)?|wichs(en?)?|sog(en?)?|alias|glich(en?)?|würd(en?)?|wärm(en?)?|[rhg]eiz(en?)?|stieren?|teils?|trotz|fahr(en?)?|b[oa]u?[dt](en?)?|kl[öo]n(en?)?|paar|park(en?)?|last|landen?|alle[rnms]?|ad|l[äa]u[ft](en?)?|[ws]äg(en?)?|pasch(en?)?|kehl(en?)?|wohl(en?)?|flucht?(en?)?|zeit|rasa|selben?|mehr(en?)?|gabeln?|ordern?|[cw]ach(en?)?|arg(en?)?|brauch(en?)?|hauch(en?)?|[ms]a(ß|ss)(en?)?|mm?h|zart(e[snmr]?)?|ehrt?(en?)?|de[rn]en|ähm?|hui|hmm?|al|für|[bl]au(en?)?|[lr]ahm(en?)?|[bs]uch(en?)?|[wv]ag(en?)?|[tl]os(en?)?|les(en?)?|str?ahl(en?)?|zäh[mn]t?(en?)?|fest(e[rsnm]?)?|folgt?(en?)?|f[aä]llt?(en?)?|[tr]oll(en?)?|[mf]üllt?(en?)?|[rl]eit(en?)?|ras(en?)?|hall(en?)?|well(en?)?|fra(ß|ss)(en)?|tat(en)?|pah|buh(en?)?|bäh|hör(en?)?|holz(en?)?|reif(e[rsmn]?)?|litt|fort(an)?|härten?|welche[rnsm]?|wegen|fach(en?)?|bog(en?)?|foul(en?)?|löst?(en?)?|lots(en?)?|falls|[bwh][ua]ldige[rsn]?|(st)?reift?(en?)?|t?rei[bh](en?)?|[rb]ück(en?)?|wett(en?)?|t[oü]t(en?)?|[ft]est(en?)?|h[aä]ut(en?)?|knall(en?)?|[dk]ämpft?(en?)?|hört?(en?)?|patt(en?)?|[tw]ollt?en?|[km]g|[bkps]ack(en?)?|[lf]an?d(en?)?|seifen?|tabu|heft(en?)?|forma?|knall(en?)?|[lm]?acht?(en)?|boot(en?)?|lach(en?)?|[hb]i?eb(en?)?|tut(en?)?|tr?öt(e[tn]?)?|[sp]ackt?(en?)?|[klnrd]?eckt?(en?)?|beut(en?)?|top|st?att(en?)?|dien(en?)?|[hl]ieb(en?)?|sät|satt(en?)?|droh(en?)?|[sr]äum(en?)?|zeugt?(en?)?|reu(en?)?|nies(en?)?|[gzf]eigt?(en?)?|gie(ß|ss)(en?)?|sichern?|zog(en?)?|schert?(en?)?|s[tp]r?ickt?(en?)?|seicht(e[srn]?)?|(be)?sorgt?(en?)?|ehelich(en?)?|link(en?)?|wein(en?)?|r?echt|orangen?|blick(en?)?|kling(en?)?|übrig(en?)?|klick(en?)?)"));   // e.g. "Babysöckchen" -> "Babys-kochen"
    PREVENT_SUGGESTION_PATTERNS.push(compile("[A-ZÖÄÜa-zöäüß] .+")); // z.B. nicht "I Tand" für "IT and Services"
    PREVENT_SUGGESTION_PATTERNS.push(compile(".+ [a-zöäüßA-ZÖÄÜ]"));// z.B. nicht "rauchen e" für "rauche ne" vorschlagen
}

let splitter: GermanWordSplitter | null = null;
function getSplitter(): GermanWordSplitter {
  return (splitter ??= new GermanWordSplitter(false));
}

export class GermanSpellerRule extends CompoundAwareHunspellRule {

  static override readonly RULE_ID: string = RULE_ID;

  private readonly wordsToBeIgnoredInCompounds = new Set<string>();
  private readonly wordStartsToBeProhibited    = new Set<string>();
  private readonly wordEndingsToBeProhibited   = new Set<string>();
  private readonly wordsNeedingInfixS          = new Set<string>();

  private readonly lineExpander = new LineExpander();
  private readonly compoundTokenizer: GermanCompoundTokenizer;
  private readonly nonStrictCompoundTokenizer: GermanCompoundTokenizer;
  private readonly synthesizer: Synthesizer;

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const matches = super.match(sentence);
    return this.removeGenderCompoundMatches(sentence, matches);
  }

  // ":" and "*" are not in the tokenised text for the speller, so it's easier to remove matches for
  // e.g. "Jurist:innenausbildung" as a cleanup step after the speller has run:
  private removeGenderCompoundMatches(sentence: AnalyzedSentence, matches: RuleMatch[]): RuleMatch[] {
    let filteredMatches = matches;
    const genderPattern = P().GENDER_STAR_PATTERN.matcher(sentence.getText());  // Jurist:innenausbildung -> 'Jurist', ':innenausbildung'
    let pos = 0;
    while (genderPattern.find(pos)) {
      if (!this.isMisspelled(StringReplaceFirst(genderPattern.group()!, '[*:_]', ''))) {  // "_" is not tokenized anyway, so no need to handle it here
        filteredMatches = filteredMatches
          // e.g. "Jurist:innenausbildung" with the ":" removed should be accepted:
          //              ^^^^^^^^^^^^^^^
          .filter((k) => !(genderPattern.start() < k.getFromPos() && genderPattern.end() === k.getToPos()))
          // e.g. "Testexpert*innen" with the "*" removed should be accepted:
          //       ^^^^^^^^^^
          .filter((k) => !(genderPattern.start() === k.getFromPos() && genderPattern.end() > k.getToPos()));
      }
      pos = genderPattern.end();
    }
    const filePattern = P().FILE_UNDERLINE_PATTERN.matcher(sentence.getText());
    pos = 0;
    while (filePattern.find(pos)) {
      filteredMatches = filteredMatches.filter((k) => !(filePattern.start() <= k.getFromPos() && filePattern.end() >= k.getToPos()));
      pos = filePattern.end();
    }
    const mentionPattern = P().MENTION_UNDERLINE_PATTERN.matcher(sentence.getText());
    pos = 0;
    while (mentionPattern.find(pos)) {
      filteredMatches = filteredMatches.filter((k) => !(mentionPattern.start() <= k.getFromPos() && mentionPattern.end() >= k.getToPos()));
      pos = mentionPattern.end();
    }
    return [...filteredMatches];
  }

  /**
   * @since 4.2 (userConfig, languageVariantPlainTextDict), 4.3 (altLanguages, languageModel)
   */
  constructor(messages: ResourceBundle, language: German, userConfig: UserConfig | null = null, languageVariantPlainTextDict: string | null = null,
              altLanguages: Language[] = [], languageModel: LanguageModel | null = null) {
    super(messages, language, language.getNonStrictCompoundSplitter(), () => GermanSpellerRule.getSpeller(language, userConfig, languageVariantPlainTextDict), userConfig, altLanguages, languageModel);
    staticInit();
    this.addExamplePair(Example.wrong('LanguageTool kann mehr als eine <marker>nromale</marker> Rechtschreibprüfung.'),
                        Example.fixed('LanguageTool kann mehr als eine <marker>normale</marker> Rechtschreibprüfung.'));
    this.compoundTokenizer = language.getStrictCompoundTokenizer();
    this.nonStrictCompoundTokenizer = GermanCompoundTokenizer.getNonStrictInstance();
    this.synthesizer = language.getSynthesizer()!;
    this.loadFile('/de/words_infix_s.txt', this.wordsNeedingInfixS);
    this.loadFile('/de/verb_stems.txt', verbStems);
    this.loadFile('/de/verb_prefixes.txt', verbPrefixes);
    this.loadFile('/de/other_prefixes.txt', otherPrefixes);
    this.loadFile('/de/alt_neu.csv', oldSpelling);
  }

  private loadFile(fileInClasspath: string, set: Set<string>): void {
    const lines = JLanguageTool.getDataBroker().getFromResourceDirAsLines(fileInClasspath);
    for (const line of lines) {
      if (!line.startsWith('#')) {
        set.add(StringSplit(StringTrim(line), ';')[0]!);
      }
      if (P().EXPAND_PATTERN.matcher(line).matches()) {
        throw new Error("RuntimeException: Syntax '/{X}' for expansion not supported in this file: '" + line + "' in " + fileInClasspath);
      }
      if (line.endsWith('_in')) {
        throw new Error("RuntimeException: Syntax '_in' not supported in this file: '" + line + "' in " + fileInClasspath);
      }
    }
  }

  protected override init(): void {
    super.init();
    this.ignoreWordsWithLength = 1;  // Java: super.ignoreWordsWithLength
    const pattern = '(' + this.nonWordPattern!.pattern() + '|(?<=[\\d°])-|-(?=\\d+))';
    this.nonWordPattern = compile(pattern);
  }

  override getId(): string {
    return RULE_ID;
  }

  protected override isIgnoredNoCase(word: string): boolean {
    return this.wordsToBeIgnored.has(word) ||
      // words from spelling.txt also accepted in uppercase (e.g. sentence start, bullet list items):
        (P().FIRST_UPPER_CASE.matcher(word).matches() && this.wordsToBeIgnored.has(word.toLowerCase())) ||
      (this.ignoreWordsWithLength > 0 && word.length <= this.ignoreWordsWithLength);
  }

  protected override getMessage(origWord: string, firstSuggestion: SuggestedReplacement): string {
    // Note: will not work for words like "Abgasausstoss" where there's more than one string of "ss"
    // and the first one is not the one we're looking for
    if (replaceOnce(origWord, 'ss', 'ß') === firstSuggestion.getReplacement()) {
      const firstSz = origWord.indexOf('ss');
      if (firstSz >= 2) {
        const prevPrevChar = origWord.charAt(firstSz - 2);
        const prevChar = origWord.charAt(firstSz - 1);
        if (GermanTools.isVowel(prevPrevChar) && GermanTools.isVowel(prevChar)) {
          return 'Nach einer Silbe aus zwei Vokalen (hier: ' + prevPrevChar + prevChar + ") schreibt man 'ß' statt 'ss'.";
        } else {
          return 'Nach einer lang gesprochenen Silbe (hier: ' + prevChar + ") schreibt man 'ß' statt 'ss'.";
        }
      }
    }
    return this.messages!.getString('spelling');
  }

  /** getCandidates(String) here; getCandidates(List) is CompoundAwareHunspellRule's (one method there). */
  override getCandidates(word: string | readonly string[]): string[] {
    if (typeof word !== 'string') {
      return super.getCandidates(word);
    }
    let partList: string[][];
    try {
      partList = getSplitter().getAllSplits(word);
    } catch (e) {
      if (!(e instanceof InputTooLongException)) throw e;
      partList = [];
    }
    const candidates: string[] = [];
    for (const parts of partList) {
      let tmp = super.getCandidates(parts);
      tmp = tmp.filter((k) => !P().HYPHENED_UPPER_WORD.matcher(k).matches() && !P().HYPHENED_WORD.matcher(k).matches());  // avoid e.g. "Direkt-weg"
      tmp = tmp.filter((k) => !k.includes('-s-'));  // avoid e.g. "Geheimnis-s-voll"
      if (!word.endsWith('-')) {
        tmp = tmp.filter((k) => !k.endsWith('-'));  // avoid "xyz-" unless the input word ends in "-"
      }
      candidates.push(...tmp);
      if (parts.length === 2) {
        // e.g. "inneremedizin" -> "innere Medizin", "gleichgroß" -> "gleich groß"
        candidates.push(parts[0] + ' ' + parts[1]);
        if (this.isNounOrProperNoun(uppercaseFirstChar(parts[1]!))) {
          candidates.push(parts[0] + ' ' + uppercaseFirstChar(parts[1]!));
        }
      }
      if (parts.length === 2 && !parts[0]!.endsWith('s')) {
        // so we get e.g. Einzahlungschein -> Einzahlungsschein
        candidates.push(parts[0] + 's' + parts[1]);
      }
      if (parts.length === 2 && parts[1]!.startsWith('s')) {
        // so we get e.g. Ordnungshütter -> Ordnungshüter (Ordnungshütter is split as Ordnung + shütter)
        const firstPart = parts[0]!;
        const secondPart = parts[1]!;
        candidates.push(...super.getCandidates([firstPart + 's', secondPart.substring(1)]));
      }
    }
    return candidates;
  }

  protected override isProhibited(word: string): boolean {
    return super.isProhibited(word) ||
      [...this.wordStartsToBeProhibited].some((w) => word.startsWith(w)) ||
      [...this.wordEndingsToBeProhibited].some((w) => word.endsWith(w));
  }

  protected override addIgnoreWords(origLine: string): void {
    // hack: Swiss German doesn't use "ß" but always "ss" - replace this, otherwise
    // misspellings (from Swiss point-of-view) like "äußere" wouldn't be found:
    const line = this.language.getShortCodeWithCountryAndVariant() === 'de-CH' ? origLine.replaceAll('ß', 'ss') : origLine;
    if (origLine.endsWith('-*')) {
      // words whose line ends with "-*" are only allowed in hyphenated compounds
      this.wordsToBeIgnoredInCompounds.add(line.substring(0, line.length - 2));
      return;
    }
    const words = this.expandLine(line);
    for (const word of words) {
      super.addIgnoreWords(word);
    }
  }

  protected override expandLine(line: string): string[] {
    return this.lineExpander.expandLine(line);
  }

  protected override createWrongSplitMatch(sentence: AnalyzedSentence, ruleMatchesSoFar: RuleMatch[], pos: number, coveredWord: string,
                                           suggestion1: string, suggestion2: string, prevPos: number): RuleMatch | null {
    if (P().LOWER_CASE_WORD.matcher(suggestion2).matches()) {
      // avoid confusing matches for e.g. "haben -sehr" (was: "habe n-sehr")
      return null;
    }
    return super.createWrongSplitMatch(sentence, ruleMatchesSoFar, pos, coveredWord, suggestion1, suggestion2, prevPos);
  }

  /*
   * @since 3.6
   */
  override getSuggestions(word: string): string[] {
    /* Do not just comment in because of https://github.com/languagetool-org/languagetool/issues/3757
    if (word.length() < 18 && word.matches("[a-zA-Zöäüß-]+.?")) {
      for (String prefix : VerbPrefixes.get()) {
        if (word.startsWith(prefix)) {
          String lastPart = word.substring(prefix.length());
          if (lastPart.length() > 3 && !isMisspelled(lastPart)) {
            // as these are only single words and both the first part and the last part are spelled correctly
            // (but the combination is not), it's okay to log the words from a privacy perspective:
            logger.info("UNKNOWN: {}", word);
          }
        }
      }
    }*/
    let suggestions = super.getSuggestions(word);
    suggestions = suggestions.filter((s) => this.acceptSuggestion(s));
    if (word.endsWith('.')) {
      // To avoid losing the "." of "word" if it is at the end of a sentence.
      suggestions = suggestions.map((s) => s.endsWith('.') ? s : s + '.');
    }
    suggestions = suggestions.filter((k) =>
      k !== word &&
      (!k.endsWith('-') || word.endsWith('-')) &&  // no "-" at end (#2450)
      !P().STARTING_WITH_SINGLE_CHAR.matcher(k).matches()  // single chars like in "ü berstenden" (#2610)
    );
    return suggestions;
  }

  protected override acceptSuggestion(s: string): boolean {
      return !PREVENT_SUGGESTION_PATTERNS.some((p) => p.matcher(s).matches())
        && !s.includes('--')
        && !s.endsWith('roulett')
        && !s.endsWith('-s')   // https://github.com/languagetool-org/languagetool/issues/4042
        && !s.endsWith(' de')   // https://github.com/languagetool-org/languagetool/issues/4042
        && !s.endsWith(' en')   // https://github.com/languagetool-org/languagetool/issues/4042
        && !s.endsWith(' Artigen')
        && !s.endsWith(' Artige')
        && !s.endsWith(' artigen')
        && !s.endsWith(' artiges')
        && !s.endsWith(' artiger')
        && !s.endsWith(' artige')
        && !s.endsWith(' artig')
        && !s.endsWith(' gen')
        && !s.endsWith(' ehe')
        && !s.endsWith(' ende')
        && !s.endsWith(' enden')
        && !s.endsWith(' enge')
        && !s.endsWith(' förmig')
        && !s.endsWith(' förmige')
        && !s.endsWith(' förmigen')
        && !s.endsWith(' förmiger')
        && !s.endsWith(' förmiges')
        && !s.startsWith('Doppel ')
        && !s.startsWith('Kombi ');
  }

  protected static override getSpellingFilePaths(langCode: string): string[] {
    const paths = [...CompoundAwareHunspellRule.getSpellingFilePaths(langCode)];
    paths.push('/' + langCode + '/hunspell/spelling_recommendation.txt');
    return paths;
  }

  protected static getSpeller(language: Language, userConfig: UserConfig | null, languageVariantPlainTextDict: string | null): MorfologikMultiSpeller | null {
    const langCode = language.getShortCode();
    const morfoFile = '/' + langCode + '/hunspell/' + langCode + '_' + language.getCountries()[0] + JLanguageTool.DICTIONARY_FILENAME_EXTENSION;
    if (JLanguageTool.getDataBroker().resourceExists(morfoFile)) {  // spell data will not exist in LibreOffice/OpenOffice context
      const paths = [...GermanSpellerRule.getSpellingFilePaths(langCode)];
      if (languageVariantPlainTextDict != null) {
        paths.push(languageVariantPlainTextDict);
      }
      const streams = CompoundAwareHunspellRule.getStreams(paths);
      const br = new LineReader(streams);
      const variantReader = GermanSpellerRule.getVariantReader(languageVariantPlainTextDict);
      return new MorfologikMultiSpeller(morfoFile, new ExpandingReader(br), paths,
        variantReader, languageVariantPlainTextDict, userConfig, MAX_EDIT_DISTANCE, null);
    } else {
      return null;
    }
  }

  private static getVariantReader(languageVariantPlainTextDict: string | null): LineReader | null {
    let variantReader: LineReader | null = null;
    if (languageVariantPlainTextDict != null && languageVariantPlainTextDict.length !== 0) {
      const variantStream = JLanguageTool.getDataBroker().getFromResourceDirAsLines(languageVariantPlainTextDict);
      variantReader = new ExpandingReader(new LineReader(variantStream));
    }
    return variantReader;
  }

  protected override filterForLanguage(suggestions: string[]): void {
    if (this.language.getShortCodeWithCountryAndVariant() === 'de-CH') {
      for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i]!;
        suggestions[i] = s.replaceAll('ß', 'ss');
      }
    }
    // Remove suggestions like "Mafiosi s" and "Mafiosi s.":
    removeIf(suggestions, (s) => StringSplit(s, ' ').some((k) => P().WORD_WITH_PUNCT.matcher(k).matches()));
    // This is not quite correct as it might remove valid suggestions that start with "-",
    // but without this we get too many strange suggestions that start with "-" for no apparent reason
    // (e.g. for "Gratifikationskrisem" -> "-Gratifikationskrisen"):
    removeIf(suggestions, (s) => s.length > 1 && s.startsWith('-'));
  }

  protected override sortSuggestionByQuality(misspelling: string, suggestions: string[]): string[] {
    // filter some undesired inflected forms
    const filteredSuggestions: string[] = [];
    let readingsList: AnalyzedTokenReadings[] = [];
    readingsList = this.getTagger().tag(suggestions);
    let lemmaToFilter = '';
    let formToAccept = '';
    for (const readings of readingsList) {
      if (readings.hasAnyPartialPosTag('ADJ') || readings.hasAnyPartialPosTag('SUB')
          || readings.hasAnyPartialPosTag('PA1:') || readings.hasAnyPartialPosTag('PA2:')) {
        if (readings.getToken().endsWith(misspelling.substring(misspelling.length - 2))) {
          formToAccept = readings.getToken();
          lemmaToFilter = readings.getAnalyzedToken(0).getLemma()!;
          break;
        }
      }
    }
    if (lemmaToFilter.length !== 0 && formToAccept.length !== 0 && misspelling.length > 1) {
      for (let i = 0; i < suggestions.length; i++) {
        if (suggestions[i] === formToAccept || !readingsList[i]!.hasAnyLemma(lemmaToFilter)) {
          if (!filteredSuggestions.includes(suggestions[i]!)) {
            filteredSuggestions.push(suggestions[i]!);
          }
        }
      }
    } else {
      filteredSuggestions.push(...suggestions);
    }
    // end of filtering
    const result: string[] = [];
    const topSuggestions: string[] = []; // candidates from suggestions that get boosted to the top
    for (const suggestion of filteredSuggestions) {
      if (StringEqualsIgnoreCase(misspelling, suggestion)) { // this should be preferred - only case differs
        topSuggestions.push(suggestion);
      } else if (suggestion.includes(' ')) { // this should be preferred - prefer e.g. "vor allem":
        // suggestions at the sentence end include a period sometimes, clean up for ngram lookup
        const words = StringSplit(StringReplaceFirst(suggestion, '\\.$', ''), ' ', 2);
        if (this.languageModel != null && words.length === 2) {
          // language model available, test if split word occurs at all / more frequently than alternative
          const nonSplit = this.languageModel.getPseudoProbability([words[0]! + words[1]!]);
          const split = this.languageModel.getPseudoProbability(words);
          //System.out.printf("Probability - %s vs %s: %.12f (%d) vs %.12f (%d)%n",
          //  words[0] + words[1], suggestion,
          if (nonSplit.getProb() > split.getProb() || split.getProb() === 0) {
            result.push(suggestion);
          } else {
            topSuggestions.push(suggestion);
          }
        } else {
          topSuggestions.push(suggestion);
        }
      } else {
        result.push(suggestion);
      }
    }
    result.unshift(...topSuggestions);
    return result;
  }

  protected override getFilteredSuggestions(wordsOrPhrases: string[]): string[] {
    const result: string[] = [];
    for (const wordOrPhrase of wordsOrPhrases) {
      const words = this.tokenizeText(wordOrPhrase);
      if (words.length >= 2 && this.isAdjOrNounOrUnknown(words[0]!) && this.isNounOrUnknown(words[1]!) &&
              startsWithUppercase(words[0]!) && startsWithUppercase(words[1]!)) {
        // ignore, seems to be in the form "Release Prozess" which is *probably* wrong
      } else if (words.length === 2 && this.isAdjBaseForm(words[0]!) && !startsWithUppercase(words[0]!) && this.isSubVerInf(words[1]!)) {
        // filter "groß Denken" in "großdenken"
      } else {
        result.push(wordOrPhrase);
      }
    }
    return result;
  }

  private isNounOrUnknown(word: string): boolean {
    const readings = this.getTagger().tag([word]);
    return readings.some((reading) => reading.hasPosTagStartingWith('SUB') || reading.isPosTagUnknown());
  }

  private isOnlyNoun(word: string): boolean {
    const readings = this.getTagger().tag([word]);
    for (const reading of readings) {
      const accept = reading.getReadings().every((k) => k.getPOSTag() != null && k.getPOSTag()!.startsWith('SUB:'));
      if (!accept) {
        return false;
      }
    }
    return readings.every((reading) => reading.matchesPosTagRegex('SUB:.*'));
  }

  private isAdjOrNounOrUnknown(word: string): boolean {
    const readings = this.getTagger().tag([word]);
    return readings.some((reading) => reading.hasPosTagStartingWith('SUB') || reading.hasPosTagStartingWith('ADJ') || reading.isPosTagUnknown());
  }

  private isNounOrProperNoun(word: string): boolean {
    const readings = this.getTagger().tag([word]);
    return readings.some((reading) => reading.hasPosTagStartingWith('SUB') || reading.hasPosTagStartingWith('EIG'));
  }

  private isSubVerInf(word: string): boolean {
    const readings = this.getTagger().tag([word]);
    return readings.some((reading) => reading.matchesPosTagRegex('SUB:.*:INF'));
  }

  private isAdjBaseForm(word: string): boolean {
    const readings = this.getTagger().tag([word]);
    return readings.some((reading) => reading.hasPosTagStartingWith('ADJ:PRD:GRU'));
  }

  private ignoreElative(word: string): boolean {
    if (startsWithAny(word, 'bitter', 'dunkel', 'erz', 'extra', 'früh',
        'gemein', 'hyper', 'lau', 'mega', 'minder', 'stock', 'super', 'tod', 'ultra', 'ur')) {
      const lastPart = removePattern(word, '^(bitter|dunkel|erz|extra|früh|gemein|grund|hyper|lau|mega|minder|stock|super|tod|ultra|ur|voll)');
      return lastPart.length >= 3 && !this.isMisspelled(lastPart);
    }
    return false;
  }

  override isMisspelled(word: string): boolean {
    if (P().SCHAF_PATTERN.matcher(word).matches() && !P().SCHAFE_PATTERN.matcher(word).matches()) {
      const variant = StringReplaceFirst(StringReplaceFirst(StringReplaceFirst(word, 'schaf$', 'schaft'), 'schafs$', 'schaft'), 'schafen$', 'schaften');
      if (!this.isMisspelled(variant)) {
        return true;
      }
    }
    if (word.startsWith('Spielzug') && !P().START_WITH_SPIEL.matcher(word).matches()) {
      return true;
    }
    if (word.startsWith('Standart') && word !== 'Standarte' && word !== 'Standarten' && !word.startsWith('Standartenträger') && !word.startsWith('Standartenführer')) {
      return true;
    }
    if (word.endsWith('schafte') && P().END_WITH_SCHAFTE.matcher(word).matches()) {
      return true;
    }
    return super.isMisspelled(word);
  }

  /** ignoreWord(List, int) here; ignoreWord(String) is SpellingCheckRule's (one method there). */
  protected override ignoreWord(words: string | readonly string[], idx?: number): boolean {
    if (typeof words === 'string') {
      return super.ignoreWord(words);
    }
    const word = words[idx!]!;
    if (word.length > MAX_TOKEN_LENGTH) {
      return true;
    }
    const ignore = super.ignoreWord(words, idx);
    const ignoreUncapitalizedWord = !ignore && idx === 0 && super.ignoreWord(uncapitalize(words[0]!));
    let ignoreByHyphen = false;
    let ignoreBulletPointCase = false;
    if (!ignoreUncapitalizedWord) {
      // happens e.g. with list items in Google Docs, which introduce ﻿, which here appears as
      // an empty token:
      ignoreBulletPointCase = !ignore && idx === 1 && words[0]!.length === 0
        && startsWithUppercase(word)
        && this.isMisspelled(word)
        && !this.isMisspelled(word.toLowerCase());
    }
    let ignoreHyphenatedCompound = false;
    if (!ignore && !ignoreUncapitalizedWord) {
      if (word.includes('-')) {
        if (idx! > 0 && '' === words[idx! - 1] && startsWithAny(word, 'stel-', 'tel-')) {
          // accept compounds such as '100stel-Millimeter' or '5tel-Gramm'
          return !this.isMisspelled(substringAfter(word, '-'));
        } else {
          ignoreByHyphen = word.endsWith('-') && this.ignoreByHangingHyphen(words, idx!);
        }
      }
      ignoreHyphenatedCompound = !ignoreByHyphen && this.ignoreCompoundWithIgnoredWord(word);
    }
    if (CommonFileTypes.getSuffixPattern().matcher(word).matches()) {
      return true;
    }
    if (P().missingAdjPattern.matcher(word).matches()) {
      const firstPart = uppercaseFirstChar(StringReplaceFirst(word, adjSuffix + '(er|es|en|em|e)?', ''));
      // We append "test" to see if the word plus "test" is accepted as a compound. This way, we get the
      // infix 's' handled properly (e.g. "arbeitsartig" is okay, "arbeitartig" is not). It does not accept
      // all compounds, though, as hunspell's compound detection is limited ("Zwiebacktest"):
      // TODO: see isNeedingFugenS()
      // https://www.sekada.de/korrespondenz/rechtschreibung/artikel/grammatik-in-diesen-faellen-steht-das-fugen-s/
      /*if (!isMisspelled(firstPart) && !isMisspelled(firstPart + "test")) {
        System.out.println("accept1: " + word + " [" + !isMisspelled(word) + "]");
        //return true;
      } else if (firstPart.endsWith("s") && !isMisspelled(firstPart.replaceFirst("s$", "")) && !isMisspelled(firstPart + "test")) { // "handlungsartig"
        System.out.println("accept2: " + word + " [" + !isMisspelled(word) + "]");
        //return true;
      }*/
      if (this.isMisspelled(word)) {
        if (!this.isMisspelled(firstPart) &&
            !P().SPECIAL_CASE.matcher(firstPart).matches() &&
            this.isOnlyNoun(firstPart) &&
            !this.isMisspelled(firstPart + 'test')) {  // does hunspell accept this? takes infex-s into account automatically
          //System.out.println("will accept: " + word);
          return true;
        } else if (!this.isMisspelled(firstPart) &&
                  !P().SPECIAL_CASE.matcher(firstPart).matches()) {
                   //System.out.println("will not accept: " + word);
        } else if (firstPart.endsWith('s') && !this.isMisspelled(firstPart.substring(0, firstPart.length - 1)) &&
                   P().SPECIAL_CASE_WITH_S.matcher(firstPart).matches() &&
                   this.isOnlyNoun(firstPart.substring(0, firstPart.length - 1)) &&
                   !this.isMisspelled(firstPart + 'test')) {  // does hunspell accept this? takes infex-s into account automatically
          //System.out.println("will accept: " + word);
          return true;
        } else if (firstPart.endsWith('s') && !this.isMisspelled(firstPart.substring(0, firstPart.length - 1)) &&
                   P().SPECIAL_CASE.matcher(firstPart).matches()) {
          //System.out.println("will not accept: " + word);
        }
      }
    }
    if (word.endsWith('mitarbeitende') || word.endsWith('mitarbeitenden')) {
      if (this.hunspell!.spell(StringReplaceFirst(word, 'mitarbeitenden?', 'mitarbeiter'))) {
        return true;
      }
    }
    if ((idx! + 1 < words.length && (word.endsWith('.mp') || word.endsWith('.woff')) && words[idx! + 1] === '') ||
        (idx! > 0 && '' === words[idx! - 1] && equalsAny(word, 'sat', 'stel', 'tel', 'stels', 'tels') )) {
      // e.g. ".mp3", "3sat", "100stel", "5tel" - the check for the empty string is because digits were removed during
      // hunspell-style tokenization before
      return true;
    }
    return ignore || ignoreUncapitalizedWord || ignoreBulletPointCase || ignoreByHyphen || ignoreHyphenatedCompound || this.ignoreElative(word);
  }

  protected override ignorePotentiallyMisspelledWord(word: string): boolean {
    // Remove dot
    let wordNoDot = word.endsWith('.') ? word.substring(0, word.length - 1) : word;

    if (this.isValidWordLength(word) || startsWithLowercase(word) || this.isProhibited(word) || this.isProhibited(wordNoDot)) {
      // Exclude cases like weird/irrelevant words and very long words that can cause crashes
      return false;
    }
    // Check for words that are likely to be typos
    if (this.isProbablyTypo(word)) {
      return false;
    }

    // Format gender neutral forms here to make splitting easier, but
    //   we need to double-check the word later to avoid words in camel case
    //   that look similar to gender-neutral language (e. g. AktienIndex).
    const wordNoDotOrg = wordNoDot;
    // "Expert*innen" -> "Expertinnen"
    // "ExpertInnen"  -> "Expertinnen"
    wordNoDot = P().GENDER_STAR.matcher(wordNoDot).replaceFirst('in');

    // Return false if a word is written in CamelCase
    if (!this.isValidCamelCase(wordNoDot)) {
      return false;
    }

    let parts = [...this.compoundTokenizer.tokenize(wordNoDot)];
    if (parts.length === 1) {
      parts = [...this.nonStrictCompoundTokenizer.tokenize(wordNoDot)];
    }
    // If at least one element in *parts* at position i equals "s", then append "s" to element at i-1
    parts = this.avoidInfixSAsSingleToken(parts);

    // Handle cases for hyphenated compounds that don't depend on tokenization
    // and preprocess further
    if (wordNoDot.includes('-')) {
      //Split original word by hyphen
      const splitByHyphen = [...StringSplit(wordNoDot, '-')];
      const lastPart = splitByHyphen[splitByHyphen.length - 1]!;

      if (!this.isNoun(lastPart) &&  this.isNoun(uppercaseFirstChar(lastPart))) {
        // Make sure that last part is uppercase, if it is probably a noun
        // e.g. "Implementierungs-pflicht"
        return false;
      }

      for (const w of splitByHyphen) {
        if (this.isMisspelled(w) && this.isMisspelled(this.removeTrailingSAndHyphen(w))) {
          return false;
        }
      }

      // Split tokenized parts that contain hyphens
      // example: "Wacht" + "ums-pistole" -> "Wacht" + "ums" + "pistole"
      parts = this.splitPartsByHyphen(parts);

      // Hyphens are often removed by the tokenizer. Restore them to determine later if a compound is correct
      parts = this.restoreRemovedHyphens(parts, wordNoDot);
    }

    // Make sure that the individual parts of the compound have appropriate length.
    // Short words can also be typos.
    if (!this.isValidPartLength(parts)) {
      return false;
    }

    // Make sure that compound is not written in old spelling
    if (parts.length >= 2) {
      if (this.isOldSpelling(parts)) {
        return false;
      }
    }

    // Now that the compound has probably been split correctly,
    //   we can use this information to check,
    //   if a part matching '(?<=(\w))In|[\*:_]in|/-in'
    //   is actually gender-neutral language
    if (P().GENDER2_STAR2.matcher(wordNoDotOrg).matches()) {
      if (!this.isValidGenderNeutralWord(parts, wordNoDotOrg)) {
        return false;
      }
    }

    if (parts.length === 2) {
      return this.processTwoPartCompounds(parts[0]!, parts[1]!);
    } else if (parts.length === 3) {
      return this.processThreePartCompound(parts);
    } else {
      // more than three parts can be supported later
      return false;
    }
  }

  private isValidWordLength(word: string): boolean {
    return word.length <= MIN_WORD_LENGTH || word.length >= MAX_WORD_LENGTH;
  }

  private isValidPartLength(parts: readonly string[]): boolean {
    // don't assume very short parts (like "Ei") are correct, these can easily be typos:
    if (parts.length === 2) {
      return parts[0]!.length >= 3 && parts[1]!.length >= 4;
    }
    if (parts.length === 3) {
      return parts[0]!.length >= 3 && parts[1]!.length >= 4 && parts[2]!.length >= 4;
    }
    return false;
  }

  private isOldSpelling(parts: readonly string[]): boolean {
    for (const part of parts) {
      const cleanedPart = this.removeTrailingSAndHyphen(part);
      if (part.endsWith('s')) {
        if (oldSpelling.has(uppercaseFirstChar(part)) || oldSpelling.has(uppercaseFirstChar(cleanedPart))
          || oldSpelling.has(lowercaseFirstChar(part)) || oldSpelling.has(lowercaseFirstChar(cleanedPart))) {
          return true;
        }
      } else {
        if (oldSpelling.has(uppercaseFirstChar(cleanedPart)) || oldSpelling.has(lowercaseFirstChar(cleanedPart))) {
          return true;
        }
      }
    }
    return false;
  }

  private isValidGenderNeutralWord(parts: readonly string[], word: string): boolean {
    let start = 0;
    for (const part of parts) {
      let end = start + part.length;

      let toCheck = word.substring(start, end);
      if (toCheck.startsWith('I') && start > 0) {
        // e. g. AktienIndex
        return false;
      }
      if (P().POTENTIAL_BINNEN_I.matcher(toCheck).matches()) {
        if (this.isMisspelled(StringReplaceFirst(toCheck, '((?<=(\\w))In)', 'in'))
            || (!toCheck.endsWith('In') && !toCheck.endsWith('Innen'))) {
          return false;
        }
      }
      if (P().GENDER_NEUTRAL_SPECIAL_CHRS_SIN.matcher(toCheck).matches()) {
        if (this.isMisspelled(StringReplaceFirst(toCheck, '[\\*:_/]in', 'in'))) {
          return false;
        }
        end ++;
      }
      if (P().GENDER_NEUTRAL_SPECIAL_CHRS_PLU.matcher(toCheck).matches()) {
        if (end < word.length) {
          end++;
          toCheck = word.substring(start, end);
        }
        if (this.isMisspelled(StringReplaceFirst(toCheck, '[\\*:_/]in', 'in'))
          || (!toCheck.endsWith('in') && !toCheck.endsWith('innen'))) {
          return false;
        }
      }
      if (P().GENDER_NEUTRAL_SLASH_HYPHEN.matcher(toCheck).matches()) {
        if (end + 1 < word.length) {
          end += 2;
          toCheck = word.substring(start, end);
        }
        if (this.isMisspelled(StringReplaceFirst(toCheck, '/-in', 'in'))
          || (!toCheck.endsWith('in') && !toCheck.endsWith('innen'))) {
          return false;
        }
      }

      start = end;
    }
    return true;
  }

  private removeTrailingS(part1: string): string {
    return removeEnd(part1, 's')!;
  }

  private removeTrailingHyphen(part1: string): string { return removeEnd(part1, '-')!; }

  private removeTrailingSAndHyphen(part1: string): string { return this.removeTrailingS(this.removeTrailingHyphen(part1)); }

  private isAdjective(word: string): boolean {
    return this.getTagger().tag([word]).some((k) => k.hasPosTagStartingWith('ADJ:'));
  }

  private isNoun(word: string): boolean {
    return this.getTagger().tag([word]).some((k) => k.hasPosTagStartingWith('SUB:'));
  }

  private processTwoPartCompounds(part1: string, part2: string): boolean {
    // Expects two parts of a compound and checks
    //  if their POS tags are correct,
    //  if an infix s is missing or
    //  if an infix s is incorrect
    const part1upcased = uppercaseFirstChar(part1);
    const part2upcased = uppercaseFirstChar(part2);
    const part1WithoutHyphen = this.removeTrailingHyphen(part1);
    const part2upcasedIsNoun = this.isNoun(part2upcased);
    const part2upcasedIsMispelled = this.isMisspelled(uppercaseFirstChar(part2upcased));

    if (P().INVALID_COMP_PART_1.matcher(lowercaseFirstChar(part1WithoutHyphen)).matches()) {
      return false;
    }
    if (P().INVALID_COMP_PART_2.matcher(lowercaseFirstChar(part2)).matches()) {
      return false;
    }

    let part1WithoutInfixS = part1upcased;

    // Sometimes part1 requires singular or plural
    let part1Lemma = this.findLemmaForNoun(this.removeTrailingHyphen(part1));
    //
    if (part1Lemma === '' && this.removeTrailingHyphen(part1).endsWith('s')) {
      part1Lemma = this.findLemmaForNoun(this.removeTrailingSAndHyphen(part1));
      part1WithoutInfixS = this.removeTrailingS(part1upcased);
    }

    // Allow part1 to be a plural noun if...

    // ... part2 is a nominalized verb or...
    if (this.isNounNomPlu(part1WithoutInfixS) && !this.isNounNomSin(part1WithoutInfixS) && !this.isCountryOrRegionNomSin(part1WithoutInfixS) &&
        (!this.isSubVerInf(part2upcased) ||
        (this.isSubVerInf(part2upcased) && P().SUBINF_SINGULAR_OBJECT.matcher(lowercaseFirstChar(part2)).matches())) &&
        !this.needsToBePlural(lowercaseFirstChar(part1Lemma)) &&
        !P().WECHSELNUMERUS.matcher(lowercaseFirstChar(part1Lemma)).matches() &&
        !P().WECHSELINFIX.matcher(lowercaseFirstChar(this.removeTrailingS(part1Lemma))).matches()) {
       return false;
    }
    // ... part1 always needs to be plural or...
    if (this.needsToBePlural(lowercaseFirstChar(part1Lemma)) && this.isNounNomSin(part1WithoutInfixS)) {
      return false;
    }
    // ... part1
    if (P().WECHSELNUMERUS.matcher(lowercaseFirstChar(part1Lemma)).matches()) {
      if (!this.checkPluralForPart1Part2Combination(part1, part2)) {
        return false;
      }
    }

    // For some part1-and-part2 combinations an infix s is correct or incorrect
    if (P().WECHSELINFIX.matcher(lowercaseFirstChar(part1)).matches()) {
      return this.checkInfixSForPart1Part2Combination(part1, part2);
    }

    // Check for easily confused prefixes (e. g. wieder vs wider)
    if (P().CONFUSED_PREFIXES.matcher(lowercaseFirstChar(part1)).matches() && !part2upcasedIsMispelled
        && part2upcasedIsNoun) {
      return this.checkConfusionForPart1Part2Combination(part1, part2);
    }

    // TODO distinguish more cases with hyphens
    if (part2upcasedIsNoun && !part2upcasedIsMispelled &&
      // 's' is the last character in *part1* and is probably not an infix
      part1WithoutHyphen.endsWith('s') && (this.isNounNom(part1upcased) || this.isVerbStem(part1)) &&
      // check if infix 's' is required or not allowed
      (!this.needsInfixS(this.removeTrailingS(part1upcased)))) {
      return true;
    }
    if (part2upcasedIsNoun && !part2upcasedIsMispelled &&
      // 's' is the last character in *part1* and is probably an infix
      part1WithoutHyphen.endsWith('s') && this.isNounNom(this.removeTrailingSAndHyphen(part1upcased)) &&
      // check if infix 's' is required or not allowed
      (this.needsInfixS(this.removeTrailingSAndHyphen(part1upcased)))) {
      return true;
    }
    if (part2upcasedIsNoun && !part2upcasedIsMispelled &&
      // *part1* does not end with 's' and is noun or verb stem
      (!part1WithoutHyphen.endsWith('s')) && (this.isNounNom(part1upcased) || this.isVerbStem(part1)) &&
      // check if infix 's' is required or not allowed
      (!this.needsInfixS(part1upcased))) {
      return true;
    }
    if (part2upcasedIsNoun && !part2upcasedIsMispelled &&
      // *part1* is acronym or other prefix, e. g. "SEO-Expertinnen", "Sprachvariante"
      ((isAllUppercase(this.removeTrailingSAndHyphen(part1)) && !this.isMisspelled(this.removeTrailingSAndHyphen(part1))) || this.isOtherPrefix(part1))) {
      return true;
    }
    if (part2upcasedIsNoun && !part2upcasedIsMispelled &&
      //e. g. Schwedenreise
      this.isCountryOrRegionNomSin(part1) && !P().CITIES_EXCEPTIONS.matcher(lowercaseFirstChar(part2)).matches()) {
      return true;
    }
    return false;
  }

  protected processThreePartCompound(parts: readonly string[]): boolean {
    const part1 = parts[0]!;
    const part2 = parts[1]!;
    const part3 = parts[2]!;
    const compound1 = part1 + part2;
    const compound2 = uppercaseFirstChar(part2) + parts[2];

    if (this.isNoun(compound1) && this.isNoun(compound2)) {
      // If part1part2 and part2part3 are compounds, then so is part1part2part3
      return (this.processTwoPartCompounds(part1, this.removeTrailingHyphen(part2)) && this.processTwoPartCompounds(part2, part3));
    }
    if (compound1.endsWith('s') || compound1.endsWith('s-')) {
      const part2NoInfixSNoHyphen = this.removeTrailingSAndHyphen(part2);
      // If part1part2NoInfixSNoHyphen and part2part3 are compounds, then so is part1part2part3
      return (this.processTwoPartCompounds(part1, part2NoInfixSNoHyphen) && this.processTwoPartCompounds(part2, part3));
    }
    if (this.isVerbPrefix(part1) && this.isVerbStem(part2) && this.isNoun(compound2)) {
      // e.g. "Aus" + "leih" + "stelle"
      return true;
    }
    if (this.isNounNomSin(part1) && this.isVerbStem(part2) && this.isNoun(compound2)) {
      // e.g. "Wein" + "kühl" + "schrank"
      return true;
    }
    if (this.isNounNom(part1) && this.isOtherPrefix(part2) && this.isNoun(compound2)) {
      // e.g. "Erwachsenen" + "intensiv" + "kurse"
      return true;
    }
    if (this.isOtherPrefix(part1) && this.isVerbStem(part2) && this.isNoun(compound2)) {
      // e.g. "Horizontal" + "bohr" + "technik"
      return true;
    }
    return false;
  }

  private checkInfixSForPart1Part2Combination(part1: string, part2: string): boolean {
    // For some part1-and-part2 combinations an infix s is correct or incorrect
    let part2Lemma = this.findLemmaForNoun(this.removeTrailingHyphen(part2));
    if (part2Lemma === '' && this.removeTrailingHyphen(part2).endsWith('s')) {
      part2Lemma = this.findLemmaForNoun(this.removeTrailingSAndHyphen(part2));
    }

    if (part1 === 'Arbeit' && (P().ARBEIT_COMP.matcher(part2).matches())) {
      // e. g. "Arbeitplatz"
      return true;
    }
    if (part1 === 'Arbeits' && !(P().ARBEIT_COMP.matcher(part2).matches())) {
      // e. g. "Arbeitsgeber"
      return true;
    }
    if (part1 === 'Link' && P().LINK_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches()) {
      return true;
    }
    if (part1 === 'Links' && P().LINKS_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches()) {
      return true;
    }
    if (part1 === 'Recht' && P().RECHT_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches()) {
      // e. g. "Rechtanwälte"
      return true;
    }
    if (part1 === 'Rechts' && P().RECHTS_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches()) {
      // e. g. "Rechtsfertigung"
      return true;
    }
    if (part1 === 'Verband' && P().VERBAND_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches()) {
      // e. g. "Verbandgemeinde"
      return true;
    }
    if (part1 === 'Verbands' && P().VERBANDS_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches()) {
      // e. g. "Verbandszeug"
      return true;
    }
    if (P().WOCHENTAGE.matcher(part1).matches() && P().WOCHENTAG_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches()) {
      return true;
    }
    if (P().WOCHENTAGE_S.matcher(part1).matches() && !P().WOCHENTAG_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches()) {
      return true;
    }
    return false;
  }

  private checkConfusionForPart1Part2Combination(part1: string, part2: string): boolean {
    const part2Lemma = this.findLemmaForNoun(this.removeTrailingHyphen(part2));
    if (part1 === 'Bad' && (P().BACH_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches())) {
      return true;
    }
    if (part1 === 'Bad' && (P().BAD_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches())) {
      return true;
    }
    if (part1 === 'Bade' && (!P().BAD_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches())) {
      return true;
    }
    if (part1 === 'Wider' && (P().WIDER_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches())) {
      return true;
    }
    if (part1 === 'Wieder' && (!P().WIDER_COMP.matcher(lowercaseFirstChar(part2Lemma)).matches())) {
      return true;
    }
    return false;
  }

  private checkPluralForPart1Part2Combination(part1: string, part2: string): boolean {
    // For some part1-and-part2 combinations part1 needs to be singular or plural
    let part2Lemma = this.findLemmaForNoun(this.removeTrailingHyphen(part2));
    if (part2Lemma === '' && this.removeTrailingHyphen(part2).endsWith('s')) {
      part2Lemma = this.findLemmaForNoun(this.removeTrailingSAndHyphen(part2));
    }
    if (part1 === 'Welt' && (!P().WELTEN_COMP.matcher(part2Lemma).matches())) {
      // e. g. "Weltklima"
      return true;
    }
    if (part1 === 'Welten' && (P().WELTEN_COMP.matcher(part2Lemma).matches())) {
      // e. g. "Weltenbummler"
      return true;
    }
    if (part1 === 'Wort' && (!P().WOERTER_COMP.matcher(part2Lemma).matches())) {
      // e. g. "Wortgrenze"
      return true;
    }
    if (part1 === 'Wörter' && (P().WOERTER_COMP.matcher(part2Lemma).matches())) {
      // e. g. "Wörterbuch"
      return true;
    }
    return false;
  }

  private findLemmaForNoun(word: string): string {
    let lemma = '';
    const readings = this.getTagger().tag([uppercaseFirstChar(word)]);
    for (const reading of readings) {
      if (reading.hasPosTagStartingWith('SUB')) {
        lemma = reading.getReadings()[0]!.getLemma()!;
      }
    }
    return lemma;
  }

  private isProbablyTypo(word: string): boolean {
    return P().COMPOUND_TYPOS.matcher(word).matches() || P().COMPOUND_END_TYPOS.matcher(word).matches();
  }

  private isValidCamelCase(input: string): boolean {
    // Check if the string contains any instance of camel casing
    return !P().CAMEL_CASE.matcher(input).matches();
  }

  private restoreRemovedHyphens(parts: readonly string[], word: string): string[] {
      // Restore hyphens that were removed by the tokenizer by appending them to
      //   individual tokens
      const tokensWithHyphens: string[] = [];

      // Find and store the positions of hyphens in the original word
      const hyphenPositions: number[] = [];
      for (let i = 0; i < word.length; i++) {
        if (word.charAt(i) === '-') {
          hyphenPositions.push(i);
        }
      }

      let currentPos = 0;
      for (let token of parts) {
        // Check if the next hyphen is within the current token
        for (const hyphenPos of hyphenPositions) {
          if (hyphenPos >= currentPos && hyphenPos === currentPos + token.length) {
            // Insert hyphen at the end of this token
            token += '-';
            break; // Move to the next token after adding a hyphen
          }
        }
        tokensWithHyphens.push(token);
        currentPos += token.length;
      }
      return tokensWithHyphens;
    }

  private avoidInfixSAsSingleToken(parts: string[]): string[] {
    // If a part equals "s", append it to its predecessor
    //   example: "Priorität", "s", "ding" -> "Prioritäts", "ding"
    const indexesOfS = this.indexOfInfixS(parts);

    // Sort indexes in descending order to avoid shifting issues while removing elements
    indexesOfS.sort((a, b) => b - a);

    for (const index of indexesOfS) {
      if (index > 0 && index < parts.length) { // Ensure index is within bounds and not the first element
        const toAppend = parts.splice(index, 1)[0]!; // Remove the element at position i and store it
        parts[index - 1] = parts[index - 1] + toAppend; // Append the removed string to the element at i-1
      }
    }
    return parts;
  }

  private splitPartsByHyphen(originalParts: readonly string[]): string[] {
    const parts = [...originalParts];

    // Iterate through the list using indices to safely modify it while iterating
    for (let i = 0; i < parts.length; i++) {
      const element = parts[i]!;

      if (element.includes('-')) {
        const splitWords = StringSplit(element, '-');

        // Remove the original element
        parts.splice(i, 1);

        // Insert the split parts back into the list at the current position
        // Insert in reverse order to maintain the original order after insertion
        for (let j = splitWords.length - 1; j >= 0; j--) {
          parts.splice(i, 0, splitWords[j]!);
        }

        // Adjust the index to account for the newly inserted elements
        // Subtracting 1 because the loop increment will add 1 back
        i += splitWords.length - 1;
      }
    }
    return parts;
  }

  private indexOfInfixS(parts: readonly string[]): number[] {
    const indexList: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      if ('s' === parts[i]) {
        indexList.push(i);
      }
    }
    return indexList;
  }

  private needsInfixS(word: string): boolean {
    // check for cases like Rivalität, Freiheit, Expedition...
    if (P().INFIX_S_SUFFIXES.matcher(word).matches() &&
        // make sure the POS tag is correct to avoid cases like "Jungs"
        this.getTagger().tag([word]).some((k) => k.hasPosTagStartingWith('SUB:NOM:SIN:FEM'))) {
      return true;
    }
    return this.wordsNeedingInfixS.has(word);
  }

  private needsToBePlural(lemma: string): boolean {
    if (P().NEEDS_TO_BE_PLURAL.matcher(lemma).matches()) {
      return true;
    }
    if (this.getTagger().tag([uppercaseFirstChar(lemma)]).some((k) => k.hasPosTagStartingWith('SUB:NOM:SIN:FE'))
    && lemma.endsWith('e')
    && !P().SUBNOMPLUFEM_EXCEPTIONS.matcher(lemma).matches()) {
      return true;
    }
    if (P().PERSON_SUFFIXES.matcher(lemma).matches()) {
      return true;
    }
    return false;
  }

  private isNounNom(word: string): boolean {
    return this.getTagger().tag([word]).some((k) => k.hasPosTagStartingWith('SUB:NOM'));
  }

  private isNounNomSin(word: string): boolean {
    return this.getTagger().tag([word]).some((k) => k.hasPosTagStartingWith('SUB:NOM:SIN'));
  }

  private isNounNomPlu(word: string): boolean {
    return this.getTagger().tag([word]).some((k) => k.hasPosTagStartingWith('SUB:NOM:PLU'));
  }

  private isCountryOrRegionNomSin(word: string): boolean {
    return  this.getTagger().tag([word]).some((k) => k.matchesPosTagRegex('EIG:NOM:SIN.+(COU|GEB|STD|WAT)'));
  }

  private isOtherPrefix(word: string): boolean {
    return otherPrefixes.has(lowercaseFirstChar(word));
  }

  private isVerbPrefix(word: string): boolean {
    return verbPrefixes.has(lowercaseFirstChar(word));
  }

  private isVerbStem(word: string): boolean {
    return verbStems.has(lowercaseFirstChar(word));
  }



  protected override getAdditionalTopSuggestions(suggestions: readonly SuggestedReplacement[], word: string): SuggestedReplacement[] {
    const suggestionsList = suggestions.map((s) => s.getReplacement());
    return SuggestedReplacement.convert(this.getAdditionalTopSuggestionsString(suggestionsList, word));
  }

  private getAdditionalTopSuggestionsString(suggestions: readonly string[], word: string): string[] {
    let suggestion: string;
    if (StringEqualsIgnoreCase("WIFI", word)) {
      return ["Wi-Fi"];
    } else if (StringEqualsIgnoreCase("W-Lan", word)) {
      return ["WLAN"];
    } else if ("Endstadion" === word) {
      return ["Endstadium"];
    } else if ("Endstadions" === word) {
      return ["Endstadiums"];
    } else if ("genomen" === word) {
      return ["genommen"];
    } else if ("Preis-Leistungsverhältnis" === word) {
      return ["Preis-Leistungs-Verhältnis"];
    } else if ("getz" === word) {
      return ["jetzt", "geht's"];
    } else if ("Trons" === word) {
      return ["Trance"];
    } else if ("ei" === word) {
      return ["ein"];
    } else if ("jo" === word || "jepp" === word || "jopp" === word) {
      return ["ja"];
    } else if ("Jo" === word || "Jepp" === word || "Jopp" === word) {
      return ["Ja"];
    } else if ("Ne" === word) {
      // "Ne einfach Frage!"
      // "Ne, das musst du machen!"
      return ["Nein", "Eine"];
    } else if ("is" === word) {
      return ["ist"];
    } else if ("Is" === word) {
      return ["Ist"];
    } else if ("un" === word) {
      return ["und"];
    } else if ("Un" === word) {
      return ["Und"];
    } else if ("Std" === word) {
      return ["Std."];
    } else if (P().ENDS_WITH_IBELKEIT_IBLICHKEIT.matcher(word).matches()) {
      suggestion = StringReplaceFirst(word, "el[hk]eit$", "ilität");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.endsWith("aquise")) {
      suggestion = StringReplaceFirst(word, "aquise$", "akquise");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.endsWith("standart")) {
      suggestion = StringReplaceFirst(word, "standart$", "standard");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.endsWith("standarts")) {
      suggestion = StringReplaceFirst(word, "standarts$", "standards");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.endsWith("tips")) {
      suggestion = StringReplaceFirst(word, "tips$", "tipps");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.endsWith("tip")) {
      suggestion = word + "p";
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.endsWith("entfehlung")) {
      suggestion = replaceOnce(word, "ent", "emp");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.endsWith("oullie")) {
      suggestion = StringReplaceFirst(word, "oullie$", "ouille");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.startsWith("Bundstift")) {
      suggestion = StringReplaceFirst(word, "^Bundstift", "Buntstift");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (P().ALLMAHLLIG.matcher(word).matches()) {
      suggestion = StringReplaceFirst(word, "llmähll?i(g|ch)", "llmählich");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (P().CONTAINS_MAYONNAISE.matcher(word).matches() )  {
      suggestion = StringReplaceFirst(word, "a[jy]onn?[äe]se", "ayonnaise");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (P().CONTAINS_RESERVIERUNG.matcher(word).matches())  {
      suggestion = StringReplaceFirst(word, "es(a|er)[vw]i[he]?rung", "eservierung");
      if (this.hunspell!.spell(suggestion)) { // suggest e.g. 'Ticketreservierung', but not 'Blödsinnsquatschreservierung'
        return [suggestion];
      }
    } else if (P().STARTS_WITH_RESCHASCHIER.matcher(word).matches()) {
      suggestion = replaceOnce(word, "schaschier", "cherchier");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (P().ENDS_WITH_LABORANTS.matcher(word).matches()) {
      suggestion = StringReplaceFirst(word, "ts$", "ten");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (P().PROFESSIONELL.matcher(word).matches()) {
      suggestion = StringReplaceFirst(word, "roff?ess?ion([äe])h?l{1,2}", "rofessionell");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (P().VERSTANDNIS.matcher(word).matches()) {
      suggestion = StringReplaceFirst(word, "[vV]erstehendnis", "Verständnis");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.startsWith("koregier")) {
      suggestion = word.replaceAll("reg", "rrig");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (P().STARTS_WITH_DIAGNOSZIER.matcher(word).matches()) {
      suggestion = StringReplaceAll(word, "gno[sz]ier", "gnostizier");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.includes("eiss")) {
      suggestion = word.replaceAll("eiss", "eiß");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.includes("Akkupressur")) {
      suggestion = word.replaceAll("Akkupressur", "Akupressur");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.includes("farbend")) { //steinfarbenden, schwarzfarbenden, kupferfarbenden etc.
      suggestion = word.replaceAll("farbend", "farben");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word.includes("uess")) {
      suggestion = word.replaceAll("uess", "üß");
      if (this.hunspell!.spell(suggestion)) {
        return [suggestion];
      }
    } else if (word === "gin") {
      return ["ging"];
    } else if (word === "dh" || word === "dh.") {
      return ["d.\u202fh."];
    } else if (word === "ua" || word === "ua.") {
      return ["u.\u202fa."];
    } else if (P().ZB.matcher(word).matches() || P().STARTS_WITH_ZB.matcher(word).matches() )  {
      return ["z.\u202fB."];
    } else if (word === "uvm" || word === "uvm.") {
      return ["u.\u202fv.\u202fm."];
    } else if (word === "udgl" || word === "udgl.") {
      return ["u.\u202fdgl."];
    } else if (word === "Ruhigkeit") {
      return ["Ruhe"];
    } else if (word === "angepreist") {
      return ["angepriesen"];
    } else if (word === "halo") {
      return ["hallo"];
    } else if (StringEqualsIgnoreCase(word, "zumindestens")) {
      return [word.replaceAll("ens", "")];
    } else if (word === "ca") {
      return ["ca."];
    } else if (word === "Jezt") {
      return ["Jetzt"];
    } else if (word === "Wollst") {
      return ["Wolltest"];
    } else if (word === "wollst") {
      return ["wolltest"];
    } else if (word === "Rolladen") {
      return ["Rollladen"];
    } else if (word === "Maßname") {
      return ["Maßnahme"];
    } else if (word === "Maßnamen") {
      return ["Maßnahmen"];
    } else if (word === "nanten") {
      return ["nannten"];
    } else if (word === "diees") {
      return ["dieses", "dies"];
    } else if (word === "Diees") {
      return ["Dieses", "Dies"];
    } else if (word.endsWith("ies")) {
      if (word === "Lobbies") {
        return ["Lobbys"];
      } else if (word === "Parties") {
        return ["Partys"];
      } else if (word === "Babies") {
        return ["Babys"];
      } else if (word.endsWith("derbies")) {
        suggestion = StringReplaceFirst(word, "derbies$", "derbys");
        if (this.hunspell!.spell(suggestion)) {
          return [suggestion];
        }
      } else if (word.endsWith("stories")) {
        suggestion = StringReplaceFirst(word, "stories$", "storys");
        if (this.hunspell!.spell(suggestion)) {
          return [suggestion];
        }
      } else if (word.endsWith("parties")) {
        suggestion = StringReplaceFirst(word, "parties$", "partys");
        if (this.hunspell!.spell(suggestion)) {
          return [suggestion];
        }
      }
    } else if (word === "Hallochen") {
      return ["Hallöchen", "hallöchen"];
    } else if (word === "hallochen") {
      return ["hallöchen"];
    } else if (word === "ok") {
      return ["okay", "O.\u202fK."]; // Duden-like suggestion with no-break space
    } else if (word === "gesuchen") {
      return ["gesuchten", "gesucht"];
    } else if (word === "Germanistiker") {
      return ["Germanist", "Germanisten"];
    } else if (word === "Abschlepper") {
      return ["Abschleppdienst", "Abschleppwagen"];
    } else if (word === "par") {
      return ["paar"];
    } else if (word === "iwie") {
      return ["irgendwie"];
    } else if (word === "schwarzfarbenden") {
      return ["schwarzfarbenen"];
    } else if (word === "bzgl") {
      return ["bzgl."];
    } else if (word === "bau") {
      return ["baue"];
    } else if (word === "sry") {
      return ["sorry"];
    } else if (word === "Sry") {
      return ["Sorry"];
    } else if (word === "thx") {
      return ["danke"];
    } else if (word === "Thx") {
      return ["Danke"];
    } else if (word === "Zynik") {
      return ["Zynismus"];
    } else if (word === "pieksen") {
      return ["piksen"];
    } else if (word === "piekst") {
      return ["pikst"];
    } else if (word === "gepiekst") {
      return ["gepikst"];
    } else if (StringEqualsIgnoreCase(word, "email")) {
      return ["E-Mail"];
    } else if (word.length > 9 && word.startsWith("Email")) {
      let suffix = word.substring(5);
      if (!this.hunspell!.spell(suffix)) {
        const suffixSuggestions = this.hunspell!.suggest(uppercaseFirstChar(suffix));
        suffix = suffixSuggestions.length === 0 ? suffix : suffixSuggestions[0]!;
      }
      return ["E-Mail-"+Character.toUpperCase(suffix.charAt(0))+suffix.substring(1)];
    } else if (word === "wiederspiegeln") {
      return ["widerspiegeln"];
    } else if (word === "ch") {
      return ["ich"];

    } else {
      for (const [key, value] of ADDITIONAL_SUGGESTIONS) {
        if (key.matches(word)) {
          return value(word);
        }
      }
    }
    if (!startsWithUppercase(word)) {
      const ucWord = uppercaseFirstChar(word);
      if (!suggestions.includes(ucWord) && this.hunspell!.spell(ucWord) && !ucWord.endsWith('.')) {
        // Hunspell doesn't always automatically offer the most obvious suggestion for compounds:
        return [ucWord];
      }
    }
    const verbSuggestion = this.getPastTenseVerbSuggestion(word);
    if (verbSuggestion != null) {
      return [verbSuggestion];
    }
    const participleSuggestion = this.getParticipleSuggestion(word);
    if (participleSuggestion != null) {
      return [participleSuggestion];
    }
    const abbreviationSuggestion = this.getAbbreviationSuggestion(word);
    if (abbreviationSuggestion != null) {
      return [abbreviationSuggestion];
    }
    // hyphenated compounds words (e.g., "Netflix-Flm")
    if (suggestions.length === 0 && word.includes('-')) {
      const words = StringSplit(word, '-');
      if (words.length > 1) {
        const suggestionLists: string[][] = [];
        let startAt = 0;
        let stopAt = words.length;
        let partialWord = words[0] + '-' + words[1];
        if (super.ignoreWord(partialWord) || this.wordsToBeIgnoredInCompounds.has(partialWord)) { // "Au-pair-Agentr"
          startAt = 2;
          suggestionLists.push([words[0] + '-' + words[1]]);
        }
        partialWord = words[words.length - 2] + '-' + words[words.length - 1];
        if (super.ignoreWord(partialWord) || this.wordsToBeIgnoredInCompounds.has(partialWord)) { // "Seniren-Au-pair"
          stopAt = words.length - 2;
        }
        for (let idx = startAt; idx < stopAt; idx++) {
          if (!this.hunspell!.spell(words[idx]!)) {
            const list = this.sortSuggestionByQuality(words[idx]!, super.getSuggestions(words[idx]!));
            suggestionLists.push(list);
          } else {
            suggestionLists.push([words[idx]!]);
          }
        }
        if (stopAt < words.length - 1) {
          suggestionLists.push([partialWord]);
        }
        if (suggestionLists.length <= 3) {  // avoid OutOfMemory on words like "free-and-open-source-and-cross-platform"
          let additionalSuggestions = suggestionLists[0]!;
          for (let idx = 1; idx < suggestionLists.length; idx++) {
            const suggestionList = suggestionLists[idx]!;
            const newList: string[] = [];
            for (const additionalSuggestion of additionalSuggestions) {
              for (const aSuggestionList of suggestionList) {
                newList.push(additionalSuggestion + '-' + aSuggestionList);
              }
            }
            additionalSuggestions = newList;
          }
          // avoid overly long lists of suggestions (we just take the first results, although we don't know whether they are better):
          return additionalSuggestions.slice(0, Math.min(5, additionalSuggestions.length));
        }
      }
    }
    return [];
  }

  // Get a correct suggestion for invalid words like greifte, denkte, gehte: useful for
  // non-native speakers and cannot be found by just looking for similar words.
  private getPastTenseVerbSuggestion(word: string): string | null {
    if (word.endsWith('e')) {
      // strip trailing "e"
      const wordStem = word.substring(0, word.length - 1);
      const lemma = this.baseForThirdPersonSingularVerb(wordStem);
      if (lemma != null) {
        const token = new AnalyzedToken(lemma, null, lemma);
        const forms = this.synthesizer.synthesize(token, 'VER:3:SIN:PRT:.*', true);
        if (forms.length > 0) {
          return forms[0]!;
        }
      }
    }
    return null;
  }

  private baseForThirdPersonSingularVerb(word: string): string | null {
    const readings = this.getTagger().tag([word]);
    for (const reading of readings) {
      if (reading.hasPosTagStartingWith('VER:3:SIN')) {
        return reading.getReadings()[0]!.getLemma();
      }
    }
    return null;
  }

  // Get a correct suggestion for invalid words like geschwimmt, geruft: useful for
  // non-native speakers and cannot be found by just looking for similar words.
  private getParticipleSuggestion(word: string): string | null {
    if (word.startsWith('ge') && word.endsWith('t')) {
      // strip leading "ge" and replace trailing "t" with "en":
      const baseform = word.substring(2, word.length - 1) + 'en';
      const participle = this.getParticipleForBaseform(baseform);
      if (participle != null) {
        return participle;
      }
    }
    return null;
  }

  private getParticipleForBaseform(baseform: string): string | null {
    const token = new AnalyzedToken(baseform, null, baseform);
    const forms = this.synthesizer.synthesize(token, 'VER:PA2:.*', true);
    if (forms.length > 0 && this.hunspell!.spell(forms[0]!)) {
      return forms[0]!;
    }
    return null;
  }

  private getAbbreviationSuggestion(word: string): string | null {
    if (word.length < 5) {
      const readings = this.getTagger().tag([word]);
      for (const reading of readings) {
        if (reading.hasPosTagStartingWith('ABK')) {
          return word + '.';
        }
      }
    }
    return null;
  }

  private ignoreByHangingHyphen(words: readonly string[], idx: number): boolean {
    let word = words[idx]!;
    let nextWord = this.getWordAfterEnumerationOrNull(words, idx + 1);
    nextWord = removeEnd(nextWord, '.');
    const isCompound = nextWord != null &&
      (this.compoundTokenizer.tokenize(nextWord).length > 1 ||
       nextWord.indexOf('-') > 0 ||
        P().SPECIAL_CASE_THIRD.matcher(nextWord).matches());  // compound tokenizer will only split compounds where each part is >= 3 characters...
    if (isCompound) {
      word = removeEnd(word, '-')!;
      let isMisspelled = !this.hunspell!.spell(word);  // "Stil- und Grammatikprüfung" or "Stil-, Text- und Grammatikprüfung"
      if (isMisspelled && (super.ignoreWord(word) || this.wordsToBeIgnoredInCompounds.has(word))) {
        isMisspelled = false;
      } else if (isMisspelled && word.endsWith('s') && this.isNeedingFugenS(removeEnd(word, 's')!)) {
        // Vertuschungs- und Bespitzelungsmaßnahmen: remove trailing "s" before checking "Vertuschungs" so that the spell checker finds it
        isMisspelled = !this.hunspell!.spell(removeEnd(word, 's')!);
      }
      return !isMisspelled;
    }
    return false;
  }

  private isNeedingFugenS(word: string): boolean {
    // according to http://www.spiegel.de/kultur/zwiebelfisch/zwiebelfisch-der-gebrauch-des-fugen-s-im-ueberblick-a-293195.html
    return endsWithAny(word, 'tum', 'ling', 'ion', 'tät', 'keit', 'schaft', 'sicht', 'ung', 'en');
  }

  // for "Stil- und Grammatikprüfung", get "Grammatikprüfung" when at position of "Stil-"
  private getWordAfterEnumerationOrNull(words: readonly string[], idx: number): string | null {
    for (let i = idx; i < words.length; i++) {
      const word = words[i]!;
      if (!(word.endsWith('-') || equalsAny(word, ',', '/', '&', 'und', 'oder', 'bzw.', 'beziehungsweise', 'sowie', 'statt') || StringTrim(word).length === 0)) {
        return word;
      }
    }
    return null;
  }

  // check whether a <code>word<code> is a valid compound (e.g., "Feynmandiagramm" or "Feynman-Diagramm")
  // that contains an ignored word from spelling.txt (e.g., "Feynman")
  private ignoreCompoundWithIgnoredWord(word: string): boolean {
    if (!startsWithUppercase(word) && !startsWithAny(word, 'nord', 'west', 'ost', 'süd')) {
      // otherwise stuff like "rumfangreichen" gets accepted
      return false;
    }
    const words = StringSplit(word, '-');
    if (words.length < 2) {
      // non-hyphenated compound (e.g., "Feynmandiagramm"):
      // only search for compounds that start(!) with a word from spelling.txt
      let end = super.startsWithIgnoredWord(word, true);
      if (end < 3) {
        // support for geographical adjectives - although "süd/ost/west/nord" are not in spelling.txt
        // to accept sentences such as
        // "Der westperuanische Ferienort, das ostargentinische Städtchen, das südukrainische Brauchtum, der nordägyptische Staudamm."
        if (word.startsWith('ost') || word.startsWith('süd')) {
          end = 3;
        } else if (word.startsWith('west') || word.startsWith('nord')) {
          end = 4;
        } else {
          return false;
        }
      }
      const ignoredWord = word.substring(0, end);
      let partialWord = word.substring(end);
      partialWord = partialWord.endsWith('.') ? partialWord.substring(0, partialWord.length - 1) : partialWord;
      const isNoun = this.isNoun(partialWord);
      let isUppercaseNoun = false;
      if (!isNoun && !startsWithUppercase(partialWord)) {
        isUppercaseNoun = this.isNoun(uppercaseFirstChar(partialWord));
      }
      const isDirection = P().DIRECTION.matcher(ignoredWord).matches();
      const isAdjective = this.isAdjective(ignoredWord);
      const isDirectionalAdjective = (isDirection && (isAdjective || StringMatches(partialWord, '.+ische?[mnrs]?')));
      const isCandidateForNonHyphenatedCompound = (isDirectionalAdjective || isNoun || isUppercaseNoun) && !isAllUpperCaseCommons(ignoredWord) && (isAllLowerCaseCommons(partialWord) || ignoredWord.endsWith('-'));
      const needFugenS = this.isNeedingFugenS(ignoredWord);
      if (isCandidateForNonHyphenatedCompound && !needFugenS && partialWord.length > 2) {
        return this.hunspell!.spell(partialWord) || this.hunspell!.spell(capitalize(partialWord));
      } else if (isCandidateForNonHyphenatedCompound && needFugenS && partialWord.length > 2) {
        partialWord = partialWord.startsWith('s') ? partialWord.substring(1) : partialWord;
        return this.hunspell!.spell(partialWord) || this.hunspell!.spell(capitalize(partialWord));
      }
      return false;
    }
    // hyphenated compound (e.g., "Feynman-Diagramm"):
    let hasIgnoredWord = false;
    const toSpellCheck: string[] = [];
    const stripFirst = word.substring(words[0]!.length + 1); // everything after the first "-"
    const stripLast  = word.substring(0, word.length - words[words.length - 1]!.length - 1); // everything up to the last "-"

    if (super.ignoreWord(stripFirst) || this.wordsToBeIgnoredInCompounds.has(stripFirst)) { // e.g., "Senioren-Au-pair"
      hasIgnoredWord = true;
      if (!super.ignoreWord(words[0]!)) {
        toSpellCheck.push(words[0]!);
      }
    } else if (super.ignoreWord(stripLast) || this.wordsToBeIgnoredInCompounds.has(stripLast)) { // e.g., "Au-pair-Agentur"
      hasIgnoredWord = true;
      if (!super.ignoreWord(words[words.length - 1]!)){
        toSpellCheck.push(words[words.length - 1]!);
      }
    } else {
      for (const word1 of words) {
        if (super.ignoreWord(word1) || this.wordsToBeIgnoredInCompounds.has(word1)) {
          hasIgnoredWord = true;
        } else {
          toSpellCheck.push(word1);
        }
      }
    }

    if (hasIgnoredWord) {
      for (const w of toSpellCheck) {
        if (!this.hunspell!.spell(w)) {
          return false;
        }
      }
    }
    return hasIgnoredWord;
  }

  private getTagger(): Tagger {
    return this.language.getTagger();
  }

  protected override isQuotedCompound(analyzedSentence: AnalyzedSentence, idx: number, token: string): boolean {
    if (idx > 3 && token.startsWith('-')) {
      return equalsAny(analyzedSentence.getTokens()[idx - 1]!.getToken(), '“', '"') &&
          equalsAny(analyzedSentence.getTokens()[idx - 3]!.getToken(), '„', '"');
    }
    return false;
  }

  /* (non-Javadoc)
   * @see org.languagetool.rules.spelling.SpellingCheckRule#addProhibitedWords(java.util.List)
   */
  protected override addProhibitedWords(words: readonly string[]): void {
    if (words.length === 1 && words[0]!.endsWith('.*')) {
      this.wordStartsToBeProhibited.add(words[0]!.substring(0, words[0]!.length - 2));
    } else if (words[0]!.startsWith('.*')) {
      words.forEach((word) => this.wordEndingsToBeProhibited.add(word.substring(2)));
    } else {
      super.addProhibitedWords(words);
    }
  }

  protected override filterNoSuggestWords(l: SuggestedReplacement[]): SuggestedReplacement[] {
    return l
      .filter((k) => !lcDoNotSuggestWords.has(k.getReplacement().toLowerCase()))
      .filter((k) => !P().START_WITH_NEGER.matcher(k.getReplacement().toLowerCase()).matches())
      .filter((k) => !P().CONTAINS_NEGER.matcher(k.getReplacement().toLowerCase()).matches())
      .filter((k) => !P().CONTAINS_NEGER_2.matcher(k.getReplacement().toLowerCase()).matches())
      .filter((k) => !P().CONTAINS_UNCOMMON_LOWERCASED_NOUN_AT_END.matcher(k.getReplacement()).matches())
      .filter((k) => !P().CONTAINS_UNCOMMON_LOWERCASED_NOUN_AT_BEGINNING.matcher(k.getReplacement()).matches());
  }

  protected override getOnlySuggestions(word: string): SuggestedReplacement[] {
    if (P().SYMPHATISCH.matcher(word).matches()) {
      return topMatch(replaceOnce(word,"symphatisch", "sympathisch"));
    }
    if (P().AUTENTISCH_WITH_CASES.matcher(word).matches()) {
      return topMatch(replaceOnce(word,"utent", "uthent"));
    }
    if (P().BRILLIANT_WITH_CASES.matcher(word).matches()) {
      return topMatch(replaceOnce(word,"brilliant", "brillant"));
    }
    if (P().RECHTMASIG_WITH_CASES.matcher(word).matches()) {
      return topMatch(replaceOnce(word,"mässig", "mäßig"));
    }
    if (P().CONTAINS_MASZNAME.matcher(word).matches()) {
      return topMatch(StringReplaceFirst(word, "a(ss|ß)name", "aßnahme"));
    }
    if (P().HOLZ_SPIEGEL_PANEL_COMPOUND.matcher(word).matches()){
      return topMatch(replaceOnce(word,"panel", "paneel"));
    }
    if (P().SBHAN_PREFIX.matcher(word).matches()) {
      return topMatch(replaceOnce(word,"SBahn", "S-Bahn"));
    }
    if (P().UBAHN_PREFIX.matcher(word).matches()) {
      return topMatch(replaceOnce(word,"UBahn", "U-Bahn"));
    }
    switch (word) {
      case "Büffet":
      case "Buffett":
      case "Bufett":
      case "Büffett":
      case "Bufet":
      case "Büfet":
        if (this.language.getShortCodeWithCountryAndVariant() === "de-CH" || this.language.getShortCodeWithCountryAndVariant() === "de-AT") {
          return topMatch("Buffet", "zum Verzehr bereitgestellte Speisen");
        } else {
          return topMatch("Büfett", "zum Verzehr bereitgestellte Speisen");
        }
      case "do": return topMatch("so");
      case "Akkupressur": return topMatch("Akupressur");
      case "EmailleOfen": return topMatch("Emailleofen");
      case "Mazeltov": return topMatch("Masel tov");
      case "Mazel tov": return topMatch("Masel tov");
      case "Weisglut": return topMatch("Weißglut");
      case "SuperGAU": return topMatch("Super-GAU");
      case "SuperGau": return topMatch("Super-Gau");
      case "Besenstil": return topMatch("Besenstiel");
      case "Vorbescheidverfahren": return topMatch("Vorbescheidsverfahren");
      case "Türahmen": return topMatch("Türrahmen");
      case "Unglückzahl": return topMatch("Unglückszahl");
      case "Unglückzahlen": return topMatch("Unglückszahlen");
      case "Anstossbreite": return topMatch("Anstoßbreite");
      case "Elfmeterschiessen": return topMatch("Elfmeterschießen");
      case "Feldschiessen": return topMatch("Feldschießen");
      case "Flössgräben": return topMatch("Flößgräben");
      case "Schiessen": return topMatch("Schießen");
      case "Gasterra": return topMatch("GasTerra");
      case "Gasterras": return topMatch("GasTerras");
      case "Bestwater": return topMatch("BestWater");
      case "Bestwaters": return topMatch("BestWaters");
      case "Außländer": return topMatch("Ausländer");
      case "Außländern": return topMatch("Ausländern");
      case "Außländers": return topMatch("Ausländers");
      case "Außländerin": return topMatch("Ausländerin");
      case "Außländerinnen": return topMatch("Ausländerinnen");
      case "Wehrwolf": return topMatch("Werwolf");
      case "Wehrwolfs": return topMatch("Werwolfs");
      case "Wehrwölfe": return topMatch("Werwölfe");
      case "Wehrwölfen": return topMatch("Werwölfen");
      case "Art-Nr": return topMatch("Art.-Nr.");
      case "werrden": return topMatch("werden");
      case "erkäre": return topMatch("erkläre");
      case "Blackweek": return topMatch("Black Week");
      case "Blackfriday": return topMatch("Black Friday");
      case "Blackweeks": return topMatch("Black Weeks");
      case "Blackfridays": return topMatch("Black Fridays");
      case "Au-Pair": return topMatch("Au-pair");
      case "Au-Pairs": return topMatch("Au-pairs");
      case "deluxe": return topMatch("de luxe");
      case "Deluxe": return topMatch("de luxe");
      case "Design-Op": return topMatch("Design-OP");
      case "AppStore": return topMatch("App Store");
      case "AppStores": return topMatch("App Stores");
      case "AppleStore": return topMatch("Apple Store");
      case "AppleStores": return topMatch("Apple Stores");
      case "AirFrance": return topMatch("Air France");
      case "Wiederspruch": return topMatch("Widerspruch");
      case "Wiederspruchs": return topMatch("Widerspruchs");
      case "Wiedersprüche": return topMatch("Widersprüche");
      case "Wiedersprüchen": return topMatch("Widersprüchen");
      case "Vorraussetzung": return topMatch("Voraussetzung");
      case "Vorraussetzungen": return topMatch("Voraussetzungen");
      case "Schalosie": return topMatch("Jalousie", "bewegliche Lamellen zum Sicht- und Sonnenschutz");
      case "Schalosien": return topMatch("Jalousien", "bewegliche Lamellen zum Sicht- und Sonnenschutz");
      case "offensichtlicherweise": return topMatch("offensichtlich");
      case "Offensichtlicherweise": return topMatch("Offensichtlich");
      case "wohlwissend": return topMatch("wohl wissend");
      case "Visas": return topMatch("Visa", "Plural von 'Visum'");
      case "Interresse": return topMatch("Interesse");
      case "Interressen": return topMatch("Interessen");
      case "Terasse": return topMatch("Terrasse");
      case "Terassen": return topMatch("Terrassen");
      case "Reisverschluss": return topMatch("Reißverschluss");
      case "Reisverschlusses": return topMatch("Reißverschlusses");
      case "Reiszwecke": return topMatch("Reißzwecke", "kurzer Nagel mit flachem Kopf");
      case "Reiszwecken": return topMatch("Reißzwecken", "kurzer Nagel mit flachem Kopf");
      case "up-to-date": return topMatch("up to date");
      case "falscherweise": return topMatch("fälschlicherweise");
      case "schliesslich": return topMatch("schließlich");
      case "Schliesslich": return topMatch("Schließlich");
      case "daß": return topMatch("dass");
      case "Daß": return topMatch("Dass");
      case "mußt": return topMatch("musst");
      case "Mußt": return topMatch("Musst");
      case "müßt": return topMatch("müsst");
      case "Müßt": return topMatch("Müsst");
      case "heisst": return topMatch("heißt");
      case "Heisst": return topMatch("Heißt");
      case "heisse": return topMatch("heiße");
      case "heissen": return topMatch("heißen");
      case "beisst": return topMatch("beißt");
      case "beissen": return topMatch("beißen");
      case "mußten": return topMatch("mussten");
      case "mußte": return topMatch("musste");
      case "mußtest": return topMatch("musstest");
      case "müßtest": return topMatch("müsstest");
      case "müßen": return topMatch("müssen");
      case "müßten": return topMatch("müssten");
      case "müßte": return topMatch("müsste");
      case "wußte": return topMatch("wusste");
      case "wußten": return topMatch("wussten");
      case "wüßte": return topMatch("wüsste");
      case "wüßten": return topMatch("wüssten");
      case "bescheid": return topMatch("Bescheid");
      case "Facetime": return topMatch("FaceTime");
      case "Facetimes": return topMatch("FaceTimes");
      case "ausversehen": return topMatch("aus Versehen");
      case "Stückweit": return topMatch("Stück weit");
      case "Uranium": return topMatch("Uran");
      case "Uraniums": return topMatch("Urans");
      case "Luxenburg": return topMatch("Luxemburg");
      case "Luxenburgs": return topMatch("Luxemburgs");
      case "Lichtenstein": return topMatch("Liechtenstein");
      case "Lichtensteins": return topMatch("Liechtensteins");
      case "immernoch": return topMatch("immer noch");
      case "Rechtshcreibfehler": return topMatch("Rechtschreibfehler"); // for demo text on home page
      case "markirt": return topMatch("markiert"); // for demo text on home page
      case "Johannesbeere": return topMatch("Johannisbeere");
      case "Johannesbeeren": return topMatch("Johannisbeeren");
      case "Endgeld": return topMatch("Entgeld");
      case "Entäuschung": return topMatch("Enttäuschung");
      case "Entäuschungen": return topMatch("Enttäuschungen");
      case "Triologie": return topMatch("Trilogie", "Werk (z.B. Film), das aus drei Teilen besteht");
      case "ausserdem": return topMatch("außerdem");
      case "Ausserdem": return topMatch("Außerdem");
      case "ausser": return topMatch("außer");
      case "Ausser": return topMatch("Außer");
      case "bischen": return topMatch("bisschen");
      case "bißchen": return topMatch("bisschen");
      case "meißt": return topMatch("meist");
      case "meißten": return topMatch("meisten");
      case "meißtens": return topMatch("meistens");
      case "Babyphone": return topMatch("Babyfon");
      case "Baby-Phone": return topMatch("Babyfon");
      case "gescheint": return topMatch("geschienen");
      case "staubgesaugt": return topMatch("gestaubsaugt");
      case "geupdated": return topMatch("upgedatet");
      case "geupdatet": return topMatch("upgedatet");
      case "gedownloaded": return topMatch("downgeloadet");
      case "gedownloadet": return topMatch("downgeloadet");
      case "gedownloadete": return topMatch("downgeloadete");
      case "gedownloadeter": return topMatch("downgeloadeter");
      case "gedownloadetes": return topMatch("downgeloadetes");
      case "gedownloadeten": return topMatch("downgeloadeten");
      case "gedownloadetem": return topMatch("downgeloadetem");
      case "geuploaded": return topMatch("upgeloadet");
      case "geuploadet": return topMatch("upgeloadet");
      case "geuploadete": return topMatch("upgeloadete");
      case "geuploadeter": return topMatch("upgeloadeter");
      case "geuploadetes": return topMatch("upgeloadetes");
      case "geuploadeten": return topMatch("upgeloadeten");
      case "geuploadetem": return topMatch("upgeloadetem");
      case "Frauenhofer": return topMatch("Fraunhofer");
      case "hörensagen": return topMatch("Hörensagen");
      case "Mwst": return topMatch("MwSt");
      case "MwSt": return topMatch("MwSt.");
      case "MWST": return topMatch("MwSt.");
      case "exkl": return topMatch("exkl.");
      case "inkl": return topMatch("inkl.");
      case "hälst": return topMatch("hältst");
      case "Rythmus": return topMatch("Rhythmus");
      case "Rhytmus": return topMatch("Rhythmus");
      case "Rhytmen": return topMatch("Rhythmen");
      case "Hobbies": return topMatch("Hobbys");
      case "Stehgreif": return topMatch("Stegreif");
      case "brilliant": return topMatch("brillant");
      case "brilliante": return topMatch("brillante");
      case "brilliantes": return topMatch("brillantes");
      case "brillianter": return topMatch("brillanter");
      case "brillianten": return topMatch("brillanten");
      case "brilliantem": return topMatch("brillantem");
      case "Billiard": return topMatch("Billard");
      case "garnicht": return topMatch("gar nicht");
      case "garnich": return topMatch("gar nicht");
      case "garnichts": return topMatch("gar nichts");
      case "assozial": return topMatch("asozial");
      case "assoziale": return topMatch("asoziale");
      case "assoziales": return topMatch("asoziales");
      case "assozialer": return topMatch("asozialer");
      case "assozialen": return topMatch("asozialen");
      case "assozialem": return topMatch("asozialem");
      case "Verwandschaft": return topMatch("Verwandtschaft");
      case "vorraus": return topMatch("voraus");
      case "Vorraus": return topMatch("Voraus");
      case "Reperatur": return topMatch("Reparatur");
      case "Reperaturen": return topMatch("Reparaturen");
      case "Bzgl": return topMatch("Bzgl.");
      case "bzgl": return topMatch("bzgl.");
      case "Eigtl": return topMatch("Eigtl.");
      case "eigtl": return topMatch("eigtl.");
      case "Mo-Di": return topMatch("Mo.–Di.");
      case "Mo-Mi": return topMatch("Mo.–Mi.");
      case "Mo-Do": return topMatch("Mo.–Do.");
      case "Mo-Fr": return topMatch("Mo.–Fr.");
      case "Mo-Sa": return topMatch("Mo.–Sa.");
      case "Mo-So": return topMatch("Mo.–So.");
      case "Di-Mi": return topMatch("Di.–Mi.");
      case "Di-Do": return topMatch("Di.–Do.");
      case "Di-Fr": return topMatch("Di.–Fr.");
      case "Di-Sa": return topMatch("Di.–Sa.");
      case "Di-So": return topMatch("Di.–So.");
      case "Mi-Do": return topMatch("Mi.–Do.");
      case "Mi-Fr": return topMatch("Mi.–Fr.");
      case "Mi-Sa": return topMatch("Mi.–Sa.");
      case "Mi-So": return topMatch("Mi.–So.");
      case "Do-Fr": return topMatch("Do.–Fr.");
      case "Do-Sa": return topMatch("Do.–Sa.");
      case "Do-So": return topMatch("Do.–So.");
      case "Fr-Sa": return topMatch("Fr.–Sa.");
      case "Fr-So": return topMatch("Fr.–So.");
      case "Sa-So": return topMatch("Sa.–So.");
      case "Achso": return topMatch("Ach so");
      case "achso": return topMatch("ach so");
      case "Huskies": return topMatch("Huskys");
      case "Jedesmal": return topMatch("Jedes Mal");
      case "jedesmal": return topMatch("jedes Mal");
      case "Lybien": return topMatch("Libyen");
      case "Lybiens": return topMatch("Libyens");
      case "Youtube": return topMatch("YouTube");
      case "Youtuber": return topMatch("YouTuber");
      case "Youtuberin": return topMatch("YouTuberin");
      case "Youtuberinnen": return topMatch("YouTuberinnen");
      case "Youtubers": return topMatch("YouTubers");
      case "Reflektion": return topMatch("Reflexion");
      case "Reflektionen": return topMatch("Reflexionen");
      case "unrelevant": return topMatch("irrelevant");
      case "inflagranti": return topMatch("in flagranti");
      case "Storie": return topMatch("Story");
      case "Stories": return topMatch("Storys");
      case "Ladies": return topMatch("Ladys");
      case "Parties": return topMatch("Partys");
      case "Lobbies": return topMatch("Lobbys");
      case "Nestle": return topMatch("Nestlé");
      case "Nestles": return topMatch("Nestlés");
      case "vollzeit": return topMatch("Vollzeit");
      case "teilzeit": return topMatch("Teilzeit");
      case "Dnake": return topMatch("Danke");
      case "Muehe": return topMatch("Mühe");
      case "Muehen": return topMatch("Mühen");
      case "Kuhdamm": return topMatch("Ku’damm");
      case "Torschusspanik": return topMatch("Torschlusspanik");
      case "ggf": return topMatch("ggf.");
      case "Ggf": return topMatch("Ggf.");
      case "zzgl": return topMatch("zzgl.");
      case "Zzgl": return topMatch("Zzgl.");
      case "aufgehangen": return topMatch("aufgehängt");
      case "Annektion": return topMatch("Annexion");
      case "Annektionen": return topMatch("Annexionen");
      case "unkonsistent": return topMatch("inkonsistent");
      case "Weißheitszahn": return topMatch("Weisheitszahn");
      case "Weissheitszahn": return topMatch("Weisheitszahn");
      case "Weißheitszahns": return topMatch("Weisheitszahns");
      case "Weissheitszahns": return topMatch("Weisheitszahns");
      case "Weißheitszähne": return topMatch("Weisheitszähne");
      case "Weissheitszähne": return topMatch("Weisheitszähne");
      case "Weißheitszähnen": return topMatch("Weisheitszähnen");
      case "Weissheitszähnen": return topMatch("Weisheitszähnen");
      case "raufschauen": return topMatch("draufschauen");
      case "raufzuschauen": return topMatch("draufzuschauen");
      case "raufgeschaut": return topMatch("draufgeschaut");
      case "raufschaue": return topMatch("draufschaue");
      case "raufschaust": return topMatch("draufschaust");
      case "raufschaut": return topMatch("draufschaut");
      case "raufschaute": return topMatch("draufschaute");
      case "raufschauten": return topMatch("draufschauten");
      case "raufgucken": return topMatch("draufgucken");
      case "raufzugucken": return topMatch("draufzugucken");
      case "raufgeguckt": return topMatch("draufgeguckt");
      case "raufgucke": return topMatch("draufgucke");
      case "raufguckst": return topMatch("draufguckst");
      case "raufguckt": return topMatch("draufguckt");
      case "raufguckte": return topMatch("draufguckte");
      case "raufguckten": return topMatch("draufguckten");
      case "raufhauen": return topMatch("draufhauen");
      case "raufzuhauen": return topMatch("draufzuhauen");
      case "raufgehaut": return topMatch("draufgehaut");
      case "raufhaue": return topMatch("draufhaue");
      case "raufhaust": return topMatch("draufhaust");
      case "raufhaut": return topMatch("draufhaut");
      case "raufhaute": return topMatch("draufhaute");
      case "raufhauten": return topMatch("draufhauten");
      case "wohlmöglich": return topMatch("womöglich");
      case "geschalten": return topMatch("geschaltet");
      case "angeschalten": return topMatch("angeschaltet");
      case "abgeschalten": return topMatch("abgeschaltet");
      case "hiess": return topMatch("hieß");
      case "Click": return topMatch("Klick");
      case "Clicks": return topMatch("Klicks");
      case "jenachdem": return topMatch("je nachdem");
      case "bsp": return topMatch("bspw");
      case "vorallem": return topMatch("vor allem");
      case "draussen": return topMatch("draußen");
      case "ürbigens": return topMatch("übrigens");
      case "Whatsapp": return topMatch("WhatsApp");
      case "kucken": return topMatch("gucken");
      case "kuckten": return topMatch("guckten");
      case "kucke": return topMatch("gucke");
      case "aelter": return topMatch("älter");
      case "äussern": return topMatch("äußern");
      case "äusserst": return topMatch("äußerst");
      case "geäussert": return topMatch("geäußert");
      case "Äusserst": return topMatch("Äußerst");
      case "Dnk": return topMatch("Dank");
      case "schleswig-holstein": return topMatch("Schleswig-Holstein");
      case "Stahlkraft": return topMatch("Strahlkraft");
      case "trümmern": return topMatch("Trümmern");
      case "gradeaus": return topMatch("geradeaus");
      case "Anschliessend": return topMatch("Anschließend");
      case "anschliessend": return topMatch("anschließend");
      case "Abschliessend": return topMatch("Abschließend");
      case "abschliessend": return topMatch("abschließend");
      case "Ruckmeldung": return topMatch("Rückmeldung");
      case "Gepaeck": return topMatch("Gepäck");
      case "Grüsse": return topMatch("Grüße");
      case "Grüssen": return topMatch("Grüßen");
      case "entgültig": return topMatch("endgültig");
      case "entgültige": return topMatch("endgültige");
      case "entgültiges": return topMatch("endgültiges");
      case "entgültiger": return topMatch("endgültiger");
      case "entgültigen": return topMatch("endgültigen");
      case "desöfteren": return topMatch("des Öfteren");
      case "desweiteren": return topMatch("des Weiteren");
      case "weitesgehend": return topMatch("weitestgehend");
      case "Tschibo": return topMatch("Tchibo");
      case "Tschibos": return topMatch("Tchibos");
      case "Tiktok": return topMatch("TikTok");
      case "Tiktoks": return topMatch("TikToks");
      case "sodaß": return topMatch("sodass");
      case "regelmässig": return topMatch("regelmäßig");
      case "Carplay": return topMatch("CarPlay");
      case "Tiktoker": return topMatch("TikToker");
      case "Tiktokerin": return topMatch("TikTokerin");
      case "Tiktokerinnen": return topMatch("TikTokerinnen");
      case "Tiktokers": return topMatch("TikTokers");
      case "Tiktokern": return topMatch("TikTokern");
      case "languagetool": return topMatch("LanguageTool");
      case "languagetools": return topMatch("LanguageTools");
      case "Languagetool": return topMatch("LanguageTool");
      case "Languagetools": return topMatch("LanguageTools");
      case "liket": return topMatch("likt");
      case "nagut": return topMatch("na gut");
      case "Nagut": return topMatch("Na gut");
      case "HAllo": return topMatch("Hallo");
      case "HEy": return topMatch("Hey");
      case "SEhr": return topMatch("Sehr");
      case "abhol": return topMatch("abhole");
      case "amazon": return topMatch("Amazon");
      case "irgendeins": return topMatch("irgendeines");
      case "Communities": return topMatch("Communitys");
      case "ansich": return topMatch("an sich");
      case "Spass": return topMatch("Spaß");
      case "garkein": return topMatch("gar kein");
      case "garkeine": return topMatch("gar keine");
      case "garkeinen": return topMatch("gar keinen");
      case "wieviel": return topMatch("wie viel");
      case "Wieviel": return topMatch("Wie viel");
      case "gets": return topMatch("gehts");
      case "Quillbot": return topMatch("QuillBot");
      case "ebensowenig": return topMatch("ebenso wenig");
      case "Wiedersehn": return topMatch("Wiedersehen");
      case "wiedersehn": return topMatch("wiedersehen");
      case "Ohje": return topMatch("Oje");
      case "ohje": return topMatch("oje");
      case "schwupps": return topMatch("schwups");
      case "Schwupps": return topMatch("Schwups");
      case "Massnahme": return topMatch("Maßnahme");
      case "Massnahmen": return topMatch("Maßnahmen");
      case "Linkedin": return topMatch("LinkedIn");
      case "Wordpress": return topMatch("WordPress");
      case "gleichzeit": return topMatch("gleichzeitig");
      case "DAnke": return topMatch("Danke");
      case "Interior": return topMatch("Interieur");
      case "Interiors": return topMatch("Interieurs");
      case "trifftigen": return topMatch("triftigen");
      case "trifftigem": return topMatch("triftigem");
      case "trifftige": return topMatch("triftige");
      case "trifftiges": return topMatch("triftiges");
      case "trifftiger": return topMatch("triftiger");
      case "gehhrte": return topMatch("geehrte");
      case "gehhrten": return topMatch("geehrten");
      case "gehhrtes": return topMatch("geehrtes");
      case "Iphone": return topMatch("iPhone");
      case "Iphones": return topMatch("iPhones");
      case "iphone": return topMatch("iPhone");
      case "iphones": return topMatch("iPhones");
      case "Ipad": return topMatch("iPad");
      case "Ipads": return topMatch("iPads");
      case "ipad": return topMatch("iPad");
      case "ipads": return topMatch("iPads");
      case "letzlich": return topMatch("letztlich");
      case "Letzlich": return topMatch("Letztlich");
      case "gefühlsdusselig": return topMatch("gefühlsduselig");
      case "gefühlsdusselige": return topMatch("gefühlsduselige");
      case "gefühlsdusseliger": return topMatch("gefühlsduseliger");
      case "gefühlsdusseliges": return topMatch("gefühlsduseliges");
      case "gefühlsdusseligen": return topMatch("gefühlsduseligen");
      case "gegebenfalls": return topMatch("gegebenenfalls");
      case "Gegebenfalls": return topMatch("Gegebenenfalls");
      case "zugebenermaßen": return topMatch("zugegebenermaßen");
      case "beispielweise": return topMatch("beispielsweise");
      case "pdf": return topMatch("PDF");
      case "Pdf": return topMatch("PDF");
      case "pdfs": return topMatch("PDFs");
      case "Pdfs": return topMatch("PDFs");
      case "gekriecht": return topMatch("gekrochen");
      case "einzigst": return topMatch("einzig");
      case "Einzigst": return topMatch("Einzig");
      case "Eifelturm": return topMatch("Eiffelturm", "Der Eiffelturm in Paris ist nach seinem Erbauer Gustave Eiffel benannt");
      case "Eifelturms": return topMatch("Eiffelturms", "Der Eiffelturm in Paris ist nach seinem Erbauer Gustave Eiffel benannt");
      case "Eifelturmes": return topMatch("Eiffelturmes", "Der Eiffelturm in Paris ist nach seinem Erbauer Gustave Eiffel benannt");
      case "Jojo-Effekt": return topMatch("Jo-Jo-Effekt");
      case "Jojo-Effekts": return topMatch("Jo-Jo-Effekts");
      case "Enschuldigen": return topMatch("Entschuldigen");
      case "Anschrifft": return topMatch("Anschrift");
      case "vertrauenserweckend": return topMatch("vertrauenerweckend");
      case "homepage": return topMatch("Homepage");
      case "interesse": return topMatch("Interesse");
      case "moglich": return topMatch("möglich");
      case "zusammenfässt": return topMatch("zusammenfasst");
      case "grosse": return topMatch("große");
      case "grossen": return topMatch("großen");
      case "grosser": return topMatch("großer");
      case "grosses": return topMatch("großes");
      case "geniesse": return topMatch("genieße");
      case "geniessen": return topMatch("genießen");
      case "grossartig": return topMatch("großartig");
      case "grosszügig": return topMatch("großzügig");
      case "moeglich": return topMatch("möglich");
      case "naturlich": return topMatch("natürlich");
      case "natuerlich": return topMatch("natürlich");
      case "unregelmässig": return topMatch("unregelmäßig");
      case "unregelmässige": return topMatch("unregelmäßige");
      case "unaktiv": return topMatch("inaktiv");
      case "unaktive": return topMatch("inaktive");
      case "unaktiver": return topMatch("inaktiver");
      case "unaktives": return topMatch("inaktives");
      case "unaktiven": return topMatch("inaktiven");
      case "uneffektiv": return topMatch("ineffektiv");
      case "uneffezient": return topMatch("ineffizient");
      case "rechtstaatlich": return topMatch("rechtsstaatlich");
      case "verhältnismässig": return topMatch("verhältnismäßig");
      case "unverhältnismässig": return topMatch("unverhältnismäßig");
      case "Hauptstrasse": return topMatch("Hauptstraße");
      case "Gespraech": return topMatch("Gespräch");
      case "Gespraechs": return topMatch("Gesprächs");
      case "Aussenbereich": return topMatch("Außenbereich");
      case "Aussenbereichs": return topMatch("Außenbereichs");
      //case "Portrait": return topMatch("Porträt"); --nach neuer Rechtschreibung 2024 akzeptiert (Amtl. Regelwerk, S. 282)
      //case "Portraits": return topMatch("Porträts"); --nach neuer Rechtschreibung 2024 akzeptiert (Amtl. Regelwerk, S. 282)
      case "weinachten": return topMatch("Weihnachten");
      case "Weinachten": return topMatch("Weihnachten");
      case "unterstüzt": return topMatch("unterstützt");
      case "untersützt": return topMatch("unterstützt");
      case "sontag": return topMatch("Sonntag");
      case "nichtsagend": return topMatch("nichtssagend");
      case "nichtsagende": return topMatch("nichtssagende");
      case "nichtsagender": return topMatch("nichtssagender");
      case "nichtsagendes": return topMatch("nichtssagendes");
      case "nichtsagenden": return topMatch("nichtssagenden");
      case "nichtsagendem": return topMatch("nichtssagendem");
      case "nirgendswo": return topMatch("nirgendwo");
      case "durchfuehren": return topMatch("durchführen");
      case "durchgefuehrt": return topMatch("durchgeführt");
      case "erhälst": return topMatch("erhältst");
      case "erhählst": return topMatch("erhältst");
      case "Nirgendswo": return topMatch("Nirgendwo");
      case "Typescript": return topMatch("TypeScript");
      case "mitinbegriffen": return topMatch("mit inbegriffen");
      case "miteinbegriffen": return topMatch("mit einbegriffen");
      case "unterjährlich": return topMatch("unterjährig");
      case "mehrjährlich": return topMatch("mehrjährig");
      case "mehrjährliche": return topMatch("mehrjährige");
      case "mehrjährlichen": return topMatch("mehrjährigen");
      case "mehrjährlicher": return topMatch("mehrjähriger");
      case "mehrjährliches": return topMatch("mehrjähriges");
      case "genausogut": return topMatch("genauso gut");
      case "Sylvester": return topMatch("Silvester");
      case "Außerden": return topMatch("Außerdem");
      case "Irish-Pub": return topMatch("Irish Pub");
      case "Irish-Pubs": return topMatch("Irish Pubs");
      case "ausserhalb": return topMatch("außerhalb");
      case "Ausserhalb": return topMatch("Außerhalb");
      case "Add-On": return topMatch("Add-on");
      case "Add-Ons": return topMatch("Add-ons");
      case "zweitenmal": return topMatch("zweiten Mal");
      case "Zweitenmal": return topMatch("Zweiten Mal");
      case "Nächstesmal": return topMatch("Nächstes Mal");
      case "Walldorfschule": return topMatch("Waldorfschule");
      case "Walldorfschulen": return topMatch("Waldorfschulen");
      case "ertragsreich": return topMatch("ertragreich");
      case "ertragsreiche": return topMatch("ertragreiche");
      case "ertragsreiches": return topMatch("ertragreiches");
      case "ertragsreichen": return topMatch("ertragreichen");
      case "einzigste": return topMatch("einzige");
      case "einzigstes": return topMatch("einziges");
      case "einzigster": return topMatch("einziger");
      case "einzigsten": return topMatch("einzigen");
      case "einzigstem": return topMatch("einzigem");
      case "Youngstar": return topMatch("Youngster");
      case "Youngstars": return topMatch("Youngsters");
      case "aussergewöhnlichen": return topMatch("außergewöhnlichen");
      case "aussergewöhnliche": return topMatch("außergewöhnliche");
      case "aussergewöhnlicher": return topMatch("außergewöhnlicher");
      case "aussergewöhnliches": return topMatch("außergewöhnliches");
      case "aussergewöhnlich": return topMatch("außergewöhnlich");
      case "Gluckwunsch": return topMatch("Glückwunsch");
      case "Gluckwunsche": return topMatch("Glückwünsche");
      case "Glückwunsche": return topMatch("Glückwünsche");
      case "außerden": return topMatch("außerdem");
      case "gleichermassen": return topMatch("gleichermaßen");
      case "massgeblich": return topMatch("maßgeblich");
      case "tschuldige": return topMatch("entschuldige");
      case "Tschuldigung": return topMatch("Entschuldigung");
      case "Schuldigung": return topMatch("Entschuldigung");
      case "Anteilname": return topMatch("Anteilnahme");
      case "Mahnungswesen": return topMatch("Mahnwesen");
      case "Mahnungswesens": return topMatch("Mahnwesens");
      case "Geruchsinn": return topMatch("Geruchssinn");
      case "Geruchsinns": return topMatch("Geruchssinns");
      case "Optin": return topMatch("Opt-in");
      case "Stk": return topMatch("Stk.");
      case "T-shirt": return topMatch("T-Shirt");
      case "t-shirt": return topMatch("T-Shirt");
      case "T-shirts": return topMatch("T-Shirts");
      case "t-shirts": return topMatch("T-Shirts");
      case "umgangsprachlich": return topMatch("umgangssprachlich");
      case "E-Mai": return topMatch("E-Mail");
      case "E-Mais": return topMatch("E-Mails");
      case "Gelantine": return topMatch("Gelatine");
      case "angehangenen": return topMatch("angehängten");
      case "ausmahlen": return topMatch("ausmalen");
      case "ausgemahlt": return topMatch("ausgemalt");
      case "weisst": return topMatch("weißt");
      case "Weisst": return topMatch("Weißt");
      case "Rehgipsplatte": return topMatch("Rigipsplatte");
      case "Rehgipsplatten": return topMatch("Rigipsplatten");
      case "Rehgips-Platte": return topMatch("Rigips-Platte");
      case "Rehgips-Platten": return topMatch("Rigips-Platten");
      case "Rehgips": return topMatch("Rigips");
      case "rundumerneuert": return topMatch("runderneuert");
      case "rundumerneuerte": return topMatch("runderneuerte");
      case "rundumerneuertes": return topMatch("runderneuertes");
      case "rundumerneuerter": return topMatch("runderneuerter");
      case "rundumerneuerten": return topMatch("runderneuerten");
      case "rundumerneuertem": return topMatch("runderneuertem");
      case "Davidswache": return topMatch("Davidwache");
      case "Pinwand": return topMatch("Pinnwand");
      case "Kreisaal": return topMatch("Kreißsaal");
      case "Kreisaals": return topMatch("Kreißsaals");
      case "Kreissaal": return topMatch("Kreißsaal");
      case "Kreissäle": return topMatch("Kreißsäle");
      case "Kreissälen": return topMatch("Kreißsälen");
      case "Kreissaals": return topMatch("Kreißsaals");
      case "Laola-Welle": return topMatch("La-Ola-Welle");
      case "Laola-Wellen": return topMatch("La-Ola-Wellen");
      case "BayArea": return topMatch("Bay Area");
      case "kontaktfreundlich": return topMatch("kontaktfreudig");
      case "kontaktfreundliche": return topMatch("kontaktfreudige");
      case "kontaktfreundlicher": return topMatch("kontaktfreudiger");
      case "kontaktfreundliches": return topMatch("kontaktfreudiges");
      case "kontaktfreundlichen": return topMatch("kontaktfreudigen");
      case "kontaktfreundlichem": return topMatch("kontaktfreudigem");
      case "Wirtschaftsingenieurswesen": return topMatch("Wirtschaftsingenieurwesen");
      case "Wirtschaftsingenieurswesens": return topMatch("Wirtschaftsingenieurwesens");
      case "wiederspiegeln": return topMatch("widerspiegeln");
      case "wiederspiegelt": return topMatch("widerspiegelt");
      case "wiederspiegelst": return topMatch("widerspiegelst");
      case "wiedergespiegelt": return topMatch("widergespiegelt");
      case "Wiederhall": return topMatch("Widerhall");
      case "Wiederhalls": return topMatch("Widerhalls");
      case "Ebensowenig": return topMatch("Ebenso wenig");
      case "Ebensooft": return topMatch("Ebenso oft");
      case "ebensooft": return topMatch("ebenso oft");
      case "Ebensogut": return topMatch("Ebenso gut");
      case "ebensogut": return topMatch("ebenso gut");
      case "Ebensoleicht": return topMatch("Ebenso leicht");
      case "ebensoleicht": return topMatch("ebenso leicht");
      case "eigendlich": return topMatch("eigentlich");
      case "eigendliche": return topMatch("eigentliche");
      case "eigendlicher": return topMatch("eigentlicher");
      case "eigendliches": return topMatch("eigentliches");
      case "eigendlichen": return topMatch("eigentlichen");
      case "eigendlichem": return topMatch("eigentlichem");
      case "rüberstülpen": return topMatch("überstülpen");
      case "rüberstülpe": return topMatch("überstülpe");
      case "rübergestülpt": return topMatch("übergestülpt");
      case "Websiten": return topMatch("Webseiten");
      case "freiverfügbar": return topMatch("frei verfügbar");
      case "freiverfügbare": return topMatch("frei verfügbare");
      case "freiverfügbares": return topMatch("frei verfügbares");
      case "freiverfügbarer": return topMatch("frei verfügbarer");
      case "freiverfügbaren": return topMatch("frei verfügbaren");
      case "freiverfügbarem": return topMatch("frei verfügbarem");
      case "freiverkäuflich": return topMatch("frei verkäuflich");
      case "freiverkäufliche": return topMatch("frei verkäufliche");
      case "freiverkäufliches": return topMatch("frei verkäufliches");
      case "freiverkäuflicher": return topMatch("frei verkäuflicher");
      case "freiverkäuflichen": return topMatch("frei verkäuflichen");
      case "freiverkäuflichem": return topMatch("frei verkäuflichem");
      case "Mfg": return topMatch("MfG");
      case "Gefahrenstoffe": return topMatch("Gefahrstoffe");
      case "Gefahrenstoffen": return topMatch("Gefahrstoffen");
      case "Resource": return topMatch("Ressource");
      case "Resourcen": return topMatch("Ressourcen");
      case "Resources": return topMatch("Ressourcen");
      case "Tzatziki": return topMatch("Zaziki");
      case "Selenski": return topMatch("Selenskyj");
      case "armzurechnen": return topMatch("arm zu rechnen");
      case "armrechne": return topMatch("arm rechne");
      case "armrechnest": return topMatch("arm rechnest");
      case "armrechnet": return topMatch("arm rechnet");
      case "armrechnen": return topMatch("arm rechnen");
      case "armgerechnet": return topMatch("arm gerechnet");
      case "ernstnimmst": return topMatch("ernst nimmst");
      case "ernstnimmt": return topMatch("ernst nimmt");
      case "ernstnehme": return topMatch("ernst nehme");
      case "ernstnehmen": return topMatch("ernst nehmen");
      case "ernstzunehmen": return topMatch("ernst zu nehmen");
      case "ernstgenommen": return topMatch("ernst genommen");
      case "ernstmeinst": return topMatch("ernst meinst");
      case "ernstmeine": return topMatch("ernst meine");
      case "ernstmeinte": return topMatch("ernst meinte");
      case "ernstmeinen": return topMatch("ernst meinen");
      case "ernstzumeinen": return topMatch("ernst zu meinen");
      case "ernstgemeinet": return topMatch("ernst gemeint");
      case "fertigschreiben": return topMatch("fertig schreiben");
      case "fertigzuschreiben": return topMatch("fertig zu schreiben");
      case "fertiggeschrieben": return topMatch("fertig geschrieben");
      case "fertigschreibt": return topMatch("fertig schreibt");
      case "freigedacht": return topMatch("frei gedacht");
      case "freidenken": return topMatch("frei denken");
      case "freizudenken": return topMatch("frei zu denken");
      case "freiliegen": return topMatch("frei liegen");
      case "freischreiben": return topMatch("frei schreiben");
      case "freizuschreiben": return topMatch("frei zu schreiben");
      case "freigeschrieben": return topMatch("frei geschrieben");
      case "freischlagen": return topMatch("frei schlagen");
      case "freizuschlagen": return topMatch("frei zu schlagen");
      case "freigeschlagen": return topMatch("frei geschlagen");
      case "geheimhalten": return topMatch("geheim halten");
      case "geheimhaltet": return topMatch("geheim haltet");
      case "geheimzuhalten": return topMatch("geheim zu halten");
      case "geheimgehalten": return topMatch("geheim gehalten");
      case "geheimhältst": return topMatch("geheim hältst");
      case "gleichlauten": return topMatch("gleich lauten");
      case "gutdünken": return topMatch("Gutdünken");
      case "langfahren": return topMatch("entlangfahren");
      case "langfuhren": return topMatch("entlangfuhren");
      case "langzufahren": return topMatch("entlangzufahren");
      case "langfahre": return topMatch("entlangfahre");
      case "langfährst": return topMatch("entlangfährst");
      case "langgefahren": return topMatch("entlanggefahren");
      case "langlaufen": return topMatch("entlanglaufen");
      case "langliefen": return topMatch("entlangliefen");
      case "langzulaufen": return topMatch("entlangzulaufen");
      case "langlaufe": return topMatch("entlanglaufe");
      case "langläufst": return topMatch("entlangläufst");
      case "langgelaufen": return topMatch("entlanggelaufen");
      case "langgehen": return topMatch("entlanggehen");
      case "langgingen": return topMatch("entlanggingen");
      case "langzugehen": return topMatch("entlangzugehen");
      case "langgehe": return topMatch("entlanggehe");
      case "langging": return topMatch("entlangging");
      case "Macbook": return topMatch("MacBook");
      case "Macbooks": return topMatch("MacBooks");
      case "langgegangen": return topMatch("entlanggegangen");
      case "lustigmachen": return topMatch("lustig machen");
      case "lustigmache": return topMatch("lustig mache");
      case "lustigmachst": return topMatch("lustig machst");
      case "lustigmachten": return topMatch("lustig machten");
      case "lustigzumachen": return topMatch("lustig zu machen");
      case "lustiggemacht": return topMatch("lustig gemacht");
      case "niederschlagreich": return topMatch("niederschlagsreich");
      case "niederschlagreiche": return topMatch("niederschlagsreiche");
      case "niederschlagreicher": return topMatch("niederschlagsreicher");
      case "niederschlagreiches": return topMatch("niederschlagsreiches");
      case "niederschlagreichem": return topMatch("niederschlagsreichem");
      case "niederschlagreichen": return topMatch("niederschlagsreichen");
      case "rechtgeben": return topMatch("recht geben");
      case "rechtzugeben": return topMatch("recht zu geben");
      case "rechtgegeben": return topMatch("recht gegeben");
      case "rechtgibst": return topMatch("recht gibst");
      case "rechtgibt": return topMatch("recht gibt");
      case "rechtgab": return topMatch("recht gab");
      case "rechthaben": return topMatch("recht haben");
      case "rechthabe": return topMatch("recht habe");
      case "rechtzuhaben": return topMatch("recht zu haben");
      case "rechtgehabt": return topMatch("recht gehabt");
      case "rechthatte": return topMatch("recht hatte");
      case "rechthast": return topMatch("recht hast");
      case "rechthabt": return topMatch("recht habt");
      case "rechtmachen": return topMatch("recht machen");
      case "rechtzumachen": return topMatch("recht zu machen");
      case "rechtgemacht": return topMatch("recht gemacht");
      case "rechtmacht": return topMatch("recht macht");
      case "rechtmache": return topMatch("recht mache");
      case "rechtmachte": return topMatch("recht machte");
      case "rechtmachten": return topMatch("recht machten");
      case "rechtmachst": return topMatch("recht machst");
      case "taubstellen": return topMatch("taub stellen");
      case "taubzustellen": return topMatch("taub zu stellen");
      case "taubgestellt": return topMatch("taub gestellt");
      case "taubstelle": return topMatch("taub stelle");
      case "taubstellt": return topMatch("taub stellt");
      case "taubstellst": return topMatch("taub stellst");
      case "wachgeblieben": return topMatch("wach geblieben");
      case "wachbleiben": return topMatch("wach bleiben");
      case "wachbleibe": return topMatch("wach bleibe");
      case "wachzubleiben": return topMatch("wach zu bleiben");
      case "wachbleibst": return topMatch("wach bleibst");
      case "wachblieb": return topMatch("wach blieb");
      case "wachblieben": return topMatch("wach blieben");
      case "ewiggleich": return topMatch("ewig gleich");
      case "ewiggleiche": return topMatch("ewig gleiche");
      case "ewiggleicher": return topMatch("ewig gleicher");
      case "ewiggleiches": return topMatch("ewig gleiches");
      case "ewiggleichem": return topMatch("ewig gleichem");
      case "ewiggleichen": return topMatch("ewig gleichen");
      case "sattessen": return topMatch("satt essen");
      case "gemäss": return topMatch("gemäß");
      case "upgedated": return topMatch("upgedatet");
      case "E.On": return topMatch("E.ON");
      case "E.on": return topMatch("E.ON");
      case "Juergen": return topMatch("Jürgen");
      case "deligieren": return topMatch("delegieren");
      case "deligiert": return topMatch("delegiert");
      case "telephonisch": return topMatch("telefonisch");
      case "telephonische": return topMatch("telefonische");
      case "telephonischen": return topMatch("telefonischen");
      case "telephonischem": return topMatch("telefonischem");
      case "telephonischer": return topMatch("telefonischer");
      case "telephonisches": return topMatch("telefonisches");
      case "beindruckend": return topMatch("beeindruckend");
      case "beindruckende": return topMatch("beeindruckende");
      case "beindruckender": return topMatch("beeindruckender");
      case "beindruckendes": return topMatch("beeindruckendes");
      case "beindruckenden": return topMatch("beeindruckenden");
      case "beindruckendem": return topMatch("beeindruckendem");
      case "beindruckt": return topMatch("beeindruckt");
      case "beindruckte": return topMatch("beeindruckte");
      case "heilsbringend": return topMatch("heilbringend");
      case "heilsbringende": return topMatch("heilbringende");
      case "heilsbringenden": return topMatch("heilbringenden");
      case "heilsbringendem": return topMatch("heilbringendem");
      case "heilsbringender": return topMatch("heilbringender");
      case "heilsbringendes": return topMatch("heilbringendes");
      case "vielfaltig": return topMatch("vielfältig");
      case "vielfaltige": return topMatch("vielfältige");
      case "vielfaltiger": return topMatch("vielfältiger");
      case "vielfaltiges": return topMatch("vielfältiges");
      case "vielfaltigen": return topMatch("vielfältigen");
      case "vielfaltigem": return topMatch("vielfältigem");
      case "barfuss": return topMatch("barfuß");
      case "nord-südlich": return topMatch("nordsüdlich");
      case "nord-südliche": return topMatch("nordsüdliche");
      case "nord-südlicher": return topMatch("nordsüdlicher");
      case "nord-südliches": return topMatch("nordsüdliches");
      case "nord-südlichen": return topMatch("nordsüdlichen");
      case "nord-südlichem": return topMatch("nordsüdlichem");
      case "nord-östlich": return topMatch("nordöstlich");
      case "nord-östliche": return topMatch("nordöstliche");
      case "nord-östlicher": return topMatch("nordöstlicher");
      case "nord-östliches": return topMatch("nordöstliches");
      case "nord-östlichen": return topMatch("nordöstlichen");
      case "nord-östlichem": return topMatch("nordöstlichem");
      case "nord-westlich": return topMatch("nordwestlich");
      case "nord-westliche": return topMatch("nordwestliche");
      case "nord-westlicher": return topMatch("nordwestlicher");
      case "nord-westliches": return topMatch("nordwestliches");
      case "nord-westlichen": return topMatch("nordwestlichen");
      case "nord-westlichem": return topMatch("nordwestlichem");
      case "süd-westlich": return topMatch("südwestlich");
      case "süd-westliche": return topMatch("südwestliche");
      case "süd-westlicher": return topMatch("südwestlicher");
      case "süd-westliches": return topMatch("südwestliches");
      case "süd-westlichen": return topMatch("südwestlichen");
      case "süd-westlichem": return topMatch("südwestlichem");
      case "süd-östlich": return topMatch("südöstlich");
      case "süd-östliche": return topMatch("südöstliche");
      case "süd-östlicher": return topMatch("südöstlicher");
      case "süd-östliches": return topMatch("südöstliches");
      case "süd-östlichen": return topMatch("südöstlichen");
      case "süd-östlichem": return topMatch("südöstlichem");
      case "ost-westlich": return topMatch("ostwestlich");
      case "ost-westliche": return topMatch("ostwestliche");
      case "ost-westlicher": return topMatch("ostwestlicher");
      case "ost-westliches": return topMatch("ostwestliches");
      case "ost-westlichen": return topMatch("ostwestlichen");
      case "ost-westlichem": return topMatch("ostwestlichem");
      case "afro-amerikanisch": return topMatch("afroamerikanisch");
      case "afro-amerikanische": return topMatch("afroamerikanische");
      case "afro-amerikanischer": return topMatch("afroamerikanischer");
      case "afro-amerikanisches": return topMatch("afroamerikanisches");
      case "afro-amerikanischen": return topMatch("afroamerikanischen");
      case "afro-amerikanischem": return topMatch("afroamerikanischem");
      case "tatsachlich": return topMatch("tatsächlich");
      case "tatsachliche": return topMatch("tatsächliche");
      case "tatsachlicher": return topMatch("tatsächlicher");
      case "tatsachliches": return topMatch("tatsächliches");
      case "tatsachlichen": return topMatch("tatsächlichen");
      case "tatsachlichem": return topMatch("tatsächlichem");
      case "ungelungen": return topMatch("misslungen");
      case "ungelungene": return topMatch("misslungene");
      case "ungelungener": return topMatch("misslungener");
      case "ungelungenes": return topMatch("misslungenes");
      case "ungelungenen": return topMatch("misslungenen");
      case "ungelungenem": return topMatch("misslungenem");
      case "totkrank": return topMatch("todkrank");
      case "totkranke": return topMatch("todkranke");
      case "totkranker": return topMatch("todkranker");
      case "totkrankes": return topMatch("todkrankes");
      case "totkranken": return topMatch("todkranken");
      case "totkrankem": return topMatch("todkrankem");
      case "SnapChat": return topMatch("Snapchat");
      case "SnapChats": return topMatch("Snapchats");
      case "jmd": return topMatch("jmd.");
      case "Sparringpartner": return topMatch("Sparringspartner");
      case "Sparringpartners": return topMatch("Sparringspartners");
      case "Sparringpartnern": return topMatch("Sparringspartnern");
      case "ausserordentlich": return topMatch("außerordentlich");
      case "ausserordentliche": return topMatch("außerordentliche");
      case "ausserordentlichen": return topMatch("außerordentlichen");
      case "ausserordentlichem": return topMatch("außerordentlichem");
      case "ausserordentlicher": return topMatch("außerordentlicher");
      case "ausserordentliches": return topMatch("außerordentliches");
      case "unzippen": return topMatch("entzippen");
      case "unzippt": return topMatch("entzippt");
      case "unzippst": return topMatch("entzippst");
      case "unzippe": return topMatch("entzippe");
      case "Moet": return topMatch("Moët");
      case "Prigozhin": return topMatch("Prigoschin");
      case "Prigozhins": return topMatch("Prigoschins");
      case "unhilfreich": return topMatch("unbehilflich");
      case "gestriffen": return topMatch("gestreift");
      case "dererseits": return topMatch("ihrerseits");
      case "Regattas": return topMatch("Regatten");
      case "Segelregattas": return topMatch("Segelregatten");
      case "Brics-Staat": return topMatch("BRICS-Staat");
      case "Brics-Staats": return topMatch("BRICS-Staats");
      case "Brics-Staaten": return topMatch("BRICS-Staaten");
      case "Rene": return topMatch("René");
      case "Renes": return topMatch("Renés");
      case "einigermassen": return topMatch("einigermaßen");
      case "Eurocup": return topMatch("EuroCup");
      case "Eurocups": return topMatch("EuroCups");
      case "etc": return topMatch("etc.");
      case "Ressorthotel": return topMatch("Resorthotel");
      case "Ressorthotels": return topMatch("Resorthotels");
      case "Kleidungstück": return topMatch("Kleidungsstück");
      case "Kleidungstücks": return topMatch("Kleidungsstücks");
      case "Kleidungstückes": return topMatch("Kleidungsstückes");
      case "Kleidungstücke": return topMatch("Kleidungsstücke");
      case "Kleidungstücken": return topMatch("Kleidungsstücken");
      case "unrentierlich": return topMatch("unrentabel");
      case "unrentierliche": return topMatch("unrentable");
      case "unrentierlicher": return topMatch("unrentabler");
      case "unrentierliches": return topMatch("unrentables");
      case "unrentierlichen": return topMatch("unrentablen");
      case "unrentierlichem": return topMatch("unrentablem");
      case "Hinterweltlerin": return topMatch("Hinterwäldlerin");
      case "Hinterweltlerinnen": return topMatch("Hinterwäldlerinnen");
      case "Hinterweltler": return topMatch("Hinterwäldler");
      case "Hinterweltlers": return topMatch("Hinterwäldlers");
      case "Hinterweltlern": return topMatch("Hinterwäldlern");
      case "erstrecht": return topMatch("erst recht");
      case "klangheimlich": return topMatch("klammheimlich");
      case "klangheimliche": return topMatch("klammheimliche");
      case "klangheimlicher": return topMatch("klammheimlicher");
      case "klangheimliches": return topMatch("klammheimliches");
      case "klangheimlichen": return topMatch("klammheimlichen");
      case "klangheimlichem": return topMatch("klammheimlichem");
      case "raufklicken": return topMatch("draufklicken");
      case "raufzuklicken": return topMatch("draufzuklicken");
      case "raufgeklickt": return topMatch("draufgeklickt");
      case "raufklicke": return topMatch("draufklicke");
      case "raufklickst": return topMatch("draufklickst");
      case "Aquaplanning": return topMatch("Aquaplaning");
      case "Aquaplannings": return topMatch("Aquaplanings");
      case "Kibbutz": return topMatch("Kibbuz");
      case "Prozentteil": return topMatch("Prozentanteil");
      case "Strebergarten": return topMatch("Schrebergarten");
      case "Strebergartens": return topMatch("Schrebergartens");
      case "Strebergärten": return topMatch("Schrebergärten");
      case "gunsten": return topMatch("Gunsten");
      case "ungunsten": return topMatch("Ungunsten");
      case "Situp": return topMatch("Sit-up");
      case "Situps": return topMatch("Sit-ups");
      case "Feb": return topMatch("Feb.");
      case "Apr": return topMatch("Apr.");
      case "Okt": return topMatch("Okt.");
      case "Nov": return topMatch("Nov.");
      case "aussen": return topMatch("außen");
      case "bestmöglichst": return topMatch("bestmöglich");
      case "nächstmöglichst": return topMatch("nächstmöglich");
      case "markaber": return topMatch("makaber");
      case "nachgeharkt": return topMatch("nachgehakt");
      case "nachgeharckt": return topMatch("nachgehackt");
      case "nachharken": return topMatch("nachhaken");
      case "nachhacken": return topMatch("nachhaken");
      case "Babies": return topMatch("Babys");
      case "Gummies": return topMatch("Gummis");
      case "Grüzi": return topMatch("Grüezi");
      case "fuer": return topMatch("für");
      case "Fuer": return topMatch("Für");
      case "Gruss": return topMatch("Gruß");
      case "nciht": return topMatch("nicht");
      case "heutejournal": return topMatch("heute journal");
      case "wikipedia": return topMatch("Wikipedia");
      case "Einfallspinsel": return topMatch("Einfaltspinsel");
      case "Einfallspinseln": return topMatch("Einfaltspinseln");
      case "Parcour": return topMatch("Parcours");
      case "Sommeliere": return topMatch("Sommelière");
      case "Sommeliére": return topMatch("Sommelière");
      case "Kosten-Nutzenanalyse": return topMatch("Kosten-Nutzen-Analyse");
      case "Kosten-Nutzenanalysen": return topMatch("Kosten-Nutzen-Analysen");
      case "Kosten-Nutzenverhältnis": return topMatch("Kosten-Nutzen-Verhältnis");
      case "Kosten-Nutzenverhältnisse": return topMatch("Kosten-Nutzen-Verhältnisse");
      case "Kosten-Nutzenverhältnisses": return topMatch("Kosten-Nutzen-Verhältnisses");
      case "Kosten-Nutzenrechnung": return topMatch("Kosten-Nutzen-Rechnung");
      case "Kosten-Nutzenrechnungen": return topMatch("Kosten-Nutzen-Rechnungen");
      case "Brandwein": return topMatch("Branntwein");
      case "Brandweins": return topMatch("Branntweins");
      case "Brandweines": return topMatch("Branntweines");
      case "Brandweine": return topMatch("Branntweine");
      case "Brandweinen": return topMatch("Branntweinen");
      case "IfoInstitut": return topMatch("ifo Institut");
      case "IfoInstituts": return topMatch("ifo Instituts");
      case "ifoInstitut": return topMatch("ifo Institut");
      case "ifoInstituts": return topMatch("ifo Instituts");
      case "Ifo-Institut": return topMatch("ifo Institut");
      case "Ifo-Instituts": return topMatch("ifo Instituts");
      case "ifo-Institut": return topMatch("ifo Institut");
      case "ifo-Instituts": return topMatch("ifo Instituts");
      case "MacMini": return topMatch("Mac mini");
      case "MacMinis": return topMatch("Mac minis");
      case "Neisse-Verlag": return topMatch("Neisse Verlag");
      case "Neiße-Verlag": return topMatch("Neisse Verlag");
      case "Neisse-Verlags": return topMatch("Neisse Verlags");
      case "Neiße-Verlags": return topMatch("Neisse Verlags");
      case "weihnachten": return topMatch("Weihnachten");
      case "Carlsen-Verlag": return topMatch("Carlsen Verlag");
      case "Carlsen-Verlags": return topMatch("Carlsen Verlags");
      case "Sinnflut": return topMatch("Sintflut");
      case "Orginal": return topMatch("Original");
      case "Orginals": return topMatch("Originals");
      case "orginal": return topMatch("original");
      case "orginale": return topMatch("originale");
      case "orginalen": return topMatch("originalen");
      case "orginales": return topMatch("originales");
      case "Rundumsorglospaket": return topMatch("Rundum-sorglos-Paket");
      case "Rundumsorglospakets": return topMatch("Rundum-sorglos-Pakets");
      case "Fidji": return topMatch("Fidschi");
      case "tschüß": return topMatch("tschüss");
      case "Bautenzug": return topMatch("Bowdenzug");
      case "Bautenzugs": return topMatch("Bowdenzugs");
      case "Bautenzuges": return topMatch("Bowdenzuges");
      case "Bautenzüge": return topMatch("Bowdenzüge");
      case "Bautenzügen": return topMatch("Bowdenzügen");
      case "quillbot": return topMatch("QuillBot");
      case "quilbot": return topMatch("QuillBot");
      case "Quilbot": return topMatch("QuillBot");
      case "HeyLogin": return topMatch("heylogin");
      case "steinfarbenden": return topMatch("steinfarbenen");
      case "steinfarbende": return topMatch("steinfarbene");
      case "steinfarbender": return topMatch("steinfarbener");
      case "steinfarbendes": return topMatch("steinfarbenes");
      case "steinfarbendem": return topMatch("steinfarbenem");
      case "schwarzfarbenden": return topMatch("schwarzfarbenen");
      case "schwarzfarbende": return topMatch("schwarzfarbene");
      case "schwarzfarbender": return topMatch("schwarzfarbener");
      case "schwarzfarbendes": return topMatch("schwarzfarbenes");
      case "schwarzfarbendem": return topMatch("schwarzfarbenem");
      case "kupferfarbenden": return topMatch("kupferfarbenen");
      case "kupferfarbende": return topMatch("kupferfarbene");
      case "kupferfarbender": return topMatch("kupferfarbener");
      case "kupferfarbendes": return topMatch("kupferfarbenes");
      case "kupferfarbendem": return topMatch("kupferfarbenem");
      case "Außenriss": return topMatch("Außenrist");
      case "Innenriss": return topMatch("Innenrist");
      case "Lolly": return topMatch("Lolli");
      case "Lollys": return topMatch("Lollis");
      case "Lollies": return topMatch("Lollis");
    }
    return [];
  }

}

export class ExpandingReader extends LineReader {

  private readonly buffer: string[] = [];
  private readonly lineExpander = new LineExpander();
  /** The wrapped reader (Java: BufferedReader's own) */
  private readonly in: LineReader;

  constructor(_in: LineReader) {
    super([]);
    this.in = _in;
  }

  override readLine(): string | null {
    if (this.buffer.length === 0) {
      const line = this.in.readLine();
      if (line == null) {
        return null;
      }
      this.buffer.push(...this.lineExpander.expandLine(line));
    }
    return this.buffer.shift()!;
  }
}
