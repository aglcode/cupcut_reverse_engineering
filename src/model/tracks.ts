// Track switches: lock, hide and mute.
//
// CapCut's track header has Lock track, Hide track clips and Mute track (its
// interface text names all three), and every track in a draft carries a
// number field, `attribute`, that the engine reads as TrackAttributes. It is 0
// on all 181 tracks in the local drafts, so which bit is which cannot be seen
// there: mute as bit 1 follows common report, hide and lock as bits 2 and 4
// are this editor's own.
//
// A hidden track's pictures are not drawn (its sound still plays); a muted
// track is not heard; a locked track's clips cannot be picked or changed.

import type { Draft, Track } from './types'

export const TRACK_MUTED = 1
export const TRACK_HIDDEN = 2
export const TRACK_LOCKED = 4

const has = (track: Track, flag: number): boolean => ((track.attribute ?? 0) & flag) !== 0

export const isMuted = (track: Track): boolean => has(track, TRACK_MUTED)
export const isHidden = (track: Track): boolean => has(track, TRACK_HIDDEN)
export const isLocked = (track: Track): boolean => has(track, TRACK_LOCKED)

// Which switches a kind of track has: sound only where there is sound,
// pictures only where there are pictures.
export function trackSwitches(track: Track): ('lock' | 'hide' | 'mute')[] {
  const out: ('lock' | 'hide' | 'mute')[] = ['lock']
  if (track.type !== 'audio') out.push('hide')
  if (track.type === 'video' || track.type === 'audio') out.push('mute')
  return out
}

export function setTrackFlag(draft: Draft, trackId: string, flag: number, on: boolean): Draft {
  return {
    ...draft,
    tracks: draft.tracks.map((t) =>
      t.id === trackId ? { ...t, attribute: on ? (t.attribute ?? 0) | flag : (t.attribute ?? 0) & ~flag } : t,
    ),
  }
}

// Ids of every clip on a locked track.
export function lockedSegmentIds(draft: Draft): Set<string> {
  return new Set(draft.tracks.filter(isLocked).flatMap((t) => t.segments.map((s) => s.id)))
}

// The given clip ids, less those on locked tracks.
export function unlocked(draft: Draft, ids: string[]): string[] {
  const locked = lockedSegmentIds(draft)
  return ids.filter((id) => !locked.has(id))
}
