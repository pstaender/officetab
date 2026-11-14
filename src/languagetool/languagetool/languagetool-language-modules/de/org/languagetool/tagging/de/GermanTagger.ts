// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/tagging/de/GermanTagger.java faithful
// INSTANCE is created on first use (Java creates it when the class is loaded), as the dictionary
// must have been preloaded into the data broker first; so are the static patterns. The two tag
// overloads are one method: tag(word) (a string) returns the word tagger's TaggedWords,
// tag(sentenceTokens, ignoreCase = true) the readings. So are the two getAnalyzedTokens overloads
// (compoundParts optional). The memoized expansion infos are a lazily set module variable;
// StringInterner.intern is left out. Apache Commons' StringUtils/RegExUtils methods are local
// functions. Package-private methods (prefixedVerbLastPart, isWeiseException) are public.
// Java's readings.contains("VER:1:SIN:PRÄ") etc. compare a String with AnalyzedTokens (always
// false); List_contains keeps that.
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { CachingWordListLoader } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/CachingWordListLoader.ts';
import { BaseTagger } from '../../../../../../languagetool-core/org/languagetool/tagging/BaseTagger.ts';
import type { CombiningTagger } from '../../../../../../languagetool-core/org/languagetool/tagging/CombiningTagger.ts';
import type { ManualTagger } from '../../../../../../languagetool-core/org/languagetool/tagging/ManualTagger.ts';
import { TaggedWord } from '../../../../../../languagetool-core/org/languagetool/tagging/TaggedWord.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { GermanSynthesizer } from '../../synthesis/GermanSynthesizer.ts';
import { GermanCompoundTokenizer } from '../../tokenizers/de/GermanCompoundTokenizer.ts';
import { AdjectiveTags } from './AdjectiveTags.ts';
import { VerbPrefixes } from './VerbPrefixes.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import { List_contains } from '../../../../../../../jdk/java/util/Objects.ts';
import { Pattern, StringMatches, StringReplaceFirst, StringSplit } from '../../../../../../../jdk/java/util/regex/Pattern.ts';
import { Character, StringIsBlank, StringTrim } from '../../../../../../../jdk/java/lang/Character.ts';
import { StringEqualsIgnoreCase } from '../../../../../../../jdk/java/lang/String.ts';

// import static org.languagetool.tools.StringTools.uppercaseFirstChar
const uppercaseFirstChar = (str: string): string => StringTools.uppercaseFirstChar(str)!;

// ---- Apache Commons Lang (StringUtils, RegExUtils)

/** StringUtils.startsWithAny (case-sensitive; false for null) */
function StringUtils_startsWithAny(sequence: string | null, ...searchStrings: (string | readonly string[])[]): boolean {
  if (sequence == null || sequence.length === 0) return false;
  return searchStrings.flat().some((s) => sequence.startsWith(s));
}
/** StringUtils.containsAny(CharSequence, CharSequence...) */
function StringUtils_containsAny(cs: string | null, ...searchCharSequences: (string | readonly string[])[]): boolean {
  if (cs == null || cs.length === 0) return false;
  return searchCharSequences.flat().some((s) => cs.includes(s));
}
/** StringUtils.equalsAny */
function StringUtils_equalsAny(string: string | null, ...searchStrings: (string | readonly string[])[]): boolean {
  return searchStrings.flat().some((s) => s === string);
}
/** StringUtils.equalsAnyIgnoreCase */
function StringUtils_equalsAnyIgnoreCase(string: string, ...searchStrings: string[]): boolean {
  return searchStrings.some((s) => StringEqualsIgnoreCase(string, s));
}
/** StringUtils.endsWith */
function StringUtils_endsWith(str: string | null, suffix: string): boolean {
  return str != null && str.endsWith(suffix);
}
/** StringUtils.removeEnd */
function StringUtils_removeEnd(str: string, remove: string): string {
  if (str.length === 0 || remove.length === 0) return str;
  return str.endsWith(remove) ? str.substring(0, str.length - remove.length) : str;
}
/** StringUtils.removeStart */
function StringUtils_removeStart(str: string, remove: string): string {
  if (str.length === 0 || remove.length === 0) return str;
  return str.startsWith(remove) ? str.substring(remove.length) : str;
}
/** StringUtils.isAlphanumeric: not empty, every char a letter or digit */
function StringUtils_isAlphanumeric(cs: string): boolean {
  if (cs.length === 0) return false;
  for (let i = 0; i < cs.length; i++) {
    if (!Character.isLetterOrDigit(cs.charAt(i))) return false;
  }
  return true;
}
/** StringUtils.isAllBlank of one string = StringUtils.isBlank */
const StringUtils_isAllBlank = (cs: string): boolean => StringIsBlank(cs);
/** StringUtils.isWhitespace: every char is whitespace (true for "") */
const StringUtils_isWhitespace = (cs: string): boolean => StringIsBlank(cs);
/** StringUtils.split(str, separatorChar): adjacent separators are one, no empty tokens */
const StringUtils_split = (str: string, separatorChar: string): string[] => str.split(separatorChar).filter((s) => s.length > 0);
/** RegExUtils.removePattern: replaces the pattern (DOTALL) with "" */
const RegExUtils_removePattern = (text: string, regex: string): string => Pattern.compile(regex, Pattern.DOTALL).matcher(text).replaceAll('');
/** RegExUtils.replaceFirst = String.replaceFirst */
const RegExUtils_replaceFirst = (text: string, regex: string, replacement: string): string => StringReplaceFirst(text, regex, replacement);

/** List.toString() of the readings ("[a/b, c/d]") */
const listToString = (l: readonly unknown[]): string => '[' + l.join(', ') + ']';

const allAdjGruTags: string[] = [];
let patterns: {
  mitarbeitendenPattern: Pattern; genderGapChars: Pattern; afterAsterisk: Pattern; innenPattern1: Pattern;
  anythingDash: Pattern; innenPattern2: Pattern; DDD_ER_PATTERN: Pattern;
} | null = null;
const P = () => (patterns ??= {
  mitarbeitendenPattern: Pattern.compile('[A-ZÖÄÜ][a-zöäüß]{2,25}mitarbeitenden?'),
  genderGapChars: Pattern.compile('[*:_/]'),
  afterAsterisk: Pattern.compile('in(nen)?|r|e'),
  innenPattern1: Pattern.compile('in(nen)-[A-ZÖÄÜ][a-zöäüß-]+'),
  anythingDash: Pattern.compile('.*-'),
  innenPattern2: Pattern.compile('innen[a-zöäüß-]+'),
  DDD_ER_PATTERN: Pattern.compile('\\d{4}+er'),
});

for (const nomAkkGenDat of ['NOM', 'AKK', 'GEN', 'DAT']) {
  for (const pluSin of ['PLU', 'SIN']) {
    for (const masFemNeu of ['MAS', 'FEM', 'NEU']) {
      for (const defIndSol of ['DEF', 'IND', 'SOL']) {
        allAdjGruTags.push('ADJ:' + nomAkkGenDat + ':' + pluSin + ':' + masFemNeu + ':GRU:' + defIndSol);
      }
    }
  }
}

// do not add noun tags to these words, e.g. don't add noun tags to "Wegstrecken" for weg_strecken from spelling.txt:
const nounTagExpansionExceptions: readonly string[] = ['Wegstrecken'];

// ordered by length: 'zurück' > 'zu' + 'rück'
const prefixesSeparableVerbs: readonly string[] = ['gegeneinander', 'durcheinander', 'nebeneinander', 'übereinander', 'aufeinander', 'auseinander', 'beieinander', 'aneinander', 'ineinander', 'zueinander', 'gegenüber', 'beisammen', 'gegenüber', 'hernieder', 'rückwärts', 'wiederauf', 'wiederein', 'wiederher', 'zufrieden', 'zwangsvor', 'entgegen', 'hinunter', 'abhanden', 'aufrecht', 'aufwärts', 'auswärts', 'beiseite', 'danieder', 'drauflos', 'einwärts', 'herunter', 'hindurch', 'verrückt', 'vorwärts', 'zunichte', 'zusammen', 'zwangsum', 'zwischen', 'abseits', 'abwärts', 'entlang', 'hinfort', 'ähnlich', 'daneben', 'general', 'herüber', 'hierher', 'hierhin', 'hinüber', 'schwarz', 'trocken', 'überein', 'vorlieb', 'vorüber', 'wichtig', 'zurecht', 'zuwider', 'hinweg', 'allein', 'besser', 'daheim', 'doppel', 'feinst', 'fertig', 'herauf', 'heraus', 'herbei', 'hinauf', 'hinaus', 'hinein', 'kaputt', 'kennen', 'kürzer', 'mittag', 'nieder', 'runter', 'sicher', 'sitzen', 'voraus', 'vorbei', 'vorweg', 'weiter', 'wieder', 'zugute', 'zurück', 'zwangs', 'abend', 'blank', 'brust', 'dahin', 'davon', 'drauf', 'drein', 'durch', 'einig', 'empor', 'grund', 'herum', 'höher', 'klein', 'knapp', 'krank', 'krumm', 'kugel', 'näher', 'neben', 'offen', 'preis', 'rüber', 'ruhig', 'statt', 'still', 'übrig', 'umher', 'unter', 'voran', 'zweck', 'acht', 'drei', 'fehl', 'feil', 'fort', 'frei', 'groß', 'hand', 'hart', 'heim', 'hier', 'hoch', 'klar', 'lahm', 'miss', 'nach', 'nahe', 'quer', 'rauf', 'raus', 'rein', 'rück', 'satt', 'stoß', 'teil', 'über', 'voll', 'wach', 'wahr', 'warm', 'wert', 'wohl', 'auf', 'aus', 'bei', 'ehe', 'ein', 'eis', 'end', 'her', 'hin', 'los', 'maß', 'mit', 'out', 'ran', 'rum', 'tot', 'vor', 'weg', 'weh', 'ab', 'an', 'da', 'um', 'zu'];
const prefixesSeparableVerbsRegexp = '^(gegeneinander|durcheinander|nebeneinander|übereinander|aufeinander|auseinander|beieinander|aneinander|ineinander|zueinander|gegenüber|beisammen|gegenüber|hernieder|rückwärts|wiederauf|wiederein|wiederher|zufrieden|zwangsvor|entgegen|hinunter|abhanden|aufrecht|aufwärts|auswärts|beiseite|danieder|drauflos|einwärts|herunter|hindurch|verrückt|vorwärts|zunichte|zusammen|zwangsum|zwischen|abseits|abwärts|entlang|hinfort|ähnlich|daneben|general|herüber|hierher|hierhin|hinüber|schwarz|trocken|überein|vorlieb|vorüber|wichtig|zurecht|zuwider|hinweg|allein|besser|daheim|doppel|feinst|fertig|herauf|heraus|herbei|hinauf|hinaus|hinein|kaputt|kennen|kürzer|mittag|nieder|runter|sicher|sitzen|voraus|vorbei|vorweg|weiter|wieder|zugute|zurück|zwangs|abend|blank|brust|dahin|davon|drauf|drein|durch|einig|empor|grund|herum|höher|klein|knapp|krank|krumm|kugel|näher|neben|offen|preis|rüber|ruhig|statt|still|übrig|umher|unter|voran|zweck|acht|drei|fehl|feil|fort|frei|groß|hand|hart|heim|hier|hoch|klar|lahm|miss|nach|nahe|quer|rauf|raus|rein|rück|satt|stoß|teil|über|voll|wach|wahr|warm|wert|wohl|auf|aus|bei|ehe|ein|eis|end|her|hin|los|maß|mit|not|out|ran|rum|tot|vor|weg|weh|ab|an|da|um|zu)';
const prefixesNonSeparableVerbs: readonly string[] = ['be', 'emp', 'ent', 'er', 'hinter', 'miss', 'un', 'ver', 'zer']; //Excludes "ge" (both too rare as verb prefix and prone to FP)
const prefixesNonSeparableVerbsRegexp = '^(be|emp|ent|er|hinter|miss|un|ver|zer)';
const prefixesVerbs: readonly string[] = ['gegeneinander', 'durcheinander', 'nebeneinander', 'übereinander', 'aufeinander', 'auseinander', 'beieinander', 'aneinander', 'ineinander', 'zueinander', 'gegenüber', 'beisammen', 'gegenüber', 'hernieder', 'rückwärts', 'wiederauf', 'wiederein', 'wiederher', 'zufrieden', 'zwangsvor', 'entgegen', 'hinunter', 'abhanden', 'aufrecht', 'aufwärts', 'auswärts', 'beiseite', 'danieder', 'drauflos', 'einwärts', 'herunter', 'hindurch', 'verrückt', 'vorwärts', 'zunichte', 'zusammen', 'zwangsum', 'zwischen', 'abseits', 'abwärts', 'entlang', 'hinfort', 'ähnlich', 'daneben', 'general', 'herüber', 'hierher', 'hierhin', 'hinüber', 'schwarz', 'trocken', 'überein', 'vorlieb', 'vorüber', 'wichtig', 'zurecht', 'zuwider', 'hinweg', 'hinter', 'allein', 'besser', 'daheim', 'doppel', 'feinst', 'fertig', 'herauf', 'heraus', 'herbei', 'hinauf', 'hinaus', 'hinein', 'kaputt', 'kennen', 'kürzer', 'mittag', 'nieder', 'runter', 'sicher', 'sitzen', 'voraus', 'vorbei', 'vorweg', 'weiter', 'wieder', 'zugute', 'zurück', 'zwangs', 'abend', 'blank', 'brust', 'dahin', 'davon', 'drauf', 'drein', 'durch', 'einig', 'empor', 'grund', 'herum', 'höher', 'klein', 'knapp', 'krank', 'krumm', 'kugel', 'näher', 'neben', 'offen', 'preis', 'rüber', 'ruhig', 'statt', 'still', 'übrig', 'umher', 'unter', 'voran', 'zweck', 'miss', 'acht', 'drei', 'fehl', 'feil', 'fort', 'frei', 'groß', 'hand', 'hart', 'heim', 'hier', 'hoch', 'klar', 'lahm', 'miss', 'nach', 'nahe', 'quer', 'rauf', 'raus', 'rein', 'rück', 'satt', 'stoß', 'teil', 'über', 'voll', 'wach', 'wahr', 'warm', 'wert', 'wohl', 'emp', 'ent', 'ver', 'zer', 'auf', 'aus', 'bei', 'ehe', 'ein', 'eis', 'end', 'her', 'hin', 'los', 'maß', 'mit', 'out', 'ran', 'rum', 'tot', 'vor', 'weg', 'weh', 'be', 'er', 'un', 'ab', 'an', 'da', 'um', 'zu'];
const prefixesVerbsRegexp = '^(gegeneinander|durcheinander|nebeneinander|übereinander|aufeinander|auseinander|beieinander|aneinander|ineinander|zueinander|gegenüber|beisammen|gegenüber|hernieder|rückwärts|wiederauf|wiederein|wiederher|zufrieden|zwangsvor|entgegen|hinunter|abhanden|aufrecht|aufwärts|auswärts|beiseite|danieder|drauflos|einwärts|herunter|hindurch|verrückt|vorwärts|zunichte|zusammen|zwangsum|zwischen|abseits|abwärts|entlang|hinfort|ähnlich|daneben|general|herüber|hierher|hierhin|hinüber|schwarz|trocken|überein|vorlieb|vorüber|wichtig|zurecht|zuwider|hinweg|hinter|allein|besser|daheim|doppel|feinst|fertig|herauf|heraus|herbei|hinauf|hinaus|hinein|kaputt|kennen|kürzer|mittag|nieder|runter|sicher|sitzen|voraus|vorbei|vorweg|weiter|wieder|zugute|zurück|zwangs|abend|blank|brust|dahin|davon|drauf|drein|durch|einig|empor|grund|herum|höher|klein|knapp|krank|krumm|kugel|näher|neben|offen|preis|rüber|ruhig|statt|still|übrig|umher|unter|voran|zweck|miss|acht|drei|fehl|feil|fort|frei|groß|hand|hart|heim|hier|hoch|klar|lahm|miss|nach|nahe|quer|rauf|raus|rein|rück|satt|stoß|teil|über|voll|wach|wahr|warm|wert|wohl|emp|ent|ver|zer|auf|aus|bei|ehe|ein|eis|end|her|hin|los|maß|mit|not|out|ran|rum|tot|vor|weg|weh|be|er|un|ab|an|da|um|zu)';
const partizip2contains1PluPra: readonly string[] = ['blasen', 'fahren', 'fallen', 'fangen', 'fressen', 'geben', 'halten', 'kommen', 'laden', 'lassen', 'laufen', 'lesen', 'messen', 'raten',  'schlafen', 'schlagen', 'sehen', 'tragen', 'treten'];
const partizip2contains1PluPrt: readonly string[] = ['bieten', 'bleiben', 'fliegen', 'fließen', 'heben', 'leiden', 'meiden', 'scheiden', 'schließen', 'schreiben', 'stehen', 'steigen', 'streiten', 'treiben', 'weisen', 'ziehen'];
const postagsPartizipEndingE: readonly string[] = ['AKK:PLU:FEM:GRU:SOL:VER', 'AKK:PLU:MAS:GRU:SOL:VER', 'AKK:PLU:NEU:GRU:SOL:VER', 'AKK:SIN:FEM:GRU:DEF:VER', 'AKK:SIN:FEM:GRU:IND:VER', 'AKK:SIN:FEM:GRU:SOL:VER', 'AKK:SIN:NEU:GRU:DEF:VER', 'NOM:PLU:FEM:GRU:SOL:VER', 'NOM:PLU:MAS:GRU:SOL:VER', 'NOM:PLU:NEU:GRU:SOL:VER', 'NOM:SIN:FEM:GRU:DEF:VER', 'NOM:SIN:FEM:GRU:IND:VER', 'NOM:SIN:FEM:GRU:SOL:VER', 'NOM:SIN:MAS:GRU:DEF:VER', 'NOM:SIN:NEU:GRU:DEF:VER'];
const postagsPartizipEndingEm: readonly string[] = ['DAT:SIN:MAS:GRU:SOL:VER', 'DAT:SIN:NEU:GRU:SOL:VER'];
const postagsPartizipEndingEn: readonly string[] = ['AKK:PLU:FEM:GRU:DEF:VER', 'AKK:PLU:FEM:GRU:IND:VER', 'AKK:PLU:MAS:GRU:DEF:VER', 'AKK:PLU:MAS:GRU:IND:VER', 'AKK:PLU:NEU:GRU:DEF:VER', 'AKK:PLU:NEU:GRU:IND:VER', 'AKK:SIN:MAS:GRU:DEF:VER', 'AKK:SIN:MAS:GRU:IND:VER', 'AKK:SIN:MAS:GRU:SOL:VER', 'DAT:PLU:FEM:GRU:DEF:VER', 'DAT:PLU:FEM:GRU:IND:VER', 'DAT:PLU:FEM:GRU:SOL:VER', 'DAT:PLU:MAS:GRU:DEF:VER', 'DAT:PLU:MAS:GRU:IND:VER', 'DAT:PLU:MAS:GRU:SOL:VER', 'DAT:PLU:NEU:GRU:DEF:VER', 'DAT:PLU:NEU:GRU:IND:VER', 'DAT:PLU:NEU:GRU:SOL:VER', 'DAT:SIN:FEM:GRU:DEF:VER', 'DAT:SIN:FEM:GRU:IND:VER', 'DAT:SIN:MAS:GRU:DEF:VER', 'DAT:SIN:MAS:GRU:IND:VER', 'DAT:SIN:NEU:GRU:DEF:VER', 'DAT:SIN:NEU:GRU:IND:VER', 'GEN:PLU:FEM:GRU:DEF:VER', 'GEN:PLU:FEM:GRU:IND:VER', 'GEN:PLU:MAS:GRU:DEF:VER', 'GEN:PLU:MAS:GRU:IND:VER', 'GEN:PLU:NEU:GRU:DEF:VER', 'GEN:PLU:NEU:GRU:IND:VER', 'GEN:SIN:FEM:GRU:DEF:VER', 'GEN:SIN:FEM:GRU:IND:VER', 'GEN:SIN:MAS:GRU:DEF:VER', 'GEN:SIN:MAS:GRU:IND:VER', 'GEN:SIN:MAS:GRU:SOL:VER', 'GEN:SIN:NEU:GRU:DEF:VER', 'GEN:SIN:NEU:GRU:IND:VER', 'GEN:SIN:NEU:GRU:SOL:VER', 'NOM:PLU:FEM:GRU:DEF:VER', 'NOM:PLU:FEM:GRU:IND:VER', 'NOM:PLU:MAS:GRU:DEF:VER', 'NOM:PLU:MAS:GRU:IND:VER', 'NOM:PLU:NEU:GRU:DEF:VER', 'NOM:PLU:NEU:GRU:IND:VER'];
const postagsPartizipEndingEr: readonly string[] = ['DAT:SIN:FEM:GRU:SOL:VER', 'GEN:PLU:FEM:GRU:SOL:VER', 'GEN:PLU:MAS:GRU:SOL:VER', 'GEN:PLU:NEU:GRU:SOL:VER', 'GEN:SIN:FEM:GRU:SOL:VER', 'NOM:SIN:MAS:GRU:IND:VER', 'NOM:SIN:MAS:GRU:SOL:VER', 'DAT:SIN:FEM:GRU:SOL:VER', 'GEN:PLU:FEM:GRU:SOL:VER', 'GEN:PLU:MAS:GRU:SOL:VER', 'GEN:PLU:NEU:GRU:SOL:VER', 'GEN:SIN:FEM:GRU:SOL:VER', 'NOM:SIN:MAS:GRU:IND:VER', 'NOM:SIN:MAS:GRU:SOL:VER'];
const postagsPartizipEndingEs: readonly string[] = ['AKK:SIN:NEU:GRU:IND:VER', 'AKK:SIN:NEU:GRU:SOL:VER', 'NOM:SIN:NEU:GRU:IND:VER', 'NOM:SIN:NEU:GRU:SOL:VER'];
const notAVerb: readonly string[] = ['angebot', 'anteil', 'aufenthalt', 'ausdruck', 'auswärtsspiel', 'beispiel', 'bereich', 'besondere', 'daring', 'einfach', 'einfachst', 'endkasten', 'freibetrag', 'grautöne', 'grüntöne', 'großherzöge', 'großteil', 'hochhaus', 'klarerweise', 'maßnahme', 'mitglieder', 'nachricht', 'nebenfach', 'niederlage', 'nothing', 'notscheid', 'preisver', 'reinweiß', 'schwarzweiß', 'schwarzgrau', 'schwarzgrün', 'schwarztöne', 'unbesiegt', 'unmenge', 'unrat', 'unver', 'verrückterweise', 'versonnen', 'vorlieb', 'vorteil', 'warmweiß', 'wohldefiniert', 'wohlergehen', 'wohlgemerkt', 'zuende', 'zuhause', 'zumal', 'zuver', 'darauf', 'einmal', 'kleinkram', 'hochsicher', 'ehering', 'freitag', 'großmeister', 'handwerk', 'herpes', 'nachfolger'];

const tagsForWeise: string[] = [];
// "kofferweise", "idealerweise" etc.
tagsForWeise.push('ADJ:AKK:PLU:FEM:GRU:SOL');
tagsForWeise.push('ADJ:AKK:PLU:MAS:GRU:SOL');
tagsForWeise.push('ADJ:AKK:PLU:NEU:GRU:SOL');
tagsForWeise.push('ADJ:AKK:SIN:FEM:GRU:DEF');
tagsForWeise.push('ADJ:AKK:SIN:FEM:GRU:IND');
tagsForWeise.push('ADJ:AKK:SIN:FEM:GRU:SOL');
tagsForWeise.push('ADJ:AKK:SIN:NEU:GRU:DEF');
tagsForWeise.push('ADJ:NOM:PLU:FEM:GRU:SOL');
tagsForWeise.push('ADJ:NOM:PLU:MAS:GRU:SOL');
tagsForWeise.push('ADJ:NOM:PLU:NEU:GRU:SOL');
tagsForWeise.push('ADJ:NOM:SIN:FEM:GRU:DEF');
tagsForWeise.push('ADJ:NOM:SIN:FEM:GRU:IND');
tagsForWeise.push('ADJ:NOM:SIN:FEM:GRU:SOL');
tagsForWeise.push('ADJ:NOM:SIN:MAS:GRU:DEF');
tagsForWeise.push('ADJ:NOM:SIN:NEU:GRU:DEF');
tagsForWeise.push('ADJ:PRD:GRU');

let expansionInfosValue: ExpansionInfos | null = null;
const expansionInfos = { get: (): ExpansionInfos => (expansionInfosValue ??= GermanTagger.initExpansionInfos()) };

let instance: GermanTagger | null = null;

/**
 * German part-of-speech tagger, requires data file in <code>de/german.dict</code> in the classpath.
 * The POS tagset is described in
 * <a href="https://github.com/languagetool-org/languagetool/blob/master/languagetool-language-modules/de/src/main/resources/org/languagetool/resource/de/tagset.txt">tagset.txt</a>
 *
 * @author Marcin Milkowski, Daniel Naber
 */
export class GermanTagger extends BaseTagger {

  private readonly removalTagger: ManualTagger | null;

  static get INSTANCE(): GermanTagger {
    return (instance ??= new GermanTagger());
  }

  constructor() {
    super('/de/german.dict', Locale.GERMAN);
    this.removalTagger = (this.getWordTagger() as CombiningTagger).getRemovalTagger() as ManualTagger | null;
  }

  /** @internal (private static in Java; called by the memoized supplier) */
  static initExpansionInfos(): ExpansionInfos {
    const verbInfos = new Map<string, PrefixInfixVerb>();
    const nominalizedVerbInfos = new Map<string, NominalizedVerb>();
    const nominalizedGenVerbInfos = new Map<string, NominalizedGenitiveVerb>();
    const adjInfos = new Map<string, AdjInfo[]>();
    const filename = 'de/hunspell/spelling.txt';
    const spellingWords = new CachingWordListLoader().loadWords(filename);
    for (const line of spellingWords) {
      // '/A' adds the typical adjective endings, so assume it's an adjective:
      if (line.endsWith('/PA') || line.endsWith('/AP')) {
        throw new Error("RuntimeException: Use '/P' or '/A', but not both for a word in " + filename + ': ' + line);
      } if (line.endsWith('/P')) {
        const word = StringReplaceFirst(line, '/.*', '');
        GermanTagger.fillAdjInfos(word, '', GermanTagger.toPA2(AdjectiveTags.tagsForAdj), adjInfos);
        GermanTagger.fillAdjInfos(word, 'e', GermanTagger.toPA2(AdjectiveTags.tagsForAdjE), adjInfos);
        GermanTagger.fillAdjInfos(word, 'en', GermanTagger.toPA2(AdjectiveTags.tagsForAdjEn), adjInfos);
        GermanTagger.fillAdjInfos(word, 'er', GermanTagger.toPA2(AdjectiveTags.tagsForAdjEr), adjInfos);
        GermanTagger.fillAdjInfos(word, 'em', GermanTagger.toPA2(AdjectiveTags.tagsForAdjEm), adjInfos);
        GermanTagger.fillAdjInfos(word, 'es', GermanTagger.toPA2(AdjectiveTags.tagsForAdjEs), adjInfos);
      } else if (line.endsWith('/A') &&
          !line.endsWith('ste/A') &&  // don't tag e.g. "fünftjünste/A", would miss the comparative tagging
          !line.endsWith('er/A')) {   // don't tag e.g. "margenstärker/A", would miss the comparative tagging
        const word = StringReplaceFirst(line, '/.*', '');
        GermanTagger.fillAdjInfos(word, '', AdjectiveTags.tagsForAdj, adjInfos);
        GermanTagger.fillAdjInfos(word, 'e', AdjectiveTags.tagsForAdjE, adjInfos);
        GermanTagger.fillAdjInfos(word, 'en', AdjectiveTags.tagsForAdjEn, adjInfos);
        GermanTagger.fillAdjInfos(word, 'er', AdjectiveTags.tagsForAdjEr, adjInfos);
        GermanTagger.fillAdjInfos(word, 'em', AdjectiveTags.tagsForAdjEm, adjInfos);
        GermanTagger.fillAdjInfos(word, 'es', AdjectiveTags.tagsForAdjEs, adjInfos);
      } else if (line.includes('_') && !line.endsWith('_in')) {
        const parts = StringSplit(StringTrim(line.replaceAll('#.*', '')), '_');  // String.replace: a literal
        const prefix = parts[0]!;
        const verbBaseform = parts[1]!;
        const forms = GermanSynthesizer.INSTANCE.synthesizeForPosTags(verbBaseform, (s) => s.startsWith('VER:'));
        for (const form of forms) {
          if (!form.includes('ß')) {  // skip these, it's too risky to introduce old spellings like "gewußt" from the synthesizer
            verbInfos.set(prefix + form, new PrefixInfixVerb(prefix, '', verbBaseform));
          }
        }
        verbInfos.set(prefix + 'zu' + verbBaseform, new PrefixInfixVerb(prefix, 'zu', verbBaseform));  //  "zu<verb>" is not part of forms from synthesizer
        nominalizedVerbInfos.set(uppercaseFirstChar(prefix) + verbBaseform,
          new NominalizedVerb(uppercaseFirstChar(prefix), verbBaseform));
        nominalizedGenVerbInfos.set(uppercaseFirstChar(prefix) + verbBaseform + 's',
          new NominalizedGenitiveVerb(uppercaseFirstChar(prefix), verbBaseform));
      }
    }
    return new ExpansionInfos(verbInfos, nominalizedVerbInfos, nominalizedGenVerbInfos, adjInfos);
  }

  private static toPA2(tags: readonly string[]): string[] {
    return tags.
      map((k) => k.replaceAll('ADJ:', 'PA2:')).
      map((k) => k + ':VER');
  }

  private static fillAdjInfos(word: string, suffix: string, tagsForForm: readonly string[], adjInfos: Map<string, AdjInfo[]>): void {
    const l: AdjInfo[] = [];
    const fullform = word + suffix;
    for (const tag of tagsForForm) {
      l.push(new AdjInfo(word, fullform, tag));
    }
    adjInfos.set(fullform, l);
  }

  private addStem(analyzedWordResults: TaggedWord[], stem: string): TaggedWord[] {
    const result: TaggedWord[] = [];
    for (const tw of analyzedWordResults) {
      let lemma = tw.getLemma();
      if (stem.length > 0 && stem.charAt(stem.length - 1) !== '-' && tw.getPosTag()!.startsWith('SUB')) {
        lemma = lemma!.toLowerCase();
      }
      result.push(new TaggedWord(stem + lemma, tw.getPosTag()));
    }
    return result;
  }

  //Removes the irrelevant part of dash-linked words (SSL-Zertifikat -> Zertifikat)
  private sanitizeWord(word: string): string {
    let result = word;

    //Find the last part of the word that is not nothing
    //Skip words ending in a dash as they'll be misrecognized
    if (!word.endsWith('-')) {
      const splitWord = StringSplit(word, '-');
      let lastPart = splitWord.length > 1 && !(StringTrim(splitWord[splitWord.length - 1]!) === '') ? splitWord[splitWord.length - 1]! : word;

      //Find only the actual important part of the word
      const compoundedWord = GermanCompoundTokenizer.getStrictInstance().tokenize(lastPart);
      if (compoundedWord.length > 1 && StringTools.startsWithUppercase(word)) {  // don't uppercase last part of e.g. "vanillig-karamelligen"
        lastPart = uppercaseFirstChar(compoundedWord[compoundedWord.length - 1]!);
      } else {
        lastPart = compoundedWord[compoundedWord.length - 1]!;
      }

      //Only give result if the last part is either a noun or an adjective (or adjective written in Uppercase)
      const tagged = this.tag(lastPart);
      if (tagged.length > 0 && (StringUtils_startsWithAny(tagged[0]!.getPosTag(), 'SUB', 'ADJ') || this.matchesUppercaseAdjective(lastPart))) {
        result = lastPart;
      }
    }
    return result;
  }

  /**
   * Return only the first reading of the given word or {@code null}.
   */
  lookup(word: string): AnalyzedTokenReadings | null {
    const result = this.tag([word], false);
    const atr = result[0]!;
    if (atr.getAnalyzedToken(0).getPOSTag() == null) {
      return null;
    }
    return atr;
  }

  private matchesUppercaseAdjective(unknownUppercaseToken: string): boolean {
    const temp = this.getWordTagger().tag(StringTools.lowercaseFirstChar(unknownUppercaseToken));
    return temp.length > 0 && temp[0]!.getPosTag()!.startsWith('ADJ');
  }

  /** tag(String word): the word tagger's result */
  override tag(word: string): TaggedWord[];
  override tag(sentenceTokens: string[], ignoreCase?: boolean): AnalyzedTokenReadings[];
  override tag(wordOrSentenceTokens: string | string[], ignoreCase = true): TaggedWord[] | AnalyzedTokenReadings[] {
    if (typeof wordOrSentenceTokens === 'string') {
      return this.getWordTagger().tag(wordOrSentenceTokens);
    }
    const sentenceTokens = wordOrSentenceTokens;
    let firstWord = true;
    const tokenReadings: AnalyzedTokenReadings[] = [];
    let pos = 0;
    let idxPos = 0;

    let prevWord: string | null = null;
    for (let word of sentenceTokens) {
      const readings: AnalyzedToken[] = [];
      let taggerTokens: TaggedWord[] | null = null;
      // Gender star etc:
      if (idxPos+2 < sentenceTokens.length && P().genderGapChars.matcher(sentenceTokens[idxPos + 1]!).matches()) {
        if (P().afterAsterisk.matcher(sentenceTokens[idxPos + 2]!).matches()) {  // "jede*r", "sein*e"
          taggerTokens = [];
          taggerTokens.push(...this.getWordTagger().tag(word));
          taggerTokens.push(...this.getWordTagger().tag(word + sentenceTokens[idxPos+2]));
        } else if (P().innenPattern1.matcher(sentenceTokens[idxPos + 2]!).matches()) {
          // e.g. Werkstudent:innen-Zielgruppe -> take tags of 'Zielgruppe':
          const lastPart = P().anythingDash.matcher(sentenceTokens[idxPos + 2]!).replaceFirst('');
          taggerTokens = [...this.getWordTagger().tag(lastPart)];
        } else if (P().innenPattern2.matcher(sentenceTokens[idxPos + 2]!).matches()) {
          // e.g. Werkstudent:innenzielgruppe -> take tags of 'Zielgruppe':
          const idx = sentenceTokens[idxPos+2]!.lastIndexOf('innen');
          const lastPart = uppercaseFirstChar(sentenceTokens[idxPos+2]!.substring(idx + 'innen'.length));
          taggerTokens = [...this.getWordTagger().tag(lastPart)];
        }
      }
      if (taggerTokens == null) {
        taggerTokens = this.getWordTagger().tag(word);
      }

      //Only first iteration. Consider ":" as a potential sentence start marker
      if ((firstWord || ':' === prevWord) && taggerTokens.length === 0 && ignoreCase) { // e.g. "Das" -> "das" at start of sentence
        taggerTokens = this.getWordTagger().tag(word.toLowerCase());
        firstWord = !StringUtils_isAlphanumeric(word);
      } else if (pos === 0 && ignoreCase) {   // "Haben", "Sollen", "Können", "Gerade" etc. at start of sentence
        taggerTokens.push(...this.getWordTagger().tag(word.toLowerCase()));
      } else if (pos > 1 && taggerTokens.length === 0 && ignoreCase) {
        const idx = sentenceTokens.indexOf(word);
        // add lowercase token readings to words at start of direct speech
        if (idx > 2 && sentenceTokens[idx-1] === '„' && sentenceTokens[idx-3] === ':') {
          taggerTokens.push(...this.getWordTagger().tag(word.toLowerCase()));
        }
      }

      if (taggerTokens.length > 0) { //Word known, just add analyzed token to readings
        readings.push(...this.getAnalyzedTokens(taggerTokens, word));
        /*
         * Lines 263 to 287
         * do the following for non separable verbs with prefix and for verbs without any prefix:
         *   if (base) verb has tag 'VER:IMP:SIN:SFT', then add 'VER:1:SIN:PRÄ:SFT'
         *   if (base) verb has tag 'VER:1:SIN:PRÄ:SFT', then add 'VER:IMP:SIN:SFT'
         *
         * 'NON' is excluded, because for a given lemma 'VER:IMP:SIN:NON' and 'VER:1:SIN:PRÄ:NON' can differ
         * e. g. (ver)nimm is 'VER:IMP:SIN:NON', but (ver)nehm is 'VER:1:SIN:PRÄ:NON'
         */
        if (!StringUtils_startsWithAny(word.toLowerCase(), prefixesSeparableVerbs)
          && (!StringUtils_startsWithAny(word.toLowerCase(), notAVerb))
          && (word === word.substring(0, 1).toUpperCase() + word.substring(1).toLowerCase() || word === word.toLowerCase())) {
            let lstPrt = '';
            let frstPrt = '';
            if (StringUtils_startsWithAny(word.toLowerCase(), prefixesNonSeparableVerbs)) {
              lstPrt = RegExUtils_removePattern(word.toLowerCase(), prefixesNonSeparableVerbsRegexp);
              frstPrt = StringUtils_removeEnd(word, lstPrt);
            } else {
              lstPrt = word;
              frstPrt = '';
            }
            const verbs = this.getWordTagger().tag(lstPrt);
            for (const v of verbs) {
              if ((sentenceTokens.indexOf(word) === 0 || word === word.substring(0, 1).toLowerCase() + word.substring(1))
                && !StringUtils_equalsAny(lstPrt, 'gar', 'mal', 'null', 'trotz')) {
                  if (StringUtils_startsWithAny(v.getPosTag(), 'VER:IMP:SIN:SFT') && (!listToString(readings).includes('VER:1:SIN:PRÄ:SFT'))) {
                    readings.push(new AnalyzedToken(word, 'VER:1:SIN:PRÄ:SFT', frstPrt.toLowerCase() + v.getLemma()));
                  }
                  if (StringUtils_startsWithAny(v.getPosTag(), 'VER:1:SIN:PRÄ:SFT') && (!listToString(readings).includes('VER:IMP:SIN:SFT'))) {
                    readings.push(new AnalyzedToken(word, 'VER:IMP:SIN:SFT', frstPrt.toLowerCase() + v.getLemma()));
                  }
              }
            }
        }
      } else { // Word not known, try to decompose it and use the last part for POS tagging:
        const verbInfo = expansionInfos.get().verbInfos.get(word) ?? null;
        const nomVerbInfo = expansionInfos.get().nominalizedVerbInfos.get(word) ?? null;
        const nomGenVerbInfo = expansionInfos.get().nominalizedGenVerbInfos.get(word) ?? null;
        const adjInfos = expansionInfos.get().adjInfos.get(word) ?? null;
        const addNounTags = !nounTagExpansionExceptions.includes(word);
        //String prefixVerbLastPart = prefixedVerbLastPart(word);   // see https://github.com/languagetool-org/languagetool/issues/2740
        if (verbInfo != null) {   // e.g. "herumgeben" with "herum_geben" in spelling.txt
          if (StringTools.startsWithLowercase(verbInfo.prefix)) {
            const noPrefixForm = word.substring(verbInfo.prefix.length + verbInfo.infix.length);   // infix can be "zu"
            const tags = this.tag(noPrefixForm);
            let isSFT = false;  // SFT = schwaches Verb
            for (const tag of tags) {
              if (tag.getPosTag() != null && (StringUtils_startsWithAny(tag.getPosTag(), 'VER:', 'PA1:', 'PA2:')
                && (!StringUtils_startsWithAny(tag.getPosTag(), 'VER:MOD', 'VER:AUX')))) { // e.g. "schicke" is verb and adjective
                const flektion = tag.getPosTag()!.substring(tag.getPosTag()!.length - 3);
                if (StringUtils_startsWithAny(verbInfo.prefix, prefixesSeparableVerbs)
                  && (!StringUtils_containsAny(word, notAVerb))) {
                  if (StringUtils_startsWithAny(tag.getPosTag(), 'VER:1', 'VER:2', 'VER:3') && (sentenceTokens.indexOf(word) === 0 || word === word.substring(0, 1).toLowerCase() + word.substring(1))) {
                    readings.push(new AnalyzedToken(word, tag.getPosTag() + ':NEB', verbInfo.prefix + tag.getLemma()));
                  } else if (!StringUtils_startsWithAny(tag.getPosTag(), 'VER:IMP')) {
                    readings.push(new AnalyzedToken(word, tag.getPosTag(), verbInfo.prefix + tag.getLemma()));
                  } else if (StringUtils_startsWithAny(tag.getPosTag(), 'VER:IMP:SIN') && (!List_contains(readings, 'VER:1:SIN:PRÄ'))) {
                    if (flektion === 'SFT' || !StringMatches(word, '.*i.+')) { // Avoids 'aufnimm'
                      readings.push(new AnalyzedToken(word, 'VER:1:SIN:PRÄ:' + flektion + ':NEB', verbInfo.prefix + tag.getLemma()));
                    }
                  }
                } else if (StringUtils_startsWithAny(verbInfo.prefix, prefixesNonSeparableVerbs) //Excludes "ge" (both too rare as verb prefix and prone to FP)
                  && (!StringUtils_containsAny(word, notAVerb))) {
                    if ((StringUtils_startsWithAny(tag.getPosTag(), 'VER:IMP:SIN') && (!List_contains(readings, 'VER:1:SIN:PRÄ')))
                       || (StringUtils_startsWithAny(tag.getPosTag(), 'VER:1:SIN:PRÄ') && (!List_contains(readings, 'VER:IMP:SIN')))) {
                         if (flektion === 'SFT' || !StringMatches(word, '.*i.+')) { // Avoids 'zernimm'
                           readings.push(new AnalyzedToken(word, 'VER:IMP:SIN' + flektion, verbInfo.prefix + tag.getLemma()));
                           readings.push(new AnalyzedToken(word, 'VER:1:SIN:PRÄ:' + flektion, verbInfo.prefix + tag.getLemma()));
                         }
                    } else {
                      readings.push(new AnalyzedToken(word, tag.getPosTag(), verbInfo.prefix + tag.getLemma()));
                    }
                }
                if (tag.getPosTag()!.includes(':SFT')) {
                  isSFT = true;
                }
              }
            }
            if ('zu' === verbInfo.infix) {
              readings.length = 0;
              readings.push(new AnalyzedToken(word, 'VER:EIZ:' + (isSFT ? 'SFT' : 'NON'), verbInfo.prefix + verbInfo.verbBaseform));
            }
          }
        } else if (nomVerbInfo != null && addNounTags) {
          // e.g. "herum_geben" in spelling.txt -> "(das) Herumgeben"
          readings.push(new AnalyzedToken(word, 'SUB:NOM:SIN:NEU:INF', nomVerbInfo.prefix + nomVerbInfo.verbBaseform));
          readings.push(new AnalyzedToken(word, 'SUB:AKK:SIN:NEU:INF', nomVerbInfo.prefix + nomVerbInfo.verbBaseform));
          readings.push(new AnalyzedToken(word, 'SUB:DAT:SIN:NEU:INF', nomVerbInfo.prefix + nomVerbInfo.verbBaseform));
        } else if (nomGenVerbInfo != null && addNounTags) {
          // e.g. "herum_geben" in spelling.txt -> "(des) Herumgebens"
          readings.push(new AnalyzedToken(word, 'SUB:GEN:SIN:NEU:INF', nomGenVerbInfo.prefix + nomGenVerbInfo.verbBaseform));
        /*} else if (prefixVerbLastPart != null) {   // "aufstöhnen" etc.
          List<TaggedWord> taggedWords = getWordTagger().tag(prefixVerbLastPart);
          String firstPart = word.replaceFirst(prefixVerbLastPart + "$", "");
          for (TaggedWord taggedWord : taggedWords) {
            readings.add(new AnalyzedToken(word, taggedWord.getPosTag(), firstPart+taggedWord.getLemma()));
          }*/
        } else if (adjInfos != null) {
          for (const adjInfo of adjInfos) {
            readings.push(new AnalyzedToken(adjInfo.fullForm, adjInfo.tag, adjInfo.baseform));
          }
        } else if (this.isWeiseException(word)) {   // "idealerweise" etc. but not "überweise", "eimerweise"
          for (const tag of tagsForWeise) {
            readings.push(new AnalyzedToken(word, tag, word));
          }
        } else if (!StringUtils_isAllBlank(word) && P().mitarbeitendenPattern.matcher(word).matches()) {
          const idx = word.indexOf('mitarbeitende');
          const firstPart = word.substring(0, idx);  // we might tag invalid words, but that should be okay
          const lastPart = word.substring(idx);
          const mitarbeitendeTags = this.getWordTagger().tag(uppercaseFirstChar(lastPart));
          for (const mitarbeitendeTag of mitarbeitendeTags) {
            readings.push(new AnalyzedToken(word, mitarbeitendeTag.getPosTag(), firstPart+'mitarbeitende'));
          }
        } else if (!StringUtils_isAllBlank(word)) {
          const compoundParts = GermanCompoundTokenizer.getStrictInstance().tokenize(word);
          if (compoundParts.length <= 1) {//Could not find simple compound parts
            // Recognize alternative imperative forms (e.g., "Geh bitte!" in addition to "Gehe bitte!")
            const imperativeFormList = this.getImperativeForm(word, sentenceTokens, pos);
            const substantivatedFormsList = this.getSubstantivatedForms(word, sentenceTokens);
            if (imperativeFormList.length > 0) {
              readings.push(...imperativeFormList);
            } else if (substantivatedFormsList.length > 0) {
              readings.push(...substantivatedFormsList);
            } else {
              if (StringUtils_startsWithAny(word, 'bitter', 'dunkel', 'erz', 'extra', 'früh',
                'gemein', 'hyper', 'lau', 'mega', 'minder', 'stock', 'super', 'tod', 'ultra', 'un', 'ur')) {
                const lastPart = RegExUtils_removePattern(word, '^(bitter|dunkel|erz|extra|früh|gemein|grund|hyper|lau|mega|minder|stock|super|tod|ultra|u[nr]|voll)');
                if (lastPart.length > 3) {
                  const firstPart = StringUtils_removeEnd(word, lastPart);
                  const taggedWords = this.getWordTagger().tag(lastPart);
                  for (const taggedWord of taggedWords) {
                    if (!(firstPart.length === 2 && taggedWord.getPosTag()!.startsWith('VER'))) {
                      readings.push(new AnalyzedToken(word, taggedWord.getPosTag(), firstPart+taggedWord.getLemma()));
                    }
                  }
                }
              }
              //Separate dash-linked words
              //Only check single word tokens and skip words containing numbers because it's unpredictable
              if (StringUtils_split(word, ' ').length === 1 && !Character.isDigit(word.charAt(0))) {
                const wordOrig = word;
                word = this.sanitizeWord(word);
                const wordStem = wordOrig.substring(0, wordOrig.length - word.length);

                //Tokenize, start word uppercase if it's a result of splitting
                const compoundedWord = GermanCompoundTokenizer.getStrictInstance().tokenize(word);
                if (compoundedWord.length > 1) {
                  word = uppercaseFirstChar(compoundedWord[compoundedWord.length - 1]!);
                } else {
                  word = compoundedWord[compoundedWord.length - 1]!;
                }

                let linkedTaggerTokens = this.addStem(this.getWordTagger().tag(word), wordStem); //Try to analyze the last part found

                //Some words that are linked with a dash ('-') will be written in uppercase, even adjectives
                if (wordOrig.includes('-') && linkedTaggerTokens.length === 0 && this.matchesUppercaseAdjective(word)) {
                  word = StringTools.lowercaseFirstChar(word);
                  linkedTaggerTokens = this.getWordTagger().tag(word);
                }

                word = wordOrig;

                const wordStartsUppercase = StringTools.startsWithUppercase(word);
                if (linkedTaggerTokens.length === 0) {
                  /*
                   *Verbs with certain prefixes (e. g. "ab", "ein", "zwischen") are always separable.
                   *For better performance of rules, forms like 'einlädst' and 'lädst ein' should be tagged differently.
                   *einlädst [VER:2:SIN:PRÄ:NON:NEB] ('NEB' indicates that this form can only appear in a subordinate clause)
                   *lädst ein [VER:2:SIN:PRÄ:NON] + [ZUS]
                   */
                  if (StringUtils_startsWithAny(word.toLowerCase(), prefixesVerbs)
                     && (!StringUtils_containsAny(word.toLowerCase(), notAVerb))
                     && (word === word.substring(0, 1).toUpperCase() + word.substring(1).toLowerCase() || word === word.toLowerCase())) { // avoids CamelCase, ALLCAPS...
                       const lastPart = RegExUtils_removePattern(word.toLowerCase(), prefixesVerbsRegexp);
                      if (lastPart.length > 2) { // e. g. 'kau', 'iss', 'ess'
                        const firstPart = StringUtils_removeEnd(word, lastPart);
                        //Erweiterter Infinitiv mit zu
                        if (StringUtils_startsWithAny(lastPart, 'zu')) {
                          const infinitiv = StringUtils_removeStart(lastPart, 'zu');
                          const infs = this.getWordTagger().tag(infinitiv);
                          for (const inf of infs) {
                            if (inf.getPosTag()!.startsWith('VER:INF')) {
                              const pstg = RegExUtils_replaceFirst(inf.getPosTag()!, 'INF', 'EIZ');
                              readings.push(new AnalyzedToken(word, pstg, firstPart + inf.getLemma()));
                            }
                          }
                        }
                        // Checks for postag information in the last part of given word
                        const taggedWords = this.getWordTagger().tag(lastPart);
                        for (const taggedWord of taggedWords) {
                          const posTag = taggedWord.getPosTag()!;
                          if ((posTag.startsWith('VER') && (!posTag.startsWith('VER:PA')))
                            && (!posTag.startsWith('VER:AUX'))
                            && (!posTag.startsWith('VER:MOD'))
                            && (!(firstPart === 'un'))) { // avoids 'unbeeindruckt' -> VER.*
                              if (posTag.startsWith('VER:INF')) {
                                if (word === word.substring(0, 1).toUpperCase() + word.substring(1)) {
                                  readings.push(new AnalyzedToken(word, 'SUB:NOM:SIN:NEU:INF', word));
                                  readings.push(new AnalyzedToken(word, 'SUB:DAT:SIN:NEU:INF', word));
                                  readings.push(new AnalyzedToken(word, 'SUB:AKK:SIN:NEU:INF', word));
                                  if (sentenceTokens.indexOf(word) === 0) {
                                    readings.push(new AnalyzedToken(word, posTag, firstPart.toLowerCase() + taggedWord.getLemma()));
                                  }
                                } else {
                                  readings.push(new AnalyzedToken(word, posTag, firstPart.toLowerCase() + taggedWord.getLemma()));
                                }
                              } else if (posTag.startsWith('VER:IMP')) {
                                const flekt = posTag.substring(posTag.length - 3);
                                if ((word === word.toLowerCase() || sentenceTokens.indexOf(word) === 0)) {
                                  if (!StringUtils_equalsAny(firstPart.toLowerCase(), prefixesSeparableVerbs)) { // Separable verbs do not have imperative form.
                                    readings.push(new AnalyzedToken(word, posTag, firstPart.toLowerCase() + taggedWord.getLemma()));
                                    if (posTag.startsWith('VER:IMP:SIN') && !List_contains(readings, 'VER:1:SIN:PRÄ')) {
                                      if (!List_contains(readings, 'VER:IMP:SIN:NON')) {
                                        readings.push(new AnalyzedToken(word, 'VER:1:SIN:PRÄ:' + flekt, firstPart + taggedWord.getLemma()));
                                      }
                                    }
                                  } else if (!List_contains(readings, 'VER:1:SIN:PRÄ') && (flekt === 'SFT' || !StringMatches(word, '.*i.+'))) {
                                    readings.push(new AnalyzedToken(word, 'VER:1:SIN:PRÄ:' + flekt + ':NEB', firstPart + taggedWord.getLemma()));
                                  }
                                }
                              } else if (StringUtils_equalsAny(firstPart.toLowerCase(), prefixesSeparableVerbs)
                                && (word === word.toLowerCase() || sentenceTokens.indexOf(word) === 0)) {
                                  if (posTag.endsWith(':NEB')) {
                                    readings.push(new AnalyzedToken(word, posTag, firstPart.toLowerCase() + taggedWord.getLemma()));
                                  } else {
                                    readings.push(new AnalyzedToken(word, posTag + ':NEB', firstPart.toLowerCase() + taggedWord.getLemma()));
                                  }
                                  if (posTag.startsWith('VER:3:SIN:PRÄ')
                                    && (firstPart === 'durch' || firstPart === 'um')) {
                                      /*
                                       / Verbs with prefixes 'durch' or 'um'
                                       / can be both separable and non separable
                                       / 'Tom läuft durch den Wald'
                                       / 'Tom durchläuft eine Durststrecke'
                                       / This avoids false alarms
                                      */
                                      if (posTag.startsWith('VER:3:SIN:PRÄ')) {
                                        readings.push(new AnalyzedToken(word, 'VER:PA2:SFT', firstPart + taggedWord.getLemma()));
                                      } else {
                                        readings.push(new AnalyzedToken(word, 'VER:PA2:NON', firstPart + taggedWord.getLemma()));
                                      }
                                      readings.push(new AnalyzedToken(word, 'PA2:PRD:GRU:VER', word));
                                  }
                              } else if (StringUtils_equalsAny(firstPart.toLowerCase(), prefixesNonSeparableVerbs)
                                && (word === word.toLowerCase() || sentenceTokens.indexOf(word) === 0)) {
                                  readings.push(new AnalyzedToken(word, posTag, firstPart.toLowerCase() + taggedWord.getLemma()));
                                  /*
                                   / Postag of 'lastPart' never starts with PA2: erstickt = er + stickt
                                   / Derives 'VER:PA2:SFT' and 'PA2:PRD:GRU:VER', if postag of 'lastPart' equals 'VER:3:SIN:PRÄ:SFT'
                                   / Using other postags is not safe, especially 'VER.*NON'
                                  */
                                  if (posTag.startsWith('VER:3:SIN:PRÄ:SFT')
                                    || (posTag.startsWith('VER:1:PLU:PRÄ:NON') && (StringUtils_containsAny(taggedWord.getLemma(), partizip2contains1PluPra)))
                                    || (posTag.startsWith('VER:1:PLU:PRT:NON') && (StringUtils_containsAny(taggedWord.getLemma(), partizip2contains1PluPrt)))) {
                                      if (!(firstPart === 'un')) { // Avoids 'unbeeindruckt' -> 'VER.*'
                                        const fl = posTag.substring(posTag.length - 3);
                                        readings.push(new AnalyzedToken(word, 'VER:PA2:' + fl, firstPart + taggedWord.getLemma()));
                                      }
                                      readings.push(new AnalyzedToken(word, 'PA2:PRD:GRU:VER', word));
                                  }
                              }
                          } else if (((posTag.startsWith('PA') || posTag.startsWith('VER:PA'))
                            && (word === word.toLowerCase() || sentenceTokens.indexOf(word) === 0))) {
                              if (!(firstPart === 'un' && posTag.startsWith('VER:PA'))) {
                                readings.push(new AnalyzedToken(word, posTag, firstPart.toLowerCase() + taggedWord.getLemma()));
                              }
                          }
                        }
                        // Checks for postag information in the last part of given word
                        /*
                         / Postag of 'lastPart' never starts with PA2: erstickter = er + stickter
                         / Derives 'PA2:[NGDA].*', if word has
                         / suffix 'e[mnrs]?' and
                         / 'middlePart' has tagging 'VER:3:SIN:PRÄ:SFT'
                         / e. g. erstickter = er + stickt + er
                        */
                        const partizipSuffixes = ['e', 'em', 'en', 'er', 'es'];
                        let middlePart = '';
                        let suffix = '';
                        for (const sffx of partizipSuffixes) {
                          if (lastPart.endsWith(sffx)){
                            middlePart = lastPart.substring(0, lastPart.length-sffx.length);
                            suffix = sffx;
                          }
                        }
                        const taggedMiddle = this.getWordTagger().tag(middlePart);
                        for (const taggedM of taggedMiddle) {
                          if (taggedM.getPosTag()!.startsWith('VER:3:SIN:PRÄ:SFT')
                            && (word === word.toLowerCase() || sentenceTokens.indexOf(word) === 0)) {
                              const lemma = word.substring(0, word.length-suffix.length);
                              switch (suffix) {
                                case 'e':
                                  for (const posEndsWithE of postagsPartizipEndingE) {
                                    readings.push(new AnalyzedToken(word, 'PA2:'+posEndsWithE, lemma));
                                  }
                                  break;
                                case 'em':
                                  for (const posEndsWithEm of postagsPartizipEndingEm) {
                                    readings.push(new AnalyzedToken(word, 'PA2:'+posEndsWithEm, lemma));
                                  }
                                  break;
                                case 'en':
                                  for (const posEndsWithEn of postagsPartizipEndingEn) {
                                    readings.push(new AnalyzedToken(word, 'PA2:'+posEndsWithEn, lemma));
                                  }
                                  break;
                                case 'er':
                                  for (const posEndsWithEr of postagsPartizipEndingEr) {
                                    readings.push(new AnalyzedToken(word, 'PA2:'+posEndsWithEr, lemma));
                                  }
                                  break;
                                case 'es':
                                  for (const posEndsWithEs of postagsPartizipEndingEs) {
                                    readings.push(new AnalyzedToken(word, 'PA2:'+posEndsWithEs, lemma));
                                  }
                                  break;
                              }
                          }
                        }
                      }
                  } else {
                    readings.push(this.getNoInfoToken(word));
                  }
                } else {
                  if (wordStartsUppercase) { //Choose between uppercase/lowercase Lemma
                    readings.push(...this.getAnalyzedTokens(linkedTaggerTokens, word));
                  } else {
                    readings.push(...this.getAnalyzedTokens(linkedTaggerTokens, word, compoundedWord));
                  }
                }
              } else {
                readings.push(this.getNoInfoToken(word));
              }
            }
          } else if (!(idxPos+2 < sentenceTokens.length && sentenceTokens[idxPos+1] === '.' && StringMatches(sentenceTokens[idxPos+2]!, 'com|net|org|de|at|ch|fr|uk|gov'))) {  // TODO: find better way to ignore domains
            // last part governs a word's POS:
            let lastPart = compoundParts[compoundParts.length - 1]!;
            if (StringTools.startsWithUppercase(word) && !StringUtils_containsAny(lastPart, 'freie', 'freier', 'freien', 'freies', 'freiem')) {
              lastPart = uppercaseFirstChar(lastPart);
            }
            const partTaggerTokens = this.getWordTagger().tag(lastPart);
            if (partTaggerTokens.length === 0) {
              readings.push(this.getNoInfoToken(word));
            } else {
              let temp = this.getAnalyzedTokens(partTaggerTokens, word, compoundParts);
              const firstPart = compoundParts[0]!;
              const prfxs: string[] = ['ab', 'abend', 'abhanden', 'acht', 'ähnlich', 'allein', 'an', 'auf', 'aufeinander', 'aufrecht', 'aufwärts', 'aus', 'auseinander', 'auswärts', 'bei', 'beieinander', 'beisammen', 'beiseite', 'besser', 'blank', 'brust', 'da', 'daheim', 'dahin', 'daneben', 'danieder', 'davon', 'doppel', 'drauflos', 'drei', 'drein', 'durch', 'durcheinander', 'ehe', 'ein', 'einig', 'einwärts', 'eis', 'empor', 'end', 'fehl', 'feil', 'feinst', 'fort', 'frei', 'gegenüber', 'general', 'groß', 'grund', 'hand', 'hart', 'heim', 'her', 'herauf', 'heraus', 'herbei', 'hernieder', 'herüber', 'herum', 'herunter', 'hier', 'hierher', 'hierhin', 'hin', 'hinauf', 'hinaus', 'hindurch', 'hinein', 'hinüber', 'hoch', 'höher', 'ineinander', 'kaputt', 'kennen', 'klar', 'klein', 'knapp', 'krank', 'krumm', 'kugel', 'kürzer', 'lahm', 'los', 'maß', 'miss', 'mit', 'mittag', 'nach', 'nahe', 'näher', 'neben', 'nebeneinander', 'nieder', 'offen', 'out', 'preis', 'quer', 'ran', 'rauf', 'raus', 'rein', 'rüber', 'rück', 'rückwärts', 'ruhig', 'rum', 'runter', 'satt', 'schwarz', 'sicher', 'sitzen', 'statt', 'still', 'stoß', 'teil', 'tot', 'trocken', 'über', 'überein', 'übereinander', 'übrig', 'um', 'umher', 'unter', 'verrückt', 'voll', 'vor', 'voran', 'voraus', 'vorbei', 'vorlieb', 'vorüber', 'vorwärts', 'vorweg', 'wach', 'wahr', 'warm', 'weg', 'weh', 'weiter', 'wert', 'wichtig', 'wieder', 'wiederauf', 'wiederein', 'wiederher', 'wohl', 'zu', 'zueinander', 'zufrieden', 'zugute', 'zunichte', 'zurecht', 'zurück', 'zusammen', 'zuwider', 'zwangs', 'zwangsum', 'zwangsvor', 'zweck', 'zwischen'];
              if (prfxs.includes(firstPart)) {
                for (const tag of partTaggerTokens) {
                  if (StringUtils_startsWithAny(tag.getPosTag(), 'VER:1', 'VER:2', 'VER:3') && (sentenceTokens.indexOf(word) === 0 || word === word.substring(0, 1).toLowerCase() + word.substring(1))) {
                    if (StringUtils_endsWith(tag.getPosTag(), 'NEB')) {
                      readings.push(new AnalyzedToken(word, tag.getPosTag(), firstPart + tag.getLemma()));
                    } else {
                      readings.push(new AnalyzedToken(word, tag.getPosTag() + ':NEB', firstPart + tag.getLemma()));
                    }
                  } else if (!StringUtils_startsWithAny(tag.getPosTag(), 'VER:IMP')) {
                    readings.push(new AnalyzedToken(word, tag.getPosTag(), firstPart + tag.getLemma()));
                  }
                }
              } else {
                temp = temp.filter((k) => !k.getPOSTag()!.includes('VER'));
                readings.push(...temp);
              }
            }
          }
        }
        if (readings.length === 0) {
          readings.push(this.getNoInfoToken(word));
        }
      }
      tokenReadings.push(new AnalyzedTokenReadings(readings, pos));
      pos += word.length;
      prevWord = word;
      idxPos++;
    }
    return tokenReadings;
  }

  prefixedVerbLastPart(word: string): string | null {
    // "aufstöhnen" (auf+stöhnen) etc.
    for (const prefix of VerbPrefixes.get()) {
      if (word.startsWith(prefix)) {
        const tags = this.tag(StringReplaceFirst(word, '^' + prefix, ''));
        if (tags.some((k) => k.getPosTag() != null && k.getPosTag()!.startsWith('VER'))) {
          return word.substring(prefix.length);
        }
      }
    }
    return null;
  }

  isWeiseException(word: string): boolean {
    if (word.endsWith('erweise')) {  // "idealerweise" etc.
      const tags = this.tag(StringUtils_removeEnd(word, 'erweise'));
      return tags.some((k) => k.getPosTag() != null && k.getPosTag()!.startsWith('ADJ'));
    }
    return false;
  }

  /*
   * Tag alternative imperative forms (e.g., "Geh bitte!" in addition to "Gehe bitte!")
   * To avoid false positives and conflicts with DE_CASE the tagging is restricted to
   * [a] words at the start of a sentence ("Geh bitte!") if the sentence counts more than one word
   * [b1] words preceded by ich/ihr/er/es/sie to catch some real errors ("Er geh jetzt.") by the new rule in rulegroup SUBJECT_VERB_AGREEMENT
   * [b2] words preceded by aber/nun/jetzt (e.g., "Bitte geh!", "Jetzt sag schon!" etc.)
   * @param word to be checked
   */
  private getImperativeForm(word: string, sentenceTokens: string[], pos: number): AnalyzedToken[] {
    let idx = sentenceTokens.indexOf(word);
    let previousWord = '';
    while (--idx > -1) {
      previousWord = sentenceTokens[idx]!;
      if (!StringUtils_isWhitespace(previousWord)) {
        break;
      }
    }
    if (!(pos === 0 && sentenceTokens.length > 1)
        && !StringUtils_equalsAnyIgnoreCase(previousWord, 'ich', 'er', 'es', 'sie', 'bitte', 'aber', 'nun', 'jetzt', '„')) {
      return [];
    }
    const w = pos === 0 || '„' === previousWord ? word.toLowerCase() : word;
    const taggedWithE = this.getWordTagger().tag(w.concat('e'));
    for (const tagged of taggedWithE) {
      if (tagged.getPosTag()!.startsWith('VER:IMP:SIN')) {
        // do not overwrite manually removed tags
        if (this.removalTagger == null || !List_contains(this.removalTagger.tag(w), tagged)) {
          return this.getAnalyzedTokens([tagged], word);
        }
        break;
      }
    }
    return [];
  }

  /*
   * Tag substantivated adjectives and participles, which are currently tagged not tagged correctly
   * (e.g., "Verletzter" in "Ein Verletzter kam ins Krankenhaus" needs to be tagged as "SUB:NOM:SIN:MAS")
   * @param word to be checked
   */
  private getSubstantivatedForms(word: string, sentenceTokens: string[]): AnalyzedToken[] {
    if (word.endsWith('er')) {
      if (P().DDD_ER_PATTERN.matcher(word).matches()) {
        // e.g. "Den 2019er Wert hatten sie geschätzt"
        const list: AnalyzedToken[] = [];
        for (const tag of allAdjGruTags) {
          list.push(new AnalyzedToken(word, tag, word));
        }
        return list;
      }
      const lowerCaseTags = this.getWordTagger().tag(word.toLowerCase());
      // do not add tag words whose lower case variant is an adverb (e.g, "Früher") to avoid false negatives for DE_CASE
      if (lowerCaseTags.some((t) => t.getPosTag()!.startsWith('ADV'))) {
        return [];
      }
      let idx = sentenceTokens.indexOf(word);
      // is followed by an uppercase word? If 'yes', the word is probably not substantivated
      while (++idx < sentenceTokens.length) {
        const nextWord = sentenceTokens[idx]!;
        if (StringUtils_isWhitespace(nextWord)) {
          continue;
        }
        if (nextWord.length > 0 && (Character.isUpperCase(nextWord.charAt(0)) || 'als' === nextWord)) {
          return [];
        }
        break;
      }
      const femaleForm = word.substring(0, word.length-1);
      const taggedFemaleForm = this.getWordTagger().tag(femaleForm);
      const isSubstantivatedForm = taggedFemaleForm.some((t) => t.getPosTag() === 'SUB:NOM:SIN:FEM:ADJ');
      if (isSubstantivatedForm) {
        const list: AnalyzedToken[] = [];
        list.push(new AnalyzedToken(word, 'SUB:NOM:SIN:MAS:ADJ', word));
        list.push(new AnalyzedToken(word, 'SUB:GEN:PLU:MAS:ADJ', word));
        return list;
      }
    }
    return [];
  }

  private getNoInfoToken(word: string): AnalyzedToken {
    return new AnalyzedToken(word, null, null);
  }

  // Java: BaseTagger's getAnalyzedTokens(word) and GermanTagger's two private overloads
  protected override getAnalyzedTokens(wordOrTaggedWords: string | TaggedWord[], word?: string, compoundParts?: string[]): AnalyzedToken[] {
    if (typeof wordOrTaggedWords === 'string') {
      return super.getAnalyzedTokens(wordOrTaggedWords);
    }
    const taggedWords = wordOrTaggedWords;
    const result: AnalyzedToken[] = [];
    if (compoundParts === undefined) {
      for (const taggedWord of taggedWords) {
        result.push(new AnalyzedToken(word!, taggedWord.getPosTag(), taggedWord.getLemma()));
      }
      return result;
    }
    for (const taggedWord of taggedWords) {
      if (taggedWord.getPosTag() != null && taggedWord.getPosTag()!.startsWith('VER:IMP')) {
        // ignore imperative, as otherwise e.g. "zehnfach" will be interpreted as a verb (zehn + fach)
        continue;
      }
      const allButLastPart = compoundParts.slice(0, compoundParts.length - 1);
      let lemma = '';
      let i = 0;
      for (const s of allButLastPart) {
        lemma += i === 0 ? s : StringTools.lowercaseFirstChar(s);
        i++;
      }
      lemma += StringTools.lowercaseFirstChar(taggedWord.getLemma()!);
      result.push(new AnalyzedToken(word!, taggedWord.getPosTag(), lemma));
    }
    return result;
  }

}

class PrefixInfixVerb {
  readonly prefix: string;
  readonly infix: string;
  readonly verbBaseform: string;
  constructor(prefix: string, infix: string, verbBaseform: string) {
    this.prefix = prefix;
    this.infix = infix;
    this.verbBaseform = verbBaseform;
  }
}

class AdjInfo {
  readonly baseform: string;
  readonly fullForm: string;
  readonly tag: string;
  constructor(baseform: string, fullForm: string, tag: string) {
    this.baseform = baseform;
    this.fullForm = fullForm;
    this.tag = tag;
  }
}

class NominalizedVerb {
  readonly prefix: string;
  readonly verbBaseform: string;
  constructor(prefix: string, verbBaseform: string) {
    this.prefix = prefix;
    this.verbBaseform = verbBaseform;
  }
}

class NominalizedGenitiveVerb {
  readonly prefix: string;
  readonly verbBaseform: string;
  constructor(prefix: string, verbBaseform: string) {
    this.prefix = prefix;
    this.verbBaseform = verbBaseform;
  }
}

class ExpansionInfos {
  readonly verbInfos: Map<string, PrefixInfixVerb>;
  readonly nominalizedVerbInfos: Map<string, NominalizedVerb>;
  readonly nominalizedGenVerbInfos: Map<string, NominalizedGenitiveVerb>;
  readonly adjInfos: Map<string, AdjInfo[]>;
  constructor(verbInfos: Map<string, PrefixInfixVerb>, nominalizedVerbInfos: Map<string, NominalizedVerb>,
              nominalizedGenVerbInfos: Map<string, NominalizedGenitiveVerb>, adjInfos: Map<string, AdjInfo[]>) {
    this.verbInfos = verbInfos;
    this.nominalizedVerbInfos = nominalizedVerbInfos;
    this.nominalizedGenVerbInfos = nominalizedGenVerbInfos;
    this.adjInfos = adjInfos;
  }
}
