// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/markup/TextPart.java faithful
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

export const Type = { TEXT: 'TEXT', MARKUP: 'MARKUP', FAKE_CONTENT: 'FAKE_CONTENT' } as const;
export type Type = typeof Type[keyof typeof Type];

/**
 * A part of a text with markup, either plain text (to be checked by LanguageTool),
 * or markup (to be ignored by LanguageTool).
 * @since 2.3
 */
export class TextPart {

  static readonly Type = Type;

  private readonly part: string;
  private readonly typ: Type;

  constructor(part: string, typ: Type) {
    this.part = Objects_requireNonNull(part);
    this.typ = Objects_requireNonNull(typ);
  }

  getPart(): string {
    return this.part;
  }

  getType(): Type {
    return this.typ;
  }

  toString(): string {
    return this.part;
  }
}
