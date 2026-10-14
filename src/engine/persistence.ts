// Keeps projects and their media between sessions.
//
// CapCut reopens a draft by reading each material's absolute path from disk.
// A web page cannot, so every project and a copy of every imported file are
// kept in the browser's IndexedDB, and the one last open is put back when the
// page loads. The copies count against the browser's storage quota for this
// site. Media is one pool shared by all projects, keyed by file name.
//
// CapCut lists its drafts in root_meta_info.json, one entry per draft under
// all_draft_store with draft_id, draft_name, tm_draft_create,
// tm_draft_modified (microseconds since 1970) and tm_duration. A project's
// entry here carries the same fields.

import type { Draft } from '../model/types'

const DB_NAME = 'cupcut'
const DB_VERSION = 1
const MEDIA = 'media'
const PROJECT = 'project'
const CURRENT = 'current'

type StoredMedia = { key: string; file: File }
export type ProjectSummary = {
  draft_id: string
  draft_name: string
  tm_draft_create: number
  tm_draft_modified: number
  tm_duration: number
  // Keys of the files imported into this project, as CapCut lists a draft's
  // imported files under draft_materials in draft_meta_info.json. Missing on
  // projects saved before media was kept per project; those count as having
  // every file.
  media?: string[]
}
type StoredProject = ProjectSummary & { json: string }
// What is kept under CURRENT: which project is open. Before there were several
// projects, the project itself was kept there, as { json, savedAt }.
type CurrentPointer = { draft_id: string }
type OldCurrent = { json: string; savedAt: number }

let opening: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(PROJECT)) db.createObjectStore(PROJECT)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage'))
  })
  return opening
}

// Runs one operation in its own transaction and resolves when the
// transaction has committed, not merely when the request was accepted.
async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const request = operation(tx.objectStore(store))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error ?? new Error('Browser storage failed'))
    tx.onabort = () => reject(tx.error ?? new Error('Browser storage is full or unavailable'))
  })
}

const nowUs = () => Date.now() * 1000

const summaryOf = (p: StoredProject): ProjectSummary => ({
  draft_id: p.draft_id,
  draft_name: p.draft_name,
  tm_draft_create: p.tm_draft_create,
  tm_draft_modified: p.tm_draft_modified,
  tm_duration: p.tm_duration,
  media: p.media,
})

// Saves a project under its own id and makes it the one that opens next time.
export async function saveProject(draft: Draft, media?: string[]): Promise<ProjectSummary> {
  const existing = await run<StoredProject | undefined>(PROJECT, 'readonly', (s) => s.get(draft.id))
  const stored: StoredProject = {
    draft_id: draft.id,
    draft_name: draft.name,
    tm_draft_create: existing?.tm_draft_create ?? nowUs(),
    tm_draft_modified: nowUs(),
    tm_duration: draft.duration,
    media: media ?? existing?.media,
    json: JSON.stringify(draft),
  }
  await run(PROJECT, 'readwrite', (s) => s.put(stored, draft.id))
  await run(PROJECT, 'readwrite', (s) => s.put({ draft_id: draft.id } satisfies CurrentPointer, CURRENT))
  return summaryOf(stored)
}

// A project kept the old way, as the single current project, is moved to an
// entry of its own the first time it is read.
async function migrate(): Promise<void> {
  const current = await run<CurrentPointer | OldCurrent | undefined>(PROJECT, 'readonly', (s) => s.get(CURRENT))
  if (!current || !('json' in current)) return
  try {
    const draft = JSON.parse(current.json) as Draft
    if (typeof draft.id !== 'string') return
    const at = current.savedAt * 1000
    const stored: StoredProject = {
      draft_id: draft.id,
      draft_name: draft.name ?? '',
      tm_draft_create: at,
      tm_draft_modified: at,
      tm_duration: draft.duration ?? 0,
      json: current.json,
    }
    await run(PROJECT, 'readwrite', (s) => s.put(stored, draft.id))
    await run(PROJECT, 'readwrite', (s) => s.put({ draft_id: draft.id } satisfies CurrentPointer, CURRENT))
  } catch {
    // Unreadable: leave it; there is nothing to move.
  }
}

// Every saved project, most recently changed first.
export async function listProjects(): Promise<ProjectSummary[]> {
  await migrate()
  const all = await run<(StoredProject | CurrentPointer)[]>(PROJECT, 'readonly', (s) => s.getAll())
  return all
    .filter((p): p is StoredProject => 'json' in p && typeof p.draft_id === 'string')
    .map(summaryOf)
    .sort((a, b) => b.tm_draft_modified - a.tm_draft_modified)
}

// The project with this id, or the one open last time.
export async function loadProject(id?: string): Promise<string | null> {
  return (await loadProjectEntry(id))?.json ?? null
}

// The same, with the list of media files it has (null when it predates that).
export async function loadProjectEntry(id?: string): Promise<{ json: string; media: string[] | null } | null> {
  await migrate()
  const key = id ?? (await run<CurrentPointer | undefined>(PROJECT, 'readonly', (s) => s.get(CURRENT)))?.draft_id
  if (!key) return null
  const stored = await run<StoredProject | undefined>(PROJECT, 'readonly', (s) => s.get(key))
  return stored ? { json: stored.json, media: stored.media ?? null } : null
}

// Keys of every stored media file.
export async function storedMediaKeys(): Promise<string[]> {
  return (await run<IDBValidKey[]>(MEDIA, 'readonly', (s) => s.getAllKeys())).map(String)
}

// Makes a project the one that opens next time, without counting as a change.
export const setCurrentProject = (id: string): Promise<unknown> =>
  run(PROJECT, 'readwrite', (s) => s.put({ draft_id: id } satisfies CurrentPointer, CURRENT))

export const deleteProject = (id: string): Promise<unknown> =>
  run(PROJECT, 'readwrite', (s) => s.delete(id))

export const saveMedia = (key: string, file: File): Promise<unknown> =>
  run(MEDIA, 'readwrite', (s) => s.put({ key, file } satisfies StoredMedia))

export const deleteMedia = (key: string): Promise<unknown> =>
  run(MEDIA, 'readwrite', (s) => s.delete(key))

export async function loadMedia(): Promise<File[]> {
  const stored = await run<StoredMedia[]>(MEDIA, 'readonly', (s) => s.getAll())
  return stored.map((m) => m.file)
}

export type StorageUse = { used: number; quota: number }

// How much of this site's storage is in use, where the browser will say.
export async function storageUse(): Promise<StorageUse | null> {
  const estimate = await navigator.storage?.estimate?.().catch(() => null)
  if (!estimate || estimate.usage === undefined || !estimate.quota) return null
  return { used: estimate.usage, quota: estimate.quota }
}

// Asks the browser not to clear this site's storage when disk space runs low.
// It may say no; nothing depends on the answer.
export const keepStorage = (): Promise<boolean> =>
  navigator.storage?.persist?.().catch(() => false) ?? Promise.resolve(false)

// ---- last-moment stash -------------------------------------------------------
// A write to IndexedDB that starts while the page is closing is not finished
// by the browser. localStorage writes are immediate, so the newest version of
// the project is put there as the page goes and picked up on the next load.

const STASH = 'cupcut:unsaved-project'

export function stashProject(json: string) {
  try {
    localStorage.setItem(STASH, json)
  } catch {
    // Too large for localStorage, or storage is off. The last autosave stands.
  }
}

// The stashed project, if the last session left one. Taking it removes it.
export function takeStashedProject(): string | null {
  try {
    const json = localStorage.getItem(STASH)
    if (json !== null) localStorage.removeItem(STASH)
    return json
  } catch {
    return null
  }
}
