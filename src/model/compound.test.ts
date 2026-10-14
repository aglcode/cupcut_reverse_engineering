import { describe, expect, it } from 'vitest'
import { missingMedia, type Assets } from '../engine/media'
import { audibleSegments, mediaLayersOf, resolveFrame } from '../engine/resolve'
import { rootDraft } from '../state/store'
import { importCapCutDraft, openProject } from './capcutImport'
import { breakApart, canBreakApart, isCompound, makeCompound, soundsInside, updateCompound } from './compound'
import { addMedia, addText, findSegment, setMagnet, setSpeed, trimSegment } from './ops'
import { sourceTimeAt } from './timing'
import { emptyDraft, segmentEnd, type AudioMaterial, type Draft, type VideoMaterial } from './types'

const crop = {
  upper_left_x: 0,
  upper_left_y: 0,
  upper_right_x: 1,
  upper_right_y: 0,
  lower_left_x: 0,
  lower_left_y: 1,
  lower_right_x: 1,
  lower_right_y: 1,
}
const video = (id: string): VideoMaterial => ({ id, type: 'video', path: `${id}.mp4`, duration: 10_000_000, width: 1920, height: 1080, has_audio: true, crop })
const song: AudioMaterial = { id: 'song', type: 'audio', name: 'song', path: 'song.wav', duration: 20_000_000 }

// Without the magnet: a 2 s clip at 1 s and a 3 s clip at 4 s on one video
// track, a title at 2 s and music from 0 to 8 s.
function project(): { draft: Draft; a: string; b: string; title: string; music: string } {
  let d = emptyDraft()
  const a = addMedia(d, video('a'), 1_000_000)
  d = trimSegment(a.draft, a.segmentId, 'end', 3_000_000)
  const b = addMedia(d, video('b'), 4_000_000)
  d = trimSegment(b.draft, b.segmentId, 'end', 7_000_000)
  const title = addText(d, 'Hi', 2_000_000)
  const music = addMedia(title.draft, song, 0)
  d = trimSegment(music.draft, music.segmentId, 'end', 8_000_000)
  return { draft: d, a: a.segmentId, b: b.segmentId, title: title.segmentId, music: music.segmentId }
}
const all = (d: Draft) => d.tracks.flatMap((t) => t.segments)
const materialOf = (d: Draft, id: string) => d.materials.videos.find((m) => m.id === findSegment(d, id)!.segment.material_id)!

describe('making a compound clip', () => {
  it('folds the clips into one clip spanning them, keeping their spacing inside', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b, p.title])!
    const outer = findSegment(made.draft, made.segmentId)!.segment
    expect(outer.target_timerange).toEqual({ start: 1_000_000, duration: 6_000_000 })
    // The music was not chosen and stays where it was.
    expect(all(made.draft).map((s) => s.id).sort()).toEqual([made.segmentId, p.music].sort())
    const m = materialOf(made.draft, made.segmentId)
    expect(isCompound(m)).toBe(true)
    expect(m).toMatchObject({ path: '', material_name: 'Compound clip1', duration: 6_000_000, width: 1920, height: 1080, has_audio: true })
    const inner = m.compound!
    expect(inner.tracks.map((t) => t.type)).toEqual(['video', 'text'])
    expect(inner.tracks[0].segments.map((s) => s.target_timerange.start)).toEqual([0, 3_000_000])
    expect(inner.tracks[1].segments[0].target_timerange.start).toBe(1_000_000)
    expect(inner.materials.videos.map((v) => v.id).sort()).toEqual(['a', 'b'])
    expect(inner.materials.texts).toHaveLength(1)
    // Their materials leave the outer project with them.
    expect(made.draft.materials.videos.map((v) => v.id)).not.toContain('a')
  })

  it('shows the inside at the matching moment', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b])!
    // 4.5 s outside is 3.5 s inside: half a second into clip b.
    const frame = resolveFrame(made.draft, 4_500_000)
    const layer = frame.visual.find((l) => l.kind === 'media')!
    expect(layer.kind === 'media' && layer.nested).toBeTruthy()
    const inside = mediaLayersOf(frame)
    expect(inside).toHaveLength(1)
    expect(inside[0].layer.segment.id).toBe(p.b)
    expect(inside[0].layer.key).toBe(`${made.segmentId}/${p.b}`)
    expect(inside[0].layer.sourceUs).toBe(500_000)
    // Between the two clips inside, the compound clip shows nothing.
    expect(mediaLayersOf(resolveFrame(made.draft, 3_500_000))).toEqual([])
  })

  it('a compound clip at double speed plays its inside twice as fast', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b])!
    const fast = setSpeed(made.draft, made.segmentId, 2)
    const outer = findSegment(fast, made.segmentId)!.segment
    expect(outer.target_timerange.duration).toBe(3_000_000)
    // 2.75 s outside is 3.5 s inside.
    expect(mediaLayersOf(resolveFrame(fast, 2_750_000))[0].layer.sourceUs).toBe(500_000)
  })

  it('makes one inside another', () => {
    const p = project()
    const first = makeCompound(p.draft, [p.a])!
    const second = makeCompound(first.draft, [first.segmentId, p.b])!
    // Numbered on from the compound clips already in the project.
    expect(materialOf(second.draft, second.segmentId).material_name).toBe('Compound clip2')
    const deep = mediaLayersOf(resolveFrame(second.draft, 1_500_000))
    expect(deep[0].layer.key).toBe(`${second.segmentId}/${first.segmentId}/${p.a}`)
    expect(deep[0].layer.sourceUs).toBe(500_000)
  })

  it('with the magnet on, the main track closes up and takes the compound clip', () => {
    let d = setMagnet(emptyDraft(), true)
    const x = addMedia(d, video('x'), 0)
    d = trimSegment(x.draft, x.segmentId, 'end', 2_000_000)
    const y = addMedia(d, video('y'), 2_000_000)
    d = trimSegment(y.draft, y.segmentId, 'end', 4_000_000)
    const z = addMedia(d, video('z'), 4_000_000)
    d = trimSegment(z.draft, z.segmentId, 'end', 6_000_000)
    const made = makeCompound(d, [x.segmentId, y.segmentId])!
    expect(made.draft.tracks).toHaveLength(1)
    expect(made.draft.tracks[0].segments.map((s) => [s.target_timerange.start, s.target_timerange.duration])).toEqual([
      [0, 4_000_000],
      [4_000_000, 2_000_000],
    ])
  })
})

describe('breaking a compound clip apart', () => {
  it('puts the clips back where they were', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b, p.title])!
    const broken = breakApart(made.draft, made.segmentId)!
    const where = (id: string) => findSegment(broken.draft, id)!.segment.target_timerange
    expect(where(p.a)).toEqual(findSegment(p.draft, p.a)!.segment.target_timerange)
    expect(where(p.b)).toEqual(findSegment(p.draft, p.b)!.segment.target_timerange)
    expect(where(p.title)).toEqual(findSegment(p.draft, p.title)!.segment.target_timerange)
    expect(broken.segmentIds.sort()).toEqual([p.a, p.b, p.title].sort())
    expect(broken.draft.materials.videos.some((m) => isCompound(m))).toBe(false)
    expect(broken.draft.materials.videos.map((m) => m.id).sort()).toEqual(['a', 'b'])
  })

  it('a trimmed compound clip gives back only the part it shows', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b])!
    // Show only 2 s to 5 s of the outer timeline: 1 s of a and 1 s of b.
    let d = trimSegment(made.draft, made.segmentId, 'start', 2_000_000)
    d = trimSegment(d, made.segmentId, 'end', 5_000_000)
    const broken = breakApart(d, made.segmentId)!
    const clips = all(broken.draft).filter((s) => s.id !== p.music && s.id !== p.title).sort((x, y) => x.target_timerange.start - y.target_timerange.start)
    expect(clips.map((s) => [s.target_timerange.start, segmentEnd(s)])).toEqual([
      [2_000_000, 3_000_000],
      [4_000_000, 5_000_000],
    ])
    // Each keeps showing the same footage at the same moment.
    expect(sourceTimeAt(clips[0], 2_000_000)).toBe(sourceTimeAt(findSegment(p.draft, p.a)!.segment, 2_000_000))
  })

  it('only when it plays forwards at one speed', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b])!
    expect(canBreakApart(made.draft, made.segmentId)).toBe(true)
    expect(canBreakApart(setSpeed(made.draft, made.segmentId, 2), made.segmentId)).toBe(true)
    const reversed = { ...made.draft, tracks: made.draft.tracks.map((t) => ({ ...t, segments: t.segments.map((s) => (s.id === made.segmentId ? { ...s, reverse: true } : s)) })) }
    expect(canBreakApart(reversed, made.segmentId)).toBe(false)
    expect(breakApart(reversed, made.segmentId)).toBeNull()
    expect(canBreakApart(p.draft, p.a)).toBe(false)
  })

  it('a sped-up compound clip gives back clips sped up the same, showing the same thing at the same time', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b, p.title])!
    const fast = setSpeed(made.draft, made.segmentId, 2)
    const before = (t: number) => mediaLayersOf(resolveFrame(fast, t)).map((m) => [m.layer.segment.id.length > 0, m.layer.sourceUs])
    const broken = breakApart(fast, made.segmentId)!
    const after = (t: number) => mediaLayersOf(resolveFrame(broken.draft, t)).map((m) => [m.layer.segment.id.length > 0, m.layer.sourceUs])
    for (const t of [500_000, 900_000, 1_100_000, 2_000_000, 3_400_000]) expect(after(t)).toEqual(before(t))
    const b = findSegment(broken.draft, p.b)!.segment
    expect(b.speed).toBe(2)
    // 3 s into the compound clip, which starts at 1 s and plays at double speed.
    expect(b.target_timerange).toEqual({ start: 2_500_000, duration: 1_500_000 })
    // The title (no source) is placed and sized by the same rule.
    expect(findSegment(broken.draft, p.title)!.segment.target_timerange).toEqual({ start: 1_500_000, duration: 1_500_000 })
  })
})

describe('editing inside a compound clip', () => {
  it('writes the inside back, and a shorter inside shortens the clip', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b])!
    const inner = materialOf(made.draft, made.segmentId).compound!
    // Inside, clip b is cut to end at 4 s, so the inside is 4 s long.
    const edited = trimSegment(inner, p.b, 'end', 4_000_000)
    const back = updateCompound(made.draft, materialOf(made.draft, made.segmentId).id, edited)
    expect(materialOf(back, made.segmentId).compound).toBe(edited)
    expect(materialOf(back, made.segmentId).duration).toBe(4_000_000)
    expect(findSegment(back, made.segmentId)!.segment.target_timerange).toEqual({ start: 1_000_000, duration: 4_000_000 })
  })

  it('the whole project is the inside put back into every level', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b])!
    const m = materialOf(made.draft, made.segmentId)
    const edited = { ...m.compound!, name: 'changed' }
    const root = rootDraft({
      draft: edited,
      compoundStack: [{ draft: made.draft, past: [], future: [], segmentId: made.segmentId, materialId: m.id, name: 'x' }],
    })
    expect(root.id).toBe(made.draft.id)
    expect(materialOf(root, made.segmentId).compound!.name).toBe('changed')
  })
})

describe('sound from inside a compound clip', () => {
  it('each sound inside becomes a clip on the outer timeline, over the stretch it plays', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b, p.music])!
    const sounds = audibleSegments(made.draft)
    // Clips a and b and the music, all from inside the compound clip.
    expect(sounds.map((s) => s.path).sort()).toEqual(['a.mp4', 'b.mp4', 'song.wav'])
    const music = sounds.find((s) => s.path === 'song.wav')!.segment
    expect(music.target_timerange).toEqual({ start: 0, duration: 8_000_000 })
    expect(music.id).toBe(`${made.segmentId}/${p.music}`)
  })

  it('follows the compound clip trimmed, sped up and turned down', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b])!
    let d = trimSegment(made.draft, made.segmentId, 'start', 2_000_000)
    d = setSpeed(d, made.segmentId, 2)
    const outer = findSegment(d, made.segmentId)!.segment
    const inside = materialOf(d, made.segmentId).compound!
    const mapped = soundsInside({ ...outer, volume: 0.5 }, inside.tracks[0].segments)
    // a is cut to its last second, at double speed: half a second long.
    expect(mapped[0].target_timerange).toEqual({ start: 2_000_000, duration: 500_000 })
    expect(mapped[0].speed).toBe(2)
    // The compound clip's volume is applied over time, not folded into the clip.
    expect(mapped[0].volume).toBe(1)
    expect(mapped[0].source_timerange).toEqual({ start: 1_000_000, duration: 1_000_000 })
  })

  it('a reversed compound clip is silent', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a])!
    const outer = { ...findSegment(made.draft, made.segmentId)!.segment, reverse: true }
    expect(soundsInside(outer, materialOf(made.draft, made.segmentId).compound!.tracks[0].segments)).toEqual([])
  })
})

describe('media and files', () => {
  it('asks for the files inside, not for the compound clip itself', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b])!
    const have = { 'a.mp4': {}, 'song.wav': {} } as unknown as Assets
    expect(missingMedia(made.draft, have)).toEqual(['b.mp4'])
  })

  it('a saved project with a compound clip opens again', () => {
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.b])!
    const opened = openProject(JSON.stringify(made.draft)).draft
    expect(mediaLayersOf(resolveFrame(opened, 4_500_000))[0].layer.sourceUs).toBe(500_000)
  })

  it('imports a CapCut compound clip with the draft it holds', () => {
    // As found in a real draft, reduced to what the importer reads.
    const capcut = {
      fps: 30,
      canvas_config: { width: 1920, height: 1080 },
      tracks: [
        { id: 'T', type: 'video', flag: 0, segments: [{ id: 'S', material_id: 'V', source_timerange: { start: 0, duration: 400000 }, target_timerange: { start: 0, duration: 400000 }, speed: 1, volume: 1, extra_material_refs: ['D'] }] },
      ],
      materials: {
        videos: [{ id: 'V', type: 'video', path: '', material_name: 'Compound clip1', duration: 400000, width: 1920, height: 1080, has_audio: true }],
        drafts: [
          {
            id: 'D',
            type: 'combination',
            combination_id: 'C',
            name: '',
            draft: {
              fps: 30,
              duration: 400000,
              canvas_config: { width: 1920, height: 1080 },
              tracks: [{ id: 'IT', type: 'video', segments: [{ id: 'IS', material_id: 'IV', source_timerange: { start: 43566666, duration: 400000 }, target_timerange: { start: 0, duration: 400000 }, speed: 1, volume: 1, extra_material_refs: [] }] }],
              materials: { videos: [{ id: 'IV', type: 'video', path: 'C:/x/inside.mp4', duration: 60000000, width: 1920, height: 1080, has_audio: true }] },
            },
          },
        ],
      },
    }
    const { draft, warnings } = importCapCutDraft(capcut)
    const m = draft.materials.videos[0]
    expect(m.material_name).toBe('Compound clip1')
    expect(m.path).toBe('')
    expect(m.compound!.materials.videos[0].path).toBe('inside.mp4')
    expect(mediaLayersOf(resolveFrame(draft, 200_000))[0].layer.sourceUs).toBe(43766666)
    expect(warnings).toEqual([])
  })
})

describe("a compound clip's own volume and fades on its sound", () => {
  it('apply over time on top of the sounds inside, also inside a compound in a compound', async () => {
    const { setFade } = await import('./fades')
    const { setKeyframes } = await import('./keyframes')
    const p = project()
    const made = makeCompound(p.draft, [p.a, p.music])!
    // The compound clip runs 0 to 8 s: half volume and a 2 s fade in.
    let d = setFade(made.draft, made.segmentId, { fade_in_duration: 2_000_000 })
    d = { ...d, tracks: d.tracks.map((t) => ({ ...t, segments: t.segments.map((s) => (s.id === made.segmentId ? { ...s, volume: 0.5 } : s)) })) }
    const music = resolveFrame(d, 1_000_000).audio.find((a) => a.path === 'song.wav')!
    expect(music.volume).toBeCloseTo(0.25, 9)
    expect(resolveFrame(d, 5_000_000).audio.find((a) => a.path === 'song.wav')!.volume).toBeCloseTo(0.5, 9)
    // Volume keyframes on the compound clip itself.
    d = setKeyframes(d, made.segmentId, { KFTypeVolume: 0 }, 4_000_000)
    d = setKeyframes(d, made.segmentId, { KFTypeVolume: 1 }, 6_000_000)
    expect(resolveFrame(d, 5_000_000).audio.find((a) => a.path === 'song.wav')!.volume).toBeCloseTo(0.5, 6)
    // Wrapped again: the outer compound clip's volume multiplies in as well.
    const twice = makeCompound(d, [made.segmentId])!
    const again = { ...twice.draft, tracks: twice.draft.tracks.map((t) => ({ ...t, segments: t.segments.map((s) => (s.id === twice.segmentId ? { ...s, volume: 0.5 } : s)) })) }
    expect(resolveFrame(again, 5_000_000).audio.find((a) => a.path === 'song.wav')!.volume).toBeCloseTo(0.25, 6)
  })
})
