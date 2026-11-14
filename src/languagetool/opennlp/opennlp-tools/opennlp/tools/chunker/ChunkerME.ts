// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/chunker/ChunkerME.java partial
// Left out: train, the deprecated private constructor taking a sequence validator and context
// generator, and chunkAsSpans (ChunkSample is not ported).
import { BeamSearch } from '../ml/BeamSearch.ts';
import type { MaxentModel } from '../ml/model/MaxentModel.ts';
import type { SequenceClassificationModel } from '../ml/model/SequenceClassificationModel.ts';
import type { Sequence } from '../util/Sequence.ts';
import type { SequenceValidator } from '../util/SequenceValidator.ts';
import type { Span } from '../util/Span.ts';
import { TokenTag } from '../util/TokenTag.ts';
import type { Chunker } from './Chunker.ts';
import type { ChunkerContextGenerator } from './ChunkerContextGenerator.ts';
import type { ChunkerModel } from './ChunkerModel.ts';

/**
 * The class represents a maximum-entropy-based chunker.  Such a chunker can be used to
 * find flat structures based on sequence inputs such as noun phrases or named entities.
 */
export class ChunkerME implements Chunker {
  static readonly DEFAULT_BEAM_SIZE = 10;

  private bestSequence: Sequence | null = null;

  /**
   * The model used to assign chunk tags to a sequence of tokens.
   */
  protected model: SequenceClassificationModel<TokenTag>;

  private contextGenerator: ChunkerContextGenerator;
  private sequenceValidator: SequenceValidator<TokenTag>;

  /**
   * Initializes the current instance with the specified model and
   * the specified beam size (default DEFAULT_BEAM_SIZE).
   */
  constructor(model: ChunkerModel, beamSize = ChunkerME.DEFAULT_BEAM_SIZE) {
    this.contextGenerator = model.getFactory().getContextGenerator();
    this.sequenceValidator = model.getFactory().getSequenceValidator();

    if (model.getChunkerSequenceModel() != null) {
      this.model = model.getChunkerSequenceModel() as SequenceClassificationModel<TokenTag>;
    }
    else {
      this.model = new BeamSearch<TokenTag>(beamSize,
          model.getChunkerModel() as MaxentModel, 0);
    }
  }

  chunk(toks: string[], tags: string[]): string[] {
    const tuples = TokenTag.create(toks, tags);
    this.bestSequence = this.model.bestSequence(tuples, [], this.contextGenerator, this.sequenceValidator);
    const c = (this.bestSequence as Sequence).getOutcomes();
    return c.slice();
  }

  chunkAsSpans(_toks: string[], _tags: string[]): Span[] {
    // ChunkSample.phrasesAsSpanList(toks, tags, chunk(toks, tags))
    throw new Error('ChunkSample is not ported');
  }

  topKSequences(sentence: string[], tags: string[], minSequenceScore?: number): Sequence[] {
    const tuples = TokenTag.create(sentence, tags);

    if (minSequenceScore === undefined) {
      return this.model.bestSequences(ChunkerME.DEFAULT_BEAM_SIZE, tuples,
          [], this.contextGenerator, this.sequenceValidator);
    }
    return this.model.bestSequences(ChunkerME.DEFAULT_BEAM_SIZE, tuples, [], minSequenceScore,
        this.contextGenerator, this.sequenceValidator);
  }

  /**
   * Populates the specified array with the probabilities of the last decoded sequence
   * (probs(double[])), or returns them (probs()).
   */
  probs(probs?: number[] | Float64Array): number[] | void {
    if (probs !== undefined) {
      (this.bestSequence as Sequence).getProbs(probs);
      return;
    }
    return (this.bestSequence as Sequence).getProbs();
  }
}
