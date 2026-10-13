import { useEffect, useRef, useState } from 'react'
import { markIn, markOut } from './model/exportRange'
import { frameDuration } from './model/time'
import { useEditor } from './state/store'
import { ExportDialog } from './ui/ExportDialog'
import { Inspector } from './ui/Inspector'
import { MediaBin } from './ui/MediaBin'
import { Preview } from './ui/Preview'
import { Timeline } from './ui/Timeline'

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('input, textarea, select') !== null

function onKeyDown(e: KeyboardEvent) {
  if (isTyping(e.target) || document.querySelector('.modal')) return
  const state = useEditor.getState()
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  const frame = frameDuration(state.draft.fps)

  // Space on a focused button should press that button, not toggle playback.
  if (key === ' ' && e.target instanceof HTMLElement && e.target.closest('button, a')) return

  if (key === ' ') state.setPlaying(!state.playing)
  else if ((key === 'delete' || key === 'backspace') && e.shiftKey) state.rippleDeleteSelected()
  else if (key === 'delete' || key === 'backspace') state.deleteSelected()
  else if (mod && key === 'z' && e.shiftKey) state.redo()
  else if (mod && key === 'z') state.undo()
  else if (mod && key === 'y') state.redo()
  else if (mod && key === 'b') state.splitAtPlayhead()
  else if (mod && key === 'a') state.selectAll()
  else if (mod && key === 'c') state.copySelected()
  else if (mod && key === 'x') state.cutSelected()
  else if (mod && key === 'v') state.paste()
  else if (mod && key === 'd') state.duplicateSelected()
  else if (key === 'escape') state.select(null)
  else if (!mod && key === 'm') state.toggleMarkerAtPlayhead()
  else if (!mod && key === 'n') state.toggleSnapping()
  else if (e.shiftKey && key === 'arrowleft') state.jumpToMarker(-1)
  else if (e.shiftKey && key === 'arrowright') state.jumpToMarker(1)
  else if (!mod && key === 'i') state.commit(markIn(state.draft, state.playhead))
  else if (!mod && key === 'o') state.commit(markOut(state.draft, state.playhead))
  else if (key === 'arrowleft') state.setPlayhead(state.playhead - frame)
  else if (key === 'arrowright') state.setPlayhead(Math.min(state.draft.duration, state.playhead + frame))
  else return
  e.preventDefault()
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const warnings = useEditor((s) => s.warnings)
  const name = useEditor((s) => s.draft.name)
  const [exporting, setExporting] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const openRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void useEditor.getState().restoreSession()
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const openFile = async (file: File | undefined) => {
    if (!file) return
    try {
      useEditor.getState().loadProject(await file.text())
      setOpenError(null)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error))
    }
    if (openRef.current) openRef.current.value = ''
  }

  const save = () => {
    const { draft } = useEditor.getState()
    const json = JSON.stringify(draft, null, 2)
    download(`${draft.name || 'project'}.cupcut.json`, new Blob([json], { type: 'application/json' }))
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>CupCut</h1>
        <span className="project-name">{name}</span>
        <div className="header-actions">
          <input
            ref={openRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => void openFile(e.target.files?.[0])}
          />
          <button type="button" onClick={() => useEditor.getState().newProject()}>
            New
          </button>
          <button
            type="button"
            title="Open a saved project or a CapCut draft_content.json"
            onClick={() => openRef.current?.click()}
          >
            Open
          </button>
          <button type="button" onClick={save}>
            Save
          </button>
          <button type="button" className="primary" onClick={() => setExporting(true)}>
            Export
          </button>
        </div>
      </header>

      {openError && (
        <div className="banner error" role="alert">
          <span>Could not open file: {openError}</span>
          <button type="button" onClick={() => setOpenError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="banner" role="status">
          <div>
            <strong>Imported from CapCut with some things left out:</strong>
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={() => useEditor.getState().dismissWarnings()}>
            Dismiss
          </button>
        </div>
      )}

      <main className="workspace">
        <MediaBin />
        <Preview />
        <Inspector />
      </main>
      <Timeline />

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  )
}
