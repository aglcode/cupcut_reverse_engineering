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

- [x] 5. Text styling: fonts, stroke, shadow, background box, spacing and alignment
- [x] 6. Canvas background (colour or blur behind a clip that does not fill the frame)
- [x] 7. Reverse playback and freeze frame
- [x] 8. Thumbnails on video clips and waveforms on audio clips

Suggested next batch, on the same basis:

- [x] 9. Multi-select, with move and delete for several clips at once
- [x] 10. Ripple delete and main-track magnet (closing the gap a removed clip leaves)
- [x] 11. Extract audio from a video clip, and linked audio/video
- [x] 12. Keyframe easing curves and draggable keyframes
- [x] 13. Export range, plus HEVC and AV1 where the browser can encode them

Suggested next batch, on the same basis:

- [x] 14. Project persistence: keep imported media between sessions
- [ ] 15. Copy, cut and paste clips; duplicate
- [ ] 16. Timeline markers, and snapping clips to the playhead, markers and other clips
- [ ] 17. Basic colour adjustment: brightness, contrast, saturation (keyframeable)
- [ ] 18. Long and 4K exports: write to disk as it goes instead of holding the file in memory

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
- [x] Canvas background per clip: flat colour or the blurred picture
- [x] Reverse playback (picture and sound) and freeze frame
- [x] Thumbnails on video and photo clips and waveforms on audio clips, drawn only where visible
- [x] Multi-select (modifier click, box selection, select all) with group move and delete
- [x] Main-track magnet (CapCut `maintrack_adsorb`): the main video track stays packed, with reorder by dragging
- [x] Ripple delete on any track
- [x] Keyframe easing (Linear, Ease in, Ease out, Ease in-out) as the bezier handles CapCut stores, and keyframes that can be dragged
- [x] Export range (mark in, mark out, mark from clips) and a choice of H.264, HEVC, AV1 or VP9
- [x] The project and its media are kept in the browser and restored on the next visit
- [x] Extract audio from a video clip into a linked audio clip
- [x] Linked clips: selected, moved and deleted together, and following their main-track clip under the magnet
- [x] Text styling: system fonts, bold, italic, underline, alignment, letter and line spacing, outline, shadow, background box; CapCut's style fields imported

## Editing

- [x] Keyframes: position, scale, rotation, opacity, volume
- [x] Keyframe easing: Linear, Ease in, Ease out, Ease in-out; CapCut's eased keyframes imported as they are
- [ ] A curve editor for custom easing (custom handles are imported and played, but can only be replaced by a preset)
- [ ] Confirm CapCut's handles for Ease Out and Ease In-Out (only Ease In appears in the local drafts)
- [ ] Keyframes for other properties (colour, text style, masks) once those features exist
- [x] Drag keyframes along the clip to retime them
- [ ] Copy and paste keyframes
- [ ] Speed ramps (curve presets such as "Bullet" and "Hero")
- [x] Reverse playback
- [ ] Reversed sound in the preview (it is in the export; the preview plays reversed clips silently)
- [ ] Faster export of long reversed clips (each frame is decoded from the previous keyframe)
- [ ] Confirm against CapCut which part of the source a reversed clip plays (no local example)
- [x] Freeze frame: holds the frame under the playhead as a 3 s still and moves the rest of the track later
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
- [x] Canvas background: colour or blurred picture behind a clip
- [ ] Image as a canvas background (CapCut `canvas_image`; imported without it)
- [ ] Apply one background to every clip at once
- [ ] Confirm the scale of the CapCut blur value (no local draft sets a background)
- [ ] Compound clips (nested timelines)
- [ ] Multi-camera editing
- [x] Multi-select: Ctrl/Shift-click, box selection, Ctrl+A; move and delete several clips at once
- [ ] Move a group of clips to other tracks (a group currently moves in time only)
- [ ] Edit a setting on several clips at once
- [ ] Copy, cut and paste clips
- [x] Clip grouping on `group_id`: Link and Unlink for any selection
- [x] Linked audio/video (and linking any clips together)
- [ ] Linked clips trim together (a trim currently changes one clip only)
- [ ] Move a link to another track (a link moves in time only)
- [x] Main-track magnet: the main track is kept packed from zero; trims, deletes, speed changes and new clips ripple
- [x] Ripple delete (Shift+Delete) on any track
- [ ] Linkage (CapCut `linkage_enabled`) for clips that are not linked: overlays and titles that travel with the main-track clip they sit over
- [ ] Ripple trim on tracks other than the main one
- [ ] A group move that includes main-track clips: with the magnet on the group is blocked by the packed clips around it, or jumps past them
- [ ] Timeline markers
- [ ] Beat markers on audio
- [x] Thumbnails on video clips
- [x] Waveforms on audio clips
- [ ] Waveform on video clips that have sound (extracting the audio shows it on the audio clip)
- [ ] Thumbnails that reflect crop and flip
- [ ] Limit thumbnail memory on very long projects (nothing is evicted yet)

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

- [x] Font selection from fonts installed with the operating system
- [ ] Load other fonts (font files, or the fonts installed on this computer); CapCut's own fonts cannot be loaded
- [x] Stroke and shadow
- [x] Background box
- [x] Letter spacing, line spacing and alignment
- [x] Bold, italic and underline
- [ ] Calibrate text style units against CapCut (outline width, shadow distance and blur, spacing); needs side-by-side renders
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
- [x] Extract audio from a video into its own clip

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

- [x] HEVC and AV1 codecs (and VP9), offered when this computer can encode them
- [ ] MOV, GIF and audio-only output `*`
- [x] Export range (part of the timeline)
- [ ] Drag the ends of the export range on the ruler
- [ ] Read CapCut's own `export_range` (null in every local draft, so its shape is unknown)
- [ ] Cover image selection
- [ ] Background export
- [ ] Long and 4K projects (export currently holds the audio mix and output in memory)

## App and platform

- [ ] Preview caching and proxy media
- [ ] Asset library (stock media, effects, templates)
- [ ] Cloud drafts, sync, team spaces and accounts
- [x] Project persistence: the current project autosaves and imported media is kept in browser storage
- [ ] Link to media files on disk instead of copying them into browser storage (needs the native file picker and a permission prompt per session; not testable headlessly)
- [ ] Several saved projects with a project list (only the current project is kept)
- [ ] Keep undo history across a reload
- [ ] Clear out stored media that no project uses (files are removed one at a time, by hand)
- [ ] Writing drafts back to CapCut (import is one-way)
- [ ] Screen and webcam recording

## Gaps inside what is built

- [ ] Imported CapCut text size and positions are approximations; calibrate against CapCut
- [x] Verify export of audio embedded in video files
- [ ] Verify audible preview in a real (non-headless) browser

## Cannot be reproduced from what is on disk

These depend on CapCut's servers or proprietary assets, so matching them means
building original versions rather than copying behaviour: effects, filters,
templates, the stock asset library, and the AI features.
