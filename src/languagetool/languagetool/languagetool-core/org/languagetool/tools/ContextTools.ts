// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tools/ContextTools.java faithful
import { StringTools } from './StringTools.ts';

/**
 * Helper class to mark errors in text.
 */
export class ContextTools {

  private contextSize = 40;
  private escapeHtml = true;
  private errorMarkerStart = '<b><font bgcolor="#ff8b8b">';
  private errorMarkerEnd = '</font></b>';

  constructor() {
  }

  getContext(fromPos: number, toPos: number, contents: string): string {
    // calculate context region:
    let startContent = fromPos - this.contextSize;
    let prefix = '...';
    let postfix = '...';
    if (startContent < 0) {
      prefix = '';
      startContent = 0;
    }
    let endContent = toPos + this.contextSize;
    const textLength = contents.length;
    if (endContent > textLength) {
      postfix = '';
      endContent = textLength;
    }
    // now build context string plus marker:
    let sb = '';
    sb += prefix;
    sb += contents.substring(startContent, endContent).replaceAll('\n', ' ');
    const markerStr = ContextTools.getMarker(fromPos, toPos, startContent, endContent, prefix);
    sb += postfix;
    const startMark = markerStr.indexOf('^');
    const endMark = markerStr.lastIndexOf('^');
    let result = sb;
    if (this.escapeHtml) {
      const escapedErrorPart = StringTools.escapeHTML(result.substring(startMark, endMark + 1))
              .replaceAll(' ', '&nbsp;');   // make sure whitespace errors are visible
      result = StringTools.escapeHTML(result.substring(0, startMark))
          + this.errorMarkerStart
          + escapedErrorPart
          + this.errorMarkerEnd + StringTools.escapeHTML(result.substring(endMark + 1));
    } else {
      result = result.substring(0, startMark) + this.errorMarkerStart
          + result.substring(startMark, endMark + 1) + this.errorMarkerEnd
          + result.substring(endMark + 1);
    }
    return result;
  }

  /**
   * Get a plain text context that uses {@code ^} characters in a new line as a marker of the
   * given string region. Ignores {@link #setEscapeHtml(boolean)}.
   * @since 2.3
   */
  getPlainTextContext(fromPos: number, toPos: number, contents: string): string {
    // calculate context region:
    let startContent = fromPos - this.contextSize;
    let prefix = '...';
    let postfix = '...';
    if (startContent < 0) {
      prefix = '';
      startContent = 0;
    }
    let endContent = toPos + this.contextSize;
    if (endContent > contents.length) {
      postfix = '';
      endContent = contents.length;
    }
    return prefix +
           contents.substring(startContent, endContent).replaceAll('\n', ' ').replaceAll('\r', ' ').replaceAll('\t', ' ') +
           postfix + '\n' +
           ContextTools.getMarker(fromPos, toPos, startContent, endContent, prefix);
  }

  /**
   * Set the string used to mark the beginning and end of an error, e.g. {@code <span class="error">} and {@code </span>}
   * @since 5.1
   */
  setErrorMarker(start: string, end: string): void {
    this.errorMarkerStart = start;
    this.errorMarkerEnd = end;
  }

  /**
   * Set the string used to mark the beginning of an error, e.g. {@code <span class="error">}
   */
  setErrorMarkerStart(errorMarkerStart: string): void {
    this.errorMarkerStart = errorMarkerStart;
  }

  /**
   * Set the string used to mark the end of an error, e.g. {@code </span>}
   */
  setErrorMarkerEnd(errorMarkerEnd: string): void {
    this.errorMarkerEnd = errorMarkerEnd;
  }

  /**
   * The context size of the error. This many characters of the original text will be used
   * from the left and from the right context of the error.
   */
  setContextSize(contextSize: number): void {
    this.contextSize = contextSize;
  }

  /**
   * Whether HTML special characters should be escaped.
   */
  setEscapeHtml(escapeHtml: boolean): void {
    this.escapeHtml = escapeHtml;
  }

  private static getMarker(fromPos: number, toPos: number, startContent: number, endContent: number, prefix: string): string {
    // StringUtils.repeat returns "" for a negative count
    return ' '.repeat(Math.max(0, prefix.length + fromPos - startContent)) +
           '^'.repeat(Math.max(0, toPos - fromPos)) +
           ' '.repeat(Math.max(0, endContent - toPos));
  }
}
