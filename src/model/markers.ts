// Markers: named points to cut and line things up against.
//
// CapCut keeps a clip's markers as mark_items in a materials.time_marks entry
// the clip references:
//   {"id":…,"color":"#00c1cd","title":"Marker 14","time_range":{"start":23900000,"duration":0}}
// Their times are positions in the clip's source, not on the timeline (in a
// draft whose music clip is trimmed, they only line up with the video cuts
// when read that way), so they stay on the same beat when the clip is moved
// or trimmed. The same items are kept here, on the segment.
//
// A draft also has a top-level time_marks field for markers on the timeline
// itself. It is null in every draft inspected, so using the same item shape
// for it is an assumption.

import { keyTime, timelineTime } from './keyframes'
import { frameDuration, snapToFrame } from './time'
import { newId, segmentEnd, type Draft, type MarkItem, type Segment } from './types'

export const MARKER_COLOR = '#00c1cd'

const allSegments = (draft: Draft): Segment[] => draft.tracks.flatMap((t) => t.segments)

// "Marker 01", "Marker 02", … as CapCut numbers them.
const nextTitle = (existing: MarkItem[]): string => {
  const highest = Math.max(0, ...existing.map((m) => Number(/^Marker (\d+)$/.exec(m.title)?.[1] ?? 0)))
  return `Marker ${String(highest + 1).padStart(2, '0')}`
}

const mark = (start: number, title: string): MarkItem => ({
  id: newId(),
  color: MARKER_COLOR,
  title,
  time_range: { start: Math.round(start), duration: 0 },
})

export type PlacedMarker = { marker: MarkItem; time: number; segmentId: string | null }

// A clip's markers with their timeline times, leaving out any that fall in a
// part of the source the clip does not currently show.
export function clipMarkers(segment: Segment): PlacedMarker[] {
  const { start } = segment.target_timerange
  const end = segmentEnd(segment)
  return segment.time_marks
    .map((marker) => ({
      marker,
      time: Math.round(timelineTime(segment, marker.time_range.start)),
      segmentId: segment.id,
    }))
    .filter((m) => m.time >= start && m.time < end)
}

// Every marker in the project, with where it sits on the timeline.
export function placedMarkers(draft: Draft): PlacedMarker[] {
  return [
    ...draft.time_marks.map((marker) => ({ marker, time: marker.time_range.start, segmentId: null })),
    ...allSegments(draft).flatMap(clipMarkers),
  ].sort((a, b) => a.time - b.time)
}

function replaceSegment(draft: Draft, next: Segment): Draft {
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) => (s.id === next.id ? next : s)),
    })),
  }
}

// Adds a marker at timeline time `t`: on the given clip if `t` is inside it,
// otherwise on the timeline. Does nothing if that frame already has one there.
export function addMarker(draft: Draft, t: number, segmentId?: string | null): Draft {
  const time = snapToFrame(t, draft.fps)
  const half = frameDuration(draft.fps) / 2
  const segment = segmentId ? allSegments(draft).find((s) => s.id === segmentId) : undefined
  if (segment && time >= segment.target_timerange.start && time < segmentEnd(segment)) {
    if (clipMarkers(segment).some((m) => Math.abs(m.time - time) < half)) return draft
    const item = mark(keyTime(segment, time), nextTitle(segment.time_marks))
    return replaceSegment(draft, { ...segment, time_marks: [...segment.time_marks, item] })
  }
  if (draft.time_marks.some((m) => Math.abs(m.time_range.start - time) < half)) return draft
  const items = [...draft.time_marks, mark(time, nextTitle(draft.time_marks))]
  return { ...draft, time_marks: items.sort((a, b) => a.time_range.start - b.time_range.start) }
}

export function removeMarker(draft: Draft, markerId: string): Draft {
  if (draft.time_marks.some((m) => m.id === markerId)) {
    return { ...draft, time_marks: draft.time_marks.filter((m) => m.id !== markerId) }
  }
  const owner = allSegments(draft).find((s) => s.time_marks.some((m) => m.id === markerId))
  if (!owner) return draft
  return replaceSegment(draft, {
    ...owner,
    time_marks: owner.time_marks.filter((m) => m.id !== markerId),
  })
}

// The M key: removes the marker at `t` if there is one in that place (on the
// clip when a clip is given and `t` is inside it, else on the timeline), and
// adds one if there is not.
export function toggleMarker(draft: Draft, t: number, segmentId?: string | null): Draft {
  const time = snapToFrame(t, draft.fps)
  const half = frameDuration(draft.fps) / 2
  const segment = segmentId ? allSegments(draft).find((s) => s.id === segmentId) : undefined
  const onClip = segment && time >= segment.target_timerange.start && time < segmentEnd(segment)
  const here = onClip
    ? clipMarkers(segment).find((m) => Math.abs(m.time - time) < half)?.marker
    : draft.time_marks.find((m) => Math.abs(m.time_range.start - time) < half)
  return here ? removeMarker(draft, here.id) : addMarker(draft, time, segmentId)
}

// The nearest marker time after `t` (direction 1) or before it (-1).
export function neighbourMarker(draft: Draft, t: number, direction: 1 | -1): number | null {
  const times = placedMarkers(draft).map((m) => m.time)
  const found = direction === 1 ? times.find((x) => x > t) : times.reverse().find((x) => x < t)
  return found ?? null
}

// Moves a list of markers by `delta`. Needed only where their times count
// from the start of the clip (text, freeze frames) and that start moves.
export const shiftMarkers = (marks: MarkItem[], delta: number): MarkItem[] =>
  delta === 0
    ? marks
    : marks.map((m) => ({ ...m, time_range: { ...m.time_range, start: m.time_range.start + delta } }))
