import { describe, expect, it } from 'vitest'
import { addMedia, findSegment, setReverse, setSpeed, setSpeedCurve, splitSegment, trimSegment } from './ops'
import {
  averageSpeed,
  cleanPoints,
  progressAt,
  sliceCurve,
  SPEED_PRESETS,
  speedAt,
  timeAt,
} from './speedCurve'
import { sourceTimeAt, speedAtTime, timelineTimeAt } from './timing'
import { emptyDraft, segmentEnd, type Draft, type SpeedCurve, type VideoMaterial } from './types'

const hero = SPEED_PRESETS.find((p) => p.name === 'Hero')!
const bullet = SPEED_PRESETS.find((p) => p.name === 'Bullet')!

describe('speed curve maths', () => {
  // Stored speeds of real CapCut clips whose timeline length had not been
  // rounded away from the ramp's own average.
  it('gives the average speed CapCut stores', () => {
    expect(averageSpeed(hero.speed_points)).toBeCloseTo(2.07447, 5)
    expect(
      averageSpeed([
        { x: 0, y: 5.2 },
        { x: 0.5, y: 1.025 },
        { x: 1, y: 5.2 },
      ]),
    ).toBeCloseTo(3.1125, 6)
    // Two points at one x are a jump in speed and take no time.
    expect(
      averageSpeed([
        { x: 0, y: 5.2 },
        { x: 0.5, y: 1.015 },
        { x: 0.5, y: 1.0075 },
        { x: 1, y: 5.2 },
      ]),
    ).toBeCloseTo(3.10562, 5)
  })

  it('a flat curve is plain constant speed', () => {
    const flat = [
      { x: 0, y: 2 },
      { x: 1, y: 2 },
    ]
    expect(averageSpeed(flat)).toBe(2)
    expect(progressAt(flat, 0.25)).toBeCloseTo(0.25, 12)
    expect(speedAt(flat, 0.7)).toBe(2)
  })

  it('runs from the start of the source to its end', () => {
    for (const { speed_points: points } of SPEED_PRESETS) {
      expect(progressAt(points, 0)).toBe(0)
      expect(progressAt(points, 1)).toBeCloseTo(1, 12)
    }
  })

  it('never runs backwards, and moves fastest where the curve is highest', () => {
    let last = -1
    for (let i = 0; i <= 1000; i++) {
      const p = progressAt(hero.speed_points, i / 1000)
      expect(p).toBeGreaterThan(last)
      last = p
    }
    // Hero is slowest in the middle of its source.
    const rate = (u: number) => (progressAt(hero.speed_points, u + 1e-4) - progressAt(hero.speed_points, u)) / 1e-4
    const middle = timeAt(hero.speed_points, 0.5)
    expect(rate(middle)).toBeLessThan(rate(timeAt(hero.speed_points, 0.35)) / 5)
  })

  it('the rate of progress is the curve speed over the average', () => {
    const points = hero.speed_points
    for (const u of [0.05, 0.2, 0.41, 0.6, 0.83, 0.97]) {
      const rate = (progressAt(points, u + 1e-6) - progressAt(points, u - 1e-6)) / 2e-6
      expect(rate).toBeCloseTo(speedAt(points, u) / averageSpeed(points), 4)
    }
  })

  it('timeAt undoes progressAt, inside the clip and beyond its ends', () => {
    for (const { speed_points: points } of SPEED_PRESETS) {
      for (const u of [-0.3, 0, 0.1, 0.33, 0.5, 0.77, 1, 1.4]) {
        expect(timeAt(points, progressAt(points, u))).toBeCloseTo(u, 9)
      }
    }
  })

  it('carries on at the end speeds outside the clip', () => {
    const points = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
    ]
    // Average is 2, so one clip length at speed 3 covers 1.5 sources.
    expect(progressAt(points, 2)).toBeCloseTo(1 + 3 / 2, 12)
    expect(progressAt(points, -1)).toBeCloseTo(-1 / 2, 12)
  })

  it('a slice plays its part of the source exactly as the whole did', () => {
    const points = hero.speed_points
    const from = 0.2
    const to = 0.6
    const part = sliceCurve(points, from, to)
    expect(part[0].x).toBe(0)
    expect(part[part.length - 1].x).toBe(1)
    const t0 = timeAt(points, from)
    const t1 = timeAt(points, to)
    for (const u of [0, 0.13, 0.4, 0.5, 0.71, 0.9, 1]) {
      const whole = progressAt(points, t0 + (t1 - t0) * u)
      expect(from + (to - from) * progressAt(part, u)).toBeCloseTo(whole, 9)
    }
  })

  it('a slice past the ends holds the end speed, without piling up points', () => {
    const points = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
    ]
    const longer = sliceCurve(points, 0, 1.5)
    expect(longer.map((p) => p.y)).toEqual([1, 3, 3])
    expect(longer[1].x).toBeCloseTo(1 / 1.5, 12)
    // Lengthened again, the flat run is still one run.
    expect(sliceCurve(longer, 0, 1.5)).toHaveLength(3)
  })

  it('cleans up points from outside', () => {
    expect(cleanPoints([{ x: 0.5, y: 2 }])).toBeNull()
    expect(
      cleanPoints([
        { x: 0.9, y: 50 },
        { x: 0.2, y: 0.001 },
        { x: 0.5, y: NaN },
      ]),
    ).toEqual([
      { x: 0, y: 0.1 },
      { x: 1, y: 10 },
    ])
  })
})

const video: VideoMaterial = {
  id: 'v',
  type: 'video',
  path: 'a.mp4',
  duration: 60_000_000,
  width: 1920,
  height: 1080,
  has_audio: true,
  crop: {
    upper_left_x: 0,
    upper_left_y: 0,
    upper_right_x: 1,
    upper_right_y: 0,
    lower_left_x: 0,
    lower_left_y: 1,
    lower_right_x: 1,
    lower_right_y: 1,
  },
}

// A 10 s clip of source 20 s to 30 s, from 25 s to 35 s on the timeline.
function project(): { draft: Draft; id: string } {
  const added = addMedia(emptyDraft(), video, 5_000_000)
  let draft = trimSegment(added.draft, added.segmentId, 'end', 35_000_000)
  draft = trimSegment(draft, added.segmentId, 'start', 25_000_000)
  draft = trimSegment(draft, added.segmentId, 'end', 35_000_000)
  const s = findSegment(draft, added.segmentId)!.segment
  expect(s.source_timerange).toEqual({ start: 20_000_000, duration: 10_000_000 })
  return { draft, id: added.segmentId }
}
const seg = (draft: Draft, id: string) => findSegment(draft, id)!.segment
const rampUp: SpeedCurve = {
  name: 'Custom',
  speed_points: [
    { x: 0, y: 1 },
    { x: 1, y: 3 },
  ],
}

describe('speed ramps on clips', () => {
  it('keeps the source range and resizes the clip to the ramp', () => {
    const { draft, id } = project()
    const ramped = setSpeedCurve(draft, id, rampUp)
    const s = seg(ramped, id)
    expect(s.source_timerange).toEqual({ start: 20_000_000, duration: 10_000_000 })
    // Average of a steady 1x to 3x ramp is 2x.
    expect(s.target_timerange.duration).toBe(5_000_000)
    expect(s.speed).toBeCloseTo(2, 9)
    expect(sourceTimeAt(s, s.target_timerange.start)).toBe(20_000_000)
    expect(sourceTimeAt(s, segmentEnd(s))).toBeCloseTo(30_000_000, 3)
    // Half-way through its time it has covered 1.5 of 4 "speed-seconds".
    expect(sourceTimeAt(s, s.target_timerange.start + 2_500_000)).toBeCloseTo(23_750_000, 3)
    expect(speedAtTime(s, s.target_timerange.start)).toBeCloseTo(1, 9)
    expect(speedAtTime(s, segmentEnd(s))).toBeCloseTo(3, 9)
  })

  it('keeps speed equal to source over timeline length on an awkward ramp', () => {
    const { draft, id } = project()
    const s = seg(setSpeedCurve(draft, id, hero), id)
    expect(s.speed).toBe(s.source_timerange!.duration / s.target_timerange.duration)
    expect(averageSpeed(s.curve_speed!.speed_points)).toBeCloseTo(s.speed, 9)
    expect(sourceTimeAt(s, segmentEnd(s))).toBeCloseTo(30_000_000, 3)
  })

  it('maps source time back to the timeline, as keyframes need', () => {
    const { draft, id } = project()
    const s = seg(setSpeedCurve(draft, id, hero), id)
    for (const t of [s.target_timerange.start + 100_000, s.target_timerange.start + 2_000_000, segmentEnd(s) - 1]) {
      expect(timelineTimeAt(s, sourceTimeAt(s, t))).toBeCloseTo(t, 3)
    }
  })

  it('a reversed ramp runs the source backwards at the same speeds', () => {
    const { draft, id } = project()
    const s = seg(setReverse(setSpeedCurve(draft, id, rampUp), id, true), id)
    const { start } = s.target_timerange
    expect(sourceTimeAt(s, start)).toBe(30_000_000)
    expect(sourceTimeAt(s, start + 2_500_000)).toBeCloseTo(30_000_000 - 3_750_000, 3)
    expect(timelineTimeAt(s, 26_250_000)).toBeCloseTo(start + 2_500_000, 3)
  })

  it('trimming keeps every remaining frame where it was', () => {
    const { draft, id } = project()
    const before = seg(setSpeedCurve(draft, id, hero), id)
    const { start } = before.target_timerange
    const cutStart = start + 1_000_000
    const cutEnd = segmentEnd(before) - 1_000_000
    let trimmed = trimSegment(setSpeedCurve(draft, id, hero), id, 'start', cutStart)
    trimmed = trimSegment(trimmed, id, 'end', cutEnd)
    const after = seg(trimmed, id)
    expect(after.target_timerange).toEqual({ start: cutStart, duration: cutEnd - cutStart })
    for (let t = cutStart; t <= cutEnd; t += 100_000) {
      // Within a microsecond or two: the source range is whole microseconds.
      expect(Math.abs(sourceTimeAt(after, t) - sourceTimeAt(before, t))).toBeLessThan(3)
    }
    expect(after.speed).toBe(after.source_timerange!.duration / after.target_timerange.duration)
  })

  it('trimming outwards adds source at the speed of that edge', () => {
    const { draft, id } = project()
    const ramped = setSpeedCurve(draft, id, rampUp)
    const before = seg(ramped, id)
    const end = segmentEnd(before)
    const after = seg(trimSegment(ramped, id, 'end', end + 1_000_000), id)
    // One more second at 3x is three more seconds of source.
    expect(after.source_timerange!.duration).toBeCloseTo(13_000_000, -1)
    expect(sourceTimeAt(after, end)).toBeCloseTo(30_000_000, -1)
    expect(speedAtTime(after, end + 500_000)).toBeCloseTo(3, 4)
  })

  it('cannot be trimmed out past the end of the media', () => {
    const added = addMedia(emptyDraft(), { ...video, duration: 10_000_000 }, 0)
    const ramped = setSpeedCurve(added.draft, added.segmentId, rampUp)
    const pulled = trimSegment(ramped, added.segmentId, 'end', 60_000_000)
    expect(pulled).toBe(ramped)
  })

  it('splitting gives each half its part of the ramp', () => {
    const { draft, id } = project()
    const ramped = setSpeedCurve(draft, id, hero)
    const whole = seg(ramped, id)
    const at = whole.target_timerange.start + 2_000_000
    const split = splitSegment(ramped, id, at)
    const [left, right] = split.tracks.find((t) => t.type === 'video')!.segments
    expect(left.source_timerange!.start + left.source_timerange!.duration).toBe(right.source_timerange!.start)
    expect(left.source_timerange!.duration + right.source_timerange!.duration).toBe(10_000_000)
    for (const [half, from, to] of [
      [left, whole.target_timerange.start, at],
      [right, at, segmentEnd(whole)],
    ] as const) {
      for (let t = from; t <= to; t += 100_000) {
        expect(Math.abs(sourceTimeAt(half, t) - sourceTimeAt(whole, t))).toBeLessThan(3)
      }
    }
  })

  it('is cut short where the next clip is in the way', () => {
    const { draft, id } = project()
    // A second clip one second after the first ends.
    const second = addMedia(draft, video, 36_000_000)
    expect(second.draft.tracks.find((t) => t.type === 'video')!.segments).toHaveLength(2)
    const slow: SpeedCurve = { name: 'Custom', speed_points: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] }
    const ramped = setSpeedCurve(second.draft, id, slow)
    const s = seg(ramped, id)
    expect(segmentEnd(s)).toBe(36_000_000)
    // 11 s at half speed is 5.5 s of source.
    expect(s.source_timerange).toEqual({ start: 20_000_000, duration: 5_500_000 })
  })

  it('a constant speed replaces the ramp, and removing a ramp leaves the average', () => {
    const { draft, id } = project()
    const ramped = setSpeedCurve(draft, id, rampUp)
    expect(seg(setSpeed(ramped, id, 1), id).curve_speed).toBeNull()
    const plain = seg(setSpeedCurve(ramped, id, null), id)
    expect(plain.curve_speed).toBeNull()
    expect(plain.speed).toBeCloseTo(2, 9)
    expect(plain.target_timerange).toEqual(seg(ramped, id).target_timerange)
  })

  it('refuses a photo, and points that are not a curve', () => {
    const photo = addMedia(emptyDraft(), { ...video, type: 'photo', duration: 0 }, 0)
    expect(setSpeedCurve(photo.draft, photo.segmentId, rampUp)).toBe(photo.draft)
    const { draft, id } = project()
    expect(setSpeedCurve(draft, id, { name: 'Custom', speed_points: [{ x: 0, y: 1 }] })).toBe(draft)
  })

  it('the Bullet preset is unchanged from CapCut', () => {
    expect(averageSpeed(bullet.speed_points)).toBeCloseTo(2.8095, 3)
  })
})
