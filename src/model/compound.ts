// Compound clips: several clips folded into one clip that holds a timeline of
// its own.
//
// In a CapCut draft a compound clip is an ordinary video material with an
// empty path and a material_name such as "Compound clip1", sized to the
// canvas and as long as what it holds. The clip also references a
// materials.drafts entry of type "combination", and that entry carries a whole
// draft (tracks, materials, canvas, fps) under `draft`.
//
// Here the nested draft is kept on the video material itself, as `compound`,
// rather than in a separate pool: everything that copies, splits or crops a
// clip's material then carries the nested timeline along without knowing
// about it. That placement is this editor's own; the nested draft has the same
// shape as any other.

import { FULL_CROP } from './crop'
import { fitSpeed, sourceTimeAt, timelineTimeAt } from './timing'
import {
  addMedia,
  addTrack,
  findSegment,
  insertSegment,
  removeSegments,
  setMagnet,
  splitSegment,
  trimSegment,
} from './ops'
import { frameDuration } from './time'
import {
  emptyDraft,
  newId,
  segmentEnd,
  type Draft,
  type Segment,
  type Track,
  type VideoMaterial,
} from './types'

const COMPOUND_NAME = 'Compound clip'

export const isCompound = (material: { compound?: Draft } | null | undefined): boolean =>
  !!material && 'compound' in material && !!material.compound

// Whether a timeline has anything that makes a sound.
function hasSound(draft: Draft): boolean {
  return draft.tracks.some(
    (t) =>
      t.type === 'audio'
        ? t.segments.length > 0
        : t.type === 'video' &&
          t.segments.some((s) => {
            const m = draft.materials.videos.find((v) => v.id === s.material_id)
            return !!m && m.type === 'video' && (m.has_audio || isCompound(m))
          }),
  )
}

// Folds the given clips into one compound clip where the first of them
// started. Their tracks keep their order inside it, and the space between
// them is kept. Returns the new clip's id.
export function makeCompound(
  draft: Draft,
  segmentIds: string[],
): { draft: Draft; segmentId: string } | null {
  const chosen = new Set(segmentIds)
  const picked = draft.tracks.flatMap((t) => t.segments.filter((s) => chosen.has(s.id)))
  if (picked.length === 0) return null
  const start = Math.min(...picked.map((s) => s.target_timerange.start))
  const end = Math.max(...picked.map(segmentEnd))

  // The inner timeline: one track for each track that had chosen clips.
  const tracks: Track[] = draft.tracks
    .map((t) => ({
      ...t,
      id: newId(),
      segments: t.segments
        .filter((s) => chosen.has(s.id))
        .map((s) => ({
          ...structuredClone(s),
          target_timerange: { ...s.target_timerange, start: s.target_timerange.start - start },
        })),
    }))
    .filter((t) => t.segments.length > 0)
  const used = new Set(picked.map((s) => s.material_id))
  const keep = <T extends { id: string }>(list: T[]) => list.filter((m) => used.has(m.id)).map((m) => structuredClone(m))
  const count = draft.materials.videos.filter((m) => isCompound(m)).length
  const name = `${COMPOUND_NAME}${count + 1}`
  const inner: Draft = {
    ...emptyDraft(),
    name,
    fps: draft.fps,
    canvas_config: { ...draft.canvas_config },
    duration: end - start,
    tracks,
    materials: {
      ...emptyDraft().materials,
      videos: keep(draft.materials.videos),
      audios: keep(draft.materials.audios),
      texts: keep(draft.materials.texts),
    },
  }

  const material: VideoMaterial = {
    id: newId(),
    type: 'video',
    path: '',
    material_name: name,
    duration: inner.duration,
    width: draft.canvas_config.width,
    height: draft.canvas_config.height,
    has_audio: hasSound(inner),
    crop: { ...FULL_CROP },
    crop_ratio: 'free',
    compound: inner,
  }
  const added = addMedia(removeSegments(draft, segmentIds), material, start)
  return { draft: added.draft, segmentId: added.segmentId }
}

// A compound clip can be broken apart where its timeline maps onto the outer
// one in a straight line: playing forwards at one speed. The clips inside are
// then sped up or slowed down by the same amount. A reversed, frozen or ramped
// compound clip would need each clip inside reversed or ramped in step, which
// is not done.
export function canBreakApart(draft: Draft, segmentId: string): boolean {
  const loc = findSegment(draft, segmentId)
  if (!loc) return false
  const s = loc.segment
  const m = draft.materials.videos.find((v) => v.id === s.material_id)
  return isCompound(m) && !s.curve_speed && !s.reverse && !s.freeze
}

// The part of a timeline between `from` and `to`, with clips that cross either
// end cut there.
function window(inner: Draft, from: number, to: number): Draft {
  let d = inner
  for (const t of inner.tracks) {
    for (const s of t.segments) {
      if (s.target_timerange.start < from && segmentEnd(s) > from) d = splitSegment(d, s.id, from)
    }
  }
  for (const t of d.tracks) {
    for (const s of t.segments) {
      if (s.target_timerange.start < to && segmentEnd(s) > to) d = splitSegment(d, s.id, to)
    }
  }
  const outside = d.tracks.flatMap((t) =>
    t.segments.filter((s) => s.target_timerange.start < from || segmentEnd(s) > to).map((s) => s.id),
  )
  return outside.length ? removeSegments(d, outside) : d
}

// Puts a compound clip's contents back on the timeline in its place: the part
// it shows, at the time it shows it. The compound clip's own settings (its
// position, effects and so on) do not carry over to the clips.
export function breakApart(draft: Draft, segmentId: string): { draft: Draft; segmentIds: string[] } | null {
  if (!canBreakApart(draft, segmentId)) return null
  const loc = findSegment(draft, segmentId)!
  const outer = loc.segment
  const material = draft.materials.videos.find((v) => v.id === outer.material_id)!
  const src = outer.source_timerange!
  const inner = window(material.compound!, src.start, src.start + src.duration)
  // Inner time to outer time.
  const rate = outer.speed
  const toOuter = (t: number) => outer.target_timerange.start + (t - src.start) / rate

  // Placed with the magnet off, so nothing closes up underneath while the
  // clips go in; it is put back on afterwards.
  const magnet = draft.config.maintrack_adsorb
  let d = removeSegments(setMagnet(draft, false), [segmentId])
  const fresh = <T extends { id: string }>(have: T[], add: T[]) => [...have, ...add.filter((m) => !have.some((h) => h.id === m.id))]
  d = {
    ...d,
    materials: {
      ...d.materials,
      videos: fresh(d.materials.videos, inner.materials.videos),
      audios: fresh(d.materials.audios, inner.materials.audios),
      texts: fresh(d.materials.texts, inner.materials.texts),
    },
  }
  const placedIds: string[] = []
  // The compound clip's own track takes the first inner track of its kind.
  let home: string | null = loc.track.id
  for (const t of inner.tracks) {
    const moved: Segment[] = t.segments.map((s) => retime(s, toOuter(s.target_timerange.start), rate))
    const free = (track: Track) =>
      track.type === t.type &&
      !track.segments.some((o) =>
        moved.some((s) => s.target_timerange.start < segmentEnd(o) && o.target_timerange.start < segmentEnd(s)),
      )
    const homeTrack = home ? d.tracks.find((x) => x.id === home && free(x)) : undefined
    let target = homeTrack ?? d.tracks.find(free)
    if (homeTrack) home = null
    if (!target) {
      d = addTrack(d, t.type)
      target = t.type === 'audio' ? d.tracks[0] : d.tracks[d.tracks.length - 1]
    }
    for (const s of moved) {
      d = insertSegment(d, target.id, s)
      placedIds.push(s.id)
    }
  }
  return { draft: magnet ? setMagnet(d, true) : d, segmentIds: placedIds }
}

// A clip from inside a compound clip, placed at `start` and played `rate`
// times faster, as the compound clip played it. Things measured in timeline
// time (fades, transitions, animations, and the keyframes and markers of
// clips without a moving source) shrink or grow with it.
function retime(s: Segment, start: number, rate: number): Segment {
  const target = { start, duration: s.target_timerange.duration / rate }
  if (rate === 1) return { ...s, target_timerange: target }
  const timelineBased = !s.source_timerange || s.freeze
  const scaleKeys = <T extends { time_offset: number }>(f: T): T => ({ ...f, time_offset: f.time_offset / rate })
  const moved: Segment = {
    ...s,
    target_timerange: target,
    speed: s.source_timerange && !s.freeze ? s.speed * rate : s.speed,
    audio_fade: s.audio_fade && {
      fade_in_duration: s.audio_fade.fade_in_duration / rate,
      fade_out_duration: s.audio_fade.fade_out_duration / rate,
    },
    transition: s.transition && { ...s.transition, duration: s.transition.duration / rate },
    animations: s.animations.map((a) => ({ ...a, duration: a.duration / rate })),
    common_keyframes: timelineBased
      ? s.common_keyframes.map((k) => ({ ...k, keyframe_list: k.keyframe_list.map(scaleKeys) }))
      : s.common_keyframes,
    time_marks: timelineBased
      ? s.time_marks.map((m) => ({ ...m, time_range: { ...m.time_range, start: m.time_range.start / rate } }))
      : s.time_marks,
  }
  return s.curve_speed ? fitSpeed(moved) : moved
}

// After the timeline inside a compound clip has been edited, puts it back.
// The clip keeps its length; if what it shows now ends sooner, it is cut
// short to match.
export function updateCompound(draft: Draft, materialId: string, inner: Draft): Draft {
  let d: Draft = {
    ...draft,
    materials: {
      ...draft.materials,
      videos: draft.materials.videos.map((m) =>
        m.id === materialId
          ? { ...m, compound: inner, duration: inner.duration, has_audio: hasSound(inner) }
          : m,
      ),
    },
  }
  const frame = frameDuration(d.fps)
  for (const t of d.tracks) {
    for (const s of t.segments) {
      if (s.material_id !== materialId || !s.source_timerange || s.freeze) continue
      const src = s.source_timerange
      if (src.start + src.duration <= inner.duration) continue
      if (src.start >= inner.duration - frame) continue
      // Where on the timeline this clip runs out of what it holds.
      const edge = s.reverse ? 'start' : 'end'
      d = trimSegment(d, s.id, edge, timelineTimeAt(s, inner.duration))
    }
  }
  return d
}

// ---- sound -----------------------------------------------------------------

// The clips inside a compound clip that make a sound, moved out onto the outer
// timeline: each becomes a clip of its own over the stretch the compound clip
// plays it, faster or slower with the compound clip. Only a compound clip
// playing forwards at one speed is mapped; a reversed, frozen or ramped one is
// silent. The compound clip's own volume, volume keyframes and fades are put
// on top by audibleSegments, as a gain over time.
export function soundsInside(outer: Segment, inner: Segment[]): Segment[] {
  const src = outer.source_timerange
  if (!src || outer.reverse || outer.freeze || outer.curve_speed) return []
  const from = src.start
  const to = src.start + src.duration
  const toOuter = (t: number) => outer.target_timerange.start + (t - from) / outer.speed
  const out: Segment[] = []
  for (const s of inner) {
    const start = s.target_timerange.start
    const end = segmentEnd(s)
    if (end <= from || start >= to || !s.source_timerange) continue
    const clippedStart = start < from
    const clippedEnd = end > to
    // A reversed or ramped clip is only mapped whole.
    if ((clippedStart || clippedEnd) && (s.reverse || s.curve_speed)) continue
    const a = Math.max(start, from)
    const b = Math.min(end, to)
    const sa = sourceTimeAt(s, a)
    const sb = sourceTimeAt(s, b)
    const fade = s.audio_fade && {
      fade_in_duration: clippedStart ? 0 : s.audio_fade.fade_in_duration / outer.speed,
      fade_out_duration: clippedEnd ? 0 : s.audio_fade.fade_out_duration / outer.speed,
    }
    const mapped: Segment = {
      ...s,
      id: `${outer.id}/${s.id}`,
      target_timerange: { start: toOuter(a), duration: (b - a) / outer.speed },
      source_timerange: s.reverse ? s.source_timerange : { start: Math.min(sa, sb), duration: Math.abs(sb - sa) },
      speed: s.speed * outer.speed,
      audio_fade: fade && (fade.fade_in_duration > 0 || fade.fade_out_duration > 0) ? fade : null,
    }
    out.push(s.curve_speed ? fitSpeed(mapped) : mapped)
  }
  return out
}
