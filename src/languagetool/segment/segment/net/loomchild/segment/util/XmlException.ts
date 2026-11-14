// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/util/XmlException.java faithful

/**
 * Runtime version of XML exception.
 * @author loomchild
 */
export class XmlException extends Error {

	constructor(message?: string | Error, cause?: unknown) {
		if (message instanceof Error) {
			super(message.message, { cause: message });
		} else {
			super(message, cause === undefined ? undefined : { cause });
		}
		this.name = "XmlException";
	}

}
