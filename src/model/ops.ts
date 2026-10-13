// Pure edit operations on a Draft. Every op returns a new Draft (or the same
// object when the edit is not possible) and keeps these invariants, which are
// the ones observed in CapCut drafts:
//   - target ranges start and end on frame boundaries
//   - segments on one track never overlap
//   - source.duration == target.duration * speed (within rounding)
//   - draft.duration == the end of the last segment

import { splitFade } from './fades'
import { shiftKeyframes } from './keyframes'
import { frameDuration, frameToUs, snapToFrame, US_PER_SEC } from './time'
import {
  DEFAULT_CLIP,
  newId,
  segmentEnd,
  type AudioMaterial,
  type Clip,
  type Draft,
  type Segment,
  type TextMaterial,
  type Track,
  type TrackType,
  type VideoMaterial,
} from './types'

export const MIN_SPEED = 0.1
export const MAX_SPEED = 100

export type SegmentLocation = { track: Track; trackIndex: number; segment: Segment; index: number }

export function findSegment(draft: Draft, segmentId: string): SegmentLocation | null {
  for (let trackIndex = 0; trackIndex < draft.tracks.length; trackIndex++) {
    const track = draft.tracks[trackIndex]
    const index = track.segments.findIndex((s) => s.id === segmentId)
    if (index >= 0) return { track, trackIndex, segment: track.segments[index], index }
  }
  return null
}

export function findMaterial(
  draft: Draft,
  materialId: string,
): VideoMaterial | AudioMaterial | TextMaterial | null {
  const { videos, audios, texts } = draft.materials
  return (
    videos.find((m) => m.id === materialId) ??
    audios.find((m) => m.id === materialId) ??
    texts.find((m) => m.id === materialId) ??
    null
  )
}

// Length of the underlying media, or null when a segment can be any length
// (photos and text).
export function mediaLimit(draft: Draft, materialId: string): number | null {
  const m = findMaterial(draft, materialId)
  if (!m || m.type === 'text' || m.type === 'photo') return null
  return m.duration
}

const floorToFrame = (us: number, fps: number): number =>
  frameToUs(Math.max(0, Math.floor(((us + 1) * fps) / US_PER_SEC)), fps)

const ceilToFrame = (us: number, fps: number): number =>
  frameToUs(Math.max(0, Math.ceil((us * fps) / US_PER_SEC)), fps)

const overlaps = (start: number, duration: number, s: Segment): boolean =>
  start < segmentEnd(s) && s.target_timerange.start < start + duration

// Nearest start to `desired` where a segment of `duration` fits on the track.
export function fitStart(
  track: Track,
  duration: number,
  desired: number,
  ignoreId?: string,
): number {
  const others = track.segments.filter((s) => s.id !== ignoreId)
  const fits = (start: number) => start >= 0 && !others.some((s) => overlaps(start, duration, s))
  if (fits(desired)) return desired
  const candidates = others
    .flatMap((s) => [segmentEnd(s), s.target_timerange.start - duration])
    .filter(fits)
  return candidates.reduce((best, c) =>
    Math.abs(c - desired) < Math.abs(best - desired) ? c : best,
  )
}

function finalize(draft: Draft, tracks: Track[]): Draft {
  const sorted = tracks.map((t) => ({
    ...t,
    segments: [...t.segments].sort((a, b) => a.target_timerange.start - b.target_timerange.start),
  }))
  const duration = Math.max(0, ...sorted.flatMap((t) => t.segments.map(segmentEnd)))
  return { ...draft, tracks: sorted, duration }
}

function replaceSegment(draft: Draft, loc: SegmentLocation, ...replacement: Segment[]): Draft {
  const tracks = draft.tracks.map((t, i) =>
    i === loc.trackIndex
      ? { ...t, segments: t.segments.flatMap((s) => (s.id === loc.segment.id ? replacement : [s])) }
      : t,
  )
  return finalize(draft, tracks)
}

function pruneMaterials(draft: Draft): Draft {
  const used = new Set(draft.tracks.flatMap((t) => t.segments.map((s) => s.material_id)))
  const keep = <T extends { id: string }>(list: T[]) => list.filter((m) => used.has(m.id))
  const { videos, audios, texts } = draft.materials
  return { ...draft, materials: { videos: keep(videos), audios: keep(audios), texts: keep(texts) } }
}

export function addTrack(draft: Draft, type: TrackType): Draft {
  const count = draft.tracks.filter((t) => t.type === type).length
  const label = type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Text'
  const track: Track = { id: newId(), type, name: `${label} ${count + 1}`, segments: [] }
  // Audio has no render order, so it goes at the bottom of the stack.
  const tracks = type === 'audio' ? [track, ...draft.tracks] : [...draft.tracks, track]
  return { ...draft, tracks }
}

export function removeTrack(draft: Draft, trackId: string): Draft {
  const track = draft.tracks.find((t) => t.id === trackId)
  if (!track || draft.tracks.length === 1) return draft
  return pruneMaterials(
    finalize(
      draft,
      draft.tracks.filter((t) => t.id !== trackId),
    ),
  )
}

export function insertSegment(draft: Draft, trackId: string, segment: Segment): Draft {
  const track = draft.tracks.find((t) => t.id === trackId)
  if (!track) return draft
  const { duration } = segment.target_timerange
  const start = fitStart(track, duration, snapToFrame(segment.target_timerange.start, draft.fps))
  const placed = { ...segment, target_timerange: { start, duration } }
  return finalize(
    draft,
    draft.tracks.map((t) => (t.id === trackId ? { ...t, segments: [...t.segments, placed] } : t)),
  )
}

type AddResult = { draft: Draft; segmentId: string }

// First track of `type` that is free at `start` for `duration`, creating a
// track when every existing one is occupied there.
function trackWithRoom(
  draft: Draft,
  type: TrackType,
  start: number,
  duration: number,
): { draft: Draft; trackId: string } {
  const free = draft.tracks.find(
    (t) => t.type === type && !t.segments.some((s) => overlaps(start, duration, s)),
  )
  if (free) return { draft, trackId: free.id }
  const next = addTrack(draft, type)
  const created = type === 'audio' ? next.tracks[0] : next.tracks[next.tracks.length - 1]
  return { draft: next, trackId: created.id }
}

export const DEFAULT_STILL_DURATION = 3 * US_PER_SEC

export function addMedia(
  draft: Draft,
  material: VideoMaterial | AudioMaterial,
  at: number,
): AddResult {
  const fps = draft.fps
  const start = snapToFrame(at, fps)
  const natural = material.type === 'photo' ? DEFAULT_STILL_DURATION : material.duration
  const duration = Math.max(frameDuration(fps), floorToFrame(natural, fps))
  const isAudio = material.type === 'audio'
  const room = trackWithRoom(draft, isAudio ? 'audio' : 'video', start, duration)
  const segment: Segment = {
    id: newId(),
    material_id: material.id,
    source_timerange: { start: 0, duration },
    target_timerange: { start, duration },
    speed: 1,
    volume: 1,
    clip: isAudio ? null : structuredClone(DEFAULT_CLIP),
    visible: true,
    common_keyframes: [],
    audio_fade: null,
    transition: null,
  }
  const materials = isAudio
    ? { ...room.draft.materials, audios: [...room.draft.materials.audios, material] }
    : { ...room.draft.materials, videos: [...room.draft.materials.videos, material] }
  return {
    draft: insertSegment({ ...room.draft, materials }, room.trackId, segment),
    segmentId: segment.id,
  }
}

export function addText(draft: Draft, content: string, at: number): AddResult {
  const start = snapToFrame(at, draft.fps)
  const duration = floorToFrame(DEFAULT_STILL_DURATION, draft.fps)
  const room = trackWithRoom(draft, 'text', start, duration)
  const material: TextMaterial = {
    id: newId(),
    type: 'text',
    content,
    font_size: 15,
    text_color: '#ffffff',
  }
  const segment: Segment = {
    id: newId(),
    material_id: material.id,
    source_timerange: null,
    target_timerange: { start, duration },
    speed: 1,
    volume: 1,
    clip: structuredClone(DEFAULT_CLIP),
    visible: true,
    common_keyframes: [],
    audio_fade: null,
    transition: null,
  }
  const materials = { ...room.draft.materials, texts: [...room.draft.materials.texts, material] }
  return {
    draft: insertSegment({ ...room.draft, materials }, room.trackId, segment),
    segmentId: segment.id,
  }
}

export function removeSegment(draft: Draft, segmentId: string): Draft {
  const loc = findSegment(draft, segmentId)
  if (!loc) return draft
  return pruneMaterials(replaceSegment(draft, loc))
}

// Moves a segment to `desiredStart`, optionally onto another track of the same
// type. The segment lands in the nearest free slot rather than overlapping.
export function moveSegment(
  draft: Draft,
  segmentId: string,
  desiredStart: number,
  toTrackId?: string,
): Draft {
  const loc = findSegment(draft, segmentId)
  if (!loc) return draft
  const target = draft.tracks.find((t) => t.id === (toTrackId ?? loc.track.id))
  if (!target || target.type !== loc.track.type) return draft
  const { duration } = loc.segment.target_timerange
  const start = fitStart(target, duration, snapToFrame(desiredStart, draft.fps), segmentId)
  if (start === loc.segment.target_timerange.start && target.id === loc.track.id) return draft
  const moved = { ...loc.segment, target_timerange: { start, duration } }
  const tracks = draft.tracks.map((t) => {
    const segments = t.segments.filter((s) => s.id !== segmentId)
    return { ...t, segments: t.id === target.id ? [...segments, moved] : segments }
  })
  return finalize(draft, tracks)
}

// Drags one edge of a segment to `time`. Trimming never slips the media: the
// part of the source that stays on screen keeps its timeline position.
export function trimSegment(
  draft: Draft,
  segmentId: string,
  edge: 'start' | 'end',
  time: number,
): Draft {
  const loc = findSegment(draft, segmentId)
  if (!loc) return draft
  const { segment, track, index } = loc
  const fps = draft.fps
  const frame = frameDuration(fps)
  const { start, duration } = segment.target_timerange
  const end = start + duration
  const src = segment.source_timerange
  const limit = mediaLimit(draft, segment.material_id)
  const t = snapToFrame(time, fps)

  if (edge === 'start') {
    const prevEnd = index > 0 ? segmentEnd(track.segments[index - 1]) : 0
    const mediaFloor =
      src && limit !== null ? ceilToFrame(start - src.start / segment.speed, fps) : 0
    const newStart = Math.min(Math.max(t, prevEnd, mediaFloor), end - frame)
    if (newStart === start) return draft
    const newDuration = end - newStart
    let source = src
    if (src) {
      const srcEnd = src.start + src.duration
      // A photo has no real source range, but its start still moves so that
      // keyframes, which are stored in source time, stay where they were.
      const wanted = srcEnd - Math.round(newDuration * segment.speed)
      const srcStart = limit === null ? wanted : Math.max(0, wanted)
      source = { start: srcStart, duration: srcEnd - srcStart }
    }
    return replaceSegment(draft, loc, {
      ...segment,
      source_timerange: source,
      target_timerange: { start: newStart, duration: newDuration },
      // Text keyframes count from the segment start, which just moved.
      common_keyframes: src
        ? segment.common_keyframes
        : shiftKeyframes(segment.common_keyframes, start - newStart),
    })
  }

  const next = track.segments[index + 1]
  const nextStart = next ? next.target_timerange.start : Infinity
  const mediaCeil =
    src && limit !== null
      ? floorToFrame(start + (limit - src.start) / segment.speed, fps)
      : Infinity
  const newEnd = Math.max(Math.min(t, nextStart, mediaCeil), start + frame)
  if (newEnd === end) return draft
  const newDuration = newEnd - start
  let source = src
  if (src) {
    const wanted = Math.round(newDuration * segment.speed)
    source = { start: src.start, duration: limit === null ? wanted : Math.min(wanted, limit - src.start) }
  }
  return replaceSegment(draft, loc, {
    ...segment,
    source_timerange: source,
    target_timerange: { start, duration: newDuration },
  })
}

export function splitSegment(draft: Draft, segmentId: string, time: number): Draft {
  const loc = findSegment(draft, segmentId)
  if (!loc) return draft
  const { segment } = loc
  const { start, duration } = segment.target_timerange
  const t = snapToFrame(time, draft.fps)
  if (t <= start || t >= start + duration) return draft

  const src = segment.source_timerange
  const leftSrc = src ? Math.round((t - start) * segment.speed) : 0
  // Two text segments sharing one material would be edited together, so the
  // right half gets its own copy.
  const text = draft.materials.texts.find((m) => m.id === segment.material_id)
  const textCopy = text ? { ...text, id: newId() } : null
  const [leftFade, rightFade] = splitFade(segment)
  const left: Segment = {
    ...segment,
    source_timerange: src ? { start: src.start, duration: leftSrc } : null,
    target_timerange: { start, duration: t - start },
    audio_fade: leftFade,
    // The transition is at the end of the clip, so the right half keeps it.
    transition: null,
  }
  const right: Segment = {
    ...structuredClone(segment),
    id: newId(),
    material_id: textCopy ? textCopy.id : segment.material_id,
    source_timerange: src ? { start: src.start + leftSrc, duration: src.duration - leftSrc } : null,
    target_timerange: { start: t, duration: start + duration - t },
    common_keyframes: src
      ? structuredClone(segment.common_keyframes)
      : shiftKeyframes(segment.common_keyframes, start - t),
    audio_fade: rightFade,
  }
  const next = replaceSegment(draft, loc, left, right)
  if (!textCopy) return next
  return { ...next, materials: { ...next.materials, texts: [...next.materials.texts, textCopy] } }
}

// Changes playback speed, keeping the same source range and resizing the
// segment on the timeline. If the slower clip would run into its neighbour it
// is cut short instead.
export function setSpeed(draft: Draft, segmentId: string, speed: number): Draft {
  const loc = findSegment(draft, segmentId)
  if (!loc || !loc.segment.source_timerange || !Number.isFinite(speed)) return draft
  const { segment, track, index } = loc
  const limit = mediaLimit(draft, segment.material_id)
  if (limit === null) return draft
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
  if (clamped === segment.speed) return draft
  const fps = draft.fps
  const src = segment.source_timerange!
  const { start } = segment.target_timerange
  const next = track.segments[index + 1]
  const room = next ? next.target_timerange.start - start : Infinity
  const duration = Math.min(
    Math.max(frameDuration(fps), floorToFrame(src.duration / clamped, fps)),
    room,
  )
  return replaceSegment(draft, loc, {
    ...segment,
    speed: clamped,
    source_timerange: {
      start: src.start,
      duration: Math.min(Math.round(duration * clamped), limit - src.start),
    },
    target_timerange: { start, duration },
  })
}

export type SegmentPatch = { volume?: number; visible?: boolean; clip?: Partial<Clip> }

export function patchSegment(draft: Draft, segmentId: string, patch: SegmentPatch): Draft {
  const loc = findSegment(draft, segmentId)
  if (!loc) return draft
  const { segment } = loc
  const clip = patch.clip && segment.clip ? { ...segment.clip, ...patch.clip } : segment.clip
  return replaceSegment(draft, loc, {
    ...segment,
    volume: patch.volume ?? segment.volume,
    visible: patch.visible ?? segment.visible,
    clip,
  })
}

export function patchText(
  draft: Draft,
  materialId: string,
  patch: Partial<Omit<TextMaterial, 'id' | 'type'>>,
): Draft {
  const texts = draft.materials.texts.map((m) => (m.id === materialId ? { ...m, ...patch } : m))
  return { ...draft, materials: { ...draft.materials, texts } }
}

// Changing fps moves the frame grid, so every segment is re-snapped onto it.
export function setCanvas(
  draft: Draft,
  canvas: { width?: number; height?: number; fps?: number },
): Draft {
  const fps = canvas.fps ?? draft.fps
  const next: Draft = {
    ...draft,
    fps,
    canvas_config: {
      width: canvas.width ?? draft.canvas_config.width,
      height: canvas.height ?? draft.canvas_config.height,
    },
  }
  if (fps === draft.fps) return next
  const tracks = draft.tracks.map((t) => {
    let cursor = 0
    const segments = t.segments.map((s) => {
      const start = Math.max(cursor, snapToFrame(s.target_timerange.start, fps))
      const duration = Math.max(
        frameDuration(fps),
        snapToFrame(segmentEnd(s), fps) - snapToFrame(s.target_timerange.start, fps),
      )
      cursor = start + duration
      const limit = mediaLimit(draft, s.material_id)
      const src = s.source_timerange
      const source = src && {
        start: src.start,
        duration: Math.min(Math.round(duration * s.speed), (limit ?? Infinity) - src.start),
      }
      return { ...s, source_timerange: source, target_timerange: { start, duration } }
    })
    return { ...t, segments }
  })
  return finalize(next, tracks)
}
