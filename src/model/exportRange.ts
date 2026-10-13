// Export range: the part of the timeline that an export covers.
//
// CapCut drafts have a config.export_range field for this and its engine has
// operations named export_range_in, export_range_out, export_range_cancel and
// export_range_by_segment. The field is null in every draft inspected, so its
// shape is not known; here it is a { start, duration } range like every other
// range in a draft.

import { frameDuration, snapToFrame } from './time'
import { segmentEnd, type Draft, type TimeRange } from './types'

const whole = (draft: Draft): TimeRange => ({ start: 0, duration: draft.duration })

// The range an export will cover: the marked one cut down to the timeline as
// it is now, or the whole timeline when nothing usable is marked.
export function effectiveRange(draft: Draft): TimeRange {
  const marked = draft.config.export_range
  if (!marked) return whole(draft)
  const start = Math.min(Math.max(0, marked.start), draft.duration)
  const end = Math.min(draft.duration, marked.start + marked.duration)
  return end > start ? { start, duration: end - start } : whole(draft)
}

export const hasExportRange = (draft: Draft): boolean => {
  const range = effectiveRange(draft)
  return (
    draft.config.export_range !== null && (range.start > 0 || range.duration < draft.duration)
  )
}

function withRange(draft: Draft, range: TimeRange | null): Draft {
  return { ...draft, config: { ...draft.config, export_range: range } }
}

// Marks start to end, on the frame grid and inside the timeline. A range that
// is empty or covers everything is the same as no range.
export function setExportRange(draft: Draft, start: number, end: number): Draft {
  const fps = draft.fps
  const from = Math.min(Math.max(0, snapToFrame(start, fps)), draft.duration)
  const to = Math.min(Math.max(0, snapToFrame(end, fps)), draft.duration)
  if (to - from < frameDuration(fps)) return draft
  if (from === 0 && to === draft.duration) return clearExportRange(draft)
  return withRange(draft, { start: from, duration: to - from })
}

export const clearExportRange = (draft: Draft): Draft =>
  draft.config.export_range === null ? draft : withRange(draft, null)

// Moves the start of the range to `t`, keeping its end. If `t` is past the end
// the range runs from `t` to the end of the timeline instead.
export function markIn(draft: Draft, t: number): Draft {
  const current = effectiveRange(draft)
  const end = current.start + current.duration
  return setExportRange(draft, t, t < end ? end : draft.duration)
}

// Moves the end of the range to `t`, keeping its start. If `t` is before the
// start the range runs from the beginning of the timeline to `t` instead.
export function markOut(draft: Draft, t: number): Draft {
  const current = effectiveRange(draft)
  return setExportRange(draft, t > current.start ? current.start : 0, t)
}

// Marks the stretch the given clips cover, first start to last end.
export function markSegments(draft: Draft, segmentIds: string[]): Draft {
  const picked = draft.tracks.flatMap((t) => t.segments).filter((s) => segmentIds.includes(s.id))
  if (picked.length === 0) return draft
  return setExportRange(
    draft,
    Math.min(...picked.map((s) => s.target_timerange.start)),
    Math.max(...picked.map(segmentEnd)),
  )
}
