import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { assetKey } from '../engine/media'
import { effectiveAnimations } from '../model/animations'
import { effectiveFade } from '../model/fades'
import { effectiveRange, hasExportRange, moveRangeEdge } from '../model/exportRange'
import { keyframeTimes, moveKeyframes } from '../model/keyframes'
import { isOneLink, linkedIds } from '../model/links'
import { clipMarkers, removeMarker } from '../model/markers'
import { snapMove, snapTargets, snapTime } from '../model/snap'
import {
  addTrack,
  findMaterial,
  isMagnetTrack,
  moveLinked,
  moveSegment,
  moveSegments,
  removeTrack,
  setMagnet,
  trimSegment,
} from '../model/ops'
import { effectiveTransition } from '../model/transitions'
import { snapToFrame, US_PER_SEC } from '../model/time'
import type { Draft, Segment, Track } from '../model/types'
import { MAX_ZOOM, MIN_ZOOM, useEditor } from '../state/store'
import { ClipVisual } from './ClipVisual'

const HEADER_WIDTH = 112
const TAIL = 10 * US_PER_SEC // empty room after the last clip
const TICK_STEPS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300]
const MIN_TICK_PX = 70
// Inner height of a clip: the 46px row less its margins and border.
const CLIP_HEIGHT = 34
// How close, in pixels, a dragged edge has to come to something before it snaps.
const SNAP_PIXELS = 8
// Clip pictures are drawn this far beyond the visible area, so a little
// scrolling shows them already in place.
const OVERSCAN = 300

type DragMode = 'move' | 'start' | 'end'

function tickLabel(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s < 10 ? '0' : ''}${Number.isInteger(s) ? s : s.toFixed(1)}`
}

function segmentLabel(draft: Draft, segment: Segment): string {
  const material = findMaterial(draft, segment.material_id)
  if (!material) return ''
  if (material.type === 'text') return material.content
  return material.type === 'audio' ? material.name : material.path
}

function Playhead({ pxPerUs }: { pxPerUs: number }) {
  const playhead = useEditor((s) => s.playhead)
  return <div className="playhead" style={{ left: HEADER_WIDTH + playhead * pxPerUs }} />
}

export function Timeline() {
  const draft = useEditor((s) => s.draft)
  const assets = useEditor((s) => s.assets)
  const pxPerSec = useEditor((s) => s.pxPerSec)
  const selectedIds = useEditor((s) => s.selectedIds)
  // The selection box while one is being dragged, in viewport pixels.
  const [marquee, setMarquee] = useState<{
    left: number
    top: number
    right: number
    bottom: number
  } | null>(null)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const { commit, undo, redo, select, setZoom, setPlayhead } = useEditor.getState()
  const { splitAtPlayhead, deleteSelected, addTextAtPlayhead } = useEditor.getState()
  const { rippleDeleteSelected } = useEditor.getState()
  const { copySelected, cutSelected, paste, duplicateSelected } = useEditor.getState()
  const canPaste = useEditor((s) => s.clipboard !== null)
  const snapping = useEditor((s) => s.snapping)
  const { toggleSnapping, toggleMarkerAtPlayhead } = useEditor.getState()
  // Where a dragged edge has snapped to, shown as a line while it is held there.
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const magnet = draft.config.maintrack_adsorb

  const rulerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // The stretch of the lanes that is on screen, in lane pixels.
  const [view, setView] = useState({ from: 0, to: 2000 })

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let frame = 0
    const measure = () => {
      frame = 0
      const from = scroller.scrollLeft
      const to = from + Math.max(0, scroller.clientWidth - HEADER_WIDTH)
      setView((v) => (v.from === from && v.to === to ? v : { from, to }))
    }
    // Scrolling fires far more often than the screen repaints.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    scroller.addEventListener('scroll', schedule, { passive: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      resize.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
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
    const editor = useEditor.getState()
    // A clip brings the clips linked to it along, unless Alt is held. The
    // clicked clip goes last, which makes it the one the inspector shows.
    const linked = e.altKey ? [] : linkedIds(editor.draft, segment.id).filter((id) => id !== segment.id)
    const own = [...linked, segment.id]
    // Ctrl, Cmd or Shift adds the clip to the selection or takes it out.
    if (mode === 'move' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      const current = editor.selectedIds
      editor.selectMany(
        current.includes(segment.id)
          ? current.filter((id) => !own.includes(id))
          : [...current.filter((id) => !own.includes(id)), ...own],
      )
      return
    }
    // Pressing on a clip that is already part of a multi-selection keeps the
    // selection, so the whole group can be dragged.
    const before = editor.selectedIds
    // A link that is selected as a whole is not that kind of group: it has its
    // own way of moving, below.
    const group =
      mode === 'move' &&
      before.length > 1 &&
      before.includes(segment.id) &&
      !isOneLink(editor.draft, before)
    if (!group) editor.selectMany(own)
    // Dragging one clip of a link moves the link.
    const link = mode === 'move' && !group && linked.length > 0
    const grab = timeAt(e.clientX) - segment.target_timerange.start
    // Every pointer move is applied to the draft as it was when the drag
    // began. Building on the previous move instead would compound: with the
    // magnet on, a trimmed clip closes up and would then be trimmed again.
    const base = useEditor.getState().draft
    // What a dragged edge may snap to: the playhead, markers and the edges of
    // clips that are not part of this drag. The magnet's main track has no
    // free positions to snap into, so a drag that reorders it does not snap.
    const moving = group ? before : link ? own : [segment.id]
    const onMagnetTrack = moving.some((id) => {
      const where = base.tracks.findIndex((t) => t.segments.some((s) => s.id === id))
      return isMagnetTrack(base, where)
    })
    const targets =
      useEditor.getState().snapping && !(mode === 'move' && onMagnetTrack)
        ? snapTargets(base, useEditor.getState().playhead, moving)
        : []
    const reach = SNAP_PIXELS / pxPerUs
    let checkpointed = false
    // Whether the pointer really travelled. A drag that could not move anything
    // (the group is boxed in) is still a drag, not a click.
    let dragged = false

    const move = (ev: PointerEvent) => {
      const state = useEditor.getState()
      if (Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3) dragged = true
      const pointer = timeAt(ev.clientX)
      // A move snaps whichever end of the dragged clip is nearer something; a
      // trim snaps the edge being dragged.
      const snap =
        mode === 'move'
          ? snapMove(pointer - grab, segment.target_timerange.duration, targets, reach)
          : snapTime(pointer, targets, reach)
      const start = mode === 'move' && snap ? snap.time : pointer - grab
      const t = mode !== 'move' && snap ? snap.time : pointer
      setSnapLine(snap ? snap.target : null)
      let next: Draft
      if (group) {
        next = moveSegments(base, state.selectedIds, segment.id, start)
      } else if (link) {
        next = moveLinked(base, segment.id, start)
      } else if (mode === 'move') {
        // The row is picked by height alone: looked up just inside the lanes,
        // so a drag that strays over the track names still finds its track.
        const laneLeft = rulerRef.current?.getBoundingClientRect().left ?? 0
        const row = document
          .elementFromPoint(Math.max(ev.clientX, laneLeft + 1), ev.clientY)
          ?.closest<HTMLElement>('[data-track-id]')
        // Only tracks of the same type accept the clip; otherwise it stays put.
        const toTrack = row?.dataset.trackType === track.type ? row.dataset.trackId : undefined
        next = moveSegment(base, segment.id, start, toTrack)
      } else {
        next = trimSegment(base, segment.id, mode, t)
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
      setSnapLine(null)
      // A plain click on one clip of a group, with no drag, selects just it.
      if (group && !dragged) useEditor.getState().selectMany(own)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  // Dragging an end of the export range on the ruler moves that end. It snaps
  // like a clip edge does, and the whole drag is one undo step.
  const startRangeDrag = (e: ReactPointerEvent, edge: 'start' | 'end') => {
    e.stopPropagation()
    e.preventDefault()
    const editor = useEditor.getState()
    const base = editor.draft
    const targets = editor.snapping ? snapTargets(base, editor.playhead, []) : []
    const reach = SNAP_PIXELS / pxPerUs
    let checkpointed = false

    const move = (ev: PointerEvent) => {
      if (!checkpointed && Math.abs(ev.clientX - e.clientX) <= 3) return
      const state = useEditor.getState()
      const snap = snapTime(timeAt(ev.clientX), targets, reach)
      setSnapLine(snap ? snap.target : null)
      if (!checkpointed) {
        state.checkpoint()
        checkpointed = true
      }
      state.preview(moveRangeEdge(base, edge, snap ? snap.time : timeAt(ev.clientX)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      setSnapLine(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  // A press on a keyframe marker goes to that keyframe; dragging it moves the
  // keyframe, with the playhead following so the preview shows the result.
  const startKeyframeDrag = (e: ReactPointerEvent, segment: Segment, from: number) => {
    e.stopPropagation()
    e.preventDefault()
    const editor = useEditor.getState()
    editor.select(segment.id)
    editor.setPlaying(false)
    editor.setPlayhead(from)
    const base = editor.draft
    let checkpointed = false

    const move = (ev: PointerEvent) => {
      if (!checkpointed && Math.abs(ev.clientX - e.clientX) <= 3) return
      const state = useEditor.getState()
      const next = moveKeyframes(base, segment.id, from, timeAt(ev.clientX))
      if (next === state.draft) return
      if (!checkpointed) {
        state.checkpoint()
        checkpointed = true
      }
      state.preview(next)
      // Follow the keyframe: it is the one nearest the pointer that is not
      // where any keyframe was before.
      const moved = next.tracks.flatMap((t) => t.segments).find((s) => s.id === segment.id)
      const before = new Set(keyframeTimes(segment))
      const now = moved ? keyframeTimes(moved).find((time) => !before.has(time)) : undefined
      state.setPlayhead(now ?? from)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  // Dragging on empty timeline draws a box and selects every clip it touches.
  const startMarquee = (e: ReactPointerEvent) => {
    // Stops the browser starting a text selection of its own.
    e.preventDefault()
    const origin = { x: e.clientX, y: e.clientY }
    const additive = e.ctrlKey || e.metaKey || e.shiftKey
    const kept = additive ? useEditor.getState().selectedIds : []
    let dragged = false

    const move = (ev: PointerEvent) => {
      const box = {
        left: Math.min(origin.x, ev.clientX),
        top: Math.min(origin.y, ev.clientY),
        right: Math.max(origin.x, ev.clientX),
        bottom: Math.max(origin.y, ev.clientY),
      }
      // A few pixels of slack, so a click with a shaky hand is still a click.
      if (!dragged && box.right - box.left < 4 && box.bottom - box.top < 4) return
      dragged = true
      setMarquee(box)
      const hit = [...document.querySelectorAll<HTMLElement>('.clip[data-segment-id]')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.left < box.right && box.left < r.right && r.top < box.bottom && box.top < r.bottom
        })
        .map((el) => el.dataset.segmentId!)
      useEditor.getState().selectMany([...new Set([...kept, ...hit])])
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      setMarquee(null)
      if (!dragged && !additive) select(null)
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
        <button type="button" onClick={deleteSelected} disabled={selectedIds.length === 0}>
          Delete
        </button>
        <button
          type="button"
          title="Delete and close the gap on that track (Shift+Delete)"
          onClick={rippleDeleteSelected}
          disabled={selectedIds.length === 0}
        >
          Ripple delete
        </button>
        <span className="divider" />
        <button type="button" title="Copy (Ctrl+C)" onClick={copySelected} disabled={selectedIds.length === 0}>
          Copy
        </button>
        <button type="button" title="Cut (Ctrl+X)" onClick={cutSelected} disabled={selectedIds.length === 0}>
          Cut
        </button>
        <button type="button" title="Paste at the playhead (Ctrl+V)" onClick={paste} disabled={!canPaste}>
          Paste
        </button>
        <button
          type="button"
          title="Duplicate the selection after itself (Ctrl+D)"
          onClick={duplicateSelected}
          disabled={selectedIds.length === 0}
        >
          Duplicate
        </button>
        <span className="divider" />
        <button
          type="button"
          className={magnet ? 'toggle on' : 'toggle'}
          aria-pressed={magnet}
          title="Main-track magnet: keep the main video track packed with no gaps"
          onClick={() => commit(setMagnet(useEditor.getState().draft, !magnet))}
        >
          Magnet
        </button>
        <span className="divider" />
        <button
          type="button"
          title="Add a marker at the playhead, or remove the one there (M). It goes on the selected clip if the playhead is on it."
          onClick={toggleMarkerAtPlayhead}
        >
          Marker
        </button>
        <button
          type="button"
          className={snapping ? 'toggle on' : 'toggle'}
          aria-pressed={snapping}
          title="Snap dragged clips to the playhead, markers and other clips (N)"
          onClick={toggleSnapping}
        >
          Snap
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

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-content" style={{ width: HEADER_WIDTH + width }}>
          <div className="ruler-row">
            <div className="track-header" />
            <div className="ruler" ref={rulerRef} style={{ width }} onPointerDown={startScrub}>
              {hasExportRange(draft) && (
                <span
                  className="export-range"
                  style={{
                    left: effectiveRange(draft).start * pxPerUs,
                    width: effectiveRange(draft).duration * pxPerUs,
                  }}
                >
                  <span
                    className="range-handle range-handle-start"
                    title="Export range start: drag to move it"
                    onPointerDown={(e) => startRangeDrag(e, 'start')}
                  />
                  <span
                    className="range-handle range-handle-end"
                    title="Export range end: drag to move it"
                    onPointerDown={(e) => startRangeDrag(e, 'end')}
                  />
                </span>
              )}
              {draft.time_marks.map((m) => (
                <span
                  key={m.id}
                  className="marker"
                  title={`${m.title}: click to go to it, double-click to remove it`}
                  style={{ left: m.time_range.start * pxPerUs, background: m.color }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    useEditor.getState().setPlaying(false)
                    setPlayhead(m.time_range.start)
                  }}
                  onDoubleClick={() => commit(removeMarker(useEditor.getState().draft, m.id))}
                />
              ))}
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
                <span className="track-name">
                  {track.name}
                  {isMagnetTrack(draft, draft.tracks.indexOf(track)) && (
                    <span className="main-tag" title="Main track: kept packed by the magnet">
                      main
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove ${track.name}`}
                  disabled={
                    draft.tracks.length === 1 || isMagnetTrack(draft, draft.tracks.indexOf(track))
                  }
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
                onPointerDown={startMarquee}
              >
                {track.segments.map((segment, index) => {
                  const material = findMaterial(draft, segment.material_id)
                  const offline =
                    material !== null && material.type !== 'text' && !assets[assetKey(material.path)]
                  const fade = effectiveFade(segment)
                  const animated = effectiveAnimations(segment)
                  const transition = effectiveTransition(track, index)
                  const asset =
                    material !== null && material.type !== 'text'
                      ? assets[assetKey(material.path)]
                      : undefined
                  const clipLeft = segment.target_timerange.start * pxPerUs
                  const clipWidth = segment.target_timerange.duration * pxPerUs
                  const clamp = (x: number) => Math.min(clipWidth, Math.max(0, x - clipLeft))
                  const visibleFrom = clamp(view.from - OVERSCAN)
                  const visibleTo = clamp(view.to + OVERSCAN)
                  const classes = ['clip', `clip-${track.type}`]
                  if (selectedIds.includes(segment.id)) classes.push('selected')
                  if (offline) classes.push('offline')
                  if (segment.group_id) classes.push('linked')
                  return (
                    <div
                      key={segment.id}
                      className={classes.join(' ')}
                      data-segment-id={segment.id}
                      style={{
                        left: segment.target_timerange.start * pxPerUs,
                        width: segment.target_timerange.duration * pxPerUs,
                      }}
                      title={offline ? `${segmentLabel(draft, segment)} (media not imported)` : undefined}
                      onPointerDown={(e) => startDrag(e, track, segment, 'move')}
                    >
                      {asset && material && material.type !== 'text' && (
                        <ClipVisual
                          segment={segment}
                          asset={asset}
                          waveform={track.type === 'audio'}
                          mediaDuration={material.duration}
                          pxPerUs={pxPerUs}
                          from={visibleFrom}
                          to={visibleTo}
                          height={CLIP_HEIGHT}
                        />
                      )}
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
                      {animated.in && (
                        <span
                          className="anim anim-in"
                          title={`In: ${animated.in.name}`}
                          style={{ width: animated.in.duration * pxPerUs }}
                        />
                      )}
                      {animated.out && (
                        <span
                          className="anim anim-out"
                          title={`Out: ${animated.out.name}`}
                          style={{ width: animated.out.duration * pxPerUs }}
                        />
                      )}
                      <span
                        className="handle handle-start"
                        onPointerDown={(e) => startDrag(e, track, segment, 'start')}
                      />
                      <span className="clip-label">
                        {segmentLabel(draft, segment)}
                        {segment.curve_speed
                          ? ' · ramp'
                          : segment.speed !== 1 && ` · ${Number(segment.speed.toFixed(2))}×`}
                        {segment.reverse && ' · reversed'}
                        {segment.freeze && ' · freeze'}
                      </span>
                      {transition && (
                        <span
                          className="transition-badge"
                          title={`${transition.name} transition to the next clip`}
                          style={{ width: ((transition.to - transition.from) / 2) * pxPerUs }}
                        />
                      )}
                      {clipMarkers(segment).map(({ marker, time }) => (
                        <span
                          key={marker.id}
                          className="clip-marker"
                          title={`${marker.title}: click to go to it, double-click to remove it`}
                          style={{
                            left: (time - segment.target_timerange.start) * pxPerUs,
                            background: marker.color,
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation()
                            useEditor.getState().setPlaying(false)
                            setPlayhead(time)
                          }}
                          onDoubleClick={() =>
                            commit(removeMarker(useEditor.getState().draft, marker.id))
                          }
                        />
                      ))}
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
                            title="Keyframe: click to go to it, drag to move it"
                            // Kept clear of the clip edge so a keyframe on the first frame shows.
                            style={{ left: Math.max(6, (t - segment.target_timerange.start) * pxPerUs) }}
                            onPointerDown={(e) => startKeyframeDrag(e, segment, t)}
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
          {snapLine !== null && (
            <div className="snap-line" style={{ left: HEADER_WIDTH + snapLine * pxPerUs }} />
          )}
          {marquee && (
            <div
              className="marquee"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.right - marquee.left,
                height: marquee.bottom - marquee.top,
              }}
            />
          )}
        </div>
      </div>
    </section>
  )
}
