// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/TokenTag.java partial
// Left out: equals and hashCode.

export class TokenTag {
  private readonly token: string;
  private readonly tag: string;
  private readonly addtionalData: string[] | null;

  constructor(token: string, tag: string, addtionalData: string[] | null) {
    this.token = token;
    this.tag = tag;
    if (addtionalData != null) {
      this.addtionalData = addtionalData.slice();
    } else {
      this.addtionalData = null;
    }
  }

  getToken(): string {
    return this.token;
  }

  getTag(): string {
    return this.tag;
  }

  getAddtionalData(): string[] | null {
    return this.addtionalData;
  }

  static extractTokens(tuples: TokenTag[]): string[] {
    const tokens = new Array<string>(tuples.length);
    for (let i = 0; i < tuples.length; i++) {
      tokens[i] = tuples[i].getToken();
    }

    return tokens;
  }

  static extractTags(tuples: TokenTag[]): string[] {
    const tags = new Array<string>(tuples.length);
    for (let i = 0; i < tuples.length; i++) {
      tags[i] = tuples[i].getTag();
    }

    return tags;
  }

  static create(toks: string[], tags: string[]): TokenTag[] {
    const tuples = new Array<TokenTag>(toks.length);
    for (let i = 0; i < toks.length; i++) {
      tuples[i] = new TokenTag(toks[i], tags[i], null);
    }
    return tuples;
  }

  toString(): string {
    return this.token + '_' + this.tag;
  }
}
