// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/tokenize/TokenizerModel.java partial
// Only the InputStream constructor (here: the model package's entries) and the accessors.
import { AbstractModel } from '../ml/model/AbstractModel.ts';
import type { MaxentModel } from '../ml/model/MaxentModel.ts';
import type { Dictionary } from '../dictionary/Dictionary.ts';
import type { BaseToolFactory } from '../util/BaseToolFactory.ts';
import { InvalidFormatException } from '../util/InvalidFormatException.ts';
import { BaseModel, type ModelPackage } from '../util/model/BaseModel.ts';
import { ModelUtil } from '../util/model/ModelUtil.ts';
import { TokenizerFactory } from './TokenizerFactory.ts';
import { TokenizerME } from './TokenizerME.ts';

/**
 * The TokenizerModel is the model used
 * by a learnable Tokenizer.
 *
 * @see TokenizerME
 */
export class TokenizerModel extends BaseModel {
  private static readonly COMPONENT_NAME = 'TokenizerME';

  private static readonly TOKENIZER_MODEL_ENTRY = 'token.model';

  /**
   * Initializes the current instance.
   *
   * @param input the model package to load the model from (readZip of the .bin file)
   */
  constructor(input: ModelPackage) {
    super(TokenizerModel.COMPONENT_NAME, input);
  }

  /**
   * Checks if the tokenizer model has the right outcomes.
   */
  private static isModelCompatible(model: MaxentModel): boolean {
    return ModelUtil.validateOutcomes(model, TokenizerME.SPLIT, TokenizerME.NO_SPLIT);
  }

  protected override validateArtifactMap(): void {
    super.validateArtifactMap();

    if (!(this.artifactMap.get(TokenizerModel.TOKENIZER_MODEL_ENTRY) instanceof AbstractModel)) {
      throw new InvalidFormatException('Token model is incomplete!');
    }

    if (!TokenizerModel.isModelCompatible(this.getMaxentModel())) {
      throw new InvalidFormatException('The maxent model is not compatible with the tokenizer!');
    }
  }

  getFactory(): TokenizerFactory {
    return this.toolFactory as TokenizerFactory;
  }

  protected override getDefaultFactory(): new () => BaseToolFactory {
    return TokenizerFactory;
  }

  getMaxentModel(): MaxentModel {
    return this.artifactMap.get(TokenizerModel.TOKENIZER_MODEL_ENTRY) as MaxentModel;
  }

  getAbbreviations(): Dictionary | null {
    if (this.getFactory() != null) {
      return this.getFactory().getAbbreviationDictionary();
    }
    return null;
  }

  useAlphaNumericOptimization(): boolean {
    return this.getFactory() != null && this.getFactory().isUseAlphaNumericOptmization();
  }
}
