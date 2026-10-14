// Copy, cut, paste and duplicate.
//
// CapCut has all four (its engine names CopySegmentHandler, CutSegmentCache,
// PasteSegments and duplicate_segment_id), but nothing in a draft shows where
// it puts pasted clips or how it settles a conflict. The placement rules, in
// pasteSegments in ops.ts, are this editor's own.

import { findMaterial, mainTrackIndex, pasteSegments } from './ops'
import {
  segmentEnd,
  type AudioMaterial,
  type Draft,
  type Segment,
  type TextMaterial,
  type TrackType,
  type VideoMaterial,
} from './types'

export type ClipboardItem = {
  segment: Segment
  // null for an adjustment layer.
  material: VideoMaterial | AudioMaterial | TextMaterial | null
  trackType: TrackType
  // The track the clip was on. Clips from one track are pasted onto one track.
  lane: string
  // Whether that was the main (first video) track.
  fromMain: boolean
}

export type Clipboard = {
  // Timeline time of the earliest copied clip; the rest keep their distance from it.
  origin: number
  items: ClipboardItem[]
}

// A self-contained copy of the given clips: later edits to the draft, or to
// what is pasted from it, cannot change it.
export function copySegments(draft: Draft, segmentIds: string[]): Clipboard | null {
  const wanted = new Set(segmentIds)
  const main = mainTrackIndex(draft)
  const items: ClipboardItem[] = []
  draft.tracks.forEach((track, index) => {
    for (const segment of track.segments) {
      if (!wanted.has(segment.id)) continue
      const material = findMaterial(draft, segment.material_id)
      // Only an adjustment layer has no material.
      if (!material && track.type !== 'adjust') continue
      items.push({
        segment: structuredClone(segment),
        material: material ? structuredClone(material) : null,
        trackType: track.type,
        lane: track.id,
        fromMain: index === main,
      })
    }
  })
  if (items.length === 0) return null
  return { origin: Math.min(...items.map((i) => i.segment.target_timerange.start)), items }
}

// A copy of the given clips placed straight after the last of them.
export function duplicateSegments(
  draft: Draft,
  segmentIds: string[],
): { draft: Draft; segmentIds: string[] } | null {
  const copied = copySegments(draft, segmentIds)
  if (!copied) return null
  return pasteSegments(draft, copied, Math.max(...copied.items.map((i) => segmentEnd(i.segment))))
}
