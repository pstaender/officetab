// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/SrxParser.java faithful
// The document is passed as a string in place of a Reader.
import type { SrxDocument } from './SrxDocument.ts';

/**
 * Represents SRX parser that can parse SRX document from reader.
 * 
 * @author loomchild
 */
export interface SrxParser {

	/**
	 * Parses SRX document.
	 * 
	 * @param reader reader from which read the document
	 * @return initialized SRX document
	 */
	parse(reader: string): SrxDocument;

}
