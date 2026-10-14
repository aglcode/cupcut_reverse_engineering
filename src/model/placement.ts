// Where a clip's picture sits on the frame, as the compositor draws it: the
// cropped picture fitted inside the canvas, then scaled, flipped, turned and
// moved by the clip's transform. Handles drawn over the preview use this to
// turn a pointer position into a place on the picture and back.

import { cropRect } from './crop'
import type { Clip, VideoMaterial } from './types'

export type Placement = {
  // Size of the fitted picture before the clip's scale, in canvas pixels.
  width: number
  height: number
  // The picture's own space (pixels from its centre, y down) to the frame's.
  toFrame: (x: number, y: number) => [number, number]
  toPicture: (x: number, y: number) => [number, number]
  // toFrame as an SVG/canvas matrix [a, b, c, d, e, f].
  matrix: [number, number, number, number, number, number]
}

export function placement(
  clip: Clip,
  material: VideoMaterial,
  canvasWidth: number,
  canvasHeight: number,
): Placement {
  const crop = cropRect(material.crop)
  const sw = Math.max(1, material.width * crop.width)
  const sh = Math.max(1, material.height * crop.height)
  const fit = Math.min(canvasWidth / sw, canvasHeight / sh)
  const width = sw * fit
  const height = sh * fit
  const cx = canvasWidth / 2 + (clip.transform.x * canvasWidth) / 2
  const cy = canvasHeight / 2 - (clip.transform.y * canvasHeight) / 2
  const angle = (clip.rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const sx = clip.scale.x * (clip.flip.horizontal ? -1 : 1)
  const sy = clip.scale.y * (clip.flip.vertical ? -1 : 1)
  const matrix: Placement['matrix'] = [cos * sx, sin * sx, -sin * sy, cos * sy, cx, cy]
  const [a, b, c, d, e, f] = matrix
  const det = a * d - b * c
  return {
    width,
    height,
    matrix,
    toFrame: (x, y) => [a * x + c * y + e, b * x + d * y + f],
    toPicture: (x, y) => {
      const dx = x - e
      const dy = y - f
      return det === 0 ? [0, 0] : [(d * dx - c * dy) / det, (-b * dx + a * dy) / det]
    },
  }
}
