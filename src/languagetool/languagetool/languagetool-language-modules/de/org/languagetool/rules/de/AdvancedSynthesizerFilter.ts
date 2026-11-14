// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/AdvancedSynthesizerFilter.java faithful
import { AbstractAdvancedSynthesizerFilter } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractAdvancedSynthesizerFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';

/*
 * Synthesize suggestions using the lemma from one token (lemma_from) 
 * and the POS tag from another one (postag_from).
 * 
 * The lemma_select and postag_select attributes are required 
 * to choose one among several possible readings.
 */
export class AdvancedSynthesizerFilter extends AbstractAdvancedSynthesizerFilter {
}

FilterRegistry.register('org.languagetool.rules.de.AdvancedSynthesizerFilter', () => new AdvancedSynthesizerFilter());
