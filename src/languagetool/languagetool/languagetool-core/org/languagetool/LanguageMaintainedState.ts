// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/LanguageMaintainedState.java faithful

/**
 * Information about whether a language in LanguageTool is actively maintained.
 * @since 3.3
 */
export const LanguageMaintainedState = {
  ActivelyMaintained: 'ActivelyMaintained',
  LookingForNewMaintainer: 'LookingForNewMaintainer',
} as const;
export type LanguageMaintainedState = typeof LanguageMaintainedState[keyof typeof LanguageMaintainedState];
