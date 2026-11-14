// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/chunking/GermanChunker.java faithful
// REGEXES1 and REGEXES2 are compiled on first use (Java compiles them when the class is loaded).
// The build overloads are one (overwrite defaults to false). The enum PhraseType is an as-const
// object (its name() is the value). The TreeSet with String.CASE_INSENSITIVE_ORDER is a Set of
// case-folded forms (each char upper- then lowercased, as that comparator does). getBasicChunks
// (package-private, used by the test) is public. System.out is console.log.
import type { AnalyzedTokenReadings } from '../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Chunker } from '../../../../../languagetool-core/org/languagetool/chunking/Chunker.ts';
import { ChunkTag } from '../../../../../languagetool-core/org/languagetool/chunking/ChunkTag.ts';
import { ChunkTaggedToken } from '../../../../../languagetool-core/org/languagetool/chunking/ChunkTaggedToken.ts';
import { TokenExpressionFactory } from '../../../../../languagetool-core/org/languagetool/chunking/TokenExpressionFactory.ts';
import { StringMatcher } from '../../../../../languagetool-core/org/languagetool/rules/patterns/StringMatcher.ts';
import type { Match } from '../../../../../../openregex/edu/washington/cs/knowitall/regex/Match.ts';
import { RegularExpression } from '../../../../../../openregex/edu/washington/cs/knowitall/regex/RegularExpression.ts';
import { Character } from '../../../../../../jdk/java/lang/Character.ts';
import { List_contains, List_indexOf } from '../../../../../../jdk/java/util/Objects.ts';
import { Pattern, StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';

const FILTER_TAGS = new Set<string>(['PP', 'NPP', 'NPS']);
let factory: TokenExpressionFactory | null = null;
const FACTORY = () => (factory ??= new TokenExpressionFactory(false));

let simpleFormRegexpValue: Pattern | null = null;
const simpleFormRegexp = () => (simpleFormRegexpValue ??= Pattern.compile(
  '(^| )<([a-zäöüß|()\\[\\]?,]+)>\\+?( |$)',
  Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE));
const SYNTAX_EXPANSION = new Map<string, string>();

SYNTAX_EXPANSION.set('<NP>', '<chunk=B-NP> <chunk=I-NP>*');
SYNTAX_EXPANSION.set('&prozent;', 'Prozent|Kilo|Kilogramm|Gramm|Euro|Pfund');

export const PhraseType = {
  NP: 'NP',   // "noun phrase", will be assigned as B-NP for the first token and I-NP for following tokens (like OpenNLP)
  NPS: 'NPS',  // "noun phrase singular"
  NPP: 'NPP',  // "noun phrase plural"
  PP: 'PP',    // "prepositional phrase" and similar
} as const;
export type PhraseType = typeof PhraseType[keyof typeof PhraseType];

let debug = false;

/** String.CASE_INSENSITIVE_ORDER's notion of equality, as a key */
function caseFold(s: string): string {
  let r = '';
  for (let i = 0; i < s.length; i++) {
    r += Character.toLowerCase(Character.toUpperCase(s.charAt(i)));
  }
  return r;
}

/*
 * REGEXES1 and REGEXES2 are OpenRegex (https:*github.com/knowitall/openregex) expressions.
 * REGEXES1 roughly emulates the behavior of the OpenNLP chunker by tagging the first
 * token of a noun phrase with B-NP and the remaining ones with I-NP.
 * REGEXES2 builds on those annotations to find complex noun phrases.
 *
 * Syntax:
 *    <string|regex|regexCS|chunk|pos|posregex|posre=value>
 *       string: matches the token itself
 *       regex: matches the token against a regular expression
 *       regexCS: is like regex but case-sensitive
 *       chunk: matches the token's chunk
 *       pos: matches the token's POS tags
 *       posregex: matches the token's POS tags against a regular expression
 *       posre: is a synonym for posregex
 *    <foo> is a short form of <string=foo>
 *    <pos=X> will match tokens with POS tags that contain X as a substring
 *
 * Example to combine two conditions via logical AND:
 *    <pos=ADJ & chunk=B-NP>
 * Example: Quote a regular expression so OpenRegex doesn't get confused:
 *    <posre='.*(NOM|AKK).*'>
 *
 * See SYNTAX_EXPANSION for strings that get expanded before interpreted by OpenRegex.
 * The chunks are added to the existing chunks, unless the last argument of build() is
 * true, in which case existing chunks get overwritten.
 */

const undOderBzw: string[][] = [['und', 'oder', 'bzw']];

let regexes1: RegularExpressionWithPhraseType[] | null = null;
const REGEXES1 = () => (regexes1 ??= [
  // "das Auto", "das schöne Auto", "das sehr schöne Auto", "die Pariser Innenstadt":
  build('(<posre=^ART.*>|<pos=PRO>)? <pos=ADV>* <pos=PA2>* <pos=ADJ>* <pos=SUB>+', PhraseType.NP),
  // "Mythen und Sagen":
  buildExpanded('<pos=SUB> (<und|oder>|(<bzw> <.>)) <pos=SUB>', PhraseType.NP, false, undOderBzw),
  // "ältesten und bekanntesten Maßnahmen":
  buildExpanded('<pos=ADJ> (<und|oder>|(<bzw> <.>)) <pos=PA2> <pos=SUB>', PhraseType.NP, false, undOderBzw),
  // "räumliche und zeitliche Abstände":
  buildExpanded('<pos=ADJ> (<und|oder>|(<bzw> <.>)) <pos=ADJ> <pos=SUB>', PhraseType.NP, false, undOderBzw),

  // "eine leckere Lasagne":
  build('<posre=^ART.*> <pos=ADV>* <pos=ADJ>* <regexCS=[A-ZÖÄÜ][a-zöäü]+>', PhraseType.NP),  // Lexikon kennt nicht alle Nomen, also so...

  //build("<posre=^ART.*>? <pos=PRO>? <pos=ZAL> <pos=SUB>"),  // "zwei Wochen"
  build('<pos=PRO>? <pos=ZAL> <pos=SUB>', PhraseType.NP),  // "zwei Wochen", "[eines] ihrer drei Autos"

  build('<Herr|Herrn|Frau> <pos=EIG>+', PhraseType.NP),
  build('<Herr|Herrn|Frau> <regexCS=[A-ZÖÄÜ][a-zöäü-]+>+', PhraseType.NP),  // für seltene Nachnamen, die nicht im Lexikon sind

  build('<der>', PhraseType.NP)  // simulate OpenNLP?!
]);

let regexes2: RegularExpressionWithPhraseType[] | null = null;
const REGEXES2 = () => (regexes2 ??= [
  // ===== plural and singular noun phrases, based on OpenNLP chunker output ===============
  // "In christlichen, islamischen und jüdischen Traditionen":
  build('<pos=ADJ> <,> <chunk=B-NP> <chunk=I-NP>* <und|sowie> <NP>', PhraseType.NPP),
  // "ein Hund und eine Katze":
  build('<chunk=B-NP & !regex=jede[rs]?> <chunk=I-NP>* <und|sowie> <pos=ADV>? <NP>', PhraseType.NPP),
  // "größte und erfolgreichste Erfindung" (fixes mistagging introduced above):
  build('<pos=ADJ> <und|sowie> <chunk=B-NP & !pos=PLU> <chunk=I-NP>*', PhraseType.NPS, true),
  // "deren Bestimmung und Funktion" (fixes mistagging introduced above):
  build('<deren> <chunk=B-NP & !pos=PLU> <und|sowie> <chunk=B-NP>*', PhraseType.NPS, true),
  // "Julia und Karsten":
  build('<pos=EIG> <und> <pos=EIG>', PhraseType.NPP),
  // "die älteste und bekannteste Maßnahme" - OpenNLP won't detect that as one NP:
  build('<pos=ART> <pos=ADJ> <und|sowie> (<pos=ADJ>|<pos=PA2>) <chunk=I-NP & !pos=PLU>+', PhraseType.NPS, true),
  // "eine Masseeinheit und keine Gewichtseinheit":
  build('<chunk=B-NP & !pos=PLU> <chunk=I-NP>* <und|sowie> <keine> <chunk=I-NP>+', PhraseType.NPS, true),
  // "Der See und das anliegende Marschland":
  build('<NP> <und|sowie> <pos=ART> <pos=PA1> <pos=SUB>', PhraseType.NPP, true),

  // "eins ihrer drei Autos":
  build('<eins|eines> <chunk=B-NP> <chunk=I-NP>+', PhraseType.NPS),

  // "er und seine Schwester":
  build('<ich|du|er|sie|es|wir|ihr|sie> <und|oder|sowie> <NP>', PhraseType.NPP),
  // "sowohl sein Vater als auch seine Mutter":
  build('<sowohl> <NP> <als> <auch> <NP>', PhraseType.NPP),
  // "sowohl Tom als auch Maria":
  build('<sowohl> <pos=EIG> <als> <auch> <pos=EIG>', PhraseType.NPP),
  // "sowohl er als auch seine Schwester":
  build('<sowohl> <ich|du|er|sie|es|wir|ihr|sie> <als> <auch> <NP>', PhraseType.NPP),
  // "Rekonstruktionen oder der Wiederaufbau", aber nicht "Isolation und ihre Überwindung":
  build('<pos=SUB> <und|oder|sowie> <chunk=B-NP & !ihre> <chunk=I-NP>*', PhraseType.NPP),
  // "Weder Gerechtigkeit noch Freiheit":
  build('<weder> <pos=SUB> <noch> <pos=SUB>', PhraseType.NPP),

  // "drei Katzen" - needed as ZAL cannot be unified, as it has no features:
  build('<zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf> <chunk=I-NP>', PhraseType.NPP),

  // "der von der Regierung geprüfte Hund ist grün":
  build('<chunk=B-NP> <pos=PRP> <NP> <chunk=B-NP & pos=SIN> <chunk=I-NP>*', PhraseType.NPS),
  build('<chunk=B-NP> <pos=PRP> <NP> <chunk=B-NP & pos=PLU> <chunk=I-NP>*', PhraseType.NPP),

  // "der von der Regierung geprüfte Hund":
  build('<chunk=B-NP> <pos=PRP> <NP> <pos=PA2> <chunk=B-NP & !pos=PLU> <chunk=I-NP>*', PhraseType.NPS),
  build('<chunk=B-NP> <pos=PRP> <NP> <pos=PA2> <chunk=B-NP & !pos=SIN> <chunk=I-NP>*', PhraseType.NPP),

  // "Herr und Frau Schröder":
  build('<Herr|Frau> <und> <Herr|Frau> <pos=EIG>*', PhraseType.NPP),

  // "ein Hund", aber nicht: "[kaum mehr als] vier Prozent":
  build('<chunk=B-NP & !pos=ZAL & !pos=PLU & !chunk=NPP & !einige & !(regex=&prozent;)> <chunk=I-NP & !pos=PLU & !und>*', PhraseType.NPS),  //"!und": OpenNLP packt "Bob und Tom" in eine NP
  // "die Hunde":
  build('<chunk=B-NP & !pos=SIN & !chunk=NPS & !Ellen> <chunk=I-NP & !pos=SIN>*', PhraseType.NPP),

  // "die hohe Zahl dieser relativ kleinen Verwaltungseinheiten":
  build('<chunk=NPS> <pos=PRO> <pos=ADJ> <pos=ADJ> <NP>', PhraseType.NPS),

  // "eine der am meisten verbreiteten Krankheiten":
  build('<regex=eine[rs]?> <der> <am> <pos=ADJ> <pos=PA2> <NP>', PhraseType.NPS),
  // "einer der beiden Höfe":
  build('<regex=eine[rs]?> <der> <beiden> <pos=ADJ>* <pos=SUB>', PhraseType.NPS),
  // "Einer seiner bedeutendsten Kämpfe":
  build('<regex=eine[rs]?> <seiner|ihrer> <pos=PA1> <pos=SUB>', PhraseType.NPS),

  // "xy Prozent" - beide Varianten okay (zumindest umgangssprachlich):
  // siehe https://dict.leo.org/grammatik/deutsch/Wort/Verb/Kategorien/Numerus-Person/ProblemNum.html#grammarAnchor-Mengenangabe-49575
  build('<regex=[\\d,.]+> <&prozent;>', PhraseType.NPS),
  build('<regex=[\\d,.]+> <&prozent;>', PhraseType.NPP),

  // "[alle Arbeitsplätze so umzugestalten,] dass sie wie ein Spiel":
  build('<dass> <sie> <wie> <NP>', PhraseType.NPP),
  // "[so dass Knochenbrüche und] Platzwunden die Regel [sind]"
  build('<pos=PLU> <die> <Regel>', PhraseType.NPP),
  // "Veranstaltung, die immer wieder ein kultureller Höhepunkt", aber nicht "... in der Geschichte des Museums, die Sammlung ist seit 2011 zugänglich.":
  build('<chunk=B-NP & pos=SIN> <chunk=I-NP & pos=SIN>* <,> <die> <pos=ADV>+ <chunk=NPS>+', PhraseType.NPS),
  // "Die Nauheimer Musiktage, die immer wieder ein kultureller Höhepunkt sind":
  build('<chunk=B-NP & pos=PLU> <chunk=I-NP & pos=PLU>* <,> <die> <pos=ADV>+ <chunk=NPS>+', PhraseType.NPP),

  // ===== genitive phrases and similar ====================================================
  
  // "Das letzte der teilnehmenden Länder":
  build('<der|die|das> <pos=ADJ> <der> <pos=PA1> <pos=SUB>', PhraseType.NPS),
  // "Ursachen der vorliegenden Durchblutungsstörung":
  build('<pos=SUB & pos=PLU> <der> <pos=PA1> <pos=SUB>', PhraseType.NPP),
  // "die ältere der beiden Töchter":
  build('<der|die|das> <pos=ADJ> <der> <pos=PRO>? <pos=SUB>', PhraseType.NPS),
  // "Synthese organischer Verbindungen", "die Anordnung der vier Achsen", aber nicht "Einige der Inhaltsstoffe":
  build('<chunk=NPS & !einige> <chunk=NPP & (pos=GEN |pos=ZAL)>+', PhraseType.NPS, true),
  // "die Kenntnisse der Sprache":
  build('<chunk=NPP> <chunk=NPS & pos=GEN>+', PhraseType.NPP, true),
  // "die Pyramide des Friedens und der Eintracht":
  build('<chunk=NPS>+ <und> <chunk=NP[SP] & (pos=GEN | pos=ADV)>+', PhraseType.NPS, true),
  // "Teil der dort ausgestellten Bestände":
  build('<chunk=NPS>+ <der> <pos=ADV> <pos=PA2> <chunk=I-NP>', PhraseType.NPS, true),
  // "Autor der ersten beiden Bücher":
  build('<chunk=NPS>+ <der> (<pos=ADJ>|<pos=ZAL>) <NP>', PhraseType.NPS, true),
  // "Autor der beiden Bücher":
  build('<chunk=NPS>+ <der> <NP>', PhraseType.NPS, true),
  // "Teil der umfangreichen dort ausgestellten Bestände":
  build('<chunk=NPS>+ <der> <pos=ADJ> <pos=ADV> <pos=PA2> <NP>', PhraseType.NPS, true),
  // "die Krankheit unserer heutigen Städte und Siedlungen":
  build('<chunk=NPS>+ <pos=PRO:POS> <pos=ADJ> <NP>', PhraseType.NPS, true),
  // "der letzte der vier großen Flüsse":
  build('<der|das> <pos=ADJ> <der> <pos=ZAL> <NP>', PhraseType.NPS, true),
  // "Elemente eines axiomatischen Systems":  -- führt zu Fehlalarm anderswo
  //build("<chunk=B-NP & pos=PLU> <chunk=I-NP>* <chunk=B-NP & pos=GEN> <chunk=I-NP>*", NPP),

  // "eine Menge englischer Wörter [sind aus dem Lateinischen abgeleitet]":
  // NPP stimmt aber nicht für Mathematik, dort NPS: "Eine Menge ist ein Konzept der Mathematik."
  build('<eine> <menge> <NP>+', PhraseType.NPP, true),
  // "dass [sie und sein Sohn ein Paar] sind":
  build('<er|sie|es> <und> <NP> <NP>', PhraseType.NPP),

  // ===== prepositional phrases ===========================================================

  // "laut den meisten Quellen":
  build('<laut> <regex=.*>{0,3} <Quellen>', PhraseType.PP, true),
  // "bei den sehr niedrigen Oberflächentemperaturen" (OpenNLP doesn't find this)
  build('<pos=PRP> <pos=ART:> <pos=ADV>* <pos=ADJ> <NP>', PhraseType.PP, true),
  // "in den alten Religionen, Mythen und Sagen":
  build('<pos=PRP> <chunk=NPP>+ <,> <NP>', PhraseType.PP, true),
  // "für die Stadtteile und selbständigen Ortsteile":
  build('<pos=PRP> <chunk=NPP>+', PhraseType.PP, true),
  // "Das Bündnis zwischen der Sowjetunion und Kuba":
  build('<pos=PRP> <der> <chunk=NPP>+', PhraseType.PP),
  // "in chemischen Komplexverbindungen", "für die Fische":
  build('<pos=PRP> <NP>', PhraseType.PP),
  // "einschließlich der biologischen und sozialen Grundlagen":
  // with OpenNLP: build("<pos=PRP> <NP> <pos=ADJ> (<und>|<oder>|<bzw.>) <pos=ADJ> <NP>", PP),
  build('<pos=PRP> <NP> <pos=ADJ> <und|oder|bzw.> <NP>', PhraseType.PP),
  // "für Ärzte und Ärztinnen festgestellte Risikoprofil", "der als Befestigung gedachte östliche Teil der Burg":
  build('<pos=PRP> (<NP>)+', PhraseType.PP),
  // "in den darauf folgenden Wochen":
  build('<pos=PRP> <chunk=B-NP> <pos=ADV> <NP>', PhraseType.PP),
  // "in nur zwei Wochen":
  build('<pos=PRP> <pos=ADV> <pos=ZAL> <chunk=B-NP>', PhraseType.PP),
  // "in deren deutschen Installationen":
  build('<pos=PRP> <pos=PRO> <NP>', PhraseType.PP),
  // "nach sachlichen und militärischen Kriterien" - we need to help OpenNLP a bit with this one:
  // with OpenNLP: build("<pos=PRP> <pos=ADJ> (<und|oder|sowie>) <pos=ADJ> <chunk=B-NP>", PP),
  build('<pos=PRP> <pos=ADJ> <und|oder|sowie> <NP>', PhraseType.PP),
  // "mit über 1000 Handschriften":
  build('<pos=PRP> <pos=ADV> <regex=\\d+> <NP>', PhraseType.PP),
  // "über laufende Sanierungsmaßnahmen":
  build('<pos=PRP> <pos=PA1> <NP>', PhraseType.PP),
  // "Aufgrund stark schwankender Absatzmärkte war die GEFA-Flug..."
  build('<pos=PRP> <pos=ADJ> <pos=PA1> <NP>', PhraseType.PP),
  // "durch Einsatz größerer Maschinen und bessere Kapazitätsplanung":
  // with OpenNLP: build("<pos=PRP> <NP> <pos=ADJ> <NP> (<und|oder>) <NP>", PP),
  build('<pos=PRP> <NP> <NP> <und|oder> <NP>', PhraseType.PP),
  // "bei sehr guten Beobachtungsbedingungen":
  build('<pos=PRP> <pos=ADV> <pos=ADJ> <NP>', PhraseType.PP),
  // "[Von ursprünglich drei Almhütten] ist noch eine erhalten":
  build('<pos=PRP> <pos=ADJ:PRD:GRU> <pos=ZAL> <NP>', PhraseType.PP),

  // "die darauffolgenden Jahre" -> eigentlich "in den darauffolgenden Jahren":
  build('<die> <pos=ADJ> <Sekunden|Minuten|Stunden|Tage|Wochen|Monate|Jahre|Jahrzehnte|Jahrhunderte> (<NP>)?', PhraseType.PP),
  // "die letzten zwei Monate" -> eigentlich "in den letzten zwei Monaten":
  build('<die> <pos=ADJ> <pos=ZAL> <Sekunden|Minuten|Stunden|Tage|Wochen|Monate|Jahre|Jahrzehnte|Jahrhunderte> (<NP>)?', PhraseType.PP),
  // "letztes Jahr":
  build('<regex=(vor)?letzte[sn]?> <Woche|Monat|Jahr|Jahrzehnt|Jahrhundert>', PhraseType.PP),
  // "Für in Österreich lebende Afrikaner und Afrikanerinnen":
  build('<für> <in> <pos=EIG> <pos=PA1> <pos=SUB> <und> <pos=SUB>', PhraseType.PP, true),

  // "die Beziehungen zwischen Kanada und dem Iran":
  build('<chunk=NPP> <zwischen> <pos=EIG> <und|sowie> <NP>', PhraseType.NPP),
  // ", die die hauptsächliche Beute der Eisbären", ", welche der Urstoff aller Körper":
  build('<,> <die|welche> <NP> <chunk=NPS & pos=GEN>+', PhraseType.NPP),
  // "Kommentare, Korrekturen, Kritik":
  build('<NP> <,> <NP> <,> <NP>', PhraseType.NPP),
  // "Details, Dialoge, wie auch die Typologie der Charaktere":
  build('<NP> <,> <NP> <,> <wie> <auch> <chunk=NPS>+', PhraseType.NPP)
]);

function build(expr: string, phraseType: PhraseType, overwrite = false): RegularExpressionWithPhraseType {
  let expandedExpr = expr;
  for (const [key, value] of SYNTAX_EXPANSION) {
    expandedExpr = expandedExpr.replaceAll(key, value);
  }

  return buildExpanded(expandedExpr, phraseType, overwrite, calcFormHints(expandedExpr));
}

function buildExpanded(expandedExpr: string, phraseType: PhraseType, overwrite: boolean, formHints: string[][]): RegularExpressionWithPhraseType {
  const expression = RegularExpression.compile<ChunkTaggedToken>(expandedExpr, FACTORY());
  return new RegularExpressionWithPhraseType(expression, phraseType, overwrite, formHints);
}

function calcFormHints(expandedExpr: string): string[][] {
  const formHints: string[][] = [];
  const matcher = simpleFormRegexp().matcher(expandedExpr);
  while (matcher.find()) {
    const possibleValues = StringMatcher.create(matcher.group(2)!, true, false).getPossibleValues();
    if (possibleValues != null) {
      formHints.push([...possibleValues]);
    }
  }
  return formHints;
}

/**
 * A rule-based German chunker for noun phrases. Please note that this chunker
 * has not been evaluated as a stand-alone chunker, it has only been used and tested
 * in the context of LanguageTool's error detection rules.
 * @since 2.9
 */
export class GermanChunker implements Chunker {

  /** @deprecated for internal use only */
  static setDebug(debugMode: boolean): void {
    debug = debugMode;
  }
  /** @deprecated for internal use only */
  static isDebug(): boolean {
    return debug;
  }

  constructor() {
  }

  addChunkTags(tokenReadings: AnalyzedTokenReadings[]): void {
    const allForms = GermanChunker.allForms(tokenReadings);
    const chunkTaggedTokens = this.getBasicChunks(tokenReadings, allForms);
    for (const regex of REGEXES2()) {
      this.apply(regex, chunkTaggedTokens, allForms);
    }
    this.assignChunksToReadings(chunkTaggedTokens);
  }

  getBasicChunks(tokenReadings: AnalyzedTokenReadings[], allForms: Set<string> = GermanChunker.allForms(tokenReadings)): ChunkTaggedToken[] {
    const chunkTaggedTokens: ChunkTaggedToken[] = [];
    for (const tokenReading of tokenReadings) {
      if (!tokenReading.isWhitespace()) {
        const chunkTags = [new ChunkTag('O')];
        const chunkTaggedToken = new ChunkTaggedToken(tokenReading.getToken(), chunkTags, tokenReading);
        chunkTaggedTokens.push(chunkTaggedToken);
      }
    }
    if (debug) {
      console.log('=============== CHUNKER INPUT ===============');
      console.log(this.getDebugString(chunkTaggedTokens));
    }
    for (const regex of REGEXES1()) {
      this.apply(regex, chunkTaggedTokens, allForms);
    }
    return chunkTaggedTokens;
  }

  private apply(regex: RegularExpressionWithPhraseType, tokens: ChunkTaggedToken[], allForms: Set<string>): void {
    if (!GermanChunker.hasAllFormHints(regex, allForms)) {
      return;
    }

    const prevDebug = this.getDebugString(tokens);
    try {
      const affectedSpans = this.doApplyRegex(regex, tokens);
      const debug = this.getDebugString(tokens);
      if (!(debug === prevDebug)) {
        this.printDebugInfo(regex, affectedSpans, debug);
      }
    } catch (e) {
      throw new Error("RuntimeException: Could not apply chunk regexp '" + regex + "' to tokens: [" + tokens.join(', ') + ']', { cause: e });
    }
  }

  private static hasAllFormHints(regex: RegularExpressionWithPhraseType, allForms: Set<string>): boolean {
    for (const hints of regex.formHints) {
      if (!GermanChunker.hasForm(allForms, hints)) {
        return false;
      }
    }
    return true;
  }

  private static hasForm(allForms: Set<string>, hints: string[]): boolean {
    for (const hint of hints) {
      if (allForms.has(caseFold(hint))) {
        return true;
      }
    }
    return false;
  }

  private static allForms(tokens: AnalyzedTokenReadings[]): Set<string> {
    const result = new Set<string>();
    for (const token of tokens) {
      result.add(caseFold(token.getToken()));
    }
    return result;
  }

  private assignChunksToReadings(chunkTaggedTokens: ChunkTaggedToken[]): void {
    for (const taggedToken of chunkTaggedTokens) {
      const readings = taggedToken.getReadings();
      if (readings != null) {
        readings.setChunkTags(taggedToken.getChunkTags());
      }
    }
  }

  private doApplyRegex(regex: RegularExpressionWithPhraseType, tokens: ChunkTaggedToken[]): AffectedSpans {
    const matches = regex.expression.findAll(tokens);
    const affectedSpans: Span[] = [];
    for (const match of matches) {
      affectedSpans.push(new Span(match.startIndex(), match.endIndex()));
      for (let i = match.startIndex(); i < match.endIndex(); i++) {
        const token = tokens[i]!;
        let newChunkTags: ChunkTag[] = [];
        newChunkTags.push(...token.getChunkTags());
        if (regex.overwrite) {
          const filtered: ChunkTag[] = [];
          for (const newChunkTag of newChunkTags) {
            if (!FILTER_TAGS.has(newChunkTag.getChunkTag())) {
              filtered.push(newChunkTag);
            }
          }
          newChunkTags = filtered;
        }
        const newTag = this.getChunkTag(regex, match, i);
        if (!List_contains(newChunkTags, newTag)) {
          newChunkTags.push(newTag);
          const idx = List_indexOf(newChunkTags, new ChunkTag('O'));
          if (idx >= 0) {
            newChunkTags.splice(idx, 1);
          }
        }
        tokens[i] = new ChunkTaggedToken(token.getToken(), newChunkTags, token.getReadings());
      }
    }
    return new AffectedSpans(affectedSpans);
  }

  private getChunkTag(regex: RegularExpressionWithPhraseType, match: Match<ChunkTaggedToken>, i: number): ChunkTag {
    let newTag: ChunkTag;
    if (regex.phraseType === PhraseType.NP) {
      // we assign the same tags as the OpenNLP chunker
      if (i === match.startIndex()) {
        newTag = new ChunkTag('B-NP');
      } else {
        newTag = new ChunkTag('I-NP');
      }
    } else {
      newTag = new ChunkTag(regex.phraseType);
    }
    return newTag;
  }

  private printDebugInfo(regex: RegularExpressionWithPhraseType, affectedSpans: AffectedSpans, debug: string): void {
    console.log('=== Applied ' + regex + ' ===');
    if (regex.overwrite) {
      console.log('Note: overwrite mode, replacing old [' + [...FILTER_TAGS].join(', ') + '] tags');
    }
    const debugLines = StringSplit(debug, '\n');
    let i = 0;
    for (const debugLine of debugLines) {
      if (affectedSpans.isAffected(i)) {
        console.log(debugLine.replace(/^ {2}/, ' *'));
      } else {
        console.log(debugLine);
      }
      i++;
    }
    console.log();
  }

  private getDebugString(tokens: ChunkTaggedToken[]): string {
    if (!debug) {
      return '';
    }
    let sb = '';
    for (const token of tokens) {
      const tokenReadingStr = Pattern.compile(Pattern.quote(token.getToken()) + '\\[').matcher(String(token.getReadings())).replaceFirst('[');
      sb += '  ' + token + ' -- ' + tokenReadingStr + '\n';
    }
    return sb;
  }
}

class Span {
  readonly startIndex: number;
  readonly endIndex: number;
  constructor(startIndex: number, endIndex: number) {
    this.startIndex = startIndex;
    this.endIndex = endIndex;
  }
}

class AffectedSpans {
  readonly spans: Span[];
  constructor(spans: Span[]) {
    this.spans = spans;
  }
  isAffected(pos: number): boolean {
    for (const span of this.spans) {
      if (pos >= span.startIndex && pos < span.endIndex) {
        return true;
      }
    }
    return false;
  }
}

class RegularExpressionWithPhraseType {
  readonly expression: RegularExpression<ChunkTaggedToken>;
  readonly phraseType: PhraseType;
  readonly overwrite: boolean;
  readonly formHints: string[][];
  constructor(expression: RegularExpression<ChunkTaggedToken>, phraseType: PhraseType, overwrite: boolean, formHints: string[][]) {
    this.expression = expression;
    this.phraseType = phraseType;
    this.overwrite = overwrite;
    this.formHints = formHints;
  }
  toString(): string {
    return this.phraseType + ' <= ' + this.expression + ' (overwrite: ' + this.overwrite + ')';
  }
}
