// SPDX-License-Identifier: MPL-2.0
// @upstream sw/inc/frmfmt.hxx reduced
// @upstream sw/inc/fmtanchr.hxx reduced
// @upstream sw/inc/fmtornt.hxx reduced
// @upstream sw/inc/fmtsrnd.hxx reduced
// @upstream sw/inc/fmtfsize.hxx reduced
// @upstream include/svx/swframetypes.hxx reduced
// A fly frame format (SwFlyFrameFormat with its SwFormatAnchor, orientation, size and surround items)
// is plain data here, replaced as a whole on every change so that undo snapshots can share it.
// The content anchor is not an SwPosition held by the format: paragraph and character anchored
// formats are listed by their anchor paragraph (SwNode::m_aAnchoredFlys) with a content offset;
// page anchored ones by the document. Contour wrap, anchoring at frames, and "anchor only" wrap
// are not ported.
import type { SvxParaBox, SwFlyCnt } from './hintids.ts';

/** RndStdIds: the values of css::text::TextContentAnchorType. */
export const RndStdIds = { FLY_AT_PARA: 0, FLY_AS_CHAR: 1, FLY_AT_PAGE: 2, FLY_AT_FLY: 3, FLY_AT_CHAR: 4 } as const;
export type RndStdIds = (typeof RndStdIds)[keyof typeof RndStdIds];

/** css::text::HoriOrientation */
export const HoriOrientation = { NONE: 0, RIGHT: 1, CENTER: 2, LEFT: 3, INSIDE: 4, OUTSIDE: 5, FULL: 6, LEFT_AND_WIDTH: 7 } as const;
/** css::text::VertOrientation */
export const VertOrientation = { NONE: 0, TOP: 1, CENTER: 2, BOTTOM: 3, CHAR_TOP: 4, CHAR_CENTER: 5, CHAR_BOTTOM: 6, LINE_TOP: 7, LINE_CENTER: 8, LINE_BOTTOM: 9 } as const;
/** css::text::RelOrientation */
export const RelOrientation = {
  FRAME: 0, PRINT_AREA: 1, CHAR: 2, PAGE_LEFT: 3, PAGE_RIGHT: 4, FRAME_LEFT: 5, FRAME_RIGHT: 6,
  PAGE_FRAME: 7, PAGE_PRINT_AREA: 8, TEXT_LINE: 9, PAGE_PRINT_AREA_BOTTOM: 10, PAGE_PRINT_AREA_TOP: 11,
} as const;
/** css::text::WrapTextMode */
export const WrapTextMode = { NONE: 0, THROUGH: 1, PARALLEL: 2, DYNAMIC: 3, LEFT: 4, RIGHT: 5 } as const;
export type WrapTextMode = (typeof WrapTextMode)[keyof typeof WrapTextMode];

export interface SwFormatAnchor { m_eAnchorId: RndStdIds; m_nPageNumber: number }
/** SwFormatHoriOrient and SwFormatVertOrient: m_nPos is the offset for orientation NONE. */
export interface SwFormatOrient { m_eOrient: number; m_eRelation: number; m_nPos: number }
export interface SwFormatSurround { m_eSurround: WrapTextMode }

/**
 * SwFlyFrameFormat of a graphic (SwGrfNode content, by its key in the graphic store) or of a
 * text frame (SwFlyStartNode section, by `m_sContentId`).
 */
export interface SwFlyFrameFormat {
  m_aName: string;
  graphic?: string;
  alt?: string;
  /** Text frames: the id of the section in the autotext area holding the frame's paragraphs. */
  m_sContentId?: string;
  /** SwFormatFrameSize; for text frames a minimum height when m_bAutoHeight. */
  m_nWidth: number;
  m_nHeight: number;
  m_bAutoHeight?: boolean;
  /** Text frames: the width follows the content, up to m_nWidth or the area (SwFormatFrameSize's ATT_MIN_SIZE width). */
  m_bAutoWidth?: boolean;
  m_aAnchor: SwFormatAnchor;
  m_aHoriOrient: SwFormatOrient;
  m_aVertOrient: SwFormatOrient;
  m_aSurround: SwFormatSurround;
  /** SvxLRSpaceItem and SvxULSpaceItem of a fly: the spacing kept free around it for wrapping. */
  m_nLeftSpace: number;
  m_nRightSpace: number;
  m_nUpperSpace: number;
  m_nLowerSpace: number;
  /** SvxOpaqueItem: false paints the object behind the text ("In Background"). */
  m_bOpaque: boolean;
  /** Drawing order among the flys of a page (SdrObject::GetOrdNum); higher is in front. */
  m_nZOrder?: number;
  /** Text frames: borders and their distance to the content, and the background colour. */
  m_aBox?: SvxParaBox | null;
  m_aBackground?: string | null;
}

/** A paragraph or character anchored fly on its anchor paragraph (SwNode::m_aAnchoredFlys). */
export interface SwAnchoredFly { fmt: SwFlyFrameFormat; nContent: number }

/** RES_POOLFRM_GRAPHIC with the default "anchor to character" of Tools > Options. */
export function GraphicFlyFormat(name: string, graphic: string, width: number, height: number): SwFlyFrameFormat {
  return {
    m_aName: name, graphic, m_nWidth: width, m_nHeight: height,
    m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AT_CHAR, m_nPageNumber: 0 },
    m_aHoriOrient: { m_eOrient: HoriOrientation.CENTER, m_eRelation: RelOrientation.FRAME, m_nPos: 0 },
    m_aVertOrient: { m_eOrient: VertOrientation.TOP, m_eRelation: RelOrientation.FRAME, m_nPos: 0 },
    m_aSurround: { m_eSurround: WrapTextMode.DYNAMIC },
    m_nLeftSpace: 0, m_nRightSpace: 0, m_nUpperSpace: 0, m_nLowerSpace: 0, m_bOpaque: true,
  };
}

/** RES_POOLFRM_FRAME: paragraph anchored, centred, parallel wrap, hairline border, 0.15 cm distance. */
export function TextFlyFormat(name: string, contentId: string, width: number, height: number): SwFlyFrameFormat {
  const line = { color: '#000000', width: 2 };
  return {
    m_aName: name, m_sContentId: contentId, m_nWidth: width, m_nHeight: height, m_bAutoHeight: true,
    m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AT_PARA, m_nPageNumber: 0 },
    m_aHoriOrient: { m_eOrient: HoriOrientation.CENTER, m_eRelation: RelOrientation.PRINT_AREA, m_nPos: 0 },
    m_aVertOrient: { m_eOrient: VertOrientation.TOP, m_eRelation: RelOrientation.PRINT_AREA, m_nPos: 0 },
    m_aSurround: { m_eSurround: WrapTextMode.PARALLEL },
    m_nLeftSpace: 0, m_nRightSpace: 0, m_nUpperSpace: 0, m_nLowerSpace: 0, m_bOpaque: true,
    m_aBox: { top: line, bottom: { ...line }, left: { ...line }, right: { ...line }, padding: 85 }, m_aBackground: null,
  };
}

/** The format an as-character graphic has (its SwFlyCnt carries only size and graphic). */
export function AsCharFormat(f: SwFlyCnt): SwFlyFrameFormat {
  return {
    ...GraphicFlyFormat(f.name, f.graphic, f.width, f.height), alt: f.alt,
    m_aAnchor: { m_eAnchorId: RndStdIds.FLY_AS_CHAR, m_nPageNumber: 0 },
    m_aVertOrient: { m_eOrient: VertOrientation.TOP, m_eRelation: RelOrientation.FRAME, m_nPos: 0 },
    m_aSurround: { m_eSurround: WrapTextMode.NONE },
  };
}
