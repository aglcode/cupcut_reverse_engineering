import { useEffect, useMemo, useRef, useState } from 'react'
import {
  availableCodecs,
  CODECS,
  exportDraft,
  recommendedBitrate,
  type ExportCodec,
  type ExportResult,
} from '../engine/exporter'
import { canPickExportFile, openExportFile, pickExportFile } from '../engine/exportFile'
import { missingMedia } from '../engine/media'
import { effectiveRange, hasExportRange } from '../model/exportRange'
import { formatTimecode } from '../model/time'
import { rootDraft, useEditor } from '../state/store'

const HEIGHTS = [2160, 1440, 1080, 720, 480]
const FPS_OPTIONS = [24, 25, 30, 50, 60]

// Encoders need even dimensions.
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

type Status =
  | { step: 'idle' }
  | { step: 'running'; progress: number }
  | {
      step: 'done'
      url: string
      result: ExportResult
      bytes: number
      // Name of the file the user picked, when the export went straight to it.
      savedAs: string | null
    }
  | { step: 'error'; message: string }

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const current = useEditor((s) => s.draft)
  const stack = useEditor((s) => s.compoundStack)
  // Inside a compound clip, the export is still of the whole project.
  const draft = useMemo(() => rootDraft({ draft: current, compoundStack: stack }), [current, stack])
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

  // `pick` asks where to save and writes straight there; otherwise the export
  // goes to the browser's own store and is offered as a download.
  const start = async (pick: boolean) => {
    // The save dialog has to be the first thing the click leads to.
    let file = null
    if (pick) {
      try {
        file = await pickExportFile(draft.name)
      } catch (error) {
        setStatus({ step: 'error', message: error instanceof Error ? error.message : String(error) })
        return
      }
      // Backed out of the dialog.
      if (!file) return
    }
    useEditor.getState().setPlaying(false)
    const controller = new AbortController()
    abort.current = controller
    setStatus({ step: 'running', progress: 0 })
    // Written to disk as it is encoded where the browser allows, so a long
    // export does not have to fit in memory.
    file ??= await openExportFile(draft.name)
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
          writable: file?.writable,
        },
        (progress) => setStatus({ step: 'running', progress }),
        controller.signal,
      )
      const finished = file ? await file.finish() : result.blob
      if (!finished) throw new Error('The encoder produced no output')
      setStatus({
        step: 'done',
        url: URL.createObjectURL(finished),
        result,
        bytes: finished.size,
        savedAs: file?.picked ? file.name : null,
      })
    } catch (error) {
      await file?.discard()
      if (controller.signal.aborted) setStatus({ step: 'idle' })
      else setStatus({ step: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const running = status.step === 'running'
  const canExport = range.duration > 0 && missing.length === 0 && bitrate > 0

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
            {status.savedAs ? `Saved to ${status.savedAs}` : 'Done'}:{' '}
            {(status.bytes / 1_000_000).toFixed(1)} MB, {status.result.videoCodec}
            {status.result.audioCodec ? ` + ${status.result.audioCodec}` : ', no audio'}.
            {!status.savedAs && (
              <>
                {' '}
                <a href={status.url} download={`${draft.name || 'export'}.mp4`}>
                  Download
                </a>
              </>
            )}
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
              {canPickExportFile() && (
                <button
                  type="button"
                  disabled={!canExport}
                  title="Choose where to save, and write the video straight there"
                  onClick={() => void start(true)}
                >
                  Export to file…
                </button>
              )}
              <button
                type="button"
                className="primary"
                disabled={!canExport}
                onClick={() => void start(false)}
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
