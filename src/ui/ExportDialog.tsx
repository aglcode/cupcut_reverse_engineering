import { useEffect, useRef, useState } from 'react'
import {
  availableCodecs,
  CODECS,
  exportDraft,
  recommendedBitrate,
  type ExportCodec,
  type ExportResult,
} from '../engine/exporter'
import { missingMedia } from '../engine/media'
import { effectiveRange, hasExportRange } from '../model/exportRange'
import { formatTimecode } from '../model/time'
import { useEditor } from '../state/store'

const HEIGHTS = [2160, 1440, 1080, 720, 480]
const FPS_OPTIONS = [24, 25, 30, 50, 60]

// Encoders need even dimensions.
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

type Status =
  | { step: 'idle' }
  | { step: 'running'; progress: number }
  | { step: 'done'; url: string; result: ExportResult }
  | { step: 'error'; message: string }

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const draft = useEditor((s) => s.draft)
  const assets = useEditor((s) => s.assets)
  const canvas = draft.canvas_config
  const [height, setHeight] = useState(canvas.height)
  const [fps, setFps] = useState(draft.fps)
  const [mbps, setMbps] = useState<number | null>(null)
  const [codec, setCodec] = useState<ExportCodec>('avc')
  // What this machine can encode at the chosen size; H.264 until that is known.
  const [codecs, setCodecs] = useState<ExportCodec[]>(['avc'])
  const marked = hasExportRange(draft)
  const [rangeOnly, setRangeOnly] = useState(marked)
  const range = rangeOnly && marked ? effectiveRange(draft) : { start: 0, duration: draft.duration }
  const [status, setStatus] = useState<Status>({ step: 'idle' })
  const abort = useRef<AbortController | null>(null)

  const width = even((canvas.width * height) / canvas.height)
  const outHeight = even(height)
  const suggested = recommendedBitrate(width, outHeight, fps, codec) / 1_000_000
  const bitrate = mbps ?? suggested
  const missing = missingMedia(draft, assets)
  const heights = [...new Set([canvas.height, ...HEIGHTS])].sort((a, b) => b - a)

  const url = status.step === 'done' ? status.url : null
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    let current = true
    void availableCodecs(width, outHeight).then((found) => {
      if (!current) return
      setCodecs(found)
      // Fall back if the chosen one is not possible at this size.
      setCodec((chosen) => (found.includes(chosen) ? chosen : (found[0] ?? 'avc')))
    })
    return () => {
      current = false
    }
  }, [width, outHeight])

  const start = async () => {
    useEditor.getState().setPlaying(false)
    const controller = new AbortController()
    abort.current = controller
    setStatus({ step: 'running', progress: 0 })
    try {
      const result = await exportDraft(
        draft,
        assets,
        {
          width,
          height: outHeight,
          fps,
          videoBitrate: bitrate * 1_000_000,
          audioBitrate: 192_000,
          codec,
          range,
        },
        (progress) => setStatus({ step: 'running', progress }),
        controller.signal,
      )
      setStatus({ step: 'done', url: URL.createObjectURL(result.blob), result })
    } catch (error) {
      if (controller.signal.aborted) setStatus({ step: 'idle' })
      else setStatus({ step: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const running = status.step === 'running'

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <h2 id="export-title">Export video</h2>

        <label className="field">
          <span>Resolution</span>
          <select value={height} disabled={running} onChange={(e) => setHeight(Number(e.target.value))}>
            {heights.map((h) => (
              <option key={h} value={h}>
                {even((canvas.width * h) / canvas.height)}×{even(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Frame rate</span>
          <select value={fps} disabled={running} onChange={(e) => setFps(Number(e.target.value))}>
            {[...new Set([draft.fps, ...FPS_OPTIONS])]
              .sort((a, b) => a - b)
              .map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Format</span>
          <select
            value={codec}
            disabled={running}
            onChange={(e) => {
              setCodec(e.target.value as ExportCodec)
              setMbps(null)
            }}
          >
            {CODECS.filter((c) => codecs.includes(c.codec)).map((c) => (
              <option key={c.codec} value={c.codec}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Bitrate</span>
          <span className="field-input">
            <input
              type="number"
              min={0.5}
              max={100}
              step={0.5}
              value={bitrate}
              disabled={running}
              onChange={(e) => setMbps(e.target.value === '' ? null : Number(e.target.value))}
            />
            <span className="suffix">Mbps</span>
          </span>
        </label>
        <p className="hint">
          MP4 with stereo audio at 192 kbps. Suggested bitrate: {suggested} Mbps. Formats this
          computer cannot encode are not listed.
        </p>
        <label className="range-choice">
          <input
            type="checkbox"
            checked={rangeOnly && marked}
            disabled={running || !marked}
            onChange={(e) => setRangeOnly(e.target.checked)}
          />
          {marked
            ? `Only the marked range, ${formatTimecode(effectiveRange(draft).start, draft.fps)} to ${formatTimecode(
                effectiveRange(draft).start + effectiveRange(draft).duration,
                draft.fps,
              )}`
            : 'Only the marked range (mark one with I and O on the timeline)'}
        </label>

        {missing.length > 0 && (
          <p className="notice error" role="alert">
            Import the missing media before exporting: {missing.join(', ')}
          </p>
        )}
        {status.step === 'running' && (
          <div className="progress">
            <progress value={status.progress} max={1} />
            <span>{Math.round(status.progress * 100)}%</span>
          </div>
        )}
        {status.step === 'error' && (
          <p className="notice error" role="alert">
            Export failed: {status.message}
          </p>
        )}
        {status.step === 'done' && (
          <p className="notice">
            Done: {(status.result.blob.size / 1_000_000).toFixed(1)} MB, {status.result.videoCodec}
            {status.result.audioCodec ? ` + ${status.result.audioCodec}` : ', no audio'}.{' '}
            <a href={status.url} download={`${draft.name || 'export'}.mp4`}>
              Download
            </a>
          </p>
        )}

        <div className="modal-actions">
          {running ? (
            <button type="button" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="primary"
                disabled={range.duration === 0 || missing.length > 0 || !(bitrate > 0)}
                onClick={() => void start()}
              >
                Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
