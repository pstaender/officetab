// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/POSTaggerME.java partial
// Left out: train, buildNGramDictionary, populatePOSDictionary. The overloads tag(sentence),
// tag(sentence, additionaContext) and tag(numTaggings, sentence) are one tag method.
import { BeamSearch } from '../ml/BeamSearch.ts';
import type { MaxentModel } from '../ml/model/MaxentModel.ts';
import type { SequenceClassificationModel } from '../ml/model/SequenceClassificationModel.ts';
import type { Dictionary } from '../dictionary/Dictionary.ts';
import type { Sequence } from '../util/Sequence.ts';
import type { SequenceValidator } from '../util/SequenceValidator.ts';
import type { POSContextGenerator } from './POSContextGenerator.ts';
import type { POSModel } from './POSModel.ts';
import type { POSTagger } from './POSTagger.ts';
import type { TagDictionary } from './TagDictionary.ts';

/**
 * A part-of-speech tagger that uses maximum entropy.  Tries to predict whether
 * words are nouns, verbs, or any of 70 other POS tags depending on their
 * surrounding context.
 */
export class POSTaggerME implements POSTagger {
  static readonly DEFAULT_BEAM_SIZE = 3;

  private modelPackage: POSModel;

  /**
   * The feature context generator.
   */
  protected contextGen: POSContextGenerator;

  /**
   * Tag dictionary used for restricting words to a fixed set of tags.
   */
  protected tagDictionary: TagDictionary | null;

  protected ngramDictionary: Dictionary | null = null;

  /**
   * Says whether a filter should be used to check whether a tag assignment
   * is to a word outside of a closed class.
   */
  protected useClosedClassTagsFilter = false;

  /**
   * The size of the beam to be used in determining the best sequence of pos tags.
   */
  protected size: number;

  private bestSequence: Sequence | null = null;

  private model: SequenceClassificationModel<string>;

  private sequenceValidator: SequenceValidator<string>;

  /**
   * Initializes the current instance with the provided model.
   */
  constructor(model: POSModel) {
    const factory = model.getFactory();

    let beamSize = POSTaggerME.DEFAULT_BEAM_SIZE;

    const beamSizeString = model.getManifestProperty(BeamSearch.BEAM_SIZE_PARAMETER);

    if (beamSizeString != null) {
      beamSize = parseInt(beamSizeString, 10);
    }

    this.modelPackage = model;

    this.contextGen = factory.getPOSContextGenerator(beamSize);
    this.tagDictionary = factory.getTagDictionary();
    this.size = beamSize;

    this.sequenceValidator = factory.getSequenceValidator();

    if (model.getPosSequenceModel() != null) {
      this.model = model.getPosSequenceModel() as SequenceClassificationModel<string>;
    }
    else {
      this.model = new BeamSearch<string>(beamSize,
          model.getPosModel() as MaxentModel, 0);
    }
  }

  /**
   * Retrieves an array of all possible part-of-speech tags from the
   * tagger.
   */
  getAllPosTags(): string[] {
    return this.model.getOutcomes();
  }

  /**
   * tag(String[] sentence), tag(String[] sentence, Object[] additionaContext): the tags of the
   * best sequence; tag(int numTaggings, String[] sentence): the tags of the numTaggings best.
   */
  tag(sentence: string[], additionaContext?: unknown[] | null): string[];
  tag(numTaggings: number, sentence: string[]): string[][];
  tag(sentenceOrNum: string[] | number, additionaContextOrSentence?: unknown[] | null): string[] | string[][] {
    if (typeof sentenceOrNum === 'number') {
      const bestSequences = this.model.bestSequences(sentenceOrNum, additionaContextOrSentence as string[], null,
          this.contextGen, this.sequenceValidator);
      const tags = new Array<string[]>(bestSequences.length);
      for (let si = 0; si < tags.length; si++) {
        const t = bestSequences[si].getOutcomes();
        tags[si] = t.slice();
      }
      return tags;
    }
    this.bestSequence = this.model.bestSequence(sentenceOrNum, additionaContextOrSentence ?? null, this.contextGen, this.sequenceValidator);
    const t = (this.bestSequence as Sequence).getOutcomes();
    return t.slice();
  }

  topKSequences(sentence: string[], additionaContext: unknown[] | null = null): Sequence[] {
    return this.model.bestSequences(this.size, sentence, additionaContext, this.contextGen, this.sequenceValidator);
  }

  /**
   * Populates the specified array with the probabilities for each tag of the last tagged sentence
   * (probs(double[])), or returns them (probs()).
   */
  probs(probs?: number[] | Float64Array): number[] | void {
    if (probs !== undefined) {
      (this.bestSequence as Sequence).getProbs(probs);
      return;
    }
    return (this.bestSequence as Sequence).getProbs();
  }

  getOrderedTags(words: string[], tags: string[], index: number, tprobs: number[] | Float64Array | null = null): string[] {
    if (this.modelPackage.getPosModel() != null) {
      const posModel = this.modelPackage.getPosModel() as MaxentModel;

      const probs = posModel.eval(this.contextGen.getContext(index,
          words.slice(),
          tags.slice(), null));

      const orderedTags = new Array<string>(probs.length);
      for (let i = 0; i < probs.length; i++) {
        let max = 0;
        for (let ti = 1; ti < probs.length; ti++) {
          if (probs[ti] > probs[max]) {
            max = ti;
          }
        }
        orderedTags[i] = posModel.getOutcome(max);
        if (tprobs != null) {
          tprobs[i] = probs[max];
        }
        probs[max] = 0;
      }
      return orderedTags;
    }
    else {
      throw new Error('This method can only be called if the '
          + 'classifcation model is an event model!');
    }
  }
}
