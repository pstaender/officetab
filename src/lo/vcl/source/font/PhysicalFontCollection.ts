// SPDX-License-Identifier: MPL-2.0
// @upstream vcl/source/font/PhysicalFontCollection.cxx partial
// The metric-compatible replacement fonts LibreOffice bundles and prefers over a system's generic
// substitutions (aMetricCompatibleMap, FindMetricCompatibleFont_impl).

export const aMetricCompatibleMap: readonly (readonly [string, string])[] = [
  ['Times New Roman', 'Liberation Serif'],
  ['Arial', 'Liberation Sans'],
  ['Arial Narrow', 'Liberation Sans Narrow'],
  ['Courier New', 'Liberation Mono'],
  ['Cambria', 'Caladea'],
  ['Calibri', 'Carlito'],

  // Official replacements for Bundes* fonts. https://github.com/google/fonts/issues/9720
  // prevents from using Carlito as direct metric-compatible replacement.
  ['BundesSans', 'Calibri'],
  ['BundesSans Office', 'Calibri'],
  ['BundesSans Regular', 'Calibri'],
  ['BundesSerif', 'Cambria'],
  ['BundesSerif Office', 'Cambria'],
  ['BundesSerif Regular', 'Cambria'],
];

/** GetEnglishSearchFontName, reduced: lower case without spaces. */
export const GetEnglishSearchFontName = (name: string): string => name.toLowerCase().replace(/[\s-]/g, '');

/** FindMetricCompatibleFont_impl: the metric-compatible replacement of a font, if any. */
export function FindMetricCompatibleFont(name: string): string | undefined {
  const search = GetEnglishSearchFontName(name);
  return aMetricCompatibleMap.find(([font]) => GetEnglishSearchFontName(font) === search)?.[1];
}
