// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/ndtyp.hxx faithful

export const SwNodeType = {
  NONE: 0x00,
  End: 0x01,
  Start: 0x02,
  Table: 0x04 | 0x02,
  Text: 0x08,
  Grf: 0x10,
  Ole: 0x20,
  Section: 0x40 | 0x02,
  PlaceHolder: 0x80,
  NoTextMask: 0x10 | 0x20,
  ContentMask: 0x08 | 0x10 | 0x20,
} as const;
export type SwNodeType = (typeof SwNodeType)[keyof typeof SwNodeType];

/** Types of StartNodes that may exist, as well as normal ones for Section. */
export const SwStartNodeType = {
  SwNormalStartNode: 0,
  SwTableBoxStartNode: 1,
  SwFlyStartNode: 2,
  SwFootnoteStartNode: 3,
  SwHeaderStartNode: 4,
  SwFooterStartNode: 5,
} as const;
export type SwStartNodeType = (typeof SwStartNodeType)[keyof typeof SwStartNodeType];
