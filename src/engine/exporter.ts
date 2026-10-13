// Export: for every output frame, resolve the timeline, decode the exact
// source frames, composite them and hand the canvas to the encoder. Same shape
// as CapCut's pipeline (composite on the GPU, encode with the platform's
// hardware encoder, mux to MP4), using WebCodecs through mediabunny.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  type Input,
  type WrappedCanvas,
} from 'mediabunny'
import { frameCount, frameToUs } from '../model/time'
import type { Draft } from '../model/types'
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
}

export type ExportResult = { blob: Blob; videoCodec: string; audioCodec: string | null }

// Roughly 0.12 bits per pixel per frame: about 7.5 Mbps at 1080p30.
export const recommendedBitrate = (width: number, height: number, fps: number): number =>
  Math.round((width * height * fps * 0.12) / 100_000) * 100_000

type Reader = { input: Input; frames: AsyncGenerator<WrappedCanvas | null, void, unknown> }

// One decoder per video segment, walking its source frames in order. The clip
// is read over its whole on-screen span, which transitions extend past its
// own start and end.
async function openReader(layer: MediaLayer, file: File, fps: number): Promise<Reader> {
  const { segment, material, span } = layer
  const input = openInput(file)
  const track = await input.getPrimaryVideoTrack()
  if (!track || !(await track.canDecode())) {
    input.dispose()
    throw new Error(`This browser cannot decode the video in ${file.name}`)
  }
  const sink = new CanvasSink(track, { poolSize: 1 })
  function* timestamps() {
    // Must visit exactly the frames the export loop asks for, in the same order.
    let frame = Math.ceil((span.from * fps) / 1_000_000)
    for (let t = frameToUs(frame, fps); t < span.to; t = frameToUs(++frame, fps)) {
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
  const total = frameCount(draft.duration, settings.fps)
  if (total === 0) throw new Error('The timeline is empty')
  const missing = missingMedia(draft, assets)
  if (missing.length) throw new Error(`Missing media: ${missing.join(', ')}`)

  const { width, height, fps } = settings
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create a drawing surface')

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  const videoCodec = await getFirstEncodableVideoCodec(output.format.getSupportedVideoCodecs(), {
    width,
    height,
  })
  if (!videoCodec) throw new Error('This browser cannot encode video at this size')
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate: settings.videoBitrate })
  output.addVideoTrack(video, { frameRate: fps })

  const mix = await mixAudio(draft, assets)
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
      const layers = resolveFrame(draft, frameToUs(frame, fps)).visual
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
          reader = await openReader(layer, asset.file, fps)
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
