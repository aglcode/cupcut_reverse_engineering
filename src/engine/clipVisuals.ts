// Thumbnails and waveforms for timeline clips.
//
// Same approach as CapCut's caches (Cache\frameThumbnail\<media>\82x46\<µs>.png
// and Cache\audioWave\<media>.waveDataV2): small thumbnails made per media file
// at requested source times and reused, and one set of peaks per audio file.
// Here both live in memory, are produced in the background, and are requested
// only for the part of a clip that is on screen.

import { CanvasSink, type Input } from 'mediabunny'
import { openInput, type Asset } from './media'

// Thumbnails are decoded at this height; the timeline scales them down.
export const THUMB_HEIGHT = 46
export const PEAKS_PER_SEC = 100

// ---- change notification -------------------------------------------------

const listeners = new Set<() => void>()
let version = 0
let scheduled = false

// Many thumbnails can arrive in one frame; listeners hear about them once.
function changed() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    version++
    for (const listener of listeners) listener()
  })
}

export function subscribeVisuals(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const visualsVersion = (): number => version

// ---- thumbnails ----------------------------------------------------------

const MIN_STEP = 250_000

// Thumbnails are requested on a grid of source times so that neighbouring
// tiles, scrolling and small zoom changes reuse the same ones. The grid gets
// coarser as each tile covers more time: 0.25 s, 0.5 s, 1 s, 2 s, and so on.
export function thumbnailStep(tileDurationUs: number): number {
  if (!(tileDurationUs > MIN_STEP)) return MIN_STEP
  return MIN_STEP * 2 ** Math.ceil(Math.log2(tileDurationUs / MIN_STEP))
}

export const thumbnailBucket = (sourceUs: number, stepUs: number): number =>
  Math.max(0, Math.floor(sourceUs / stepUs) * stepUs)

type ThumbSource = {
  tiles: Map<number, CanvasImageSource | null>
  wanted: number[]
  busy: boolean
  failed: boolean
  input: Input | null
  sink: CanvasSink | null
}

const thumbSources = new Map<string, ThumbSource>()

async function pump(asset: Asset, source: ThumbSource) {
  if (source.busy || source.failed) return
  source.busy = true
  try {
    if (!source.sink) {
      source.input = openInput(asset.file)
      const track = await source.input.getPrimaryVideoTrack()
      if (!track || !(await track.canDecode())) {
        source.failed = true
        return
      }
      const aspect = asset.height > 0 ? asset.width / asset.height : 16 / 9
      source.sink = new CanvasSink(track, {
        width: Math.max(2, Math.round(THUMB_HEIGHT * aspect)),
        height: THUMB_HEIGHT,
        fit: 'fill',
      })
    }
    // Newest request first, so what the user is looking at now comes before
    // what they scrolled past.
    for (let bucket = source.wanted.pop(); bucket !== undefined; bucket = source.wanted.pop()) {
      if (source.tiles.get(bucket) !== undefined) continue
      const frame = await source.sink.getCanvas(bucket / 1_000_000)
      source.tiles.set(bucket, frame ? frame.canvas : null)
      changed()
    }
  } catch {
    source.failed = true
  } finally {
    source.busy = false
  }
}

// The thumbnail for a source time, or null while it is still being made (the
// request is queued and subscribers are told when it arrives).
export function getThumbnail(asset: Asset, bucketUs: number): CanvasImageSource | null {
  if (asset.image) return asset.image
  let source = thumbSources.get(asset.url)
  if (!source) {
    source = { tiles: new Map(), wanted: [], busy: false, failed: false, input: null, sink: null }
    thumbSources.set(asset.url, source)
  }
  const tile = source.tiles.get(bucketUs)
  if (tile !== undefined) return tile
  if (!source.failed && !source.wanted.includes(bucketUs)) {
    source.wanted.push(bucketUs)
    void pump(asset, source)
  }
  return null
}

// ---- waveforms -----------------------------------------------------------

// Loudest sample in each 1/PEAKS_PER_SEC slice, across all channels.
export function computePeaks(channels: Float32Array[], sampleRate: number): Float32Array {
  const length = channels[0]?.length ?? 0
  const size = Math.max(1, Math.round(sampleRate / PEAKS_PER_SEC))
  const peaks = new Float32Array(Math.ceil(length / size))
  for (const data of channels) {
    for (let i = 0; i < length; i++) {
      const value = Math.abs(data[i])
      const slot = Math.floor(i / size)
      if (value > peaks[slot]) peaks[slot] = value
    }
  }
  return peaks
}

// Loudest peak between two source times.
export function peakBetween(peaks: Float32Array, fromUs: number, toUs: number): number {
  const lo = Math.min(fromUs, toUs)
  const hi = Math.max(fromUs, toUs)
  const first = Math.max(0, Math.floor((lo / 1_000_000) * PEAKS_PER_SEC))
  const last = Math.min(peaks.length - 1, Math.floor((hi / 1_000_000) * PEAKS_PER_SEC))
  let max = 0
  for (let i = first; i <= last; i++) if (peaks[i] > max) max = peaks[i]
  return max
}

const peakCache = new Map<string, Float32Array | 'pending' | 'failed'>()

// Peaks for an audio file, or null while they are being worked out.
export function getPeaks(asset: Asset): Float32Array | null {
  const cached = peakCache.get(asset.url)
  if (cached instanceof Float32Array) return cached
  if (cached) return null
  peakCache.set(asset.url, 'pending')
  asset.file
    .arrayBuffer()
    // An offline context can decode without a user gesture and plays nothing.
    .then((data) => new OfflineAudioContext(1, 1, 44_100).decodeAudioData(data))
    .then((buffer) => {
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
        buffer.getChannelData(c),
      )
      peakCache.set(asset.url, computePeaks(channels, buffer.sampleRate))
    })
    .catch(() => peakCache.set(asset.url, 'failed'))
    .finally(changed)
  return null
}

// Frees everything held for a file that has been replaced.
export function dropVisuals(url: string) {
  thumbSources.get(url)?.input?.dispose()
  thumbSources.delete(url)
  peakCache.delete(url)
}
