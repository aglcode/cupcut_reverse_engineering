import { useRef, type ReactNode } from 'react'
import { isActive } from '../engine/resolve'
import {
  DEFAULT_BACKGROUND_BLUR,
  DEFAULT_BACKGROUND_COLOR,
  setBackground,
} from '../model/background'
import {
  ANIMATIONS,
  DEFAULT_ANIMATION_DURATION,
  effectiveAnimations,
  setAnimation,
} from '../model/animations'
import { CROP_RATIOS, cropInsets, cropRatioOf, isCropped, setCrop, setCropRatio, type CropRatio } from '../model/crop'
import { effectiveFade, setFade } from '../model/fades'
import { EASINGS, type EasingName } from '../model/easing'
import { isOneLink, linkedIds, linkSegments, unlinkSegments } from '../model/links'
import {
  easingAt,
  evalProperty,
  hasKeyframeAt,
  isAnimated,
  removeKeyframes,
  setEasing,
  setKeyframes,
  setValues,
} from '../model/keyframes'
import { BLEND_MODES, setBlend, type BlendName } from '../model/blend'
import { canBreakApart } from '../model/compound'
import { MASK_TYPES, maskKind, setMask, setMaskInvert, type MaskKind } from '../model/mask'
import {
  findMaterial,
  findSegment,
  MAX_SPEED,
  MIN_SPEED,
  extractAudio,
  freezeFrame,
  patchSegment,
  patchText,
  setCanvas,
  setReverse,
  setSpeed,
  setSpeedCurve,
} from '../model/ops'
import { MAX_CURVE_SPEED, MIN_CURVE_SPEED, SPEED_PRESETS } from '../model/speedCurve'
import { formatTimecode, snapToFrame, US_PER_SEC } from '../model/time'
import {
  DEFAULT_TRANSITION_DURATION,
  nextSegment,
  setTransition,
  TRANSITIONS,
} from '../model/transitions'
import type { Draft, KeyframeProperty, Segment, TransitionName } from '../model/types'
import { useEditor } from '../state/store'
import { SpeedCurveEditor } from './SpeedCurveEditor'
import { TextStyleFields } from './TextStyleFields'

const CANVAS_PRESETS = [
  { label: '16:9 · 1920×1080', width: 1920, height: 1080 },
  { label: '9:16 · 1080×1920', width: 1080, height: 1920 },
  { label: '1:1 · 1080×1080', width: 1080, height: 1080 },
  { label: '4:3 · 1440×1080', width: 1440, height: 1080 },
  { label: '16:9 · 3840×2160', width: 3840, height: 2160 },
]
const FPS_OPTIONS = [24, 25, 30, 50, 60]

type NumberFieldProps = {
  label: string
  value: number
  onCommit: (value: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  // Keyframe toggle shown beside the input.
  keyframe?: ReactNode
}

// Commits on blur or Enter so half-typed numbers never reach the draft. The
// key remounts the input when the value changes from outside (undo, drags).
function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  suffix,
  keyframe,
}: NumberFieldProps) {
  const shown = Number(value.toFixed(3))
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input
          key={shown}
          type="number"
          defaultValue={shown}
          step={step}
          min={min}
          max={max}
          onBlur={(e) => {
            const next = Number(e.target.value)
            const typed = e.target.value
            // Reset first: if the commit changes the value the input remounts
            // with it, and if it is rejected or clamped away the old one shows.
            e.target.value = String(shown)
            if (typed !== '' && Number.isFinite(next) && next !== shown) onCommit(next)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
        {keyframe}
      </span>
    </label>
  )
}

type KeyframeToggleProps = {
  segment: Segment
  properties: KeyframeProperty[]
  name: string
  playhead: number
}

// Diamond button: adds a keyframe for these properties at the playhead, or
// removes the one already there.
function KeyframeToggle({ segment, properties, name, playhead }: KeyframeToggleProps) {
  const fps = useEditor((s) => s.draft.fps)
  const onClip = isActive(segment, playhead)
  const here = onClip && properties.every((p) => hasKeyframeAt(segment, p, playhead, fps))
  const animated = properties.some((p) => isAnimated(segment, p))
  const action = `${here ? 'Remove' : 'Add'} ${name} keyframe at playhead`
  const toggle = () => {
    const { draft, commit } = useEditor.getState()
    if (here) {
      commit(removeKeyframes(draft, segment.id, properties, playhead))
    } else {
      const values = Object.fromEntries(
        properties.map((p) => [p, evalProperty(segment, p, playhead)]),
      )
      commit(setKeyframes(draft, segment.id, values, playhead))
    }
  }
  return (
    <button
      type="button"
      className={`keyframe-toggle${here ? ' here' : animated ? ' animated' : ''}`}
      aria-pressed={here}
      aria-label={action}
      title={onClip ? action : 'Move the playhead onto this clip to add a keyframe'}
      disabled={!onClip}
      onClick={(e) => {
        // Inside a <label>: stop the click from also focusing the input.
        e.preventDefault()
        toggle()
      }}
    >
      {here ? '◆' : '◇'}
    </button>
  )
}

function ProjectSettings({ draft }: { draft: Draft }) {
  const commit = useEditor((s) => s.commit)
  const { width, height } = draft.canvas_config
  const presetIndex = CANVAS_PRESETS.findIndex((p) => p.width === width && p.height === height)
  return (
    <>
      <h2>Project</h2>
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => useEditor.getState().preview({ ...draft, name: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Canvas</span>
        <select
          value={presetIndex}
          onChange={(e) => {
            const preset = CANVAS_PRESETS[Number(e.target.value)]
            if (preset) commit(setCanvas(draft, { width: preset.width, height: preset.height }))
          }}
        >
          {presetIndex < 0 && (
            <option value={-1}>
              {width}×{height}
            </option>
          )}
          {CANVAS_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Frame rate</span>
        <select
          value={draft.fps}
          onChange={(e) => commit(setCanvas(draft, { fps: Number(e.target.value) }))}
        >
          {!FPS_OPTIONS.includes(draft.fps) && <option value={draft.fps}>{draft.fps} fps</option>}
          {FPS_OPTIONS.map((fps) => (
            <option key={fps} value={fps}>
              {fps} fps
            </option>
          ))}
        </select>
      </label>
      <p className="hint">Select a clip on the timeline to edit it.</p>
    </>
  )
}

export function Inspector() {
  const draft = useEditor((s) => s.draft)
  const selectedId = useEditor((s) => s.selectedId)
  const selectedIds = useEditor((s) => s.selectedIds)
  const selectedCount = selectedIds.length
  const playhead = useEditor((s) => snapToFrame(s.playhead, s.draft.fps))
  const commit = useEditor((s) => s.commit)
  // Typing in the text box is one undo step per focus, not one per keystroke.
  const textCheckpointed = useRef(false)

  if (selectedCount > 1 && !isOneLink(draft, selectedIds)) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <h2>{selectedCount} clips selected</h2>
        <button type="button" onClick={() => useEditor.getState().deleteSelected()}>
          Delete {selectedCount} clips
        </button>
        <button type="button" onClick={() => commit(linkSegments(draft, selectedIds))}>
          Link {selectedCount} clips
        </button>
        <p className="hint">
          Drag any of them to move them together. Select a single clip to edit its settings.
        </p>
      </aside>
    )
  }

  const loc = selectedId ? findSegment(draft, selectedId) : null
  if (!loc) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <ProjectSettings draft={draft} />
      </aside>
    )
  }

  const { segment, track, index } = loc
  const material = findMaterial(draft, segment.material_id)
  // Values shown are the ones in effect at the playhead; editing an animated
  // property writes a keyframe there.
  const value = (p: KeyframeProperty) => evalProperty(segment, p, playhead)
  const set = (values: Partial<Record<KeyframeProperty, number>>) =>
    commit(setValues(draft, segment.id, values, playhead))
  const toggle = (name: string, ...properties: KeyframeProperty[]) => (
    <KeyframeToggle segment={segment} properties={properties} name={name} playhead={playhead} />
  )
  const fade = effectiveFade(segment)
  // A transition needs a clip directly after this one on the same track.
  const canTransition = track.type === 'video' && nextSegment(track, index) !== null
  const visual = material !== null && (material.type === 'video' || material.type === 'photo')
  const insets = visual ? cropInsets(material.crop) : null
  const crop = (edge: 'left' | 'top' | 'right' | 'bottom') => (v: number) =>
    commit(setCrop(draft, segment.id, { [edge]: v / 100 }))
  const canRetime =
    material !== null &&
    !segment.freeze &&
    (material.type === 'video' || material.type === 'audio')
  // A ramp from elsewhere (an imported draft) may have a name of its own.
  const rampName = !segment.curve_speed
    ? ''
    : SPEED_PRESETS.some((p) => p.name === segment.curve_speed?.name)
      ? segment.curve_speed.name
      : 'Custom'
  const isVideo = material !== null && material.type === 'video' && !segment.freeze
  const compound = material !== null && material.type === 'video' && !!material.compound
  const canExtract =
    isVideo && !compound && (segment.volume > 0 || isAnimated(segment, 'KFTypeVolume'))
  const extract = () => {
    const made = extractAudio(draft, segment.id)
    if (made) commit(made.draft)
  }
  const maskType = segment.mask ? maskKind(segment.mask) : null
  const animations = effectiveAnimations(segment)
  const linkedCount = linkedIds(draft, segment.id).length
  const onKeyframe = segment.common_keyframes.some((k) =>
    hasKeyframeAt(segment, k.property_type, playhead, draft.fps),
  )
  const easing = onKeyframe ? easingAt(segment, playhead, draft.fps) : null
  const freeze = () => {
    const made = freezeFrame(draft, segment.id, playhead)
    if (!made) return
    commit(made.draft)
    useEditor.getState().select(made.segmentId)
  }
  const hasSound =
    material !== null &&
    !segment.freeze &&
    (material.type === 'audio' || (material.type === 'video' && material.has_audio))

  return (
    <aside className="inspector" aria-label="Inspector">
      <h2>
        {track.type === 'text'
          ? 'Text'
          : track.type === 'audio'
            ? 'Audio clip'
            : track.type === 'adjust'
              ? 'Adjustment layer'
              : 'Video clip'}
      </h2>
      {track.type === 'adjust' && (
        <p className="hint">Changes the colour of everything beneath it while it lasts.</p>
      )}
      <p className="hint">
        {formatTimecode(segment.target_timerange.start, draft.fps)} –{' '}
        {formatTimecode(
          segment.target_timerange.start + segment.target_timerange.duration,
          draft.fps,
        )}
      </p>

      {material?.type === 'text' && (
        <>
          <label className="field field-stack">
            <span>Content</span>
            <textarea
              rows={3}
              value={material.content}
              onFocus={() => (textCheckpointed.current = false)}
              onChange={(e) => {
                const state = useEditor.getState()
                if (!textCheckpointed.current) {
                  state.checkpoint()
                  textCheckpointed.current = true
                }
                state.preview(patchText(state.draft, material.id, { content: e.target.value }))
              }}
            />
          </label>
          <NumberField
            label="Size"
            value={material.font_size}
            min={1}
            max={200}
            onCommit={(v) => commit(patchText(draft, material.id, { font_size: Math.max(1, v) }))}
          />
          <label className="field">
            <span>Colour</span>
            <input
              type="color"
              value={material.text_color}
              onChange={(e) => commit(patchText(draft, material.id, { text_color: e.target.value }))}
            />
          </label>
          <TextStyleFields material={material} NumberField={NumberField} />
        </>
      )}

      {canRetime && (
        <>
          <NumberField
            label={segment.curve_speed ? 'Average speed' : 'Speed'}
            value={segment.speed}
            step={0.1}
            min={MIN_SPEED}
            max={MAX_SPEED}
            suffix="×"
            onCommit={(v) => commit(setSpeed(draft, segment.id, v))}
          />
          <label className="field">
            <span>Speed ramp</span>
            <select
              value={rampName}
              onChange={(e) => {
                const name = e.target.value
                const preset = SPEED_PRESETS.find((p) => p.name === name)
                // A custom ramp starts flat at the clip's present speed.
                const flat = Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, segment.speed))
                const custom = {
                  name: 'Custom',
                  speed_points: [0, 0.5, 1].map((x) => ({ x, y: flat })),
                }
                commit(setSpeedCurve(draft, segment.id, name === '' ? null : (preset ?? custom)))
              }}
            >
              <option value="">None</option>
              {SPEED_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
              <option value="Custom">Custom</option>
            </select>
          </label>
          {segment.curve_speed && <SpeedCurveEditor segment={segment} />}
        </>
      )}
      {linkedCount > 1 && (
        <>
          <p className="hint">
            Linked with {linkedCount - 1} other clip{linkedCount === 2 ? '' : 's'}: they are
            selected, moved and deleted together. Alt-click selects one on its own.
          </p>
          <button type="button" onClick={() => commit(unlinkSegments(draft, [segment.id]))}>
            Unlink
          </button>
        </>
      )}
      {onKeyframe && (
        <>
          <label className="field">
            <span>Easing</span>
            <select
              value={easing ?? ''}
              disabled={easing === null}
              onChange={(e) =>
                commit(setEasing(draft, segment.id, playhead, e.target.value as EasingName))
              }
            >
              {easing === null && <option value="">No keyframe after this</option>}
              {easing === 'Mixed' && <option value="Mixed">Mixed</option>}
              {EASINGS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            How the motion from this keyframe to the next one starts and ends. Drag a keyframe on
            the clip to move it.
          </p>
        </>
      )}
      {segment.freeze && <p className="hint">Freeze frame: a still taken from the video.</p>}
      {isVideo && (
        <>
          <div className="checks" role="group" aria-label="Playback">
            <span>Playback</span>
            <label>
              <input
                type="checkbox"
                checked={segment.reverse}
                onChange={(e) => commit(setReverse(draft, segment.id, e.target.checked))}
              />
              Reverse
            </label>
          </div>
          <button
            type="button"
            disabled={!isActive(segment, playhead)}
            title={
              isActive(segment, playhead)
                ? 'Hold the frame under the playhead as a 3 second still'
                : 'Move the playhead onto this clip first'
            }
            onClick={freeze}
          >
            Freeze frame at playhead
          </button>
          {compound && (
            <>
              <button type="button" onClick={() => useEditor.getState().enterCompound(segment.id)}>
                Edit inside
              </button>
              <button
                type="button"
                disabled={!canBreakApart(draft, segment.id)}
                title={
                  canBreakApart(draft, segment.id)
                    ? 'Put the clips inside back on the timeline'
                    : 'A reversed, frozen or ramped compound clip cannot be broken apart'
                }
                onClick={() => useEditor.getState().breakApartSelected()}
              >
                Break apart
              </button>
            </>
          )}
          {material.has_audio && !compound && (
            <button
              type="button"
              disabled={!canExtract}
              title={
                canExtract
                  ? 'Move this clip\'s sound to its own audio clip, linked to it'
                  : 'This clip is already silent'
              }
              onClick={extract}
            >
              Extract audio
            </button>
          )}
        </>
      )}
      {hasSound && (
        <NumberField
          label="Volume"
          value={value('KFTypeVolume') * 100}
          min={0}
          max={400}
          suffix="%"
          keyframe={toggle('volume', 'KFTypeVolume')}
          onCommit={(v) => set({ KFTypeVolume: Math.max(0, v) / 100 })}
        />
      )}
      {hasSound && (
        <>
          <NumberField
            label="Fade in"
            value={fade.fade_in_duration / US_PER_SEC}
            step={0.1}
            min={0}
            suffix="s"
            onCommit={(v) =>
              commit(setFade(draft, segment.id, { fade_in_duration: v * US_PER_SEC }))
            }
          />
          <NumberField
            label="Fade out"
            value={fade.fade_out_duration / US_PER_SEC}
            step={0.1}
            min={0}
            suffix="s"
            onCommit={(v) =>
              commit(setFade(draft, segment.id, { fade_out_duration: v * US_PER_SEC }))
            }
          />
        </>
      )}

      {segment.clip && (
        <>
          <NumberField
            label="Scale"
            value={value('KFTypeScaleX') * 100}
            min={1}
            suffix="%"
            keyframe={toggle('scale', 'KFTypeScaleX', 'KFTypeScaleY')}
            onCommit={(v) => set({ KFTypeScaleX: v / 100, KFTypeScaleY: v / 100 })}
          />
          <NumberField
            label="Position X"
            value={value('KFTypePositionX')}
            step={0.05}
            keyframe={toggle('position', 'KFTypePositionX', 'KFTypePositionY')}
            onCommit={(v) => set({ KFTypePositionX: v })}
          />
          <NumberField
            label="Position Y"
            value={value('KFTypePositionY')}
            step={0.05}
            onCommit={(v) => set({ KFTypePositionY: v })}
          />
          <NumberField
            label="Rotation"
            value={value('KFTypeRotation')}
            suffix="°"
            keyframe={toggle('rotation', 'KFTypeRotation')}
            onCommit={(v) => set({ KFTypeRotation: v })}
          />
          <NumberField
            label="Opacity"
            value={value('KFTypeAlpha') * 100}
            min={0}
            max={100}
            suffix="%"
            keyframe={toggle('opacity', 'KFTypeAlpha')}
            onCommit={(v) => set({ KFTypeAlpha: Math.min(100, Math.max(0, v)) / 100 })}
          />
          {visual && (
            <label className="field">
              <span>Blend</span>
              <select
                value={segment.mix_mode ?? ''}
                onChange={(e) =>
                  commit(setBlend(draft, segment.id, (e.target.value || null) as BlendName | null))
                }
              >
                <option value="">Normal</option>
                {BLEND_MODES.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {visual && (
            <div className="checks" role="group" aria-label="Flip">
              <span>Flip</span>
              <label>
                <input
                  type="checkbox"
                  checked={segment.clip.flip.horizontal}
                  onChange={(e) =>
                    commit(
                      patchSegment(draft, segment.id, {
                        clip: { flip: { ...segment.clip!.flip, horizontal: e.target.checked } },
                      }),
                    )
                  }
                />
                Horizontal
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={segment.clip.flip.vertical}
                  onChange={(e) =>
                    commit(
                      patchSegment(draft, segment.id, {
                        clip: { flip: { ...segment.clip!.flip, vertical: e.target.checked } },
                      }),
                    )
                  }
                />
                Vertical
              </label>
            </div>
          )}
          <p className="hint">Position is in half-canvas units: 1 moves the centre to the edge.</p>
          <p className="hint">
            ◇ adds a keyframe at the playhead. Once a property has keyframes, changing its value
            sets a keyframe there.
          </p>
        </>
      )}

      {segment.clip && (
        <>
          <h2>Animation</h2>
          {(['in', 'out'] as const).map((type) => {
            const current = animations[type]
            return (
              <div key={type}>
                <label className="field">
                  <span>{type === 'in' ? 'In' : 'Out'}</span>
                  <select
                    value={current?.name ?? ''}
                    onChange={(e) =>
                      commit(
                        setAnimation(
                          draft,
                          segment.id,
                          type,
                          e.target.value
                            ? {
                                name: e.target.value,
                                duration: current?.duration ?? DEFAULT_ANIMATION_DURATION,
                              }
                            : null,
                        ),
                      )
                    }
                  >
                    <option value="">None</option>
                    {ANIMATIONS[type].map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                {current && (
                  <NumberField
                    label={type === 'in' ? 'In length' : 'Out length'}
                    value={current.duration / US_PER_SEC}
                    step={0.1}
                    min={0}
                    suffix="s"
                    onCommit={(v) =>
                      commit(
                        setAnimation(draft, segment.id, type, {
                          name: current.name,
                          duration: v * US_PER_SEC,
                        }),
                      )
                    }
                  />
                )}
              </div>
            )
          })}
          <p className="hint">Plays as the clip starts and as it ends, over whatever is beneath.</p>
        </>
      )}

      {canTransition && (
        <>
          <h2>Transition to next clip</h2>
          <label className="field">
            <span>Type</span>
            <select
              value={segment.transition?.name ?? ''}
              onChange={(e) => {
                const name = e.target.value as TransitionName | ''
                const duration = segment.transition?.duration ?? DEFAULT_TRANSITION_DURATION
                commit(setTransition(draft, segment.id, name ? { name, duration } : null))
              }}
            >
              <option value="">None</option>
              {TRANSITIONS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {segment.transition && (
            <NumberField
              label="Duration"
              value={segment.transition.duration / US_PER_SEC}
              step={0.1}
              min={0}
              suffix="s"
              onCommit={(v) =>
                commit(
                  setTransition(draft, segment.id, {
                    name: segment.transition!.name,
                    duration: v * US_PER_SEC,
                  }),
                )
              }
            />
          )}
          <p className="hint">
            Centred on the cut, and never longer than half of either clip. Sound still cuts at
            the cut.
          </p>
        </>
      )}

      {(visual || track.type === 'adjust') && (
        <>
          <h2>Colour</h2>
          <NumberField
            label="Brightness"
            value={value('KFTypeBrightness') * 100}
            min={-100}
            max={100}
            keyframe={toggle('brightness', 'KFTypeBrightness')}
            onCommit={(v) => set({ KFTypeBrightness: Math.min(100, Math.max(-100, v)) / 100 })}
          />
          <NumberField
            label="Contrast"
            value={value('KFTypeContrast') * 100}
            min={-100}
            max={100}
            keyframe={toggle('contrast', 'KFTypeContrast')}
            onCommit={(v) => set({ KFTypeContrast: Math.min(100, Math.max(-100, v)) / 100 })}
          />
          <NumberField
            label="Saturation"
            value={value('KFTypeSaturation') * 100}
            min={-100}
            max={100}
            keyframe={toggle('saturation', 'KFTypeSaturation')}
            onCommit={(v) => set({ KFTypeSaturation: Math.min(100, Math.max(-100, v)) / 100 })}
          />
          <p className="hint">From -100 to 100; 0 leaves the picture as it is.</p>
        </>
      )}

      {visual && (
        <>
          <h2>Mask</h2>
          <label className="field">
            <span>Shape</span>
            <select
              value={maskType ?? ''}
              onChange={(e) =>
                commit(setMask(draft, segment.id, (e.target.value || null) as MaskKind | null))
              }
            >
              <option value="">None</option>
              {MASK_TYPES.map((m) => (
                <option key={m.kind} value={m.kind}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          {segment.mask && (
            <>
              {(maskType === 'circle' || maskType === 'rectangle' || maskType === 'heart' || maskType === 'star') && (
                <NumberField
                  label="Width"
                  value={value('KFTypeCommonMaskSizeWidth') * 100}
                  min={0.1}
                  suffix="%"
                  keyframe={toggle('mask width', 'KFTypeCommonMaskSizeWidth')}
                  onCommit={(v) => set({ KFTypeCommonMaskSizeWidth: Math.max(0.1, v) / 100 })}
                />
              )}
              {maskType !== 'line' && (
                <NumberField
                  label={maskType === 'mirror' ? 'Thickness' : 'Height'}
                  value={value('KFTypeCommonMaskSizeHeight') * 100}
                  min={0.1}
                  suffix="%"
                  keyframe={toggle('mask height', 'KFTypeCommonMaskSizeHeight')}
                  onCommit={(v) => set({ KFTypeCommonMaskSizeHeight: Math.max(0.1, v) / 100 })}
                />
              )}
              <NumberField
                label="Centre X"
                value={value('KFTypeCommonMaskPositionX')}
                step={0.05}
                keyframe={toggle('mask position', 'KFTypeCommonMaskPositionX', 'KFTypeCommonMaskPositionY')}
                onCommit={(v) => set({ KFTypeCommonMaskPositionX: v })}
              />
              <NumberField
                label="Centre Y"
                value={value('KFTypeCommonMaskPositionY')}
                step={0.05}
                onCommit={(v) => set({ KFTypeCommonMaskPositionY: v })}
              />
              <NumberField
                label="Mask rotation"
                value={value('KFTypeCommonMaskRotation')}
                suffix="°"
                keyframe={toggle('mask rotation', 'KFTypeCommonMaskRotation')}
                onCommit={(v) => set({ KFTypeCommonMaskRotation: v })}
              />
              <NumberField
                label="Feather"
                value={value('KFTypeCommonMaskFeather') * 100}
                min={0}
                max={100}
                suffix="%"
                keyframe={toggle('mask feather', 'KFTypeCommonMaskFeather')}
                onCommit={(v) => set({ KFTypeCommonMaskFeather: Math.min(100, Math.max(0, v)) / 100 })}
              />
              {maskType === 'rectangle' && (
                <NumberField
                  label="Round corners"
                  value={value('KFTypeCommonMaskRoundCorner') * 100}
                  min={0}
                  max={100}
                  suffix="%"
                  keyframe={toggle('mask corners', 'KFTypeCommonMaskRoundCorner')}
                  onCommit={(v) =>
                    set({ KFTypeCommonMaskRoundCorner: Math.min(100, Math.max(0, v)) / 100 })
                  }
                />
              )}
              <div className="checks" role="group" aria-label="Mask options">
                <span>Show</span>
                <label>
                  <input
                    type="checkbox"
                    checked={segment.mask.config.invert}
                    onChange={(e) => commit(setMaskInvert(draft, segment.id, e.target.checked))}
                  />
                  Outside the shape
                </label>
              </div>
              <p className="hint">
                Sizes are a share of the picture's width and height. The centre is in half-picture
                units: 1 puts it on the edge.
              </p>
            </>
          )}
        </>
      )}

      {visual && (
        <>
          <h2>Frame background</h2>
          <label className="field">
            <span>Fill</span>
            <select
              value={segment.canvas?.type ?? ''}
              onChange={(e) => {
                const type = e.target.value
                commit(
                  setBackground(
                    draft,
                    segment.id,
                    type === 'canvas_color'
                      ? { type, color: DEFAULT_BACKGROUND_COLOR }
                      : type === 'canvas_blur'
                        ? { type, blur: DEFAULT_BACKGROUND_BLUR }
                        : null,
                  ),
                )
              }}
            >
              <option value="">None (black)</option>
              <option value="canvas_color">Colour</option>
              <option value="canvas_blur">Blurred picture</option>
            </select>
          </label>
          {segment.canvas?.type === 'canvas_color' && (
            <label className="field">
              <span>Colour</span>
              <input
                type="color"
                value={segment.canvas.color}
                onChange={(e) =>
                  commit(
                    setBackground(draft, segment.id, { type: 'canvas_color', color: e.target.value }),
                  )
                }
              />
            </label>
          )}
          {segment.canvas?.type === 'canvas_blur' && (
            <NumberField
              label="Blur"
              value={segment.canvas.blur * 100}
              min={0}
              max={100}
              suffix="%"
              onCommit={(v) =>
                commit(setBackground(draft, segment.id, { type: 'canvas_blur', blur: v / 100 }))
              }
            />
          )}
          <p className="hint">Fills the frame behind this clip where the picture does not reach.</p>
        </>
      )}

      {insets && visual && (
        <>
          <h2>Crop</h2>
          <label className="field">
            <span>Ratio</span>
            <select
              value={cropRatioOf(material)}
              onChange={(e) => commit(setCropRatio(draft, segment.id, e.target.value as CropRatio))}
            >
              {CROP_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r === 'free' ? 'Free' : r}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => useEditor.getState().setCropEditing(segment.id)}>
            Crop on the preview…
          </button>
          <NumberField label="Left" value={insets.left * 100} min={0} max={99} suffix="%" onCommit={crop('left')} />
          <NumberField label="Right" value={insets.right * 100} min={0} max={99} suffix="%" onCommit={crop('right')} />
          <NumberField label="Top" value={insets.top * 100} min={0} max={99} suffix="%" onCommit={crop('top')} />
          <NumberField label="Bottom" value={insets.bottom * 100} min={0} max={99} suffix="%" onCommit={crop('bottom')} />
          <button
            type="button"
            disabled={!isCropped(material.crop)}
            onClick={() => commit(setCrop(draft, segment.id, null))}
          >
            Reset crop
          </button>
          <p className="hint">How much to cut from each edge. The cropped picture refits the canvas.</p>
        </>
      )}
    </aside>
  )
}
