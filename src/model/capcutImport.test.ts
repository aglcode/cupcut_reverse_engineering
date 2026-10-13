import { describe, expect, it } from 'vitest'
import { importCapCutDraft, openProject } from './capcutImport'
import { cropInsets, isCropped } from './crop'
import { evalProperty } from './keyframes'

// Hand-written in the shape of a real draft_content.json (CapCut 9.4), reduced
// to the fields the importer reads plus the kinds of things it must skip.
const fixture = {
  id: 'D1',
  version: 360000,
  name: '',
  duration: 3_000_000,
  fps: 30.0,
  canvas_config: { ratio: 'original', width: 1080, height: 1920, background: null },
  tracks: [
    {
      id: 'T1',
      type: 'video',
      flag: 0,
      segments: [
        {
          id: 'S1',
          source_timerange: { start: 500000, duration: 1000000 },
          target_timerange: { start: 0, duration: 1000000 },
          speed: 1.0,
          volume: 0.5,
          clip: {
            scale: { x: 2, y: 2 },
            rotation: 90,
            transform: { x: 0.5, y: -0.25 },
            flip: { vertical: false, horizontal: true },
            alpha: 0.8,
          },
          material_id: 'V1',
          extra_material_refs: ['SP1', 'AN1', 'TR1'],
          visible: true,
          common_keyframes: [
            {
              id: 'K1',
              material_id: '',
              property_type: 'KFTypeAlpha',
              keyframe_list: [
                {
                  id: 'F2',
                  curveType: 'FreeCurveInOut',
                  graphID: '',
                  left_control: { x: 0, y: 0 },
                  right_control: { x: 166829, y: 0 },
                  string_value: '',
                  time_offset: 1500000,
                  values: [1],
                },
                {
                  id: 'F1',
                  curveType: 'Line',
                  graphID: '',
                  left_control: { x: 0, y: 0 },
                  right_control: { x: 0, y: 0 },
                  string_value: '',
                  time_offset: 500000,
                  values: [0.2],
                },
              ],
            },
            {
              id: 'K2',
              material_id: '',
              property_type: 'KFTypeLUTSkin',
              keyframe_list: [{ id: 'F3', curveType: 'Line', time_offset: 500000, values: [0] }],
            },
          ],
        },
        {
          id: 'S2',
          source_timerange: { start: 0, duration: 966667 },
          target_timerange: { start: 1000000, duration: 200000 },
          speed: 5.2508055861414,
          volume: 1.0,
          clip: null,
          material_id: 'V1',
          extra_material_refs: ['SP2', 'AN0'],
          visible: true,
          common_keyframes: [],
        },
      ],
    },
    {
      id: 'T2',
      type: 'text',
      flag: 0,
      segments: [
        {
          id: 'S3',
          source_timerange: null,
          target_timerange: { start: 166666, duration: 766666 },
          speed: 1.0,
          volume: 1.0,
          clip: { scale: { x: 5, y: 5 }, rotation: 0, transform: { x: 0, y: 0 }, alpha: 1 },
          material_id: 'X1',
          extra_material_refs: [],
          visible: true,
        },
      ],
    },
    {
      id: 'T3',
      type: 'effect',
      flag: 0,
      segments: [{ id: 'S4', target_timerange: { start: 0, duration: 500000 }, material_id: 'E1' }],
    },
    { id: 'T4', type: 'filter', flag: 0, segments: [] },
    {
      id: 'T5',
      type: 'audio',
      flag: 0,
      segments: [
        {
          id: 'S5',
          source_timerange: { start: 0, duration: 3000000 },
          target_timerange: { start: 0, duration: 3000000 },
          speed: 1.0,
          volume: 1.0,
          clip: null,
          material_id: 'A1',
          extra_material_refs: ['FD1'],
          visible: true,
        },
      ],
    },
  ],
  materials: {
    videos: [
      {
        id: 'V1',
        type: 'video',
        duration: 5066666,
        path: 'C:/Users/someone/Videos/My Clip.mp4',
        width: 1920,
        height: 1080,
        has_audio: true,
        crop: {
          upper_left_x: 0.25,
          upper_left_y: 0,
          upper_right_x: 0.75,
          upper_right_y: 0,
          lower_left_x: 0.25,
          lower_left_y: 1,
          lower_right_x: 0.75,
          lower_right_y: 1,
        },
        crop_ratio: '1:1',
        crop_scale: 1,
      },
      { id: 'V2', type: 'video', duration: 1000000, path: 'C:/unused.mp4', width: 10, height: 10 },
    ],
    audios: [
      {
        id: 'A1',
        type: 'extract_music',
        duration: 12666666,
        path: 'C:\\Users\\someone\\Downloads\\song.mp3',
      },
    ],
    texts: [
      {
        id: 'X1',
        type: 'text',
        content: JSON.stringify({
          text: 'GAS',
          styles: [
            {
              fill: {
                content: {
                  render_type: 'solid',
                  solid: { color: [0.843137264251709, 0.4117647111415863, 0.10980392247438431] },
                },
              },
              size: 15,
              range: [0, 3],
            },
          ],
        }),
        font_size: 15,
        text_color: '#ffffff',
      },
    ],
    speeds: [
      { id: 'SP1', type: 'speed', mode: 0, speed: 1.0, curve_speed: null },
      {
        id: 'SP2',
        type: 'speed',
        mode: 1,
        speed: 5.25,
        curve_speed: {
          name: 'Bullet',
          speed_points: [
            { x: 0, y: 9.6 },
            { x: 1, y: 9.6 },
          ],
        },
      },
    ],
    material_animations: [
      { id: 'AN0', type: 'sticker_animation', animations: [] },
      {
        id: 'AN1',
        type: 'sticker_animation',
        animations: [{ id: '7437', type: 'in', start: 0, duration: 433333 }],
      },
    ],
    video_effects: [{ id: 'E1', type: 'video_effect', name: 'Flash' }],
    transitions: [
      {
        id: 'TR1',
        type: 'transition',
        name: 'Tremble Zoom',
        effect_id: '7262258307128103425',
        duration: 400000,
        is_overlap: true,
        path: 'C:/cache/effect/7262258307128103425',
      },
    ],
    audio_fades: [
      {
        id: 'FD1',
        type: 'audio_fade',
        fade_type: 0,
        fade_in_duration: 500000,
        fade_out_duration: 1000000,
      },
    ],
  },
  keyframes: { videos: [], audios: [], texts: [] },
}

describe('importCapCutDraft', () => {
  const { draft, warnings } = importCapCutDraft(fixture)

  it('reads canvas, fps and derives duration', () => {
    expect(draft.canvas_config).toEqual({ width: 1080, height: 1920 })
    expect(draft.fps).toBe(30)
    expect(draft.duration).toBe(3_000_000)
  })

  it('keeps visual tracks in render order with audio underneath', () => {
    expect(draft.tracks.map((t) => t.type)).toEqual(['audio', 'video', 'text'])
  })

  it('carries timing, transform and volume across', () => {
    const s = draft.tracks[1].segments[0]
    expect(s.source_timerange).toEqual({ start: 500000, duration: 1000000 })
    expect(s.target_timerange).toEqual({ start: 0, duration: 1000000 })
    expect(s.volume).toBe(0.5)
    expect(s.clip).toEqual({
      scale: { x: 2, y: 2 },
      rotation: 90,
      transform: { x: 0.5, y: -0.25 },
      flip: { horizontal: true, vertical: false },
      alpha: 0.8,
    })
  })

  it('relinks media by file name only', () => {
    expect(draft.materials.videos.map((m) => m.path)).toEqual(['My Clip.mp4'])
    expect(draft.materials.audios.map((m) => m.path)).toEqual(['song.mp3'])
  })

  it('unpacks rich text', () => {
    expect(draft.materials.texts[0]).toMatchObject({
      content: 'GAS',
      font_size: 15,
      text_color: '#d7691c',
    })
    expect(draft.tracks[2].segments[0].source_timerange).toBeNull()
  })

  it('imports a speed ramp at its average speed with a consistent source range', () => {
    const s = draft.tracks[1].segments[1]
    expect(s.speed).toBeCloseTo(5.2508, 3)
    expect(s.source_timerange?.duration).toBe(Math.round(s.target_timerange.duration * s.speed))
  })

  it('reports what it left out', () => {
    expect(warnings).toEqual([
      '1 effect track not imported',
      '1 filter track not imported',
      '1 clip with a speed ramp imported at average speed',
      '1 clip uses in/out animations, which were not imported',
      '1 transition replaced with a Mix (cross-dissolve) of the same length',
      '1 clip with eased keyframes imported with linear motion',
    ])
  })

  it('imports transform keyframes in source time and skips colour ones', () => {
    const s = draft.tracks[1].segments[0]
    expect(s.common_keyframes).toHaveLength(1)
    expect(s.common_keyframes[0].property_type).toBe('KFTypeAlpha')
    expect(s.common_keyframes[0].keyframe_list.map((f) => [f.time_offset, f.values[0]])).toEqual([
      [500000, 0.2],
      [1500000, 1],
    ])
    // The segment plays source 0.5 s - 1.5 s over timeline 0 - 1 s.
    expect(evalProperty(s, 'KFTypeAlpha', 0)).toBeCloseTo(0.2)
    expect(evalProperty(s, 'KFTypeAlpha', 500000)).toBeCloseTo(0.6)
  })

  it('imports a transition onto the outgoing clip', () => {
    const [first, second] = draft.tracks[1].segments
    expect(first.transition).toEqual({ name: 'Mix', duration: 400000 })
    expect(second.transition).toBeNull()
  })

  it('imports the crop stored on the video material', () => {
    const insets = cropInsets(draft.materials.videos[0].crop)
    expect(insets).toEqual({ left: 0.25, top: 0, right: 0.25, bottom: 0 })
  })

  it('imports audio fades from the audio_fades material', () => {
    const [audioTrack, videoTrack] = draft.tracks
    expect(audioTrack.segments[0].audio_fade).toEqual({
      fade_in_duration: 500000,
      fade_out_duration: 1000000,
    })
    expect(videoTrack.segments[0].audio_fade).toBeNull()
  })

  it('opens a project saved by an older version', () => {
    const old = JSON.parse(JSON.stringify(draft))
    for (const track of old.tracks) {
      for (const seg of track.segments) {
        delete seg.common_keyframes
        delete seg.audio_fade
        delete seg.transition
        if (seg.clip) delete seg.clip.flip
      }
    }
    for (const material of old.materials.videos) delete material.crop
    const reopened = openProject(JSON.stringify(old)).draft
    const segments = reopened.tracks.flatMap((t) => t.segments)
    expect(segments.every((x) => Array.isArray(x.common_keyframes))).toBe(true)
    expect(segments.every((x) => x.audio_fade === null)).toBe(true)
    expect(segments.every((x) => x.transition === null)).toBe(true)
    expect(segments.every((x) => !x.clip || x.clip.flip.horizontal === false)).toBe(true)
    expect(reopened.materials.videos.every((m) => !isCropped(m.crop))).toBe(true)
  })

  it('rejects files that are not drafts', () => {
    expect(() => importCapCutDraft({ hello: 1 })).toThrow()
    expect(() => openProject('not json')).toThrow('File is not valid JSON')
  })

  it('round-trips a saved project', () => {
    const reopened = openProject(JSON.stringify(draft))
    expect(reopened.draft).toEqual(draft)
    expect(reopened.warnings).toEqual([])
  })
})
