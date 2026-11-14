// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/synthesis/SynthesizerTools.java faithful
// The stream is the file's bytes or text; StringInterner.intern is left out.
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';

/**
 * Helper class to load files used by synthesizers.
 * @since 2.3
 */
export const SynthesizerTools = {

  loadWords(stream: Uint8Array | string): string[] {
    const result: string[] = [];
    const text = typeof stream === 'string' ? stream : new TextDecoder('utf-8').decode(stream);
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const nextLine of lines) {
      const line = StringTrim(nextLine);
      if (line.length === 0 || line.charAt(0) == '#') {  // ignore empty lines and comments
        continue;
      }
      result.push(line);
    }
    return result;
  },

};
