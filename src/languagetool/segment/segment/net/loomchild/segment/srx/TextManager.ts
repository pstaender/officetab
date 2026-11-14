// SPDX-License-Identifier: MPL-2.0
// @upstream segment/src/main/java/net/loomchild/segment/srx/TextManager.java partial
// Only the text constructor: the streaming one (a Reader with a buffer) and reading from it
// are left out, so there is never more text to read; readText keeps its argument checks.

/** 
 * Represents text manager.
 * Responsible for managing current text, reading more text from the reader
 * and checking if there is more text left.
 * @author loomchild
 */
export class TextManager {
	
	private text: string | null;
	
	nextCharacter: number;
	
	private bufferLength: number;
	
	/** 
	 * Creates text manager containing given text. Reading more text is not 
	 * possible when using this constructor.
	 * @param text
	 */
	constructor(text: string) {
		this.text = text;
		this.nextCharacter = -1;
		this.bufferLength = text.length;
	}

	getBufferLength(): number {
		return this.bufferLength;
	}
	
	/**
	 * @return current text
	 */
	getText(): string {
		this.initText();
		return this.text!;
	}
	
	/**
	 * @return true if more text can be read
	 */
	hasMoreText(): boolean {
		this.initText();
		return this.nextCharacter != -1;
	}
	
	/**
	 * Deletes given amount of characters from current character buffer and 
	 * tries to read up to given amount of new characters and stores them in
	 * current character buffer.
	 * @param amount amount of characters to read
	 * @throws IllegalArgumentException  if {@link #hasMoreText()} returns false or amount is greater than buffer size
	 */
	readText(amount: number): void {
		
		this.initText();
		
		if (amount <= 0) {
			throw new Error("IllegalArgumentException: Amount must be positive.");
		}
		if (amount > this.bufferLength) {
			throw new Error("IllegalArgumentException: Amount to read is larger than buffer size.");
		}
		if (!this.hasMoreText()) {
			throw new Error("IllegalStateException: No more text to read.");
		}
		
		// Not reached: there is no reader (see the header).

	}
	
	/**
	 * Reads initial text from reader if it has not been initialized yet.
	 */
	private initText(): void {
		if (this.text == null) {
			this.text = "";
		}
	}
	
}
