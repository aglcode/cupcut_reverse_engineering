// Real-time preview playback. Each video or audio segment gets its own media
// element, which is kept in step with the timeline clock. Export does not use
// this; it decodes exact frames instead (see exporter.ts).

import type { FrameImage } from './compositor'
import { assetKey, type Assets } from './media'
import type { ResolvedFrame, VisualLayer } from './resolve'

// How far an element may drift from the timeline before it is re-seeked.
const DRIFT_PLAYING = 0.3
const DRIFT_PAUSED = 0.01

type Wanted = {
  path: string
  sourceUs: number
  speed: number
  volume: number
  // Media elements cannot play backwards or stand still on a frame while
  // "playing", so reversed and frozen clips are shown by seeking every tick.
  seekOnly: boolean
}

export class PreviewMedia {
  private elements = new Map<string, HTMLMediaElement>()
  // Last frame shown for clips that are driven by seeking. A video element has
  // no picture while a seek is in flight, which would flash black many times a
  // second during reversed playback.
  private held = new Map<string, OffscreenCanvas>()

  sync(frame: ResolvedFrame, assets: Assets, playing: boolean) {
    const wanted = new Map<string, Wanted>()
    for (const layer of frame.visual) {
      if (layer.kind !== 'media' || layer.material.type !== 'video') continue
      wanted.set(layer.segment.id, {
        path: layer.material.path,
        sourceUs: layer.sourceUs,
        speed: layer.segment.speed,
        volume: 0,
        seekOnly: layer.segment.reverse || layer.segment.freeze,
      })
    }
    for (const layer of frame.audio) {
      wanted.set(layer.segment.id, {
        path: layer.path,
        sourceUs: layer.sourceUs,
        speed: layer.segment.speed,
        // Reversed sound cannot be previewed this way; it is in the export.
        volume: layer.segment.reverse ? 0 : layer.volume,
        seekOnly: layer.segment.reverse,
      })
    }

    for (const [id, el] of this.elements) {
      if (!wanted.has(id) && !el.paused) el.pause()
    }

    for (const [id, want] of wanted) {
      const asset = assets[assetKey(want.path)]
      if (!asset || asset.kind === 'image') continue
      let el = this.elements.get(id)
      if (!el || el.src !== asset.url) {
        el?.pause()
        el = document.createElement(asset.kind === 'video' ? 'video' : 'audio')
        el.preload = 'auto'
        // Export resamples audio for speed changes, which shifts pitch; the
        // preview does the same so the two sound alike.
        el.preservesPitch = false
        el.src = asset.url
        this.elements.set(id, el)
      }
      const time = want.sourceUs / 1_000_000
      el.playbackRate = Math.min(16, Math.max(0.0625, want.speed))
      el.volume = Math.min(1, Math.max(0, want.volume))
      el.muted = want.volume <= 0
      if (playing && !want.seekOnly) {
        if (el.paused) {
          el.currentTime = time
          void el.play().catch(() => {})
        } else if (Math.abs(el.currentTime - time) > DRIFT_PLAYING) {
          el.currentTime = time
        }
      } else {
        if (!el.paused) el.pause()
        if (!el.seeking && Math.abs(el.currentTime - time) > DRIFT_PAUSED) el.currentTime = time
      }
    }
  }

  image(layer: Extract<VisualLayer, { kind: 'media' }>, assets: Assets): FrameImage | null {
    const asset = assets[assetKey(layer.material.path)]
    if (!asset) return null
    if (asset.image) return { image: asset.image, width: asset.width, height: asset.height }
    const { id, reverse, freeze } = layer.segment
    const el = this.elements.get(id)
    const ready =
      el instanceof HTMLVideoElement &&
      el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      el.videoWidth > 0
    if (!(reverse || freeze)) {
      this.held.delete(id)
      return ready ? { image: el, width: el.videoWidth, height: el.videoHeight } : null
    }
    let copy = this.held.get(id)
    if (ready && !el.seeking) {
      if (!copy || copy.width !== el.videoWidth || copy.height !== el.videoHeight) {
        copy = new OffscreenCanvas(el.videoWidth, el.videoHeight)
        this.held.set(id, copy)
      }
      copy.getContext('2d')?.drawImage(el, 0, 0)
    }
    return copy ? { image: copy, width: copy.width, height: copy.height } : null
  }

  // Drops elements for segments that no longer exist.
  prune(liveSegmentIds: Set<string>) {
    for (const [id, el] of this.elements) {
      if (liveSegmentIds.has(id)) continue
      el.pause()
      el.removeAttribute('src')
      el.load()
      this.elements.delete(id)
      this.held.delete(id)
    }
  }

  dispose() {
    this.prune(new Set())
  }
}
