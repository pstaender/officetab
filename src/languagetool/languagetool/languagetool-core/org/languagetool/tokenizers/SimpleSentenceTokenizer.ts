// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tokenizers/SimpleSentenceTokenizer.java faithful
// The nested AnyLanguage extends Language, which imports this file (Language's default sentence
// tokenizer): the class is created on first use, not when the module is loaded.
import { Language } from '../Language.ts';
import type { Contributor } from '../language/Contributor.ts';
import type { Rule } from '../rules/Rule.ts';
import { SRXSentenceTokenizer } from './SRXSentenceTokenizer.ts';

let anyLanguageClass: (new () => Language) | null = null;

/** SimpleSentenceTokenizer.AnyLanguage */
function AnyLanguage(): new () => Language {
  return anyLanguageClass ??= class AnyLanguage extends Language {
    constructor() {
      super();
    }

    override getShortCode(): string {
      return 'xx';
    }

    override getName(): string {
      return 'FakeLanguage';
    }

    override getCountries(): string[] {
      return [];
    }

    override getMaintainers(): Contributor[] {
      return [];
    }

    override getRelevantRules(): Rule[] {
      return [];
    }
  };
}

/**
 * A very simple sentence tokenizer that splits on {@code [.!?…]} followed by whitespace
 * or an uppercase letter. You probably want to use an adapted {@link SRXSentenceTokenizer} instead.
 * @since 2.6
 */
export class SimpleSentenceTokenizer extends SRXSentenceTokenizer {

  constructor() {
    super(new (AnyLanguage())(), '/org/languagetool/tokenizers/segment-simple.srx');
  }

}
