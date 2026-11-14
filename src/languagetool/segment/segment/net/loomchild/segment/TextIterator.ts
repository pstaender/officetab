// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/TextIterator.java faithful

/**
 * Text iterator interface.
 * 
 * @author loomchild
 */
export interface TextIterator {

	/**
	 * @return next segment in text, or null if end of text has been
	 *         reached.
	 */
	next(): string | null;

	/**
	 * @return true if there are more segments
	 */
	hasNext(): boolean;

	/**
	 * Unsupported operation.
	 * 
	 * @throws UnsupportedOperationException
	 */
	remove(): void;

}
