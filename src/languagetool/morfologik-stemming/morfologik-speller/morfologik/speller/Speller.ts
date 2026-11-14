// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-speller/src/main/java/morfologik/speller/Speller.java faithful
// A Java char is a one-unit string (char[] a string[]). The inner class CandidateData is
// exported beside Speller and takes the Speller (for getFrequency) as its first argument.
// toLowerCase(Locale)/toUpperCase(Locale) only differ from the root locale for tr, az and lt, as
// in Java; the locale is the name from the .info file, which Java reads with new Locale(name).
import { Character } from '../../../../jdk/java/lang/Character.ts';
import { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { CharBuffer } from '../../../../jdk/java/nio/CharBuffer.ts';
import type { CharsetDecoder, CharsetEncoder } from '../../../../jdk/java/nio/charset/Charset.ts';
import { ByteSequenceIterator } from '../../../morfologik-fsa/morfologik/fsa/ByteSequenceIterator.ts';
import type { FSA } from '../../../morfologik-fsa/morfologik/fsa/FSA.ts';
import { FSATraversal } from '../../../morfologik-fsa/morfologik/fsa/FSATraversal.ts';
import { MatchResult } from '../../../morfologik-fsa/morfologik/fsa/MatchResult.ts';
import { BufferUtils } from '../../../morfologik-stemming/morfologik/stemming/BufferUtils.ts';
import type { Dictionary } from '../../../morfologik-stemming/morfologik/stemming/Dictionary.ts';
import { DictionaryLookup } from '../../../morfologik-stemming/morfologik/stemming/DictionaryLookup.ts';
import type { DictionaryMetadata } from '../../../morfologik-stemming/morfologik/stemming/DictionaryMetadata.ts';
import { UnmappableInputException } from '../../../morfologik-stemming/morfologik/stemming/UnmappableInputException.ts';
import { HMatrix } from './HMatrix.ts';

const { EXACT_MATCH, SEQUENCE_IS_A_PREFIX } = MatchResult;

/** The languages whose case mapping differs from the root locale's in Java. */
const isSpecialCasingLocale = (locale: string): boolean => /^(tr|az|lt)$/i.test(locale);
/** String.toLowerCase(Locale). */
const toLowerCase = (s: string, locale: string): string => isSpecialCasingLocale(locale) ? s.toLocaleLowerCase(locale.toLowerCase()) : s.toLowerCase();
/** String.toUpperCase(Locale). */
const toUpperCase = (s: string, locale: string): string => isSpecialCasingLocale(locale) ? s.toLocaleUpperCase(locale.toLowerCase()) : s.toUpperCase();
/** Character.getType in UPPERCASE_LETTER, LOWERCASE_LETTER, TITLECASE_LETTER, MODIFIER_LETTER, OTHER_LETTER, LETTER_NUMBER. */
const ALPHABETIC = /^[\p{Lu}\p{Ll}\p{Lt}\p{Lm}\p{Lo}\p{Nl}]$/u;

/**
 * Finds spelling suggestions. Implements K. Oflazer's algorithm as described
 * in: Oflazer, Kemal. 1996.
 * "Error-Tolerant Finite-State Recognition with Applications to Morphological Analysis and Spelling Correction."
 * <i>Computational Linguistics</i> 22 (1): 73–89.
 *
 * <p>
 * See Jan Daciuk's <code>s_fsa</code> package.
 */
export class Speller {
  /**
   * Maximum length of the word to be checked.
   */
  static readonly MAX_WORD_LENGTH = 120;
  static readonly FREQ_RANGES = 'Z'.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
  static readonly FIRST_RANGE_CODE = 'A'.charCodeAt(0); // less frequent words

  //FIXME: this is an upper limit for replacement searches, we need
  //proper tree traversal instead of generation of all possible candidates
  static readonly UPPER_SEARCH_LIMIT = 15;
  private static readonly MIN_WORD_LENGTH = 4;
  private static readonly MAX_RECURSION_LEVEL = 6;

  private readonly editDistance: number;
  private effectEditDistance = 0; // effective edit distance

  private readonly hMatrix: HMatrix;

  private candidate: string[] = []; /* current replacement */
  private candLen = 0;
  private wordLen = 0; /* length of word being processed */
  private wordProcessed: string[] = []; /* word being processed */

  private replacementsAnyToOne = new Map<string, string[][]>();
  private replacementsAnyToTwo = new Map<string, string[][]>();
  private replacementsTheRest = new Map<string, string[]>();

  private containsSeparators = true;

  /**
   * Internal reusable buffer for encoding words into byte arrays using
   * {@link #encoder}.
   */
  private byteBuffer = ByteBuffer.allocate(Speller.MAX_WORD_LENGTH);

  /**
   * Internal reusable buffer for encoding words into byte arrays using
   * {@link #encoder}.
   */
  private charBuffer = CharBuffer.allocate(Speller.MAX_WORD_LENGTH);

  /**
   * Reusable match result.
   */
  private readonly matchResult = new MatchResult();

  /**
   * Features of the compiled dictionary.
   *
   * @see DictionaryMetadata
   */
  private readonly dictionaryMetadata: DictionaryMetadata;

  /**
   * Charset encoder for the FSA.
   */
  private readonly encoder: CharsetEncoder;

  /**
   * Charset decoder for the FSA.
   */
  private readonly decoder: CharsetDecoder;

  /** An FSA used for lookups. */
  private readonly matcher: FSATraversal;

  /** FSA's root node. */
  private readonly rootNode: number;

  /**
   * The FSA we are using.
   */
  private readonly fsa: FSA;

  /** An iterator for walking along the final states of {@link #fsa}. */
  private readonly finalStatesIterator: ByteSequenceIterator;

  constructor(dictionary: Dictionary, editDistance = 1) {
    this.editDistance = editDistance;
    this.hMatrix = new HMatrix(editDistance, Speller.MAX_WORD_LENGTH);

    this.dictionaryMetadata = dictionary.metadata;
    this.rootNode = dictionary.fsa.getRootNode();
    this.fsa = dictionary.fsa;
    this.matcher = new FSATraversal(this.fsa);
    this.finalStatesIterator = new ByteSequenceIterator(this.fsa, this.rootNode);

    if (this.rootNode == 0) {
      throw new Error("IllegalArgumentException: Dictionary must have at least the root node.");
    }

    if (this.dictionaryMetadata == null) {
      throw new Error("IllegalArgumentException: Dictionary metadata must not be null.");
    }

    this.encoder = this.dictionaryMetadata.getEncoder();
    this.decoder = this.dictionaryMetadata.getDecoder();

    // Multibyte separator will result in an exception here.
    this.dictionaryMetadata.getSeparatorAsChar();

    this.createReplacementsMaps();
  }

  private createReplacementsMaps(): void {
    for (const [key, value] of this.dictionaryMetadata.getReplacementPairs()) {
      for (const s of value) {
        // replacements any to one
        // the new key is the target of the replacement pair
        if (s.length == 1) {
          if (!this.replacementsAnyToOne.has(s.charAt(0))) {
            const charList: string[][] = [];
            charList.push(key.split(''));
            this.replacementsAnyToOne.set(s.charAt(0), charList);
          } else {
            this.replacementsAnyToOne.get(s.charAt(0))!.push(key.split(''));
          }
        }
        // replacements any to two
        // the new key is the target of the replacement pair
        else if (s.length == 2) {
          if (!this.replacementsAnyToTwo.has(s)) {
            const charList: string[][] = [];
            charList.push(key.split(''));
            this.replacementsAnyToTwo.set(s, charList);
          } else {
            this.replacementsAnyToTwo.get(s)!.push(key.split(''));
          }
        } else {
          if (!this.replacementsTheRest.has(key)) {
            const charList: string[] = [];
            charList.push(s);
            this.replacementsTheRest.set(key, charList);
          } else {
            this.replacementsTheRest.get(key)!.push(s);
          }
        }
      }
    }
  }

  private charSequenceToBytes(word: string): ByteBuffer {
    // Encode word characters into bytes in the same encoding as the FSA's.
    this.charBuffer = BufferUtils.clearAndEnsureCapacity(this.charBuffer, word.length);
    for (let i = 0; i < word.length; i++) {
      const chr = word.charAt(i);
      this.charBuffer.put(chr);
    }
    this.charBuffer.flip();

    return BufferUtils.charsToBytes(this.encoder, this.charBuffer, this.byteBuffer);
  }

  /**
   * Checks whether the word is misspelled, by performing a series of checks
   * according to properties of the dictionary.
   *
   * If the flag <code>fsa.dict.speller.ignore-punctuation</code> is set, then
   * all non-alphabetic characters are considered to be correctly spelled.
   *
   * If the flag <code>fsa.dict.speller.ignore-numbers</code> is set, then all
   * words containing decimal digits are considered to be correctly spelled.
   *
   * If the flag <code>fsa.dict.speller.ignore-camel-case</code> is set, then
   * all CamelCase words are considered to be correctly spelled.
   *
   * If the flag <code>fsa.dict.speller.ignore-all-uppercase</code> is set, then
   * all alphabetic words composed of only uppercase characters are considered
   * to be correctly spelled.
   *
   * Otherwise, the word is checked in the dictionary. If the test fails, and
   * the dictionary does not perform any case conversions (as set by
   * <code>fsa.dict.speller.convert-case</code> flag), then the method returns
   * false. In case of case conversions, it is checked whether a non-mixed case
   * word is found in its lowercase version in the dictionary, and for
   * all-uppercase words, whether the word is found in the dictionary with the
   * initial uppercase letter.
   *
   * @param word
   *          - the word to be checked
   * @return true if the word is misspelled
   **/
  isMisspelled(word: string): boolean {
    // dictionaries usually do not contain punctuation
    let wordToCheck = word;
    if (this.dictionaryMetadata.getInputConversionPairs().size != 0) {
      wordToCheck = DictionaryLookup.applyReplacements(word, this.dictionaryMetadata.getInputConversionPairs());
    }
    const isAlphabetic = wordToCheck.length != 1 || Speller.isAlphabetic(wordToCheck.charAt(0));
    return wordToCheck.length > 0
        && (!this.dictionaryMetadata.isIgnoringPunctuation() || isAlphabetic)
        && (!this.dictionaryMetadata.isIgnoringNumbers() || Speller.containsNoDigit(wordToCheck))
        && !(this.dictionaryMetadata.isIgnoringCamelCase() && this.isCamelCase(wordToCheck))
        && !(this.dictionaryMetadata.isIgnoringAllUppercase() && isAlphabetic && this.isAllUppercase(wordToCheck))
        && !this.isInDictionary(wordToCheck)
        && (!this.dictionaryMetadata.isConvertingCase() ||
            !(!this.isMixedCase(wordToCheck) &&
                (this.isInDictionary(toLowerCase(wordToCheck, this.dictionaryMetadata.getLocale()))
                    || this.isAllUppercase(wordToCheck) && this.isInDictionary(this.initialUppercase(wordToCheck)))));
  }

  private initialUppercase(wordToCheck: string): string {
    return wordToCheck.substring(0, 1) + toLowerCase(wordToCheck.substring(1), this.dictionaryMetadata.getLocale());
  }

  /**
   * Test whether the word is found in the dictionary.
   *
   * @param word
   *          the word to be tested
   * @return True if it is found.
   */
  isInDictionary(word: string): boolean {
    try {
      this.byteBuffer = this.charSequenceToBytes(word);
    } catch (e) {
      if (!(e instanceof UnmappableInputException)) throw e;
      return false;
    }

    // Try to find a partial match in the dictionary.
    const match = this.matcher.match(this.matchResult, this.byteBuffer.array(), 0, this.byteBuffer.remaining(), this.rootNode);

    // Make sure the word doesn't contain a separator if there is an exact match
    if (this.containsSeparators && match.kind == EXACT_MATCH) {
      this.containsSeparators = false;
      for (let i=0; i<word.length; i++) {
        if (word.charCodeAt(i) == this.dictionaryMetadata.getSeparator()) {
          this.containsSeparators = true;
          break;
        }
      }
    }

    if (match.kind == EXACT_MATCH && !this.containsSeparators) {
      return true;
    }

    return this.containsSeparators && match.kind == SEQUENCE_IS_A_PREFIX && this.byteBuffer.remaining() > 0
        && this.fsa.getArc(match.node, this.dictionaryMetadata.getSeparator()) != 0;
  }

  /**
   * Get the frequency value for a word form. It is taken from the first entry
   * with this word form.
   *
   * @param word
   *          the word to be tested
   * @return frequency value in range: 0..FREQ_RANGE-1 (0: less frequent).
   */

  getFrequency(word: string): number {
    if (!this.dictionaryMetadata.isFrequencyIncluded()) {
      return 0;
    }

    const separator = this.dictionaryMetadata.getSeparator();
    try {
      this.byteBuffer = this.charSequenceToBytes(word);
    } catch (e) {
      if (!(e instanceof UnmappableInputException)) throw e;
      return 0;
    }

    const match = this.matcher.match(this.matchResult, this.byteBuffer.array(), 0, this.byteBuffer.remaining(), this.rootNode);
    if (match.kind == SEQUENCE_IS_A_PREFIX) {
      const arc = this.fsa.getArc(match.node, separator);
      if (arc != 0 && !this.fsa.isArcFinal(arc)) {
        this.finalStatesIterator.restartFrom(this.fsa.getEndNode(arc));
        if (this.finalStatesIterator.hasNext()) {
          const bb = this.finalStatesIterator.next();
          const ba = bb.array();
          const bbSize = bb.remaining();
          //the last byte contains the frequency after a separator
          return ba[bbSize - 1]! - Speller.FIRST_RANGE_CODE;
        }
      }
    }
    return 0;
  }

  /**
   * Propose suggestions for misspelled run-on words. This algorithm is inspired
   * by spell.cc in s_fsa package by Jan Daciuk.
   *
   * @param original
   *          The original misspelled word.
   * @return The list of suggested pairs, as CandidateData with space-concatenated strings.
   */
  replaceRunOnWordCandidates(original: string): CandidateData[] {
    const candidates: CandidateData[] = [];
    let wordToCheck = original;
    if (this.dictionaryMetadata.getInputConversionPairs().size != 0) {
      wordToCheck = DictionaryLookup.applyReplacements(original, this.dictionaryMetadata.getInputConversionPairs());
    }
    if (!this.isInDictionary(wordToCheck) && this.dictionaryMetadata.isSupportingRunOnWords()) {
      const locale = this.dictionaryMetadata.getLocale();
      for (let i = 1; i < wordToCheck.length; i++) {
        // chop from left to right
        const prefix = wordToCheck.substring(0, i);
        const suffix = wordToCheck.substring(i);
        if (this.isInDictionary(suffix)
            // camel case words: e.g. GreatElephant
            || (!this.isNotCapitalizedWord(suffix) && this.isInDictionary(toLowerCase(suffix, locale)))) {
          if (this.isInDictionary(prefix)) {
            this.addReplacement(candidates, prefix + " " + suffix);
          } else if (Character.isUpperCase(prefix.charAt(0)) && this.isInDictionary(toLowerCase(prefix, locale))) {
            // a word that's uppercase just because used at sentence start
            this.addReplacement(candidates, prefix + " " + suffix);
          }
        }
      }
    }
    return candidates;
  }

  /**
   * Propose suggestions for misspelled run-on words. This algorithm is inspired
   * by spell.cc in s_fsa package by Jan Daciuk.
   *
   * @param original
   *          The original misspelled word.
   * @return The list of suggested pairs, as space-concatenated strings.
   */
  replaceRunOnWords(original: string): string[] {
    const candidateData = this.replaceRunOnWordCandidates(original);
    const candidates: string[] = [];
    for (const candidate of candidateData) {
      candidates.push(candidate.word);
    }
    return candidates;
  }

  private addReplacement(candidates: CandidateData[], replacement: string): void {
    if (this.dictionaryMetadata.getOutputConversionPairs().size == 0) {
      candidates.push(new CandidateData(this, replacement, 1));
    } else {
      candidates.push(new CandidateData(this, DictionaryLookup.applyReplacements(replacement,
          this.dictionaryMetadata.getOutputConversionPairs()), 1));
    }
  }

  /**
   * Find similar words even if the original word is a correct word that exists in the dictionary
   *
   * @param word The original word.
   * @return A list of suggested candidate replacements.
   */
  findSimilarWordCandidates(word: string): CandidateData[] {
    return this.findReplacementCandidates(word, true);
  }

  findSimilarWords(word: string): string[] {
    const result = this.findSimilarWordCandidates(word);
    const resultSuggestions: string[] = [];
    for (const cd of result) {
      resultSuggestions.push(cd.getWord());
    }
    return resultSuggestions;
  }


  /**
   * Find suggestions by using K. Oflazer's algorithm. See Jan Daciuk's s_fsa
   * package, spell.cc for further explanation.
   *
   * @param word The original misspelled word.
   * @return A list of suggested replacements.
   */
  findReplacements(word: string): string[] {
    const result = this.findReplacementCandidates(word);

    const resultSuggestions: string[] = [];
    for (const cd of result) {
      resultSuggestions.push(cd.getWord());
    }
    return resultSuggestions;
  }


  /**
   * Find and return suggestions by using K. Oflazer's algorithm. See Jan Daciuk's s_fsa
   * package, spell.cc for further explanation. This method is identical to
   * {@link #findReplacements}, but returns candidate terms with their edit distance scores.
   * (The public overload has evenIfWordInDictionary = false; the private one takes it.)
   *
   * @param word The original misspelled word.
   * @return A list of suggested candidate replacements.
   */
  findReplacementCandidates(word: string, evenIfWordInDictionary = false): CandidateData[] {
    if (this.dictionaryMetadata.getInputConversionPairs().size != 0) {
      word = DictionaryLookup.applyReplacements(word, this.dictionaryMetadata.getInputConversionPairs());
    }

    // candidate strings, including same additional data such as edit distance from the original word.
    const candidates: CandidateData[] = [];

    if (word.length > 0 && word.length < Speller.MAX_WORD_LENGTH && (!this.isInDictionary(word) || evenIfWordInDictionary)) {
      const wordsToCheck: string[] = [];
      if (this.replacementsTheRest != null && word.length > 1) {
        for (const wordChecked of this.getAllReplacements(word, 0, 0)) {
          if (this.isInDictionary(wordChecked)) {
            candidates.push(new CandidateData(this, wordChecked, 0));
          } else {
            const lowerWord = toLowerCase(wordChecked, this.dictionaryMetadata.getLocale());
            const upperWord = toUpperCase(wordChecked, this.dictionaryMetadata.getLocale());
            if (this.isInDictionary(lowerWord)) {
              //add the word as it is in the dictionary, not mixed-case versions of it
              candidates.push(new CandidateData(this, lowerWord, 0));
            }
            if (this.isInDictionary(upperWord)) {
              candidates.push(new CandidateData(this, upperWord, 0));
            }
            if (lowerWord.length > 1) {
              const firstUpperWord = Character.toUpperCase(lowerWord.charAt(0)) + lowerWord.substring(1);
              if (this.isInDictionary(firstUpperWord)) {
                candidates.push(new CandidateData(this, firstUpperWord, 0));
              }
            }
          }
          wordsToCheck.push(wordChecked);
        }
      } else {
        wordsToCheck.push(word);
      }

      // Even if a candidate was found with the replacement pairs (which are usual errors),
      // there might be more good candidates (see issue #94):
      let i = 1;
      for (const wordChecked of wordsToCheck) {
        i++;
        if (i > Speller.UPPER_SEARCH_LIMIT) { // for performance reasons, do not search too deeply
          break;
        }
        this.wordProcessed = wordChecked.split('');
        this.wordLen = this.wordProcessed.length;
        if (this.wordLen < Speller.MIN_WORD_LENGTH && i > 2) { // three-letter replacements make little sense anyway
          break;
        }
        this.candidate = new Array<string>(Speller.MAX_WORD_LENGTH).fill('\0');
        this.candLen = this.candidate.length;
        this.effectEditDistance = this.wordLen <= this.editDistance ? this.wordLen - 1 : this.editDistance;
        this.charBuffer = BufferUtils.clearAndEnsureCapacity(this.charBuffer, Speller.MAX_WORD_LENGTH);
        this.byteBuffer = BufferUtils.clearAndEnsureCapacity(this.byteBuffer, Speller.MAX_WORD_LENGTH);
        const prevBytes = new Int8Array(0);
        this.findRepl(candidates, 0, this.fsa.getRootNode(), prevBytes, 0, 0);
      }
    }

    candidates.sort((a, b) => a.compareTo(b));

    // Apply replacements, prune duplicates while preserving the candidate order.
    const words = new Set<string>();
    const result: CandidateData[] = [];
    for (const cd of candidates) {
      const replaced = DictionaryLookup.applyReplacements(cd.getWord(), this.dictionaryMetadata.getOutputConversionPairs());
      // Add only the first occurrence of a given word.
      const added = !words.has(replaced);
      words.add(replaced);
      if (added && replaced !== word) {
        result.push(new CandidateData(this, replaced, cd.origDistance));
      }
    }

    return result;
  }

  private findRepl(candidates: CandidateData[], depth: number, node: number, prevBytes: Int8Array, wordIndex: number, candIndex: number): void {
    let dist = 0;
    for (let arc = this.fsa.getFirstArc(node); arc != 0; arc = this.fsa.getNextArc(arc)) {
      this.byteBuffer = BufferUtils.clearAndEnsureCapacity(this.byteBuffer, prevBytes.length + 1);
      this.byteBuffer.put(prevBytes);
      this.byteBuffer.put(this.fsa.getArcLabel(arc));
      const bufPos = this.byteBuffer.position();
      this.byteBuffer.flip();
      this.decoder.reset();
      // FIXME: this isn't correct -- no checks for overflows, no decoder flush. I don't think this should be in here
      // too, the decoder should run once on accumulated temporary byte buffer (current path) only when there's
      // a potential that this buffer can become a replacement candidate (isEndOfCandidate). Because we assume candidates
      // are valid input strings (this is verified when building the dictionary), it's save a lot of conversions.
      const c = this.decoder.decode(this.byteBuffer, this.charBuffer, true);
      if (c.isMalformed()) { // assume that only valid
        // encodings are there
        const prev = new Int8Array(bufPos);
        this.byteBuffer.position(0);
        this.byteBuffer.get(prev);
        if (!this.fsa.isArcTerminal(arc)) {
          this.findRepl(candidates, depth, this.fsa.getEndNode(arc), prev, wordIndex, candIndex); // note: depth is not incremented
        }
        this.byteBuffer.clear();
      } else if (!c.isError()) { // unmappable characters are silently discarded
        this.charBuffer.flip();
        this.candidate[candIndex] = this.charBuffer.get();
        this.charBuffer.clear();
        this.byteBuffer.clear();

        let lengthReplacement: number;
        // replacement "any to two"
        if ((lengthReplacement = this.matchAnyToTwo(wordIndex, candIndex)) > 0) {
          // the replacement takes place at the end of the candidate
          if (this.isEndOfCandidate(arc, wordIndex) && (dist = this.hMatrix.get(depth - 1, depth - 1)) <= this.effectEditDistance) {
            if (Math.abs(this.wordLen - 1 - (wordIndex + lengthReplacement - 2)) > 0) {
              // there are extra letters in the word after the replacement
              dist = dist + Math.abs(this.wordLen - 1 - (wordIndex + lengthReplacement - 2));
            }
            if (dist <= this.effectEditDistance) {
              candidates.push(new CandidateData(this, this.candidate.slice(0, candIndex + 1).join(''), dist));
            }
          }
          if (this.isArcNotTerminal(arc, candIndex)) {
            const x = this.hMatrix.get(depth, depth);
            this.hMatrix.set(depth, depth, this.hMatrix.get(depth - 1, depth - 1));
            this.findRepl(candidates, Math.max(0, depth), this.fsa.getEndNode(arc), new Int8Array(0), wordIndex + lengthReplacement - 1,
                candIndex + 1);
            this.hMatrix.set(depth, depth, x);
          }
        }
        //replacement "any to one"
        if ((lengthReplacement = this.matchAnyToOne(wordIndex, candIndex)) > 0) {
          // the replacement takes place at the end of the candidate
          if (this.isEndOfCandidate(arc, wordIndex) && (dist = this.hMatrix.get(depth, depth)) <= this.effectEditDistance) {
            if (Math.abs(this.wordLen - 1 - (wordIndex + lengthReplacement - 1)) > 0) {
              // there are extra letters in the word after the replacement
              dist = dist + Math.abs(this.wordLen - 1 - (wordIndex + lengthReplacement - 1));
            }
            if (dist <= this.effectEditDistance) {
              candidates.push(new CandidateData(this, this.candidate.slice(0, candIndex + 1).join(''), dist));
            }
          }
          if (this.isArcNotTerminal(arc, candIndex)) {
            this.findRepl(candidates, depth, this.fsa.getEndNode(arc), new Int8Array(0), wordIndex + lengthReplacement, candIndex + 1);
          }
        }
        //general
        if (this.cuted(depth, wordIndex, candIndex) <= this.effectEditDistance) {
          if ((this.isEndOfCandidate(arc, wordIndex))
              && (dist = this.ed(this.wordLen - 1 - (wordIndex - depth), depth, this.wordLen - 1, candIndex)) <= this.effectEditDistance) {
            candidates.push(new CandidateData(this, this.candidate.slice(0, candIndex + 1).join(''), dist));
          }
          if (this.isArcNotTerminal(arc, candIndex)) {
            this.findRepl(candidates, depth + 1, this.fsa.getEndNode(arc), new Int8Array(0), wordIndex + 1, candIndex + 1);
          }
        }
      }
    }
  }

  private isArcNotTerminal(arc: number, candIndex: number): boolean {
    return !this.fsa.isArcTerminal(arc)
        && !(this.containsSeparators && this.candidate[candIndex] == this.dictionaryMetadata.getSeparatorAsChar());
  }

  private isEndOfCandidate(arc: number, wordIndex: number): boolean {
    return (this.fsa.isArcFinal(arc) || this.isBeforeSeparator(arc))
    //candidate has proper length
        && (Math.abs(this.wordLen - 1 - (wordIndex)) <= this.effectEditDistance);
  }

  private isBeforeSeparator(arc: number): boolean {
    if (this.containsSeparators) {
      const arc1 = this.fsa.getArc(this.fsa.getEndNode(arc), this.dictionaryMetadata.getSeparator());
      return arc1 != 0 && !this.fsa.isArcTerminal(arc1);
    }
    return false;
  }

  /**
   * Calculates edit distance.
   *
   * @param i length of first word (here: misspelled) - 1;
   * @param j length of second word (here: candidate) - 1.
   * @param wordIndex (TODO: javadoc?)
   * @param candIndex (TODO: javadoc?)
   * @return Edit distance between the two words. Remarks: See Oflazer.
   */
  ed(i: number, j: number, wordIndex: number, candIndex: number): number {
    let result: number;
    let a: number, b: number, c: number;

    if (this.areEqual(this.wordProcessed[wordIndex]!, this.candidate[candIndex]!)) {
      // last characters are the same
      result = this.hMatrix.get(i, j);
    } else if (wordIndex > 0 && candIndex > 0 && this.wordProcessed[wordIndex] == this.candidate[candIndex - 1]
        && this.wordProcessed[wordIndex - 1] == this.candidate[candIndex]) {
      // last two characters are transposed
      a = this.hMatrix.get(i - 1, j - 1); // transposition, e.g. ababab, ababba
      b = this.hMatrix.get(i + 1, j); // deletion, e.g. abab, aba
      c = this.hMatrix.get(i, j + 1); // insertion e.g. aba, abab
      result = 1 + Speller.min(a, b, c);
    } else {
      // otherwise
      a = this.hMatrix.get(i, j); // replacement, e.g. ababa, ababb
      b = this.hMatrix.get(i + 1, j); // deletion, e.g. ab, a
      c = this.hMatrix.get(i, j + 1); // insertion e.g. a, ab
      result = 1 + Speller.min(a, b, c);
    }

    this.hMatrix.set(i + 1, j + 1, result);
    return result;
  }

  // by Jaume Ortola
  private areEqual(x: string, y: string): boolean {
    if (x == y) {
      return true;
    }
    if (this.dictionaryMetadata.getEquivalentChars() != null) {
      const chars = this.dictionaryMetadata.getEquivalentChars().get(x);
      if (chars != null && chars.includes(y)) {
        return true;
      }
    }
    if (this.dictionaryMetadata.isIgnoringDiacritics()) {
      const xn = x.normalize('NFD');
      const yn = y.normalize('NFD');
      if (xn.charAt(0) == yn.charAt(0)) { // avoid case conversion, if possible
        return true;
      }
      if (this.dictionaryMetadata.isConvertingCase()) {
        //again case conversion only when needed -- we
        // do not need String.lowercase because we only check
        // single characters, so a cheaper method is enough
        if (Character.isLetter(xn.charAt(0))) {
          const testNeeded = Character.isLowerCase(xn.charAt(0)) != Character.isLowerCase(yn.charAt(0));
          if (testNeeded) {
            return Character.toLowerCase(xn.charAt(0)) == Character.toLowerCase(yn.charAt(0));
          }
        }
      }
      return xn.charAt(0) == yn.charAt(0);
    }
    return false;
  }

  /**
   * Calculates cut-off edit distance.
   *
   * @param depth current length of candidates.
   * @param wordIndex (TODO: javadoc?)
   * @param candIndex (TODO: javadoc?)
   * @return Cut-off edit distance. Remarks: See Oflazer.
   */
  cuted(depth: number, wordIndex: number, candIndex: number): number {
    const l = Math.max(0, depth - this.effectEditDistance); // min chars from word to consider - 1
    const u = Math.min(this.wordLen - 1 - (wordIndex - depth), depth + this.effectEditDistance); // max chars from word to
    // consider - 1
    let minEd = this.effectEditDistance + 1; // what is to be computed
    let wi = wordIndex + l - depth;
    let d: number;

    for (let i = l; i <= u; i++, wi++) {
      if ((d = this.ed(i, depth, wi, candIndex)) < minEd) {
        minEd = d;
      }
    }
    return minEd;
  }

  // Match the last letter of the candidate against two or more letters of the word.
  private matchAnyToOne(wordIndex: number, candIndex: number): number {
    if (this.replacementsAnyToOne.has(this.candidate[candIndex]!)) {
      for (const rep of this.replacementsAnyToOne.get(this.candidate[candIndex]!)!) {
        let i = 0;
        while (i < rep.length && (wordIndex + i) < this.wordLen && rep[i] == this.wordProcessed[wordIndex + i]) {
          i++;
        }
        if (i == rep.length) {
          return i;
        }
      }
    }
    return 0;
  }

  private matchAnyToTwo(wordIndex: number, candIndex: number): number {
    if (candIndex > 0 && candIndex < this.candidate.length && wordIndex > 0) {
      const twoChar = [this.candidate[candIndex - 1]!, this.candidate[candIndex]!];
      const sTwoChar = twoChar.join('');
      if (this.replacementsAnyToTwo.has(sTwoChar)) {
        for (const rep of this.replacementsAnyToTwo.get(sTwoChar)!) {
          if (rep.length == 2 && wordIndex < this.wordLen && this.candidate[candIndex - 1] == this.wordProcessed[wordIndex - 1]
              && this.candidate[candIndex] == this.wordProcessed[wordIndex]) {
            return 0; //unnecessary replacements
          }
          let i = 0;
          while (i < rep.length && (wordIndex - 1 + i) < this.wordLen && rep[i] == this.wordProcessed[wordIndex - 1 + i]) {
            i++;
          }
          if (i == rep.length) {
            return i;
          }
        }
      }
    }
    return 0;
  }

  private static min(a: number, b: number, c: number): number {
    return Math.min(a, Math.min(b, c));
  }

  /**
   * Copy-paste of Character.isAlphabetic() (needed as we require only 1.6)
   *
   * @param codePoint
   *          The input character.
   * @return True if the character is a Unicode alphabetic character.
   */
  static isAlphabetic(codePoint: string): boolean {
    return ALPHABETIC.test(codePoint);
  }

  /**
   * Checks whether a string contains a digit. Used for ignoring words with
   * numbers
   *
   * @param s
   *          Word to be checked.
   * @return True if there is a digit inside the word.
   */
  static containsNoDigit(s: string): boolean {
    for (let k = 0; k < s.length; k++) {
      if (Character.isDigit(s.charAt(k))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns true if <code>str</code> is made up of all-uppercase characters
   * (ignoring characters for which no upper-/lowercase distinction exists).
   */
  isAllUppercase(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      const c = str.charAt(i);
      if (Character.isLetter(c) && Character.isLowerCase(c)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Returns true if <code>str</code> is made up of all-lowercase characters
   * (ignoring characters for which no upper-/lowercase distinction exists).
   */
  isNotAllLowercase(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      const c = str.charAt(i);
      if (Character.isLetter(c) && !Character.isLowerCase(c)) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param str
   *          input string
   */
  isNotCapitalizedWord(str: string): boolean {
    if (Speller.isNotEmpty(str) && Character.isUpperCase(str.charAt(0))) {
      for (let i = 1; i < str.length; i++) {
        const c = str.charAt(i);
        if (Character.isLetter(c) && !Character.isLowerCase(c)) {
          return true;
        }
      }
      return false;
    }
    return true;
  }

  /**
   * Helper method to replace calls to "".equals().
   *
   * @param str
   *          String to check
   * @return true if string is empty OR null
   */
  static isNotEmpty(str: string | null): boolean {
    return str != null && str.length != 0;
  }

  /**
   * @param str
   *          input str
   * @return Returns true if str is MixedCase.
   */
  isMixedCase(str: string): boolean {
    return !this.isAllUppercase(str) && this.isNotCapitalizedWord(str) && this.isNotAllLowercase(str);
  }

  /**
   * @param str The string to check.
   * @return Returns true if str is CamelCase. Note that German compounds with a dash
   *         (like "Waschmaschinen-Test") are also considered camel case by this method.
   */
  isCamelCase(str: string): boolean {
    return Speller.isNotEmpty(str) &&
           !this.isAllUppercase(str) &&
           this.isNotCapitalizedWord(str) &&
           Character.isUpperCase(str.charAt(0)) &&
           (!(str.length > 1) || Character.isLowerCase(str.charAt(1)))
           && this.isNotAllLowercase(str);
  }

  /**
   * Used to determine whether the dictionary supports case conversions.
   *
   * @return boolean value that answers this question in a deep and meaningful
   *         way.
   * @since 1.9
   */
  convertsCase(): boolean {
    return this.dictionaryMetadata.isConvertingCase();
  }

  /**
   * @param str
   *          The string to find the replacements for.
   * @param fromIndex
   *          The index from which replacements are found.
   * @param level
   *          The recursion level. The search stops if level is &gt; MAX_RECURSION_LEVEL.
   * @return A list of all possible replacements of a {#link str} given string
   */
  getAllReplacements(str: string, fromIndex: number, level: number): string[] {
    const replaced: string[] = [];
    if (level > Speller.MAX_RECURSION_LEVEL) { // Stop searching at some point
      replaced.push(str);
      return replaced;
    }
    let sb = '';
    sb += str;
    let index = Speller.MAX_WORD_LENGTH;
    let key = "";
    let keyLength = 0;
    let found = false;
    // find first possible replacement after fromIndex position
    for (const auxKey of this.replacementsTheRest.keys()) {
      const auxIndex = sb.indexOf(auxKey, fromIndex);
      if (auxIndex > -1 && (auxIndex < index || (auxIndex == index && !(auxKey.length < keyLength)))) { //select the longest possible key
        index = auxIndex;
        key = auxKey;
        keyLength = auxKey.length;
      }
    }
    if (index < Speller.MAX_WORD_LENGTH) {
      for (const rep of this.replacementsTheRest.get(key)!) {
        // start a branch without replacement (only once per key)
        if (!found) {
          replaced.push(...this.getAllReplacements(str, index + key.length, level + 1));
          found = true;
        }
        // avoid unnecessary replacements (ex. don't replace L by L·L when L·L already present)
        const ind = sb.indexOf(rep, fromIndex - rep.length + 1);
        if (rep.length > key.length && ind > -1 && (ind == index || ind == index - rep.length + 1)) {
          continue;
        }
        // start a branch with replacement
        sb = sb.substring(0, index) + rep + sb.substring(index + key.length);
        replaced.push(...this.getAllReplacements(sb, index + rep.length, level + 1));
        sb = '';
        sb += str;
      }
    }
    if (!found) {
      replaced.push(sb);
    }
    return replaced;
  }

  /**
   * Sets up the word and candidate. Used only to test the edit distance in
   * JUnit tests.
   *
   * @param word
   *          the first word
   * @param candidate
   *          the second word used for edit distance calculation
   */
  setWordAndCandidate(word: string, candidate: string): void {
    this.wordProcessed = word.split('');
    this.wordLen = this.wordProcessed.length;
    this.candidate = candidate.split('');
    this.candLen = this.candidate.length;
    this.effectEditDistance = this.wordLen <= this.editDistance ? this.wordLen - 1 : this.editDistance;
  }

  getWordLen(): number {
    return this.wordLen;
  }

  getCandLen(): number {
    return this.candLen;
  }

  getEffectiveED(): number {
    return this.effectEditDistance;
  }
}

/**
 * Used to sort candidates according to edit distance, and possibly according
 * to their frequency in the future.
 */
export class CandidateData {
  readonly word: string;
  /** Private in Java (read by the enclosing Speller). */
  readonly origDistance: number;
  private readonly distance: number;

  constructor(outer: Speller, word: string, distance: number) {
    this.word = word;
    this.origDistance = distance;
    this.distance = distance * Speller.FREQ_RANGES + Speller.FREQ_RANGES - outer.getFrequency(word) - 1;
  }

  getWord(): string {
    return this.word;
  }

  getDistance(): number {
    return this.distance;
  }

  compareTo(cd: CandidateData): number {
    // Assume no overflow.
    return this.distance < cd.getDistance() ? -1 : this.distance == cd.getDistance() ? 0 : 1;
  }

  toString(): string {
    return this.word + '/' + this.distance;
  }
}
