// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/SynonymsData.java faithful

export class SynonymsData {
  synonyms: string[];
  postag: string | null;
  chunk: string | null;
  constructor(synonyms: string[], postag: string | null, chunk: string | null) {
    this.synonyms = synonyms;
    this.postag = postag;
    this.chunk = chunk;
  }

  getSynonyms(): string[] {
    return this.synonyms;
  }

  getPostag(): string | null {
    return this.postag;
  }

  getChunk(): string | null {
    return this.chunk;
  }

}
