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

export const MASK_TYPES: { type: MaskType; name: string }[] = [
  { type: 'line', name: 'Split' },
  { type: 'mirror', name: 'Mirror' },
  { type: 'circle', name: 'Circle' },
  { type: 'rectangle', name: 'Rectangle' },
]

export const MASK_PROPERTIES = Object.keys(MASK_FIELDS) as KeyframeProperty[]

// Width of the soft edge at full feather, as a fraction of the picture's
// shorter side.
export const FEATHER_PER_UNIT = 0.1

const MIN_SIZE = 0.001
const clamp = (v: number, low: number, high: number): number => Math.min(high, Math.max(low, v))

// Gives a clip a mask, changes its kind, or with null removes it along with
// its keyframes. A new mask is half the picture's height, and as wide as it is
// tall on screen.
export function setMask(draft: Draft, segmentId: string, type: MaskType | null): Draft {
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) => {
        if (s.id !== segmentId || track.type !== 'video' || !s.clip) return s
        if (!type) {
          return {
            ...s,
            mask: null,
            common_keyframes: s.common_keyframes.filter((k) => !isMaskProperty(k.property_type)),
          }
        }
        const name = MASK_TYPES.find((m) => m.type === type)?.name ?? type
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
  type: MaskType
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
    type: mask.resource_type,
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
