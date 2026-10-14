// Reads a CapCut draft_content.json into our Draft. Only what this editor can
// render is carried over; everything else is reported in `warnings` rather than
// silently dropped.

import { cropRect, FULL_CROP, isAxisAligned, isCropRatio, rectToCrop } from './crop'
import { inOrder } from './animations'
import { isBlendName, type BlendName } from './blend'
import { isMaskProperty } from './keyframes'
import { MASK_TYPES } from './mask'
import { cleanPoints } from './speedCurve'
import { DEFAULT_TEXT_STYLE, familyValue, normalizeColor } from './textStyle'
import { fitSpeed } from './timing'
import { frameDuration, snapToFrame } from './time'
import {
  DEFAULT_CLIP,
  DEFAULT_MASK_CONFIG,
  newId,
  segmentEnd,
  type Adjust,
  type AudioFade,
  type AudioMaterial,
  type CanvasBackground,
  type Clip,
  type ClipAnimation,
  type Crop,
  type Draft,
  type KeyframeList,
  type KeyframeProperty,
  type MarkItem,
  type Mask,
  type Segment,
  type SpeedCurve,
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
// `mixed` is true when the text has several differently styled ranges; only
// the first is used.
// The name of a text's font file, if it has one.
const fontFile = (m: Json): string | null => {
  const path = asString(m.font_path)
  return path ? baseName(path) : null
}

function readText(m: Json): { material: TextMaterial; mixed: boolean } {
  let content = asString(m.content)
  let size = asNumber(m.font_size, 15)
  let color = normalizeColor(asString(m.text_color)) || '#ffffff'
  let mixed = false
  // Weight and slant live on the material as bold_width and italic_degree, and
  // on newer drafts also as flags on the style range.
  let bold = asNumber(m.bold_width, 0) > 0
  let italic = asNumber(m.italic_degree, 0) > 0
  let underline = m.underline === true
  try {
    const rich: unknown = JSON.parse(content)
    if (isObject(rich)) {
      content = asString(rich.text)
      const styles = asArray(rich.styles)
      mixed = styles.length > 1
      const style = styles[0]
      if (style) {
        bold ||= style.bold === true
        italic ||= style.italic === true
        underline ||= style.underline === true
        size = asNumber(style.size, size)
        const fill = isObject(style.fill) && isObject(style.fill.content) ? style.fill.content : null
        const solid = fill && isObject(fill.solid) ? fill.solid : null
        color = (solid && rgbToHex(solid.color)) || color
      }
    }
  } catch {
    // Older drafts store plain text here.
  }
  const d = DEFAULT_TEXT_STYLE
  const material: TextMaterial = {
    id: asString(m.id),
    type: 'text',
    content,
    font_size: size,
    text_color: color,
    // CapCut's font is a file; the text asks for the family of that file's
    // name, which draws once the file is imported (see textStyle.ts).
    font_family: fontFile(m) ? familyValue(fontFile(m)!.replace(/\.(ttf|otf|woff2?)$/i, '')) : d.font_family,
    bold,
    italic,
    underline,
    alignment: [0, 1, 2].includes(m.alignment as number) ? (m.alignment as number) : d.alignment,
    letter_spacing: asNumber(m.letter_spacing, d.letter_spacing),
    line_spacing: asNumber(m.line_spacing, d.line_spacing),
    border_color: normalizeColor(asString(m.border_color)),
    border_width: asNumber(m.border_width, d.border_width),
    has_shadow: m.has_shadow === true,
    shadow_color: normalizeColor(asString(m.shadow_color)),
    shadow_alpha: asNumber(m.shadow_alpha, d.shadow_alpha),
    shadow_smoothing: asNumber(m.shadow_smoothing, d.shadow_smoothing),
    shadow_distance: asNumber(m.shadow_distance, d.shadow_distance),
    shadow_angle: asNumber(m.shadow_angle, d.shadow_angle),
    background_color: normalizeColor(asString(m.background_color)),
    background_alpha: asNumber(m.background_alpha, d.background_alpha),
    background_round_radius: asNumber(m.background_round_radius, d.background_round_radius),
  }
  return { material, mixed }
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
    'KFTypeBrightness',
    'KFTypeContrast',
    'KFTypeSaturation',
    'KFTypeCommonMaskSizeWidth',
    'KFTypeCommonMaskSizeHeight',
    'KFTypeCommonMaskPositionX',
    'KFTypeCommonMaskPositionY',
    'KFTypeCommonMaskRotation',
    'KFTypeCommonMaskFeather',
    'KFTypeCommonMaskRoundCorner',
  ],
  text: ['KFTypePositionX', 'KFTypePositionY', 'KFTypeScaleX', 'KFTypeScaleY', 'KFTypeRotation', 'KFTypeAlpha'],
  audio: ['KFTypeVolume'],
  adjust: [],
}

// Reads segment.common_keyframes. CapCut also keyframes colour properties
// alongside every transform keyframe; those have nothing to drive here and are
// skipped. Easing comes across as the bezier handles CapCut stores.
function readKeyframes(v: unknown, type: TrackType): KeyframeList[] {
  const lists: KeyframeList[] = []
  const point = (p: unknown) =>
    isObject(p) ? { x: asNumber(p.x, 0), y: asNumber(p.y, 0) } : { x: 0, y: 0 }
  for (const k of asArray(v)) {
    const property = KEYFRAME_PROPERTIES[type].find((p) => p === k.property_type)
    if (!property) continue
    const keyframe_list = asArray(k.keyframe_list)
      .filter((f) => Array.isArray(f.values) && typeof f.values[0] === 'number')
      .map((f) => ({
        id: asString(f.id) || newId(),
        time_offset: asNumber(f.time_offset, 0),
        values: [(f.values as number[])[0]],
        left_control: point(f.left_control),
        right_control: point(f.right_control),
      }))
      .sort((a, b) => a.time_offset - b.time_offset)
    if (keyframe_list.length) {
      lists.push({ id: asString(k.id) || newId(), property_type: property, keyframe_list })
    }
  }
  return lists
}

// Reads mark_items from a time_marks material (or the draft's own time_marks).
function readMarks(v: unknown): MarkItem[] {
  if (!isObject(v)) return []
  return asArray(v.mark_items)
    .filter((m) => isObject(m.time_range))
    .map((m) => ({
      id: asString(m.id) || newId(),
      color: normalizeColor(asString(m.color)) || '#00c1cd',
      title: asString(m.title),
      time_range: { start: asNumber((m.time_range as Json).start, 0), duration: 0 },
    }))
    .sort((a, b) => a.time_range.start - b.time_range.start)
}

// Features that live in a segment's extra_material_refs and are not rendered here.
// materials.effects holds many kinds of thing. These three types are colour
// adjustment, which is supported; the rest are reported by what they are.
const ADJUST_TYPES = ['brightness', 'contrast', 'saturation'] as const
const EFFECT_LABELS: Record<string, string> = {
  filter: 'filters',
  mix_mode: 'blend modes of a kind that is not supported',
  bloom: 'text glow',
  text_effect: 'text effects',
}
const effectLabel = (type: string): string => EFFECT_LABELS[type] ?? `"${type}" effects`

const UNSUPPORTED_REFS: Record<string, (m: Json) => boolean> = {
  video_effects: () => true,
  hsl: () => true,
  masks: () => true,
  audio_effects: () => true,
}

function readFade(m: Json): AudioFade | null {
  const fade = {
    fade_in_duration: Math.max(0, asNumber(m.fade_in_duration, 0)),
    fade_out_duration: Math.max(0, asNumber(m.fade_out_duration, 0)),
  }
  return fade.fade_in_duration > 0 || fade.fade_out_duration > 0 ? fade : null
}

const REF_LABELS: Record<string, string> = {
  video_effects: 'video effects',
  hsl: 'HSL adjustments',
  common_mask: 'masks of a kind that is not supported',
  masks: 'masks',
  audio_effects: 'audio effects',
  material_animations: 'loop or combo animations',
}

// A mask as CapCut stores it, or null for a kind of mask not drawn here.
function readMask(m: Json): Mask | null {
  // Heart and Star share a resource_type and are told apart by name.
  const kind =
    m.resource_type === 'geometric_shape'
      ? MASK_TYPES.find((k) => k.type === 'geometric_shape' && k.name.toLowerCase() === asString(m.name).toLowerCase())
      : MASK_TYPES.find((k) => k.type === m.resource_type)
  if (!kind) return null
  const c = isObject(m.config) ? m.config : {}
  const d = DEFAULT_MASK_CONFIG
  return {
    name: asString(m.name) || kind.name,
    resource_type: kind.type,
    config: {
      width: Math.max(0.001, asNumber(c.width, d.width)),
      height: Math.max(0.001, asNumber(c.height, d.height)),
      centerX: asNumber(c.centerX, 0),
      centerY: asNumber(c.centerY, 0),
      rotation: asNumber(c.rotation, 0),
      feather: Math.min(1, Math.max(0, asNumber(c.feather, 0))),
      roundCorner: Math.min(1, Math.max(0, asNumber(c.roundCorner, 0))),
      invert: c.invert === true,
    },
  }
}

// A speed ramp as CapCut stores it on the clip's speed material.
function readCurve(raw: Record<string, unknown>): SpeedCurve | null {
  if (!Array.isArray(raw.speed_points)) return null
  const points = cleanPoints(
    raw.speed_points.filter(isObject).map((p) => ({ x: asNumber(p.x, NaN), y: asNumber(p.y, NaN) })),
  )
  return points && { name: asString(raw.name) || 'Custom', speed_points: points }
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
      crop_ratio: isCropRatio(m.crop_ratio) ? m.crop_ratio : 'free',
      ...(asString(m.material_name) ? { material_name: asString(m.material_name) } : {}),
    })
  }
  // What compound clips hold, imported like any draft. Warnings from inside
  // them are reported once each, after the outer draft's own.
  const innerWarnings: string[] = []
  const audios = new Map<string, AudioMaterial>()
  for (const m of asArray(materialsIn.audios)) {
    audios.set(asString(m.id), {
      id: asString(m.id),
      type: 'audio',
      name: asString(m.name) || baseName(asString(m.path)),
      path: baseName(asString(m.path)),
      duration: asNumber(m.duration, 0),
    })
  }
  const texts = new Map<string, TextMaterial>()
  const mixedTexts = new Set<string>()
  for (const m of asArray(materialsIn.texts)) {
    const { material, mixed } = readText(m)
    texts.set(material.id, material)
    if (mixed) mixedTexts.add(material.id)
  }

  // id -> [material array name, material], for resolving extra_material_refs.
  const refIndex = new Map<string, [string, Json]>()
  for (const [kind, list] of Object.entries(materialsIn)) {
    for (const m of asArray(list)) refIndex.set(asString(m.id), [kind, m])
  }

  const pools: Record<TrackType, Map<string, { id: string }>> = { video: videos, audio: audios, text: texts, adjust: new Map() }
  const skippedTracks = new Map<string, number>()
  const unsupportedRefs = new Map<string, number>()
  let replacedTransitions = 0
  let replacedAnimations = 0
  let imageBackgrounds = 0
  let reversed = 0
  let dropped = 0
  const counts: Record<TrackType, number> = { video: 0, audio: 0, text: 0, adjust: 0 }
  const tracks: Track[] = []
  const mainTrackIds = new Set<string>()

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
      let curve: SpeedCurve | null = null
      let mask: Mask | null = null
      const animations: ClipAnimation[] = []
      let mixMode: BlendName | null = null
      let fade: AudioFade | null = null
      let transition: Transition | null = null
      let canvas: CanvasBackground | null = null
      let marks: MarkItem[] = []
      const adjust: Adjust = { brightness: 0, contrast: 0, saturation: 0 }
      const seen = new Set<string>()
      for (const ref of refs) {
        const hit = refIndex.get(asString(ref))
        if (!hit) continue
        const [kind, m] = hit
        if (kind === 'speeds' && isObject(m.curve_speed)) curve = readCurve(m.curve_speed)
        if (kind === 'common_mask' && type === 'video' && s.enable_video_mask !== false) {
          mask = readMask(m)
          if (!mask) seen.add(kind)
        }
        if (kind === 'material_animations' && type !== 'audio') {
          for (const a of asArray(m.animations)) {
            if (a.type !== 'in' && a.type !== 'out') {
              seen.add(kind)
              continue
            }
            if (animations.some((x) => x.type === a.type)) continue
            // Only CapCut's fades have an equivalent here; any other look
            // becomes a fade of the same length.
            const name = a.type === 'in' ? 'Fade In' : 'Fade Out'
            if (a.name !== name) replacedAnimations++
            const length = Math.max(0, asNumber(a.duration, 0))
            if (length > 0) animations.push({ type: a.type, name, duration: length })
          }
        }
        if (kind === 'drafts' && type === 'video' && m.type === 'combination' && isObject(m.draft)) {
          const video = videos.get(materialId)
          if (video && !video.compound) {
            const inner = importCapCutDraft(m.draft)
            for (const w of inner.warnings) innerWarnings.push(`Inside ${video.material_name || 'a compound clip'}: ${w}`)
            videos.set(materialId, { ...video, path: '', compound: inner.draft })
          }
        }
        if (kind === 'audio_fades') fade = readFade(m)
        // Clip markers are in the clip's source time, which is how they are kept here too.
        if (kind === 'time_marks') marks = readMarks(m)
        if (kind === 'canvases' && type === 'video') {
          // No local draft sets a background, so this follows the field names
          // alone; the scale of the blur value in CapCut is not known.
          const color = normalizeColor(asString(m.color))
          const blur = asNumber(m.blur, 0)
          if (m.type === 'canvas_blur' || (m.type !== 'canvas_image' && blur > 0)) {
            canvas = { type: 'canvas_blur', blur: Math.min(1, Math.max(0, blur)) }
          } else if (m.type === 'canvas_image' || asString(m.image)) {
            imageBackgrounds++
          } else if (color) {
            canvas = { type: 'canvas_color', color }
          }
        }
        if (kind === 'transitions' && type === 'video') {
          // Only CapCut's cross-dissolve has an equivalent here; any other
          // look becomes a Mix of the same length.
          if (m.name !== 'Mix') replacedTransitions++
          transition = { name: 'Mix', duration: Math.max(0, asNumber(m.duration, 0)) }
        }
        if (kind === 'effects') {
          const adjustType = ADJUST_TYPES.find((a) => a === m.type)
          // enable_adjust false means the values are set but switched off.
          if (m.type === 'mix_mode' && type === 'video' && isBlendName(m.name)) {
            mixMode = m.name
          } else if (adjustType && type === 'video') {
            if (s.enable_adjust !== false) {
              adjust[adjustType] = Math.min(1, Math.max(-1, asNumber(m.value, 0)))
            }
          } else {
            seen.add(`effects:${asString(m.type)}`)
          }
        }
        if (UNSUPPORTED_REFS[kind]?.(m)) seen.add(kind)
      }
      for (const kind of seen) unsupportedRefs.set(kind, (unsupportedRefs.get(kind) ?? 0) + 1)
      if (type === 'video' && s.reverse === true) reversed++
      // Mask keyframes mean nothing without the mask they animate.
      const keyframes = readKeyframes(s.common_keyframes, type).filter(
        (k) => mask !== null || !isMaskProperty(k.property_type),
      )

      const speed = asNumber(s.speed, 1) || 1
      const source = timeRange(s.source_timerange)
      // A ramp needs the source range it was drawn over, so it is dropped
      // where the draft has none.
      const ramp = type === 'text' || !source ? null : curve
      const segment: Segment = {
        id: asString(s.id) || newId(),
        material_id: materialId,
        source_timerange:
          type === 'text'
            ? null
            : {
                start: source?.start ?? 0,
                duration: source ? source.duration : Math.round(duration * speed),
              },
        target_timerange: { start, duration },
        speed: type === 'text' ? 1 : speed,
        curve_speed: ramp,
        volume: asNumber(s.volume, 1),
        clip: type === 'audio' ? null : readClip(s.clip),
        visible: s.visible !== false,
        common_keyframes: keyframes,
        audio_fade: type === 'text' ? null : fade,
        transition,
        canvas,
        reverse: type === 'video' && s.reverse === true,
        freeze: false,
        group_id: asString(s.group_id),
        // Text has no source, so its markers would mean something else; none seen.
        time_marks: type === 'text' ? [] : marks,
        adjust,
        mask,
        animations: inOrder(animations),
        mix_mode: mixMode,
      }
      // CapCut's stored speed for a ramped clip is sometimes the ramp's own
      // average and sometimes source over timeline length; the two differ by
      // the rounding of the clip to whole frames. The second is what plays.
      segments.push(fitSpeed(segment))
    }
    segments.sort((a, b) => a.target_timerange.start - b.target_timerange.start)
    counts[type]++
    const label = type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Text'
    const trackId = asString(t.id) || newId()
    if (type === 'video' && asNumber(t.flag, 0) === 0) mainTrackIds.add(trackId)
    tracks.push({
      id: trackId,
      type,
      name: asString(t.name) || `${label} ${counts[type]}`,
      segments,
      // Lock, hide and mute, as CapCut keeps them. See tracks.ts.
      ...(asNumber(t.attribute, 0) ? { attribute: asNumber(t.attribute, 0) } : {}),
    })
  }

  // CapCut lists audio tracks last. Here array order is render order and the
  // timeline shows it top-down, so audio moves to the front to sit at the bottom.
  tracks.sort((x, y) => Number(y.type === 'audio') - Number(x.type === 'audio'))

  const firstVideo = tracks.find((t) => t.type === 'video')
  const firstVideoIsMain = firstVideo !== undefined && mainTrackIds.has(firstVideo.id)

  const used = new Set(tracks.flatMap((t) => t.segments.map((s) => s.material_id)))
  const keep = <T extends { id: string }>(pool: Map<string, T>) =>
    [...pool.values()].filter((m) => used.has(m.id))

  const warnings: string[] = []
  for (const [type, n] of skippedTracks) {
    warnings.push(`${n} ${type || 'unknown'} track${n === 1 ? '' : 's'} not imported`)
  }
  for (const [kind, n] of unsupportedRefs) {
    const label = kind.startsWith('effects:') ? effectLabel(kind.slice(8)) : REF_LABELS[kind]
    warnings.push(`${n} ${n === 1 ? 'clip uses' : 'clips use'} ${label}, which were not imported`)
  }
  const rotated = [...rotatedCrops].filter((id) => used.has(id)).length
  if (rotated) {
    warnings.push(`${rotated} clip${rotated === 1 ? '' : 's'} with a rotated crop imported with an upright crop`)
  }
  // Fonts are files like any media: named here so they can be imported.
  const fontFiles = [
    ...new Set(
      asArray(materialsIn.texts)
        .filter((m) => used.has(asString(m.id)))
        .map(fontFile)
        .filter((f): f is string => f !== null),
    ),
  ]
  if (fontFiles.length) {
    warnings.push(
      `Text uses font file${fontFiles.length === 1 ? '' : 's'} ${fontFiles.join(', ')}: import ${fontFiles.length === 1 ? 'it' : 'them'} to see the text in ${fontFiles.length === 1 ? 'that font' : 'those fonts'}`,
    )
  }
  const mixed = [...mixedTexts].filter((id) => used.has(id)).length
  if (mixed) {
    warnings.push(`${mixed} text clip${mixed === 1 ? '' : 's'} with mixed styles imported with one style`)
  }
  if (reversed) {
    warnings.push(
      `${reversed} reversed clip${reversed === 1 ? '' : 's'} imported; check that the right part of the source plays`,
    )
  }
  if (imageBackgrounds) {
    warnings.push(
      `${imageBackgrounds} clip${imageBackgrounds === 1 ? '' : 's'} with an image background imported without it`,
    )
  }
  if (replacedTransitions) {
    warnings.push(
      `${replacedTransitions} transition${replacedTransitions === 1 ? '' : 's'} replaced with a Mix (cross-dissolve) of the same length`,
    )
  }
  if (replacedAnimations) {
    warnings.push(
      `${replacedAnimations} animation${replacedAnimations === 1 ? '' : 's'} replaced with a fade of the same length`,
    )
  }
  warnings.push(...innerWarnings)
  if (dropped) warnings.push(`${dropped} segment${dropped === 1 ? '' : 's'} could not be read and were skipped`)

  const draft: Draft = {
    app: 'cupcut',
    id: newId(),
    name: asString(json.name) || 'Imported draft',
    fps,
    duration: Math.max(0, ...tracks.flatMap((t) => t.segments.map(segmentEnd))),
    // The magnet keeps the first video track packed, which is only right if
    // that track is the one CapCut treats as the main track (flag 0).
    config: {
      maintrack_adsorb:
        isObject(json.config) && json.config.maintrack_adsorb === true && firstVideoIsMain,
      // CapCut's export_range is null in every draft seen, so its shape is
      // unknown and it is not read.
      export_range: null,
    },
    canvas_config: {
      width: asNumber(canvasIn.width, 0) || 1920,
      height: asNumber(canvasIn.height, 0) || 1080,
    },
    tracks: tracks.length ? tracks : [{ id: newId(), type: 'video', name: 'Video 1', segments: [] }],
    // Null in every draft seen; read on the assumption it has the same shape.
    time_marks: readMarks(json.time_marks),
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
        for (const list of segment.common_keyframes) {
          for (const keyframe of list.keyframe_list) {
            keyframe.left_control ??= { x: 0, y: 0 }
            keyframe.right_control ??= { x: 0, y: 0 }
          }
        }
        segment.audio_fade ??= null
        segment.transition ??= null
        segment.canvas ??= null
        segment.reverse ??= false
        segment.freeze ??= false
        segment.group_id ??= ''
        segment.time_marks ??= []
        segment.curve_speed ??= null
        segment.mask ??= null
        segment.animations ??= []
        segment.mix_mode ??= null
        segment.adjust ??= { brightness: 0, contrast: 0, saturation: 0 }
        if (segment.clip) segment.clip.flip ??= { horizontal: false, vertical: false }
      }
    }
    draft.config ??= { maintrack_adsorb: false, export_range: null }
    draft.config.export_range ??= null
    draft.time_marks ??= []
    for (const material of draft.materials.audios) material.name ??= material.path
    for (const material of draft.materials.videos) material.crop ??= { ...FULL_CROP }
    draft.materials.texts = draft.materials.texts.map((m) => ({ ...DEFAULT_TEXT_STYLE, ...m }))
    return { draft, warnings: [] }
  }
  throw new Error('Unrecognised project file')
}
