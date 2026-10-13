export const US_PER_SEC = 1_000_000

// Frame n starts at floor(n / fps) in microseconds. This matches CapCut drafts,
// where 5 frames at 30 fps is stored as 166666 and 23 frames as 766666.
export const frameToUs = (frame: number, fps: number): number =>
  Math.floor((frame * US_PER_SEC) / fps)

export const usToFrame = (us: number, fps: number): number =>
  Math.round((us * fps) / US_PER_SEC)

export const snapToFrame = (us: number, fps: number): number =>
  frameToUs(Math.max(0, usToFrame(us, fps)), fps)

export const frameDuration = (fps: number): number => frameToUs(1, fps)

export const frameCount = (durationUs: number, fps: number): number =>
  Math.max(0, usToFrame(durationUs, fps))

export function formatTimecode(us: number, fps: number): string {
  const frame = usToFrame(Math.max(0, us), fps)
  const perSec = Math.round(fps)
  const totalSec = Math.floor(frame / perSec)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}:${pad(frame % perSec)}`
}
