// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/Dictionary.java partial
// Left out: read(Path) and read(URL); the caller loads the files. read(fsaStream,
// metadataStream) takes the .dict bytes and the .info bytes or text. Importing this module
// loads the FSA5 and CFSA2 readers.
import { FSA } from '../../../morfologik-fsa/morfologik/fsa/FSA.ts';
import '../../../morfologik-fsa/morfologik/fsa/FSA5.ts';
import '../../../morfologik-fsa/morfologik/fsa/CFSA2.ts';
import { DictionaryMetadata } from './DictionaryMetadata.ts';

/**
 * A dictionary combines {@link FSA} automaton and {@link DictionaryMetadata}
 * describing the way terms are encoded in the automaton.
 *
 * <p>
 * A dictionary consists of two files:
 * <ul>
 * <li>an actual compressed FSA file,
 * <li>{@link DictionaryMetadata}, describing the way terms are encoded.
 * </ul>
 */
export class Dictionary {
  /**
   * {@link FSA} automaton with the compiled dictionary data.
   */
  readonly fsa: FSA;

  /**
   * Metadata associated with the dictionary.
   */
  readonly metadata: DictionaryMetadata;

  /**
   * It is strongly recommended to use static methods in this class for
   * reading dictionaries.
   *
   * @param fsa
   *            An instantiated {@link FSA} instance.
   *
   * @param metadata
   *            A map of attributes describing the compression format and
   *            other settings not contained in the FSA automaton. For an
   *            explanation of available attributes and their possible values,
   *            see {@link DictionaryMetadata}.
   */
  constructor(fsa: FSA, metadata: DictionaryMetadata) {
    this.fsa = fsa;
    this.metadata = metadata;
  }

  /**
   * Attempts to load a dictionary from opened streams of FSA dictionary data
   * and associated metadata. Input streams are not closed automatically.
   *
   * @param fsaStream The stream with FSA data (the bytes of the .dict file)
   * @param metadataStream The stream with metadata (the bytes or text of the .info file)
   * @return Returns an instantiated {@link Dictionary}.
   * @throws IOException if an I/O error occurs.
   */
  static read(fsaStream: Uint8Array, metadataStream: Uint8Array | string): Dictionary {
    return new Dictionary(FSA.read(fsaStream), DictionaryMetadata.read(metadataStream));
  }
}
