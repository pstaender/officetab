// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/AgreementSuggestor2.java faithful
// The three constructors are one, told apart by the number of arguments (the replacement type is
// always the last one and may be null): (synth, det, noun, repl), (synth, det, adj1, noun, repl),
// (synth, det, adj1, adj2, noun, repl). getSuggestions() and getSuggestions(filter) are one method.
// StringUtils.replaceOnce and Commons Text's LevenshteinDistance are local functions.
// Import cycle with AgreementRule (ReplacementType): its value is only read inside methods.
import { AnalyzedToken } from '../../../../../../languagetool-core/org/languagetool/AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Synthesizer } from '../../../../../../languagetool-core/org/languagetool/synthesis/Synthesizer.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { ReplacementType } from './AgreementRule.ts';
import { PrepositionToCases } from './PrepositionToCases.ts';
import { Character } from '../../../../../../../jdk/java/lang/Character.ts';
import { StringMatches, StringReplaceFirst } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

/** StringUtils.replaceOnce: replaces the first occurrence of searchString. */
function StringUtils_replaceOnce(text: string, searchString: string, replacement: string): string {
  const idx = text.indexOf(searchString);
  if (searchString.length === 0 || idx < 0) {
    return text;
  }
  return text.substring(0, idx) + replacement + text.substring(idx + searchString.length);
}

/** LevenshteinDistance.getDefaultInstance().apply(left, right) (on UTF-16 chars, no threshold). */
function LevenshteinDistance_apply(left: string, right: string): number {
  const n = left.length;
  const m = right.length;
  if (n === 0) {
    return m;
  }
  if (m === 0) {
    return n;
  }
  let p = new Array<number>(m + 1);
  let d = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) {
    p[j] = j;
  }
  for (let i = 1; i <= n; i++) {
    d[0] = i;
    const c = left.charAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = right.charAt(j - 1) === c ? 0 : 1;
      d[j] = Math.min(Math.min(d[j - 1]! + 1, p[j]! + 1), p[j - 1]! + cost);
    }
    const tmp = p;
    p = d;
    d = tmp;
  }
  return p[m]!;
}

const detTemplate = 'ART:IND/DEF:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU';
const proPosTemplate = ['PRO:POS:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:BEG',
  'PRO:POS:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:B/S'];
const proDemTemplates = [
  'PRO:DEM:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:BEG',
  'PRO:DEM:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:B/S'];
const proIndTemplates = [
  'PRO:IND:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:BEG',
  'PRO:IND:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:B/S',
];
const adjTemplate = 'ADJ:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:GRU:IND/DEF';
const pa1Template = 'PA1:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:GRU:IND/DEF:VER';
const pa2Template = 'PA2:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:GRU:IND/DEF:VER';
const nounTemplates = [
  'SUB:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU',
  'SUB:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:INF'];   // INF is for cases like "das Züchten" etc.
const number = ['SIN', 'PLU'];
const gender = ['MAS', 'FEM', 'NEU', 'NOG'];
const cases = ['NOM', 'AKK', 'DAT', 'GEN'];
const nounCases = ['NOM', 'AKK', 'DAT', 'GEN'];
const skipSuggestions =
  new Set<string>(['unsren', 'unsrem', 'unsres', 'unsre', 'unsern', 'unserm', 'unsrer']);

/**
 * Create suggestions for German noun phrases that lack agreement.
 */
export class AgreementSuggestor2 {

  private readonly synthesizer: Synthesizer;
  private readonly determinerToken: AnalyzedTokenReadings;
  private readonly adjToken1: AnalyzedTokenReadings | null;
  private readonly adjToken2: AnalyzedTokenReadings | null;
  private readonly nounToken: AnalyzedTokenReadings;
  private readonly replacementType: ReplacementType | null;
  private readonly origPhrase: string;

  private prepositionToken: AnalyzedTokenReadings | null = null;
  private skippedStr: string | null = null;

  constructor(synthesizer: Synthesizer, determinerToken: AnalyzedTokenReadings, nounToken: AnalyzedTokenReadings,
              replacementType: ReplacementType | null | undefined);
  /** @since 5.4 */
  constructor(synthesizer: Synthesizer, determinerToken: AnalyzedTokenReadings, adjToken1: AnalyzedTokenReadings | null, nounToken: AnalyzedTokenReadings,
              replacementType: ReplacementType | null | undefined);
  /** @since 5.6 */
  constructor(synthesizer: Synthesizer, determinerToken: AnalyzedTokenReadings,
              adjToken1: AnalyzedTokenReadings | null, adjToken2: AnalyzedTokenReadings | null,
              nounToken: AnalyzedTokenReadings, replacementType: ReplacementType | null | undefined);
  constructor(synthesizer: Synthesizer, determinerToken: AnalyzedTokenReadings, ...rest: (AnalyzedTokenReadings | ReplacementType | null | undefined)[]) {
    let adjToken1: AnalyzedTokenReadings | null = null;
    let adjToken2: AnalyzedTokenReadings | null = null;
    let nounToken: AnalyzedTokenReadings;
    if (rest.length === 2) {
      nounToken = rest[0] as AnalyzedTokenReadings;
    } else if (rest.length === 3) {
      adjToken1 = rest[0] as AnalyzedTokenReadings | null;
      nounToken = rest[1] as AnalyzedTokenReadings;
    } else {
      adjToken1 = rest[0] as AnalyzedTokenReadings | null;
      adjToken2 = rest[1] as AnalyzedTokenReadings | null;
      nounToken = rest[2] as AnalyzedTokenReadings;
    }
    this.synthesizer = synthesizer;
    this.determinerToken = determinerToken;
    this.adjToken1 = adjToken1;
    this.adjToken2 = adjToken2;
    this.nounToken = nounToken;
    this.replacementType = (rest[rest.length - 1] as ReplacementType | null | undefined) ?? null;
    this.origPhrase = this.getOrigPhrase();
  }

  setPreposition(prep: AnalyzedTokenReadings | null): void {
    this.prepositionToken = prep;
  }

  setSkipped(skippedStr: string | null): void {
    this.skippedStr = skippedStr;
  }

  /**
   * @param filter to filter only the best suggestions, as in: if there are suggestions that replace only
   *               one word in the original phrase, don't return those that replace two words etc.
   */
  getSuggestions(filter = false): string[] {
    if (this.replacementType === ReplacementType.Zur) {
      this.prepositionToken = new AnalyzedTokenReadings(new AnalyzedToken('zu', '', 'zu'));
    } else if (this.replacementType === ReplacementType.Ins) {
      this.prepositionToken = new AnalyzedTokenReadings(new AnalyzedToken('in', '', 'zu'));
    }
    const suggestions = this.getSuggestionsInternal();
    suggestions.sort((a, b) => a.compareTo(b));  // sort so that suggestions with fewer edits come first
    this.addContraction(suggestions);
    if (filter) {
      const filteredSuggestions: Suggestion[] = [];
      const prevCorrections = suggestions.length > 0 ? suggestions[0]!.tokenLevelEdits : 0;
      let hadRealSuggestions = false;
      for (const suggestion of suggestions) {
        if (hadRealSuggestions && suggestion.tokenLevelEdits > prevCorrections) {
          break;
        }
        hadRealSuggestions = suggestion.tokenLevelEdits > 0;
        filteredSuggestions.push(suggestion);
      }
      return filteredSuggestions.map((k) => k.phrase);
    } else {
      return suggestions.map((k) => k.phrase);
    }
  }

  private addContraction(suggestions: Suggestion[]): void {
    if (this.replacementType === ReplacementType.Zur) {
      suggestions.forEach((k) => {
        if (k.phrase.startsWith('der')) {
          k.phrase = StringUtils_replaceOnce(k.phrase, 'der', 'zur');
        } else if (k.phrase.startsWith('den')) {
          k.phrase = StringUtils_replaceOnce(k.phrase, 'den', 'zu');  // usually sounds more natural than "zu den"
        } else if (k.phrase.startsWith('dem')) {
          k.phrase = StringUtils_replaceOnce(k.phrase, 'dem', 'zum');
        }
      });
    } else if (this.replacementType === ReplacementType.Ins) {
      let w = 0;
      for (const s of suggestions) {
        if (s.phrase.startsWith('das')) {
          s.phrase = StringUtils_replaceOnce(s.phrase, 'das', 'ins');
        } else if (s.phrase.startsWith('dem')) {
          s.phrase = StringUtils_replaceOnce(s.phrase, 'dem', 'im');
        } else if (s.phrase.startsWith('den')) {
          s.phrase = StringUtils_replaceOnce(s.phrase, 'den', 'in den');
        } else if (s.phrase.startsWith('die')) {
          s.phrase = StringUtils_replaceOnce(s.phrase, 'die', 'in die');
        } else {
          continue;  // iterator.remove()
        }
        suggestions[w++] = s;
      }
      suggestions.length = w;
    }
  }

  private getSuggestionsInternal(): Suggestion[] {
    const nounCases = this.getNounCases();
    const result: Suggestion[] = [];
    for (const num of number) {
      for (const gen of gender) {
        for (const aCase of cases) {
          if (!nounCases.includes(aCase)) {
            continue;
          }
          for (const detReading of this.determinerToken.getReadings()) {
            if (gen === 'NOG') {  // needed to offer suggestions for e.g. "meinem Eltern" -> "meine Eltern, ..."
              const detSynthesized = this.getDetOrPronounSynth(num, 'MAS', aCase, detReading);
              const adj1Synthesized = this.getAdjSynth(num, 'MAS', aCase, this.adjToken1, detReading);
              const adj2Synthesized = this.getAdjSynth(num, 'MAS', aCase, this.adjToken2, detReading);
              const nounSynthesized = this.getNounSynth(num, 'NOG', aCase);
              this.combineSynth(result, detSynthesized, adj1Synthesized, adj2Synthesized, nounSynthesized);
            } else {
              const detSynthesized = this.getDetOrPronounSynth(num, gen, aCase, detReading);
              const adj1Synthesized = this.getAdjSynth(num, gen, aCase, this.adjToken1, detReading);
              const adj2Synthesized = this.getAdjSynth(num, gen, aCase, this.adjToken2, detReading);
              const nounSynthesized = this.getNounSynth(num, gen, aCase);
              this.combineSynth(result, detSynthesized, adj1Synthesized, adj2Synthesized, nounSynthesized);
            }
          }
        }
      }
    }
    return result;
  }

  private getNounCases(): string[] {
    if (this.prepositionToken != null) {  // also "bis zur" = "bis" must not be considered preposition: "zur" = "zu der"
      // some prepositions require specific cases, so only generated those:
      const result: string[] = [];
      const casesForToken = PrepositionToCases.getCasesFor(this.prepositionToken.getToken());
      if (casesForToken.length > 0) {
        for (const aCase of casesForToken) {
          const val = aCase.toLowerCase();
          if (!result.includes(val)) {
            result.push(val.toUpperCase());
          }
        }
        return result;
      }
    }
    return nounCases;
  }

  private getDetOrPronounSynth(num: string, gen: string, aCase: string, detReading: AnalyzedToken): string[] {
    const detPos = detReading.getPOSTag();
    if (detPos == null) {
      return [];
    }
    let isDef = detPos.includes(':DEF:');
    let templates: string[];
    if (StringMatches(detReading.getToken(), '([Dd]as|[Dd]er|[Dd]ie|[Dd]em|[Dd]es)selben?')) {
      templates = ['PRO:DEM:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU'];
    } else if (StringMatches(detReading.getToken(), '[Ww]elche[nmsr]?')) {
      templates = ['PRO:RIN:NOM/AKK/DAT/GEN:SIN/PLU:MAS/FEM/NEU:B/S'];
    } else if (detPos.includes('ART:')) {
      templates = [detTemplate];
    } else if (detPos.includes('PRO:POS:')) {
      templates = proPosTemplate;
    } else if (detPos.includes('PRO:DEM:')) {
      templates = proDemTemplates;
    } else if (detPos.includes('PRO:IND:')) {
      templates = proIndTemplates;
    } else if (detReading.getToken() === 'zur') {
      templates = [detTemplate];
      detReading = new AnalyzedToken('der', '', 'der');
      isDef = true;
    } else if (detReading.getToken() === 'ins') {
      templates = [detTemplate];
      detReading = new AnalyzedToken('das', '', 'der');
      isDef = true;
    } else {
      return [];
    }
    const synthesized: string[] = [];
    for (let template of templates) {
      template = StringUtils_replaceOnce(template, 'IND/DEF', isDef ? 'DEF' : 'IND');
      const pos = this.replaceVars(template, num, gen, aCase);
      const tmp = this.synthesizer.synthesize(detReading, pos);
      const origFirstChar = detReading.getToken().substring(0, 1);
      synthesized.push(...tmp
        .filter((k) => k.toLowerCase().startsWith(origFirstChar.toLowerCase()))
        .filter((k) => !skipSuggestions.has(k.toLowerCase()))
        .map((k) => Character.isUpperCase(origFirstChar.charAt(0)) ? StringTools.uppercaseFirstChar(k)! : k));  // don't suggest "dein" for "mein" etc.
    }
    return synthesized;
  }

  private getAdjSynth(num: string, gen: string, aCase: string, adjToken: AnalyzedTokenReadings | null, detReading: AnalyzedToken): string[] {
    const adjSynthesized: string[] = [];
    if (adjToken != null) {
      for (const adjReading of adjToken.getReadings()) {
        if (adjReading.getPOSTag() == null || detReading.getPOSTag() == null) {
          continue;
        }
        if (adjReading.getToken() === 'meisten' && num === 'SIN') {
          continue;
        }
        if (adjReading.getPOSTag()!.startsWith('ADV:')) {  // adverb, nothing to synthesize
          adjSynthesized.push(adjReading.getToken());
          continue;
        }
        const detIsDef = detReading.getPOSTag()!.includes(':DEF:') || detReading.getToken() === 'ins';
        let template: string;
        if (adjReading.getPOSTag()!.startsWith('PA1')) {
          template = pa1Template;
        } else if (adjReading.getPOSTag()!.startsWith('PA2')) {
          template = pa2Template;
        } else {
          template = adjTemplate;
        }
        if (adjReading.getPOSTag()!.includes(':KOM:')) {
          template = template.replaceAll(':GRU:', ':KOM:');
        } else if (adjReading.getPOSTag()!.includes(':SUP:')) {
          template = template.replaceAll(':GRU:', ':SUP:');
        }
        template = StringUtils_replaceOnce(template, 'IND/DEF', detIsDef ? 'DEF' : 'IND');
        const adjPos = this.replaceVars(template, num, gen, aCase);
        const synthesize = this.synthesizer.synthesize(adjReading, adjPos);
        for (const synthNoun of synthesize) {
          if (!adjSynthesized.includes(synthNoun)) {
            adjSynthesized.push(synthNoun);
          }
        }
      }
    } else {
      adjSynthesized.push('');  // noun phrase without an adjective
    }
    return adjSynthesized;
  }

  private getNounSynth(num: string, gen: string, aCase: string): string[] {
    const result: string[] = [];
    for (const nounReading of this.nounToken.getReadings()) {
      for (const nounTemplate of nounTemplates) {
        const nounPos = this.replaceVars(nounTemplate, num, gen, aCase);
        let nounSynthesized = this.synthesizer.synthesize(nounReading, nounPos);
        if (nounSynthesized.length === 0 && nounReading.getToken().includes('-')) {
          const firstPart = nounReading.getToken().substring(0, nounReading.getToken().lastIndexOf('-') + 1);
          const lastTokenPart = StringReplaceFirst(this.nounToken.getToken(), '.*-', '');
          const lastLemmaPart = nounReading.getLemma() != null ? StringReplaceFirst(nounReading.getLemma()!, '.*-', '') : null;
          nounSynthesized = this.synthesizer.synthesize(new AnalyzedToken(lastTokenPart, 'fake_value', lastLemmaPart), nounPos);
          for (const lastPartInflected of nounSynthesized) {
            result.push(firstPart + lastPartInflected);
          }
        } else {
          result.push(...nounSynthesized);
        }
      }
    }
    // remove forms like "Blutfluß" if there's also "Blutfluss" - must be old spelling then:
    const oldSpelling = new Set(result.filter((k) => k.includes('ss')).map((k) => k.replaceAll('ss', 'ß')));
    return result.filter((k) => !oldSpelling.has(k));
  }

  private combineSynth(result: Suggestion[], detSynthesized: string[], adj1Synthesized: string[], adj2Synthesized: string[], nounSynthesized: string[]): void {
    for (const detSynthesizedElem of detSynthesized) {
      for (const adj1SynthesizedElem of adj1Synthesized) {
        for (const adj2SynthesizedElem of adj2Synthesized) {
          for (const nounSynthesizedElem of nounSynthesized) {
            let elem = detSynthesizedElem;
            if (this.skippedStr != null) {
              elem += ' ' + this.skippedStr;
            }
            if (adj1SynthesizedElem.length !== 0) {
              elem += ' ' + adj1SynthesizedElem;
            }
            if (adj2SynthesizedElem.length !== 0) {
              elem += ' ' + adj2SynthesizedElem;
            }
            elem += ' ' + nounSynthesizedElem;
            const edits = (detSynthesizedElem === this.determinerToken.getToken() ? 0 : 1) +
              (this.adjToken1 == null || adj1SynthesizedElem === this.adjToken1.getToken() ? 0 : 1) +
              (this.adjToken2 == null || adj2SynthesizedElem === this.adjToken2.getToken() ? 0 : 1) +
              (nounSynthesizedElem === this.nounToken.getToken() ? 0 : 1);
            if (edits === 0) {
              continue;
            }
            const charLevelEdits = LevenshteinDistance_apply(elem, this.origPhrase);
            const suggestion = new Suggestion(elem, edits, charLevelEdits);
            if (!result.some((s) => s.equals(suggestion))) {
              result.push(suggestion);
            }
          }
        }
      }
    }
  }

  private getOrigPhrase(): string {
    let origElem = this.determinerToken.getToken();
    if (this.adjToken1 != null) {
      origElem += ' ' + this.adjToken1.getToken();
    }
    if (this.adjToken2 != null) {
      origElem += ' ' + this.adjToken2.getToken();
    }
    origElem += ' ' + this.nounToken.getToken();
    return origElem;
  }

  private replaceVars(template: string, num: string, gen: string, aCase: string): string {
    template = StringUtils_replaceOnce(template, 'SIN/PLU', num);
    template = StringUtils_replaceOnce(template, 'MAS/FEM/NEU', gen);
    template = StringUtils_replaceOnce(template, 'NOM/AKK/DAT/GEN', aCase);
    return template;
  }

}

class Suggestion {
  phrase: string;
  tokenLevelEdits: number;
  charLevelCorrections: number;
  constructor(phrase: string, tokenLevelEdits: number, charLevelEdits: number) {
    this.phrase = phrase;
    this.tokenLevelEdits = tokenLevelEdits;
    this.charLevelCorrections = charLevelEdits;
  }
  compareTo(o: Suggestion): number {
    if (this.tokenLevelEdits === o.tokenLevelEdits) {
      return this.charLevelCorrections - o.charLevelCorrections;
    } else {
      return this.tokenLevelEdits - o.tokenLevelEdits;
    }
  }
  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof Suggestion)) return false;
    const that = o;
    return this.tokenLevelEdits === that.tokenLevelEdits && this.phrase === that.phrase;
  }
  toString(): string {
    return this.phrase + '/c=' + this.tokenLevelEdits;
  }
}
