// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/LanguageWithModel.java reduced
// There are no ngram indexes in the browser: initLanguageModel (LuceneLanguageModel on
// <indexDir>/<code>) is left out, so getLanguageModel returns null unless a subclass creates a model.
import { Language } from './Language.ts';
import type { LanguageModel } from './languagemodel/LanguageModel.ts';

export abstract class LanguageWithModel extends Language {
  private languageModel: LanguageModel | null = null;

  override getLanguageModel(indexDir: string): LanguageModel | null {
    if (this.languageModel != null) {
      return this.languageModel;
    }
    this.languageModel = this.initLanguageModel(indexDir, this.languageModel);
    return this.languageModel;
  }

  close(): void {
    if (this.languageModel != null) {
      this.languageModel.close();
      this.languageModel = null;
    }
  }

  protected initLanguageModel(_indexDir: string, languageModel: LanguageModel | null): LanguageModel | null {
    return languageModel;
  }
}
