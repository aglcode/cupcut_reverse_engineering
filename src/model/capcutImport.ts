// Reads a CapCut draft_content.json into our Draft. Only what this editor can
// render is carried over; everything else is reported in `warnings` rather than
// silently dropped.

import { cropRect, FULL_CROP, isAxisAligned, rectToCrop } from './crop'
import { frameDuration, snapToFrame } from './time'
import {
  DEFAULT_CLIP,
  newId,
  segmentEnd,
  type AudioFade,
  type AudioMaterial,
  type Clip,
  type Crop,
  type Draft,
  type KeyframeList,
  type KeyframeProperty,
  type Segment,
  type TextMaterial,
  type Track,
  type TrackType,
  type Transition,
  type VideoMaterial,
} from './types'

export type ImportResult = { draft: Draft; warnings: string[] }

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const asArray = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : [])
const asNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

export const isCapCutDraft = (v: unknown): v is Json =>
  isObject(v) && v.app !== 'cupcut' && Array.isArray(v.tracks) && isObject(v.materials)

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

function timeRange(v: unknown): { start: number; duration: number } | null {
  if (!isObject(v)) return null
  return { start: asNumber(v.start, 0), duration: asNumber(v.duration, 0) }
}

function rgbToHex(rgb: unknown): string | null {
  if (!Array.isArray(rgb) || rgb.length < 3) return null
  const hex = rgb
    .slice(0, 3)
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, asNumber(c, 1))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
  return `#${hex.join('')}`
}

// Text content is rich-text JSON stored inside a string:
// {"text":"GAS","styles":[{"fill":{"content":{"solid":{"color":[r,g,b]}}},"size":15,…}]}
function readText(m: Json): TextMaterial {
  let content = asString(m.content)
  let size = asNumber(m.font_size, 15)
  let color = asString(m.text_color) || '#ffffff'
  try {
    const rich: unknown = JSON.parse(content)
    if (isObject(rich)) {
      content = asString(rich.text)
      const style = asArray(rich.styles)[0]
      if (style) {
        size = asNumber(style.size, size)
        const fill = isObject(style.fill) && isObject(style.fill.content) ? style.fill.content : null
        const solid = fill && isObject(fill.solid) ? fill.solid : null
        color = (solid && rgbToHex(solid.color)) || color
      }
    }
  } catch {
    // Older drafts store plain text here.
  }
  return { id: asString(m.id), type: 'text', content, font_size: size, text_color: color }
}

function readClip(v: unknown): Clip {
  if (!isObject(v)) return structuredClone(DEFAULT_CLIP)
  const scale = isObject(v.scale) ? v.scale : {}
  const transform = isObject(v.transform) ? v.transform : {}
  const flip = isObject(v.flip) ? v.flip : {}
  return {
    scale: { x: asNumber(scale.x, 1), y: asNumber(scale.y, 1) },
    rotation: asNumber(v.rotation, 0),
    transform: { x: asNumber(transform.x, 0), y: asNumber(transform.y, 0) },
    flip: { horizontal: flip.horizontal === true, vertical: flip.vertical === true },
    alpha: asNumber(v.alpha, 1),
  }
}

// Reads a material's crop corners. `rotated` is true when they do not form an
// upright rectangle, in which case the bounding box is used.
function readCrop(v: unknown): { crop: Crop; rotated: boolean } {
  if (!isObject(v)) return { crop: { ...FULL_CROP }, rotated: false }
  const raw: Crop = {
    upper_left_x: asNumber(v.upper_left_x, 0),
    upper_left_y: asNumber(v.upper_left_y, 0),
    upper_right_x: asNumber(v.upper_right_x, 1),
    upper_right_y: asNumber(v.upper_right_y, 0),
    lower_left_x: asNumber(v.lower_left_x, 0),
    lower_left_y: asNumber(v.lower_left_y, 1),
    lower_right_x: asNumber(v.lower_right_x, 1),
    lower_right_y: asNumber(v.lower_right_y, 1),
  }
  return { crop: rectToCrop(cropRect(raw)), rotated: !isAxisAligned(raw) }
}

const KEYFRAME_PROPERTIES: Record<TrackType, KeyframeProperty[]> = {
  video: [
    'KFTypePositionX',
    'KFTypePositionY',
    'KFTypeScaleX',
    'KFTypeScaleY',
    'KFTypeRotation',
    'KFTypeAlpha',
    'KFTypeVolume',
  ],
  text: ['KFTypePositionX', 'KFTypePositionY', 'KFTypeScaleX', 'KFTypeScaleY', 'KFTypeRotation', 'KFTypeAlpha'],
  audio: ['KFTypeVolume'],
}

// Reads segment.common_keyframes. CapCut also keyframes colour properties
// alongside every transform keyframe; those have nothing to drive here and are
// skipped. `eased` reports keyframes whose curve is not the linear "Line" type.
function readKeyframes(v: unknown, type: TrackType): { lists: KeyframeList[]; eased: boolean } {
  const lists: KeyframeList[] = []
  let eased = false
  for (const k of asArray(v)) {
    const property = KEYFRAME_PROPERTIES[type].find((p) => p === k.property_type)
    if (!property) continue
    const keyframe_list = asArray(k.keyframe_list)
      .filter((f) => Array.isArray(f.values) && typeof f.values[0] === 'number')
      .map((f) => {
        if (f.curveType !== undefined && f.curveType !== 'Line') eased = true
        return {
          id: asString(f.id) || newId(),
          time_offset: asNumber(f.time_offset, 0),
          values: [(f.values as number[])[0]],
        }
      })
      .sort((a, b) => a.time_offset - b.time_offset)
    if (keyframe_list.length) {
      lists.push({ id: asString(k.id) || newId(), property_type: property, keyframe_list })
    }
  }
  return { lists, eased }
}

// Features that live in a segment's extra_material_refs and are not rendered here.
const UNSUPPORTED_REFS: Record<string, (m: Json) => boolean> = {
  effects: () => true,
  video_effects: () => true,
  hsl: () => true,
  common_mask: () => true,
  masks: () => true,
  audio_effects: () => true,
  material_animations: (m) => asArray(m.animations).length > 0,
}

function readFade(m: Json): AudioFade | null {
  const fade = {
    fade_in_duration: Math.max(0, asNumber(m.fade_in_duration, 0)),
    fade_out_duration: Math.max(0, asNumber(m.fade_out_duration, 0)),
  }
  return fade.fade_in_duration > 0 || fade.fade_out_duration > 0 ? fade : null
}

const REF_LABELS: Record<string, string> = {
  effects: 'colour adjustments or filters',
  video_effects: 'video effects',
  hsl: 'HSL adjustments',
  common_mask: 'masks',
  masks: 'masks',
  audio_effects: 'audio effects',
  material_animations: 'in/out animations',
}

export function importCapCutDraft(json: unknown): ImportResult {
  if (!isCapCutDraft(json)) throw new Error('Not a CapCut draft_content.json file')
  const fps = asNumber(json.fps, 30) || 30
  const materialsIn = json.materials as Json
  const canvasIn = isObject(json.canvas_config) ? json.canvas_config : {}

  const videos = new Map<string, VideoMaterial>()
  const rotatedCrops = new Set<string>()
  for (const m of asArray(materialsIn.videos)) {
    const { crop, rotated } = readCrop(m.crop)
    if (rotated) rotatedCrops.add(asString(m.id))
    videos.set(asString(m.id), {
      id: asString(m.id),
      type: m.type === 'photo' ? 'photo' : 'video',
      path: baseName(asString(m.path)),
      duration: asNumber(m.duration, 0),
      width: asNumber(m.width, 0),
      height: asNumber(m.height, 0),
      has_audio: m.has_audio === true,
      crop,
    })
  }
  const audios = new Map<string, AudioMaterial>()
  for (const m of asArray(materialsIn.audios)) {
    audios.set(asString(m.id), {
      id: asString(m.id),
      type: 'audio',
      path: baseName(asString(m.path)),
      duration: asNumber(m.duration, 0),
    })
  }
  const texts = new Map<string, TextMaterial>()
  for (const m of asArray(materialsIn.texts)) texts.set(asString(m.id), readText(m))

  // id -> [material array name, material], for resolving extra_material_refs.
  const refIndex = new Map<string, [string, Json]>()
  for (const [kind, list] of Object.entries(materialsIn)) {
    for (const m of asArray(list)) refIndex.set(asString(m.id), [kind, m])
  }

  const pools: Record<TrackType, Map<string, { id: string }>> = { video: videos, audio: audios, text: texts }
  const skippedTracks = new Map<string, number>()
  const unsupportedRefs = new Map<string, number>()
  let curveSpeed = 0
  let eased = 0
  let replacedTransitions = 0
  let dropped = 0
  const counts: Record<TrackType, number> = { video: 0, audio: 0, text: 0 }
  const tracks: Track[] = []

  for (const t of asArray(json.tracks)) {
    const type = asString(t.type)
    if (type !== 'video' && type !== 'audio' && type !== 'text') {
      skippedTracks.set(type, (skippedTracks.get(type) ?? 0) + 1)
      continue
    }
    const segments: Segment[] = []
    for (const s of asArray(t.segments)) {
      const target = timeRange(s.target_timerange)
      const materialId = asString(s.material_id)
      if (!target || !pools[type].has(materialId)) {
        dropped++
        continue
      }
      const start = snapToFrame(target.start, fps)
      const duration = Math.max(
        frameDuration(fps),
        snapToFrame(target.start + target.duration, fps) - start,
      )
      if (segments.some((o) => start < segmentEnd(o) && o.target_timerange.start < start + duration)) {
        dropped++
        continue
      }

      const refs = Array.isArray(s.extra_material_refs) ? s.extra_material_refs : []
      let isCurve = false
      let fade: AudioFade | null = null
      let transition: Transition | null = null
      const seen = new Set<string>()
      for (const ref of refs) {
        const hit = refIndex.get(asString(ref))
        if (!hit) continue
        const [kind, m] = hit
        if (kind === 'speeds' && (m.mode === 1 || isObject(m.curve_speed))) isCurve = true
        if (kind === 'audio_fades') fade = readFade(m)
        if (kind === 'transitions' && type === 'video') {
          // Only CapCut's cross-dissolve has an equivalent here; any other
          // look becomes a Mix of the same length.
          if (m.name !== 'Mix') replacedTransitions++
          transition = { name: 'Mix', duration: Math.max(0, asNumber(m.duration, 0)) }
        }
        if (UNSUPPORTED_REFS[kind]?.(m)) seen.add(kind)
      }
      for (const kind of seen) unsupportedRefs.set(kind, (unsupportedRefs.get(kind) ?? 0) + 1)
      if (isCurve) curveSpeed++
      const keyframes = readKeyframes(s.common_keyframes, type)
      if (keyframes.eased) eased++

      const speed = asNumber(s.speed, 1) || 1
      const source = timeRange(s.source_timerange)
      segments.push({
        id: asString(s.id) || newId(),
        material_id: materialId,
        source_timerange:
          type === 'text'
            ? null
            : {
                start: source?.start ?? 0,
                // A speed ramp plays its source at a varying rate; `speed` is
                // only the average, so the range is rebuilt to stay consistent.
                duration: isCurve || !source ? Math.round(duration * speed) : source.duration,
              },
        target_timerange: { start, duration },
        speed: type === 'text' ? 1 : speed,
        volume: asNumber(s.volume, 1),
        clip: type === 'audio' ? null : readClip(s.clip),
        visible: s.visible !== false,
        common_keyframes: keyframes.lists,
        audio_fade: type === 'text' ? null : fade,
        transition,
      })
    }
    segments.sort((a, b) => a.target_timerange.start - b.target_timerange.start)
    counts[type]++
    const label = type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Text'
    tracks.push({
      id: asString(t.id) || newId(),
      type,
      name: asString(t.name) || `${label} ${counts[type]}`,
      segments,
    })
  }

  // CapCut lists audio tracks last. Here array order is render order and the
  // timeline shows it top-down, so audio moves to the front to sit at the bottom.
  tracks.sort((x, y) => Number(y.type === 'audio') - Number(x.type === 'audio'))

  const used = new Set(tracks.flatMap((t) => t.segments.map((s) => s.material_id)))
  const keep = <T extends { id: string }>(pool: Map<string, T>) =>
    [...pool.values()].filter((m) => used.has(m.id))

  const warnings: string[] = []
  for (const [type, n] of skippedTracks) {
    warnings.push(`${n} ${type || 'unknown'} track${n === 1 ? '' : 's'} not imported`)
  }
  if (curveSpeed) {
    warnings.push(`${curveSpeed} clip${curveSpeed === 1 ? '' : 's'} with a speed ramp imported at average speed`)
  }
  for (const [kind, n] of unsupportedRefs) {
    warnings.push(`${n} ${n === 1 ? 'clip uses' : 'clips use'} ${REF_LABELS[kind]}, which were not imported`)
  }
  const rotated = [...rotatedCrops].filter((id) => used.has(id)).length
  if (rotated) {
    warnings.push(`${rotated} clip${rotated === 1 ? '' : 's'} with a rotated crop imported with an upright crop`)
  }
  if (replacedTransitions) {
    warnings.push(
      `${replacedTransitions} transition${replacedTransitions === 1 ? '' : 's'} replaced with a Mix (cross-dissolve) of the same length`,
    )
  }
  if (eased) {
    warnings.push(`${eased} clip${eased === 1 ? '' : 's'} with eased keyframes imported with linear motion`)
  }
  if (dropped) warnings.push(`${dropped} segment${dropped === 1 ? '' : 's'} could not be read and were skipped`)

  const draft: Draft = {
    app: 'cupcut',
    id: newId(),
    name: asString(json.name) || 'Imported draft',
    fps,
    duration: Math.max(0, ...tracks.flatMap((t) => t.segments.map(segmentEnd))),
    canvas_config: {
      width: asNumber(canvasIn.width, 0) || 1920,
      height: asNumber(canvasIn.height, 0) || 1080,
    },
    tracks: tracks.length ? tracks : [{ id: newId(), type: 'video', name: 'Video 1', segments: [] }],
    materials: { videos: keep(videos), audios: keep(audios), texts: keep(texts) },
  }
  return { draft, warnings }
}

// Opens either one of our own saved projects or a CapCut draft.
export function openProject(text: string): ImportResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON')
  }
  if (isCapCutDraft(json)) return importCapCutDraft(json)
  if (
    isObject(json) &&
    json.app === 'cupcut' &&
    Array.isArray(json.tracks) &&
    isObject(json.materials) &&
    isObject(json.canvas_config)
  ) {
    const draft = json as Draft
    // Projects saved by older versions lack the fields added since.
    for (const track of draft.tracks) {
      for (const segment of track.segments) {
        segment.common_keyframes ??= []
        segment.audio_fade ??= null
        segment.transition ??= null
        if (segment.clip) segment.clip.flip ??= { horizontal: false, vertical: false }
      }
    }
    for (const material of draft.materials.videos) material.crop ??= { ...FULL_CROP }
    return { draft, warnings: [] }
  }
  throw new Error('Unrecognised project file')
}
