// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/Tag.java faithful

export const Tag = {
  // use all-lowercase, as im XML:
  picky: 'picky', academic: 'academic', clarity: 'clarity', professional: 'professional', creative: 'creative',
  customer: 'customer', jobapp: 'jobapp', objective: 'objective', elegant: 'elegant',
} as const;
export type Tag = typeof Tag[keyof typeof Tag];

/** Tag.valueOf */
export function Tag_valueOf(name: string): Tag {
  if (!Object.prototype.hasOwnProperty.call(Tag, name)) throw new Error('IllegalArgumentException: No enum constant org.languagetool.Tag.' + name);
  return Tag[name as keyof typeof Tag];
}
