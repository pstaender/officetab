// SPDX-License-Identifier: MPL-2.0
// @upstream scaddins/inc/datefunc.hrc faithful
// The en-US source strings of the DateFunctions add-in's functions (NC_ and its translation
// context dropped): per function the description, then the name and the description of each
// parameter.

export const DATE_FUNCDESC_DiffWeeks: readonly string[] = [
  'Calculates the number of weeks in a specific period',
  'Start date',
  'First day of the period',
  'End date',
  'Last day of the period',
  'Type',
  'Type of calculation: Type=0 means the time interval, Type=1 means calendar weeks.',
];

export const DATE_FUNCDESC_DiffMonths: readonly string[] = [
  'Determines the number of months in a specific period.',
  'Start date',
  'First day of the period.',
  'End date',
  'Last day of the period.',
  'Type',
  'Type of calculation: Type=0 means the time interval, Type=1 means calendar months.',
];

export const DATE_FUNCDESC_DiffYears: readonly string[] = [
  'Calculates the number of years in a specific period.',
  'Start date',
  'First day of the period',
  'End date',
  'Last day of the period',
  'Type',
  'Type of calculation: Type=0 means the time interval, Type=1 means calendar years.',
];

export const DATE_FUNCDESC_IsLeapYear: readonly string[] = [
  'Returns 1 (TRUE) if the date is a day of a leap year, otherwise 0 (FALSE).',
  'Date',
  'Any day in the desired year',
];

export const DATE_FUNCDESC_DaysInMonth: readonly string[] = [
  'Returns the number of days of the month in which the date entered occurs',
  'Date',
  'Any day in the desired month',
];

export const DATE_FUNCDESC_DaysInYear: readonly string[] = [
  'Returns the number of days of the year in which the date entered occurs.',
  'Date',
  'Any day in the desired year',
];

export const DATE_FUNCDESC_WeeksInYear: readonly string[] = [
  'Returns the number of weeks of the year in which the date entered occurs',
  'Date',
  'Any day in the desired year',
];

export const DATE_FUNCDESC_Rot13: readonly string[] = [
  'Encrypts or decrypts a text using the ROT13 algorithm',
  'Text',
  'Text to be encrypted or text already encrypted',
];
