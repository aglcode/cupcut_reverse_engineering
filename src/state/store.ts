import { create } from 'zustand'
import { dropVisuals } from '../engine/clipVisuals'
import { assetKey, filesUsed, materialFor, probeFile, type Asset, type Assets } from '../engine/media'
import {
  deleteMedia,
  deleteProject,
  keepStorage,
  listProjects,
  loadMedia,
  loadProjectEntry,
  storedMediaKeys,
  saveMedia,
  saveProject,
  setCurrentProject,
  stashProject,
  storageUse,
  takeStashedProject,
  type ProjectSummary,
  type StorageUse,
} from '../engine/persistence'
import { isActive } from '../engine/resolve'
import { openProject } from '../model/capcutImport'
import { copySegments, duplicateSegments, type Clipboard } from '../model/clipboard'
import { breakApart, makeCompound, updateCompound } from '../model/compound'
import { isLocked, unlocked } from '../model/tracks'
import { neighbourMarker, toggleMarker } from '../model/markers'
import {
  addAdjustmentLayer,
  addMedia,
  addText,
  pasteSegments,
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

type CompoundLevel = {
  draft: Draft
  past: Draft[]
  future: Draft[]
  segmentId: string
  materialId: string
  name: string
}

// The whole project: the timeline being edited, put back into every compound
// clip it is inside. Saving and exporting always use this.
export function rootDraft(state: { draft: Draft; compoundStack: CompoundLevel[] }): Draft {
  let draft = state.draft
  for (let i = state.compoundStack.length - 1; i >= 0; i--) {
    const level = state.compoundStack[i]
    draft = updateCompound(level.draft, level.materialId, draft)
  }
  return draft
}

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
  // Whether dragged clips snap to the playhead, markers and other clips.
  snapping: boolean
  // The clip whose crop box is open over the preview, if any.
  cropEditing: string | null
  // Every project kept in this browser, most recently changed first.
  projects: ProjectSummary[]
  // The compound clips being edited from the inside, outermost first. While
  // this is not empty, `draft` is the timeline inside the last of them, and
  // each entry holds the timeline around it as it was when it was entered.
  compoundStack: CompoundLevel[]
  // Keys of the files imported into this project. The media list shows these
  // and any file the project's clips use; other projects' files are kept but
  // not shown.
  projectMedia: string[]
  // Font families installed on this computer, once the browser has listed them.
  localFonts: string[]
  warnings: string[]
  // What Copy or Cut last took. It is kept across New and Open, so clips can
  // be carried from one project to another, but not across a page reload.
  clipboard: Clipboard | null
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
  toggleSnapping: () => void
  setCropEditing: (segmentId: string | null) => void
  // Adds a marker at the playhead, or removes the one there. It goes on the
  // selected clip when exactly one is selected and the playhead is on it,
  // otherwise on the timeline.
  toggleMarkerAtPlayhead: () => void
  // Moves the playhead to the next (1) or previous (-1) marker.
  jumpToMarker: (direction: 1 | -1) => void
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
  addAdjustmentAtPlayhead: () => void
  splitAtPlayhead: () => void
  deleteSelected: () => void
  copySelected: () => void
  cutSelected: () => void
  // Pastes at the playhead and selects what was pasted.
  paste: () => void
  // Copies the selection to just after itself and selects the copy.
  duplicateSelected: () => void
  // Deletes the selection and closes the gaps it leaves on each track.
  rippleDeleteSelected: () => void
  loadProject: (text: string) => void
  newProject: () => void
  // Opens a project kept in this browser. The open one is saved first.
  openSavedProject: (id: string) => Promise<void>
  // Removes a kept project. Removing the open one opens the next most recent,
  // or a new project if there is none.
  deleteSavedProject: (id: string) => Promise<void>
  renameProject: (name: string) => void
  refreshProjects: () => Promise<void>
  // Folds the selected clips into one compound clip.
  compoundSelected: () => void
  // Puts the selected compound clip's contents back on the timeline.
  breakApartSelected: () => void
  // Opens a compound clip's own timeline for editing, and goes back out.
  // Asks the browser for the fonts installed on this computer (it may ask the
  // user's permission first).
  loadLocalFonts: () => Promise<void>
  enterCompound: (segmentId: string) => void
  leaveCompound: () => void
}

let restored: Promise<void> | null = null

// Saves the project a moment after it last changed, so a drag that updates it
// sixty times a second is written once. Started only after the saved project
// has been restored, so the empty starting project never overwrites it.
// A project just opened is not saved again until it changes, so opening one
// does not move it to the top of the list.
let opened: Draft | null = null

const persist = (draft: Draft, media: string[]) =>
  saveProject(draft, media).then(
    () => {
      useEditor.setState({ projectSaved: true })
      void useEditor.getState().refreshProjects()
    },
    () => useEditor.setState({ projectSaved: false }),
  )

function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    timer = undefined
    const state = useEditor.getState()
    void persist(rootDraft(state), state.projectMedia)
  }
  const rootId = (s: State) => (s.compoundStack.length ? s.compoundStack[0].draft.id : s.draft.id)
  useEditor.subscribe((state, previous) => {
    if (state.draft === previous.draft && state.projectMedia === previous.projectMedia) return
    // Switching to another project: the one being left gets its last change
    // saved now, not dropped with the timer.
    if (rootId(state) !== rootId(previous) && timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
      void persist(rootDraft(previous), previous.projectMedia)
    }
    if (state.draft === opened && state.projectMedia === previous.projectMedia) return
    clearTimeout(timer)
    timer = setTimeout(save, 400)
  })
  // Leaving the page should not lose the last change. The normal save would
  // not finish in time, so the project is stashed where a write is immediate.
  window.addEventListener('pagehide', () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    stashProject(JSON.stringify(rootDraft(useEditor.getState())))
  })
}

// New projects start with the main-track magnet on, as CapCut projects do.
const newDraft = (): Draft => setMagnet(emptyDraft(), true)

const selection = (ids: string[]) => ({
  selectedIds: ids,
  selectedId: ids.length > 0 ? ids[ids.length - 1] : null,
})

// The selection, less any clips that undo or redo has just taken away.
function stillThere(draft: Draft, ids: string[]) {
  const present = new Set(draft.tracks.flatMap((t) => t.segments.map((s) => s.id)))
  return selection(ids.filter((id) => present.has(id)))
}

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
  snapping: true,
  cropEditing: null,
  projects: [],
  compoundStack: [],
  projectMedia: [],
  localFonts: [],
  warnings: [],
  clipboard: null,
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
    const restored = past[past.length - 1]
    set({
      draft: restored,
      past: past.slice(0, -1),
      future: [draft, ...future],
      ...stillThere(restored, get().selectedIds),
    })
  },
  redo: () => {
    const { draft, past, future } = get()
    if (future.length === 0) return
    set({
      draft: future[0],
      past: [...past, draft],
      future: future.slice(1),
      ...stillThere(future[0], get().selectedIds),
    })
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
    // A clip on a locked track cannot be picked.
    if (unlocked(get().draft, [segmentId]).length === 0) return
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
  selectMany: (segmentIds) => set(selection(unlocked(get().draft, segmentIds))),
  selectAll: () => {
    const { draft } = get()
    set(selection(unlocked(draft, draft.tracks.flatMap((t) => t.segments.map((s) => s.id)))))
  },
  setZoom: (pxPerSec) => set({ pxPerSec: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pxPerSec)) }),
  toggleSnapping: () => set({ snapping: !get().snapping }),
  setCropEditing: (segmentId) => set({ cropEditing: segmentId, playing: false }),
  toggleMarkerAtPlayhead: () => {
    const { draft, playhead, selectedIds, commit } = get()
    commit(toggleMarker(draft, playhead, selectedIds.length === 1 ? selectedIds[0] : null))
  },
  jumpToMarker: (direction) => {
    const { draft, playhead } = get()
    const time = neighbourMarker(draft, snapToFrame(playhead, draft.fps), direction)
    if (time !== null) set({ playhead: time, playing: false })
  },
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
      if (!get().projectMedia.includes(key)) set({ projectMedia: [...get().projectMedia, key] })
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
    set({ projectMedia: get().projectMedia.filter((k) => k !== key) })
    // Another project that has the file keeps it, in storage and here; this
    // project only stops listing it.
    const others = (await listProjects().catch(() => [])).filter(
      (p) => p.draft_id !== rootDraft(get()).id,
    )
    if (others.some((p) => !p.media || p.media.includes(key))) return
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
        const [entry, files] = await Promise.all([loadProjectEntry(), loadMedia()])
        const saved = entry?.json ?? null
        // A change made just as the last session closed is newer than the
        // autosave; it now gets saved properly.
        const stashed = takeStashedProject()
        const json = stashed ?? saved
        if (json) {
          const { draft } = openProject(json)
          if (stashed) void saveProject(draft).catch(() => {})
          set({ draft, past: [], future: [], playhead: 0, compoundStack: [], ...selection([]) })
        }
        await get().importFiles(files, false)
        // A project from before media was kept per project has all of it.
        set({ projectMedia: entry?.media ?? files.map((f) => assetKey(f.name)) })
      } catch {
        // Storage unavailable or its contents unreadable: start fresh.
      }
      set({ restoring: false, storage: await storageUse() })
      void keepStorage()
      startAutosave()
      await get().refreshProjects()
    })()
    return restored
  },

  addAssetToTimeline: (asset) => {
    const { draft, playhead, commit } = get()
    const added = addMedia(draft, materialFor(asset), playhead)
    commit(added.draft)
    set(selection([added.segmentId]))
  },

  addAdjustmentAtPlayhead: () => {
    const { draft, playhead, commit } = get()
    const added = addAdjustmentLayer(draft, playhead)
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
    const under = draft.tracks
      .filter((track) => !isLocked(track))
      .flatMap((track) => track.segments.filter((s) => isActive(s, t)))
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

  copySelected: () => {
    const { draft, selectedIds } = get()
    const copied = copySegments(draft, selectedIds)
    if (copied) set({ clipboard: copied })
  },

  cutSelected: () => {
    const { draft, selectedIds, commit } = get()
    const copied = copySegments(draft, selectedIds)
    if (!copied) return
    set({ clipboard: copied })
    commit(removeSegments(draft, selectedIds))
    set(selection([]))
  },

  paste: () => {
    const { draft, clipboard, playhead, commit } = get()
    const pasted = clipboard && pasteSegments(draft, clipboard, playhead)
    if (!pasted) return
    commit(pasted.draft)
    set(selection(pasted.segmentIds))
  },

  duplicateSelected: () => {
    const { draft, selectedIds, commit } = get()
    const made = duplicateSegments(draft, selectedIds)
    if (!made) return
    commit(made.draft)
    set(selection(made.segmentIds))
  },

  rippleDeleteSelected: () => {
    const { draft, selectedIds, commit } = get()
    if (selectedIds.length === 0) return
    commit(rippleDelete(draft, selectedIds))
    set(selection([]))
  },

  loadProject: (text) => {
    const { draft, warnings } = openProject(text)
    const assets = get().assets
    set({
      draft,
      compoundStack: [],
      // An opened file has the files it uses that are already here.
      projectMedia: filesUsed(draft).filter((k) => assets[k]),
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
      compoundStack: [],
      projectMedia: [],
      cropEditing: null,
      warnings: [],
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      ...selection([]),
    }),

  openSavedProject: async (id) => {
    if (id === rootDraft(get()).id) return
    const entry = await loadProjectEntry(id)
    if (!entry) return
    const { draft } = openProject(entry.json)
    opened = draft
    set({
      draft,
      compoundStack: [],
      projectMedia: entry.media ?? (await storedMediaKeys().catch(() => [])),
      warnings: [],
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      cropEditing: null,
      ...selection([]),
    })
    // It is now the one to reopen next time, without counting as a change.
    void setCurrentProject(draft.id).catch(() => {})
  },

  deleteSavedProject: async (id) => {
    await deleteProject(id).catch(() => {})
    const rest = (await listProjects().catch(() => [])).filter((p) => p.draft_id !== id)
    if (id === rootDraft(get()).id) {
      const next = rest[0]
      if (next) await get().openSavedProject(next.draft_id)
      else get().newProject()
    }
    set({ projects: rest })
    // Stored files no project has any more go too. A project from before
    // media was kept per project counts as having everything.
    if (rest.some((p) => !p.media)) return
    const current = get()
    const wanted = new Set([
      ...rest.flatMap((p) => p.media ?? []),
      ...current.projectMedia,
      ...filesUsed(rootDraft(current)),
    ])
    for (const key of await storedMediaKeys().catch(() => [])) {
      if (wanted.has(key)) continue
      const asset = get().assets[key]
      if (asset) {
        URL.revokeObjectURL(asset.url)
        dropVisuals(asset.url)
        const remaining = { ...get().assets }
        delete remaining[key]
        set({ assets: remaining })
      }
      await deleteMedia(key).catch(() => {})
    }
    set({ storage: await storageUse() })
  },

  renameProject: (name) => {
    const { draft, commit, compoundStack } = get()
    const trimmed = name.trim()
    // Inside a compound clip the name shown is the project's, which cannot be
    // changed from there.
    if (!trimmed || trimmed === draft.name || compoundStack.length > 0) return
    commit({ ...draft, name: trimmed })
  },

  compoundSelected: () => {
    const { draft, selectedIds, commit } = get()
    const made = makeCompound(draft, selectedIds)
    if (!made) return
    commit(made.draft)
    set(selection([made.segmentId]))
  },

  breakApartSelected: () => {
    const { draft, selectedId, commit } = get()
    const broken = selectedId ? breakApart(draft, selectedId) : null
    if (!broken) return
    commit(broken.draft)
    set(selection(broken.segmentIds))
  },

  loadLocalFonts: async () => {
    const query = (window as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    if (!query) return
    const fonts = await query.call(window).catch(() => [])
    set({ localFonts: [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b)) })
  },

  enterCompound: (segmentId) => {
    const { draft, past, future, compoundStack, playhead } = get()
    const loc = draft.tracks.flatMap((t) => t.segments).find((s) => s.id === segmentId)
    const material = loc && draft.materials.videos.find((m) => m.id === loc.material_id)
    if (!loc || !material?.compound) return
    const inside = material.compound
    // The playhead goes to the matching moment inside, where there is one.
    const src = loc.source_timerange
    const at = src ? Math.min(Math.max(0, src.start + (playhead - loc.target_timerange.start) * loc.speed), inside.duration) : 0
    set({
      compoundStack: [
        ...compoundStack,
        { draft, past, future, segmentId, materialId: material.id, name: material.material_name || 'Compound clip' },
      ],
      draft: inside,
      past: [],
      future: [],
      playhead: Math.max(0, at),
      playing: false,
      cropEditing: null,
      ...selection([]),
    })
  },

  leaveCompound: () => {
    const { draft, compoundStack } = get()
    const level = compoundStack[compoundStack.length - 1]
    if (!level) return
    const outer = updateCompound(level.draft, level.materialId, draft)
    const changed = level.draft.materials.videos.find((m) => m.id === level.materialId)?.compound !== draft
    const segment = outer.tracks.flatMap((t) => t.segments).find((s) => s.id === level.segmentId)
    set({
      compoundStack: compoundStack.slice(0, -1),
      draft: outer,
      // What was done inside is one undo step out here.
      past: changed ? [...level.past, level.draft].slice(-HISTORY_LIMIT) : level.past,
      future: changed ? [] : level.future,
      playhead: segment ? segment.target_timerange.start : 0,
      playing: false,
      cropEditing: null,
      ...selection(segment ? [segment.id] : []),
    })
  },

  refreshProjects: async () => {
    const projects = await listProjects().catch(() => null)
    if (projects) set({ projects })
  },
}))

// Whether this browser can list the fonts installed on the computer.
export const canListLocalFonts = (): boolean => 'queryLocalFonts' in window
