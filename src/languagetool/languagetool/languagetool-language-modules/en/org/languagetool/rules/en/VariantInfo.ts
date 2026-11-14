// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/VariantInfo.java faithful
import { Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';

/**
 * @since 4.5
 */
export class VariantInfo {

  private readonly variantName: string;
  private readonly _otherVariant: string;

  constructor(variantName: string, otherVariant: string) {
    this.variantName = Objects_requireNonNull(variantName);
    this._otherVariant = Objects_requireNonNull(otherVariant);
  }

  getVariantName(): string {
    return this.variantName;
  }

  otherVariant(): string {
    return this._otherVariant;
  }
}
