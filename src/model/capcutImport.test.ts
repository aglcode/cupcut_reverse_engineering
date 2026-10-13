import { describe, expect, it } from 'vitest'
import { importCapCutDraft, openProject } from './capcutImport'
import { cropInsets, isCropped } from './crop'
import { easingAt, evalProperty } from './keyframes'
import { clipMarkers } from './markers'
import { addText } from './ops'
import { averageSpeed } from './speedCurve'
import { sourceTimeAt, speedAtTime } from './timing'
import { DEFAULT_TEXT_STYLE } from './textStyle'
import { emptyDraft } from './types'

// Hand-written in the shape of a real draft_content.json (CapCut 9.4), reduced
// to the fields the importer reads plus the kinds of things it must skip.
const fixture = {
  id: 'D1',
  version: 360000,
  name: '',
  duration: 3_000_000,
  fps: 30.0,
  canvas_config: { ratio: 'original', width: 1080, height: 1920, background: null },
  config: { video_mute: false, maintrack_adsorb: true },
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
          extra_material_refs: ['SP1', 'AN1', 'TR1', 'CV1', 'TM1', 'AD1', 'AD2', 'AD3'],
          enable_adjust: true,
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
                  right_control: { x: 0, y: 0 },
                  string_value: '',
                  time_offset: 1500000,
                  values: [1],
                },
                {
                  id: 'F1',
                  curveType: 'FreeCurveInOut',
                  graphID: '',
                  left_control: { x: 0, y: 0 },
                  // 0.42 of the 1 s to the next keyframe: CapCut's Ease In.
                  right_control: { x: 420000, y: 0 },
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
          extra_material_refs: ['SP2', 'AN0', 'CV2', 'MX1', 'AD4'],
          enable_adjust: false,
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
        name: 'Extracted20250625-1',
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
        alignment: 0,
        letter_spacing: 0,
        line_spacing: 0.02,
        border_color: '#FFFFFFFF',
        border_width: 0.059999998658895,
        border_alpha: 1,
        has_shadow: true,
        shadow_color: '#000000',
        shadow_alpha: 0.8,
        shadow_smoothing: 0.45,
        shadow_distance: 5,
        shadow_angle: -45,
        background_color: '',
        background_alpha: 1,
        background_round_radius: 0,
        bold_width: 0,
        italic_degree: 0,
        underline: true,
        font_path: 'C:/cache/effect/7311977840574992897/ZY Classical.ttf',
      },
    ],
    speeds: [
      { id: 'SP1', type: 'speed', mode: 0, speed: 1.0, curve_speed: null },
      {
        id: 'SP2',
        type: 'speed',
        mode: 1,
        // As found on a real clip: the ramp's own average is 5.2508, while
        // the clip, rounded to six frames, plays 966667 of source in 200000.
        speed: 5.2508055861414,
        curve_speed: {
          id: '6768730851543880206',
          name: 'Bullet',
          source_platform: 1,
          speed_points: [
            { x: 0, y: 9.666666984558105 },
            { x: 0.5, y: 0.829999983310699 },
            { x: 0.5, y: 0.839999973773956 },
            { x: 1, y: 9.666666984558105 },
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
    // The three adjust entries are as found on the one adjusted clip in a real draft.
    effects: [
      { id: 'AD1', type: 'brightness', value: 0, version: 'v2', path: 'C:/app/Resources/DefaultAdjustBundle/x' },
      { id: 'AD2', type: 'contrast', value: 0, version: 'v2', path: 'C:/app/Resources/DefaultAdjustBundle/x' },
      { id: 'AD3', type: 'saturation', value: -1, version: 'v2', path: 'C:/app/Resources/DefaultAdjustBundle/x' },
      { id: 'AD4', type: 'brightness', value: 0.5, version: 'v2', path: 'C:/app/Resources/DefaultAdjustBundle/x' },
      { id: 'MX1', type: 'mix_mode', value: 1, version: '', path: 'C:/cache/effect/1' },
    ],
    time_marks: [
      {
        id: 'TM1',
        mark_items: [
          { id: 'MK2', color: '#00c1cd', title: 'Marker 02', time_range: { start: 1200000, duration: 0 } },
          { id: 'MK1', color: '#00c1cd', title: 'Marker 01', time_range: { start: 700000, duration: 0 } },
        ],
      },
    ],
    canvases: [
      { id: 'CV1', type: 'canvas_color', color: '#112233FF', blur: 0, image: '', album_image: '' },
      { id: 'CV2', type: 'canvas_blur', color: '', blur: 0.375, image: '', album_image: '' },
      // The default every clip carries: no background.
      { id: 'CV0', type: 'canvas_color', color: '', blur: 0, image: '', album_image: '' },
    ],
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
    expect(draft.materials.audios[0].name).toBe('Extracted20250625-1')
  })

  it('unpacks rich text', () => {
    expect(draft.materials.texts[0]).toMatchObject({
      content: 'GAS',
      font_size: 15,
      text_color: '#d7691c',
    })
    expect(draft.tracks[2].segments[0].source_timerange).toBeNull()
  })

  it('imports a speed ramp with its points and its real source range', () => {
    const s = draft.tracks[1].segments[1]
    expect(s.source_timerange).toEqual({ start: 0, duration: 966667 })
    expect(s.curve_speed?.name).toBe('Bullet')
    expect(s.curve_speed?.speed_points.map((p) => p.x)).toEqual([0, 0.5, 0.5, 1])
    // Speed is what actually plays: source over timeline length.
    expect(s.speed).toBeCloseTo(966667 / 200000, 9)
    expect(averageSpeed(s.curve_speed!.speed_points)).toBeCloseTo(s.speed, 9)
    // Half the source has gone by half-way through this all but symmetrical
    // ramp, and it is at its slowest there.
    expect(sourceTimeAt(s, 1_100_000)).toBeCloseTo(966667 / 2, -2)
    expect(speedAtTime(s, 1_100_000)).toBeLessThan(1)
    expect(speedAtTime(s, 1_000_000)).toBeGreaterThan(8)
  })

  it('reports what it left out', () => {
    expect(warnings).toEqual([
      '1 effect track not imported',
      '1 filter track not imported',
      '1 clip uses blend modes, which were not imported',
      '1 text clip shown in the default font (CapCut fonts cannot be loaded)',
      '1 transition replaced with a Mix (cross-dissolve) of the same length',
      '1 animation replaced with a fade of the same length',
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
    // Halfway through an Ease In the value has covered about 31.5% of the change.
    expect(evalProperty(s, 'KFTypeAlpha', 500000)).toBeCloseTo(0.2 + 0.8 * 0.3154, 3)
    expect(easingAt(s, 0, 30)).toBe('Ease in')
  })

  it('imports text styling from the text material', () => {
    expect(draft.materials.texts[0]).toMatchObject({
      alignment: 0,
      border_color: '#ffffff',
      border_width: 0.059999998658895,
      has_shadow: true,
      shadow_color: '#000000',
      shadow_alpha: 0.8,
      background_color: '',
      underline: true,
      bold: false,
      italic: false,
      font_family: DEFAULT_TEXT_STYLE.font_family,
    })
  })

  it('gives new text the default style', () => {
    const { draft: fresh } = addText(emptyDraft(), 'Hi', 0)
    expect(fresh.materials.texts[0]).toMatchObject(DEFAULT_TEXT_STYLE)
  })

  it('imports a canvas background from the canvases material', () => {
    const [first, second] = draft.tracks[1].segments
    expect(first.canvas).toEqual({ type: 'canvas_color', color: '#112233' })
    expect(second.canvas).toEqual({ type: 'canvas_blur', blur: 0.375 })
    expect(draft.tracks[0].segments[0].canvas).toBeNull()
  })

  it('carries the main-track magnet setting across', () => {
    expect(draft.config.maintrack_adsorb).toBe(true)
    // Without a flag-0 video track there is no main track to keep packed.
    const overlayOnly = structuredClone(fixture)
    for (const track of overlayOnly.tracks) track.flag = 2
    expect(importCapCutDraft(overlayOnly).draft.config.maintrack_adsorb).toBe(false)
  })

  it('imports clip markers, which are in the source time of the clip', () => {
    const s = draft.tracks[1].segments[0]
    expect(s.time_marks.map((m) => [m.title, m.time_range.start])).toEqual([
      ['Marker 01', 700000],
      ['Marker 02', 1200000],
    ])
    // The clip plays source 0.5 s - 1.5 s from timeline 0, so they show at 0.2 s and 0.7 s.
    expect(clipMarkers(s).map((m) => m.time)).toEqual([200000, 700000])
    expect(draft.time_marks).toEqual([])
  })

  it('imports colour adjustment, and says what other effects it left out', () => {
    const [first, second] = draft.tracks[1].segments
    expect(first.adjust).toEqual({ brightness: 0, contrast: 0, saturation: -1 })
    // The second clip has brightness 0.5 stored but enable_adjust is false.
    expect(second.adjust).toEqual({ brightness: 0, contrast: 0, saturation: 0 })
    expect(warnings.some((w) => /colour adjustments/.test(w))).toBe(false)
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
        delete seg.canvas
        delete seg.reverse
        delete seg.group_id
        delete seg.time_marks
        delete seg.adjust
        delete seg.freeze
        if (seg.clip) delete seg.clip.flip
      }
    }
    delete old.config
    delete old.time_marks
    for (const material of old.materials.videos) delete material.crop
    for (const material of old.materials.audios) delete material.name
    for (const text of old.materials.texts) {
      for (const key of Object.keys(DEFAULT_TEXT_STYLE)) delete text[key]
    }
    const reopened = openProject(JSON.stringify(old)).draft
    const segments = reopened.tracks.flatMap((t) => t.segments)
    expect(segments.every((x) => Array.isArray(x.common_keyframes))).toBe(true)
    expect(segments.every((x) => x.audio_fade === null)).toBe(true)
    expect(segments.every((x) => x.transition === null)).toBe(true)
    expect(segments.every((x) => x.canvas === null)).toBe(true)
    expect(reopened.config).toEqual({ maintrack_adsorb: false, export_range: null })
    expect(segments.every((x) => x.group_id === '')).toBe(true)
    expect(segments.every((x) => Array.isArray(x.time_marks) && x.time_marks.length === 0)).toBe(true)
    expect(reopened.time_marks).toEqual([])
    expect(segments.every((x) => x.adjust.brightness === 0 && x.adjust.saturation === 0)).toBe(true)
    expect(reopened.materials.audios[0].name).toBe('song.mp3')
    expect(segments.every((x) => x.reverse === false && x.freeze === false)).toBe(true)
    expect(segments.every((x) => !x.clip || x.clip.flip.horizontal === false)).toBe(true)
    expect(reopened.materials.videos.every((m) => !isCropped(m.crop))).toBe(true)
    expect(reopened.materials.texts[0]).toMatchObject({ ...DEFAULT_TEXT_STYLE, content: 'GAS' })
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
