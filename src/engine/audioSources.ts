// Decoded sound from media files, a stretch at a time.
//
// Decoding a whole file up front costs about 23 MB per minute of stereo audio,
// which an hour-long project cannot afford. These readers decode only the part
// of a file a stretch of the mix needs, so memory depends on how much is
// mixed at once and not on how long the files are.

import { AudioBufferSink, type Input } from 'mediabunny'
import { assetKey, openInput, type Assets } from './media'

// `buffer` holds decoded sound whose first sample is `startsAt` seconds into
// the file. It covers at least the stretch asked for, where the file has it.
export type SourceSlice = { buffer: AudioBuffer; startsAt: number }

class FileAudio {
  private input: Input | null = null
  private sink: Promise<AudioBufferSink | null> | null = null
  private whole: Promise<AudioBuffer | null> | null = null
  private readonly file: File

  constructor(file: File) {
    this.file = file
  }

  private openSink(): Promise<AudioBufferSink | null> {
    this.sink ??= (async () => {
      try {
        this.input = openInput(this.file)
        const track = await this.input.getPrimaryAudioTrack()
        return track && (await track.canDecode()) ? new AudioBufferSink(track) : null
      } catch {
        return null
      }
    })()
    return this.sink
  }

  // For files the streaming decoder cannot read: decode everything once, as
  // the browser's own decoder only works that way.
  private decodeWhole(): Promise<AudioBuffer | null> {
    this.whole ??= this.file
      .arrayBuffer()
      .then((data) => new OfflineAudioContext(2, 1, 48_000).decodeAudioData(data))
      .catch(() => null)
    return this.whole
  }

  async slice(from: number, to: number): Promise<SourceSlice | null> {
    const sink = await this.openSink()
    if (sink) {
      try {
        const parts: AudioBuffer[] = []
        let startsAt = 0
        for await (const part of sink.buffers(Math.max(0, from), to)) {
          if (parts.length === 0) startsAt = part.timestamp
          parts.push(part.buffer)
        }
        if (parts.length === 0) return null
        const length = parts.reduce((n, p) => n + p.length, 0)
        const { numberOfChannels, sampleRate } = parts[0]
        const buffer = new AudioBuffer({ length, numberOfChannels, sampleRate })
        let offset = 0
        for (const part of parts) {
          for (let c = 0; c < numberOfChannels; c++) {
            buffer.copyToChannel(part.getChannelData(Math.min(c, part.numberOfChannels - 1)), c, offset)
          }
          offset += part.length
        }
        return { buffer, startsAt }
      } catch {
        // Fall through to decoding the whole file.
      }
    }
    const whole = await this.decodeWhole()
    return whole ? { buffer: whole, startsAt: 0 } : null
  }

  dispose() {
    this.input?.dispose()
  }
}

// One reader per file, shared by every clip that uses the file and kept for
// the length of an export.
export class AudioSources {
  private readers = new Map<string, FileAudio>()
  private readonly assets: Assets

  constructor(assets: Assets) {
    this.assets = assets
  }

  // Sound from `path` between `from` and `to` seconds, or null if the file is
  // missing or has no sound that can be decoded.
  slice(path: string, from: number, to: number): Promise<SourceSlice | null> {
    const key = assetKey(path)
    let reader = this.readers.get(key)
    if (!reader) {
      const asset = this.assets[key]
      if (!asset) return Promise.resolve(null)
      reader = new FileAudio(asset.file)
      this.readers.set(key, reader)
    }
    return reader.slice(from, to)
  }

  dispose() {
    for (const reader of this.readers.values()) reader.dispose()
    this.readers.clear()
  }
}
