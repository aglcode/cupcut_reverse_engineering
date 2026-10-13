// Linked clips and extracted audio.
//
// Extracting audio follows CapCut drafts: the result is an ordinary audio clip
// whose material points at the video's own file (there, an audio material of
// type "extract_music" named "Extracted<date>-<n>").
//
// Linking is this editor's own. CapCut drafts store no connection between an
// extracted clip and its video; segments do carry a group_id field, which is
// empty in every draft inspected, and it is used here to mean "these clips
// belong together". Linked clips are selected together, so they move and are
// deleted together, and a clip linked to one on the main track follows it
// when the magnet closes that track up (see finalize in ops.ts).

import { newId, type Draft, type Segment } from './types'

const allSegments = (draft: Draft): Segment[] => draft.tracks.flatMap((t) => t.segments)

// The clip and everything linked to it.
export function linkedIds(draft: Draft, segmentId: string): string[] {
  const segments = allSegments(draft)
  const segment = segments.find((s) => s.id === segmentId)
  if (!segment) return []
  if (!segment.group_id) return [segmentId]
  return segments.filter((s) => s.group_id === segment.group_id).map((s) => s.id)
}

// True when the ids are exactly one linked group (and more than one clip).
export function isOneLink(draft: Draft, segmentIds: string[]): boolean {
  if (segmentIds.length < 2) return false
  const linked = linkedIds(draft, segmentIds[0])
  return linked.length === segmentIds.length && segmentIds.every((id) => linked.includes(id))
}

function withGroup(draft: Draft, segmentIds: string[], groupId: string): Draft {
  const ids = new Set(segmentIds)
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) => (ids.has(s.id) ? { ...s, group_id: groupId } : s)),
    })),
  }
}

// Links the given clips to each other. Any links they had before are replaced.
export function linkSegments(draft: Draft, segmentIds: string[]): Draft {
  const present = allSegments(draft).filter((s) => segmentIds.includes(s.id))
  if (present.length < 2) return draft
  return withGroup(
    draft,
    present.map((s) => s.id),
    newId(),
  )
}

// Unlinks the given clips, and with them everything they were linked to: a
// link with one clip left in it would mean nothing.
export function unlinkSegments(draft: Draft, segmentIds: string[]): Draft {
  const groups = new Set(
    allSegments(draft)
      .filter((s) => segmentIds.includes(s.id) && s.group_id)
      .map((s) => s.group_id),
  )
  if (groups.size === 0) return draft
  const members = allSegments(draft)
    .filter((s) => groups.has(s.group_id))
    .map((s) => s.id)
  return withGroup(draft, members, '')
}
