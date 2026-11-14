// SPDX-License-Identifier: MPL-2.0
// @upstream src/main/java/de/danielnaber/jwordsplitter/GermanWordSplitter.java faithful
// The constructor overloads are one constructor (see AbstractWordSplitter): without a
// dictionary it uses the embedded one; a plain text dictionary (InputStream or File) is its
// UTF-8 bytes; a Set is the words (@since 4.2). The two getWordList overloads are one method.
// Every constructor reads the embedded dictionary (for the disambiguator) and the exception file
// from the class path, i.e. JLanguageTool.getDataBroker(): load EmbeddedGermanDictionary.DICT and
// EXCEPTION_DICT into it first.
import { EmbeddedGermanDictionary } from './EmbeddedGermanDictionary.ts';
import { AbstractWordSplitter } from './AbstractWordSplitter.ts';
import { GermanInterfixDisambiguator } from './GermanInterfixDisambiguator.ts';
import { FileTools } from './tools/FileTools.ts';

/**
 * Split German compound words. Based on an embedded dictionary, or on an
 * external plain text dictionary.
 */
export class GermanWordSplitter extends AbstractWordSplitter {

    static readonly EXCEPTION_DICT = "/de/danielnaber/jwordsplitter/exceptionsGerman.txt";   // dict inside the JAR
    /** Interfixes = Fugenelemente */
    private static readonly INTERFIXES: readonly string[] = [
            "s-",  // combination of the characters below
            "s",
            "-"];

    private disambiguator: GermanInterfixDisambiguator | null = null;

    /**
     * @param plainTextDict a plain text dictionary (UTF-8 bytes of an InputStream or File), or
     *   the words (@since 4.2); the embedded dictionary when absent
     */
    constructor(hideInterfixCharacters: boolean, plainTextDict?: Uint8Array | Set<string>) {
        super(hideInterfixCharacters, plainTextDict ?? EmbeddedGermanDictionary.getWords());
        this.init();
    }

    private init(): void {
        this.disambiguator = new GermanInterfixDisambiguator(this.getWordList());
        this.setExceptionFile(GermanWordSplitter.EXCEPTION_DICT);
    }

    protected override getWordList(stream?: Uint8Array): Set<string> {
        if (stream !== undefined) {
            return FileTools.loadFileToSet(stream, "utf-8");
        }
        return EmbeddedGermanDictionary.getWords();
    }

    protected override getDisambiguator(): GermanInterfixDisambiguator {
        return this.disambiguator!;
    }

    protected override getDefaultMinimumWordLength(): number {
        return 3;
    }

    protected override getInterfixCharacters(): readonly string[] {
        return GermanWordSplitter.INTERFIXES;
    }

}
