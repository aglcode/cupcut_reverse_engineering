// Export: for every output frame, resolve the timeline, decode the exact
// source frames, composite them and hand the canvas to the encoder. Same shape
// as CapCut's pipeline (composite on the GPU, encode with the platform's
// hardware encoder, mux to MP4), using WebCodecs through mediabunny.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  canEncodeVideo,
  CanvasSource,
  getFirstEncodableAudioCodec,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type Input,
  type StreamTargetChunk,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny'
import { frameCount, frameToUs } from '../model/time'
import type { Draft, TimeRange } from '../model/types'
import { segmentEnd } from '../model/types'
import { EXPORT_SAMPLE_RATE, mixAudio } from './audioMix'
import { AudioSources } from './audioSources'
import { drawFrame, type FrameImage } from './compositor'
import { assetKey, missingMedia, openInput, type Assets } from './media'
import { audibleSegments, mediaLayersOf, mediaSourceTime, resolveFrame, type MediaLayer } from './resolve'

export type ExportSettings = {
  width: number
  height: number
  fps: number
  videoBitrate: number // bits per second
  audioBitrate: number
  // Defaults to H.264, which every browser that can export at all can encode.
  codec?: ExportCodec
  // The stretch of the timeline to export. Defaults to all of it.
  range?: TimeRange
  // Where to write the file as it is encoded (see exportFile.ts). Without it
  // the whole file is built in memory and returned as a blob.
  writable?: WritableStream
}

// The video formats an MP4 can carry that browsers may be able to encode.
// CapCut offers H.264, HEVC and AV1 (and ProRes, which browsers cannot encode).
export type ExportCodec = 'avc' | 'hevc' | 'av1' | 'vp9'

export const CODECS: { codec: ExportCodec; label: string; bitrateFactor: number }[] = [
  { codec: 'avc', label: 'H.264', bitrateFactor: 1 },
  { codec: 'hevc', label: 'HEVC (H.265)', bitrateFactor: 0.6 },
  { codec: 'av1', label: 'AV1', bitrateFactor: 0.5 },
  { codec: 'vp9', label: 'VP9', bitrateFactor: 0.65 },
]

// Which of them this browser and machine can encode at the given size.
// HEVC in particular depends on the graphics hardware.
export async function availableCodecs(width: number, height: number): Promise<ExportCodec[]> {
  const found: ExportCodec[] = []
  for (const { codec } of CODECS) {
    if (await canEncodeVideo(codec as VideoCodec, { width, height }).catch(() => false)) {
      found.push(codec)
    }
  }
  return found
}

// `blob` is null when the export was written to `settings.writable` instead.
export type ExportResult = { blob: Blob | null; videoCodec: string; audioCodec: string | null }

// Sound is mixed and handed to the encoder this much at a time, so the mix
// for a long project is never held all at once.
const AUDIO_CHUNK = 10_000_000
// Each chunk after the first is mixed from a little before its start, and
// that lead-in thrown away. It lets resampling settle, so chunks join without
// a click.
const AUDIO_LEAD_IN = 100_000

// Roughly 0.12 bits per pixel per frame for H.264, about 7.5 Mbps at 1080p30;
// the newer codecs reach similar quality with less.
export function recommendedBitrate(
  width: number,
  height: number,
  fps: number,
  codec: ExportCodec = 'avc',
): number {
  const factor = CODECS.find((c) => c.codec === codec)?.bitrateFactor ?? 1
  return Math.max(100_000, Math.round((width * height * fps * 0.12 * factor) / 100_000) * 100_000)
}

type Reader = {
  input: Input
  frames: AsyncGenerator<WrappedCanvas | null, void, unknown>
  // Timeline time after which the clip is no longer on screen.
  until: number
}

// One decoder per video segment, walking its source frames in order. The clip
// is read over its whole on-screen span, which transitions extend past its
// own start and end.
async function openReader(
  layer: MediaLayer,
  top: MediaLayer,
  draft: Draft,
  file: File,
  fps: number,
  origin: number,
): Promise<Reader> {
  const { segment, material } = layer
  // A clip inside a compound clip is on screen while the compound clip is.
  const span = top.span
  const nested = layer !== top
  const input = openInput(file)
  const track = await input.getPrimaryVideoTrack()
  if (!track || !(await track.canDecode())) {
    input.dispose()
    throw new Error(`This browser cannot decode the video in ${file.name}`)
  }
  const sink = new CanvasSink(track, { poolSize: 1 })
  function* timestamps() {
    // Must visit exactly the frames the export loop asks for, in the same
    // order: frame n of the output is at origin + n frames, where origin is
    // the start of the export range.
    let frame = Math.max(0, Math.ceil(((span.from - origin) * fps) / 1_000_000))
    for (let t = origin + frameToUs(frame, fps); t < span.to; t = origin + frameToUs(++frame, fps)) {
      if (t < span.from) continue
      if (!nested) {
        yield mediaSourceTime(segment, material, t) / 1_000_000
        continue
      }
      // Inside a compound clip the timing is the compound clip's and then the
      // clip's own, so the frame is looked up the way the export loop does.
      const found = mediaLayersOf(resolveFrame(draft, t)).find((m) => m.layer.key === layer.key)
      if (found) yield found.layer.sourceUs / 1_000_000
    }
  }
  return { input, frames: sink.canvasesAtTimestamps(timestamps()), until: span.to }
}

export async function exportDraft(
  draft: Draft,
  assets: Assets,
  settings: ExportSettings,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const range = settings.range ?? { start: 0, duration: draft.duration }
  const total = frameCount(range.duration, settings.fps)
  if (total === 0) throw new Error('There is nothing in that part of the timeline')
  const missing = missingMedia(draft, assets)
  if (missing.length) throw new Error(`Missing media: ${missing.join(', ')}`)

  const { width, height, fps } = settings
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a drawing surface')

  // Written straight to disk when there is somewhere to write to. The file's
  // index then goes at the end, since putting it first would mean holding
  // everything back until the end to know its size.
  const memory = settings.writable ? null : new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat(settings.writable ? { fastStart: false } : {}),
    target:
      memory ??
      new StreamTarget(settings.writable as WritableStream<StreamTargetChunk>, { chunked: true }),
  })
  const videoCodec: ExportCodec = settings.codec ?? 'avc'
  const label = CODECS.find((c) => c.codec === videoCodec)?.label ?? videoCodec
  if (!(await canEncodeVideo(videoCodec as VideoCodec, { width, height }).catch(() => false))) {
    throw new Error(`This browser cannot encode ${label} at ${width}×${height}`)
  }
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: settings.videoBitrate })
  output.addVideoTrack(video, { frameRate: fps })

  const rangeEnd = range.start + range.duration
  const hasSound = audibleSegments(draft).some(
    ({ segment }) => segment.target_timerange.start < rangeEnd && segmentEnd(segment) > range.start,
  )
  let audio: AudioBufferSource | null = null
  let audioCodec: string | null = null
  if (hasSound) {
    const codec = await getFirstEncodableAudioCodec(output.format.getSupportedAudioCodecs(), {
      numberOfChannels: 2,
      sampleRate: EXPORT_SAMPLE_RATE,
    })
    if (!codec) throw new Error('This browser cannot encode audio')
    audio = new AudioBufferSource({ codec, bitrate: settings.audioBitrate })
    output.addAudioTrack(audio)
    audioCodec = codec
  }

  const readers = new Map<string, Reader>()
  const sources = new AudioSources(assets)
  // Timeline time up to which sound has been mixed and queued.
  let mixedUntil = range.start
  // Chunks are handed to the encoder one after another without waiting here:
  // the muxer interleaves the tracks, so an audio chunk is only accepted once
  // video has caught up with it.
  let queued: Promise<void> = Promise.resolve()

  const mixNextChunk = async (track: AudioBufferSource) => {
    const from = mixedUntil
    const to = Math.min(rangeEnd, from + AUDIO_CHUNK)
    const lead = from > range.start ? AUDIO_LEAD_IN : 0
    const mixed = await mixAudio(
      draft,
      assets,
      { start: from - lead, duration: to - from + lead },
      sources,
    )
    const frames = Math.max(1, Math.round(((to - from) / 1_000_000) * EXPORT_SAMPLE_RATE))
    // Silence where nothing is playing, so the audio track has no holes.
    const chunk = new AudioBuffer({
      length: frames,
      numberOfChannels: 2,
      sampleRate: EXPORT_SAMPLE_RATE,
    })
    if (mixed) {
      const skip = Math.round((lead / 1_000_000) * EXPORT_SAMPLE_RATE)
      for (let c = 0; c < 2; c++) {
        chunk.copyToChannel(mixed.getChannelData(c).subarray(skip, skip + frames), c)
      }
    }
    mixedUntil = to
    queued = queued.then(() => track.add(chunk))
    queued.catch(() => {})
  }

  const closeReader = async (id: string, reader: Reader) => {
    readers.delete(id)
    await reader.frames.return().catch(() => {})
    reader.input.dispose()
  }

  try {
    await output.start()

    for (let frame = 0; frame < total; frame++) {
      signal.throwIfAborted()
      const t = range.start + frameToUs(frame, fps)
      // Sound for a stretch is queued before that stretch's first picture.
      while (audio && mixedUntil < rangeEnd && t >= mixedUntil) await mixNextChunk(audio)

      const frameLayers = resolveFrame(draft, t)
      const layers = frameLayers.visual
      const images = new Map<string, FrameImage>()

      for (const { layer, top } of mediaLayersOf(frameLayers)) {
        const asset = assets[assetKey(layer.material.path)]
        if (!asset) continue
        if (asset.image) {
          images.set(layer.key, { image: asset.image, width: asset.width, height: asset.height })
          continue
        }
        let reader = readers.get(layer.key)
        if (!reader) {
          reader = await openReader(layer, top, draft, asset.file, fps, range.start)
          readers.set(layer.key, reader)
        }
        const next = await reader.frames.next()
        const decoded = next.done ? null : next.value
        if (decoded) {
          const { canvas: image } = decoded
          images.set(layer.key, { image, width: image.width, height: image.height })
        }
      }

      drawFrame(ctx, width, height, layers, (layer) => images.get(layer.key) ?? null)
      await video.add(frame / fps, 1 / fps)
      onProgress((frame + 1) / total)

      // A clip that has left the screen will not be needed again; its decoder
      // is closed now, not at the end, so a long project with many clips does
      // not keep every one of them open.
      for (const [id, reader] of readers) {
        if (reader.until <= t) await closeReader(id, reader)
      }
    }

    await queued
    await output.finalize()
  } catch (error) {
    if (output.state === 'started') await output.cancel().catch(() => {})
    throw error
  } finally {
    for (const [id, reader] of readers) await closeReader(id, reader)
    sources.dispose()
  }

  if (!memory) return { blob: null, videoCodec, audioCodec }
  if (!memory.buffer) throw new Error('The encoder produced no output')
  return { blob: new Blob([memory.buffer], { type: 'video/mp4' }), videoCodec, audioCodec }
}
