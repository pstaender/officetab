// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/markup/MappingValue.java faithful

/**
 * A fake markup data object giving information on the impact of the fake markup.
 * Use {@link AnnotatedTextBuilder} to create objects of this type.
 * @since 4.8
 */
export class MappingValue {

  private readonly totalPosition: number;
  private readonly fakeMarkupLength: number;

  constructor(totalPosition: number, fakeMarkupLength = 0) {
    this.totalPosition = totalPosition;
    this.fakeMarkupLength = fakeMarkupLength;
  }

  getTotalPosition(): number {
    return this.totalPosition;
  }

  getFakeMarkupLength(): number {
    return this.fakeMarkupLength;
  }

  toString(): string {
    return 'totalPos:' + this.totalPosition + ',fakeMarkupLen=' + this.fakeMarkupLength;
  }
}
