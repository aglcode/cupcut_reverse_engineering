import { useRef, useState } from 'react'
import { assetKey, filesUsed, missingMedia } from '../engine/media'
import { US_PER_SEC } from '../model/time'
import { useEditor } from '../state/store'

const formatBytes = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`

const formatDuration = (us: number): string => {
  const seconds = us / US_PER_SEC
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function MediaBin() {
  const assets = useEditor((s) => s.assets)
  const draft = useEditor((s) => s.draft)
  const importFiles = useEditor((s) => s.importFiles)
  const addAssetToTimeline = useEditor((s) => s.addAssetToTimeline)
  const removeAsset = useEditor((s) => s.removeAsset)
  const restoring = useEditor((s) => s.restoring)
  const unsaved = useEditor((s) => s.unsaved)
  const projectSaved = useEditor((s) => s.projectSaved)
  const storage = useEditor((s) => s.storage)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string[]>([])

  const projectMedia = useEditor((s) => s.projectMedia)
  // This project's files: the ones imported into it and the ones its clips use.
  const shown = new Set([...projectMedia, ...filesUsed(draft)])
  const list = Object.values(assets).filter((a) => shown.has(assetKey(a.name)))
  const missing = missingMedia(draft, assets)

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setFailed(await importFiles([...files]))
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <aside className="media-bin" aria-label="Media">
      <h2>Media</h2>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*,image/*,.ttf,.otf,.woff,.woff2"
        multiple
        hidden
        onChange={(e) => void onFiles(e.target.files)}
      />
      <button
        type="button"
        className="primary"
        disabled={busy || restoring}
        onClick={() => inputRef.current?.click()}
      >
        {restoring ? 'Restoring…' : busy ? 'Importing…' : 'Import media'}
      </button>

      {unsaved.length > 0 && (
        <p className="notice error" role="alert">
          Not kept for next time (browser storage is full or unavailable): {unsaved.join(', ')}
        </p>
      )}
      {!projectSaved && (
        <p className="notice error" role="alert">
          The project could not be saved in this browser. Use Save to keep a copy.
        </p>
      )}

      {failed.length > 0 && (
        <p className="notice error" role="alert">
          Could not read: {failed.join(', ')}
        </p>
      )}

      {missing.length > 0 && (
        <div className="notice">
          <p>Import these files to relink the project's media:</p>
          <ul>
            {missing.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {list.length === 0 ? (
        <p className="hint">
          Import video, audio or images, then add them to the timeline. Font files (.ttf, .otf,
          .woff) can be imported too.
        </p>
      ) : (
        <ul className="asset-list">
          {list.map((asset) => (
            <li key={asset.name}>
              <span className="asset-name" title={asset.name}>
                {asset.name}
              </span>
              <span className="asset-meta">
                {asset.kind === 'image' ? 'image' : asset.kind === 'font' ? 'font' : formatDuration(asset.duration)}
              </span>
              {asset.kind === 'font' ? (
                <span className="asset-font" style={{ fontFamily: `"${asset.family}"` }} title="Pick it under Font for a text clip">
                  Aa
                </span>
              ) : (
                <button type="button" onClick={() => addAssetToTimeline(asset)}>
                  Add
                </button>
              )}
              <button
                type="button"
                className="icon"
                aria-label={`Remove ${asset.name}`}
                title="Remove from this project's media (and from browser storage, unless another project has it)"
                onClick={() => void removeAsset(asset.name)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        The project and its media are kept in this browser for next time
        {storage ? `: ${formatBytes(storage.used)} of ${formatBytes(storage.quota)} used.` : '.'}
      </p>
    </aside>
  )
}
