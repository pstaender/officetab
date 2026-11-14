// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/ToneTag.java faithful
// REAL_TONE_TAGS is exported next to the enum object (ToneTag_REAL_TONE_TAGS).

export const ToneTag = {
  clarity: 'clarity', formal: 'formal', professional: 'professional', confident: 'confident', academic: 'academic',
  povrem: 'povrem', scientific: 'scientific', objective: 'objective', persuasive: 'persuasive', informal: 'informal',
  povadd: 'povadd', positive: 'positive', general: 'general',
  NO_TONE_RULE: 'NO_TONE_RULE', ALL_TONE_RULES: 'ALL_TONE_RULES', ALL_WITHOUT_GOAL_SPECIFIC: 'ALL_WITHOUT_GOAL_SPECIFIC',
} as const;
export type ToneTag = typeof ToneTag[keyof typeof ToneTag];

export const ToneTag_REAL_TONE_TAGS: readonly ToneTag[] = Object.values(ToneTag)
  .filter((toneTag) => toneTag !== ToneTag.NO_TONE_RULE && toneTag !== ToneTag.ALL_TONE_RULES && toneTag !== ToneTag.ALL_WITHOUT_GOAL_SPECIFIC);

/** ToneTag.valueOf */
export function ToneTag_valueOf(name: string): ToneTag {
  if (!Object.prototype.hasOwnProperty.call(ToneTag, name)) throw new Error('IllegalArgumentException: No enum constant org.languagetool.ToneTag.' + name);
  return ToneTag[name as keyof typeof ToneTag];
}
