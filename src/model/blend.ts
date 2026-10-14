// Blend modes: how a clip's picture combines with what is beneath it.
//
// CapCut keeps one as a materials.effects entry of type "mix_mode" that the
// clip references, named after the mode:
//   {"type":"mix_mode","name":"Screen","value":1,"effect_id":"871339",…}
// In the local drafts only "Screen" and "Overlay" appear, always with value 1
// and always on clips above the main track. The name is kept here, on the
// segment, as mix_mode; value is not used, since nothing shows what else it
// could be.
//
// The other names are those of CapCut's blend list, and each is drawn with the
// canvas compositing operation of the same name, the usual definitions of
// these modes. CapCut's "Linear Burn" has no canvas equivalent and is left out.

import type { Draft } from './types'

export const BLEND_MODES = [
  { name: 'Darken', operation: 'darken' },
  { name: 'Multiply', operation: 'multiply' },
  { name: 'Color Burn', operation: 'color-burn' },
  { name: 'Lighten', operation: 'lighten' },
  { name: 'Screen', operation: 'screen' },
  { name: 'Color Dodge', operation: 'color-dodge' },
  { name: 'Overlay', operation: 'overlay' },
  { name: 'Soft Light', operation: 'soft-light' },
  { name: 'Hard Light', operation: 'hard-light' },
] as const satisfies { name: string; operation: GlobalCompositeOperation }[]

export type BlendName = (typeof BLEND_MODES)[number]['name']

export const isBlendName = (name: unknown): name is BlendName =>
  BLEND_MODES.some((b) => b.name === name)

// The compositing operation that draws a clip with this blend.
export const blendOperation = (name: BlendName | null): GlobalCompositeOperation =>
  BLEND_MODES.find((b) => b.name === name)?.operation ?? 'source-over'

// Sets a picture clip's blend mode, or with null goes back to normal.
export function setBlend(draft: Draft, segmentId: string, name: BlendName | null): Draft {
  if (name !== null && !isBlendName(name)) return draft
  return {
    ...draft,
    tracks: draft.tracks.map((track) => ({
      ...track,
      segments: track.segments.map((s) =>
        s.id === segmentId && track.type === 'video' ? { ...s, mix_mode: name } : s,
      ),
    })),
  }
}
