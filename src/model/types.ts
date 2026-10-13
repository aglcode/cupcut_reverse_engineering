// Draft model. Field names and shape follow CapCut's draft_content.json so a
// CapCut draft maps onto it directly; only the subset this editor renders is kept.
// All times are integer microseconds.

export type TimeRange = { start: number; duration: number }

export type Clip = {
  scale: { x: number; y: number }
  rotation: number // degrees, clockwise
  transform: { x: number; y: number } // units of half the canvas size, +y is up
  flip: { horizontal: boolean; vertical: boolean }
  alpha: number
}

// Corners of the kept region, normalised to the media, y down. See crop.ts.
export type Crop = {
  upper_left_x: number
  upper_left_y: number
  upper_right_x: number
  upper_right_y: number
  lower_left_x: number
  lower_left_y: number
  lower_right_x: number
  lower_right_y: number
}

export type KeyframeProperty =
  | 'KFTypePositionX'
  | 'KFTypePositionY'
  | 'KFTypeScaleX'
  | 'KFTypeScaleY'
  | 'KFTypeRotation'
  | 'KFTypeAlpha'
  | 'KFTypeVolume'
  | 'KFTypeBrightness'
  | 'KFTypeContrast'
  | 'KFTypeSaturation'
  | 'KFTypeCommonMaskSizeWidth'
  | 'KFTypeCommonMaskSizeHeight'
  | 'KFTypeCommonMaskPositionX'
  | 'KFTypeCommonMaskPositionY'
  | 'KFTypeCommonMaskRotation'
  | 'KFTypeCommonMaskFeather'
  | 'KFTypeCommonMaskRoundCorner'

export type Point = { x: number; y: number }

// left_control and right_control are bezier handles for easing into and out
// of the keyframe. See easing.ts.
export type Keyframe = {
  id: string
  time_offset: number
  values: number[]
  left_control: Point
  right_control: Point
}

export type KeyframeList = {
  id: string
  property_type: KeyframeProperty
  // Sorted by time_offset.
  keyframe_list: Keyframe[]
}

export type TransitionName = 'Mix' | 'Fade' | 'Wipe' | 'Slide'

// Transition from this segment into the next one. See transitions.ts.
export type Transition = { name: TransitionName; duration: number }

// What fills the frame behind a video clip. See background.ts.
export type CanvasBackground =
  | { type: 'canvas_color'; color: string }
  | { type: 'canvas_blur'; blur: number }

// A marker. See markers.ts for what time_range.start is measured in.
export type MarkItem = {
  id: string
  color: string
  title: string
  time_range: TimeRange
}

// Colour adjustment, each from -1 to 1 with 0 leaving the picture alone.
// See adjust.ts.
export type Adjust = { brightness: number; contrast: number; saturation: number }

export type AudioFade = { fade_in_duration: number; fade_out_duration: number }

// A mask over a clip's picture. See mask.ts for the shapes and the units.
export type MaskType = 'line' | 'mirror' | 'circle' | 'rectangle'
export type MaskConfig = {
  width: number
  height: number
  centerX: number
  centerY: number
  rotation: number
  feather: number
  roundCorner: number
  invert: boolean
}
export type Mask = { name: string; resource_type: MaskType; config: MaskConfig }

export const DEFAULT_MASK_CONFIG: MaskConfig = {
  width: 0.5,
  height: 0.5,
  centerX: 0,
  centerY: 0,
  rotation: 0,
  feather: 0,
  roundCorner: 0,
  invert: false,
}

// How a clip arrives ("in") or leaves ("out"). See animations.ts.
export type ClipAnimation = { type: 'in' | 'out'; name: string; duration: number }

// A speed ramp. See speedCurve.ts for what the points mean.
export type SpeedPoint = { x: number; y: number }
export type SpeedCurve = { name: string; speed_points: SpeedPoint[] }

export type Segment = {
  id: string
  material_id: string
  // Range inside the media. null for text, which has no source media.
  source_timerange: TimeRange | null
  // Range on the timeline.
  target_timerange: TimeRange
  // Source length over timeline length. With a ramp this is the average.
  speed: number
  // null when the clip plays at one speed throughout.
  curve_speed: SpeedCurve | null
  volume: number
  clip: Clip | null
  visible: boolean
  // See keyframes.ts for the time base of time_offset.
  common_keyframes: KeyframeList[]
  // See fades.ts. null when the segment has no fade.
  audio_fade: AudioFade | null
  transition: Transition | null
  canvas: CanvasBackground | null
  // See timing.ts. A freeze frame holds the frame at source_timerange.start.
  reverse: boolean
  freeze: boolean
  // Clips with the same non-empty group_id are linked. See links.ts.
  group_id: string
  // Markers on this clip, in the clip's own time base so they travel with it.
  time_marks: MarkItem[]
  adjust: Adjust
  mask: Mask | null
  // At most one "in" and one "out".
  animations: ClipAnimation[]
}

export type TrackType = 'video' | 'audio' | 'text'

export type Track = {
  id: string
  type: TrackType
  name: string
  segments: Segment[]
}

export type VideoMaterial = {
  id: string
  type: 'video' | 'photo'
  // File name of the media. Media is relinked by name, never by absolute path.
  path: string
  duration: number
  width: number
  height: number
  has_audio: boolean
  crop: Crop
}

export type AudioMaterial = {
  id: string
  type: 'audio'
  // Shown on the clip. The file name, or "Extracted-n" for audio taken from a video.
  name: string
  path: string
  duration: number
}

// See textStyle.ts for defaults and what is and is not a CapCut field.
export type TextStyle = {
  font_family: string
  bold: boolean
  italic: boolean
  underline: boolean
  alignment: number // 0 left, 1 centre, 2 right
  letter_spacing: number
  line_spacing: number
  border_color: string
  border_width: number
  has_shadow: boolean
  shadow_color: string
  shadow_alpha: number
  shadow_smoothing: number
  shadow_distance: number
  shadow_angle: number
  background_color: string
  background_alpha: number
  background_round_radius: number
}

export type TextMaterial = {
  id: string
  type: 'text'
  content: string
  font_size: number
  text_color: string
} & TextStyle

export type Materials = {
  videos: VideoMaterial[]
  audios: AudioMaterial[]
  texts: TextMaterial[]
}

export type Draft = {
  app: 'cupcut'
  id: string
  name: string
  fps: number
  duration: number
  canvas_config: { width: number; height: number }
  // maintrack_adsorb is the main-track magnet, under the name CapCut drafts
  // use: while on, the first video track is kept packed from zero with no gaps.
  // export_range is the part of the timeline an export covers; null is all
  // of it. See exportRange.ts.
  config: { maintrack_adsorb: boolean; export_range: TimeRange | null }
  // Markers on the timeline itself, in timeline time.
  time_marks: MarkItem[]
  // Array order is render order: later tracks draw on top.
  tracks: Track[]
  materials: Materials
}

export const DEFAULT_CLIP: Clip = {
  scale: { x: 1, y: 1 },
  rotation: 0,
  transform: { x: 0, y: 0 },
  flip: { horizontal: false, vertical: false },
  alpha: 1,
}

export const newId = (): string => crypto.randomUUID().toUpperCase()

export function emptyDraft(): Draft {
  return {
    app: 'cupcut',
    id: newId(),
    name: 'Untitled',
    fps: 30,
    duration: 0,
    canvas_config: { width: 1920, height: 1080 },
    config: { maintrack_adsorb: false, export_range: null },
    time_marks: [],
    tracks: [{ id: newId(), type: 'video', name: 'Video 1', segments: [] }],
    materials: { videos: [], audios: [], texts: [] },
  }
}

export const segmentEnd = (s: Segment): number =>
  s.target_timerange.start + s.target_timerange.duration
