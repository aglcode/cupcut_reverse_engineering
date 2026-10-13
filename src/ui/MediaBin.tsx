import { useRef, useState } from 'react'
import { missingMedia } from '../engine/media'
import { US_PER_SEC } from '../model/time'
import { useEditor } from '../state/store'

const formatDuration = (us: number): string => {
  const seconds = us / US_PER_SEC
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function MediaBin() {
  const assets = useEditor((s) => s.assets)
  const draft = useEditor((s) => s.draft)
  const importFiles = useEditor((s) => s.importFiles)
  const addAssetToTimeline = useEditor((s) => s.addAssetToTimeline)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string[]>([])

  const list = Object.values(assets)
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
        accept="video/*,audio/*,image/*"
        multiple
        hidden
        onChange={(e) => void onFiles(e.target.files)}
      />
      <button type="button" className="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Importing…' : 'Import media'}
      </button>

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
        <p className="hint">Import video, audio or images, then add them to the timeline.</p>
      ) : (
        <ul className="asset-list">
          {list.map((asset) => (
            <li key={asset.name}>
              <span className="asset-name" title={asset.name}>
                {asset.name}
              </span>
              <span className="asset-meta">
                {asset.kind === 'image' ? 'image' : formatDuration(asset.duration)}
              </span>
              <button type="button" onClick={() => addAssetToTimeline(asset)}>
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
