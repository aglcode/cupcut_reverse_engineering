import { useEffect, useState } from 'react'
import { formatTimecode } from '../model/time'
import { useEditor } from '../state/store'

// The projects kept in this browser, like CapCut's home screen of drafts.
export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const projects = useEditor((s) => s.projects)
  const currentId = useEditor((s) => s.draft.id)
  const fps = useEditor((s) => s.draft.fps)
  // The project whose Delete was pressed once and now asks to be confirmed.
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    void useEditor.getState().refreshProjects()
  }, [])

  return (
    <div className="modal-backdrop">
      <div className="modal projects" role="dialog" aria-modal="true" aria-labelledby="projects-title">
        <h2 id="projects-title">Projects</h2>
        {projects.length === 0 ? (
          <p className="hint">No projects are kept in this browser yet.</p>
        ) : (
          <ul className="project-list">
            {projects.map((p) => {
              const open = p.draft_id === currentId
              return (
                <li key={p.draft_id} className={open ? 'open' : undefined} data-project-id={p.draft_id}>
                  <span className="project-title">{p.draft_name || 'Untitled'}</span>
                  <span className="project-meta">
                    {formatTimecode(p.tm_duration, fps)} · changed{' '}
                    {new Date(p.tm_draft_modified / 1000).toLocaleString()}
                  </span>
                  <span className="project-actions">
                    {open ? (
                      <span className="project-open-tag">Open now</span>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          await useEditor.getState().openSavedProject(p.draft_id)
                          onClose()
                        }}
                      >
                        Open
                      </button>
                    )}
                    {confirming === p.draft_id ? (
                      <button
                        type="button"
                        className="danger"
                        onClick={async () => {
                          setConfirming(null)
                          await useEditor.getState().deleteSavedProject(p.draft_id)
                        }}
                      >
                        Delete for good
                      </button>
                    ) : (
                      <button type="button" onClick={() => setConfirming(p.draft_id)}>
                        Delete
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <p className="hint">
          Projects share one store of imported media. Use Save to keep a project as a file as well.
        </p>
        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              useEditor.getState().newProject()
              onClose()
            }}
          >
            New project
          </button>
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
