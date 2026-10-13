import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { assetKey } from '../engine/media'
import { effectiveFade } from '../model/fades'
import { keyframeTimes } from '../model/keyframes'
import { addTrack, findMaterial, moveSegment, removeTrack, trimSegment } from '../model/ops'
import { effectiveTransition } from '../model/transitions'
import { snapToFrame, US_PER_SEC } from '../model/time'
import type { Draft, Segment, Track } from '../model/types'
import { MAX_ZOOM, MIN_ZOOM, useEditor } from '../state/store'

const HEADER_WIDTH = 112
const TAIL = 10 * US_PER_SEC // empty room after the last clip
const TICK_STEPS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300]
const MIN_TICK_PX = 70

type DragMode = 'move' | 'start' | 'end'

function tickLabel(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s < 10 ? '0' : ''}${Number.isInteger(s) ? s : s.toFixed(1)}`
}

function segmentLabel(draft: Draft, segment: Segment): string {
  const material = findMaterial(draft, segment.material_id)
  if (!material) return ''
  return material.type === 'text' ? material.content : material.path
}

function Playhead({ pxPerUs }: { pxPerUs: number }) {
  const playhead = useEditor((s) => s.playhead)
  return <div className="playhead" style={{ left: HEADER_WIDTH + playhead * pxPerUs }} />
}

export function Timeline() {
  const draft = useEditor((s) => s.draft)
  const assets = useEditor((s) => s.assets)
  const pxPerSec = useEditor((s) => s.pxPerSec)
  const selectedId = useEditor((s) => s.selectedId)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const { commit, undo, redo, select, setZoom, setPlayhead } = useEditor.getState()
  const { splitAtPlayhead, deleteSelected, addTextAtPlayhead } = useEditor.getState()

  const rulerRef = useRef<HTMLDivElement>(null)
  const pxPerUs = pxPerSec / US_PER_SEC
  const width = (draft.duration + TAIL) * pxPerUs

  const timeAt = (clientX: number): number => {
    const left = rulerRef.current?.getBoundingClientRect().left ?? 0
    return Math.max(0, (clientX - left) / pxPerUs)
  }

  const seek = (clientX: number) => {
    const state = useEditor.getState()
    state.setPlaying(false)
    setPlayhead(snapToFrame(timeAt(clientX), state.draft.fps))
  }

  const startScrub = (e: ReactPointerEvent) => {
    seek(e.clientX)
    const move = (ev: PointerEvent) => seek(ev.clientX)
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const startDrag = (e: ReactPointerEvent, track: Track, segment: Segment, mode: DragMode) => {
    e.stopPropagation()
    e.preventDefault()
    select(segment.id)
    const grab = timeAt(e.clientX) - segment.target_timerange.start
    let checkpointed = false

    const move = (ev: PointerEvent) => {
      const state = useEditor.getState()
      const t = timeAt(ev.clientX)
      let next: Draft
      if (mode === 'move') {
        const row = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest<HTMLElement>('[data-track-id]')
        // Only tracks of the same type accept the clip; otherwise it stays put.
        const toTrack = row?.dataset.trackType === track.type ? row.dataset.trackId : undefined
        next = moveSegment(state.draft, segment.id, t - grab, toTrack)
      } else {
        next = trimSegment(state.draft, segment.id, mode, t)
      }
      if (next === state.draft) return
      // The whole drag is one undo step.
      if (!checkpointed) {
        state.checkpoint()
        checkpointed = true
      }
      state.preview(next)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const step = TICK_STEPS.find((s) => s * pxPerSec >= MIN_TICK_PX) ?? 600
  const ticks: number[] = []
  for (let s = 0; s * US_PER_SEC <= draft.duration + TAIL; s += step) ticks.push(s)

  // Later tracks render on top, so they are listed first.
  const rows = [...draft.tracks].reverse()

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="toolbar">
        <button type="button" onClick={undo} disabled={!canUndo}>
          Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo}>
          Redo
        </button>
        <span className="divider" />
        <button type="button" onClick={splitAtPlayhead}>
          Split
        </button>
        <button type="button" onClick={deleteSelected} disabled={!selectedId}>
          Delete
        </button>
        <span className="divider" />
        <button type="button" onClick={addTextAtPlayhead}>
          Add text
        </button>
        <button type="button" onClick={() => commit(addTrack(useEditor.getState().draft, 'video'))}>
          Add video track
        </button>
        <button type="button" onClick={() => commit(addTrack(useEditor.getState().draft, 'audio'))}>
          Add audio track
        </button>
        <label className="zoom">
          Zoom
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            value={pxPerSec}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="timeline-scroll">
        <div className="timeline-content" style={{ width: HEADER_WIDTH + width }}>
          <div className="ruler-row">
            <div className="track-header" />
            <div className="ruler" ref={rulerRef} style={{ width }} onPointerDown={startScrub}>
              {ticks.map((s) => (
                <span key={s} className="tick" style={{ left: s * pxPerSec }}>
                  {tickLabel(s)}
                </span>
              ))}
            </div>
          </div>

          {rows.map((track) => (
            <div className="track-row" key={track.id}>
              <div className="track-header">
                <span className="track-name">{track.name}</span>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove ${track.name}`}
                  disabled={draft.tracks.length === 1}
                  onClick={() => commit(removeTrack(useEditor.getState().draft, track.id))}
                >
                  ×
                </button>
              </div>
              <div
                className={`lane lane-${track.type}`}
                style={{ width }}
                data-track-id={track.id}
                data-track-type={track.type}
                onPointerDown={() => select(null)}
              >
                {track.segments.map((segment, index) => {
                  const material = findMaterial(draft, segment.material_id)
                  const offline =
                    material !== null && material.type !== 'text' && !assets[assetKey(material.path)]
                  const fade = effectiveFade(segment)
                  const transition = effectiveTransition(track, index)
                  const classes = ['clip', `clip-${track.type}`]
                  if (segment.id === selectedId) classes.push('selected')
                  if (offline) classes.push('offline')
                  return (
                    <div
                      key={segment.id}
                      className={classes.join(' ')}
                      style={{
                        left: segment.target_timerange.start * pxPerUs,
                        width: segment.target_timerange.duration * pxPerUs,
                      }}
                      title={offline ? `${segmentLabel(draft, segment)} (media not imported)` : undefined}
                      onPointerDown={(e) => startDrag(e, track, segment, 'move')}
                    >
                      {fade.fade_in_duration > 0 && (
                        <span
                          className="fade fade-in"
                          style={{ width: fade.fade_in_duration * pxPerUs }}
                        />
                      )}
                      {fade.fade_out_duration > 0 && (
                        <span
                          className="fade fade-out"
                          style={{ width: fade.fade_out_duration * pxPerUs }}
                        />
                      )}
                      <span
                        className="handle handle-start"
                        onPointerDown={(e) => startDrag(e, track, segment, 'start')}
                      />
                      <span className="clip-label">
                        {segmentLabel(draft, segment)}
                        {segment.speed !== 1 && ` · ${Number(segment.speed.toFixed(2))}×`}
                      </span>
                      {transition && (
                        <span
                          className="transition-badge"
                          title={`${transition.name} transition to the next clip`}
                          style={{ width: ((transition.to - transition.from) / 2) * pxPerUs }}
                        />
                      )}
                      {keyframeTimes(segment)
                        .filter(
                          (t) =>
                            t >= segment.target_timerange.start &&
                            t < segment.target_timerange.start + segment.target_timerange.duration,
                        )
                        .map((t) => (
                          <span
                            key={t}
                            className="keyframe-marker"
                            title="Keyframe"
                            // Kept clear of the clip edge so a keyframe on the first frame shows.
                            style={{ left: Math.max(6, (t - segment.target_timerange.start) * pxPerUs) }}
                            onPointerDown={(e) => {
                              // Jump to the keyframe instead of starting a drag.
                              e.stopPropagation()
                              select(segment.id)
                              useEditor.getState().setPlaying(false)
                              setPlayhead(t)
                            }}
                          />
                        ))}
                      <span
                        className="handle handle-end"
                        onPointerDown={(e) => startDrag(e, track, segment, 'end')}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          <Playhead pxPerUs={pxPerUs} />
        </div>
      </div>
    </section>
  )
}
