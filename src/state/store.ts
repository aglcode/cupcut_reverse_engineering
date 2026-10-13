import { create } from 'zustand'
import { dropVisuals } from '../engine/clipVisuals'
import { assetKey, materialFor, probeFile, type Asset, type Assets } from '../engine/media'
import {
  deleteMedia,
  keepStorage,
  loadMedia,
  loadProject as loadSavedProject,
  saveMedia,
  saveProject,
  stashProject,
  storageUse,
  takeStashedProject,
  type StorageUse,
} from '../engine/persistence'
import { isActive } from '../engine/resolve'
import { openProject } from '../model/capcutImport'
import {
  addMedia,
  addText,
  removeSegments,
  rippleDelete,
  setMagnet,
  splitSegment,
} from '../model/ops'
import { snapToFrame } from '../model/time'
import { emptyDraft, type Draft } from '../model/types'

const HISTORY_LIMIT = 100
export const MIN_ZOOM = 10
export const MAX_ZOOM = 600

type State = {
  draft: Draft
  past: Draft[]
  future: Draft[]
  assets: Assets
  playhead: number
  playing: boolean
  // Every selected clip. selectedId is the one most recently picked, which is
  // the clip the inspector shows when it is the only one.
  selectedIds: string[]
  selectedId: string | null
  pxPerSec: number
  warnings: string[]
  // True until the last session's project and media have been put back.
  restoring: boolean
  // Files that could not be kept for next time, usually for lack of space.
  unsaved: string[]
  // False if the project itself could not be saved.
  projectSaved: boolean
  storage: StorageUse | null

  // Applies an edit as one undo step.
  commit: (next: Draft) => void
  // During a drag: call checkpoint once, then preview for each pointer move.
  checkpoint: () => void
  preview: (next: Draft) => void
  undo: () => void
  redo: () => void

  setPlayhead: (us: number) => void
  setPlaying: (playing: boolean) => void
  // 'toggle' adds the clip to the selection, or takes it out if it is in.
  select: (segmentId: string | null, mode?: 'replace' | 'toggle') => void
  selectMany: (segmentIds: string[]) => void
  selectAll: () => void
  setZoom: (pxPerSec: number) => void
  dismissWarnings: () => void

  // Returns the names of files that could not be read. Files are also copied
  // into browser storage for next time unless `keep` is false.
  importFiles: (files: File[], keep?: boolean) => Promise<string[]>
  // Takes a file out of the media list and out of storage. Clips that use it
  // stay on the timeline, marked as missing media.
  removeAsset: (name: string) => Promise<void>
  // Puts back the project and media saved by the last session. Runs once.
  restoreSession: () => Promise<void>
  addAssetToTimeline: (asset: Asset) => void
  addTextAtPlayhead: () => void
  splitAtPlayhead: () => void
  deleteSelected: () => void
  // Deletes the selection and closes the gaps it leaves on each track.
  rippleDeleteSelected: () => void
  loadProject: (text: string) => void
  newProject: () => void
}

let restored: Promise<void> | null = null

// Saves the project a moment after it last changed, so a drag that updates it
// sixty times a second is written once. Started only after the saved project
// has been restored, so the empty starting project never overwrites it.
function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    timer = undefined
    saveProject(JSON.stringify(useEditor.getState().draft)).then(
      () => useEditor.setState({ projectSaved: true }),
      () => useEditor.setState({ projectSaved: false }),
    )
  }
  useEditor.subscribe((state, previous) => {
    if (state.draft === previous.draft) return
    clearTimeout(timer)
    timer = setTimeout(save, 400)
  })
  // Leaving the page should not lose the last change. The normal save would
  // not finish in time, so the project is stashed where a write is immediate.
  window.addEventListener('pagehide', () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    stashProject(JSON.stringify(useEditor.getState().draft))
  })
}

// New projects start with the main-track magnet on, as CapCut projects do.
const newDraft = (): Draft => setMagnet(emptyDraft(), true)

const selection = (ids: string[]) => ({
  selectedIds: ids,
  selectedId: ids.length > 0 ? ids[ids.length - 1] : null,
})

export const useEditor = create<State>((set, get) => ({
  draft: newDraft(),
  past: [],
  future: [],
  assets: {},
  playhead: 0,
  playing: false,
  selectedIds: [],
  selectedId: null,
  pxPerSec: 80,
  warnings: [],
  restoring: true,
  unsaved: [],
  projectSaved: true,
  storage: null,

  commit: (next) => {
    const { draft, past } = get()
    if (next === draft) return
    set({ draft: next, past: [...past, draft].slice(-HISTORY_LIMIT), future: [] })
  },
  checkpoint: () => {
    const { draft, past } = get()
    set({ past: [...past, draft].slice(-HISTORY_LIMIT), future: [] })
  },
  preview: (next) => set({ draft: next }),
  undo: () => {
    const { draft, past, future } = get()
    if (past.length === 0) return
    set({ draft: past[past.length - 1], past: past.slice(0, -1), future: [draft, ...future] })
  },
  redo: () => {
    const { draft, past, future } = get()
    if (future.length === 0) return
    set({ draft: future[0], past: [...past, draft], future: future.slice(1) })
  },

  setPlayhead: (us) => set({ playhead: Math.max(0, us) }),
  setPlaying: (playing) => {
    const { draft, playhead } = get()
    // Pressing play at the end starts over.
    if (playing && playhead >= draft.duration) set({ playhead: 0 })
    set({ playing: playing && draft.duration > 0 })
  },
  select: (segmentId, mode = 'replace') => {
    if (segmentId === null) return set(selection([]))
    if (mode === 'replace') return set(selection([segmentId]))
    const current = get().selectedIds
    set(
      selection(
        current.includes(segmentId)
          ? current.filter((id) => id !== segmentId)
          : [...current, segmentId],
      ),
    )
  },
  selectMany: (segmentIds) => set(selection(segmentIds)),
  selectAll: () =>
    set(selection(get().draft.tracks.flatMap((t) => t.segments.map((s) => s.id)))),
  setZoom: (pxPerSec) => set({ pxPerSec: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pxPerSec)) }),
  dismissWarnings: () => set({ warnings: [] }),

  importFiles: async (files, keep = true) => {
    const errors: string[] = []
    for (const file of files) {
      let asset: Asset
      try {
        asset = await probeFile(file)
      } catch {
        errors.push(file.name)
        continue
      }
      const key = assetKey(asset.name)
      const previous = get().assets[key]
      if (previous) {
        URL.revokeObjectURL(previous.url)
        dropVisuals(previous.url)
      }
      set({ assets: { ...get().assets, [key]: asset } })
      if (!keep) continue
      // The file is usable now either way; this is only about next time.
      const kept = await saveMedia(key, file).then(
        () => true,
        () => false,
      )
      const others = get().unsaved.filter((name) => name !== asset.name)
      set({ unsaved: kept ? others : [...others, asset.name] })
    }
    if (keep) set({ storage: await storageUse() })
    return errors
  },

  removeAsset: async (name) => {
    const key = assetKey(name)
    const { assets, unsaved } = get()
    const asset = assets[key]
    if (!asset) return
    URL.revokeObjectURL(asset.url)
    dropVisuals(asset.url)
    const rest = { ...assets }
    delete rest[key]
    set({ assets: rest, unsaved: unsaved.filter((n) => n !== asset.name) })
    await deleteMedia(key).catch(() => {})
    set({ storage: await storageUse() })
  },

  restoreSession: () => {
    restored ??= (async () => {
      try {
        const [saved, files] = await Promise.all([loadSavedProject(), loadMedia()])
        // A change made just as the last session closed is newer than the
        // autosave; it now gets saved properly.
        const stashed = takeStashedProject()
        if (stashed) void saveProject(stashed).catch(() => {})
        const json = stashed ?? saved
        if (json) {
          const { draft } = openProject(json)
          set({ draft, past: [], future: [], playhead: 0, ...selection([]) })
        }
        await get().importFiles(files, false)
      } catch {
        // Storage unavailable or its contents unreadable: start fresh.
      }
      set({ restoring: false, storage: await storageUse() })
      void keepStorage()
      startAutosave()
    })()
    return restored
  },

  addAssetToTimeline: (asset) => {
    const { draft, playhead, commit } = get()
    const added = addMedia(draft, materialFor(asset), playhead)
    commit(added.draft)
    set(selection([added.segmentId]))
  },

  addTextAtPlayhead: () => {
    const { draft, playhead, commit } = get()
    const added = addText(draft, 'Text', playhead)
    commit(added.draft)
    set(selection([added.segmentId]))
  },

  // Splits the selected segments under the playhead, or everything under it
  // if none of those is selected.
  splitAtPlayhead: () => {
    const { draft, playhead, selectedIds, commit } = get()
    const t = snapToFrame(playhead, draft.fps)
    const under = draft.tracks.flatMap((track) => track.segments.filter((s) => isActive(s, t)))
    const selected = under.filter((s) => selectedIds.includes(s.id))
    const targets = selected.length > 0 ? selected : under
    commit(targets.reduce((d, s) => splitSegment(d, s.id, t), draft))
  },

  deleteSelected: () => {
    const { draft, selectedIds, commit } = get()
    if (selectedIds.length === 0) return
    commit(removeSegments(draft, selectedIds))
    set(selection([]))
  },

  rippleDeleteSelected: () => {
    const { draft, selectedIds, commit } = get()
    if (selectedIds.length === 0) return
    commit(rippleDelete(draft, selectedIds))
    set(selection([]))
  },

  loadProject: (text) => {
    const { draft, warnings } = openProject(text)
    set({
      draft,
      warnings,
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      ...selection([]),
    })
  },

  newProject: () =>
    set({
      draft: newDraft(),
      warnings: [],
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      ...selection([]),
    }),
}))
