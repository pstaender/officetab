// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/POSContextGenerator.java faithful
import type { BeamSearchContextGenerator } from '../util/BeamSearchContextGenerator.ts';

/**
 * The interface for a context generator for the POS Tagger.
 */
export interface POSContextGenerator extends BeamSearchContextGenerator<string> {
  getContext(pos: number, tokens: string[], prevTags: string[], ac: unknown[] | null): string[];
}
