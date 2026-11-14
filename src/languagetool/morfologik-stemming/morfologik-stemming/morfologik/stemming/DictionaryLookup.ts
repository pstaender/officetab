// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/DictionaryLookup.java faithful
// lookup() returns an array of the reused WordData objects instead of an ArrayViewList over them
// (ArrayViewList is not ported); as upstream, its content is valid until the next lookup.
// Iterable<WordData>: iterator() returns the Java-style DictionaryIterator, and the object is
// also JavaScript-iterable. CharSequence is a string; LinkedHashMap a Map.
import { ByteBuffer } from '../../../../jdk/java/nio/ByteBuffer.ts';
import { CharBuffer } from '../../../../jdk/java/nio/CharBuffer.ts';
import type { CharsetDecoder, CharsetEncoder } from '../../../../jdk/java/nio/charset/Charset.ts';
import { ByteSequenceIterator } from '../../../morfologik-fsa/morfologik/fsa/ByteSequenceIterator.ts';
import { javaIterator, type FSA } from '../../../morfologik-fsa/morfologik/fsa/FSA.ts';
import { FSATraversal } from '../../../morfologik-fsa/morfologik/fsa/FSATraversal.ts';
import { MatchResult } from '../../../morfologik-fsa/morfologik/fsa/MatchResult.ts';
import { BufferUtils } from './BufferUtils.ts';
import type { Dictionary } from './Dictionary.ts';
import type { DictionaryMetadata } from './DictionaryMetadata.ts';
import { DictionaryIterator } from './DictionaryIterator.ts';
import type { ISequenceEncoder } from './ISequenceEncoder.ts';
import type { IStemmer } from './IStemmer.ts';
import { UnmappableInputException } from './UnmappableInputException.ts';
import { WordData } from './WordData.ts';

const SEQUENCE_IS_A_PREFIX = MatchResult.SEQUENCE_IS_A_PREFIX;

/**
 * This class implements a dictionary lookup of an inflected word over a
 * dictionary previously compiled using the
 * <code>dict_compile</code> tool.
 */
export class DictionaryLookup implements IStemmer, Iterable<WordData> {
  /** An FSA used for lookups. */
  private readonly matcher: FSATraversal;

  /** An iterator for walking along the final states of {@link #fsa}. */
  private readonly finalStatesIterator: ByteSequenceIterator;

  /** FSA's root node. */
  private readonly rootNode: number;

  /** Expand buffers and arrays by this constant. */
  private static readonly EXPAND_SIZE = 10;

  /** Private internal array of reusable word data objects. */
  private forms: WordData[] = [];

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

  /**
   * The FSA we are using.
   */
  private readonly fsa: FSA;

  /**
   * @see #getSeparatorChar()
   */
  private readonly separatorChar: string;

  /**
   * Internal reusable buffer for encoding words into byte arrays using
   * {@link #encoder}.
   */
  private byteBuffer = ByteBuffer.allocate(0);

  /**
   * Internal reusable buffer for encoding words into byte arrays using
   * {@link #encoder}.
   */
  private charBuffer = CharBuffer.allocate(0);

  /**
   * Reusable match result.
   */
  private readonly matchResult = new MatchResult();

  /**
   * The {@link Dictionary} this lookup is using.
   */
  private readonly dictionary: Dictionary;

  private readonly sequenceEncoder: ISequenceEncoder;

  /**
   * Creates a new object of this class using the given FSA for word lookups
   * and encoding for converting characters to bytes.
   *
   * @param dictionary The dictionary to use for lookups.
   * @throws IllegalArgumentException
   *             if FSA's root node cannot be acquired (dictionary is empty).
   */
  constructor(dictionary: Dictionary) {
    this.dictionary = dictionary;
    this.dictionaryMetadata = dictionary.metadata;
    this.sequenceEncoder = dictionary.metadata.getSequenceEncoderType().get();
    this.rootNode = dictionary.fsa.getRootNode();
    this.fsa = dictionary.fsa;
    this.matcher = new FSATraversal(this.fsa);
    this.finalStatesIterator = new ByteSequenceIterator(this.fsa, this.fsa.getRootNode());

    if (this.dictionaryMetadata == null) {
      throw new Error(
          "IllegalArgumentException: Dictionary metadata must not be null.");
    }

    this.decoder = dictionary.metadata.getDecoder();
    this.encoder = dictionary.metadata.getEncoder();
    this.separatorChar = dictionary.metadata.getSeparatorAsChar();
  }

  /**
   * Searches the automaton for a symbol sequence equal to <code>word</code>,
   * followed by a separator. The result is a stem (decompressed accordingly
   * to the dictionary's specification) and an optional tag data.
   */
  lookup(word: string): WordData[] {
    const separator = this.dictionaryMetadata.getSeparator();
    const prefixBytes = this.sequenceEncoder.prefixBytes();

    if (this.dictionaryMetadata.getInputConversionPairs().size != 0) {
      word = DictionaryLookup.applyReplacements(word, this.dictionaryMetadata.getInputConversionPairs());
    }

    // Reset the output list to zero length.
    let formsCount = 0; // formsList.wrap(forms, 0, 0);

    // Encode word characters into bytes in the same encoding as the FSA's.
    this.charBuffer = BufferUtils.clearAndEnsureCapacity(this.charBuffer, word.length);
    for (let i = 0; i < word.length; i++) {
      const chr = word.charAt(i);
      if (chr == this.separatorChar) {
        // No valid input can contain the separator.
        return [];
      }
      this.charBuffer.put(chr);
    }
    this.charBuffer.flip();
    try {
      this.byteBuffer = BufferUtils.charsToBytes(this.encoder, this.charBuffer, this.byteBuffer);
    } catch (e) {
      if (!(e instanceof UnmappableInputException)) throw e;
      // This should be a rare occurrence, but if it happens it means there is no way
      // the dictionary can contain the input word.
      return [];
    }

    // Try to find a partial match in the dictionary.
    const match = this.matcher.match(this.matchResult, this.byteBuffer
        .array(), 0, this.byteBuffer.remaining(), this.rootNode);

    if (match.kind == SEQUENCE_IS_A_PREFIX) {
      /*
       * The entire sequence exists in the dictionary. A separator should
       * be the next symbol.
       */
      const arc = this.fsa.getArc(match.node, separator);

      /*
       * The situation when the arc points to a final node should NEVER
       * happen. After all, we want the word to have SOME base form.
       */
      if (arc != 0 && !this.fsa.isArcFinal(arc)) {
        // There is such a word in the dictionary. Return its base forms.
        formsCount = 0;

        this.finalStatesIterator.restartFrom(this.fsa.getEndNode(arc));
        while (this.finalStatesIterator.hasNext()) {
          const bb = this.finalStatesIterator.next();
          const ba = bb.array();
          const bbSize = bb.remaining();

          if (formsCount >= this.forms.length) {
            const newLength = this.forms.length + DictionaryLookup.EXPAND_SIZE;
            for (let k = this.forms.length; k < newLength; k++) {
              this.forms[k] = new WordData(this.decoder);
            }
          }

          /*
           * Now, expand the prefix/ suffix 'compression' and store
           * the base form.
           */
          const wordData = this.forms[formsCount++]!;
          if (this.dictionaryMetadata.getOutputConversionPairs().size == 0) {
            wordData.update(this.byteBuffer, word);
          } else {
            wordData.update(this.byteBuffer, DictionaryLookup.applyReplacements(word, this.dictionaryMetadata.getOutputConversionPairs()));
          }

          /*
           * Find the separator byte's position splitting the inflection instructions
           * from the tag.
           */
          // assert prefixBytes <= bbSize : sequenceEncoder.getClass() + " >? " + bbSize;
          let sepPos: number;
          for (sepPos = prefixBytes; sepPos < bbSize; sepPos++) {
            if (ba[sepPos] == separator) {
              break;
            }
          }

          /*
           * Decode the stem into stem buffer.
           */
          wordData.stemBuffer = this.sequenceEncoder.decode(wordData.stemBuffer,
                                                   this.byteBuffer,
                                                   ByteBuffer.wrap(ba, 0, sepPos));

          // Skip separator character.
          sepPos++;

          /*
           * Decode the tag data.
           */
          const tagSize = bbSize - sepPos;
          if (tagSize > 0) {
            wordData.tagBuffer = BufferUtils.clearAndEnsureCapacity(wordData.tagBuffer, tagSize);
            wordData.tagBuffer.put(ba, sepPos, tagSize);
            wordData.tagBuffer.flip();
          }
        }

        // formsList.wrap(forms, 0, formsCount);
      }
    } else {
      /*
       * this case is somewhat confusing: we should have hit the separator
       * first... I don't really know how to deal with it at the time
       * being.
       */
    }
    return this.forms.slice(0, formsCount);
  }

  /**
   * Apply partial string replacements from a given map.
   *
   * Useful if the word needs to be normalized somehow (i.e., ligatures,
   * apostrophes and such).
   *
   * @param word The word to apply replacements to.
   * @param replacements A map of replacements (from-&gt;to).
   * @return new string with all replacements applied.
   */
  static applyReplacements(word: string, replacements: ReadonlyMap<string, string>): string {
    // quite horrible from performance point of view; this should really be a transducer.
    let sb = word;
    for (const [key, value] of replacements) {
      let index = sb.indexOf(key);
      while (index != -1) {
        sb = sb.substring(0, index) + value + sb.substring(index + key.length);
        index = sb.indexOf(key, index + key.length);
      }
    }
    return sb;
  }

  /**
   * Return an iterator over all {@link WordData} entries available in the
   * embedded {@link Dictionary}.
   */
  iterator(): DictionaryIterator {
    return new DictionaryIterator(this.dictionary, this.decoder, true);
  }

  [Symbol.iterator](): Iterator<WordData> {
    return javaIterator(this.iterator());
  }

  /**
   * @return Return the {@link Dictionary} used by this object.
   */
  getDictionary(): Dictionary {
    return this.dictionary;
  }

  /**
   * @return Returns the logical separator character splitting inflected form,
   *         lemma correction token and a tag. Note that this character is a best-effort
   *         conversion from a byte in {@link DictionaryMetadata#separator} and
   *         may not be valid in the target encoding (although this is highly unlikely).
   */
  getSeparatorChar(): string {
    return this.separatorChar;
  }
}
