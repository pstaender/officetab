// SPDX-License-Identifier: MPL-2.0
// @upstream svx/source/dialog/grfflt.cxx reduced
// @upstream cui/source/dialogs/cuigrfflt.cxx reduced
// @upstream cui/source/factory/dlgfact.cxx reduced
// SvxGraphicFilter::ExecuteGrfFilterSlot and the GetFilteredGraphic of the cui filter dialogs, on
// an RGBA buffer, keyed by the menu commands' .uno: names. The dialogs themselves (preview window,
// timer, the light source RectCtl) are left to the caller: GrfFilterTable describes each dialog's
// controls as in its .ui file, with the defaults the dialog factory (dlgfact.cxx) passes and the
// ranges the dialog constructors set, and ExecuteGrfFilter turns the control values into filter
// arguments as GetFilteredGraphic does (with the scale 1.0 that handleGraphicFilterDialog uses).
// Animated graphics, the wait cursor and DisableGraphicFilterSlots are not ported.
import { CopyBitmap, BitmapFilter, type BitmapBuffer } from '../../../vcl/source/bitmap/bitmapfilter.ts';
import { getPixelFormat, pixelFormatBitCount } from '../../../vcl/source/bitmap/bitmap.ts';
import { Invert } from '../../../vcl/source/bitmap/bitmappaint.ts';
import { BitmapSmoothenFilter } from '../../../vcl/source/bitmap/BitmapSmoothenFilter.ts';
import { BitmapSharpenFilter } from '../../../vcl/source/bitmap/BitmapConvolutionMatrixFilter.ts';
import { BitmapMedianFilter } from '../../../vcl/source/bitmap/BitmapMedianFilter.ts';
import { BitmapSobelGreyFilter } from '../../../vcl/source/bitmap/BitmapSobelGreyFilter.ts';
import { BitmapMosaicFilter } from '../../../vcl/source/bitmap/BitmapMosaicFilter.ts';
import { BitmapEmbossGreyFilter } from '../../../vcl/source/bitmap/BitmapEmbossGreyFilter.ts';
import { BitmapColorQuantizationFilter } from '../../../vcl/source/bitmap/BitmapColorQuantizationFilter.ts';
import { BitmapPopArtFilter } from '../../../vcl/source/bitmap/BitmapPopArtFilter.ts';
import { BitmapSepiaFilter } from '../../../vcl/source/bitmap/BitmapSepiaFilter.ts';
import { BitmapSolarizeFilter } from '../../../vcl/source/bitmap/BitmapSolarizeFilter.ts';

export type GrfFilterParamValue = number | boolean | string;

/** One control of a filter dialog, as in its .ui file. */
export interface GrfFilterParam {
  /** The control's id in the .ui file. */
  name: string;
  /** The label as in the .ui file, with its mnemonic underscore. */
  label: string;
  /** The label's translation context in the .ui file. */
  context: string;
  type: 'number' | 'boolean' | 'choice';
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places of a spin button. */
  digits?: number;
  /** The unit of a metric spin button. */
  unit?: 'pixel' | 'percent';
  /** The values of a choice and their labels with translation contexts. */
  choices?: { value: string; label: string; context: string }[];
  default: GrfFilterParamValue;
}

export interface GrfFilterDialog {
  /** The .ui file and its dialog id. */
  ui: string;
  id: string;
  title: string;
  context: string;
}

export interface GrfFilterEntry {
  /** The slot of the command in svx.sdi. */
  slot: string;
  dialog: GrfFilterDialog | null;
  params: GrfFilterParam[];
}

/** RectPoint (include/svx/rectenum.hxx) with the RectCtl's accessible names (svx/inc/strings.hrc). */
const aRectPoints: { value: string; label: string; context: string }[] = [
  { value: 'LT', label: 'Top left', context: 'RID_SVXSTR_RECTCTL_ACC_CHLD_LT' },
  { value: 'MT', label: 'Top middle', context: 'RID_SVXSTR_RECTCTL_ACC_CHLD_MT' },
  { value: 'RT', label: 'Top right', context: 'RID_SVXSTR_RECTCTL_ACC_CHLD_RT' },
  { value: 'LM', label: 'Left center', context: 'RID_SVXSTR_RECTCTL_ACC_CHLD_LM' },
  { value: 'MM', label: 'Center', context: 'RID_SVXSTR_RECTCTL_ACC_CHLD_MM' },
  { value: 'RM', label: 'Right center', context: 'RID_SVXSTR_RECTCTL_ACC_CHLD_RM' },
  { value: 'LB', label: 'Bottom left', context: 'RID_SVXSTR_RECTCTL_ACC_CHLD_LB' },
  { value: 'MB', label: 'Bottom middle', context: 'RID_SVXSTR_RECTCTL_ACC_CHLD_MB' },
  { value: 'RB', label: 'Bottom right', context: 'RID_SVXSTR_RECTCTL_ACC_CHLD_RB' },
];

export const GrfFilterTable: Record<string, GrfFilterEntry> = {
  '.uno:GraphicFilterInvert': { slot: 'SID_GRFFILTER_INVERT', dialog: null, params: [] },
  '.uno:GraphicFilterSmooth': {
    slot: 'SID_GRFFILTER_SMOOTH',
    dialog: { ui: 'cui/ui/smoothdialog.ui', id: 'SmoothDialog', title: 'Smooth', context: 'smoothdialog|SmoothDialog' },
    params: [
      // CreateGraphicFilterSmooth(pFrameWeld, aInputGraphic, 0.7) in grfflt.cxx
      { name: 'radius', label: '_Smooth radius:', context: 'smoothdialog|label2', type: 'number',
        min: 0.1, max: 100, step: 1, digits: 1, default: 0.7 },
    ],
  },
  '.uno:GraphicFilterSharpen': { slot: 'SID_GRFFILTER_SHARPEN', dialog: null, params: [] },
  '.uno:GraphicFilterRemoveNoise': { slot: 'SID_GRFFILTER_REMOVENOISE', dialog: null, params: [] },
  '.uno:GraphicFilterSobel': { slot: 'SID_GRFFILTER_SOBEL', dialog: null, params: [] },
  '.uno:GraphicFilterMosaic': {
    slot: 'SID_GRFFILTER_MOSAIC',
    dialog: { ui: 'cui/ui/mosaicdialog.ui', id: 'MosaicDialog', title: 'Mosaic', context: 'mosaicdialog|MosaicDialog' },
    params: [
      // the maximum is the graphic's width and height (see GetGrfFilterParams)
      { name: 'width', label: '_Width:', context: 'mosaicdialog|label2', type: 'number',
        min: 1, max: 999, step: 1, unit: 'pixel', default: 4 },
      { name: 'height', label: '_Height:', context: 'mosaicdialog|label3', type: 'number',
        min: 1, max: 999, step: 1, unit: 'pixel', default: 4 },
      { name: 'edges', label: 'E_nhance edges', context: 'mosaicdialog|edges', type: 'boolean', default: false },
    ],
  },
  '.uno:GraphicFilterRelief': {
    slot: 'SID_GRFFILTER_EMBOSS',
    dialog: { ui: 'cui/ui/embossdialog.ui', id: 'EmbossDialog', title: 'Emboss', context: 'embossdialog|EmbossDialog' },
    params: [
      { name: 'lightsource', label: '_Light source:', context: 'embossdialog|label2', type: 'choice',
        choices: aRectPoints, default: 'MM' },
    ],
  },
  '.uno:GraphicFilterPoster': {
    slot: 'SID_GRFFILTER_POSTER',
    dialog: { ui: 'cui/ui/posterdialog.ui', id: 'PosterDialog', title: 'Posterize', context: 'posterdialog|PosterDialog' },
    params: [
      // the maximum is the bit count of the graphic's pixel format (see GetGrfFilterParams)
      { name: 'value', label: 'Poster colors:', context: 'posterdialog|label2', type: 'number',
        min: 2, max: 64, step: 1, default: 16 },
    ],
  },
  '.uno:GraphicFilterPopart': { slot: 'SID_GRFFILTER_POPART', dialog: null, params: [] },
  '.uno:GraphicFilterSepia': {
    slot: 'SID_GRFFILTER_SEPIA',
    dialog: { ui: 'cui/ui/agingdialog.ui', id: 'AgingDialog', title: 'Aging', context: 'agingdialog|AgingDialog' },
    params: [
      { name: 'value', label: 'Aging degree:', context: 'agingdialog|label2', type: 'number',
        min: 1, max: 100, step: 1, unit: 'percent', default: 10 },
    ],
  },
  '.uno:GraphicFilterSolarize': {
    slot: 'SID_GRFFILTER_SOLARIZE',
    dialog: { ui: 'cui/ui/solarizedialog.ui', id: 'SolarizeDialog', title: 'Solarization', context: 'solarizedialog|SolarizeDialog' },
    params: [
      // GraphicFilterSolarize sets basegfx::fround(cGreyThreshold / 2.55) for the factory's 128
      { name: 'value', label: 'Threshold _value:', context: 'solarizedialog|label2', type: 'number',
        min: 0, max: 100, step: 1, unit: 'percent', default: fround(128 / 2.55) },
      { name: 'invert', label: '_Invert', context: 'solarizedialog|invert', type: 'boolean', default: false },
    ],
  },
};

/** The dialog's controls for this graphic: the ranges the dialog constructors set from it
    (GraphicFilterMosaic: the graphic's size, GraphicFilterPoster: its bit count). */
export function GetGrfFilterParams(command: string, bmp?: BitmapBuffer): GrfFilterParam[] {
  const pEntry = GrfFilterTable[command];
  if (!pEntry) return [];
  return pEntry.params.map((p) => {
    if (!bmp) return { ...p };
    if (command === '.uno:GraphicFilterMosaic' && p.name === 'width') return { ...p, max: bmp.width };
    if (command === '.uno:GraphicFilterMosaic' && p.name === 'height') return { ...p, max: bmp.height };
    if (command === '.uno:GraphicFilterPoster') return { ...p, max: pixelFormatBitCount(getPixelFormat(bmp)) };
    return { ...p };
  });
}

/** basegfx::fround (to sal_Int32 / sal_uInt8 for values in range) */
function fround(fVal: number): number {
  return fVal >= 0 ? Math.trunc(fVal + 0.5) : Math.trunc(fVal - 0.5);
}

/** The value of a control as the weld spin button holds it: clamped to its range and rounded to
    its digits. */
function GetValue(aParams: GrfFilterParam[], params: Record<string, GrfFilterParamValue>, name: string): GrfFilterParamValue {
  const p = aParams.find((q) => q.name === name)!;
  const v = params[name] ?? p.default;
  if (p.type === 'number') {
    let n = typeof v === 'number' && Number.isFinite(v) ? v : Number(p.default);
    const nFactor = 10 ** (p.digits ?? 0);
    n = Math.round(n * nFactor) / nFactor;
    if (p.min !== undefined) n = Math.max(n, p.min);
    if (p.max !== undefined) n = Math.min(n, p.max);
    return n;
  }
  if (p.type === 'boolean') return typeof v === 'boolean' ? v : Boolean(p.default);
  return typeof v === 'string' && p.choices!.some((c) => c.value === v) ? v : p.default;
}

/** Runs the filter of a .uno:GraphicFilter* command on a copy of the bitmap and returns it, or
    null when the filter fails or the command is not a graphic filter. Dialog commands take the
    values of their controls (GrfFilterTable) in params; missing values are the defaults. */
export function ExecuteGrfFilter(command: string, bmp: BitmapBuffer,
  params: Record<string, GrfFilterParamValue> = {}): BitmapBuffer | null {
  const pEntry = GrfFilterTable[command];
  if (!pEntry) return null;
  if (!bmp.width || !bmp.height) return null;

  const aParams = GetGrfFilterParams(command, bmp);
  const aBmp = CopyBitmap(bmp);

  switch (pEntry.slot) {
    case 'SID_GRFFILTER_INVERT':
      if (Invert(aBmp)) return aBmp;
      return null;

    case 'SID_GRFFILTER_SMOOTH': {
      // GraphicFilterSmooth::GetFilteredGraphic: mxMtrRadius->get_value() / 10.0 with 1 digit
      const nRadius = GetValue(aParams, params, 'radius') as number;
      if (BitmapFilter.Filter(aBmp, new BitmapSmoothenFilter(nRadius))) return aBmp;
      return null;
    }

    case 'SID_GRFFILTER_SHARPEN':
      if (BitmapFilter.Filter(aBmp, new BitmapSharpenFilter())) return aBmp;
      return null;

    case 'SID_GRFFILTER_REMOVENOISE':
      if (BitmapFilter.Filter(aBmp, new BitmapMedianFilter())) return aBmp;
      return null;

    case 'SID_GRFFILTER_SOBEL':
      if (BitmapFilter.Filter(aBmp, new BitmapSobelGreyFilter())) return aBmp;
      return null;

    case 'SID_GRFFILTER_MOSAIC': {
      // GraphicFilterMosaic::GetFilteredGraphic
      const nTileWidth = GetValue(aParams, params, 'width') as number;
      const nTileHeight = GetValue(aParams, params, 'height') as number;
      const fScaleX = 1.0, fScaleY = 1.0;
      const aSize = {
        width: Math.max(fround(nTileWidth * fScaleX), 1),
        height: Math.max(fround(nTileHeight * fScaleY), 1),
      };

      if (BitmapFilter.Filter(aBmp, new BitmapMosaicFilter(aSize.width, aSize.height))) {
        if (GetValue(aParams, params, 'edges')) BitmapFilter.Filter(aBmp, new BitmapSharpenFilter());
        return aBmp;
      }
      return null;
    }

    case 'SID_GRFFILTER_EMBOSS': {
      // GraphicFilterEmboss::GetFilteredGraphic
      let nAzim: number, nElev: number;

      switch (GetValue(aParams, params, 'lightsource')) {
        default: // unknown Reference Point: falls through to LT
        case 'LT': nAzim = 4500; nElev = 4500; break;
        case 'MT': nAzim = 9000; nElev = 4500; break;
        case 'RT': nAzim = 13500; nElev = 4500; break;
        case 'LM': nAzim = 0; nElev = 4500; break;
        case 'MM': nAzim = 0; nElev = 9000; break;
        case 'RM': nAzim = 18000; nElev = 4500; break;
        case 'LB': nAzim = 31500; nElev = 4500; break;
        case 'MB': nAzim = 27000; nElev = 4500; break;
        case 'RB': nAzim = 22500; nElev = 4500; break;
      }

      if (BitmapFilter.Filter(aBmp, new BitmapEmbossGreyFilter(nAzim, nElev))) return aBmp;
      return null;
    }

    case 'SID_GRFFILTER_POSTER': {
      // GraphicFilterPoster::GetFilteredGraphic
      const nPosterCount = (GetValue(aParams, params, 'value') as number) & 0xffff;
      if (BitmapFilter.Filter(aBmp, new BitmapColorQuantizationFilter(nPosterCount))) return aBmp;
      return null;
    }

    case 'SID_GRFFILTER_POPART':
      if (BitmapFilter.Filter(aBmp, new BitmapPopArtFilter())) return aBmp;
      return null;

    case 'SID_GRFFILTER_SEPIA': {
      // GraphicFilterSepia::GetFilteredGraphic
      const nSepiaPct = Math.trunc(GetValue(aParams, params, 'value') as number) & 0xffff;
      if (BitmapFilter.Filter(aBmp, new BitmapSepiaFilter(nSepiaPct))) return aBmp;
      return null;
    }

    case 'SID_GRFFILTER_SOLARIZE': {
      // GraphicFilterSolarize::GetFilteredGraphic
      const nGreyThreshold = Math.min(fround((GetValue(aParams, params, 'value') as number) * 2.55), 255);
      if (BitmapFilter.Filter(aBmp, new BitmapSolarizeFilter(nGreyThreshold))) {
        if (GetValue(aParams, params, 'invert')) Invert(aBmp);
        return aBmp;
      }
      return null;
    }
  }
  return null;
}
