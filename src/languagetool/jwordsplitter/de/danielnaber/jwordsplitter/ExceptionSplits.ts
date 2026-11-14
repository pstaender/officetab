// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/de/danielnaber/jwordsplitter/ExceptionSplits.java faithful
// The class path is LanguageTool's data broker (see EmbeddedGermanDictionary); Scanner's lines
// are BufferedReader's. Lists are arrays; addSplit may store null (a reset), so the map's
// values are string[] | null.
import { StringTrim } from '../../../../jdk/java/lang/Character.ts';
import { BufferedReader_readLines } from '../../../../jdk/java/io/BufferedReader.ts';
import { StringSplit } from '../../../../jdk/java/util/regex/Pattern.ts';
import { JLanguageTool } from '../../../../languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { FileTools } from './tools/FileTools.ts';

/**
 * Exceptions for splitting loaded from a file.
 */
export class ExceptionSplits {

    private static readonly COMMENT_CHAR = "#";
    private static readonly DELIMITER_CHAR = "|";

    private readonly exceptionMap = new Map<string, string[] | null>();

    /**
     * Create an empty list of exceptions.
     *
     * With filename: the exceptions of that class path file.
     */
    constructor(filename?: string) {
        if (filename === undefined) {
            return;
        }
        const is = JLanguageTool.getDataBroker().getAsStream(filename);
        if (is == null) {
            throw new Error("IOException: Cannot locate exception list in class path: " + filename);
        }
        const exceptions = FileTools.loadFile(is, "UTF-8");
        for (const scannerLine of BufferedReader_readLines(exceptions)) {
            const line = StringTrim(scannerLine);
            if (!(line.length === 0) && !line.startsWith(ExceptionSplits.COMMENT_CHAR)) {
                const parts = StringSplit(line.replaceAll("/NS", ""), "\\|");
                const completeWord = line.replaceAll(ExceptionSplits.DELIMITER_CHAR, "");
                const list: string[] = parts.slice();
                if (completeWord.includes("/")) {
                    if (completeWord.endsWith("/NS")) {
                        const realWord = completeWord.replaceAll("/NS", "").toLowerCase();
                        this.exceptionMap.set(realWord, list);
                        this.exceptionMap.set(realWord + "n", this.addToLastPart(list, "n"));
                        this.exceptionMap.set(realWord + "s", this.addToLastPart(list, "s"));
                    } else {
                        throw new Error("RuntimeException: Unknown suffix in line: " + line);
                    }
                } else {
                    this.exceptionMap.set(completeWord.toLowerCase(), list);
                }
            }
        }
    }

    private addToLastPart(list: readonly string[], suffix: string): string[] {
        const result: string[] = list.slice();
        const lastPos = result.length - 1;
        result[lastPos] = result[lastPos] + suffix;
        return result;
    }

    getExceptionSplitOrNull(word: string): string[] | null {
        const lcWord = word.toLowerCase();
        let result = this.exceptionMap.get(lcWord) ?? null;
        if (result != null) {
            // The following code will only get executed if an exception split is encountered
            const check = this.join(result, "");
            if (lcWord === check.toLowerCase()) {
                // The recombined, lowercased split-word is equal to the lowercase original word
                // Generate the pieces by splitting the original word with the same string lengths
                // as the splitted word. This will preserve the case of the original word
                result = this.splitEqually(result, word);
            }
        }
        return result;
    }

    protected splitEqually(splitted: readonly string[], original: string): string[] {
        const list: string[] = [];
        let offset = 0;
        for (const s of splitted) {
            const length = s.length;
            list.push(original.substring(offset, offset+length));
            offset += length;
        }
        return list;
    }

    protected join(elements: readonly string[], separator: string): string {
        return elements.join(separator);
    }

    addSplit(word: string, wordParts: string[] | null): void {
        this.exceptionMap.set(word.toLowerCase(), wordParts);
    }
}
