// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tokenizers/SrxTools.java faithful
// The SRX file is read from the data broker as a UTF-8 string (the segment port parses strings).
import { JLanguageTool } from '../JLanguageTool.ts';
import type { SrxDocument } from '../../../../../segment/segment/net/loomchild/segment/srx/SrxDocument.ts';
import { Srx2SaxParser } from '../../../../../segment/segment/net/loomchild/segment/srx/io/Srx2SaxParser.ts';
import type { SrxParser } from '../../../../../segment/segment/net/loomchild/segment/srx/SrxParser.ts';
import { SrxTextIterator } from '../../../../../segment/segment/net/loomchild/segment/srx/SrxTextIterator.ts';
import type { TextIterator } from '../../../../../segment/segment/net/loomchild/segment/TextIterator.ts';

/**
 * Tools for loading an SRX tokenizer file.
 * @since 2.6
 */
export class SrxTools {

  private constructor() {
  }

  static createSrxDocument(path: string): SrxDocument {
    const inputStream = JLanguageTool.getDataBroker().getFromResourceDirAsStream(path);
    const srxReader = new TextDecoder('utf-8').decode(inputStream);
    const parserParameters = new Map<string, unknown>();
    parserParameters.set(Srx2SaxParser.VALIDATE_PARAMETER, true);
    const srxParser: SrxParser = new Srx2SaxParser(parserParameters);
    return srxParser.parse(srxReader);
  }

  static tokenize(text: string, srxDocument: SrxDocument, code: string): string[] {
    const segments: string[] = [];
    const textIterator: TextIterator = new SrxTextIterator(srxDocument, code, text);
    while (textIterator.hasNext()) {
      segments.push(textIterator.next()!);
    }
    return segments;
  }

}
