// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/dictionary/serializer/DictionaryEntryPersistor.java partial
// Only create (reading). Java's SAX XMLReader is the saxes parser here; its opentag, text and
// closetag events call the content handler's startElement, characters and endElement. The
// stream is decoded as UTF-8 (the encoding these files declare).
import { SaxesParser } from 'saxes';
import { InvalidFormatException } from '../../util/InvalidFormatException.ts';
import { StringList } from '../../util/StringList.ts';
import { Attributes } from './Attributes.ts';
import { Entry } from './Entry.ts';
import type { EntryInserter } from './EntryInserter.ts';

/** Java's String.trim: removes characters up to U+0020. */
const trim = (s: string): string => s.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');

// TODO: should check for invalid format, make it save
class DictionaryContenthandler {
  private mInserter: EntryInserter;

  //    private boolean mIsInsideDictionaryElement;
  //    private boolean mIsInsideEntryElement;
  private mIsInsideTokenElement = false;
  mIsCaseSensitiveDictionary: boolean;

  private mTokenList: string[] = [];

  private token = '';

  private mAttributes: Attributes | null = null;

  constructor(inserter: EntryInserter) {
    this.mInserter = inserter;
    this.mIsCaseSensitiveDictionary = true;
  }

  startElement(localName: string, atts: Record<string, string>): void {
    if (DICTIONARY_ELEMENT === localName) {
      this.mAttributes = new Attributes();

      for (const name in atts) {
        this.mAttributes.setValue(name, atts[name]);
      }
      /* get the attribute here ... */
      const caseSensitive = this.mAttributes.getValue(ATTRIBUTE_CASE_SENSITIVE);
      if (caseSensitive != null) {
        // Boolean.valueOf
        this.mIsCaseSensitiveDictionary = caseSensitive.toLowerCase() === 'true';
      }
      this.mAttributes = null;
    }
    else if (ENTRY_ELEMENT === localName) {
      this.mAttributes = new Attributes();

      for (const name in atts) {
        this.mAttributes.setValue(name, atts[name]);
      }
    }
    else if (TOKEN_ELEMENT === localName) {
      this.mIsInsideTokenElement = true;
    }
  }

  characters(ch: string): void {
    if (this.mIsInsideTokenElement) {
      this.token += ch;
    }
  }

  endElement(localName: string): void {
    if (TOKEN_ELEMENT === localName) {
      this.mTokenList.push(trim(this.token));
      this.token = '';
      this.mIsInsideTokenElement = false;
    }
    else if (ENTRY_ELEMENT === localName) {
      const tokens = this.mTokenList.slice();

      const entry = new Entry(new StringList(...tokens), this.mAttributes as Attributes);

      try {
        this.mInserter.insert(entry);
      } catch (e) {
        if (e instanceof InvalidFormatException) throw new Error('Invalid dictionary format!', { cause: e });
        throw e;
      }

      this.mTokenList.length = 0;
      this.mAttributes = null;
    }
  }
}

const DICTIONARY_ELEMENT = 'dictionary';
const ENTRY_ELEMENT = 'entry';
const TOKEN_ELEMENT = 'token';
const ATTRIBUTE_CASE_SENSITIVE = 'case_sensitive';

/**
 * This class reads and writes dictionaries in the OpenNLP dictionary XML format.
 */
export class DictionaryEntryPersistor {
  /**
   * Creates Entrys from the given InputStream and forwards these Entrys to the EntryInserter.
   *
   * After creation is finished the provided InputStream is closed.
   *
   * @return isCaseSensitive attribute for Dictionary
   */
  static create(input: Uint8Array, inserter: EntryInserter): boolean {
    const profileContentHandler = new DictionaryContenthandler(inserter);

    const xmlReader = new SaxesParser();
    xmlReader.on('opentag', (tag) => profileContentHandler.startElement(tag.name, tag.attributes as Record<string, string>));
    xmlReader.on('text', (text) => profileContentHandler.characters(text));
    xmlReader.on('cdata', (text) => profileContentHandler.characters(text));
    xmlReader.on('closetag', (tag) => profileContentHandler.endElement(tag.name));
    try {
      xmlReader.write(new TextDecoder('utf-8').decode(input)).close();
    }
    catch (e) {
      if (e instanceof Error && e.cause instanceof InvalidFormatException) throw e;
      throw new InvalidFormatException('The profile data stream has ' +
          'an invalid format!', e);
    }
    return profileContentHandler.mIsCaseSensitiveDictionary;
  }
}
