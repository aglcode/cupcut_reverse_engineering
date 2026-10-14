import { describe, expect, it } from 'vitest'
import { audibleSegments, resolveFrame } from '../engine/resolve'
import { useEditor } from '../state/store'
import { importCapCutDraft } from './capcutImport'
import { maskKind, maskShape, outline, setMask, shows } from './mask'
import { addMedia, addText, findSegment, moveSegment, moveSegmentToNewTrack, removeSegments } from './ops'
import { SPEED_PRESETS } from './speedCurve'
import { isHidden, isLocked, isMuted, setTrackFlag, TRACK_HIDDEN, TRACK_LOCKED, TRACK_MUTED, trackSwitches } from './tracks'
import { emptyDraft, type Draft, type VideoMaterial } from './types'

const video = (id: string): VideoMaterial => ({
  id,
  type: 'video',
  path: `${id}.mp4`,
  duration: 5_000_000,
  width: 1920,
  height: 1080,
  has_audio: true,
  crop: { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 },
})

// Magnet off: clip a on the main track, clip b on a track above it.
function scene(): { draft: Draft; a: string; b: string } {
  const a = addMedia(emptyDraft(), video('a'), 0)
  const b = addMedia(a.draft, video('b'), 0)
  return { draft: b.draft, a: a.segmentId, b: b.segmentId }
}
const trackOf = (d: Draft, id: string) => findSegment(d, id)!.track

describe('track switches', () => {
  it('each kind of track has the switches CapCut gives it', () => {
    const d = addText(scene().draft, 'Hi', 0).draft
    expect(d.tracks.map((t) => `${t.type}:${trackSwitches(t).join('+')}`)).toEqual([
      'video:lock+hide+mute',
      'video:lock+hide+mute',
      'text:lock+hide',
    ])
  })

  it('a hidden track is not drawn but still heard; a muted one is drawn but not heard', () => {
    const { draft, b } = scene()
    const hidden = setTrackFlag(draft, trackOf(draft, b).id, TRACK_HIDDEN, true)
    expect(isHidden(trackOf(hidden, b))).toBe(true)
    expect(resolveFrame(hidden, 1_000_000).visual.map((l) => l.segment.id)).not.toContain(b)
    expect(audibleSegments(hidden).map((s) => s.segment.id)).toContain(b)
    const muted = setTrackFlag(draft, trackOf(draft, b).id, TRACK_MUTED, true)
    expect(isMuted(trackOf(muted, b))).toBe(true)
    expect(resolveFrame(muted, 1_000_000).visual.map((l) => l.segment.id)).toContain(b)
    expect(audibleSegments(muted).map((s) => s.segment.id)).not.toContain(b)
    // Switching back off clears only that switch.
    const both = setTrackFlag(muted, trackOf(muted, b).id, TRACK_HIDDEN, true)
    const unmuted = setTrackFlag(both, trackOf(both, b).id, TRACK_MUTED, false)
    expect([isMuted(trackOf(unmuted, b)), isHidden(trackOf(unmuted, b))]).toEqual([false, true])
  })

  it('clips on a locked track cannot be picked', () => {
    const { draft, a, b } = scene()
    const locked = setTrackFlag(draft, trackOf(draft, b).id, TRACK_LOCKED, true)
    expect(isLocked(trackOf(locked, b))).toBe(true)
    useEditor.setState({ draft: locked, selectedIds: [], selectedId: null })
    useEditor.getState().select(b)
    expect(useEditor.getState().selectedIds).toEqual([])
    useEditor.getState().selectMany([a, b])
    expect(useEditor.getState().selectedIds).toEqual([a])
    useEditor.getState().selectAll()
    expect(useEditor.getState().selectedIds).toEqual([a])
    // Splitting with nothing selected leaves the locked clip whole.
    useEditor.setState({ selectedIds: [], selectedId: null, playhead: 1_000_000 })
    useEditor.getState().splitAtPlayhead()
    const after = useEditor.getState().draft
    expect(trackOf(after, b).segments).toHaveLength(1)
    expect(trackOf(after, a).segments).toHaveLength(2)
  })

  it('reads a CapCut track attribute', () => {
    const { draft } = importCapCutDraft({
      fps: 30,
      canvas_config: { width: 1920, height: 1080 },
      tracks: [{ id: 'T', type: 'video', flag: 0, attribute: 1, segments: [{ id: 'S', material_id: 'V', source_timerange: { start: 0, duration: 1e6 }, target_timerange: { start: 0, duration: 1e6 } }] }],
      materials: { videos: [{ id: 'V', type: 'video', path: 'a.mp4', duration: 9e6, width: 1920, height: 1080 }] },
    })
    expect(isMuted(draft.tracks[0])).toBe(true)
  })
})

describe('tracks come and go as in CapCut', () => {
  it('a track an edit leaves empty is removed, but never the main track', () => {
    const { draft, a, b } = scene()
    expect(draft.tracks).toHaveLength(2)
    expect(removeSegments(draft, [b]).tracks).toHaveLength(1)
    expect(removeSegments(draft, [a, b]).tracks.map((t) => t.type)).toEqual(['video'])
  })

  it('moving the last clip off a track removes the track', () => {
    const { draft, a, b } = scene()
    const moved = moveSegment(draft, b, 6_000_000, trackOf(draft, a).id)
    expect(moved.tracks).toHaveLength(1)
    expect(trackOf(moved, b).segments.map((s) => s.id)).toEqual([a, b])
  })

  it('dragging to a new track makes one above for pictures and below for sound', () => {
    const { draft, b } = scene()
    const raised = moveSegmentToNewTrack(draft, b, 0)
    // b's old track emptied and went; the new one is on top.
    expect(raised.tracks.map((t) => t.segments.map((s) => s.id).length)).toEqual([1, 1])
    expect(raised.tracks[raised.tracks.length - 1].segments[0].id).toBe(b)
    const sound = addMedia(draft, { id: 's', type: 'audio', name: 's', path: 's.wav', duration: 3e6 }, 0)
    const lowered = moveSegmentToNewTrack(sound.draft, sound.segmentId, 0)
    expect(lowered.tracks[0].segments[0].id).toBe(sound.segmentId)
    expect(lowered.tracks.filter((t) => t.type === 'audio')).toHaveLength(1)
  })
})

describe('Heart and Star masks', () => {
  it('are kept as CapCut geometric shapes, told apart by name', () => {
    const { draft, a } = scene()
    const heart = findSegment(setMask(draft, a, 'heart'), a)!.segment.mask!
    expect([heart.resource_type, heart.name, maskKind(heart)]).toEqual(['geometric_shape', 'Heart', 'heart'])
    const star = findSegment(setMask(draft, a, 'star'), a)!.segment.mask!
    expect([star.resource_type, star.name, maskKind(star)]).toEqual(['geometric_shape', 'Star', 'star'])
  })

  it('show their inside: a heart its lobes and point, a star its points but not between them', () => {
    const config = { width: 0.5, height: 1, centerX: 0, centerY: 0, rotation: 0, feather: 0, roundCorner: 0, invert: false }
    const heart = maskShape({ name: 'Heart', resource_type: 'geometric_shape', config }, 400, 200)
    expect(shows(heart, 0, 20)).toBe(true)
    expect(shows(heart, 0, -95)).toBe(false)
    expect(shows(heart, -50, -60)).toBe(true)
    // The tip is at the bottom centre; the bottom corners of its box are empty.
    expect(shows(heart, 0, 95)).toBe(true)
    expect(shows(heart, -90, 90)).toBe(false)
    const star = maskShape({ name: 'Star', resource_type: 'geometric_shape', config }, 400, 200)
    expect(shows(star, 0, -95)).toBe(true)
    expect(shows(star, 0, 0)).toBe(true)
    // Between two points, near the rim.
    expect(shows(star, 60, -60)).toBe(false)
    // The outlines fill their box.
    const xs = outline('heart', 100, 80).map((p) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 0)
  })

  it('import from CapCut by name, and an unknown shape is reported', () => {
    const draft = (name: string) => ({
      fps: 30,
      canvas_config: { width: 1920, height: 1080 },
      tracks: [{ id: 'T', type: 'video', flag: 0, segments: [{ id: 'S', material_id: 'V', source_timerange: { start: 0, duration: 1e6 }, target_timerange: { start: 0, duration: 1e6 }, extra_material_refs: ['M'] }] }],
      materials: {
        videos: [{ id: 'V', type: 'video', path: 'a.mp4', duration: 9e6, width: 1920, height: 1080 }],
        common_mask: [{ id: 'M', name, resource_type: 'geometric_shape', config: { width: 0.3, height: 0.3 } }],
      },
    })
    expect(maskKind(importCapCutDraft(draft('Star')).draft.tracks[0].segments[0].mask!)).toBe('star')
    const odd = importCapCutDraft(draft('Hexagon'))
    expect(odd.draft.tracks[0].segments[0].mask).toBeNull()
    expect(odd.warnings.some((w) => /masks of a kind/.test(w))).toBe(true)
  })
})

describe('speed presets', () => {
  it('are only the CapCut curves found in local drafts', () => {
    expect(SPEED_PRESETS.map((p) => p.name)).toEqual(['Hero', 'Bullet'])
  })
})
