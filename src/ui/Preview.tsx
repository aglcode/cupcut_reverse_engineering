import { useEffect, useRef } from 'react'
import { drawFrame } from '../engine/compositor'
import { PreviewMedia } from '../engine/previewMedia'
import { resolveFrame } from '../engine/resolve'
import { formatTimecode } from '../model/time'
import type { Draft } from '../model/types'
import { useEditor } from '../state/store'

function Timecode() {
  const playhead = useEditor((s) => s.playhead)
  const duration = useEditor((s) => s.draft.duration)
  const fps = useEditor((s) => s.draft.fps)
  return (
    <span className="timecode">
      {formatTimecode(playhead, fps)} / {formatTimecode(duration, fps)}
    </span>
  )
}

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const width = useEditor((s) => s.draft.canvas_config.width)
  const height = useEditor((s) => s.draft.canvas_config.height)
  const playing = useEditor((s) => s.playing)
  const setPlaying = useEditor((s) => s.setPlaying)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const media = new PreviewMedia()
    // Wall-clock anchor for playback, plus the playhead we last wrote so a seek
    // from elsewhere (ruler, keyboard) can be told apart from our own updates.
    let clock: { wall: number; start: number; written: number } | null = null
    let prunedFor: Draft | null = null
    let raf = 0

    const tick = (now: number) => {
      const state = useEditor.getState()
      const { draft, assets } = state
      let t = state.playhead
      if (state.playing) {
        if (!clock || clock.written !== state.playhead) {
          clock = { wall: now, start: state.playhead, written: state.playhead }
        }
        t = clock.start + (now - clock.wall) * 1000
        if (t >= draft.duration) {
          t = draft.duration
          state.setPlaying(false)
        }
        clock.written = t
        state.setPlayhead(t)
      } else {
        clock = null
      }

      if (prunedFor !== draft) {
        media.prune(new Set(draft.tracks.flatMap((track) => track.segments.map((s) => s.id))))
        prunedFor = draft
      }
      // Parked at the very end, keep showing the last frame instead of black.
      const frame = resolveFrame(draft, Math.min(t, Math.max(0, draft.duration - 1)))
      media.sync(frame, assets, useEditor.getState().playing)
      const { width: w, height: h } = draft.canvas_config
      drawFrame(ctx, w, h, frame.visual, (layer) => media.image(layer, assets))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      media.dispose()
    }
  }, [])

  return (
    <section className="preview" aria-label="Preview">
      <div className="preview-stage">
        <canvas ref={canvasRef} width={width} height={height} />
      </div>
      <div className="transport">
        <button type="button" className="primary" onClick={() => setPlaying(!playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <Timecode />
      </div>
    </section>
  )
}
