// SPDX-License-Identifier: MPL-2.0
// @upstream svx/source/customshapes/EnhancedCustomShapeGeometry.cxx reduced
// @upstream oox/source/drawingml/customshapes/oox-drawingml-cs-presets reduced
// GetCustomShapeContent with SdrObjCustomShape::MergeDefaultAttributes already applied: the preset
// geometry of LibreOffice's own shape types and of the OOXML presets, generated from upstream by
// tools/upstream/gen-shapes.ts. Handles and glue points are not included.
import type { CustomShapeGeometry } from './EnhancedCustomShape2d.ts';
import odf from './generated/EnhancedCustomShapeGeometry.json';
import ooxml from './generated/oox-presets.json';
import toOoxml from './generated/odf-to-ooxml.json';

const PRESETS = { ...(odf as unknown as Record<string, CustomShapeGeometry>), ...(ooxml as unknown as Record<string, CustomShapeGeometry>) };

/** The preset geometry of a shape type ("rectangle", "ooxml-star5"); a straight line is "ooxml-line". */
export function GetCustomShapeContent(sType: string): CustomShapeGeometry | undefined {
  return PRESETS[sType === 'line' ? 'ooxml-line' : sType];
}

/** EnhancedCustomShapeTypeNames: every preset type this port knows. */
export function GetCustomShapeTypes(): string[] { return Object.keys(PRESETS); }

/**
 * msfilter::util::GetOOXMLPresetGeometry: the OOXML preset a shape type is written as ("rect"
 * when there is none).
 */
export function GetOOXMLPresetGeometry(sType: string): string {
  if (sType === 'line') return 'line';
  if (sType.startsWith('ooxml-')) return sType.slice(6);
  return (toOoxml as Record<string, string>)[sType] ?? 'rect';
}
