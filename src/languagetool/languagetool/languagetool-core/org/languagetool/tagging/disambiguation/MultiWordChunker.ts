// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/MultiWordChunker.java faithful
// The three getInstance overloads are one with optional parameters; the chunker cache is keyed by
// a string made of the Settings (Java: Settings.equals/hashCode). The word file is read from
// JLanguageTool.getDataBroker(), which must have it loaded. fastutil's maps are Maps, and
// WordUtils.capitalize / StringUtils.substringBefore are local functions.
import { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import { AnalyzedToken } from '../../AnalyzedToken.ts';
import { AnalyzedTokenReadings } from '../../AnalyzedTokenReadings.ts';
import { type CheckCancelledCallback, JLanguageTool } from '../../JLanguageTool.ts';
import { StringTools } from '../../tools/StringTools.ts';
import { Character, StringTrim } from '../../../../../../jdk/java/lang/Character.ts';
import { Pattern, StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { AbstractDisambiguator } from './AbstractDisambiguator.ts';

const MAX_TOKENS_IN_MULTIWORD = 20;

const DEFAULT_SEPARATOR = '\t';

let GermanLineExpander: Pattern | null = null;

/** WordUtils.capitalize(str): the first letter of each whitespace-separated word in title case. */
function capitalize(str: string): string {
  let out = '';
  let capitalizeNext = true;
  for (const ch of str) {
    if (Character.isWhitespace(ch)) {
      capitalizeNext = true;
      out += ch;
    } else if (capitalizeNext) {
      out += Character.toTitleCase(ch);
      capitalizeNext = false;
    } else {
      out += ch;
    }
  }
  return out;
}

/** StringUtils.substringBefore(str, separator) */
function substringBefore(str: string, separator: string): string {
  const pos = str.indexOf(separator);
  return pos < 0 ? str : str.substring(0, pos);
}

/**
 * Multiword tagger-chunker.
 *
 * @author Marcin Miłkowski
 */
export class MultiWordChunker extends AbstractDisambiguator {

  private static readonly chunkerCache = new Map<string, MultiWordChunker>();
  private readonly settings: Settings;

  private initialized = false;
  private mStartSpace!: Map<string, number>;
  private mStartNoSpace!: Map<string, number>;
  private mFullSpace!: Map<string, AnalyzedToken>;
  private mFullNoSpace!: Map<string, AnalyzedToken>;

  private separator = DEFAULT_SEPARATOR;

  private addIgnoreSpelling = false;
  private isRemovePreviousTags = false;

  static tagForNotAddingTags = '_NONE_';

  private constructor(settings: Settings) {
    super();
    this.settings = settings;
  }

  /*
   * Lazy init, thanks to Artur Trzewik
   */
  private lazyInit(): void {
    if (this.initialized) {
      return;
    }

    const mStartSpace = new Map<string, number>();
    const mStartNoSpace = new Map<string, number>();
    const mFullSpace = new Map<string, AnalyzedToken>();
    const mFullNoSpace = new Map<string, AnalyzedToken>();

    this.fillMaps(mStartSpace, mStartNoSpace, mFullSpace, mFullNoSpace);

    this.mStartSpace = mStartSpace;
    this.mStartNoSpace = mStartNoSpace;
    this.mFullSpace = mFullSpace;
    this.mFullNoSpace = mFullNoSpace;
    this.initialized = true;
  }

  private fillMaps(mStartSpace: Map<string, number>, mStartNoSpace: Map<string, number>,
    mFullSpace: Map<string, AnalyzedToken>, mFullNoSpace: Map<string, AnalyzedToken>): void {
    const stream = JLanguageTool.getDataBroker().getFromResourceDirAsStream(this.settings.filename);
    const lines = this.loadWords(stream);
    for (const line of lines) {
      const stringAndTag = StringSplit(line, this.separator);
      if (stringAndTag.length !== 2 && this.settings.defaultTag == null) {
        throw new Error(
          'RuntimeException: Invalid format in ' + this.settings.filename + ": '" + line + "', expected two tab-separated parts");
      }
      if (stringAndTag.length !== 1 && this.settings.defaultTag != null) {
        throw new Error(
          'RuntimeException: Invalid format in ' + this.settings.filename + ": '" + line + "', expected one element with no separator");
      }
      const casingVariants: string[] = [];
      const originalString = stringAndTag[0]!;
      const tag = this.settings.defaultTag != null ? this.settings.defaultTag : stringAndTag[1]!;
      const containsSpace = originalString.indexOf(' ') > 0;
      casingVariants.push(originalString);
      if (containsSpace) {
        casingVariants.push(...this.getTokenLettercaseVariants(originalString, mFullSpace));
      } else {
        casingVariants.push(...this.getTokenLettercaseVariants(originalString, mFullNoSpace));
      }
      for (const casingVariant of casingVariants) {
        if (!containsSpace) {
          const firstChar = casingVariant.substring(0, 1);
          if (mStartNoSpace.has(firstChar)) {
            if (mStartNoSpace.get(firstChar)! < casingVariant.length) {
              mStartNoSpace.set(firstChar, casingVariant.length);
            }
          } else {
            mStartNoSpace.set(firstChar, casingVariant.length);
          }
          mFullNoSpace.set(casingVariant, new AnalyzedToken(casingVariant, tag, originalString));
        } else {
          const tokens = StringSplit(casingVariant, ' ');
          const firstToken = tokens[0]!;
          if (mStartSpace.has(firstToken)) {
            if (mStartSpace.get(firstToken)! < tokens.length) {
              mStartSpace.set(firstToken, tokens.length);
            }
          } else {
            mStartSpace.set(firstToken, tokens.length);
          }
          mFullSpace.set(casingVariant, new AnalyzedToken(casingVariant, tag, originalString));
        }
      }
    }
  }

  getTokenLettercaseVariants(originalToken: string, tokenMap: Map<string, AnalyzedToken>): string[] {
    const newTokens: string[] = [];
    if (this.settings.allowAllUppercase && !StringTools.isCamelCase(originalToken)) {
      // do not capitalize iPad, iPhone, etc. (single tokens)
      const tokenAllUppercase = originalToken.toUpperCase();
      if (!tokenMap.has(tokenAllUppercase) && originalToken !== tokenAllUppercase) {
        newTokens.push(tokenAllUppercase);
      }
    }
    if (this.settings.allowFirstCapitalized) {
      const tokenFirstCapitalized = StringTools.uppercaseFirstChar(originalToken)!;
      if (!tokenMap.has(tokenFirstCapitalized) && originalToken !== tokenFirstCapitalized) {
        newTokens.push(tokenFirstCapitalized);
      }
      // Titlecasing is only relevant for multi-token entries, and only done for expressions that are entirely lowercase
      // It is also limited to when first-letter capitalisation is allowed.
      if (this.settings.allowTitlecase && StringSplit(originalToken, ' ').length > 1 && StringTools.allStartWithLowercase(originalToken)) {
        const tokenNaivelyTitlecased = capitalize(originalToken);
        if (tokenNaivelyTitlecased !== tokenFirstCapitalized && originalToken !== tokenNaivelyTitlecased) {
          newTokens.push(tokenNaivelyTitlecased);
        }
        const tokenSmartlyTitlecased = StringTools.titlecaseGlobal(originalToken);
        if (tokenSmartlyTitlecased !== tokenFirstCapitalized && tokenSmartlyTitlecased !== tokenNaivelyTitlecased &&
          originalToken !== tokenSmartlyTitlecased) {
          newTokens.push(tokenSmartlyTitlecased);
        }
      }
    }
    return newTokens;
  }

  /**
   * Implements multiword POS tags, e.g., &lt;ELLIPSIS&gt; for ellipsis (...)
   * start, and &lt;/ELLIPSIS&gt; for ellipsis end.
   *
   * @param input The tokens to be chunked.
   * @return AnalyzedSentence with additional markers.
   */
  override disambiguate(input: AnalyzedSentence, checkCanceled: CheckCancelledCallback | null = null): AnalyzedSentence {

    this.lazyInit();

    const anTokens = input.getTokens();
    const output = anTokens;

    for (let i = 0; i < anTokens.length; i++) {
      let tok = output[i]!.getToken();
      if (tok.length < 1) {
        continue;
      }
      let tokBuilder = tok;
      // If the next token is not whitespace, concatenate it
      let k = i + 1;
      while (k < anTokens.length && !anTokens[k]!.isWhitespace()) {
        tokBuilder += output[k]!.getToken();
        k++;
      }
      tok = tokBuilder;
      if (checkCanceled != null && checkCanceled.checkCancelled()) {
        break;
      }
      if (this.mStartSpace.has(tok)) {
        let finalLen = 0;
        let keyBuilder = '';
        const len = this.mStartSpace.get(tok)!;
        let j = i;
        let lenCounter = 0;
        while (j < anTokens.length && j - i < MAX_TOKENS_IN_MULTIWORD) {
          if (!anTokens[j]!.isWhitespace()) {
            keyBuilder += anTokens[j]!.getToken();
            const keyStr = keyBuilder;
            const at = this.mFullSpace.get(keyStr);
            if (at != null) {
              if (at.getPOSTag() !== MultiWordChunker.tagForNotAddingTags) {
                if (finalLen === 0) { // the key has only one token
                  output[i] = this.setAndAnnotate(output[i]!, new AnalyzedToken(anTokens[j]!.getToken(), at.getPOSTag(), at.getLemma()));
                } else {
                  output[i] = this.prepareNewReading(at, output[i]!.getToken(), output[i]!, false);
                  output[finalLen] = this.prepareNewReading(at, anTokens[finalLen]!.getToken(), output[finalLen]!, true);
                }
              }
              if (this.addIgnoreSpelling) {
                if (finalLen === 0) {
                  output[i]!.ignoreSpelling();
                } else {
                  for (let m = i; m <= finalLen; m++) {
                    output[m]!.ignoreSpelling();
                  }
                }
              }
            }
          } else {
            if (j > 1 && !anTokens[j - 1]!.isWhitespace()) { // avoid multiple whitespaces
              keyBuilder += ' ';
              lenCounter++;
            }
            if (lenCounter === len) {
              break;
            }
          }
          j++;
          finalLen = j;
        }
      }
      if (this.mStartNoSpace.has(tok.substring(0, 1))) {
        let j = i;
        let keyBuilder = '';
        while (j < anTokens.length && !anTokens[j]!.isWhitespace() && j - i < MAX_TOKENS_IN_MULTIWORD) {
          keyBuilder += anTokens[j]!.getToken();
          const keyStr = keyBuilder;
          const at = this.mFullNoSpace.get(keyStr);
          if (at != null) {
            if (at.getPOSTag() !== MultiWordChunker.tagForNotAddingTags) {
              if (i === j) {
                const postag = at.getPOSTag()!;
                if (!this.isLowPriorityTag(postag) || !output[i]!.hasReading() || output[i]!.isPosTagUnknown()) {
                  output[i] = this.setAndAnnotate(output[i]!, new AnalyzedToken(anTokens[j]!.getToken(), postag, at.getLemma()));
                }
              } else {
                output[i] = this.prepareNewReading(at, anTokens[i]!.getToken(), output[i]!, false);
                output[j] = this.prepareNewReading(at, anTokens[j]!.getToken(), output[j]!, true);
              }
            }
            if (this.addIgnoreSpelling) {
              for (let m = i; m <= j; m++) {
                output[m]!.ignoreSpelling();
              }
            }
          }
          j++;
        }
      }
    }
    if (this.isRemovePreviousTags) {
      return new AnalyzedSentence(this.removePreviousTags(output));
    }
    return new AnalyzedSentence(output);
  }

  private prepareNewReading(at: AnalyzedToken, token: string, atrs: AnalyzedTokenReadings,
      isLast: boolean): AnalyzedTokenReadings {
    let sb = '';
    sb += '<';
    if (isLast) {
      sb += '/';
    }
    sb += at.getPOSTag();
    sb += '>';
    return this.setAndAnnotate(atrs, new AnalyzedToken(token, sb, at.getLemma()));
  }

  private setAndAnnotate(oldReading: AnalyzedTokenReadings, newReading: AnalyzedToken): AnalyzedTokenReadings {
    const newAtr = oldReading;
    newAtr.addReading(newReading, 'MULTIWORD_CHUNKER');
    return newAtr;
  }

  private loadWords(stream: Uint8Array | string): string[] {
    const lines: string[] = [];
    const text = typeof stream === 'string' ? stream : new TextDecoder('utf-8').decode(stream);
    this.separator = DEFAULT_SEPARATOR;
    for (let line of text.split(/\r\n|\r|\n/)) {
      line = StringTrim(line);
      if (line.startsWith('#separatorRegExp=')) {
        this.separator = line.replaceAll('#separatorRegExp=', '');
      }
      if (line === '' || line.charAt(0) === '#') { // ignore comments
        continue;
      }
      line = StringTrim(substringBefore(line, '#'));
      if ((GermanLineExpander ??= Pattern.compile('^.*/[ESN]+$')).matcher(line).matches()) {
        //German special case
        const parts = StringSplit(line, '/');
        lines.push(StringTrim(parts[0]!));
        if (parts[1]!.includes('E')) {
          lines.push(StringTrim(parts[0]!) + 'e');
        }
        if (parts[1]!.includes('S')) {
          lines.push(StringTrim(parts[0]!) + 's');
        }
        if (parts[1]!.includes('N')) {
          lines.push(StringTrim(parts[0]!) + 'n');
        }
      } else {
        lines.push(line);
      }

    }
    return lines;
  }

  /* set the ignorespelling attribute for the multi-token phrases*/
  setIgnoreSpelling(ignoreSpelling: boolean): void {
    this.addIgnoreSpelling = ignoreSpelling;
  }

  setRemovePreviousTags(removePreviousTags: boolean): void {
    this.isRemovePreviousTags = removePreviousTags;
  }

  /* Put the results of the MultiWordChunker in a more appropriate and useful way
      <NP..></NP..> becomes NP.. NP..
      For ES, PT, CA <NCMS000></NCMS000> becomes NCMS000 AQ0MS0
      The individual original tags are removed */
  private removePreviousTags(aTokens: AnalyzedTokenReadings[]): AnalyzedTokenReadings[] {
    let i = 0;
    let POSTag = '';
    let lemma: string | null = '';
    let nextPOSTag = '';
    let analyzedToken: AnalyzedToken | null = null;
    while (i < aTokens.length) {
      if (!aTokens[i]!.isWhitespace()) {
        if (nextPOSTag !== '') {
          const newAnalyzedToken = new AnalyzedToken(aTokens[i]!.getToken(), nextPOSTag, lemma);
          if (aTokens[i]!.hasPosTagAndLemma('</' + POSTag + '>', lemma!)) {
            nextPOSTag = '';
            lemma = '';
          }
          aTokens[i] = new AnalyzedTokenReadings(aTokens[i]!, [newAnalyzedToken],
            'HybridDisamb');
        } else if ((analyzedToken = this.getMultiWordAnalyzedToken(aTokens, i)) != null) {
          POSTag = analyzedToken.getPOSTag()!.substring(1, analyzedToken.getPOSTag()!.length - 1);
          lemma = analyzedToken.getLemma();
          if (aTokens[i]!.hasPosTagAndLemma('</' + POSTag + '>', lemma!)) {
            // it is only one token
            aTokens[i]!.removeReading(aTokens[i]!.readingWithTagRegex('</' + POSTag + '>')!, 'HybridDisamb');
            aTokens[i]!.removeReading(aTokens[i]!.readingWithTagRegex('<' + POSTag + '>')!, 'HybridDisamb');
            aTokens[i]!.addReading(new AnalyzedToken(analyzedToken.getToken(), POSTag, lemma), 'HybridDisamb');
            nextPOSTag = '';
            lemma = '';
          } else {
            const newAnalyzedToken = new AnalyzedToken(analyzedToken.getToken(), POSTag, lemma);
            aTokens[i] = new AnalyzedTokenReadings(aTokens[i]!, [newAnalyzedToken], 'HybridDisamb');
            nextPOSTag = this.getNextPosTag(POSTag);
          }
        }
      }
      i++;
    }
    return aTokens;
  }

  private getMultiWordAnalyzedToken(aTokens: AnalyzedTokenReadings[], i: number): AnalyzedToken | null {
    const l: AnalyzedToken[] = [];
    for (const reading of aTokens[i]!) {
      const POSTag = reading.getPOSTag();
      if (POSTag != null) {
        if (POSTag.startsWith('<') && POSTag.endsWith('>') && !POSTag.startsWith('</')) {
          l.push(reading);
        }
      }
    }
    // choose the longest one
    if (l.length > 0) {
      let selectedAT: AnalyzedToken | null = null;
      let maxDistance = 0;
      for (const at of l) {
        const tag = '</' + at.getPOSTag()!.substring(1);
        const cleanTag = at.getPOSTag()!.substring(1, at.getPOSTag()!.length - 2);
        const lemma = at.getLemma();
        let distance = 1;
        while (i + distance < aTokens.length) {
          if (aTokens[i + distance]!.hasPosTagAndLemma(tag, lemma!)) {
            if (distance > maxDistance) {
              maxDistance = distance;
              selectedAT = at;
            }
            if (distance === maxDistance && !this.isLowPriorityTag(cleanTag)) {
              maxDistance = distance;
              selectedAT = at;
            }
            break;
          }
          distance++;
        }
      }
      return selectedAT;
    }
    return null;
  }

  private getNextPosTag(postag: string): string {
    if (postag.startsWith('NC')) {
      // for ES, PT, CA
      return 'AQ0' + postag.substring(2, 4) + '0';
    } else if (postag.startsWith('N ')) {
      // French
      return 'J ' + postag.substring(2);
    }
    return postag;
  }

  private isLowPriorityTag(tag: string): boolean {
    // CA, ES
    return tag === 'NPCN000';
  }

  /**
   * @param filename              file text with multiwords and tags
   * @param allowFirstCapitalized if set to {@code true}, first word of the
   *                              multiword can be capitalized
   * @param allowAllUppercase     if set to {@code true}, the all uppercase
   *                              version of the multiword is allowed
   * @param allowTitlecase        if set to {@code true}, titlecased variants
   *                              of multi-token words are accepted
   */
  static getInstance(filename: string,
                     allowFirstCapitalized = false,
                     allowAllUppercase = false,
                     allowTitlecase = false,
                     defaultTag: string | null = null): MultiWordChunker {
    const settings = new Settings(filename, allowFirstCapitalized, allowAllUppercase, allowTitlecase, defaultTag);
    let chunker = MultiWordChunker.chunkerCache.get(settings.key());
    if (chunker === undefined) {
      chunker = new MultiWordChunker(settings);
      MultiWordChunker.chunkerCache.set(settings.key(), chunker);
    }
    return chunker;
  }

}

class Settings {
  readonly filename: string;
  readonly allowFirstCapitalized: boolean;
  readonly allowAllUppercase: boolean;
  readonly allowTitlecase: boolean;
  readonly defaultTag: string | null;

  constructor(filename: string, allowFirstCapitalized: boolean, allowAllUppercase: boolean, allowTitlecase: boolean, defaultTag: string | null) {
    this.filename = filename;
    this.allowFirstCapitalized = allowFirstCapitalized;
    this.allowAllUppercase = allowAllUppercase;
    this.allowTitlecase = allowTitlecase;
    this.defaultTag = defaultTag;
  }

  /** Stands in for equals/hashCode as the cache key. */
  key(): string {
    return [this.filename, this.allowFirstCapitalized, this.allowAllUppercase, this.allowTitlecase, this.defaultTag].join('\u0000');
  }
}
