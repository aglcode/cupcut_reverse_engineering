import { create } from 'zustand'
import { assetKey, materialFor, probeFile, type Asset, type Assets } from '../engine/media'
import { isActive } from '../engine/resolve'
import { openProject } from '../model/capcutImport'
import { addMedia, addText, findSegment, removeSegment, splitSegment } from '../model/ops'
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
  selectedId: string | null
  pxPerSec: number
  warnings: string[]

  // Applies an edit as one undo step.
  commit: (next: Draft) => void
  // During a drag: call checkpoint once, then preview for each pointer move.
  checkpoint: () => void
  preview: (next: Draft) => void
  undo: () => void
  redo: () => void

  setPlayhead: (us: number) => void
  setPlaying: (playing: boolean) => void
  select: (segmentId: string | null) => void
  setZoom: (pxPerSec: number) => void
  dismissWarnings: () => void

  importFiles: (files: File[]) => Promise<string[]>
  addAssetToTimeline: (asset: Asset) => void
  addTextAtPlayhead: () => void
  splitAtPlayhead: () => void
  deleteSelected: () => void
  loadProject: (text: string) => void
  newProject: () => void
}

export const useEditor = create<State>((set, get) => ({
  draft: emptyDraft(),
  past: [],
  future: [],
  assets: {},
  playhead: 0,
  playing: false,
  selectedId: null,
  pxPerSec: 80,
  warnings: [],

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
  select: (selectedId) => set({ selectedId }),
  setZoom: (pxPerSec) => set({ pxPerSec: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pxPerSec)) }),
  dismissWarnings: () => set({ warnings: [] }),

  importFiles: async (files) => {
    const errors: string[] = []
    for (const file of files) {
      try {
        const asset = await probeFile(file)
        const previous = get().assets[assetKey(asset.name)]
        if (previous) URL.revokeObjectURL(previous.url)
        set({ assets: { ...get().assets, [assetKey(asset.name)]: asset } })
      } catch {
        errors.push(file.name)
      }
    }
    return errors
  },

  addAssetToTimeline: (asset) => {
    const { draft, playhead, commit } = get()
    const added = addMedia(draft, materialFor(asset), playhead)
    commit(added.draft)
    set({ selectedId: added.segmentId })
  },

  addTextAtPlayhead: () => {
    const { draft, playhead, commit } = get()
    const added = addText(draft, 'Text', playhead)
    commit(added.draft)
    set({ selectedId: added.segmentId })
  },

  // Splits the selected segment, or everything under the playhead if nothing
  // under it is selected.
  splitAtPlayhead: () => {
    const { draft, playhead, selectedId, commit } = get()
    const t = snapToFrame(playhead, draft.fps)
    const selected = selectedId ? findSegment(draft, selectedId)?.segment : null
    const targets =
      selected && isActive(selected, t)
        ? [selected]
        : draft.tracks.flatMap((track) => track.segments.filter((s) => isActive(s, t)))
    commit(targets.reduce((d, s) => splitSegment(d, s.id, t), draft))
  },

  deleteSelected: () => {
    const { draft, selectedId, commit } = get()
    if (!selectedId) return
    commit(removeSegment(draft, selectedId))
    set({ selectedId: null })
  },

  loadProject: (text) => {
    const { draft, warnings } = openProject(text)
    set({ draft, warnings, past: [], future: [], playhead: 0, playing: false, selectedId: null })
  },

  newProject: () =>
    set({
      draft: emptyDraft(),
      warnings: [],
      past: [],
      future: [],
      playhead: 0,
      playing: false,
      selectedId: null,
    }),
}))
