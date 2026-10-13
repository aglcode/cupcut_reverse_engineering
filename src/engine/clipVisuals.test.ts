import { describe, expect, it } from 'vitest'
import {
  computePeaks,
  peakBetween,
  PEAKS_PER_SEC,
  thumbnailBucket,
  thumbnailStep,
} from './clipVisuals'

describe('thumbnail grid', () => {
  it('is never finer than a quarter of a second', () => {
    expect(thumbnailStep(10_000)).toBe(250_000)
    expect(thumbnailStep(250_000)).toBe(250_000)
    expect(thumbnailStep(0)).toBe(250_000)
  })

  it('gets coarser in powers of two as tiles cover more time', () => {
    expect(thumbnailStep(300_000)).toBe(500_000)
    expect(thumbnailStep(900_000)).toBe(1_000_000)
    expect(thumbnailStep(1_000_000)).toBe(1_000_000)
    expect(thumbnailStep(5_000_000)).toBe(8_000_000)
  })

  it('snaps source times down onto the grid', () => {
    expect(thumbnailBucket(1_740_000, 500_000)).toBe(1_500_000)
    expect(thumbnailBucket(1_500_000, 500_000)).toBe(1_500_000)
    expect(thumbnailBucket(-30_000, 500_000)).toBe(0)
  })

  it('gives neighbouring tiles in one grid cell the same thumbnail', () => {
    const step = thumbnailStep(100_000)
    expect(thumbnailBucket(1_010_000, step)).toBe(thumbnailBucket(1_110_000, step))
  })
})

describe('waveform peaks', () => {
  // One second at 1000 Hz sample rate: 10 samples per peak.
  const ramp = Float32Array.from({ length: 1000 }, (_, i) => (i / 1000) * (i % 2 ? 1 : -1))

  it('keeps the loudest sample of each slice', () => {
    const peaks = computePeaks([ramp], 1000)
    expect(peaks).toHaveLength(PEAKS_PER_SEC)
    expect(peaks[0]).toBeCloseTo(0.009)
    expect(peaks[50]).toBeCloseTo(0.509)
    expect(peaks[99]).toBeCloseTo(0.999)
  })

  it('takes the louder of the channels', () => {
    const quiet = new Float32Array(1000).fill(0.1)
    const peaks = computePeaks([quiet, ramp], 1000)
    expect(peaks[0]).toBeCloseTo(0.1)
    expect(peaks[99]).toBeCloseTo(0.999)
  })

  it('handles silence and empty input', () => {
    expect([...computePeaks([new Float32Array(20)], 1000)]).toEqual([0, 0])
    expect(computePeaks([], 1000)).toHaveLength(0)
  })

  it('finds the loudest peak in a time range, in either direction', () => {
    const peaks = computePeaks([ramp], 1000)
    expect(peakBetween(peaks, 0, 500_000)).toBeCloseTo(0.509)
    // A reversed clip asks with the times the other way round.
    expect(peakBetween(peaks, 500_000, 0)).toBeCloseTo(0.509)
    expect(peakBetween(peaks, 900_000, 5_000_000)).toBeCloseTo(0.999)
    expect(peakBetween(peaks, 5_000_000, 6_000_000)).toBe(0)
  })
})
