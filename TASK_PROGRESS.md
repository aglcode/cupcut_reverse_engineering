# Task progress

What CapCut Desktop has that this project does not, tracked one item at a time.
Tick an item when it is built and verified. Items marked `*` are listed from
general knowledge of CapCut rather than from evidence on disk.

Last updated: 2026-10-13

## Up next

Suggested order: self-contained features that do not depend on CapCut's
proprietary assets.

- [x] 1. Keyframes
- [x] 2. Audio fades
- [x] 3. Crop, flip and mirror
- [x] 4. Transitions

Suggested next batch, on the same basis:

- [ ] 5. Text styling: fonts, stroke, shadow, background box, spacing and alignment
- [ ] 6. Canvas background (colour or blur behind a clip that does not fill the frame)
- [ ] 7. Reverse playback and freeze frame
- [ ] 8. Thumbnails on video clips and waveforms on audio clips

## Done

- [x] Draft model in CapCut's shape (tracks, segments, materials, microsecond time)
- [x] Video, audio and text tracks
- [x] Move, trim, split and delete with frame snapping and no overlaps
- [x] Constant speed
- [x] Scale, position, rotation, opacity and volume per clip
- [x] Undo/redo
- [x] Save and open project JSON
- [x] Open a CapCut `draft_content.json` (structure, timing, transforms, text), with a list of what was left out
- [x] Preview playback
- [x] Export H.264 + AAC MP4 with resolution, frame rate and bitrate options
- [x] Keyframes for position, scale, rotation, opacity and volume (linear), stored as CapCut stores them and imported from CapCut drafts
- [x] Audio fade in and fade out (linear), imported from CapCut drafts
- [x] Crop (per edge) and horizontal/vertical flip, stored as CapCut stores them and imported from CapCut drafts
- [x] Transitions between adjacent clips (Mix, Fade, Wipe, Slide), stored on the outgoing clip as in CapCut and imported from CapCut drafts

## Editing

- [x] Keyframes: position, scale, rotation, opacity, volume
- [ ] Keyframe easing curves (CapCut `FreeCurveInOut` and graph presets); currently linear only
- [ ] Keyframes for other properties (colour, text style, masks) once those features exist
- [ ] Drag keyframes along the clip to retime them
- [ ] Speed ramps (curve presets such as "Bullet" and "Hero")
- [ ] Reverse playback
- [ ] Freeze frame
- [x] Transitions between clips: Mix, Fade through black, Wipe, Slide
- [ ] More transition looks (CapCut's own are shader bundles; other imported looks become Mix)
- [ ] Audio crossfade during a transition (sound currently cuts at the cut)
- [ ] Confirm where CapCut places the transition window (centred on the cut is assumed)
- [ ] In/out/loop animations on clips and text
- [x] Crop, flip and mirror (mirror is the horizontal flip)
- [ ] Interactive crop box on the preview, with aspect-ratio presets (1:1, 9:16 and so on); currently numeric fields
- [ ] Rotated crops (imported as their upright bounding box)
- [ ] Confirm against CapCut how a cropped clip is sized, and what `crop_scale` does
- [ ] Masks, including mask stroke and shadow
- [ ] Canvas background (colour, blur or image behind a clip); currently always black
- [ ] Compound clips (nested timelines)
- [ ] Multi-camera editing
- [ ] Multi-select and clip grouping
- [ ] Linked audio/video
- [ ] Ripple edits and main-track magnet
- [ ] Timeline markers
- [ ] Beat markers on audio
- [ ] Thumbnails on video clips
- [ ] Waveforms on audio clips

## Colour and effects

- [ ] Filters
- [ ] Video effects
- [ ] Basic colour adjustment (brightness, contrast and similar)
- [ ] HSL adjustment
- [ ] Colour curves
- [ ] Colour wheels
- [ ] LUTs
- [ ] Colour match
- [ ] HDR handling and colour-space management
- [ ] Stickers and overlays `*`
- [ ] Blend modes `*`
- [ ] Chroma key
- [ ] Background removal

## Text

- [ ] Font selection (currently one system font)
- [ ] Stroke and shadow
- [ ] Background box
- [ ] Letter spacing, line spacing and alignment
- [ ] Curved text
- [ ] Per-character styles
- [ ] Text templates and presets
- [ ] Auto captions
- [ ] Lyrics recognition
- [ ] Caption translation

## Audio

- [x] Fades: fade in and fade out per clip
- [ ] Confirm CapCut's fade curve and time base against a draft that uses fades (none available locally; linear and timeline time assumed)
- [ ] Drag fade handles on the clip
- [ ] Audio effects and voice changers
- [ ] Loudness normalisation
- [ ] Noise reduction
- [ ] Vocal separation
- [ ] Pitch-preserving speed change (currently speed shifts pitch)
- [ ] Text-to-speech
- [ ] Voice recording
- [ ] Music and sound-effect library
- [ ] Extract audio from a video into its own clip

## AI and smart features

- [ ] Stabilisation
- [ ] Super-resolution
- [ ] Frame interpolation
- [ ] Deflicker
- [ ] Motion blur
- [ ] Smart crop / auto-reframe
- [ ] Object tracking
- [ ] Beauty and body retouch
- [ ] Digital humans and lip sync
- [ ] AI generation tools

## Export

- [ ] HEVC and AV1 codecs
- [ ] MOV, GIF and audio-only output `*`
- [ ] Export range (part of the timeline)
- [ ] Cover image selection
- [ ] Background export
- [ ] Long and 4K projects (export currently holds the audio mix and output in memory)

## App and platform

- [ ] Preview caching and proxy media
- [ ] Asset library (stock media, effects, templates)
- [ ] Cloud drafts, sync, team spaces and accounts
- [ ] Project persistence (media must currently be re-imported each session)
- [ ] Writing drafts back to CapCut (import is one-way)
- [ ] Screen and webcam recording

## Gaps inside what is built

- [ ] Imported CapCut text size and positions are approximations; calibrate against CapCut
- [ ] Verify export of audio embedded in video files
- [ ] Verify audible preview in a real (non-headless) browser

## Cannot be reproduced from what is on disk

These depend on CapCut's servers or proprietary assets, so matching them means
building original versions rather than copying behaviour: effects, filters,
templates, the stock asset library, and the AI features.
