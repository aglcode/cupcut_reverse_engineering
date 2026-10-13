// Pure edit operations on a Draft. Every op returns a new Draft (or the same
// object when the edit is not possible) and keeps these invariants, which are
// the ones observed in CapCut drafts:
//   - target ranges start and end on frame boundaries
//   - segments on one track never overlap
//   - source.duration == target.duration * speed (within rounding)
//   - draft.duration == the end of the last segment

import { splitFade } from './fades'
import { evalClip, isAnimated, shiftKeyframes } from './keyframes'
import { linkedIds } from './links'
import { DEFAULT_TEXT_STYLE } from './textStyle'
import { frameDuration, frameToUs, snapToFrame, US_PER_SEC, usToFrame } from './time'
import { sourceTimeAt, usesSourceTime } from './timing'
import {
  DEFAULT_CLIP,
  newId,
  segmentEnd,
  type AudioMaterial,
  type Clip,
  type Draft,
  type Segment,
  type TextMaterial,
  type TimeRange,
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

// Frames are not all the same length in microseconds (at 30 fps they alternate
// between 33333 and 33334), so a clip that keeps its microsecond duration when
// it moves can end a microsecond off the grid. Placement therefore works in
// whole frames: a clip keeps its length in frames, and its duration is taken
// from the grid at wherever it lands.
function placeAt(segment: Segment, start: number, fps: number): Segment {
  const first = Math.max(0, usToFrame(start, fps))
  const count = Math.max(1, usToFrame(segment.target_timerange.duration, fps))
  const placed = frameToUs(first, fps)
  const duration = frameToUs(first + count, fps) - placed
  const change = duration - segment.target_timerange.duration
  const src = segment.source_timerange
  return {
    ...segment,
    target_timerange: { start: placed, duration },
    // The source range follows by the same microsecond or so, to keep
    // source = target x speed.
    source_timerange:
      src && change !== 0
        ? {
            start: src.start,
            duration: Math.max(
              1,
              src.duration + Math.round(change * (segment.freeze ? 1 : segment.speed)),
            ),
          }
        : src,
  }
}

type FrameSpan = { from: number; to: number }

const frameSpan = (s: Segment, fps: number): FrameSpan => ({
  from: usToFrame(s.target_timerange.start, fps),
  to: usToFrame(segmentEnd(s), fps),
})

const spansOverlap = (a: FrameSpan, b: FrameSpan): boolean => a.from < b.to && b.from < a.to

// Nearest start to `desired` where a segment of `duration` fits on the track.
export function fitStart(
  track: Track,
  duration: number,
  desired: number,
  fps: number,
  ignoreId?: string,
): number {
  const count = Math.max(1, usToFrame(duration, fps))
  const want = Math.max(0, usToFrame(desired, fps))
  const others = track.segments.filter((s) => s.id !== ignoreId).map((s) => frameSpan(s, fps))
  const fits = (from: number) =>
    from >= 0 && !others.some((o) => spansOverlap({ from, to: from + count }, o))
  if (fits(want)) return frameToUs(want, fps)
  const candidates = others.flatMap((o) => [o.to, o.from - count]).filter(fits)
  const best = candidates.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a))
  return frameToUs(best, fps)
}

// The main track is the first video track. In every CapCut draft inspected
// (config.maintrack_adsorb true in all of them) it runs from zero with no gaps
// while other tracks have gaps, which is the behaviour reproduced here.
export const mainTrackIndex = (draft: Draft): number =>
  draft.tracks.findIndex((t) => t.type === 'video')

export const isMagnetTrack = (draft: Draft, trackIndex: number): boolean =>
  draft.config.maintrack_adsorb && trackIndex >= 0 && trackIndex === mainTrackIndex(draft)

// Lays clips end to end from zero, in the order given, each keeping its length
// in frames.
function packFromZero(segments: Segment[], fps: number): Segment[] {
  let cursor = 0
  return segments.map((s) => {
    const at = frameToUs(cursor, fps)
    cursor += Math.max(1, usToFrame(s.target_timerange.duration, fps))
    const packed = s.target_timerange.start === at && segmentEnd(s) === frameToUs(cursor, fps)
    return packed ? s : placeAt(s, at, fps)
  })
}

// Where to put a clip so that it slots into a packed track: in front of the
// first clip whose middle is at or after `edge`, or at the end. A tie goes in
// front.
function slotStart(others: Segment[], edge: number): number {
  for (const s of others) {
    if (edge <= s.target_timerange.start + s.target_timerange.duration / 2) {
      return s.target_timerange.start
    }
  }
  return others.length > 0 ? segmentEnd(others[others.length - 1]) : 0
}

const sameLayout = (a: Draft, b: Draft): boolean =>
  a.tracks.length === b.tracks.length &&
  a.tracks.every((track, i) => {
    const other = b.tracks[i].segments
    return (
      track.segments.length === other.length &&
      track.segments.every(
        (s, j) =>
          s.id === other[j].id &&
          s.target_timerange.start === other[j].target_timerange.start &&
          s.target_timerange.duration === other[j].target_timerange.duration,
      )
    )
  })

// Every edit that changes the tracks ends here: segments are put in timeline
// order (clips that start together keep the order they were given in), the
// main track is closed up if the magnet is on, and the duration is recomputed.
function finalize(draft: Draft, tracks: Track[]): Draft {
  const main = draft.config.maintrack_adsorb ? tracks.findIndex((t) => t.type === 'video') : -1
  const sorted = tracks.map((t, i) => {
    const segments = [...t.segments].sort(
      (a, b) => a.target_timerange.start - b.target_timerange.start,
    )
    return { ...t, segments: i === main ? packFromZero(segments, draft.fps) : segments }
  })
  const settled = main >= 0 ? followMainTrack(draft, sorted, main) : sorted
  const duration = Math.max(0, ...settled.flatMap((t) => t.segments.map(segmentEnd)))
  return { ...draft, tracks: settled, duration }
}

// When the magnet moves a main-track clip, the clips linked to it on other
// tracks move by the same amount, so extracted audio stays under its video.
// Only clips the edit itself left alone are moved: one the edit placed
// deliberately (a group drag, a trim) is already where it should be.
function followMainTrack(before: Draft, tracks: Track[], main: number): Track[] {
  const fps = before.fps
  const oldMain = before.tracks[mainTrackIndex(before)]
  const oldStart = new Map(oldMain?.segments.map((s) => [s.id, s.target_timerange.start]))
  // Frames each link's main-track clip moved by.
  const moved = new Map<string, number>()
  for (const s of tracks[main].segments) {
    const was = oldStart.get(s.id)
    if (!s.group_id || was === undefined || moved.has(s.group_id)) continue
    const shift = usToFrame(s.target_timerange.start, fps) - usToFrame(was, fps)
    if (shift !== 0) moved.set(s.group_id, shift)
  }
  if (moved.size === 0) return tracks

  const untouched = new Set(before.tracks.flatMap((t) => t.segments))
  return tracks.map((track, i) => {
    if (i === main) return track
    let segments = track.segments
    for (const s of track.segments) {
      const shift = s.group_id ? moved.get(s.group_id) : undefined
      if (shift === undefined || !untouched.has(s)) continue
      const wanted = frameToUs(usToFrame(s.target_timerange.start, fps) + shift, fps)
      // If something is in the way it takes the nearest free place instead.
      const start = fitStart({ ...track, segments }, s.target_timerange.duration, wanted, fps, s.id)
      segments = segments.map((x) => (x.id === s.id ? placeAt(s, start, fps) : x))
    }
    if (segments === track.segments) return track
    return {
      ...track,
      segments: [...segments].sort((a, b) => a.target_timerange.start - b.target_timerange.start),
    }
  })
}

// Turns the main-track magnet on or off. Turning it on closes any gaps there.
export function setMagnet(draft: Draft, on: boolean): Draft {
  if (draft.config.maintrack_adsorb === on) return draft
  return finalize({ ...draft, config: { ...draft.config, maintrack_adsorb: on } }, draft.tracks)
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
  if (isMagnetTrack(draft, draft.tracks.indexOf(track))) return draft
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
  const { start, duration } = segment.target_timerange
  const placed = placeAt(segment, fitStart(track, duration, start, draft.fps), draft.fps)
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
  const main = isAudio || !draft.config.maintrack_adsorb ? -1 : mainTrackIndex(draft)
  const room =
    main >= 0
      ? { draft, trackId: draft.tracks[main].id }
      : trackWithRoom(draft, isAudio ? 'audio' : 'video', start, duration)
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
    canvas: null,
    reverse: false,
    freeze: false,
    group_id: '',
  }
  const materials = isAudio
    ? { ...room.draft.materials, audios: [...room.draft.materials.audios, material] }
    : { ...room.draft.materials, videos: [...room.draft.materials.videos, material] }
  if (main >= 0) {
    // Slotted in at the cut nearest the playhead; the clips after it move along.
    const others = draft.tracks[main].segments
    const slotted = { ...segment, target_timerange: { start: slotStart(others, start), duration } }
    const tracks = draft.tracks.map((t, i) =>
      i === main ? { ...t, segments: [slotted, ...t.segments] } : t,
    )
    return { draft: finalize({ ...draft, materials }, tracks), segmentId: segment.id }
  }
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
    ...DEFAULT_TEXT_STYLE,
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
    canvas: null,
    reverse: false,
    freeze: false,
    group_id: '',
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
  if (isMagnetTrack(draft, draft.tracks.indexOf(target))) {
    // There are no free slots on a packed track, so the clip is reordered
    // and the others close up around it. It changes places with a neighbour
    // once its leading edge passes that neighbour's middle: its start when
    // dragged left, its end when dragged right. A clip arriving from another
    // track goes by its own middle.
    const others = target.segments.filter((s) => s.id !== segmentId)
    const from = loc.segment.target_timerange.start
    const edge =
      target.id !== loc.track.id
        ? desiredStart + duration / 2
        : desiredStart < from
          ? desiredStart
          : desiredStart + duration
    const slot = slotStart(others, edge)
    const slotted = { ...loc.segment, target_timerange: { start: slot, duration } }
    const next = finalize(
      draft,
      draft.tracks.map((t) => {
        const segments = t.segments.filter((s) => s.id !== segmentId)
        return { ...t, segments: t.id === target.id ? [slotted, ...segments] : segments }
      }),
    )
    return sameLayout(draft, next) ? draft : next
  }
  const start = fitStart(target, duration, desiredStart, draft.fps, segmentId)
  if (start === loc.segment.target_timerange.start && target.id === loc.track.id) return draft
  const moved = placeAt(loc.segment, start, draft.fps)
  const tracks = draft.tracks.map((t) => {
    const segments = t.segments.filter((s) => s.id !== segmentId)
    return { ...t, segments: t.id === target.id ? [...segments, moved] : segments }
  })
  return finalize(draft, tracks)
}

// Moves several segments together, each staying on its own track and keeping
// its distance from the others. `anchorId` is the one being dragged and
// `desiredStart` is where it should go. If the group would run into a clip
// that is not part of it, or off the start of the timeline, it stops at the
// nearest position where everything fits.
export function moveSegments(
  draft: Draft,
  segmentIds: string[],
  anchorId: string,
  desiredStart: number,
): Draft {
  const fps = draft.fps
  const moving = new Set(segmentIds)
  const anchor = findSegment(draft, anchorId)?.segment
  if (!anchor || !moving.has(anchorId)) return draft

  // Per track: the spans being moved and the ones staying put.
  const lanes = draft.tracks.map((track) => ({
    moved: track.segments.filter((s) => moving.has(s.id)).map((s) => frameSpan(s, fps)),
    fixed: track.segments.filter((s) => !moving.has(s.id)).map((s) => frameSpan(s, fps)),
  }))
  const fits = (shift: number) =>
    lanes.every(({ moved, fixed }) =>
      moved.every(
        (m) =>
          m.from + shift >= 0 &&
          !fixed.some((f) => spansOverlap({ from: m.from + shift, to: m.to + shift }, f)),
      ),
    )

  const wanted =
    Math.max(0, usToFrame(desiredStart, fps)) - usToFrame(anchor.target_timerange.start, fps)
  let shift = wanted
  if (!fits(shift)) {
    // Positions where some moved clip sits flush against a fixed one, or the
    // group's first clip sits at zero.
    const earliest = Math.min(...lanes.flatMap((l) => l.moved.map((m) => m.from)))
    const candidates = [
      -earliest,
      ...lanes.flatMap(({ moved, fixed }) =>
        moved.flatMap((m) => fixed.flatMap((f) => [f.to - m.from, f.from - m.to])),
      ),
    ].filter(fits)
    if (candidates.length === 0) return draft
    // Nearest to where the drag asked for; on a tie, the one that moves the
    // group less, so it stops at an obstacle rather than jumping past it.
    const cost = (s: number) => [Math.abs(s - wanted), Math.abs(s)]
    shift = candidates.reduce((a, b) => {
      const [da, ma] = cost(a)
      const [db, mb] = cost(b)
      return db < da || (db === da && mb < ma) ? b : a
    })
  }
  if (shift === 0) return draft

  const tracks = draft.tracks.map((track) => ({
    ...track,
    segments: track.segments.map((s) =>
      moving.has(s.id)
        ? placeAt(s, frameToUs(usToFrame(s.target_timerange.start, fps) + shift, fps), fps)
        : s,
    ),
  }))
  return finalize(draft, tracks)
}

// Removes segments and closes the gaps they leave: on each track, every clip
// after a removed one moves earlier by its length. Other tracks are untouched.
export function rippleDelete(draft: Draft, segmentIds: string[]): Draft {
  const doomed = new Set(segmentIds)
  if (!draft.tracks.some((t) => t.segments.some((s) => doomed.has(s.id)))) return draft
  const fps = draft.fps
  const tracks = draft.tracks.map((track) => {
    let removed = 0
    const segments = track.segments.flatMap((s) => {
      if (doomed.has(s.id)) {
        removed += Math.max(1, usToFrame(s.target_timerange.duration, fps))
        return []
      }
      if (removed === 0) return [s]
      const from = usToFrame(s.target_timerange.start, fps) - removed
      return [placeAt(s, frameToUs(from, fps), fps)]
    })
    return { ...track, segments }
  })
  return pruneMaterials(finalize(draft, tracks))
}

// Moves a clip together with everything linked to it. If one of them is on
// the magnet's main track, that clip is the one that is moved (it is reordered
// among its neighbours) and the rest follow it.
export function moveLinked(draft: Draft, segmentId: string, desiredStart: number): Draft {
  const dragged = findSegment(draft, segmentId)
  if (!dragged) return draft
  const ids = linkedIds(draft, segmentId)
  const onMain = ids
    .map((id) => findSegment(draft, id))
    .find((loc) => loc && isMagnetTrack(draft, loc.trackIndex))
  if (!onMain) return moveSegments(draft, ids, segmentId, desiredStart)
  const shift = desiredStart - dragged.segment.target_timerange.start
  return moveSegment(draft, onMain.segment.id, onMain.segment.target_timerange.start + shift)
}

// Takes the sound of a video clip out into its own audio clip, linked to the
// video. The audio clip plays the same file over the same range, and inherits
// the video clip's volume, volume keyframes and fades; the video goes silent.
export function extractAudio(draft: Draft, segmentId: string): AddResult | null {
  const loc = findSegment(draft, segmentId)
  if (!loc) return null
  const { segment } = loc
  const material = draft.materials.videos.find((m) => m.id === segment.material_id)
  const src = segment.source_timerange
  if (!material || material.type !== 'video' || !material.has_audio || !src || segment.freeze) {
    return null
  }
  // Nothing left to extract once the clip is silent.
  if (segment.volume <= 0 && !isAnimated(segment, 'KFTypeVolume')) return null

  const { start, duration } = segment.target_timerange
  const count = draft.materials.audios.filter((a) => a.name.startsWith('Extracted-')).length
  const audio: AudioMaterial = {
    id: newId(),
    type: 'audio',
    name: `Extracted-${count + 1}`,
    path: material.path,
    duration: material.duration,
  }
  const groupId = segment.group_id || newId()
  const extracted: Segment = {
    id: newId(),
    material_id: audio.id,
    source_timerange: { ...src },
    target_timerange: { start, duration },
    speed: segment.speed,
    volume: segment.volume,
    clip: null,
    visible: true,
    common_keyframes: structuredClone(
      segment.common_keyframes.filter((k) => k.property_type === 'KFTypeVolume'),
    ),
    audio_fade: segment.audio_fade,
    transition: null,
    canvas: null,
    reverse: segment.reverse,
    freeze: false,
    group_id: groupId,
  }
  const silent: Segment = {
    ...segment,
    volume: 0,
    common_keyframes: segment.common_keyframes.filter((k) => k.property_type !== 'KFTypeVolume'),
    audio_fade: null,
    group_id: groupId,
  }

  const room = trackWithRoom(draft, 'audio', start, duration)
  const tracks = room.draft.tracks.map((track) => ({
    ...track,
    segments:
      track.id === room.trackId
        ? [...track.segments, extracted]
        : track.segments.map((s) => (s.id === segmentId ? silent : s)),
  }))
  const materials = { ...draft.materials, audios: [...draft.materials.audios, audio] }
  return { draft: finalize({ ...room.draft, materials }, tracks), segmentId: extracted.id }
}

// Removes several segments in one step.
export function removeSegments(draft: Draft, segmentIds: string[]): Draft {
  const doomed = new Set(segmentIds)
  if (!draft.tracks.some((t) => t.segments.some((s) => doomed.has(s.id)))) return draft
  return pruneMaterials(
    finalize(
      draft,
      draft.tracks.map((t) => ({ ...t, segments: t.segments.filter((s) => !doomed.has(s.id)) })),
    ),
  )
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
  // A freeze frame, like a photo, can be any length.
  const limit = segment.freeze ? null : mediaLimit(draft, segment.material_id)
  const t = snapToFrame(time, fps)
  const magnet = isMagnetTrack(draft, loc.trackIndex)

  // Which end of the source range this timeline edge eats into. A reversed
  // clip plays its source backwards, so for it the two are swapped.
  const sourceSide = (edge === 'start') !== segment.reverse ? 'start' : 'end'
  // How far the edge can still be dragged outwards before the media runs out.
  const room =
    !src || limit === null
      ? Infinity
      : (sourceSide === 'start' ? src.start : limit - src.start - src.duration) / segment.speed

  let newStart = start
  let newEnd = end
  if (edge === 'start') {
    // On the magnet track the clip before does not block: the trimmed clip
    // grows and everything after it moves along. It may not pass that clip's
    // start, which would swap their order.
    const prev = index > 0 ? track.segments[index - 1] : null
    const prevEnd = !prev ? 0 : magnet ? prev.target_timerange.start + frame : segmentEnd(prev)
    const mediaFloor = room === Infinity ? 0 : ceilToFrame(start - room, fps)
    newStart = Math.min(Math.max(t, prevEnd, mediaFloor), end - frame)
  } else {
    const next = track.segments[index + 1]
    const nextStart = next && !magnet ? next.target_timerange.start : Infinity
    const mediaCeil = room === Infinity ? Infinity : floorToFrame(end + room, fps)
    newEnd = Math.max(Math.min(t, nextStart, mediaCeil), start + frame)
  }
  if (newStart === start && newEnd === end) return draft

  const newDuration = newEnd - newStart
  let source = src
  if (src) {
    const length = Math.round(newDuration * segment.speed)
    if (segment.freeze) {
      source = { start: src.start, duration: newDuration }
    } else if (sourceSide === 'start') {
      // A photo has no real source range, but its start still moves so that
      // keyframes, which are stored in source time, stay where they were.
      const srcEnd = src.start + src.duration
      const srcStart = limit === null ? srcEnd - length : Math.max(0, srcEnd - length)
      source = { start: srcStart, duration: srcEnd - srcStart }
    } else {
      source = {
        start: src.start,
        duration: limit === null ? length : Math.min(length, limit - src.start),
      }
    }
  }
  return replaceSegment(draft, loc, {
    ...segment,
    source_timerange: source,
    target_timerange: { start: newStart, duration: newDuration },
    // Keyframes that count from the segment start move with it.
    common_keyframes: usesSourceTime(segment)
      ? segment.common_keyframes
      : shiftKeyframes(segment.common_keyframes, start - newStart),
  })
}

export function splitSegment(draft: Draft, segmentId: string, time: number): Draft {
  const loc = findSegment(draft, segmentId)
  if (!loc) return draft
  const { segment } = loc
  const { start, duration } = segment.target_timerange
  const end = start + duration
  const t = snapToFrame(time, draft.fps)
  if (t <= start || t >= end) return draft

  const src = segment.source_timerange
  let leftSource: TimeRange | null = null
  let rightSource: TimeRange | null = null
  if (src && segment.freeze) {
    leftSource = { start: src.start, duration: t - start }
    rightSource = { start: src.start, duration: end - t }
  } else if (src) {
    const played = Math.round((t - start) * segment.speed)
    const rest = src.duration - played
    // Reversed, the earlier half on the timeline shows the later half of the source.
    leftSource = segment.reverse
      ? { start: src.start + rest, duration: played }
      : { start: src.start, duration: played }
    rightSource = segment.reverse
      ? { start: src.start, duration: rest }
      : { start: src.start + played, duration: rest }
  }
  // Two text segments sharing one material would be edited together, so the
  // right half gets its own copy.
  const text = draft.materials.texts.find((m) => m.id === segment.material_id)
  const textCopy = text ? { ...text, id: newId() } : null
  const [leftFade, rightFade] = splitFade(segment)
  const left: Segment = {
    ...segment,
    source_timerange: leftSource,
    target_timerange: { start, duration: t - start },
    audio_fade: leftFade,
    // The transition is at the end of the clip, so the right half keeps it.
    transition: null,
  }
  const right: Segment = {
    ...structuredClone(segment),
    id: newId(),
    material_id: textCopy ? textCopy.id : segment.material_id,
    source_timerange: rightSource,
    target_timerange: { start: t, duration: end - t },
    common_keyframes: usesSourceTime(segment)
      ? structuredClone(segment.common_keyframes)
      : shiftKeyframes(segment.common_keyframes, start - t),
    audio_fade: rightFade,
    // The right half joins a new link, named after where the cut is, so that
    // linked clips cut at the same moment pair up half with half.
    group_id: segment.group_id ? `${segment.group_id}:${t}` : '',
  }
  const next = replaceSegment(draft, loc, left, right)
  if (!textCopy) return next
  return { ...next, materials: { ...next.materials, texts: [...next.materials.texts, textCopy] } }
}

// Plays a video clip's source range backwards, or forwards again.
export function setReverse(draft: Draft, segmentId: string, reverse: boolean): Draft {
  const loc = findSegment(draft, segmentId)
  if (!loc || loc.segment.freeze || loc.segment.reverse === reverse) return draft
  const material = draft.materials.videos.find((m) => m.id === loc.segment.material_id)
  if (!material || material.type !== 'video') return draft
  return replaceSegment(draft, loc, { ...loc.segment, reverse })
}

// Holds the frame under `time` as a still: the clip is cut there, the still is
// inserted, and everything after it on the same track moves later to make room.
export function freezeFrame(
  draft: Draft,
  segmentId: string,
  time: number,
  duration = DEFAULT_STILL_DURATION,
): AddResult | null {
  const loc = findSegment(draft, segmentId)
  if (!loc || loc.segment.freeze) return null
  const original = loc.segment
  const material = draft.materials.videos.find((m) => m.id === original.material_id)
  if (!material || material.type !== 'video') return null
  const fps = draft.fps
  const t = snapToFrame(time, fps)
  if (t < original.target_timerange.start || t >= segmentEnd(original)) return null

  const hold = Math.max(frameDuration(fps), floorToFrame(duration, fps))
  const frameAt = Math.round(sourceTimeAt(original, t))
  const still: Segment = {
    ...structuredClone(original),
    id: newId(),
    freeze: true,
    reverse: false,
    group_id: '',
    speed: 1,
    source_timerange: {
      start: Math.min(Math.max(0, frameAt), Math.max(0, material.duration - 1)),
      duration: hold,
    },
    target_timerange: { start: t, duration: hold },
    // The still keeps the look the clip had at that moment.
    clip: structuredClone(evalClip(original, t)),
    common_keyframes: [],
    audio_fade: null,
    transition: null,
  }

  const cut = t > original.target_timerange.start ? splitSegment(draft, segmentId, t) : draft
  const tracks = cut.tracks.map((track, i) => {
    if (i !== loc.trackIndex) return track
    const shifted = track.segments.map((s) =>
      s.target_timerange.start >= t
        ? { ...s, target_timerange: { ...s.target_timerange, start: s.target_timerange.start + hold } }
        : s,
    )
    return { ...track, segments: [...shifted, still] }
  })
  return { draft: finalize(cut, tracks), segmentId: still.id }
}

// Changes playback speed, keeping the same source range and resizing the
// segment on the timeline. If the slower clip would run into its neighbour it
// is cut short instead.
export function setSpeed(draft: Draft, segmentId: string, speed: number): Draft {
  const loc = findSegment(draft, segmentId)
  if (!loc || !loc.segment.source_timerange || !Number.isFinite(speed)) return draft
  const { segment, track, index } = loc
  const limit = mediaLimit(draft, segment.material_id)
  if (limit === null || segment.freeze) return draft
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
  if (clamped === segment.speed) return draft
  const fps = draft.fps
  const src = segment.source_timerange!
  const { start } = segment.target_timerange
  const next = track.segments[index + 1]
  // On the magnet track a slowed clip pushes the clips after it along.
  const room =
    next && !isMagnetTrack(draft, loc.trackIndex) ? next.target_timerange.start - start : Infinity
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
