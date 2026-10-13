// Colour adjustment: brightness, contrast and saturation per clip.
//
// CapCut stores each as its own materials.effects entry, with type
// "brightness", "contrast" or "saturation" and a value, referenced from the
// clip. The only adjusted clip in the drafts inspected has saturation -1 with
// the other two at 0, which fixes the scale as -1 to 1 around a neutral 0 and
// suggests -1 saturation is fully grey. The same three values are kept here,
// on the segment.
//
// CapCut draws them with its own shader bundle. How strong brightness and
// contrast are at a given value is therefore this editor's definition: each
// runs from half to one and a half times normal. Saturation runs from grey to
// double, so that -1 matches what CapCut's value implies.

import { evalProperty } from './keyframes'
import type { Adjust, Segment } from './types'

export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0 }

const clamp = (v: number): number => Math.min(1, Math.max(-1, v))

// The adjustment in effect at timeline time `t`, keyframes included.
export function evalAdjust(segment: Segment, t: number): Adjust {
  return {
    brightness: clamp(evalProperty(segment, 'KFTypeBrightness', t)),
    contrast: clamp(evalProperty(segment, 'KFTypeContrast', t)),
    saturation: clamp(evalProperty(segment, 'KFTypeSaturation', t)),
  }
}

export const isNeutral = (a: Adjust): boolean =>
  a.brightness === 0 && a.contrast === 0 && a.saturation === 0

// The adjustment as a canvas filter, or 'none' when it changes nothing.
export function adjustFilter(a: Adjust): string {
  if (isNeutral(a)) return 'none'
  const brightness = 1 + clamp(a.brightness) * 0.5
  const contrast = 1 + clamp(a.contrast) * 0.5
  const saturation = 1 + clamp(a.saturation)
  return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`
}
