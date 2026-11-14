// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/de/danielnaber/jwordsplitter/AbstractWordSplitter.java faithful
// The constructor overloads are one constructor: without a dictionary (the embedded one), with
// a plain text dictionary (InputStream or File: its UTF-8 bytes) or with the words (a Set).
// getAllSplits(word) and the package-private getAllSplits(word, fromLeft) are one method;
// Thread.interrupted() and the InterruptedException are left out (no threads here).
// splitWord(word, collectSubwords) has collectSubwords default to false. Lists are arrays (also
// Java's immutable singletonList / Arrays.asList / emptyList).
import { StringTrim } from '../../../../jdk/java/lang/Character.ts';
import { Arrays_equals } from '../../../../jdk/java/util/Objects.ts';
import { ExceptionSplits } from './ExceptionSplits.ts';
import type { GermanInterfixDisambiguator } from './GermanInterfixDisambiguator.ts';
import { InputTooLongException } from './InputTooLongException.ts';

/**
 * This class can split compound words into their smallest parts (atoms). For example "Erhebungsfehler"
 * will be split into "erhebung" and "fehler", if "erhebung" and "fehler" are in the dictionary
 * and "erhebungsfehler" is not. Thus how words are split only depends on the contents of
 * the dictionary. A dictionary for German is included.
 *
 * <p>This is especially useful for German words but it will work with all languages.
 * The order of the words in the collection will be identical to their appearance in the
 * connected word. It's good to provide a large dictionary.
 *
 * <p>Please note: We don't expect to have any special chars here (!":;,.-_, etc.). Only a set of
 * characters and only one word.
 *
 * @author Daniel Naber
 */
export abstract class AbstractWordSplitter {

    /** getWordList(InputStream stream), or getWordList() (the embedded dictionary) without a stream. */
    protected abstract getWordList(stream?: Uint8Array): Set<string>;
    protected abstract getDisambiguator(): GermanInterfixDisambiguator;
    protected abstract getDefaultMinimumWordLength(): number;
    /** Interfix elements in lowercase, e.g. at least "s" for German. */
    protected abstract getInterfixCharacters(): readonly string[];

    protected words: Set<string> | null = null;

    private readonly hideInterfixCharacters: boolean;

    private exceptionSplits = new ExceptionSplits();
    private strictMode = true;
    private minimumWordLength = this.getDefaultMinimumWordLength();
    private maximumWordLength = 70;

    /**
     * Create a word splitter that uses the embedded dictionary.
     *
     * @param hideInterfixCharacters whether the word parts returned by {@link #splitWord(String)} still contain
     *  the connecting character (a.k.a. interfix)
     * @param plainTextDict a stream of a text file with one word per line, to be used instead of the embedded dictionary,
     *                       must be in UTF-8 format (also a File's content)
     * @param words the compound part words (@since 4.1)
     */
    constructor(hideInterfixCharacters: boolean, plainTextDict?: Uint8Array | Set<string>) {
        this.hideInterfixCharacters = hideInterfixCharacters;
        if (plainTextDict instanceof Set) {
            this.words = plainTextDict;
        } else if (plainTextDict !== undefined) {
            this.words = this.getWordList(plainTextDict);
        } else {
            this.words = this.getWordList();
        }
    }

    setMinimumWordLength(len: number): void {
        this.minimumWordLength = len;
    }

    /**
     * Words longer than this will throw an {@code IllegalArgumentException} to avoid extremely long
     * processing times. The default is 70.
     * @since 4.2
     */
    setMaximumWordLength(len: number): void {
        this.maximumWordLength = len;
    }

    /**
     * @param filename UTF-8 encoded file with exceptions in the classpath, one exception per line, using pipe as delimiter.
     *   Example: <tt>Pilot|sendung</tt>
     */
    setExceptionFile(filename: string): void {
        this.exceptionSplits = new ExceptionSplits(filename);
    }

    /**
     * @param completeWord the word for which an exception is to be defined (will be considered case-insensitive)
     * @param wordParts the parts in which the word is to be split (use a list with a single element if the word should not be split)
     */
    addException(completeWord: string, wordParts: string[] | null): void {
        this.exceptionSplits.addSplit(completeWord.toLowerCase(), wordParts);
    }

    /**
     * When set to true, words will only be split if all parts are words.
     * Otherwise the splitting result might contain parts that are not words.
     */
    setStrictMode(strictMode: boolean): void {
        this.strictMode = strictMode;
    }

    /**
     * Experimental: Split a word with unknown parts, typically because one part
     * has a typo. This could be used to split three-part compounds where one
     * part has a typo (the caller is then responsible for making useful corrections
     * out of these parts). Results are returned in no specific order.
     * @since 4.0
     *
     * (With fromLeft: the splits found from the left or from the right.)
     */
    getAllSplits(word: string, fromLeft?: boolean): string[][] {
        if (fromLeft === undefined) {
            if (word.length > this.maximumWordLength) {
                throw new InputTooLongException("Input too long (" + word.length + " characters), maximum is " +
                        this.maximumWordLength + " characters to avoid potentially long processing times: '" + word + "'");
            }
            const result1 = this.getAllSplits(word, true);
            const result2 = this.getAllSplits(word, false);
            const result: string[][] = result1.slice();
            for (const split of result2) {
                if (!result.some((r) => Arrays_equals(r, split))) {
                    result.push(split);
                }
            }
            return result;
        }
        const result: string[][] = [];
        const start = fromLeft ? this.minimumWordLength : word.length - this.minimumWordLength;
        for (let i = start; this.isLoopEnd(fromLeft, i, word);) {
            const left = word.substring(0, i);
            const right = word.substring(i, word.length);
            const relevantWord = fromLeft ? left : right;
            const isSimpleWord = this.isSimpleWord(relevantWord);
            //System.out.println(i + ". " + left + " " + right + " -> " + relevantWord + " " + (isSimpleWord ? "***" : ""));
            if (isSimpleWord) {
                result.push([left, right]);
                const otherSplits = this.getAllSplits(fromLeft ? right : left);
                if (otherSplits.length > 0) {
                    for (const otherSplit of otherSplits) {
                        const sub: string[] = [];
                        if (fromLeft) {
                            sub.push(left);
                            sub.push(...otherSplit);
                        } else {
                            sub.push(...otherSplit);
                            sub.push(right);
                        }
                        result.push(sub.slice());
                    }
                }
            }
            i = fromLeft ? i + 1 : i - 1;
        }
        return result;
    }

    private isLoopEnd(fromLeft: boolean, i: number, word: string): boolean {
        if (fromLeft) {
            return i < word.length - this.minimumWordLength;
        } else {
            return i > this.minimumWordLength;
        }
    }

    /**
     * @since 4.2
     */
    getSubWords(word: string): string[] {
        return this.splitWord(word, true);
    }

    /**
     * @return a list of compound parts, with one element (the input word itself) if the input
     *   could not be split; returns an empty list if the input is {@code null}
     * @since 4.2
     */
    splitWord(word: string | null, collectSubwords = false): string[] {
        if (word == null) {
            return [];
        }
        if (word.length > this.maximumWordLength) {
            throw new InputTooLongException("Input too long (" + word.length + " characters), maximum is " +
                    this.maximumWordLength + " characters to avoid potentially long processing times: '" + word + "'");
        }
        const trimmedWord = StringTrim(word);
        const exceptionSplit = this.exceptionSplits.getExceptionSplitOrNull(trimmedWord);
        if (exceptionSplit != null) {
            return exceptionSplit;
        }
        const parts = this.split(trimmedWord, false, collectSubwords);
        if (parts == null) {
            return [trimmedWord];
        }
        const disambiguatedParts = this.getDisambiguator().disambiguate(parts);
        this.cleanLeadingAndTrailingHyphens(disambiguatedParts);
        return disambiguatedParts;
    }

    private cleanLeadingAndTrailingHyphens(disambiguatedParts: string[]): void {
        for (let i = 0; i < disambiguatedParts.length; i++) {
            const element = disambiguatedParts[i]!;
            if (element.startsWith("-")) {
                disambiguatedParts[i] = element.substring(1);
            }
            if (element.endsWith("-")) {
                disambiguatedParts[i] = element.substring(0, element.length - 1);
            }
        }
    }

    private split(word: string, allowInterfixRemoval: boolean, collectSubwords: boolean): string[] | null {
        let parts = this.exceptionSplits.getExceptionSplitOrNull(word);
        if (parts != null) {
            return parts;
        }
        const lcWord = word.toLowerCase();
        const removableInterfix = this.findInterfixOrNull(lcWord);
        const wordWithoutInterfix = this.removeInterfix(word, removableInterfix);
        const canInterfixBeRemoved = removableInterfix != null && allowInterfixRemoval;

        if (this.isSimpleWord(word) && !collectSubwords) {
            parts = [word];
        } else if (canInterfixBeRemoved && this.isSimpleWord(wordWithoutInterfix)) {
            if (this.hideInterfixCharacters) {
                parts = [wordWithoutInterfix];
            } else {
                parts = [wordWithoutInterfix, removableInterfix!];
            }
        } else {
            parts = this.splitFromRight(word, collectSubwords);

            if (parts == null && this.isSimpleWord(word)) {
                parts = [];
                parts.push(word);
            } else if (parts != null && this.isSimpleWord(word) && !parts.includes(word)) {
                parts.push(word);
            }

            if (parts == null && this.endsWithInterfix(lcWord)) {
                parts = this.splitFromRight(wordWithoutInterfix, collectSubwords);
                if (parts != null && !this.hideInterfixCharacters) {
                    parts.push(removableInterfix!);
                }
            }
        }
        return parts;
    }

    private splitFromRight(word: string, collectSubwords: boolean): string[] | null {
        let parts = this.exceptionSplits.getExceptionSplitOrNull(word);
        if (parts != null) {
            return parts;
        }

        for (let i = word.length - this.minimumWordLength; i >= this.minimumWordLength; i--) {
            const leftPart = word.substring(0, i);
            const rightPart = word.substring(i);
            //System.out.println(word  + " -> " + leftPart + " + " + rightPart);
            if (!this.strictMode) {
                const exceptionSplit = this.getExceptionSplitOrNull(rightPart, leftPart);
                if (exceptionSplit != null) {
                    return exceptionSplit;
                }
            }
            if (this.isSimpleWord(rightPart)) {
                const leftPartParts = this.split(leftPart, true, collectSubwords);
                const isLeftPartAWord = leftPartParts != null;
                if (isLeftPartAWord) {
                    if (collectSubwords) {
                        if (parts == null) {
                            parts = [];
                        }
                        for (const leftPartPart of leftPartParts) {
                            if (!parts.includes(leftPartPart)) {
                                parts.push(leftPartPart);
                            }
                        }
                        if (!parts.includes(rightPart)) {
                            parts.push(rightPart);
                        }
                        const rightPartExceptions = this.exceptionSplits.getExceptionSplitOrNull(rightPart);
                        if (rightPartExceptions != null) {
                            for (const exception of rightPartExceptions) {
                                if (!parts.includes(exception)) {
                                    parts.push(exception);
                                }
                            }
                        }
                    } else {
                        parts = leftPartParts.slice();
                        parts.push(rightPart);
                    }
                } else if (!this.strictMode) {
                    parts = [];
                    parts.push(leftPart);
                    parts.push(rightPart);
                }
            } else if (!this.strictMode) {
                if (this.isSimpleWord(leftPart)) {
                    parts = [];
                    parts.push(leftPart);
                    parts.push(rightPart);
                }
            }
        }
        return parts;
    }

    private getExceptionSplitOrNull(rightPart: string, leftPart: string): string[] | null {
        const exceptionSplit = this.exceptionSplits.getExceptionSplitOrNull(rightPart);
        if (exceptionSplit != null) {
            const parts: string[] = [];
            parts.push(leftPart);
            parts.push(...exceptionSplit);
            return parts;
        }
        const exceptionSplit2 = this.exceptionSplits.getExceptionSplitOrNull(leftPart);
        if (exceptionSplit2 != null) {
            const parts: string[] = [];
            parts.push(...exceptionSplit2);
            parts.push(rightPart);
            return parts;
        }
        return null;
    }

    private findInterfixOrNull(word: string): string | null {
        const interfixes = this.getInterfixCharacters();
        const lcWord = word.toLowerCase();
        for (const interfix of interfixes) {
            if (lcWord.endsWith(interfix)) {
                return interfix;
            }
        }
        return null;
    }

    private endsWithInterfix(word: string): boolean {
        const interfixes = this.getInterfixCharacters();
        for (const interfix of interfixes) {
            if (word.endsWith(interfix)) {
                return true;
            }
        }
        return false;
    }

    private removeInterfix(word: string, interfixOrNull: string | null): string {
        if (interfixOrNull != null) {
            return word.substring(0, word.length - interfixOrNull.length);
        }
        return word;
    }

    private isSimpleWord(part: string): boolean {
        return part.length >= this.minimumWordLength && this.words!.has(part.toLowerCase());
    }

}
