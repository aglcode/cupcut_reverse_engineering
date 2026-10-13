import { useRef } from 'react'
import { findSegment, setSpeedCurve } from '../model/ops'
import { MAX_CURVE_SPEED, MIN_CURVE_SPEED, speedAtProgress } from '../model/speedCurve'
import type { Draft, Segment, SpeedPoint } from '../model/types'
import { useEditor } from '../state/store'

const WIDTH = 240
const HEIGHT = 120
const PAD = 10
// Points may not sit closer together than this along the clip.
const MIN_GAP = 0.01
const GRID = [MIN_CURVE_SPEED, 1, MAX_CURVE_SPEED]
// How many pieces each stretch between two points is drawn in.
const DETAIL = 12

// Speed is drawn on a log scale, so half speed and double speed are the same
// distance from 1×.
const LOW = Math.log(MIN_CURVE_SPEED)
const HIGH = Math.log(MAX_CURVE_SPEED)
const xOf = (x: number) => PAD + x * (WIDTH - 2 * PAD)
const yOf = (speed: number) => {
  const clamped = Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, speed))
  return PAD + (1 - (Math.log(clamped) - LOW) / (HIGH - LOW)) * (HEIGHT - 2 * PAD)
}
const speedOf = (y: number) => {
  const up = 1 - (y - PAD) / (HEIGHT - 2 * PAD)
  return Math.exp(LOW + Math.min(1, Math.max(0, up)) * (HIGH - LOW))
}

// A point's new place, kept between its neighbours. The two end points only
// move up and down.
function moved(points: SpeedPoint[], index: number, x: number, y: number): SpeedPoint[] {
  const last = points.length - 1
  const fixed = index === 0 ? 0 : index === last ? 1 : null
  const low = index > 0 ? points[index - 1].x + MIN_GAP : 0
  const high = index < last ? points[index + 1].x - MIN_GAP : 1
  const next = {
    x: fixed ?? Math.min(Math.max(x, low), Math.max(low, high)),
    y: Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, y)),
  }
  return points.map((p, i) => (i === index ? next : p))
}

type Props = { segment: Segment }

// The graph of a clip's speed ramp. Left to right is the clip's footage from
// its first frame to its last; height is how fast it plays there.
export function SpeedCurveEditor({ segment }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  // The draft and points as they were when a drag began. Every move is applied
  // to these, since setting a ramp rescales the clip and with it the points.
  const drag = useRef<{ draft: Draft; points: SpeedPoint[]; index: number } | null>(null)
  const curve = segment.curve_speed
  if (!curve) return null
  const points = curve.speed_points

  const apply = (draft: Draft, next: SpeedPoint[]) =>
    setSpeedCurve(draft, segment.id, { name: 'Custom', speed_points: next })

  // Pointer position as a place on the graph.
  const locate = (event: { clientX: number; clientY: number }) => {
    const box = svgRef.current!.getBoundingClientRect()
    const px = ((event.clientX - box.left) / box.width) * WIDTH
    const py = ((event.clientY - box.top) / box.height) * HEIGHT
    return { x: Math.min(1, Math.max(0, (px - PAD) / (WIDTH - 2 * PAD))), y: speedOf(py) }
  }

  const addPoint = (event: React.MouseEvent) => {
    const { x } = locate(event)
    const after = points.findIndex((p) => p.x > x)
    if (after <= 0) return
    const a = points[after - 1]
    const b = points[after]
    if (x - a.x < MIN_GAP || b.x - x < MIN_GAP) return
    // At the speed the clip already has there, so adding a point changes
    // nothing by itself.
    const y = speedAtProgress(points, x)
    const state = useEditor.getState()
    state.commit(apply(state.draft, [...points.slice(0, after), { x, y }, ...points.slice(after)]))
  }

  const removePoint = (index: number) => {
    if (index === 0 || index === points.length - 1 || points.length <= 2) return
    const state = useEditor.getState()
    state.commit(apply(state.draft, points.filter((_, i) => i !== index)))
  }

  const nudge = (index: number, event: React.KeyboardEvent) => {
    const p = points[index]
    const step = event.shiftKey ? 5 : 1
    let next: SpeedPoint[] | null = null
    if (event.key === 'ArrowUp') next = moved(points, index, p.x, p.y * 1.05 ** step)
    if (event.key === 'ArrowDown') next = moved(points, index, p.x, p.y / 1.05 ** step)
    if (event.key === 'ArrowLeft') next = moved(points, index, p.x - 0.01 * step, p.y)
    if (event.key === 'ArrowRight') next = moved(points, index, p.x + 0.01 * step, p.y)
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
      removePoint(index)
      return
    }
    if (!next) return
    event.preventDefault()
    event.stopPropagation()
    const state = useEditor.getState()
    state.commit(apply(state.draft, next))
  }

  // The speed the clip really has along its footage, which between two
  // points is not quite a straight line.
  const line = points
    .flatMap((p, i) => {
      const next = points[i + 1]
      if (!next || next.x <= p.x) return [p]
      return Array.from({ length: DETAIL }, (_, k) => {
        const x = p.x + ((next.x - p.x) * k) / DETAIL
        return k === 0 ? p : { x, y: speedAtProgress(points, x) }
      })
    })
    .map((p) => `${xOf(p.x)},${yOf(p.y)}`)
    .join(' ')

  return (
    <div className="speed-curve">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label="Speed ramp"
        onDoubleClick={addPoint}
      >
        {GRID.map((speed) => (
          <g key={speed}>
            <line className="speed-grid" x1={PAD} x2={WIDTH - PAD} y1={yOf(speed)} y2={yOf(speed)} />
            <text className="speed-grid-label" x={PAD + 2} y={yOf(speed) - 2}>
              {speed}×
            </text>
          </g>
        ))}
        <polyline className="speed-line" points={line} />
        {points.map((p, i) => (
          <circle
            key={i}
            className="speed-point"
            cx={xOf(p.x)}
            cy={yOf(p.y)}
            r={5}
            tabIndex={0}
            role="slider"
            aria-label={`Point ${i + 1} of ${points.length}`}
            aria-valuemin={MIN_CURVE_SPEED}
            aria-valuemax={MAX_CURVE_SPEED}
            aria-valuenow={Number(p.y.toFixed(2))}
            aria-valuetext={`${p.y.toFixed(2)} times speed, ${Math.round(p.x * 100)}% through the clip`}
            onKeyDown={(e) => nudge(i, e)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              removePoint(i)
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              const state = useEditor.getState()
              state.checkpoint()
              drag.current = { draft: state.draft, points, index: i }
            }}
            onPointerMove={(e) => {
              const from = drag.current
              if (!from) return
              const { x, y } = locate(e)
              const state = useEditor.getState()
              // The clip must still be there: an undo mid-drag could remove it.
              if (!findSegment(from.draft, segment.id)) return
              state.preview(apply(from.draft, moved(from.points, from.index, x, y)))
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          />
        ))}
      </svg>
      <p className="hint">
        Left to right is the clip's footage, height is how fast it plays there. Drag a point;
        double-click the graph to add one, or a point to remove it.
      </p>
    </div>
  )
}
