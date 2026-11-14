// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/chunker/ChunkerFactory.java partial
// Left out: create(subclassName) (used for training). The class registers itself with
// ExtensionLoader under its Java name (see there).
import { BaseToolFactory } from '../util/BaseToolFactory.ts';
import { ExtensionLoader } from '../util/ext/ExtensionLoader.ts';
import type { SequenceValidator } from '../util/SequenceValidator.ts';
import type { TokenTag } from '../util/TokenTag.ts';
import type { ChunkerContextGenerator } from './ChunkerContextGenerator.ts';
import { DefaultChunkerContextGenerator } from './DefaultChunkerContextGenerator.ts';
import { DefaultChunkerSequenceValidator } from './DefaultChunkerSequenceValidator.ts';

export class ChunkerFactory extends BaseToolFactory {
  validateArtifactMap(): void {
    // no additional artifacts
  }

  getSequenceValidator(): SequenceValidator<TokenTag> {
    return new DefaultChunkerSequenceValidator();
  }

  getContextGenerator(): ChunkerContextGenerator {
    return new DefaultChunkerContextGenerator();
  }
}

ExtensionLoader.registerExtension('opennlp.tools.chunker.ChunkerFactory', ChunkerFactory);
