// SPDX-License-Identifier: MPL-2.0
// BufferedReader.readLine() over a whole input, for the LanguageTool ports: not a port. A line
// ends at \n, \r or \r\n; a final line terminator does not start another (empty) line. Bytes
// are decoded as InputStreamReader(is, "UTF-8") does: malformed input becomes U+FFFD and a
// byte order mark is kept as U+FEFF.

/** The lines BufferedReader.readLine() returns for the input (UTF-8 bytes or decoded text). */
export function BufferedReader_readLines(input: Uint8Array | string): string[] {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { ignoreBOM: true }).decode(input);
  if (text.length === 0) return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (/[\r\n]$/.test(text)) lines.pop();
  return lines;
}
