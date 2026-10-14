// Text styling. Field names and default values are the ones CapCut keeps on a
// text material (alignment, letter_spacing, border_*, shadow_*, background_*,
// underline). CapCut does not document their units and the local drafts hardly
// vary them, so how each number is drawn (see engine/text.ts) is this editor's
// own definition and will not match CapCut exactly.
//
// font_family, bold and italic are not CapCut fields: CapCut points at a
// font file (font_path) and stores weight and slant as bold_width and
// italic_degree. A CapCut text is given the family of its font file's name,
// so it draws in that font once the same file is imported here.

import type { TextStyle } from './types'

export const ALIGN_LEFT = 0
export const ALIGN_CENTER = 1
export const ALIGN_RIGHT = 2

export const DEFAULT_FONT = 'system-ui, "Segoe UI", sans-serif'

// Fonts that ship with the operating system, so they render without a download.
export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'System', value: DEFAULT_FONT },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Comic Sans', value: '"Comic Sans MS", cursive' },
]

// A font_family value for a family by name, falling back to the default.
export const familyValue = (family: string): string =>
  `"${family.replace(/"/g, '')}", ${DEFAULT_FONT}`

// The family a font_family value asks for first, without quotes.
export const firstFamily = (value: string): string => value.split(',')[0].trim().replace(/^["']|["']$/g, '')

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font_family: DEFAULT_FONT,
  bold: false,
  italic: false,
  underline: false,
  alignment: ALIGN_CENTER,
  letter_spacing: 0,
  line_spacing: 0.02,
  // Outline. Off while border_color is empty.
  border_color: '',
  border_width: 0.08,
  has_shadow: false,
  shadow_color: '',
  shadow_alpha: 0.9,
  shadow_smoothing: 0.45,
  shadow_distance: 5,
  shadow_angle: -45,
  // Box behind the text. Off while background_color is empty.
  background_color: '',
  background_alpha: 1,
  background_round_radius: 0,
}

// CapCut writes colours as "#rrggbb" and sometimes "#rrggbbaa"; the colour
// inputs and the canvas shadow maths here want exactly "#rrggbb".
export function normalizeColor(value: string): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim())
  return match ? `#${match[1].toLowerCase()}` : ''
}

export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const a = Math.min(1, Math.max(0, alpha))
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
