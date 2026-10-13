import { useRef, type ReactNode } from 'react'
import { isActive } from '../engine/resolve'
import {
  DEFAULT_BACKGROUND_BLUR,
  DEFAULT_BACKGROUND_COLOR,
  setBackground,
} from '../model/background'
import { cropInsets, isCropped, setCrop } from '../model/crop'
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
} from '../model/ops'
import { formatTimecode, snapToFrame, US_PER_SEC } from '../model/time'
import {
  DEFAULT_TRANSITION_DURATION,
  nextSegment,
  setTransition,
  TRANSITIONS,
} from '../model/transitions'
import type { Draft, KeyframeProperty, Segment, TransitionName } from '../model/types'
import { useEditor } from '../state/store'
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
  const isVideo = material !== null && material.type === 'video' && !segment.freeze
  const canExtract = isVideo && (segment.volume > 0 || isAnimated(segment, 'KFTypeVolume'))
  const extract = () => {
    const made = extractAudio(draft, segment.id)
    if (made) commit(made.draft)
  }
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
      <h2>{track.type === 'text' ? 'Text' : track.type === 'audio' ? 'Audio clip' : 'Video clip'}</h2>
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
        <NumberField
          label="Speed"
          value={segment.speed}
          step={0.1}
          min={MIN_SPEED}
          max={MAX_SPEED}
          suffix="×"
          onCommit={(v) => commit(setSpeed(draft, segment.id, v))}
        />
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
          {material.has_audio && (
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
