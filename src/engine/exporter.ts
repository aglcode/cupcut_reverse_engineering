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
  type Input,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny'
import { frameCount, frameToUs } from '../model/time'
import type { Draft, TimeRange } from '../model/types'
import { EXPORT_SAMPLE_RATE, mixAudio } from './audioMix'
import { drawFrame, type FrameImage } from './compositor'
import { assetKey, missingMedia, openInput, type Assets } from './media'
import { mediaSourceTime, resolveFrame, type MediaLayer } from './resolve'

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

export type ExportResult = { blob: Blob; videoCodec: string; audioCodec: string | null }

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

type Reader = { input: Input; frames: AsyncGenerator<WrappedCanvas | null, void, unknown> }

// One decoder per video segment, walking its source frames in order. The clip
// is read over its whole on-screen span, which transitions extend past its
// own start and end.
async function openReader(
  layer: MediaLayer,
  file: File,
  fps: number,
  origin: number,
): Promise<Reader> {
  const { segment, material, span } = layer
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
      if (t >= span.from) yield mediaSourceTime(segment, material, t) / 1_000_000
    }
  }
  return { input, frames: sink.canvasesAtTimestamps(timestamps()) }
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

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const videoCodec: ExportCodec = settings.codec ?? 'avc'
  const label = CODECS.find((c) => c.codec === videoCodec)?.label ?? videoCodec
  if (!(await canEncodeVideo(videoCodec as VideoCodec, { width, height }).catch(() => false))) {
    throw new Error(`This browser cannot encode ${label} at ${width}×${height}`)
  }
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: settings.videoBitrate })
  output.addVideoTrack(video, { frameRate: fps })

  const mix = await mixAudio(draft, assets, range)
  let audio: AudioBufferSource | null = null
  let audioCodec: string | null = null
  if (mix) {
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
  try {
    await output.start()
    // Not awaited here: the muxer interleaves tracks, so the audio promise only
    // settles once video has caught up.
    const audioDone = audio && mix ? audio.add(mix) : Promise.resolve()
    audioDone.catch(() => {})

    for (let frame = 0; frame < total; frame++) {
      signal.throwIfAborted()
      const layers = resolveFrame(draft, range.start + frameToUs(frame, fps)).visual
      const images = new Map<string, FrameImage>()

      for (const layer of layers) {
        if (layer.kind !== 'media') continue
        const asset = assets[assetKey(layer.material.path)]
        if (asset.image) {
          images.set(layer.segment.id, { image: asset.image, width: asset.width, height: asset.height })
          continue
        }
        let reader = readers.get(layer.segment.id)
        if (!reader) {
          reader = await openReader(layer, asset.file, fps, range.start)
          readers.set(layer.segment.id, reader)
        }
        const next = await reader.frames.next()
        const decoded = next.done ? null : next.value
        if (decoded) {
          const { canvas: image } = decoded
          images.set(layer.segment.id, { image, width: image.width, height: image.height })
        }
      }

      drawFrame(ctx, width, height, layers, (layer) => images.get(layer.segment.id) ?? null)
      await video.add(frame / fps, 1 / fps)
      onProgress((frame + 1) / total)
    }

    await audioDone
    await output.finalize()
  } catch (error) {
    if (output.state === 'started') await output.cancel()
    throw error
  } finally {
    for (const reader of readers.values()) {
      await reader.frames.return()
      reader.input.dispose()
    }
  }

  const buffer = output.target.buffer
  if (!buffer) throw new Error('The encoder produced no output')
  return { blob: new Blob([buffer], { type: 'video/mp4' }), videoCodec, audioCodec }
}
