// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/LineExpander.java faithful
// The Guava cache of verb forms (expiring after 10 minutes) is a Map.
import type { LineExpander as LineExpanderInterface } from '../../../../../../languagetool-core/org/languagetool/rules/LineExpander.ts';
import { StringTools } from '../../../../../../languagetool-core/org/languagetool/tools/StringTools.ts';
import { GermanSynthesizer } from '../../synthesis/GermanSynthesizer.ts';
import { Character, StringTrim } from '../../../../../../../jdk/java/lang/Character.ts';
import { StringReplaceAll, StringSplit } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

const verbFormCache = new Map<string, string[]>();

function verbFormCacheGetUnchecked(verb: string): string[] {
  let forms = verbFormCache.get(verb);
  if (forms === undefined) {
    forms = GermanSynthesizer.INSTANCE.synthesizeForPosTags(verb, (s) => s.startsWith('VER:'));
    verbFormCache.set(verb, forms);
  }
  return forms;
}

function handleLineWithPrefix(line: string): string[] {
  const result: string[] = [];
  const parts = StringSplit(cleanTagsAndEscapeChars(line), '_');
  if (parts.length !== 2) {
    throw new Error("IllegalArgumentException: Unexpected line format, expected at most one '_': " + line);
  }
  if (parts[0]!.includes('/') || parts[1]!.includes('/')) {
    throw new Error("IllegalArgumentException: Unexpected line format, '_' cannot be combined with '/': " + line);
  }
  if (parts[1] === 'in') {
    // special case for the common gender gap characters:
    result.push(parts[0] + '_in');
    result.push(parts[0] + '_innen');
    result.push(parts[0] + '*in');
    result.push(parts[0] + '*innen');
    result.push(parts[0] + ':in');
    result.push(parts[0] + ':innen');
    //result.add(parts[0] + "in");   // see if we can comment in these cases, too
    //result.add(parts[0] + "innen");
    //result.add(parts[0] + "e");
    //result.add(parts[0] + "en");
  } else {
    const forms = verbFormCacheGetUnchecked(parts[1]!);
    if (forms.length === 0) {
      throw new Error("RuntimeException: Could not expand '" + parts[1] + "' from line '" + line + "', no forms found");
    }
    const formSet = new Set<string>(forms);
    for (const form of formSet) {
      if (!form.includes('ß') && form.length > 0 && Character.isLowerCase(form.charAt(0))) {
        // skip these, it's too risky to introduce old spellings like "gewußt" from the synthesizer
        result.push(parts[0] + form);
      }
    }
    result.push(parts[0] + 'zu' + parts[1]);  //  "zu<verb>" is not part of forms from synthesizer
    result.push(StringTools.uppercaseFirstChar(parts[0]!) + parts[1] + 's');  //  Genitiv, e.g. "des Weitergehens"
  }
  return result;
}

// ignore "#..." so it can be used as a tag:
function cleanTagsAndEscapeChars(s: string): string {
  const idx = s.indexOf('#');
  if (idx !== -1) {
    s = s.substring(0, idx);
  }
  return StringTrim(s.replaceAll('\\', ''));
}

/**
 * Expand lines according to their suffix, e.g. {@code foo/S} becomes {@code [foo, foos]}.
 * @since 3.0
 */
export class LineExpander implements LineExpanderInterface {

  expandLine(line: string): string[] {
    return this.isLineWithVerbPrefix(line) ? handleLineWithPrefix(line) :
           this.isLineWithFlag(line) ? this.handleLineWithFlags(line) :
           [cleanTagsAndEscapeChars(line)];
  }

  private isLineWithFlag(line: string): boolean {
    const idx = line.indexOf('/');
    return !line.startsWith('#') && idx > 0 && line.charAt(idx - 1) !== '\\';
  }

  private isLineWithVerbPrefix(line: string): boolean {
    const idx = line.indexOf('_');
    return !line.startsWith('#') && idx > 0 && line.charAt(idx - 1) !== '\\';
  }

  private handleLineWithFlags(line: string): string[] {
    const result: string[] = [];
    const parts = StringSplit(cleanTagsAndEscapeChars(line), '/');
    if (parts.length !== 2) {
      throw new Error('IllegalArgumentException: Unexpected line format, expected at most one slash: ' + line);
    }
    const word = parts[0]!;
    const suffix = parts[1]!;
    for (let i = 0; i < suffix.length; i++) {
      const c = suffix.charAt(i);
      if (c === 'S') {
        this.add(result, word);
        result.push(word + 's');
      } else if (c === 'N') {
        this.add(result, word);
        result.push(word + 'n');
      } else if (c === 'E') {
        this.add(result, word);
        result.push(word + 'e');
      } else if (c === 'F') {
        this.add(result, word);
        result.push(word + 'in'); // (m/f)
      } else if (c === 'T') {
        this.add(result, word);
        if (word.endsWith('straße') || word.endsWith('strasse')) {
          result.push(StringReplaceAll(word, 'stra(ß|ss)e', 'str.'));
        }
        if (word.endsWith('Straße') || word.endsWith('Strasse')) {
          result.push(StringReplaceAll(word, 'Stra(ß|ss)e', 'Str.'));
        }
      } else if (c === 'A' || c === 'P') { // Adjektiv / Partizip
        this.add(result, word);
        if (word.endsWith('e')) {
          result.push(word + 'r');
          result.push(word + 's');
          result.push(word + 'n');
          result.push(word + 'm');
        } else {
          result.push(word + 'e');
          result.push(word + 'er');
          result.push(word + 'es');
          result.push(word + 'en');
          result.push(word + 'em');
        }
      } else {
        throw new Error('IllegalArgumentException: Unknown suffix: ' + suffix + ' in line: ' + line);
      }
    }
    return result;
  }

  private add(result: string[], word: string): void {
    if (!result.includes(word)) {
      result.push(word);
    }
  }
}
