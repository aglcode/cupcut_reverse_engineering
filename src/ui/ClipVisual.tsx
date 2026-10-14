import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  getPeaks,
  getThumbnail,
  peakBetween,
  subscribeVisuals,
  THUMB_HEIGHT,
  thumbnailBucket,
  thumbnailStep,
  visualsVersion,
} from '../engine/clipVisuals'
import { getCompoundThumbnail } from '../engine/compoundVisuals'
import type { Asset } from '../engine/media'
import { sourceTimeAt } from '../model/timing'
import type { Segment, VideoMaterial } from '../model/types'
import { useEditor } from '../state/store'

type Props = {
  segment: Segment
  // The file shown; null for a compound clip, whose inside is drawn instead.
  asset: Asset | null
  compound?: VideoMaterial
  // Audio-track clips show a waveform even when their file is a video
  // (extracted audio).
  waveform: boolean
  // Length of the media in microseconds; 0 for a photo.
  mediaDuration: number
  pxPerUs: number
  // The part of the clip that is on screen, in pixels from the clip's left edge.
  from: number
  to: number
  height: number
}

const WAVE_COLOUR = 'rgb(255 255 255 / 0.75)'

// Film-strip thumbnails for a picture clip, or a waveform for an audio clip.
// Only the visible stretch is drawn, so a long clip costs no more than a short one.
export function ClipVisual({
  segment,
  asset,
  compound,
  waveform,
  mediaDuration,
  pxPerUs,
  from,
  to,
  height,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Re-render when a thumbnail or a set of peaks arrives.
  const version = useSyncExternalStore(subscribeVisuals, visualsVersion)
  const assets = useEditor((s) => s.assets)
  const width = Math.max(0, Math.ceil(to - from))

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || width === 0) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const { start } = segment.target_timerange
    // Timeline pixel (from the clip's left edge) to source time.
    const sourceAt = (x: number) => sourceTimeAt(segment, start + x / pxPerUs)

    if (waveform && asset) {
      const peaks = getPeaks(asset)
      if (!peaks) return
      ctx.fillStyle = WAVE_COLOUR
      const gain = Math.min(1, Math.max(0, segment.volume))
      for (let x = 0; x < width; x++) {
        const peak = peakBetween(peaks, sourceAt(from + x), sourceAt(from + x + 1))
        const bar = Math.max(1, peak * gain * height)
        ctx.fillRect(x, (height - bar) / 2, 1, bar)
      }
      return
    }

    const shape = compound ?? asset
    if (!shape) return
    const aspect = shape.height > 0 ? shape.width / shape.height : 16 / 9
    const tileWidth = Math.max(8, Math.round(height * aspect))
    const step = thumbnailStep((tileWidth / pxPerUs) * segment.speed)
    const last = Math.max(0, mediaDuration - 1)
    for (let i = Math.floor(from / tileWidth); i * tileWidth < to; i++) {
      // Each tile shows the frame at its own left edge.
      const source = Math.min(Math.max(0, sourceAt(i * tileWidth)), last)
      const tile = compound
        ? getCompoundThumbnail(compound, source, step, assets, THUMB_HEIGHT)
        : asset && getThumbnail(asset, thumbnailBucket(source, step))
      if (tile) ctx.drawImage(tile, i * tileWidth - from, 0, tileWidth, height)
    }
  }, [segment, asset, compound, assets, waveform, mediaDuration, pxPerUs, from, to, width, height, version])

  if (width === 0) return null
  return (
    <canvas
      ref={canvasRef}
      className="clip-visual"
      style={{ left: from, width, height }}
      data-thumb-height={THUMB_HEIGHT}
      aria-hidden="true"
    />
  )
}
