// Draws a text clip. Called with the clip's transform already applied, so
// everything here is in the text's own space, centred on the origin.

import { ALIGN_LEFT, ALIGN_RIGHT, rgba } from '../model/textStyle'
import type { Clip, TextMaterial } from '../model/types'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// CapCut's font_size and style units are not documented. These constants are
// this editor's definitions: size 15 is about 5.5% of the frame height, text
// wraps at 82% of the width, and the style numbers scale with the font size.
const PX_PER_SIZE_AT_1080 = 4
const MAX_WIDTH = 0.82
const BASE_LINE_HEIGHT = 1.18 // plus line_spacing; 1.2 at CapCut's default 0.02
const SHADOW_DISTANCE_EM = 0.02 // per unit of shadow_distance: 5 is 0.1 em
const SHADOW_BLUR_EM = 0.3 // per unit of shadow_smoothing
const BACKGROUND_PADDING_EM = 0.25
const UNDERLINE_OFFSET_EM = 0.46
const UNDERLINE_THICKNESS_EM = 0.06

function wrapLines(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

// Canvas shadows ignore the current transform, so the offset and blur are
// worked out in canvas space from the clip's scale, flip and rotation.
function applyShadow(ctx: Ctx, m: TextMaterial, clip: Clip, px: number) {
  const distance = m.shadow_distance * SHADOW_DISTANCE_EM * px
  const angle = (m.shadow_angle * Math.PI) / 180
  // shadow_angle is measured anticlockwise with y up: -45 is down and right.
  const lx = Math.cos(angle) * distance * clip.scale.x * (clip.flip.horizontal ? -1 : 1)
  const ly = -Math.sin(angle) * distance * clip.scale.y * (clip.flip.vertical ? -1 : 1)
  const r = (clip.rotation * Math.PI) / 180
  ctx.shadowOffsetX = lx * Math.cos(r) - ly * Math.sin(r)
  ctx.shadowOffsetY = lx * Math.sin(r) + ly * Math.cos(r)
  ctx.shadowBlur = m.shadow_smoothing * SHADOW_BLUR_EM * px * Math.abs(clip.scale.x)
  ctx.shadowColor = rgba(m.shadow_color || '#000000', m.shadow_alpha)
}

function clearShadow(ctx: Ctx) {
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

export function drawText(ctx: Ctx, m: TextMaterial, clip: Clip, width: number, height: number) {
  const px = m.font_size * PX_PER_SIZE_AT_1080 * (height / 1080)
  ctx.font = `${m.italic ? 'italic ' : ''}${m.bold ? 700 : 400} ${px}px ${m.font_family}`
  const gap = m.letter_spacing * px
  ctx.letterSpacing = `${gap}px`
  ctx.textBaseline = 'middle'

  // The wrap width is in canvas space, so it shrinks as the text is scaled up.
  const maxWidth = (width * MAX_WIDTH) / Math.max(0.01, Math.abs(clip.scale.x))
  const lines = wrapLines(ctx, m.content, maxWidth)
  // The canvas adds the letter gap after the last letter too. It is taken off
  // the measured width here and compensated for when anchoring, so spaced-out
  // text stays centred.
  const widths = lines.map((line) => Math.max(0, ctx.measureText(line).width - (line ? gap : 0)))
  const blockWidth = Math.max(0, ...widths)
  const lineHeight = px * (BASE_LINE_HEIGHT + m.line_spacing)
  const blockHeight = lines.length * lineHeight
  const top = (-(lines.length - 1) * lineHeight) / 2

  if (m.background_color) {
    const pad = BACKGROUND_PADDING_EM * px
    const w = blockWidth + pad * 2
    const h = blockHeight + pad * 2
    const radius = Math.min(1, Math.max(0, m.background_round_radius)) * (Math.min(w, h) / 2)
    ctx.save()
    ctx.globalAlpha *= Math.min(1, Math.max(0, m.background_alpha))
    ctx.fillStyle = m.background_color
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, radius)
    ctx.fill()
    ctx.restore()
  }

  // Lines are aligned inside the block; the block itself stays centred on the
  // clip's position.
  let anchor = gap / 2
  ctx.textAlign = 'center'
  if (m.alignment === ALIGN_LEFT) {
    anchor = -blockWidth / 2
    ctx.textAlign = 'left'
  } else if (m.alignment === ALIGN_RIGHT) {
    anchor = blockWidth / 2 + gap
    ctx.textAlign = 'right'
  }

  const outlined = m.border_color !== '' && m.border_width > 0
  lines.forEach((line, i) => {
    const y = top + i * lineHeight
    // The shadow is cast once, by whatever forms the outer edge of the glyphs.
    if (m.has_shadow) applyShadow(ctx, m, clip, px)
    if (outlined) {
      // Stroked at double width underneath the fill, so the visible outline
      // sits outside the letters and is border_width wide.
      ctx.lineJoin = 'round'
      ctx.lineWidth = m.border_width * px * 2
      ctx.strokeStyle = m.border_color
      ctx.strokeText(line, anchor, y)
      clearShadow(ctx)
    }
    ctx.fillStyle = m.text_color
    ctx.fillText(line, anchor, y)
    if (m.underline) {
      const left =
        m.alignment === ALIGN_LEFT
          ? -blockWidth / 2
          : m.alignment === ALIGN_RIGHT
            ? blockWidth / 2 - widths[i]
            : -widths[i] / 2
      ctx.fillRect(left, y + UNDERLINE_OFFSET_EM * px, widths[i], UNDERLINE_THICKNESS_EM * px)
    }
    clearShadow(ctx)
  })
}
