// Canvas background: what fills the frame behind a clip that does not cover
// it (a portrait video on a landscape canvas, a scaled-down clip, and so on).
//
// In CapCut drafts every video segment references a materials.canvases entry:
//   {"type":"canvas_color","color":"","blur":0,"image":"",…}
// and the engine also names "canvas_blur" and "canvas_image" types. The same
// type, color and blur fields are kept here, on the segment. Every entry in
// the drafts inspected is at its defaults, so the scale of `blur` is this
// editor's own: 0 to 1, where 1 blurs by 5% of the frame height.

import { normalizeColor } from './textStyle'
import type { CanvasBackground, Draft } from './types'

export const DEFAULT_BACKGROUND_COLOR = '#202020'
export const DEFAULT_BACKGROUND_BLUR = 0.5

// Blur radius as a fraction of the frame height, per unit of `blur`.
export const BLUR_RADIUS_PER_UNIT = 0.05

export function setBackground(
  draft: Draft,
  segmentId: string,
  background: CanvasBackground | null,
): Draft {
  let canvas = background
  if (canvas?.type === 'canvas_color') {
    canvas = { ...canvas, color: normalizeColor(canvas.color) || DEFAULT_BACKGROUND_COLOR }
  } else if (canvas) {
    canvas = { ...canvas, blur: Math.min(1, Math.max(0, canvas.blur)) }
  }
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) =>
        s.id === segmentId && track.type === 'video' ? { ...s, canvas } : s,
      ),
    })),
  }
}
