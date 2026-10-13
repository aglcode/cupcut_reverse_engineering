// Offline mixdown of every audible segment into one buffer for export.

import { effectiveFade, fadeGain } from '../model/fades'
import { evalVolume, isAnimated, keyframeTimes } from '../model/keyframes'
import { segmentEnd, type Draft, type TimeRange } from '../model/types'
import { assetKey, type Assets } from './media'
import { audibleSegments } from './resolve'

export const EXPORT_SAMPLE_RATE = 48_000

// The part of `buffer` from `from` for `length` seconds, played backwards.
function reversedSlice(ctx: BaseAudioContext, buffer: AudioBuffer, from: number, length: number) {
  const first = Math.min(buffer.length, Math.max(0, Math.floor(from * buffer.sampleRate)))
  const last = Math.min(buffer.length, Math.ceil((from + length) * buffer.sampleRate))
  const frames = Math.max(1, last - first)
  const out = ctx.createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const slice = buffer.getChannelData(channel).slice(first, last).reverse()
    out.getChannelData(channel).set(slice)
  }
  return out
}

// Mixes the given stretch of the timeline. The result starts at range.start,
// so a clip that began before it comes in part-way through.
export async function mixAudio(
  draft: Draft,
  assets: Assets,
  range: TimeRange = { start: 0, duration: draft.duration },
): Promise<AudioBuffer | null> {
  const from = range.start
  const to = range.start + range.duration
  const segments = audibleSegments(draft).filter(
    ({ segment }) => segment.target_timerange.start < to && segmentEnd(segment) > from,
  )
  if (segments.length === 0 || range.duration <= 0) return null

  const length = Math.ceil((range.duration / 1_000_000) * EXPORT_SAMPLE_RATE)
  const ctx = new OfflineAudioContext(2, length, EXPORT_SAMPLE_RATE)
  // Timeline time to seconds in the mix.
  const at = (t: number) => Math.max(0, (t - from) / 1_000_000)

  const decoded = new Map<string, Promise<AudioBuffer | null>>()
  const decode = (path: string) => {
    let pending = decoded.get(path)
    if (!pending) {
      const asset = assets[assetKey(path)]
      pending = asset
        ? asset.file
            .arrayBuffer()
            .then((data) => ctx.decodeAudioData(data))
            // A video file whose audio the browser cannot decode exports silent.
            .catch(() => null)
        : Promise.resolve(null)
      decoded.set(path, pending)
    }
    return pending
  }

  let scheduled = 0
  for (const { segment, path } of segments) {
    const buffer = await decode(path)
    const src = segment.source_timerange
    if (!buffer || !src) continue
    const { start } = segment.target_timerange
    const end = segmentEnd(segment)
    // Where this clip starts sounding in the mix, and how much of its source
    // was already used up before the range began.
    const begin = Math.max(start, from)
    const skipped = (begin - start) * segment.speed
    const remaining = src.duration - skipped
    if (remaining <= 0) continue

    const node = ctx.createBufferSource()
    // A reversed clip plays its source range back to front.
    node.buffer = segment.reverse
      ? reversedSlice(ctx, buffer, src.start / 1_000_000, src.duration / 1_000_000)
      : buffer
    node.playbackRate.value = segment.speed

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

    node.connect(gain).connect(fade).connect(ctx.destination)
    // Offset and duration are measured in source time, before playbackRate.
    node.start(
      at(begin),
      ((segment.reverse ? 0 : src.start) + skipped) / 1_000_000,
      remaining / 1_000_000,
    )
    scheduled++
  }
  return scheduled > 0 ? ctx.startRendering() : null
}
