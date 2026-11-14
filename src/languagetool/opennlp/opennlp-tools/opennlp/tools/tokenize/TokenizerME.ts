// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/tokenize/TokenizerME.java partial
// Left out: train, the deprecated constructor taking a lang.Factory and the deprecated static
// alphaNumeric pattern.
import type { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import type { MaxentModel } from '../ml/model/MaxentModel.ts';
import { Span } from '../util/Span.ts';
import { AbstractTokenizer } from './AbstractTokenizer.ts';
import type { TokenContextGenerator } from './TokenContextGenerator.ts';
import type { TokenizerModel } from './TokenizerModel.ts';
import { WhitespaceTokenizer } from './WhitespaceTokenizer.ts';

/**
 * A Tokenizer for converting raw text into separated tokens.  It uses
 * Maximum Entropy to make its decisions.  The features are loosely
 * based off of Jeff Reynar's UPenn thesis "Topic Segmentation:
 * Algorithms and Applications.", which is available from his
 * homepage: http://www.cis.upenn.edu/~jcreynar.
 *
 * This tokenizer needs a statistical model to tokenize a text which reproduces
 * the tokenization observed in the training data used to create the model.
 * The TokenizerModel class encapsulates the model and provides
 * methods to create it from the binary representation.
 *
 * A tokenizer instance is not thread safe. For each thread one tokenizer
 * must be instantiated which can share one TokenizerModel instance
 * to safe memory.
 *
 * @see Tokenizer
 * @see TokenizerModel
 * @see TokenSample
 */
export class TokenizerME extends AbstractTokenizer {
  /**
   * Constant indicates a token split.
   */
  static readonly SPLIT = 'T';

  /**
   * Constant indicates no token split.
   */
  static readonly NO_SPLIT = 'F';

  private readonly alphanumeric: Pattern;

  /**
   * The maximum entropy model to use to evaluate contexts.
   */
  private model: MaxentModel;

  /**
   * The context generator.
   */
  private readonly cg: TokenContextGenerator;

  /**
   * Optimization flag to skip alpha numeric tokens for further
   * tokenization
   */
  private _useAlphaNumericOptimization: boolean;

  /**
   * List of probabilities for each token returned from a call to
   * tokenize or tokenizePos.
   */
  private tokProbs: number[];

  private newTokens: Span[];

  constructor(model: TokenizerModel) {
    super();
    const factory = model.getFactory();
    this.alphanumeric = factory.getAlphaNumericPattern();
    this.cg = factory.getContextGenerator();
    this.model = model.getMaxentModel();
    this._useAlphaNumericOptimization = factory.isUseAlphaNumericOptmization();

    this.newTokens = [];
    this.tokProbs = [];
  }

  /**
   * Returns the probabilities associated with the most recent
   * calls to tokenize(String) or tokenizePos(String).
   *
   * @return probability for each token returned for the most recent
   *     call to tokenize.  If not applicable an empty array is returned.
   */
  getTokenProbabilities(): number[] {
    return this.tokProbs.slice();
  }

  /**
   * Tokenizes the string.
   *
   * @param d  The string to be tokenized.
   *
   * @return   A span array containing individual tokens as elements.
   */
  tokenizePos(d: string): Span[] {
    const tokens = WhitespaceTokenizer.INSTANCE.tokenizePos(d);
    this.newTokens.length = 0;
    this.tokProbs.length = 0;
    for (const s of tokens) {
      const tok = d.substring(s.getStart(), s.getEnd());
      // Can't tokenize single characters
      if (tok.length < 2) {
        this.newTokens.push(s);
        this.tokProbs.push(1);
      } else if (this.useAlphaNumericOptimization() && this.alphanumeric.matcher(tok).matches()) {
        this.newTokens.push(s);
        this.tokProbs.push(1);
      } else {
        let start = s.getStart();
        const end = s.getEnd();
        const origStart = s.getStart();
        let tokenProb = 1.0;
        for (let j = origStart + 1; j < end; j++) {
          const probs =
              this.model.eval(this.cg.getContext(tok, j - origStart));
          const best = this.model.getBestOutcome(probs);
          tokenProb *= probs[this.model.getIndex(best)];
          if (best === TokenizerME.SPLIT) {
            this.newTokens.push(new Span(start, j));
            this.tokProbs.push(tokenProb);
            start = j;
            tokenProb = 1.0;
          }
        }
        this.newTokens.push(new Span(start, end));
        this.tokProbs.push(tokenProb);
      }
    }

    return this.newTokens.slice();
  }

  /**
   * Returns the value of the alpha-numeric optimization flag.
   *
   * @return true if the tokenizer should use alpha-numeric optimization, false otherwise.
   */
  useAlphaNumericOptimization(): boolean {
    return this._useAlphaNumericOptimization;
  }
}
