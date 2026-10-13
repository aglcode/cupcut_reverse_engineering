// Audio fade in/out. CapCut stores this as a materials.audio_fades entry
// ({ fade_in_duration, fade_out_duration }) referenced from the segment; the
// same two fields are kept here, directly on the segment.
//
// No local CapCut draft has a non-zero fade, so two things are assumptions
// rather than observations: durations are timeline microseconds, and the ramp
// is linear.

import { segmentEnd, type AudioFade, type Draft, type Segment } from './types'

// The fade actually applied: stored durations cut down to fit the segment, so
// a clip trimmed shorter than its fades still starts and ends silent.
export function effectiveFade(segment: Segment): AudioFade {
  const { duration } = segment.target_timerange
  const fade = segment.audio_fade
  if (!fade) return { fade_in_duration: 0, fade_out_duration: 0 }
  const fadeIn = Math.min(Math.max(0, fade.fade_in_duration), duration)
  const fadeOut = Math.min(Math.max(0, fade.fade_out_duration), duration - fadeIn)
  return { fade_in_duration: fadeIn, fade_out_duration: fadeOut }
}

// Volume multiplier from the fades at timeline time `t`: 0 at the very start
// of a fade in and at the very end of a fade out, 1 between them.
export function fadeGain(segment: Segment, t: number): number {
  if (!segment.audio_fade) return 1
  const { fade_in_duration: fadeIn, fade_out_duration: fadeOut } = effectiveFade(segment)
  const sinceStart = t - segment.target_timerange.start
  const untilEnd = segmentEnd(segment) - t
  let gain = 1
  if (fadeIn > 0 && sinceStart < fadeIn) gain = Math.max(0, sinceStart / fadeIn)
  if (fadeOut > 0 && untilEnd < fadeOut) gain = Math.min(gain, Math.max(0, untilEnd / fadeOut))
  return gain
}

// Sets one or both fades. The one being set may use the whole clip; the other
// gives way if they no longer both fit.
export function setFade(draft: Draft, segmentId: string, patch: Partial<AudioFade>): Draft {
  const segment = draft.tracks.flatMap((t) => t.segments).find((s) => s.id === segmentId)
  if (!segment) return draft
  const { duration } = segment.target_timerange
  const current = effectiveFade(segment)
  const clamp = (us: number) => Math.round(Math.min(Math.max(0, us), duration))
  let fadeIn = current.fade_in_duration
  let fadeOut = current.fade_out_duration
  if (patch.fade_in_duration !== undefined) {
    fadeIn = clamp(patch.fade_in_duration)
    fadeOut = Math.min(fadeOut, duration - fadeIn)
  }
  if (patch.fade_out_duration !== undefined) {
    fadeOut = clamp(patch.fade_out_duration)
    fadeIn = Math.min(fadeIn, duration - fadeOut)
  }
  const audio_fade =
    fadeIn === 0 && fadeOut === 0 ? null : { fade_in_duration: fadeIn, fade_out_duration: fadeOut }
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) => (s.id === segmentId ? { ...s, audio_fade } : s)),
    })),
  }
}

// After a split the fade in stays with the left half and the fade out with the
// right, so the cut itself is not faded.
export function splitFade(segment: Segment): [AudioFade | null, AudioFade | null] {
  const fade = segment.audio_fade
  if (!fade) return [null, null]
  const left = fade.fade_in_duration > 0 ? { ...fade, fade_out_duration: 0 } : null
  const right = fade.fade_out_duration > 0 ? { ...fade, fade_in_duration: 0 } : null
  return [left, right]
}
