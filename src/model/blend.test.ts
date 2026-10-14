import { describe, expect, it } from 'vitest'
import { blendOperation, BLEND_MODES, setBlend } from './blend'
import { importCapCutDraft, openProject } from './capcutImport'
import { addMedia, addText, findSegment, splitSegment } from './ops'
import { emptyDraft, type VideoMaterial } from './types'

const photo: VideoMaterial = {
  id: 'p',
  type: 'photo',
  path: 'p.png',
  duration: 0,
  width: 320,
  height: 180,
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

describe('blend modes', () => {
  it('each mode draws with the canvas operation of the same name', () => {
    expect(blendOperation('Screen')).toBe('screen')
    expect(blendOperation('Color Dodge')).toBe('color-dodge')
    expect(blendOperation(null)).toBe('source-over')
    expect(BLEND_MODES.map((b) => b.name)).toContain('Overlay')
  })

  it('is set on picture clips, cleared with null, and ignored for titles', () => {
    const added = addMedia(emptyDraft(), photo, 0)
    const id = added.segmentId
    const set = setBlend(added.draft, id, 'Multiply')
    expect(findSegment(set, id)!.segment.mix_mode).toBe('Multiply')
    expect(findSegment(setBlend(set, id, null), id)!.segment.mix_mode).toBeNull()
    // @ts-expect-error not a blend CapCut or this editor has
    expect(setBlend(set, id, 'Linear Burn')).toBe(set)
    const text = addText(emptyDraft(), 'Hi', 0)
    expect(findSegment(setBlend(text.draft, text.segmentId, 'Screen'), text.segmentId)!.segment.mix_mode).toBeNull()
  })

  it('both halves of a split keep it', () => {
    const added = addMedia(emptyDraft(), photo, 0)
    const d = splitSegment(setBlend(added.draft, added.segmentId, 'Screen'), added.segmentId, 1_000_000)
    expect(d.tracks[0].segments.map((s) => s.mix_mode)).toEqual(['Screen', 'Screen'])
  })
})

// Two overlay clips as found in a real draft, reduced to what the importer reads.
const capcut = (name: string) => ({
  fps: 30,
  canvas_config: { width: 1920, height: 1080 },
  tracks: [
    {
      id: 'T1',
      type: 'video',
      flag: 2,
      segments: [
        { id: 'S1', material_id: 'V1', source_timerange: { start: 0, duration: 1_000_000 }, target_timerange: { start: 0, duration: 1_000_000 }, speed: 1, volume: 1, extra_material_refs: ['E1'] },
      ],
    },
  ],
  materials: {
    videos: [{ id: 'V1', type: 'video', path: 'C:/x/a.mp4', duration: 9_000_000, width: 1920, height: 1080 }],
    effects: [{ id: 'E1', type: 'mix_mode', name, value: 1, effect_id: '871339', resource_id: '6758325170760323597' }],
  },
})

describe('blend modes from CapCut', () => {
  it('imports the mode by name', () => {
    const { draft, warnings } = importCapCutDraft(capcut('Screen'))
    expect(draft.tracks[0].segments[0].mix_mode).toBe('Screen')
    expect(warnings.filter((w) => /blend/.test(w))).toEqual([])
  })

  it('reports a mode it cannot draw', () => {
    const { draft, warnings } = importCapCutDraft(capcut('Linear Burn'))
    expect(draft.tracks[0].segments[0].mix_mode).toBeNull()
    expect(warnings).toContain('1 clip uses blend modes of a kind that is not supported, which were not imported')
  })

  it('opens a project saved before blend modes existed', () => {
    const added = addMedia(emptyDraft(), photo, 0)
    const old = JSON.parse(JSON.stringify(added.draft))
    delete old.tracks[0].segments[0].mix_mode
    expect(openProject(JSON.stringify(old)).draft.tracks[0].segments[0].mix_mode).toBeNull()
  })
})
