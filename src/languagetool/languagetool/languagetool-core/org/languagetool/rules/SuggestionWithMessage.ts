// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/SuggestionWithMessage.java faithful
// The two constructors are one with an optional message.
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

export class SuggestionWithMessage {

  private readonly suggestion: string;
  private readonly message: string | null;

  constructor(suggestion: string, message: string | null = null) {
    this.suggestion = Objects_requireNonNull(suggestion);
    this.message = message;
  }

  getSuggestion(): string {
    return this.suggestion;
  }

  getMessage(): string | null {
    return this.message;
  }
}
