// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/ExampleSentence.java faithful
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';

/**
 * @since 3.5
 */
export abstract class ExampleSentence {

  protected readonly example: string;

  constructor(example: string) {
    this.example = Objects_requireNonNull(example);
    const markerStart = example.indexOf('<marker>');
    const markerEnd = example.indexOf('</marker>');
    if (markerStart !== -1 && markerEnd === -1) {
      throw new Error('IllegalArgumentException: Example contains <marker> but lacks </marker>:' + example);
    }
    if (markerStart === -1 && markerEnd !== -1) {
      throw new Error('IllegalArgumentException: Example contains </marker> but lacks <marker>:' + example);
    }
    if (markerStart > markerEnd) {
      throw new Error('IllegalArgumentException: Example <marker> comes before </marker>:' + example);
    }
  }

  static cleanMarkersInExample(str: string): string {
    return str.replaceAll('<marker>', '').replaceAll('</marker>', '');
  }

  /**
   * Return the example, typically one sentence.
   */
  getExample(): string {
    return this.example;
  }

  toString(): string {
    return this.example;
  }

}
