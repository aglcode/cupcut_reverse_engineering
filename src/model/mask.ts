// Masks: showing only part of a clip's picture.
//
// CapCut keeps a mask as a materials.common_mask entry the clip references:
//   {"name":"Mirror","resource_type":"mirror","config":{"width":0.4307,
//    "height":0.7646,"centerX":0,"centerY":0,"rotation":0,"feather":0,
//    "expansion":0,"roundCorner":0,"invert":true,"aspectRatio":0}}
// and animates it with keyframe properties named KFTypeCommonMaskSizeWidth,
// ...SizeHeight, ...PositionX, ...PositionY, ...Rotation, ...Feather and
// ...RoundCorner. The same config fields and property names are kept here, on
// the segment.
//
// Two masked clips exist in the local drafts: a "Mirror" (resource_type
// "mirror") and a "Split" (resource_type "line"). The Mirror's width and
// height, times the media's 300 x 169 pixels, both come to 129 pixels (and its
// keyframes to 168 and 168), so size is a fraction of the media's width and of
// its height. Everything else is zero on both clips, so the rest is this
// editor's own: the centre is in half-widths and half-heights with +y up, like
// a clip's position; rotation is in degrees; feather and roundCorner run from
// 0 to 1. What each shape shows is original too (which side of a Split, for
// one), and "circle" and "rectangle" are names from common report, not from a
// draft.
//
// CapCut also has Heart and Star masks (its interface text names
// pc_mask_heart and pc_mask_star, and the engine a "geometric_shape" resource
// type). They are kept here as resource_type "geometric_shape" told apart by
// name; that pairing, and the outlines drawn, are this editor's own.

import { cropRect } from './crop'
import { evalProperty, isMaskProperty, MASK_FIELDS } from './keyframes'
import {
  DEFAULT_MASK_CONFIG,
  type Draft,
  type KeyframeProperty,
  type Mask,
  type MaskType,
  type Segment,
} from './types'

// The shapes a mask can take. `kind` names the shape; `type` is the
// resource_type stored, which Heart and Star share.
export type MaskKind = 'line' | 'mirror' | 'circle' | 'rectangle' | 'heart' | 'star'

export const MASK_TYPES: { kind: MaskKind; type: MaskType; name: string }[] = [
  { kind: 'line', type: 'line', name: 'Split' },
  { kind: 'mirror', type: 'mirror', name: 'Mirror' },
  { kind: 'circle', type: 'circle', name: 'Circle' },
  { kind: 'rectangle', type: 'rectangle', name: 'Rectangle' },
  { kind: 'heart', type: 'geometric_shape', name: 'Heart' },
  { kind: 'star', type: 'geometric_shape', name: 'Star' },
]

// The shape of a mask.
export function maskKind(mask: Mask): MaskKind {
  if (mask.resource_type === 'geometric_shape') return /star/i.test(mask.name) ? 'star' : 'heart'
  return mask.resource_type
}

export const MASK_PROPERTIES = Object.keys(MASK_FIELDS) as KeyframeProperty[]

// Width of the soft edge at full feather, as a fraction of the picture's
// shorter side.
export const FEATHER_PER_UNIT = 0.1

const MIN_SIZE = 0.001
const clamp = (v: number, low: number, high: number): number => Math.min(high, Math.max(low, v))

// Gives a clip a mask, changes its kind, or with null removes it along with
// its keyframes. A new mask is half the picture's height, and as wide as it is
// tall on screen.
export function setMask(draft: Draft, segmentId: string, kind: MaskKind | null): Draft {
  const entry = kind ? MASK_TYPES.find((m) => m.kind === kind) : null
  if (kind && !entry) return draft
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) => {
        if (s.id !== segmentId || track.type !== 'video' || !s.clip) return s
        if (!entry) {
          return {
            ...s,
            mask: null,
            common_keyframes: s.common_keyframes.filter((k) => !isMaskProperty(k.property_type)),
          }
        }
        const { name, type } = entry
        if (s.mask) return { ...s, mask: { ...s.mask, name, resource_type: type } }
        const material = draft.materials.videos.find((m) => m.id === s.material_id)
        const crop = material ? cropRect(material.crop) : null
        const w = material && crop ? material.width * crop.width : 0
        const h = material && crop ? material.height * crop.height : 0
        const width = w > 0 && h > 0 ? clamp((DEFAULT_MASK_CONFIG.height * h) / w, MIN_SIZE, 1) : 0.5
        return { ...s, mask: { name, resource_type: type, config: { ...DEFAULT_MASK_CONFIG, width } } }
      }),
    })),
  }
}

export function setMaskInvert(draft: Draft, segmentId: string, invert: boolean): Draft {
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) =>
        s.id === segmentId && s.mask ? { ...s, mask: { ...s.mask, config: { ...s.mask.config, invert } } } : s,
      ),
    })),
  }
}

// The mask in effect at timeline time `t`, keyframes included.
export function evalMask(segment: Segment, t: number): Mask | null {
  const mask = segment.mask
  if (!mask) return null
  const at = (p: KeyframeProperty) => evalProperty(segment, p, t)
  return {
    ...mask,
    config: {
      width: Math.max(MIN_SIZE, at('KFTypeCommonMaskSizeWidth')),
      height: Math.max(MIN_SIZE, at('KFTypeCommonMaskSizeHeight')),
      centerX: at('KFTypeCommonMaskPositionX'),
      centerY: at('KFTypeCommonMaskPositionY'),
      rotation: at('KFTypeCommonMaskRotation'),
      feather: clamp(at('KFTypeCommonMaskFeather'), 0, 1),
      roundCorner: clamp(at('KFTypeCommonMaskRoundCorner'), 0, 1),
      invert: mask.config.invert,
    },
  }
}

// A mask laid over a picture `w` by `h` pixels: lengths in pixels, measured
// from the picture's centre with y downwards, rotation in radians.
export type MaskShape = {
  type: MaskKind
  cx: number
  cy: number
  width: number
  height: number
  // Corner radius of a rectangle.
  radius: number
  rotation: number
  // Width of the soft edge.
  feather: number
  invert: boolean
}

export function maskShape(mask: Mask, w: number, h: number): MaskShape {
  const c = mask.config
  const width = c.width * w
  const height = c.height * h
  return {
    type: maskKind(mask),
    cx: (c.centerX * w) / 2,
    cy: (-c.centerY * h) / 2,
    width,
    height,
    radius: mask.resource_type === 'rectangle' ? (c.roundCorner * Math.min(width, height)) / 2 : 0,
    rotation: (c.rotation * Math.PI) / 180,
    feather: c.feather * FEATHER_PER_UNIT * Math.min(w, h),
    invert: c.invert,
  }
}

// The outline of a Heart or a Star filling a box `width` by `height`, centred
// on the origin with y down, as a list of corners.
export function outline(kind: 'heart' | 'star', width: number, height: number): [number, number][] {
  if (kind === 'star') {
    // Five points, the first straight up; the inner corners at 40% out.
    return Array.from({ length: 10 }, (_, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 === 0 ? 1 : 0.4
      return [(Math.cos(angle) * r * width) / 2, (Math.sin(angle) * r * height) / 2] as [number, number]
    })
  }
  // The usual heart curve, scaled to fill the box.
  const raw = Array.from({ length: 72 }, (_, i) => {
    const t = (i / 72) * Math.PI * 2
    return [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]
  })
  const ys = raw.map((p) => p[1])
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return raw.map(([x, y]) => [(x / 32) * width, ((y - top) / (bottom - top) - 0.5) * height] as [number, number])
}

function insidePolygon(points: [number, number][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Whether the picture shows at a point, soft edge aside. A Split shows the
// side above its line; a Mirror shows a band `height` thick; a Circle and a
// Rectangle show their inside.
export function shows(shape: MaskShape, x: number, y: number): boolean {
  const dx = x - shape.cx
  const dy = y - shape.cy
  const cos = Math.cos(-shape.rotation)
  const sin = Math.sin(-shape.rotation)
  const px = dx * cos - dy * sin
  const py = dx * sin + dy * cos
  const halfW = shape.width / 2
  const halfH = shape.height / 2
  let inside: boolean
  switch (shape.type) {
    case 'line':
      inside = py <= 0
      break
    case 'mirror':
      inside = Math.abs(py) <= halfH
      break
    case 'circle':
      inside = (px / halfW) ** 2 + (py / halfH) ** 2 <= 1
      break
    case 'heart':
    case 'star':
      inside = insidePolygon(outline(shape.type, shape.width, shape.height), px, py)
      break
    case 'rectangle': {
      // Distance past the straight part of each side; inside a corner's
      // square that is the distance to the corner's centre.
      const ox = Math.abs(px) - (halfW - shape.radius)
      const oy = Math.abs(py) - (halfH - shape.radius)
      inside =
        Math.abs(px) <= halfW &&
        Math.abs(py) <= halfH &&
        (ox <= 0 || oy <= 0 || ox * ox + oy * oy <= shape.radius * shape.radius)
      break
    }
  }
  return inside !== shape.invert
}

// ---- handles for editing a mask on the preview -----------------------------

export type MaskHandle = 'move' | 'width' | 'height' | 'rotate'

// Which handles a kind of mask has: a Split has no size, a Mirror only a
// thickness.
export function maskHandleKinds(type: MaskKind): MaskHandle[] {
  if (type === 'line') return ['move', 'rotate']
  if (type === 'mirror') return ['move', 'height', 'rotate']
  return ['move', 'width', 'height', 'rotate']
}

// How far the rotate handle stands off the shape, as a share of the picture's
// shorter side.
const ROTATE_GAP = 0.12

// Where each handle sits, in the picture's own pixels (from its centre, y
// down), for a picture `w` by `h`.
export function maskHandles(mask: Mask, w: number, h: number): Record<MaskHandle, [number, number]> {
  const s = maskShape(mask, w, h)
  const cos = Math.cos(s.rotation)
  const sin = Math.sin(s.rotation)
  // A point in the mask's own turned frame, to the picture's.
  const at = (x: number, y: number): [number, number] => [s.cx + x * cos - y * sin, s.cy + x * sin + y * cos]
  const top = mask.resource_type === 'line' ? 0 : s.height / 2
  return {
    move: [s.cx, s.cy],
    width: at(s.width / 2, 0),
    height: at(0, -s.height / 2),
    rotate: at(0, -(top + ROTATE_GAP * Math.min(w, h))),
  }
}

// The mask settings that put `handle` at the picture point (x, y). For a move,
// (x, y) is where the centre goes. Returned as keyframe property values, so
// they can be set the way the inspector sets them.
export function dragMask(
  mask: Mask,
  handle: MaskHandle,
  x: number,
  y: number,
  w: number,
  h: number,
): Partial<Record<KeyframeProperty, number>> {
  const s = maskShape(mask, w, h)
  if (handle === 'move') {
    return { KFTypeCommonMaskPositionX: (2 * x) / w, KFTypeCommonMaskPositionY: (-2 * y) / h }
  }
  const dx = x - s.cx
  const dy = y - s.cy
  if (handle === 'rotate') {
    // Straight up from the centre is no turn; clockwise is positive.
    const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI
    return { KFTypeCommonMaskRotation: Math.round(degrees * 10) / 10 }
  }
  // The pointer in the mask's own turned frame.
  const cos = Math.cos(-s.rotation)
  const sin = Math.sin(-s.rotation)
  const along = dx * cos - dy * sin
  const across = dx * sin + dy * cos
  if (handle === 'width') return { KFTypeCommonMaskSizeWidth: Math.max(MIN_SIZE, (2 * Math.abs(along)) / w) }
  return { KFTypeCommonMaskSizeHeight: Math.max(MIN_SIZE, (2 * Math.abs(across)) / h) }
}
