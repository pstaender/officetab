// Icons this project draws for the commands Keyline Icons has none for, on Keyline's grid: 24×24,
// 2px round strokes, 3px corner radius. Each icon has
// - body and accent: the strokes (accent: the part that marks what the command does);
// - mark: shapes filled in 35% grey;
// - extra: SVG elements with their own stroke attributes (dashes, widths).
// Path data only; gen-icon-themes.ts assembles the SVG.

export interface OwnIcon { body?: string; accent?: string; mark?: string; extra?: string }

/** A rounded rectangle. */
const rr = (x1: number, y1: number, x2: number, y2: number, r = 3) =>
  `M${x1 + r} ${y1}H${x2 - r}A${r} ${r} 0 0 1 ${x2} ${y1 + r}V${y2 - r}A${r} ${r} 0 0 1 ${x2 - r} ${y2}H${x1 + r}A${r} ${r} 0 0 1 ${x1} ${y2 - r}V${y1 + r}A${r} ${r} 0 0 1 ${x1 + r} ${y1}Z`;

const TABLE = `${rr(3, 3, 21, 21)}M3 9H21M3 15H21M12 9V21`;
const PILCROW_SMALL = 'M10 3V12M14 3V12M16 3H9A3 3 0 0 0 9 9H10';
const OBJ = rr(8, 8, 16, 16, 2);

export const OWN: Record<string, OwnIcon> = {
  // ¶
  '.uno:ControlCodes': { body: 'M10 4V20M15 4V20M18 4H9.5A4.5 4.5 0 0 0 9.5 13H10' },
  '.uno:ParaLeftToRight': { body: PILCROW_SMALL, accent: 'M4 18H20M17 15L20 18L17 21' },
  '.uno:ParaRightToLeft': { body: PILCROW_SMALL, accent: 'M20 18H4M7 15L4 18L7 21' },
  // Two page halves and the break between them.
  '.uno:InsertPagebreak': {
    body: 'M5 3V7A2 2 0 0 0 7 9H17A2 2 0 0 0 19 7V3M5 21V17A2 2 0 0 1 7 15H17A2 2 0 0 1 19 17V21',
    accent: 'M2 12H4M7 12H9M11 12H13M15 12H17M20 12H22'
  },
  // Text with a reference mark, the separator and the note.
  '.uno:InsertFootnote': { body: 'M3 5H13M3 9H13M3 13H10M3 17H8M3 21H16', accent: 'M17 4.5L19 3V9' },
  // A page whose notes come at its end.
  '.uno:InsertEndnote': { body: `${rr(4, 2, 20, 22)}M8 6H16M8 10H16M8 14.5H11M8 18H16` },
  '.uno:SuperScript': { body: 'M4 9L12 19M12 9L4 19', accent: 'M15 6A2 2 0 1 1 19 6C19 7.5 15 9 15 11H19' },
  '.uno:SubScript': { body: 'M4 5L12 15M12 5L4 15', accent: 'M15 16A2 2 0 1 1 19 16C19 17.5 15 19 15 21H19' },
  '.uno:ParaspaceIncrease': { body: 'M11 6H21M11 12H21M11 18H21', accent: 'M6 3V21M3 6L6 3L9 6M3 18L6 21L9 18' },
  '.uno:ParaspaceDecrease': { body: 'M11 6H21M11 12H21M11 18H21', accent: 'M6 3V9M3 6L6 9L9 6M6 21V15M3 18L6 15L9 18' },
  '.uno:EntireCell': { body: TABLE, mark: 'M4 10H11V14H4Z' },
  '.uno:SplitTable': { body: `M6 3H18A3 3 0 0 1 21 6V10H3V6A3 3 0 0 1 6 3ZM12 3V10M3 14H21V18A3 3 0 0 1 18 21H6A3 3 0 0 1 3 18ZM12 14V21` },
  '.uno:OptimizeTable': { body: `${rr(3, 3, 21, 21)}M3 9H21`, accent: 'M7 15H17M9 13L7 15L9 17M15 13L17 15L15 17' },
  '.uno:SetBorderStyle': { body: rr(3, 3, 21, 21), extra: '<path stroke-dasharray="0 3" d="M12 6V18M6 12H18"/>' },
  '.uno:LineStyle': { extra: '<path stroke-width="1" d="M3 5H21"/><path d="M3 11H21"/><path stroke-width="3.5" d="M3 18H21"/>' },
  '.uno:FrameLineColor': { body: rr(4, 3, 20, 15, 2), accent: 'M3 20H21' },
  // 0.00
  '.uno:NumberFormatDecimal': {
    body: 'M10 6C8.34 6 7 8.69 7 12S8.34 18 10 18 13 15.31 13 12 11.66 6 10 6ZM18 6C16.34 6 15 8.69 15 12S16.34 18 18 18 21 15.31 21 12 19.66 6 18 6Z',
    extra: '<path stroke-width="3" d="M3.5 18V18"/>',
  },
  // 123
  '.uno:TableNumberFormatDialog': { body: 'M3 8L5 6V18M9 8A2 2 0 1 1 13 8C13 11 9 14 9 18H13M16 6H20L17 11A3.5 3.5 0 1 1 15.5 16.8' },
  // Text wrap: the object and the text lines around it.
  '.uno:WrapOff': { body: `M3 4H21M3 20H21${OBJ}` },
  '.uno:WrapOn': { body: `M3 4H21M3 20H21M3 10H5M3 14H5M19 10H21M19 14H21${OBJ}` },
  '.uno:WrapIdeal': { body: `M3 4H21M3 20H21M3 10H5M3 14H5M19 12H21${OBJ}`, accent: 'M19 7.5V10.5M17.5 9H20.5' },
  '.uno:WrapLeft': { body: `M3 4H21M3 20H21M3 10H10M3 14H10${rr(13, 8, 21, 16, 2)}` },
  '.uno:WrapRight': { body: `M3 4H21M3 20H21M14 10H21M14 14H21${rr(3, 8, 11, 16, 2)}` },
  '.uno:WrapThrough': { body: 'M3 4H21M3 10H21M3 14H21M3 20H21', extra: `<path stroke-dasharray="2 3" d="${rr(8, 7, 16, 17, 2)}"/>` },
  '.uno:TextWrap': { body: `M3 4H21M3 20H21M3 10H5M3 14H5M19 10H21M19 14H21${OBJ}` },
  // In front of the text: the lines stop at the object; behind it, they cross it.
  '.uno:SetObjectToForeground': { body: `M2 4H22M2 12H6M18 12H22M2 20H22${rr(7, 7, 17, 17, 2)}` },
  '.uno:SetObjectToBackground': { body: 'M2 4H22M2 12H22M2 20H22', extra: `<path stroke-dasharray="2 3" d="${rr(7, 7, 17, 17, 2)}"/>` },
  '.uno:Shadowed': { body: rr(3, 3, 16, 16, 2), accent: 'M19.5 7.5V17.5A2 2 0 0 1 17.5 19.5H7.5' },
  // "ab" with a wavy underline: spelling marked as you type.
  '.uno:SpellOnline': {
    body: 'M5 9C6.66 9 8 10.34 8 12S6.66 15 5 15 2 13.66 2 12 3.34 9 5 9ZM8 9V15M12 5V15M15 9C16.66 9 18 10.34 18 12S16.66 15 15 15 12 13.66 12 12 13.34 9 15 9Z',
    accent: 'M3 19.5C4.5 18 5.5 18 7 19.5S9.5 21 11 19.5 13.5 18 15 19.5 17.5 21 19 19.5',
  },
  '.uno:InsertPageCountField': { body: `${rr(4, 2, 20, 22)}M10.5 8L9.5 16M14.5 8L13.5 16M8 10.5H16.5M7.5 13.5H16` },
  '.uno:TitlePageDialog': { body: `${rr(4, 2, 20, 22)}M8 15H16M8 18H13${rr(7.5, 5.5, 16.5, 11, 1.5)}` },
  '.uno:InsertSection': { body: 'M4 4H20M4 20H20', extra: `<path stroke-dasharray="2 3" d="${rr(4, 8, 20, 16, 2)}"/>` },
  '.uno:Line': { body: 'M5 19L19 5' },
  // The red, green and blue channels: R, G, B.
  '.uno:GrafRed': { accent: 'M7 20V4H13A4 4 0 0 1 13 12H7M13 12L17 20' },
  '.uno:GrafGreen': { accent: 'M18 7.5A7 8 0 1 0 19 13H13' },
  '.uno:GrafBlue': { accent: 'M6 20V4H13A4 4 0 0 1 13 12M6 12H14A4 4 0 0 1 14 20H6' },
  // A checkerboard: transparency.
  '.uno:GrafTransparence': { body: rr(3, 3, 21, 21), mark: 'M6 6H12V12H6ZM12 12H18V18H12Z' },
};
