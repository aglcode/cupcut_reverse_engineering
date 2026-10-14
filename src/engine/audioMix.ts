// Offline mixdown of the audible segments in a stretch of the timeline.
//
// The exporter calls this a few seconds at a time, so neither the mix nor the
// decoded source sound for a long project ever has to fit in memory at once.

import { effectiveFade, fadeGain } from '../model/fades'
import { evalVolume, isAnimated, keyframeTimes } from '../model/keyframes'
import { sourceTimeAt } from '../model/timing'
import { segmentEnd, type Draft, type Segment, type TimeRange } from '../model/types'
import { AudioSources, type SourceSlice } from './audioSources'
import type { Assets } from './media'
import { audibleSegments } from './resolve'

export const EXPORT_SAMPLE_RATE = 48_000

// Extra source sound fetched either side of what a stretch needs, in seconds.
// It covers rounding at the edges and the few samples a resampler looks ahead.
const MARGIN = 0.05

// How often a compound clip's volume over its sounds is followed, in microseconds.
const ENVELOPE_STEP = 20_000

// `length` seconds of `buffer` starting at `from`, played backwards.
function reversed(ctx: BaseAudioContext, buffer: AudioBuffer, from: number, length: number) {
  const first = Math.min(buffer.length, Math.max(0, Math.round(from * buffer.sampleRate)))
  const last = Math.min(buffer.length, Math.round((from + length) * buffer.sampleRate))
  const frames = Math.max(1, last - first)
  const out = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const slice = buffer.getChannelData(channel).slice(first, last).reverse()
    out.getChannelData(channel).set(slice)
  }
  return out
}

// The sound of a ramped clip between two timeline times, already at the
// speeds of its ramp. A buffer source can only change speed in steps of a few
// milliseconds, which drifts over a steep ramp, so each output sample is read
// from the exact place in the source the clip has reached. Reversed clips come
// out reversed, since the place runs backwards for them.
function ramped(
  ctx: BaseAudioContext,
  slice: SourceSlice,
  segment: Segment,
  begin: number,
  finish: number,
): AudioBuffer {
  const { buffer, startsAt } = slice
  const frames = Math.max(1, Math.ceil(((finish - begin) / 1_000_000) * ctx.sampleRate))
  const out = ctx.createBuffer(buffer.numberOfChannels, frames, ctx.sampleRate)
  const places = new Float64Array(frames)
  for (let i = 0; i < frames; i++) {
    const t = begin + (i / ctx.sampleRate) * 1_000_000
    places[i] = (sourceTimeAt(segment, t) / 1_000_000 - startsAt) * buffer.sampleRate
  }
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const from = buffer.getChannelData(channel)
    const to = out.getChannelData(channel)
    for (let i = 0; i < frames; i++) {
      const place = places[i]
      const before = Math.floor(place)
      if (before < 0 || before + 1 >= from.length) continue
      const part = place - before
      to[i] = from[before] * (1 - part) + from[before + 1] * part
    }
  }
  return out
}

// Mixes the given stretch of the timeline. The result starts at range.start,
// so a clip that began before it comes in part-way through. Pass `sources` to
// share decoders between calls; without it they are opened and closed here.
export async function mixAudio(
  draft: Draft,
  assets: Assets,
  range: TimeRange = { start: 0, duration: draft.duration },
  sources?: AudioSources,
): Promise<AudioBuffer | null> {
  const from = range.start
  const to = range.start + range.duration
  const segments = audibleSegments(draft).filter(
    ({ segment }) => segment.target_timerange.start < to && segmentEnd(segment) > from,
  )
  if (segments.length === 0 || range.duration <= 0) return null

  const own = sources ? null : new AudioSources(assets)
  const reader = sources ?? own!
  try {
    const length = Math.ceil((range.duration / 1_000_000) * EXPORT_SAMPLE_RATE)
    const ctx = new OfflineAudioContext(2, length, EXPORT_SAMPLE_RATE)
    // Timeline time to seconds in the mix.
    const at = (t: number) => Math.max(0, (t - from) / 1_000_000)

    let scheduled = 0
    for (const { segment, path, gain: outerGain } of segments) {
      const src = segment.source_timerange
      if (!src) continue
      const { start } = segment.target_timerange
      const end = segmentEnd(segment)
      // The part of the clip inside this stretch of the timeline.
      const begin = Math.max(start, from)
      const finish = Math.min(end, to)
      if (finish <= begin) continue
      const node = ctx.createBufferSource()

      if (segment.curve_speed) {
        const a = sourceTimeAt(segment, begin) / 1_000_000
        const b = sourceTimeAt(segment, finish) / 1_000_000
        const slice = await reader.slice(path, Math.min(a, b) - MARGIN, Math.max(a, b) + MARGIN)
        if (!slice) continue
        node.buffer = ramped(ctx, slice, segment, begin, finish)
        node.start(at(begin))
      } else {
        // The same part in the clip's source.
        const skipped = ((begin - start) * segment.speed) / 1_000_000
        const playing = Math.min(
          src.duration / 1_000_000 - skipped,
          ((finish - begin) * segment.speed) / 1_000_000,
        )
        if (playing <= 0) continue
        // A reversed clip plays its source range back to front, so the part it
        // needs here is counted back from the end of that range.
        const sourceFrom = segment.reverse
          ? (src.start + src.duration) / 1_000_000 - skipped - playing
          : src.start / 1_000_000 + skipped
        const slice = await reader.slice(path, sourceFrom - MARGIN, sourceFrom + playing + MARGIN)
        if (!slice) continue
        // Where in the slice this clip's sound starts. If the file has nothing
        // that early (it starts late), the clip comes in late by the same amount.
        const into = sourceFrom - slice.startsAt
        const late = Math.max(0, -into)
        if (segment.reverse) {
          node.buffer = reversed(ctx, slice.buffer, Math.max(0, into), playing)
          node.playbackRate.value = segment.speed
          node.start(at(begin), 0, playing)
        } else {
          node.buffer = slice.buffer
          node.playbackRate.value = segment.speed
          // Offset and duration are measured in source time, before playbackRate.
          node.start(at(begin) + late / segment.speed, Math.max(0, into), playing - late)
        }
      }

      const gain = ctx.createGain()
      if (isAnimated(segment, 'KFTypeVolume')) {
        // Linear ramps between keyframes, matching evalVolume.
        const inside = keyframeTimes(segment).filter((t) => t > begin && t < end)
        gain.gain.setValueAtTime(evalVolume(segment, begin), at(begin))
        for (const t of [...inside, end]) {
          gain.gain.linearRampToValueAtTime(evalVolume(segment, t), at(t))
        }
      } else {
        gain.gain.value = segment.volume
      }

      // Fades get their own gain stage: multiplied with a volume ramp they are
      // no longer linear, so one node cannot carry both.
      const fade = ctx.createGain()
      const { fade_in_duration: fadeIn, fade_out_duration: fadeOut } = effectiveFade(segment)
      if (fadeIn > 0 || fadeOut > 0) {
        // The fade is straight lines between these corners; fadeGain gives the
        // level at each, including a start that falls part-way through a fade.
        const corners = [start + fadeIn, end - fadeOut, end].filter((t) => t > begin)
        fade.gain.setValueAtTime(fadeGain(segment, begin), at(begin))
        for (const t of corners) fade.gain.linearRampToValueAtTime(fadeGain(segment, t), at(t))
      }

      // The volume and fades of the compound clip a sound is inside. They are
      // straight lines between keyframes and fade corners, so following them
      // every 20 ms is close; it is exact at those points when they fall on it.
      const outer = ctx.createGain()
      if (outerGain) {
        outer.gain.setValueAtTime(outerGain(begin), at(begin))
        for (let t = begin + ENVELOPE_STEP; t < finish; t += ENVELOPE_STEP) {
          outer.gain.linearRampToValueAtTime(outerGain(t), at(t))
        }
        outer.gain.linearRampToValueAtTime(outerGain(finish - 1), at(finish))
      }

      node.connect(gain).connect(fade).connect(outer).connect(ctx.destination)
      scheduled++
    }
    return scheduled > 0 ? await ctx.startRendering() : null
  } finally {
    own?.dispose()
  }
}
