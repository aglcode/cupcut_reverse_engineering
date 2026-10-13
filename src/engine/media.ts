// Imported media files. A draft refers to media by file name only; the actual
// File lives here, outside the draft, so projects stay small and portable.

import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { FULL_CROP } from '../model/crop'
import { US_PER_SEC } from '../model/time'
import { newId, type AudioMaterial, type Draft, type VideoMaterial } from '../model/types'

export type Asset = {
  name: string
  file: File
  url: string
  kind: 'video' | 'audio' | 'image'
  duration: number // microseconds; 0 for images
  width: number
  height: number
  hasAudio: boolean
  image: ImageBitmap | null
}

export type Assets = Record<string, Asset>

export const assetKey = (name: string): string => name.toLowerCase()

export const openInput = (file: File) =>
  new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })

function probeWithElement(file: File, url: string, tag: 'video' | 'audio') {
  return new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
    const el = document.createElement(tag)
    el.preload = 'metadata'
    el.onloadedmetadata = () =>
      resolve({
        duration: Number.isFinite(el.duration) ? Math.round(el.duration * US_PER_SEC) : 0,
        width: el instanceof HTMLVideoElement ? el.videoWidth : 0,
        height: el instanceof HTMLVideoElement ? el.videoHeight : 0,
      })
    el.onerror = () => reject(new Error(`Cannot read ${file.name}`))
    el.src = url
  })
}

export async function probeFile(file: File): Promise<Asset> {
  const url = URL.createObjectURL(file)
  const base = { name: file.name, file, url }
  try {
    if (file.type.startsWith('image/')) {
      const image = await createImageBitmap(file)
      return { ...base, kind: 'image', duration: 0, width: image.width, height: image.height, hasAudio: false, image }
    }

    const input = openInput(file)
    try {
      const video = await input.getPrimaryVideoTrack()
      const audio = await input.getPrimaryAudioTrack()
      if (!video && !audio) throw new Error('no tracks')
      const duration = Math.round((await input.computeDuration()) * US_PER_SEC)
      return {
        ...base,
        kind: video ? 'video' : 'audio',
        duration,
        width: video?.displayWidth ?? 0,
        height: video?.displayHeight ?? 0,
        hasAudio: audio !== null,
        image: null,
      }
    } catch {
      // Not a container mediabunny reads; the browser may still play it.
      const tag = file.type.startsWith('audio/') ? 'audio' : 'video'
      const meta = await probeWithElement(file, url, tag)
      const kind = tag === 'video' && meta.width > 0 ? 'video' : 'audio'
      return { ...base, kind, ...meta, hasAudio: true, image: null }
    } finally {
      input.dispose()
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error instanceof Error ? error : new Error(`Cannot read ${file.name}`)
  }
}

export function materialFor(asset: Asset): VideoMaterial | AudioMaterial {
  if (asset.kind === 'audio') {
    return {
      id: newId(),
      type: 'audio',
      name: asset.name,
      path: asset.name,
      duration: asset.duration,
    }
  }
  return {
    id: newId(),
    type: asset.kind === 'image' ? 'photo' : 'video',
    path: asset.name,
    duration: asset.duration,
    width: asset.width,
    height: asset.height,
    has_audio: asset.hasAudio,
    crop: { ...FULL_CROP },
  }
}

// File names the draft uses that have not been imported yet.
export function missingMedia(draft: Draft, assets: Assets): string[] {
  const used = new Set(draft.tracks.flatMap((t) => t.segments.map((s) => s.material_id)))
  const names = [...draft.materials.videos, ...draft.materials.audios]
    .filter((m) => used.has(m.id) && !assets[assetKey(m.path)])
    .map((m) => m.path)
  return [...new Set(names)]
}
