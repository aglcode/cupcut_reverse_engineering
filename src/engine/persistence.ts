// Keeps the project and its media between sessions.
//
// CapCut reopens a draft by reading each material's absolute path from disk.
// A web page cannot, so the current project and a copy of every imported file
// are kept in the browser's IndexedDB and put back when the page loads.
// The copies count against the browser's storage quota for this site.

const DB_NAME = 'cupcut'
const DB_VERSION = 1
const MEDIA = 'media'
const PROJECT = 'project'
const CURRENT = 'current'

type StoredMedia = { key: string; file: File }
type StoredProject = { json: string; savedAt: number }

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

export const saveProject = (json: string): Promise<unknown> =>
  run(PROJECT, 'readwrite', (s) => s.put({ json, savedAt: Date.now() } satisfies StoredProject, CURRENT))

export async function loadProject(): Promise<string | null> {
  const stored = await run<StoredProject | undefined>(PROJECT, 'readonly', (s) => s.get(CURRENT))
  return stored?.json ?? null
}

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
