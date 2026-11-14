// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/toxe.hxx faithful
// The enums of indexes: key types, index types, and the types and fields of a bibliography entry.

export const SwTOXSearch = {
  TOX_NXT: 0,
  TOX_PRV: 1,
  TOX_SAME_NXT: 2,
  TOX_SAME_PRV: 3,
} as const;
export type SwTOXSearch = (typeof SwTOXSearch)[keyof typeof SwTOXSearch];

export const SwTOIKeyType = {
  TOI_PRIMARY: 0,
  TOI_SECONDARY: 1,
} as const;
export type SwTOIKeyType = (typeof SwTOIKeyType)[keyof typeof SwTOIKeyType];

export const TOXTypes = {
  TOX_INDEX: 0,
  TOX_USER: 1,
  TOX_CONTENT: 2,
  TOX_ILLUSTRATIONS: 3,
  TOX_OBJECTS: 4,
  TOX_TABLES: 5,
  TOX_AUTHORITIES: 6,
  TOX_BIBLIOGRAPHY: 7,
  TOX_CITATION: 8,
} as const;
export type TOXTypes = (typeof TOXTypes)[keyof typeof TOXTypes];

/** this enum contains all types of sources */
export const ToxAuthorityType = {
  //BiBTeX - fields
  AUTH_TYPE_ARTICLE: 0,
  AUTH_TYPE_BOOK: 1,
  AUTH_TYPE_BOOKLET: 2,
  AUTH_TYPE_CONFERENCE: 3,
  AUTH_TYPE_INBOOK: 4,
  AUTH_TYPE_INCOLLECTION: 5,
  AUTH_TYPE_INPROCEEDINGS: 6,
  AUTH_TYPE_JOURNAL: 7,
  AUTH_TYPE_MANUAL: 8,
  AUTH_TYPE_MASTERSTHESIS: 9,
  AUTH_TYPE_MISC: 10,
  AUTH_TYPE_PHDTHESIS: 11,
  AUTH_TYPE_PROCEEDINGS: 12,
  AUTH_TYPE_TECHREPORT: 13,
  AUTH_TYPE_UNPUBLISHED: 14,
  //additional types
  AUTH_TYPE_EMAIL: 15,
  AUTH_TYPE_WWW: 16,
  AUTH_TYPE_CUSTOM1: 17,
  AUTH_TYPE_CUSTOM2: 18,
  AUTH_TYPE_CUSTOM3: 19,
  AUTH_TYPE_CUSTOM4: 20,
  AUTH_TYPE_CUSTOM5: 21,
  AUTH_TYPE_END: 22,
} as const;
export type ToxAuthorityType = (typeof ToxAuthorityType)[keyof typeof ToxAuthorityType];

/** this enum contains the fields of an authority entry */
export const ToxAuthorityField = {
  AUTH_FIELD_IDENTIFIER: 0,
  AUTH_FIELD_AUTHORITY_TYPE: 1, //ToxAuthorityType
  //BibTex types
  AUTH_FIELD_ADDRESS: 2,
  AUTH_FIELD_ANNOTE: 3,
  AUTH_FIELD_AUTHOR: 4,
  AUTH_FIELD_BOOKTITLE: 5,
  AUTH_FIELD_CHAPTER: 6,
  AUTH_FIELD_EDITION: 7,
  AUTH_FIELD_EDITOR: 8,
  AUTH_FIELD_HOWPUBLISHED: 9,
  AUTH_FIELD_INSTITUTION: 10,
  AUTH_FIELD_JOURNAL: 11,
  AUTH_FIELD_MONTH: 12,
  AUTH_FIELD_NOTE: 13,
  AUTH_FIELD_NUMBER: 14,
  AUTH_FIELD_ORGANIZATIONS: 15,
  AUTH_FIELD_PAGES: 16,
  AUTH_FIELD_PUBLISHER: 17,
  AUTH_FIELD_SCHOOL: 18,
  AUTH_FIELD_SERIES: 19,
  AUTH_FIELD_TITLE: 20,
  AUTH_FIELD_REPORT_TYPE: 21,
  AUTH_FIELD_VOLUME: 22,
  AUTH_FIELD_YEAR: 23,
  //additional types
  AUTH_FIELD_URL: 24,
  AUTH_FIELD_CUSTOM1: 25,
  AUTH_FIELD_CUSTOM2: 26,
  AUTH_FIELD_CUSTOM3: 27,
  AUTH_FIELD_CUSTOM4: 28,
  AUTH_FIELD_CUSTOM5: 29,
  AUTH_FIELD_ISBN: 30,
  AUTH_FIELD_LOCAL_URL: 31,
  AUTH_FIELD_TARGET_TYPE: 32,
  AUTH_FIELD_TARGET_URL: 33,
  AUTH_FIELD_END: 34,
} as const;
export type ToxAuthorityField = (typeof ToxAuthorityField)[keyof typeof ToxAuthorityField];
