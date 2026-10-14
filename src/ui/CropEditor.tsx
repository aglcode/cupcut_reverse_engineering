import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { assetKey } from '../engine/media'
import {
  CROP_RATIOS,
  cropRatioOf,
  cropRect,
  dragCrop,
  ratioValue,
  setCrop,
  setCropRatio,
  setCropRect,
  type CropHandle,
  type CropRatio,
} from '../model/crop'
import { findSegment } from '../model/ops'
import { sourceTimeAt } from '../model/timing'
import { useEditor } from '../state/store'

const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

// The crop box: the clip's whole picture, uncropped, with the part that is
// kept outlined. Drag inside the box to move it, or its edges and corners to
// size it. Each drag is one undo step.
export function CropEditor({ segmentId }: { segmentId: string }) {
  const draft = useEditor((s) => s.draft)
  const assets = useEditor((s) => s.assets)
  const playhead = useEditor((s) => s.playhead)
  const close = () => useEditor.getState().setCropEditing(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const pictureRef = useRef<HTMLCanvasElement>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })

  const loc = findSegment(draft, segmentId)
  const material = loc ? draft.materials.videos.find((m) => m.id === loc.segment.material_id) : undefined
  const asset = material ? assets[assetKey(material.path)] : undefined
  const sourceUs = loc && material ? sourceTimeAt(loc.segment, Math.max(playhead, loc.segment.target_timerange.start)) : 0

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const watch = new ResizeObserver(() => setStage({ width: el.clientWidth, height: el.clientHeight }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  // The picture under the box: the photo, or the video frame at the playhead.
  useEffect(() => {
    const canvas = pictureRef.current
    if (!canvas || !asset || !material) return
    canvas.width = material.width
    canvas.height = material.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (asset.image) {
      ctx.drawImage(asset.image, 0, 0, canvas.width, canvas.height)
      return
    }
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = asset.url
    const draw = () => ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    video.addEventListener('seeked', draw, { once: true })
    video.addEventListener(
      'loadeddata',
      () => {
        video.currentTime = Math.min(Math.max(0, sourceUs / 1_000_000), Math.max(0, video.duration - 0.001))
      },
      { once: true },
    )
    return () => {
      video.removeAttribute('src')
      video.load()
    }
  }, [asset, material, sourceUs])

  // Leave when the clip goes away or another one is picked.
  const selectedId = useEditor((s) => s.selectedId)
  useEffect(() => {
    if (!loc || !material || selectedId !== segmentId) useEditor.getState().setCropEditing(null)
  }, [loc, material, selectedId, segmentId])

  if (!loc || !material || material.width <= 0 || material.height <= 0) return null

  const aspect = material.width / material.height
  // The picture fitted into the stage, with room around it for the handles.
  const room = { width: Math.max(0, stage.width - 40), height: Math.max(0, stage.height - 40) }
  const scale = Math.min(room.width / material.width, room.height / material.height)
  const frame = { width: material.width * scale, height: material.height * scale }
  const rect = cropRect(material.crop)
  const ratio = cropRatioOf(material)

  const startDrag = (e: ReactPointerEvent, handle: CropHandle) => {
    e.preventDefault()
    e.stopPropagation()
    const state = useEditor.getState()
    const base = state.draft
    const start = rect
    let checkpointed = false
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - e.clientX) / frame.width
      const dy = (ev.clientY - e.clientY) / frame.height
      if (!checkpointed && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 3) return
      if (!checkpointed) {
        useEditor.getState().checkpoint()
        checkpointed = true
      }
      const next = dragCrop(start, handle, dx, dy, ratioValue(ratio), aspect)
      useEditor.getState().preview(setCropRect(base, segmentId, next, ratio))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const commit = useEditor.getState().commit
  const fixed = ratio !== 'free'

  return (
    <div className="crop-editor" role="group" aria-label="Crop box">
      <div className="crop-toolbar">
        <label>
          Ratio{' '}
          <select
            value={ratio}
            onChange={(e) =>
              commit(setCropRatio(useEditor.getState().draft, segmentId, e.target.value as CropRatio))
            }
          >
            {CROP_RATIOS.map((r) => (
              <option key={r} value={r}>
                {r === 'free' ? 'Free' : r}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => commit(setCrop(useEditor.getState().draft, segmentId, null))}>
          Reset
        </button>
        <button type="button" className="primary" onClick={close}>
          Done
        </button>
      </div>
      <div className="crop-stage" ref={stageRef}>
        <div className="crop-frame" style={{ width: frame.width, height: frame.height }}>
          <canvas ref={pictureRef} className="crop-picture" />
          <div
            className="crop-box"
            data-testid="crop-box"
            style={{
              left: rect.x * frame.width,
              top: rect.y * frame.height,
              width: rect.width * frame.width,
              height: rect.height * frame.height,
            }}
            onPointerDown={(e) => startDrag(e, 'move')}
          >
            {HANDLES.filter((h) => !fixed || h.length === 2).map((h) => (
              <span
                key={h}
                className={`crop-handle crop-handle-${h}`}
                data-handle={h}
                onPointerDown={(e) => startDrag(e, h)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
