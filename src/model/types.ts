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

export type Keyframe = { id: string; time_offset: number; values: number[] }

export type KeyframeList = {
  id: string
  property_type: KeyframeProperty
  // Sorted by time_offset.
  keyframe_list: Keyframe[]
}

export type TransitionName = 'Mix' | 'Fade' | 'Wipe' | 'Slide'

// Transition from this segment into the next one. See transitions.ts.
export type Transition = { name: TransitionName; duration: number }

export type AudioFade = { fade_in_duration: number; fade_out_duration: number }

export type Segment = {
  id: string
  material_id: string
  // Range inside the media. null for text, which has no source media.
  source_timerange: TimeRange | null
  // Range on the timeline.
  target_timerange: TimeRange
  speed: number
  volume: number
  clip: Clip | null
  visible: boolean
  // See keyframes.ts for the time base of time_offset.
  common_keyframes: KeyframeList[]
  // See fades.ts. null when the segment has no fade.
  audio_fade: AudioFade | null
  transition: Transition | null
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
  path: string
  duration: number
}

export type TextMaterial = {
  id: string
  type: 'text'
  content: string
  font_size: number
  text_color: string
}

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
    tracks: [{ id: newId(), type: 'video', name: 'Video 1', segments: [] }],
    materials: { videos: [], audios: [], texts: [] },
  }
}

export const segmentEnd = (s: Segment): number =>
  s.target_timerange.start + s.target_timerange.duration
