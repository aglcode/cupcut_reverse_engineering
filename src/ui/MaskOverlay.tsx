import type { PointerEvent as ReactPointerEvent } from 'react'
import { animateClip } from '../model/animations'
import { evalClip, setValues } from '../model/keyframes'
import { dragMask, evalMask, maskHandleKinds, maskHandles, maskKind, maskShape, outline as shapeOutline, type MaskHandle } from '../model/mask'
import { findSegment } from '../model/ops'
import { placement } from '../model/placement'
import { segmentEnd } from '../model/types'
import { useEditor } from '../state/store'

// A long length, for drawing the lines of shapes that have no end.
const FAR = 100_000

// Handles over the preview for the selected clip's mask: drag the middle to
// move it, the side and top dots to size it, and the dot above to turn it.
// Values land at the playhead, as the inspector's do: a keyframed setting
// gets a keyframe there. `size` is the canvas in the draft's own pixels.
export function MaskOverlay({ size }: { size: { width: number; height: number } }) {
  const draft = useEditor((s) => s.draft)
  const selectedId = useEditor((s) => s.selectedId)
  const selectedCount = useEditor((s) => s.selectedIds.length)
  const playhead = useEditor((s) => s.playhead)
  const playing = useEditor((s) => s.playing)

  const loc = selectedId && selectedCount === 1 ? findSegment(draft, selectedId) : null
  const segment = loc?.segment
  if (!segment || !segment.mask || playing) return null
  if (playhead < segment.target_timerange.start || playhead >= segmentEnd(segment)) return null
  const material = draft.materials.videos.find((m) => m.id === segment.material_id)
  if (!material) return null

  const { width: W, height: H } = draft.canvas_config
  const clip = animateClip(segment, evalClip(segment, playhead), playhead)
  const place = placement(clip, material, W, H)
  const mask = evalMask(segment, playhead)!
  const shape = maskShape(mask, place.width, place.height)
  const handles = maskHandles(mask, place.width, place.height)
  const kinds = maskHandleKinds(maskKind(mask))
  // Handles stay the same size on screen whatever the canvas size.
  const pixel = size.width > 0 ? W / size.width : 1
  const id = segment.id

  const startDrag = (e: ReactPointerEvent<SVGElement>, handle: MaskHandle) => {
    e.preventDefault()
    e.stopPropagation()
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const base = useEditor.getState().draft
    const at = playhead
    const toCanvas = (ev: PointerEvent | ReactPointerEvent): [number, number] => {
      const box = svg.getBoundingClientRect()
      return [((ev.clientX - box.left) / box.width) * W, ((ev.clientY - box.top) / box.height) * H]
    }
    // Where on the handle it was grabbed, so a move does not jump.
    const [gx, gy] = place.toPicture(...toCanvas(e))
    const grab = handle === 'move' ? [gx - handles.move[0], gy - handles.move[1]] : [0, 0]
    let checkpointed = false
    const move = (ev: PointerEvent) => {
      const [px, py] = place.toPicture(...toCanvas(ev))
      const patch = dragMask(mask, handle, px - grab[0], py - grab[1], place.width, place.height)
      if (!checkpointed) {
        useEditor.getState().checkpoint()
        checkpointed = true
      }
      useEditor.getState().preview(setValues(base, id, patch, at))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const deg = (shape.rotation * 180) / Math.PI
  const outline =
    shape.type === 'line' ? (
      <line x1={-FAR} x2={FAR} y1={0} y2={0} />
    ) : shape.type === 'mirror' ? (
      <>
        <line x1={-FAR} x2={FAR} y1={-shape.height / 2} y2={-shape.height / 2} />
        <line x1={-FAR} x2={FAR} y1={shape.height / 2} y2={shape.height / 2} />
      </>
    ) : shape.type === 'circle' ? (
      <ellipse rx={shape.width / 2} ry={shape.height / 2} />
    ) : shape.type === 'heart' || shape.type === 'star' ? (
      <polygon points={shapeOutline(shape.type, shape.width, shape.height).map((p) => p.join(',')).join(' ')} />
    ) : (
      <rect
        x={-shape.width / 2}
        y={-shape.height / 2}
        width={shape.width}
        height={shape.height}
        rx={shape.radius}
      />
    )

  const dot = (handle: MaskHandle) => {
    const [x, y] = place.toFrame(...handles[handle])
    return (
      <circle
        key={handle}
        className={`mask-handle mask-handle-${handle}`}
        data-handle={handle}
        cx={x}
        cy={y}
        r={(handle === 'move' ? 7 : 6) * pixel}
        strokeWidth={2 * pixel}
        onPointerDown={(e) => startDrag(e, handle)}
      />
    )
  }
  const [rx, ry] = place.toFrame(...handles.rotate)
  const [mx, my] = place.toFrame(...(mask.resource_type === 'line' ? handles.move : handles.height))

  return (
    <svg className="mask-overlay" viewBox={`0 0 ${W} ${H}`} aria-label="Mask handles" role="group">
      <g transform={`matrix(${place.matrix.join(' ')})`}>
        <g
          className="mask-outline"
          transform={`translate(${shape.cx} ${shape.cy}) rotate(${deg})`}
        >
          {outline}
        </g>
      </g>
      <line className="mask-stem" x1={mx} y1={my} x2={rx} y2={ry} strokeWidth={1.5 * pixel} />
      {kinds.map(dot)}
    </svg>
  )
}
