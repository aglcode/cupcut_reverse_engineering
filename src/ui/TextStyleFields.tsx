import type { ReactNode } from 'react'
import { patchText } from '../model/ops'
import { ALIGN_CENTER, ALIGN_LEFT, ALIGN_RIGHT, FONT_FAMILIES } from '../model/textStyle'
import type { TextMaterial, TextStyle } from '../model/types'
import { useEditor } from '../state/store'

type NumberInputProps = {
  label: string
  value: number
  onCommit: (value: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
}

type Props = {
  material: TextMaterial
  // The inspector's number input, passed in so both use the same control.
  NumberField: (props: NumberInputProps) => ReactNode
}

// Colours used when a style is first switched on.
const DEFAULT_OUTLINE = '#000000'
const DEFAULT_SHADOW = '#000000'
const DEFAULT_BACKGROUND = '#000000'

export function TextStyleFields({ material, NumberField }: Props) {
  const set = (patch: Partial<TextStyle>) => {
    const { draft, commit } = useEditor.getState()
    commit(patchText(draft, material.id, patch))
  }
  const check = (label: string, checked: boolean, onChange: (on: boolean) => void) => (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
  const colour = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="field">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
  const percent = (v: number) => Math.min(100, Math.max(0, v)) / 100

  const outlined = material.border_color !== ''
  const boxed = material.background_color !== ''
  const knownFont = FONT_FAMILIES.some((f) => f.value === material.font_family)

  return (
    <>
      <label className="field">
        <span>Font</span>
        <select value={material.font_family} onChange={(e) => set({ font_family: e.target.value })}>
          {!knownFont && <option value={material.font_family}>{material.font_family}</option>}
          {FONT_FAMILIES.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div className="checks" role="group" aria-label="Style">
        <span>Style</span>
        {check('Bold', material.bold, (bold) => set({ bold }))}
        {check('Italic', material.italic, (italic) => set({ italic }))}
        {check('Underline', material.underline, (underline) => set({ underline }))}
      </div>
      <label className="field">
        <span>Align</span>
        <select
          value={material.alignment}
          onChange={(e) => set({ alignment: Number(e.target.value) })}
        >
          <option value={ALIGN_LEFT}>Left</option>
          <option value={ALIGN_CENTER}>Centre</option>
          <option value={ALIGN_RIGHT}>Right</option>
        </select>
      </label>
      <NumberField
        label="Letter gap"
        value={material.letter_spacing * 100}
        min={-20}
        max={200}
        suffix="%"
        onCommit={(v) => set({ letter_spacing: Math.min(200, Math.max(-20, v)) / 100 })}
      />
      <NumberField
        label="Line gap"
        value={material.line_spacing * 100}
        min={-50}
        max={300}
        suffix="%"
        onCommit={(v) => set({ line_spacing: Math.min(300, Math.max(-50, v)) / 100 })}
      />

      <div className="checks" role="group" aria-label="Outline">
        <span>Outline</span>
        {check('On', outlined, (on) => set({ border_color: on ? DEFAULT_OUTLINE : '' }))}
      </div>
      {outlined && (
        <>
          {colour('Colour', material.border_color, (border_color) => set({ border_color }))}
          <NumberField
            label="Width"
            value={material.border_width * 100}
            min={1}
            max={50}
            suffix="%"
            onCommit={(v) => set({ border_width: Math.min(50, Math.max(1, v)) / 100 })}
          />
        </>
      )}

      <div className="checks" role="group" aria-label="Shadow">
        <span>Shadow</span>
        {check('On', material.has_shadow, (has_shadow) =>
          set({ has_shadow, shadow_color: material.shadow_color || DEFAULT_SHADOW }),
        )}
      </div>
      {material.has_shadow && (
        <>
          {colour('Colour', material.shadow_color || DEFAULT_SHADOW, (shadow_color) =>
            set({ shadow_color }),
          )}
          <NumberField
            label="Opacity"
            value={material.shadow_alpha * 100}
            min={0}
            max={100}
            suffix="%"
            onCommit={(v) => set({ shadow_alpha: percent(v) })}
          />
          <NumberField
            label="Blur"
            value={material.shadow_smoothing * 100}
            min={0}
            max={100}
            suffix="%"
            onCommit={(v) => set({ shadow_smoothing: percent(v) })}
          />
          <NumberField
            label="Distance"
            value={material.shadow_distance}
            min={0}
            max={100}
            onCommit={(v) => set({ shadow_distance: Math.min(100, Math.max(0, v)) })}
          />
          <NumberField
            label="Angle"
            value={material.shadow_angle}
            min={-180}
            max={180}
            suffix="°"
            onCommit={(v) => set({ shadow_angle: Math.min(180, Math.max(-180, v)) })}
          />
        </>
      )}

      <div className="checks" role="group" aria-label="Background">
        <span>Background</span>
        {check('On', boxed, (on) => set({ background_color: on ? DEFAULT_BACKGROUND : '' }))}
      </div>
      {boxed && (
        <>
          {colour('Colour', material.background_color, (background_color) =>
            set({ background_color }),
          )}
          <NumberField
            label="Opacity"
            value={material.background_alpha * 100}
            min={0}
            max={100}
            suffix="%"
            onCommit={(v) => set({ background_alpha: percent(v) })}
          />
          <NumberField
            label="Roundness"
            value={material.background_round_radius * 100}
            min={0}
            max={100}
            suffix="%"
            onCommit={(v) => set({ background_round_radius: percent(v) })}
          />
        </>
      )}
    </>
  )
}
