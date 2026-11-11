// SPDX-License-Identifier: MPL-2.0
// @upstream include/oox/mathml/importutils.hxx reduced
// @upstream oox/source/mathml/importutils.cxx reduced
// XmlStream: a stream of opening and closing tags, read linearly by the OOXML formula import.
// Tokens are element names as xmlparse canonicalises them ("m:acc"); an opening tag is the name
// prefixed with "<", a closing one with "/", and XML_TOKEN_INVALID is the empty string. Attribute
// tokens are attribute names ("m:val", "xml:space"). The stream is built from an XmlElement tree
// (XmlStreamBuilder.appendElement) instead of from fast-parser callbacks; the debug logging is
// left out.
import type { XmlElement } from '../../../xmloff/source/core/xmlparse.ts';

const XML_TOKEN_INVALID = '';

const bare = (token: string): string => (token.startsWith('<') || token.startsWith('/') ? token.slice(1) : token);
// used to differentiate between tags that opening or closing
export const XML_STREAM_OPENING = (token: string): string => '<' + bare(token);
export const XML_STREAM_CLOSING = (token: string): string => '/' + bare(token);

const OPENING = XML_STREAM_OPENING;
const CLOSING = XML_STREAM_CLOSING;

/** Structure representing a list of attributes. */
export class AttributeList {
  attrs = new Map<string, string>();

  /**
   * The type of the default value selects the return type: a string gives the value, a boolean
   * converts it, a number is a sal_Unicode (the first UTF-16 code unit).
   */
  attribute(token: string, def?: string): string;
  attribute(token: string, def: boolean): boolean;
  attribute(token: string, def: number): number;
  attribute(token: string, def: string | boolean | number = ''): string | boolean | number {
    const find = this.attrs.get(token);
    if (typeof def === 'string') {
      if (find !== undefined)
        return find;
      return def;
    }
    if (typeof def === 'boolean') {
      if (find !== undefined) {
        const sValue = find.toLowerCase();
        if (sValue === 'true' || sValue === 'on' || sValue === 't' || sValue === '1')
          return true;
        if (sValue === 'false' || sValue === 'off' || sValue === 'f' || sValue === '0')
          return false;
      }
      return def;
    }
    if (find !== undefined) {
      if (find.length !== 0) {
        return find.charCodeAt(0);
      }
    }
    return def;
  }
}

/** Structure representing a tag, including its attributes and content text immediately following it. */
export class Tag {
  token: string; ///< tag type, or XML_TOKEN_INVALID
  attributes: AttributeList;
  text = '';

  constructor(token: string = XML_TOKEN_INVALID, attributes: AttributeList = new AttributeList()) {
    this.token = token;
    this.attributes = attributes;
  }

  attribute(token: string, def?: string): string;
  attribute(token: string, def: boolean): boolean;
  attribute(token: string, def: number): number;
  attribute(token: string, def: string | boolean | number = ''): string | boolean | number {
    return this.attributes.attribute(token, def as never);
  }

  /** operator bool: true if the tag has a valid token. */
  valid(): boolean {
    return this.token !== XML_TOKEN_INVALID;
  }
}

export class XmlStream {
  protected tags: Tag[] = [];
  private pos = 0;

  /** @return true if current position is at the end of the XML stream */
  atEnd(): boolean {
    return this.pos >= this.tags.length;
  }

  /** @return data about the current tag */
  currentTag(): Tag {
    if (this.pos >= this.tags.length)
      return new Tag();
    return this.tags[this.pos]!;
  }

  /** @return the token for the current tag */
  currentToken(): string {
    if (this.pos >= this.tags.length)
      return XML_TOKEN_INVALID;
    return this.tags[this.pos]!.token;
  }

  /** Moves position to the next tag. */
  moveToNextTag(): void {
    if (this.pos < this.tags.length)
      ++this.pos;
  }

  ensureOpeningTag(token: string): Tag {
    return this.checkTag(OPENING(token), false);
  }

  checkOpeningTag(token: string): Tag {
    return this.checkTag(OPENING(token), true);
  }

  ensureClosingTag(token: string): void {
    this.checkTag(CLOSING(token), false);
  }

  private checkTag(token: string, optional: boolean): Tag {
    // either it's the following tag, or find it
    const savedPos = this.pos;
    if (optional) { // avoid printing debug messages about skipping tags if the optional one
      // will not be found and the position will be reset back
      if (this.currentToken() !== token && !this.findTagInternal(token, true)) {
        this.pos = savedPos;
        return new Tag();
      }
    }
    if (this.currentToken() === token || this.findTag(token)) {
      const ret = this.currentTag();
      this.moveToNextTag();
      return ret; // ok
    }
    if (optional) { // not a problem, just rewind
      this.pos = savedPos;
      return new Tag();
    }
    // SAL_WARN: Expected tag not found.
    return new Tag();
  }

  findTag(token: string): boolean {
    return this.findTagInternal(token, false);
  }

  private findTagInternal(token: string, _silent: boolean): boolean {
    let depth = 0;
    for (;
      !this.atEnd();
      this.moveToNextTag()) {
      const current = this.currentToken();
      if (depth > 0) { // we're inside a nested element, skip those
        if (current === OPENING(current))
          ++depth;
        else if (current === CLOSING(current))
          --depth;
        continue;
      }
      if (current === token)
        return true; // ok, found
      if (current === CLOSING(current))
        return false; // that would be leaving current element, so not found
      if (current === OPENING(current))
        ++depth;
    }
    // SAL_WARN: Unexpected end of stream reached.
    return false;
  }

  private skipElementInternal(token: string, _silent: boolean): void {
    const closing = CLOSING(token); // make it a closing tag
    this.moveToNextTag();
    // and just find the matching closing tag
    if (this.findTag(closing)) {
      this.moveToNextTag(); // and skip it too
      return;
    }
    // SAL_WARN: Expected end of element not found.
  }

  /**
   * Handle the current (unexpected) tag: if it is a closing tag, skip it, otherwise skip
   * the whole element.
   */
  handleUnexpectedTag(): void {
    if (this.atEnd())
      return;
    if (this.currentToken() === CLOSING(this.currentToken())) {
      this.moveToNextTag(); // just skip it
      return;
    }
    this.skipElementInternal(this.currentToken(), false); // otherwise skip the entire element
  }
}

/** This class is used for creating XmlStream. */
export class XmlStreamBuilder extends XmlStream {
  appendOpeningTag(token: string, attrs: AttributeList = new AttributeList()): void {
    this.tags.push(new Tag(OPENING(token), attrs));
  }

  appendClosingTag(token: string): void {
    this.tags.push(new Tag(CLOSING(token)));
  }

  appendCharacters(chars: string): void {
    if (this.tags.length === 0) return;
    this.tags[this.tags.length - 1]!.text += chars;
  }

  /** Not upstream: appends an element and its content, as the fast parser's callbacks would. */
  appendElement(e: XmlElement): void {
    const attrs = new AttributeList();
    for (const [k, v] of e.attrs) attrs.attrs.set(k, v);
    this.appendOpeningTag(e.name, attrs);
    for (const c of e.children) {
      if (typeof c === 'string') this.appendCharacters(c);
      else this.appendElement(c);
    }
    this.appendClosingTag(e.name);
  }
}
