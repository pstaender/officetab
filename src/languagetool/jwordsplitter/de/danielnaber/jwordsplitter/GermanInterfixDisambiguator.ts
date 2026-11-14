// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/de/danielnaber/jwordsplitter/GermanInterfixDisambiguator.java faithful
// Lists are arrays.
import { StringReplaceFirst } from '../../../../jdk/java/util/regex/Pattern.ts';

/**
 * Tries to resolve ambiguities, e.g. "Urlaubsorte" could be
 * Urlaub+s+Orte but also Urlaub+Sorte (our dictionary doesn't know
 * which words require an interfix character).
 */
export class GermanInterfixDisambiguator {

    private static readonly wordsRequiringInterfixS = new Set<string>([
        "Verhalten",
    ]);

    private readonly dictionary: Set<string>;

    constructor(dictionary: Set<string>) {
        this.dictionary = dictionary;
    }

    // TODO:
    // ecke, recke ...
    // stube vs. tube
    // tau vs. stau

    disambiguate(parts: readonly string[]): string[] {
        const newParts: string[] = parts.slice();
        const lastPartIdx = parts.length - 1;
        if (parts.length > 1) {
            const lastPart = parts[lastPartIdx]!;
            if (lastPart === "samt" || lastPart === "samts" || lastPart === "samtes") {
                // Verkehr+s+amt = Verkehrs+amt
                newParts[lastPartIdx - 1] = parts[lastPartIdx - 1] + "s";
                newParts[lastPartIdx] = StringReplaceFirst(lastPart, "^s", "");
                return newParts;
            }
        }
        for (let i = newParts.length - 1; i >= 2; i--) {
            const part = newParts[i]!;
            const prevPart = newParts[i - 1]!;
            const prevPrevPart = newParts[i - 2]!;
            if (prevPart === "s") {
                const partIsWord = this.isWord("s" + part);
                if (!partIsWord || GermanInterfixDisambiguator.wordsRequiringInterfixS.has(prevPrevPart)) {
                    // Schönheit+s+tempel = Schönheits-tempel
                    newParts[i - 2] = prevPrevPart + "s";
                    newParts.splice(i - 1, 1);   // remove interfix
                }
            }
        }
        return newParts;
    }

    private isWord(word: string): boolean {
        return this.dictionary.has(word.toLowerCase());
    }
}
