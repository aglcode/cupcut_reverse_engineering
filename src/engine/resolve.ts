// Turns (draft, time) into the list of things on screen and audible at that
// instant. Preview and export both go through here, so they cannot disagree.

import { evalAdjust } from '../model/adjust'
import { animateClip } from '../model/animations'
import { fadeGain } from '../model/fades'
import { evalClip, evalVolume, isAnimated } from '../model/keyframes'
import { evalMask } from '../model/mask'
import { sourceTimeAt, speedAtTime } from '../model/timing'
import {
  effectiveTransition,
  transitionFx,
  visibleSpan,
  type LayerFx,
} from '../model/transitions'
import {
  segmentEnd,
  type Adjust,
  type Clip,
  type Draft,
  type Mask,
  type Segment,
  type TextMaterial,
  type VideoMaterial,
} from '../model/types'

export type MediaLayer = {
  kind: 'media'
  segment: Segment
  clip: Clip
  adjust: Adjust
  mask: Mask | null
  material: VideoMaterial
  sourceUs: number
  // How fast the source is playing at this instant.
  speed: number
  // Timeline range the clip is on screen for, transitions included.
  span: { from: number; to: number }
  // Set while a transition is running.
  fx: LayerFx | null
}

export type VisualLayer =
  | MediaLayer
  | { kind: 'text'; segment: Segment; clip: Clip; material: TextMaterial }

export type AudioLayer = {
  segment: Segment
  path: string
  sourceUs: number
  speed: number
  volume: number
}

export type ResolvedFrame = { visual: VisualLayer[]; audio: AudioLayer[] }

export const isActive = (s: Segment, t: number): boolean =>
  s.target_timerange.start <= t && t < segmentEnd(s)

// Position inside the source media for timeline time `t`.
export const sourceTime = (s: Segment, t: number): number => Math.round(sourceTimeAt(s, t))

// Source position of a video clip at `t`. During a transition a clip plays a
// little before its in-point or after its out-point; where the media runs out
// it holds its first or last frame.
export function mediaSourceTime(s: Segment, material: VideoMaterial, t: number): number {
  return Math.min(Math.max(0, sourceTime(s, t)), Math.max(0, material.duration - 1))
}

export type AudibleSegment = { segment: Segment; path: string }

// Every segment that carries sound: audio clips, and video clips with audio.
export function audibleSegments(draft: Draft): AudibleSegment[] {
  const out: AudibleSegment[] = []
  for (const track of draft.tracks) {
    if (track.type === 'text') continue
    for (const segment of track.segments) {
      // A freeze frame is a still picture and has no sound.
      if (segment.freeze) continue
      // A silent clip is skipped unless keyframes can raise its volume.
      if (segment.volume <= 0 && !isAnimated(segment, 'KFTypeVolume')) continue
      if (track.type === 'audio') {
        const m = draft.materials.audios.find((a) => a.id === segment.material_id)
        if (m) out.push({ segment, path: m.path })
      } else {
        const m = draft.materials.videos.find((v) => v.id === segment.material_id)
        if (m && m.type === 'video' && m.has_audio) out.push({ segment, path: m.path })
      }
    }
  }
  return out
}

export function resolveFrame(draft: Draft, t: number): ResolvedFrame {
  const visual: VisualLayer[] = []
  // Track order is render order, bottom first.
  for (const track of draft.tracks) {
    if (track.type === 'audio') continue
    if (track.type === 'text') {
      const segment = track.segments.find((s) => isActive(s, t))
      if (!segment || !segment.visible) continue
      const material = draft.materials.texts.find((m) => m.id === segment.material_id)
      if (material) {
        const clip = animateClip(segment, evalClip(segment, t), t)
        visual.push({ kind: 'text', segment, clip, material })
      }
      continue
    }
    // Two clips are on screen at once during a transition. Segments are in
    // timeline order, so the outgoing clip is pushed, and drawn, first.
    track.segments.forEach((segment, index) => {
      const span = visibleSpan(track, index)
      if (t < span.from || t >= span.to || !segment.visible) return
      const material = draft.materials.videos.find((m) => m.id === segment.material_id)
      if (!material) return
      const incoming = index > 0 ? effectiveTransition(track, index - 1) : null
      const outgoing = effectiveTransition(track, index)
      const progress = (tr: { from: number; to: number }) => (t - tr.from) / (tr.to - tr.from)
      let fx: LayerFx | null = null
      if (incoming && t < incoming.to) fx = transitionFx(incoming.name, 'in', progress(incoming))
      else if (outgoing && t >= outgoing.from) fx = transitionFx(outgoing.name, 'out', progress(outgoing))
      visual.push({
        kind: 'media',
        segment,
        clip: animateClip(segment, evalClip(segment, t), t),
        adjust: evalAdjust(segment, t),
        mask: evalMask(segment, t),
        material,
        sourceUs: mediaSourceTime(segment, material, t),
        speed: speedAtTime(segment, t),
        span,
        fx,
      })
    })
  }
  const audio = audibleSegments(draft)
    .filter(({ segment }) => isActive(segment, t))
    .map(({ segment, path }) => ({
      segment,
      path,
      sourceUs: sourceTime(segment, t),
      speed: speedAtTime(segment, t),
      volume: evalVolume(segment, t) * fadeGain(segment, t),
    }))
  return { visual, audio }
}
