// Offline mixdown of every audible segment into one buffer for export.

import { effectiveFade } from '../model/fades'
import { evalVolume, isAnimated, keyframeTimes } from '../model/keyframes'
import { segmentEnd, type Draft } from '../model/types'
import { assetKey, type Assets } from './media'
import { audibleSegments } from './resolve'

export const EXPORT_SAMPLE_RATE = 48_000

export async function mixAudio(draft: Draft, assets: Assets): Promise<AudioBuffer | null> {
  const segments = audibleSegments(draft)
  if (segments.length === 0 || draft.duration === 0) return null

  const length = Math.ceil((draft.duration / 1_000_000) * EXPORT_SAMPLE_RATE)
  const ctx = new OfflineAudioContext(2, length, EXPORT_SAMPLE_RATE)

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
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.playbackRate.value = segment.speed
    const gain = ctx.createGain()
    const { start } = segment.target_timerange
    const end = segmentEnd(segment)
    if (isAnimated(segment, 'KFTypeVolume')) {
      // Linear ramps between keyframes, matching evalVolume.
      const inside = keyframeTimes(segment).filter((t) => t > start && t < end)
      gain.gain.setValueAtTime(evalVolume(segment, start), start / 1_000_000)
      for (const t of [...inside, end]) {
        gain.gain.linearRampToValueAtTime(evalVolume(segment, t), t / 1_000_000)
      }
    } else {
      gain.gain.value = segment.volume
    }
    // Fades get their own gain stage: multiplied with a volume ramp they are
    // no longer linear, so one node cannot carry both.
    const fade = ctx.createGain()
    const { fade_in_duration: fadeIn, fade_out_duration: fadeOut } = effectiveFade(segment)
    if (fadeIn > 0) {
      fade.gain.setValueAtTime(0, start / 1_000_000)
      fade.gain.linearRampToValueAtTime(1, (start + fadeIn) / 1_000_000)
    }
    if (fadeOut > 0) {
      fade.gain.setValueAtTime(1, (end - fadeOut) / 1_000_000)
      fade.gain.linearRampToValueAtTime(0, end / 1_000_000)
    }
    node.connect(gain).connect(fade).connect(ctx.destination)
    // Offset and duration are measured in source time, before playbackRate.
    node.start(
      start / 1_000_000,
      src.start / 1_000_000,
      src.duration / 1_000_000,
    )
    scheduled++
  }
  return scheduled > 0 ? ctx.startRendering() : null
}
