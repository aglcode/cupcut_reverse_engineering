// Turns (draft, time) into the list of things on screen and audible at that
// instant. Preview and export both go through here, so they cannot disagree.

import { evalAdjust } from '../model/adjust'
import { animateClip } from '../model/animations'
import { fadeGain } from '../model/fades'
import { evalClip, evalVolume, isAnimated } from '../model/keyframes'
import { soundsInside } from '../model/compound'
import { isHidden, isMuted } from '../model/tracks'
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
  // Names this layer uniquely, also inside compound clips, where the same
  // clip can show twice: the segment id, after the ids of the compound clips
  // it is inside, joined by "/".
  key: string
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
  // For a compound clip: what its own timeline shows at this instant, and
  // that timeline's canvas size.
  nested: { frame: ResolvedFrame; width: number; height: number } | null
}

export type VisualLayer =
  | MediaLayer
  | { kind: 'text'; segment: Segment; clip: Clip; material: TextMaterial }
  // An adjustment layer: recolours everything drawn before it.
  | { kind: 'adjust'; segment: Segment; adjust: Adjust }

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

// `gain`, for a sound from inside a compound clip, is the compound clip's own
// volume and fades at timeline time t (and those of any compound clip around
// it), applied on top of the sound's own.
export type AudibleSegment = { segment: Segment; path: string; gain?: (t: number) => number }

// Every segment that carries sound: audio clips, and video clips with audio.
export function audibleSegments(draft: Draft): AudibleSegment[] {
  const out: AudibleSegment[] = []
  for (const track of draft.tracks) {
    if (track.type === 'text' || track.type === 'adjust' || isMuted(track)) continue
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
        if (m?.compound) {
          // The sound of a compound clip is that of the clips inside it.
          const inside = audibleSegments(m.compound)
          const src = segment.source_timerange
          const outer = segment
          // Inner timeline time at outer time t (only mapped while the speed is constant).
          const innerAt = (t: number) => (src ? src.start + (t - outer.target_timerange.start) * outer.speed : 0)
          for (const mapped of soundsInside(segment, inside.map((a) => a.segment))) {
            const from = inside.find((a) => mapped.id === `${segment.id}/${a.segment.id}`)
            if (!from) continue
            const deeper = from.gain
            const gain = (t: number) =>
              evalVolume(outer, t) * fadeGain(outer, t) * (deeper ? deeper(innerAt(t)) : 1)
            out.push({ segment: mapped, path: from.path, gain })
          }
        } else if (m && m.type === 'video' && m.has_audio) out.push({ segment, path: m.path })
      }
    }
  }
  return out
}

// `prefix` is the key path of the compound clip this timeline is inside.
export function resolveFrame(draft: Draft, t: number, prefix = ''): ResolvedFrame {
  const visual: VisualLayer[] = []
  // Track order is render order, bottom first.
  for (const track of draft.tracks) {
    if (track.type === 'audio' || isHidden(track)) continue
    if (track.type === 'adjust') {
      const segment = track.segments.find((s) => isActive(s, t))
      if (segment && segment.visible) visual.push({ kind: 'adjust', segment, adjust: evalAdjust(segment, t) })
      continue
    }
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
      const sourceUs = mediaSourceTime(segment, material, t)
      const key = prefix + segment.id
      const inner = material.compound
      visual.push({
        kind: 'media',
        key,
        segment,
        clip: animateClip(segment, evalClip(segment, t), t),
        adjust: evalAdjust(segment, t),
        mask: evalMask(segment, t),
        material,
        sourceUs,
        speed: speedAtTime(segment, t),
        span,
        fx,
        nested: inner
          ? {
              frame: resolveFrame(inner, sourceUs, key + '/'),
              width: inner.canvas_config.width,
              height: inner.canvas_config.height,
            }
          : null,
      })
    })
  }
  const audio = audibleSegments(draft)
    .filter(({ segment }) => isActive(segment, t))
    .map(({ segment, path, gain }) => ({
      segment,
      path,
      sourceUs: sourceTime(segment, t),
      speed: speedAtTime(segment, t),
      volume: evalVolume(segment, t) * fadeGain(segment, t) * (gain ? gain(t) : 1),
    }))
  return { visual, audio }
}

// Every picture clip in a frame, including those inside compound clips, each
// with the top-level layer it is drawn as part of. Compound clips themselves
// are left out: they have no media of their own.
export function mediaLayersOf(
  frame: ResolvedFrame,
  top?: MediaLayer,
): { layer: MediaLayer; top: MediaLayer }[] {
  const out: { layer: MediaLayer; top: MediaLayer }[] = []
  for (const layer of frame.visual) {
    if (layer.kind !== 'media') continue
    if (layer.nested) out.push(...mediaLayersOf(layer.nested.frame, top ?? layer))
    else out.push({ layer, top: top ?? layer })
  }
  return out
}
