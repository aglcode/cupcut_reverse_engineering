// A file on disk for an export to be written into as it is encoded.
//
// By default it lives in the browser's private file store for this site (the
// origin private file system), which needs no file dialog or permission
// prompt. The finished file is handed to the download link straight from
// disk, so the export never has to fit in memory. Only one export is kept
// there: starting a new one removes the last.
//
// Where the browser has a save dialog for web pages, the export can instead
// go straight into a file the user picks, which skips the private store and
// the download, and so the second copy.

const FOLDER = 'exports'

export type ExportFile = {
  // The file's name, as saved.
  name: string
  // True for a file the user picked; false for one in the private store.
  picked: boolean
  // Give this to the exporter.
  writable: WritableStream
  // Call once the export has finished: commits what was written and returns
  // the file, read from disk on demand.
  finish: () => Promise<File>
  // After a failed or cancelled export: throws away what was written.
  discard: () => Promise<void>
}

// The browser only replaces a file's contents when its stream is closed, and
// drops them if the stream is aborted. The exporter closes its stream when an
// export is cancelled as well as when it finishes, which would commit half a
// video over whatever the file held before. So the exporter gets a stream that
// passes writes on but cannot close the file; only finish() does that.
function guard(file: FileSystemWritableFileStream) {
  return {
    writable: new WritableStream({
      write: (chunk) => file.write(chunk),
    }),
    commit: () => file.close(),
    abandon: () => file.abort().catch(() => {}),
  }
}

type DirectoryWithKeys = FileSystemDirectoryHandle & { keys: () => AsyncIterable<string> }

// Null where the browser has no private file store or it cannot be used; the
// export then falls back to building the file in memory.
export async function openExportFile(name: string): Promise<ExportFile | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle(FOLDER, { create: true })
    for await (const old of (folder as DirectoryWithKeys).keys()) {
      await folder.removeEntry(old).catch(() => {})
    }
    const fileName = `${name.replace(/[\\/:*?"<>|]/g, '_') || 'export'}.mp4`
    const handle = await folder.getFileHandle(fileName, { create: true })
    const file = guard(await handle.createWritable())
    return {
      name: fileName,
      picked: false,
      writable: file.writable,
      finish: async () => {
        await file.commit()
        return handle.getFile()
      },
      discard: async () => {
        await file.abandon()
        await folder.removeEntry(fileName).catch(() => {})
      },
    }
  } catch {
    return null
  }
}

type SavePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

const savePicker = (): SavePicker | null => {
  const picker = (window as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  return typeof picker === 'function' ? picker.bind(window) : null
}

// Whether this browser lets a page save straight to a file of the user's choosing.
export const canPickExportFile = (): boolean => savePicker() !== null

// Asks where to save and opens that file for writing. Null if the user backs
// out of the dialog. Must be called from a click, before anything else is
// awaited, or the browser refuses to show the dialog.
//
// The file only takes its new contents when the export finishes; a failed or
// cancelled export leaves an existing file as it was (a newly named one is
// left empty, since removing it could remove something the user wanted).
export async function pickExportFile(name: string): Promise<ExportFile | null> {
  const picker = savePicker()
  if (!picker) return null
  let handle: FileSystemFileHandle
  try {
    handle = await picker({
      suggestedName: `${name.replace(/[\\/:*?"<>|]/g, '_') || 'export'}.mp4`,
      types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
  const file = guard(await handle.createWritable())
  return {
    name: handle.name,
    picked: true,
    writable: file.writable,
    finish: async () => {
      await file.commit()
      return handle.getFile()
    },
    discard: file.abandon,
  }
}
