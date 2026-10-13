import { describe, expect, it } from 'vitest'
import { resolveFrame, type MediaLayer } from '../engine/resolve'
import { adjustFilter, evalAdjust, isNeutral, NO_ADJUST } from './adjust'
import { copySegments } from './clipboard'
import { FULL_CROP } from './crop'
import { isAnimated, removeKeyframes, setEasing, setKeyframes, setValues } from './keyframes'
import { addMedia, addText, findSegment, freezeFrame, pasteSegments, splitSegment } from './ops'
import { emptyDraft, newId, type Draft, type VideoMaterial } from './types'

const video = (seconds: number): VideoMaterial => ({
  id: newId(),
  type: 'video',
  path: 'clip.mp4',
  duration: seconds * 1_000_000,
  width: 1920,
  height: 1080,
  has_audio: false,
  crop: { ...FULL_CROP },
})

const seg = (draft: Draft, id: string) => findSegment(draft, id)!.segment
const clip = () => {
  const added = addMedia(emptyDraft(), video(10), 0)
  return { draft: added.draft, id: added.segmentId }
}

describe('adjustFilter', () => {
  it('does nothing at zero', () => {
    expect(isNeutral(NO_ADJUST)).toBe(true)
    expect(adjustFilter(NO_ADJUST)).toBe('none')
  })

  it('makes the picture grey at -1 saturation, as the CapCut value implies', () => {
    expect(adjustFilter({ brightness: 0, contrast: 0, saturation: -1 })).toBe(
      'brightness(1) contrast(1) saturate(0)',
    )
  })

  it('runs each control over its range', () => {
    expect(adjustFilter({ brightness: 1, contrast: -1, saturation: 1 })).toBe(
      'brightness(1.5) contrast(0.5) saturate(2)',
    )
    expect(adjustFilter({ brightness: -1, contrast: 1, saturation: 0.5 })).toBe(
      'brightness(0.5) contrast(1.5) saturate(1.5)',
    )
  })

  it('does not go past the ends of the range', () => {
    expect(adjustFilter({ brightness: 9, contrast: -9, saturation: -9 })).toBe(
      'brightness(1.5) contrast(0.5) saturate(0)',
    )
  })
})

describe('adjusting a clip', () => {
  it('starts neutral', () => {
    const { draft, id } = clip()
    expect(seg(draft, id).adjust).toEqual(NO_ADJUST)
    expect(addText(emptyDraft(), 'Hi', 0).draft.tracks.flatMap((t) => t.segments)[0].adjust).toEqual(NO_ADJUST)
  })

  it('sets a static value', () => {
    const { draft, id } = clip()
    const next = setValues(draft, id, { KFTypeSaturation: -1 }, 0)
    expect(seg(next, id).adjust).toEqual({ brightness: 0, contrast: 0, saturation: -1 })
    expect(isAnimated(seg(next, id), 'KFTypeSaturation')).toBe(false)
    expect(evalAdjust(seg(next, id), 5_000_000).saturation).toBe(-1)
  })

  it('reaches the renderer', () => {
    const { draft, id } = clip()
    const next = setValues(draft, id, { KFTypeBrightness: 0.4 }, 0)
    const layer = resolveFrame(next, 1_000_000).visual[0] as MediaLayer
    expect(layer.adjust).toEqual({ brightness: 0.4, contrast: 0, saturation: 0 })
  })

  it('can be keyframed, with easing', () => {
    const { draft, id } = clip()
    let keyed = setKeyframes(draft, id, { KFTypeSaturation: -1 }, 0)
    keyed = setKeyframes(keyed, id, { KFTypeSaturation: 1 }, 4_000_000)
    expect(evalAdjust(seg(keyed, id), 2_000_000).saturation).toBeCloseTo(0)
    expect(evalAdjust(seg(keyed, id), 1_000_000).saturation).toBeCloseTo(-0.5)
    // Brightness and contrast are untouched by saturation keyframes.
    expect(evalAdjust(seg(keyed, id), 1_000_000).brightness).toBe(0)

    const eased = setEasing(keyed, id, 0, 'Ease in')
    expect(evalAdjust(seg(eased, id), 2_000_000).saturation).toBeCloseTo(-1 + 2 * 0.3154, 2)
  })

  it('writes a keyframe when an animated value is edited, and goes static again when the last one is removed', () => {
    const { draft, id } = clip()
    const keyed = setKeyframes(draft, id, { KFTypeContrast: 0.2 }, 1_000_000)
    const edited = setValues(keyed, id, { KFTypeContrast: 0.8 }, 3_000_000)
    expect(seg(edited, id).common_keyframes[0].keyframe_list).toHaveLength(2)
    let cleared = removeKeyframes(edited, id, ['KFTypeContrast'], 1_000_000)
    cleared = removeKeyframes(cleared, id, ['KFTypeContrast'], 3_000_000)
    expect(seg(cleared, id).common_keyframes).toEqual([])
    expect(seg(cleared, id).adjust.contrast).toBeCloseTo(0.8)
  })

  it('stays within range even if a keyframe value does not', () => {
    const { draft, id } = clip()
    const keyed = setKeyframes(draft, id, { KFTypeBrightness: 5 }, 0)
    expect(evalAdjust(seg(keyed, id), 0).brightness).toBe(1)
  })

  it('carries through a split, a copy and a freeze frame', () => {
    const { draft, id } = clip()
    let keyed = setKeyframes(draft, id, { KFTypeSaturation: -1 }, 0)
    keyed = setKeyframes(keyed, id, { KFTypeSaturation: 1 }, 4_000_000)
    keyed = setValues(keyed, id, { KFTypeBrightness: 0.3 }, 0)

    const split = splitSegment(keyed, id, 2_000_000)
    const [left, right] = split.tracks[0].segments
    expect(evalAdjust(left, 1_000_000).saturation).toBeCloseTo(-0.5)
    expect(evalAdjust(right, 3_000_000).saturation).toBeCloseTo(0.5)
    expect(right.adjust.brightness).toBe(0.3)

    const pasted = pasteSegments(keyed, copySegments(keyed, [id])!, 20_000_000)!
    expect(evalAdjust(seg(pasted.draft, pasted.segmentIds[0]), 21_000_000).saturation).toBeCloseTo(-0.5)

    // The still holds the colour the clip had at that moment.
    const made = freezeFrame(keyed, id, 3_000_000)!
    const still = seg(made.draft, made.segmentId)
    expect(still.adjust.saturation).toBeCloseTo(0.5)
    expect(still.adjust.brightness).toBe(0.3)
    expect(evalAdjust(still, 4_000_000).saturation).toBeCloseTo(0.5)
  })
})
