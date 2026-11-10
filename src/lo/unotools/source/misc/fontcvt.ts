// SPDX-License-Identifier: MPL-2.0
// @upstream unotools/source/misc/fontcvt.cxx reduced
// ConvertChar::RecodeChar for bullets of symbol fonts (Symbol, Wingdings): Word and ODF store them
// as private use characters U+F020..U+F0FF. Upstream recodes them to OpenSymbol's code points,
// which only that font shows; here the common bullets become ordinary Unicode characters instead,
// and other symbol characters are kept as they are.

const BULLET_GLYPHS: Record<string, string> = {
  '': '•', '': '▪', '': '➢', '': '❖', '': '✓', '': '■',
  '': '□', '': '❑', '': '○', '': '➔', '': '–',
};

/** The Unicode character for a bullet given in a symbol font, or the text unchanged. */
export function RecodeBullet(c: string): string {
  return BULLET_GLYPHS[c] ?? (c === 'o' ? '◦' : c);
}
