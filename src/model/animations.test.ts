import { describe, expect, it } from 'vitest'
import { animateClip, ANIMATIONS, effectiveAnimations, setAnimation } from './animations'
import { importCapCutDraft, openProject } from './capcutImport'
import { evalClip, setKeyframes } from './keyframes'
import { addMedia, addText, findSegment, splitSegment, trimSegment } from './ops'
import { DEFAULT_CLIP, emptyDraft, type Draft, type VideoMaterial } from './types'

const video: VideoMaterial = {
  id: 'v',
  type: 'video',
  path: 'a.mp4',
  duration: 10_000_000,
  width: 1600,
  height: 900,
  has_audio: false,
  crop: {
    upper_left_x: 0,
    upper_left_y: 0,
    upper_right_x: 1,
    upper_right_y: 0,
    lower_left_x: 0,
    lower_left_y: 1,
    lower_right_x: 1,
    lower_right_y: 1,
  },
}

// A 4 s clip from 1 s to 5 s.
function project(): { draft: Draft; id: string } {
  const added = addMedia(emptyDraft(), video, 1_000_000)
  return { draft: trimSegment(added.draft, added.segmentId, 'end', 5_000_000), id: added.segmentId }
}
const seg = (draft: Draft, id: string) => findSegment(draft, id)!.segment
const at = (draft: Draft, id: string, t: number) => animateClip(seg(draft, id), evalClip(seg(draft, id), t), t)

describe('in and out animations', () => {
  it('a fade in starts invisible and is done after its length', () => {
    const { draft, id } = project()
    const d = setAnimation(draft, id, 'in', { name: 'Fade In', duration: 1_000_000 })
    expect(at(d, id, 1_000_000).alpha).toBe(0)
    expect(at(d, id, 1_500_000).alpha).toBeCloseTo(0.875, 9)
    expect(at(d, id, 2_000_000)).toEqual(DEFAULT_CLIP)
    expect(at(d, id, 4_900_000)).toEqual(DEFAULT_CLIP)
  })

  it('a fade out ends invisible', () => {
    const { draft, id } = project()
    const d = setAnimation(draft, id, 'out', { name: 'Fade Out', duration: 1_000_000 })
    expect(at(d, id, 3_900_000).alpha).toBe(1)
    expect(at(d, id, 4_500_000).alpha).toBeCloseTo(0.875, 9)
    expect(at(d, id, 5_000_000).alpha).toBe(0)
  })

  it('slides come in from the side opposite to their direction, and leave along it', () => {
    const { draft, id } = project()
    const inLeft = setAnimation(draft, id, 'in', { name: 'Slide Left', duration: 1_000_000 })
    // Moving left as it arrives, so it starts a whole canvas to the right.
    expect(at(inLeft, id, 1_000_000).transform).toEqual({ x: 2, y: 0 })
    expect(at(inLeft, id, 1_500_000).transform.x).toBeCloseTo(0.25, 9)
    const outLeft = setAnimation(draft, id, 'out', { name: 'Slide Left', duration: 1_000_000 })
    expect(at(outLeft, id, 5_000_000).transform).toEqual({ x: -2, y: 0 })
    const inUp = setAnimation(draft, id, 'in', { name: 'Slide Up', duration: 1_000_000 })
    // +y is up, so arriving upwards starts below.
    expect(at(inUp, id, 1_000_000).transform).toEqual({ x: 0, y: -2 })
    const outDown = setAnimation(draft, id, 'out', { name: 'Slide Down', duration: 1_000_000 })
    expect(at(outDown, id, 5_000_000).transform).toEqual({ x: 0, y: -2 })
  })

  it('zooms grow or shrink into place', () => {
    const { draft, id } = project()
    const zoomIn = setAnimation(draft, id, 'in', { name: 'Zoom In', duration: 1_000_000 })
    expect(at(zoomIn, id, 1_000_000).scale).toEqual({ x: 0.5, y: 0.5 })
    expect(at(zoomIn, id, 2_000_000).scale).toEqual({ x: 1, y: 1 })
    const zoomOut = setAnimation(draft, id, 'in', { name: 'Zoom Out', duration: 1_000_000 })
    expect(at(zoomOut, id, 1_000_000).scale).toEqual({ x: 1.5, y: 1.5 })
    const leaveBig = setAnimation(draft, id, 'out', { name: 'Zoom In', duration: 1_000_000 })
    expect(at(leaveBig, id, 5_000_000).scale).toEqual({ x: 1.5, y: 1.5 })
  })

  it('works on top of keyframed values', () => {
    const { draft, id } = project()
    let d = setKeyframes(draft, id, { KFTypeAlpha: 0.5, KFTypePositionX: 0.4 }, 1_000_000)
    d = setAnimation(d, id, 'in', { name: 'Slide Right', duration: 1_000_000 })
    expect(at(d, id, 1_000_000).transform.x).toBeCloseTo(0.4 - 2, 9)
    expect(at(d, id, 3_000_000)).toMatchObject({ alpha: 0.5, transform: { x: 0.4, y: 0 } })
  })

  it('keeps one of each kind, the in first, and the two never overlap', () => {
    const { draft, id } = project()
    let d = setAnimation(draft, id, 'out', { name: 'Fade Out', duration: 1_000_000 })
    d = setAnimation(d, id, 'in', { name: 'Zoom In', duration: 500_000 })
    d = setAnimation(d, id, 'in', { name: 'Fade In', duration: 3_500_000 })
    expect(seg(d, id).animations).toEqual([
      { type: 'in', name: 'Fade In', duration: 3_500_000 },
      { type: 'out', name: 'Fade Out', duration: 500_000 },
    ])
    // Longer than the clip: it takes the whole clip and the other goes.
    d = setAnimation(d, id, 'out', { name: 'Fade Out', duration: 9_000_000 })
    expect(seg(d, id).animations).toEqual([{ type: 'out', name: 'Fade Out', duration: 4_000_000 }])
  })

  it('removes with null, a zero length or an unknown name', () => {
    const { draft, id } = project()
    const d = setAnimation(draft, id, 'in', { name: 'Fade In', duration: 1_000_000 })
    expect(seg(setAnimation(d, id, 'in', null), id).animations).toEqual([])
    expect(seg(setAnimation(d, id, 'in', { name: 'Fade In', duration: 0 }), id).animations).toEqual([])
    expect(seg(setAnimation(d, id, 'in', { name: 'Fade Out', duration: 1 }), id).animations).toEqual([])
    expect(ANIMATIONS.in).not.toContain('Fade Out')
  })

  it('still fits after the clip is trimmed shorter', () => {
    const { draft, id } = project()
    let d = setAnimation(draft, id, 'in', { name: 'Fade In', duration: 2_000_000 })
    d = setAnimation(d, id, 'out', { name: 'Fade Out', duration: 2_000_000 })
    d = trimSegment(d, id, 'end', 3_500_000)
    const fitted = effectiveAnimations(seg(d, id))
    expect([fitted.in?.duration, fitted.out?.duration]).toEqual([2_000_000, 500_000])
    expect(at(d, id, 3_500_000).alpha).toBe(0)
  })

  it('after a split the in stays with the first half and the out with the second', () => {
    const { draft, id } = project()
    let d = setAnimation(draft, id, 'in', { name: 'Fade In', duration: 500_000 })
    d = setAnimation(d, id, 'out', { name: 'Zoom Out', duration: 500_000 })
    const [left, right] = splitSegment(d, id, 3_000_000).tracks.find((t) => t.type === 'video')!.segments
    expect(left.animations.map((a) => a.name)).toEqual(['Fade In'])
    expect(right.animations.map((a) => a.name)).toEqual(['Zoom Out'])
  })

  it('applies to titles and not to sound', () => {
    const text = addText(emptyDraft(), 'Hi', 0)
    const titled = setAnimation(text.draft, text.segmentId, 'in', { name: 'Zoom In', duration: 500_000 })
    expect(seg(titled, text.segmentId).animations).toHaveLength(1)
    const audio = addMedia(emptyDraft(), { id: 'a', type: 'audio', name: 'a', path: 'a.wav', duration: 5_000_000 }, 0)
    const same = setAnimation(audio.draft, audio.segmentId, 'in', { name: 'Fade In', duration: 500_000 })
    expect(seg(same, audio.segmentId).animations).toEqual([])
  })
})

// Animations as found in real drafts, reduced to what the importer reads.
const capcut = {
  fps: 30,
  canvas_config: { width: 1920, height: 1080 },
  tracks: [
    {
      id: 'T1',
      type: 'video',
      flag: 0,
      segments: [
        { id: 'S1', material_id: 'V1', source_timerange: { start: 0, duration: 2_000_000 }, target_timerange: { start: 0, duration: 2_000_000 }, speed: 1, volume: 1, extra_material_refs: ['A1'] },
        { id: 'S2', material_id: 'V1', source_timerange: { start: 0, duration: 2_000_000 }, target_timerange: { start: 2_000_000, duration: 2_000_000 }, speed: 1, volume: 1, extra_material_refs: ['A2'] },
        { id: 'S3', material_id: 'V1', source_timerange: { start: 0, duration: 2_000_000 }, target_timerange: { start: 4_000_000, duration: 2_000_000 }, speed: 1, volume: 1, extra_material_refs: ['A3'] },
      ],
    },
  ],
  materials: {
    videos: [{ id: 'V1', type: 'video', path: 'C:/x/a.mp4', duration: 9_000_000, width: 1920, height: 1080 }],
    material_animations: [
      {
        id: 'A1',
        type: 'sticker_animation',
        animations: [
          { type: 'in', name: 'Fade In', category_name: 'Trending-1', duration: 500000, start: 0, material_type: 'video' },
          { type: 'out', name: 'Fade Out', category_name: 'Out', duration: 266666, start: 0, material_type: 'video' },
        ],
      },
      { id: 'A2', type: 'sticker_animation', animations: [{ type: 'in', name: 'Unfold', category_name: 'In', duration: 500000, start: 0, material_type: 'video' }] },
      { id: 'A3', type: 'sticker_animation', animations: [{ type: 'group', name: 'Popping Candy', category_name: 'Trending-3', duration: 766666, start: 0, material_type: 'video' }] },
    ],
  },
}

describe('animations from CapCut', () => {
  const { draft, warnings } = importCapCutDraft(capcut)
  const [fades, other, combo] = draft.tracks[0].segments

  it("imports CapCut's fades as they are", () => {
    expect(fades.animations).toEqual([
      { type: 'in', name: 'Fade In', duration: 500000 },
      { type: 'out', name: 'Fade Out', duration: 266666 },
    ])
    // The out animation is placed by the end of the clip, whatever `start` says.
    expect(animateClip(fades, DEFAULT_CLIP, 2_000_000).alpha).toBe(0)
    expect(animateClip(fades, DEFAULT_CLIP, 1_000_000).alpha).toBe(1)
  })

  it('turns any other in or out look into a fade of the same length, and says so', () => {
    expect(other.animations).toEqual([{ type: 'in', name: 'Fade In', duration: 500000 }])
    expect(warnings).toContain('1 animation replaced with a fade of the same length')
  })

  it('leaves out loop and combo animations, and says so', () => {
    expect(combo.animations).toEqual([])
    expect(warnings).toContain('1 clip uses loop or combo animations, which were not imported')
  })

  it('opens a project saved before animations existed', () => {
    const { draft: d, id } = project()
    const old = JSON.parse(JSON.stringify(d))
    delete old.tracks.find((t: { type: string }) => t.type === 'video').segments[0].animations
    expect(seg(openProject(JSON.stringify(old)).draft, id).animations).toEqual([])
  })
})
