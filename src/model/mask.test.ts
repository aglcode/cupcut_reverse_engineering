import { describe, expect, it } from 'vitest'
import { importCapCutDraft, openProject } from './capcutImport'
import { removeKeyframes, setKeyframes, setValues } from './keyframes'
import { evalMask, maskShape, setMask, setMaskInvert, shows } from './mask'
import { addMedia, addText, findSegment, freezeFrame, splitSegment } from './ops'
import { emptyDraft, type Draft, type Mask, type VideoMaterial } from './types'

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

function project(): { draft: Draft; id: string } {
  const added = addMedia(emptyDraft(), video, 0)
  return { draft: added.draft, id: added.segmentId }
}
const seg = (draft: Draft, id: string) => findSegment(draft, id)!.segment
const mask = (type: Mask['resource_type'], config: Partial<Mask['config']> = {}): Mask => ({
  name: type,
  resource_type: type,
  config: {
    width: 0.5,
    height: 0.5,
    centerX: 0,
    centerY: 0,
    rotation: 0,
    feather: 0,
    roundCorner: 0,
    invert: false,
    ...config,
  },
})

describe('mask shapes', () => {
  // A picture 400 wide and 200 high; points are measured from its centre.
  const W = 400
  const H = 200

  it('sizes are shares of the picture width and height', () => {
    const shape = maskShape(mask('rectangle', { width: 0.5, height: 0.25 }), W, H)
    expect([shape.width, shape.height]).toEqual([200, 50])
    expect(shows(shape, 99, 24)).toBe(true)
    expect(shows(shape, 101, 0)).toBe(false)
    expect(shows(shape, 0, 26)).toBe(false)
  })

  it('reproduces the one mask found in a CapCut draft as a square', () => {
    // On a 300 x 169 picture these two values are the same 129 pixels.
    const shape = maskShape(mask('mirror', { width: 0.430717140436172, height: 0.764586210250854 }), 300, 169)
    expect(shape.width).toBeCloseTo(129.2, 1)
    expect(shape.height).toBeCloseTo(129.2, 1)
  })

  it('a circle on a wide picture is an ellipse unless its sizes say otherwise', () => {
    const round = maskShape(mask('circle', { width: 0.25, height: 0.5 }), W, H)
    expect(shows(round, 49, 0)).toBe(true)
    expect(shows(round, 0, 49)).toBe(true)
    expect(shows(round, 36, 36)).toBe(false)
    expect(shows(round, 35, 35)).toBe(true)
  })

  it('a split shows the side above its line, a mirror a band around it', () => {
    const split = maskShape(mask('line'), W, H)
    expect(shows(split, 150, -80)).toBe(true)
    expect(shows(split, -150, 80)).toBe(false)
    const band = maskShape(mask('mirror', { height: 0.5 }), W, H)
    expect(shows(band, 190, 49)).toBe(true)
    expect(shows(band, -190, -49)).toBe(true)
    expect(shows(band, 0, 51)).toBe(false)
  })

  it('the centre is in half-picture units with y upwards', () => {
    const shape = maskShape(mask('circle', { width: 0.1, height: 0.2, centerX: 1, centerY: 0.5 }), W, H)
    expect([shape.cx, shape.cy]).toEqual([200, -50])
    expect(shows(shape, 200, -50)).toBe(true)
    expect(shows(shape, 0, 0)).toBe(false)
  })

  it('rotation turns the shape about its own centre', () => {
    const upright = maskShape(mask('line', { rotation: 90 }), W, H)
    // Turned a quarter clockwise, "above the line" becomes "right of it".
    expect(shows(upright, 50, 80)).toBe(true)
    expect(shows(upright, -50, -80)).toBe(false)
    const bar = maskShape(mask('rectangle', { width: 0.5, height: 0.1, rotation: 90 }), W, H)
    expect(shows(bar, 0, 90)).toBe(true)
    expect(shows(bar, 90, 0)).toBe(false)
  })

  it('round corners cut the corners off a rectangle', () => {
    const square = maskShape(mask('rectangle', { width: 0.5, height: 1 }), W, H)
    const rounded = maskShape(mask('rectangle', { width: 0.5, height: 1, roundCorner: 1 }), W, H)
    expect(shows(square, 95, 95)).toBe(true)
    expect(shows(rounded, 95, 95)).toBe(false)
    expect(shows(rounded, 70, 70)).toBe(true)
    expect(shows(rounded, 99, 0)).toBe(true)
    expect(rounded.radius).toBe(100)
  })

  it('invert shows everything else', () => {
    const shape = maskShape(mask('circle', { invert: true }), W, H)
    expect(shows(shape, 0, 0)).toBe(false)
    expect(shows(shape, 190, 90)).toBe(true)
  })

  it('feather is a share of the shorter side', () => {
    expect(maskShape(mask('circle', { feather: 0.5 }), W, H).feather).toBeCloseTo(10, 9)
    expect(maskShape(mask('circle'), W, H).feather).toBe(0)
  })
})

describe('masks on clips', () => {
  it('a new mask is as wide as it is tall on screen', () => {
    const { draft, id } = project()
    const m = seg(setMask(draft, id, 'circle'), id).mask!
    expect(m.name).toBe('Circle')
    expect(m.config.height).toBe(0.5)
    expect(m.config.width * 1600).toBeCloseTo(m.config.height * 900, 9)
  })

  it('changing the kind keeps the settings; removing it removes its keyframes', () => {
    const { draft, id } = project()
    let d = setMask(draft, id, 'circle')
    d = setValues(d, id, { KFTypeCommonMaskFeather: 0.3 }, 0)
    d = setKeyframes(d, id, { KFTypeCommonMaskSizeHeight: 0.2, KFTypeAlpha: 0.5 }, 0)
    d = setMaskInvert(d, id, true)
    const changed = seg(setMask(d, id, 'rectangle'), id)
    expect(changed.mask).toMatchObject({ resource_type: 'rectangle', name: 'Rectangle' })
    expect(changed.mask!.config).toMatchObject({ feather: 0.3, invert: true })
    expect(changed.common_keyframes).toHaveLength(2)
    const removed = seg(setMask(d, id, null), id)
    expect(removed.mask).toBeNull()
    expect(removed.common_keyframes.map((k) => k.property_type)).toEqual(['KFTypeAlpha'])
  })

  it('animates with keyframes, and goes back to a fixed value without them', () => {
    const { draft, id } = project()
    let d = setMask(draft, id, 'circle')
    d = setKeyframes(d, id, { KFTypeCommonMaskSizeHeight: 0.2 }, 0)
    d = setKeyframes(d, id, { KFTypeCommonMaskSizeHeight: 0.8 }, 2_000_000)
    expect(evalMask(seg(d, id), 1_000_000)!.config.height).toBeCloseTo(0.5, 6)
    expect(evalMask(seg(d, id), 5_000_000)!.config.height).toBeCloseTo(0.8, 9)
    // Other settings stay as set.
    expect(evalMask(seg(d, id), 1_000_000)!.config.width).toBe(seg(d, id).mask!.config.width)
    d = removeKeyframes(d, id, ['KFTypeCommonMaskSizeHeight'], 0)
    d = removeKeyframes(d, id, ['KFTypeCommonMaskSizeHeight'], 2_000_000)
    expect(seg(d, id).mask!.config.height).toBeCloseTo(0.8, 9)
  })

  it('keeps values in range when read', () => {
    const { draft, id } = project()
    let d = setMask(draft, id, 'rectangle')
    d = setValues(d, id, { KFTypeCommonMaskFeather: 4, KFTypeCommonMaskRoundCorner: -1, KFTypeCommonMaskSizeWidth: -2 }, 0)
    const c = evalMask(seg(d, id), 0)!.config
    expect([c.feather, c.roundCorner]).toEqual([1, 0])
    expect(c.width).toBeGreaterThan(0)
  })

  it('both halves of a split keep the mask, and a freeze frame the mask of its moment', () => {
    const { draft, id } = project()
    let d = setMask(draft, id, 'circle')
    d = setKeyframes(d, id, { KFTypeCommonMaskSizeHeight: 0.2 }, 0)
    d = setKeyframes(d, id, { KFTypeCommonMaskSizeHeight: 0.8 }, 2_000_000)
    const halves = splitSegment(d, id, 1_000_000).tracks.find((t) => t.type === 'video')!.segments
    expect(halves.map((s) => s.mask?.resource_type)).toEqual(['circle', 'circle'])
    expect(evalMask(halves[1], 1_500_000)!.config.height).toBeCloseTo(0.65, 6)
    const frozen = freezeFrame(d, id, 1_000_000)!
    const still = seg(frozen.draft, frozen.segmentId)
    expect(still.mask!.config.height).toBeCloseTo(0.5, 6)
    expect(still.common_keyframes).toEqual([])
  })

  it('does nothing for text', () => {
    const text = addText(emptyDraft(), 'Hi', 0)
    expect(seg(setMask(text.draft, text.segmentId, 'circle'), text.segmentId).mask).toBeNull()
  })
})

// The masked clip from a real draft, reduced to what the importer reads.
const capcut = (resourceType: string, enabled = true) => ({
  fps: 30,
  canvas_config: { width: 1920, height: 1080 },
  tracks: [
    {
      id: 'T1',
      type: 'video',
      flag: 0,
      segments: [
        {
          id: 'S1',
          material_id: 'V1',
          source_timerange: { start: 0, duration: 733333 },
          target_timerange: { start: 0, duration: 733333 },
          speed: 1,
          volume: 1,
          enable_video_mask: enabled,
          clip: { scale: { x: 1.058, y: 1.058 }, rotation: 0, transform: { x: 0, y: 0 }, flip: { vertical: false, horizontal: false }, alpha: 1 },
          extra_material_refs: ['M1'],
          common_keyframes: [
            {
              id: 'K1',
              property_type: 'KFTypeCommonMaskSizeWidth',
              keyframe_list: [
                { id: 'a', time_offset: 10552, values: [0.560083210468292], left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 } },
                { id: 'b', time_offset: 707005, values: [0.430717140436172], left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 } },
              ],
            },
            {
              id: 'K2',
              property_type: 'KFTypeCommonMaskSizeHeight',
              keyframe_list: [
                { id: 'c', time_offset: 10552, values: [0.994230210781097], left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 } },
                { id: 'd', time_offset: 707005, values: [0.764586210250854], left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 } },
              ],
            },
          ],
        },
      ],
    },
  ],
  materials: {
    videos: [{ id: 'V1', type: 'photo', path: 'C:/x/pic.png', duration: 10800000000, width: 300, height: 169 }],
    common_mask: [
      {
        id: 'M1',
        type: 'mask',
        name: 'Mirror',
        resource_type: resourceType,
        config: { width: 0.430717140436172, height: 0.764586210250854, centerX: 0, centerY: 0, rotation: 0, feather: 0, expansion: 0, roundCorner: 0, invert: true, aspectRatio: 0 },
      },
    ],
  },
})

describe('masks from CapCut', () => {
  it('imports the mask with its settings and keyframes', () => {
    const { draft, warnings } = importCapCutDraft(capcut('mirror'))
    const s = draft.tracks[0].segments[0]
    expect(s.mask).toEqual({
      name: 'Mirror',
      resource_type: 'mirror',
      config: { width: 0.430717140436172, height: 0.764586210250854, centerX: 0, centerY: 0, rotation: 0, feather: 0, roundCorner: 0, invert: true },
    })
    expect(s.common_keyframes.map((k) => k.property_type)).toEqual(['KFTypeCommonMaskSizeWidth', 'KFTypeCommonMaskSizeHeight'])
    // The band starts as tall as the picture and closes in.
    expect(evalMask(s, 0)!.config.height).toBeCloseTo(0.994, 3)
    expect(evalMask(s, 733_000)!.config.height).toBeCloseTo(0.7646, 3)
    expect(warnings.filter((w) => /mask/.test(w))).toEqual([])
  })

  it('reports a kind of mask it cannot draw, and drops its keyframes', () => {
    const { draft, warnings } = importCapCutDraft(capcut('geometric_shape'))
    const s = draft.tracks[0].segments[0]
    expect(s.mask).toBeNull()
    expect(s.common_keyframes).toEqual([])
    expect(warnings).toContain('1 clip uses masks of a kind that is not supported, which were not imported')
  })

  it('leaves out a mask that is switched off', () => {
    const { draft, warnings } = importCapCutDraft(capcut('mirror', false))
    expect(draft.tracks[0].segments[0].mask).toBeNull()
    expect(warnings.filter((w) => /mask/.test(w))).toEqual([])
  })

  it('opens a project saved before masks existed', () => {
    const { draft, id } = project()
    const old = JSON.parse(JSON.stringify(draft))
    delete old.tracks.find((t: { type: string }) => t.type === 'video').segments[0].mask
    expect(seg(openProject(JSON.stringify(old)).draft, id).mask).toBeNull()
  })
})
