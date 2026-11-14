// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/chunking/EnglishChunker.java faithful
// The OpenNLP models are read from their zip packages, which is asynchronous here: await
// EnglishChunker.init() (after the models /en-token.bin, /en-pos-maxent.bin and /en-chunker.bin
// have been preloaded into the data broker) before constructing an EnglishChunker; the
// constructor throws, as Java's does when the models cannot be read, if they are not loaded.
import type { AnalyzedTokenReadings } from '../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Chunker } from '../../../../../languagetool-core/org/languagetool/chunking/Chunker.ts';
import { ChunkTag } from '../../../../../languagetool-core/org/languagetool/chunking/ChunkTag.ts';
import { ChunkTaggedToken } from '../../../../../languagetool-core/org/languagetool/chunking/ChunkTaggedToken.ts';
import { Tools } from '../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Character, StringTrim } from '../../../../../../jdk/java/lang/Character.ts';
import { StringSplit } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { ChunkerME } from '../../../../../../opennlp/opennlp-tools/opennlp/tools/chunker/ChunkerME.ts';
import { ChunkerModel } from '../../../../../../opennlp/opennlp-tools/opennlp/tools/chunker/ChunkerModel.ts';
import { POSModel } from '../../../../../../opennlp/opennlp-tools/opennlp/tools/postag/POSModel.ts';
import { POSTaggerME } from '../../../../../../opennlp/opennlp-tools/opennlp/tools/postag/POSTaggerME.ts';
import { TokenizerME } from '../../../../../../opennlp/opennlp-tools/opennlp/tools/tokenize/TokenizerME.ts';
import { TokenizerModel } from '../../../../../../opennlp/opennlp-tools/opennlp/tools/tokenize/TokenizerModel.ts';
import { readZip } from '../../../../../../../lo/package/source/zipapi/zip.ts';
import { EnglishChunkFilter } from './EnglishChunkFilter.ts';

const TOKENIZER_MODEL = '/en-token.bin';
const POS_TAGGER_MODEL = '/en-pos-maxent.bin';
const CHUNKER_MODEL = '/en-chunker.bin';

/**
 * This needs to be static to save memory: as Language.LANGUAGES is static, any language
 * that is once created there will never be released. As English has several variants,
 * we'd have as many posModels etc. as we have variants -> huge waste of memory:
 */
let tokenModel: TokenizerModel | null = null;
let posModel: POSModel | null = null;
let chunkerModel: ChunkerModel | null = null;
let loading: Promise<void> | null = null;

/**
 * OpenNLP-based chunker. Also adds some LT-specific chunks like NP-plural.
 * @since 2.3
 */
export class EnglishChunker implements Chunker {

  private readonly chunkFilter: EnglishChunkFilter;

  /**
   * Reads the OpenNLP models (not in Java, where the constructor reads them): the resources
   * must have been preloaded into JLanguageTool.getDataBroker(). Safe to call more than once.
   */
  static init(): Promise<void> {
    return (loading ??= (async () => {
      try {
        if (tokenModel == null) {
          tokenModel = new TokenizerModel(await readZip(Tools.getStream(TOKENIZER_MODEL)));
        }
        if (posModel == null) {
          posModel = new POSModel(await readZip(Tools.getStream(POS_TAGGER_MODEL)));
        }
        if (chunkerModel == null) {
          chunkerModel = new ChunkerModel(await readZip(Tools.getStream(CHUNKER_MODEL)));
        }
      } catch (e) {
        loading = null;
        throw new Error('RuntimeException: Could not initialize English chunker', { cause: e });
      }
    })());
  }

  /** Whether {@link init} has read the models (not in Java). */
  static isInitialized(): boolean {
    return tokenModel != null && posModel != null && chunkerModel != null;
  }

  constructor() {
    if (!EnglishChunker.isInitialized()) {
      throw new Error('RuntimeException: Could not initialize English chunker: await EnglishChunker.init() first');
    }
    this.chunkFilter = new EnglishChunkFilter();
  }

  addChunkTags(tokenReadings: AnalyzedTokenReadings[]): void {
    const origChunkTags = this.getChunkTagsForReadings(tokenReadings);
    const chunkTags = this.chunkFilter.filter(origChunkTags);
    this.assignChunksToReadings(chunkTags);
  }

  private getChunkTagsForReadings(tokenReadings: AnalyzedTokenReadings[]): ChunkTaggedToken[] {
    // these are not thread-safe, so create them here, not as members:
    const sentence = this.getSentence(tokenReadings);
    const tokens = this.cleanZeroWidthWhitespaces(this.tokenize(sentence));
    const posTags = this.posTag(tokens);
    const chunkTags = this.chunk(tokens, posTags);
    if (tokens.length != posTags.length || tokens.length != chunkTags.length) {
      throw new Error('RuntimeException: Length of results must be the same: ' + tokens.length + ', ' + posTags.length + ', ' + chunkTags.length);
    }
    return this.getTokensWithTokenReadings(tokenReadings, tokens, chunkTags);
  }

  // workaround for the add-on, which adds ﻿ZERO WIDTH NO-BREAK SPACE, which confuses the chunker:
  private cleanZeroWidthWhitespaces(tokens: string[]): string[] {
    const cleanTokens: string[] = [];
    for (const token of tokens) {
      const splits = StringSplit(token, '﻿');
      for (const split of splits) {
        if (split.length == 0) {
          cleanTokens.push('');
        } else {
          cleanTokens.push(token);
        }
      }
    }
    return cleanTokens;
  }

  // non-private for test cases
  tokenize(sentence: string): string[] {
    const tokenizer = new TokenizerME(tokenModel!);
    const cleanString = sentence.replaceAll('’', '\'');  // this is the type of apostrophe that OpenNLP expects
    return tokenizer.tokenize(cleanString);
  }

  private posTag(tokens: string[]): string[] {
    const posTagger = new POSTaggerME(posModel!);
    return posTagger.tag(tokens);
  }

  private chunk(tokens: string[], posTags: string[]): string[] {
    const chunker = new ChunkerME(chunkerModel!);
    return chunker.chunk(tokens, posTags);
  }

  private getTokensWithTokenReadings(tokenReadings: AnalyzedTokenReadings[], tokens: string[], chunkTags: string[]): ChunkTaggedToken[] {
    const result: ChunkTaggedToken[] = [];
    let i = 0;
    let pos = 0;
    for (const chunkTag of chunkTags) {
      const startPos = pos;
      const endPos = startPos + tokens[i]!.length;
      //System.out.println("OPEN: " + tokens[i]);
      const readings = this.getAnalyzedTokenReadingsFor(startPos, endPos, tokenReadings);
      result.push(new ChunkTaggedToken(tokens[i]!, [new ChunkTag(chunkTag)], readings));
      pos = endPos;
      i++;
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

  private getSentence(sentenceTokens: AnalyzedTokenReadings[]): string {
    let sb = '';
    for (const token of sentenceTokens) {
      sb += token.getToken();
    }
    return sb;
  }

  // Get only exact position matches - i.e. this can only be used for a trivial mapping
  // where tokens that are not exactly at the same position will be skipped. For example,
  // the tokens of "I'll" ([I] ['ll] vs [I]['][ll) cannot be mapped with this.
  private getAnalyzedTokenReadingsFor(startPos: number, endPos: number, tokenReadings: AnalyzedTokenReadings[]): AnalyzedTokenReadings | null {
    let pos = 0;
    for (const tokenReading of tokenReadings) {
      const token = tokenReading.getToken();
      if (StringTrim(token).length === 0 ||
          (token.length == 1 && Character.isSpaceChar(token.charAt(0)))) {  // needed for non-breaking space
        continue;  // the OpenNLP result has no whitespace, so we need to skip it
      }
      const tokenStart = pos;
      const tokenEnd = pos + token.length;
      if (tokenStart == startPos && tokenEnd == endPos) {
        //System.out.println("!!!" + startPos + " " + endPos + "  " + tokenReading);
        return tokenReading;
      }
      pos = tokenEnd;
    }
    return null;
  }

}
