// SPDX-License-Identifier: MPL-2.0
// java.math.RoundingMode for the LanguageTool ports: not a port, the constants they use.

export const RoundingMode = {
  UP: 'UP', DOWN: 'DOWN', CEILING: 'CEILING', FLOOR: 'FLOOR',
  HALF_UP: 'HALF_UP', HALF_DOWN: 'HALF_DOWN', HALF_EVEN: 'HALF_EVEN', UNNECESSARY: 'UNNECESSARY',
} as const;
export type RoundingMode = typeof RoundingMode[keyof typeof RoundingMode];
