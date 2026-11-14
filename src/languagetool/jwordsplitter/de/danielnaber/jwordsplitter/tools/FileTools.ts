// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/de/danielnaber/jwordsplitter/tools/FileTools.java faithful
// The InputStream is the stream's bytes; the charset is always UTF-8 (the only one jwordsplitter
// passes, in either spelling).
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { BufferedReader_readLines } from '../../../../../jdk/java/io/BufferedReader.ts';

/**
 * Helper methods.
 *
 * @author Sven Abels
 * @author Daniel Naber
 */
export class FileTools
{

    private constructor() {
        // class has static methods only, no public constructor
    }

    /**
     * Load a file and return each line, lowercased, as an entry in a HashSet.
     */
    static loadFileToSet(is: Uint8Array, _charset: string): Set<string> {
        const words = new Set<string>();
        for (const line of BufferedReader_readLines(is)) {
            words.add(StringTrim(line).toLowerCase());
        }
        return words;
    }

    static loadFile(inputStream: Uint8Array, _charset: string): string {
        let sb = "";
        for (const line of BufferedReader_readLines(inputStream)) {
            sb += line;
            sb += "\n";
        }
        return sb;
    }

}
