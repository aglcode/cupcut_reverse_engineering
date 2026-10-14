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
- [x] 15. Copy, cut and paste clips; duplicate
- [x] 16. Timeline markers, and snapping clips to the playhead, markers and other clips
- [x] 17. Basic colour adjustment: brightness, contrast, saturation (keyframeable)
- [x] 18. Long and 4K exports: write to disk as it goes instead of holding the file in memory

Suggested next batch, on the same basis:

- [x] 19. Speed ramps, imported from CapCut drafts
- [x] 20. Masks
- [x] 21. In/out animations on clips and text
- [x] 22. Save an export straight to a chosen file
- [x] 23. Drag the ends of the export range on the ruler

Suggested next batch, on the same basis:

- [x] 24. Blend modes
- [x] 25. Interactive crop box on the preview, with ratio presets
- [x] 26. Move, size and turn a mask by dragging on the preview
- [x] 27. Several saved projects with a project list
- [x] 28. Compound clips (nested timelines)

Suggested next batch, on the same basis:

- [x] 29. A compound clip's own volume and fades on its sound; break apart sped-up compound clips
- [x] 30. Thumbnails on compound clips, and media kept per project
- [x] 31. Drag fade and animation lengths on the clip
- [x] 32. Adjustment layers
- [x] 33. Load other fonts

Checked against CapCut 9.4's own interface text (`VECreator.dll`) and fixed
where this editor differed:

- [x] 34. Track header as in CapCut: Lock, Hide track clips and Mute (no remove button)
- [x] 35. Tracks as in CapCut: no "Add track" buttons; dragging a clip above the top track (below the bottom one, for sound) makes a track, and an emptied track goes
- [x] 36. Heart and Star masks
- [x] 37. Only CapCut's own speed presets (the invented "Speed up" and "Slow down" are gone)

## Done

- [x] Adjustment layers: a clip on its own track that recolours everything beneath it, keyframeable
- [x] Fonts: import font files (CapCut text finds its font by file name), and list the fonts installed on this computer where the browser allows
- [x] Fade and animation lengths dragged on the selected clip
- [x] Compound clips: fold clips into one, edit inside it, break it apart; imported from CapCut drafts
- [x] Several projects kept in the browser, with a project list (open, rename, delete)
- [x] Crop box on the preview with ratio presets, and mask handles on the preview
- [x] Blend modes (Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge, Overlay, Soft Light, Hard Light), imported from CapCut drafts
- [x] Export straight to a file you pick, where the browser has a save dialog for web pages
- [x] The ends of the export range can be dragged on the ruler, with snapping
- [x] In and out animations on clips and titles (fade, four slides, two zooms), with CapCut's Fade In and Fade Out imported
- [x] Track Lock, Hide and Mute, kept in CapCut's track `attribute`, and empty tracks removed as CapCut does
- [x] Masks: Split, Mirror, Circle, Rectangle, Heart and Star, with position, size, rotation, feather, round corners and invert, all keyframeable, imported from CapCut drafts
- [x] Speed ramps: CapCut's Hero and Bullet curves (its only ones found locally), custom curves on a graph, imported from CapCut drafts with their timing intact
- [x] Exports are written to disk as they are encoded, with sound decoded and mixed ten seconds at a time

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
- [x] Copy, cut, paste and duplicate, for one clip or many, across tracks and between projects
- [x] Markers on the timeline and on clips (stored as CapCut stores them, imported from CapCut drafts)
- [x] Colour adjustment per clip: brightness, contrast and saturation, keyframeable, imported from CapCut drafts
- [x] Snapping to the playhead, markers and other clips' edges while moving or trimming
- [x] Extract audio from a video clip into a linked audio clip
- [x] Linked clips: selected, moved and deleted together, and following their main-track clip under the magnet
- [x] Text styling: system fonts, bold, italic, underline, alignment, letter and line spacing, outline, shadow, background box; CapCut's style fields imported

## Editing

- [x] Keyframes: position, scale, rotation, opacity, volume
- [x] Keyframe easing: Linear, Ease in, Ease out, Ease in-out; CapCut's eased keyframes imported as they are
- [ ] A curve editor for custom easing (custom handles are imported and played, but can only be replaced by a preset)
- [ ] Confirm CapCut's handles for Ease Out and Ease In-Out (only Ease In appears in the local drafts)
- [x] Keyframes for colour adjustment
- [ ] Keyframes for text style (masks have them)
- [x] Drag keyframes along the clip to retime them
- [ ] Copy and paste keyframes
- [x] Speed ramps (curve presets such as "Bullet" and "Hero"), with a graph to edit them
- [ ] CapCut's other ramp presets, Montage, Jump Cut, Flash In and Flash Out (named in CapCut, but their curves are downloaded only when used and no local draft uses them; a draft that does would give them)
- [ ] Confirm which bit of a track's `attribute` is lock, hide and mute (0 on every local track; mute as 1 follows common report)
- [ ] Main-track cover (CapCut's main track has a Cover button)
- [ ] Decide on the adjustment layer: CapCut's engine names an adjust_track, but no adjustment-layer label was found in its interface text
- [ ] Confirm how CapCut plays a ramp on a reversed clip (no local example; the ramp is taken to run in playing order)
- [ ] Preview keeps closer to a steep ramp while playing (it can trail by about a third of a second; paused frames and the export are exact)
- [ ] A linked clip follows a speed or ramp change made to its partner (extracting audio copies the ramp, later changes are not shared)
- [x] Reverse playback
- [ ] Reversed sound in the preview (it is in the export; the preview plays reversed clips silently)
- [ ] Faster export of long reversed clips (each frame is decoded from the previous keyframe)
- [ ] Confirm against CapCut which part of the source a reversed clip plays (no local example)
- [x] Freeze frame: holds the frame under the playhead as a 3 s still and moves the rest of the track later
- [x] Transitions between clips: Mix, Fade through black, Wipe, Slide
- [ ] More transition looks (CapCut's own are shader bundles; other imported looks become Mix)
- [ ] Audio crossfade during a transition (sound currently cuts at the cut)
- [ ] Confirm where CapCut places the transition window (centred on the cut is assumed)
- [x] In and out animations on clips and text
- [ ] Loop and combo animations (CapCut `loop` and `group`; reported and left out on import)
- [ ] More animation looks (CapCut's own are effect bundles; other imported looks become a fade of the same length)
- [x] Drag an animation's length on the clip
- [x] Crop, flip and mirror (mirror is the horizontal flip)
- [x] Interactive crop box on the preview, with aspect-ratio presets (1:1, 9:16 and so on)
- [ ] Crop box for a compound clip (it shows no picture to crop against; the numeric fields work)
- [ ] Rotated crops (imported as their upright bounding box)
- [ ] Confirm against CapCut how a cropped clip is sized, and what `crop_scale` does
- [x] Masks: Split, Mirror, Circle and Rectangle
- [x] Heart and Star masks (CapCut names pc_mask_heart and pc_mask_star; the outlines here are this editor's own)
- [ ] Mask stroke and shadow (CapCut has keyframe properties for both)
- [ ] Text and pen (drawn outline) masks, and CapCut's `expansion` setting
- [x] Move, size and turn a mask by dragging on the preview
- [ ] Confirm against CapCut the mask's centre units, rotation direction, feather strength and which side a Split shows (all zero or default in the two local examples)
- [x] Canvas background: colour or blurred picture behind a clip
- [ ] Image as a canvas background (CapCut `canvas_image`; imported without it)
- [ ] Apply one background to every clip at once
- [ ] Confirm the scale of the CapCut blur value (no local draft sets a background)
- [x] Compound clips (nested timelines)
- [x] The compound clip's own volume, volume keyframes and fades on its sound
- [ ] Sound of a reversed, frozen or ramped compound clip (it is silent)
- [x] Break apart a sped-up compound clip (its clips are sped up to match)
- [ ] Break apart a reversed, frozen or ramped compound clip
- [ ] Keep a compound clip's own settings (position, effects, fades) when it is broken apart
- [x] Thumbnails on a compound clip
- [ ] Waveform on a compound clip
- [ ] Confirm how CapCut numbers and names compound clips, and how it breaks one apart (one local example, never broken apart)
- [ ] Multi-camera editing
- [x] Multi-select: Ctrl/Shift-click, box selection, Ctrl+A; move and delete several clips at once
- [ ] Move a group of clips to other tracks (a group currently moves in time only)
- [ ] Edit a setting on several clips at once
- [x] Copy, cut, paste and duplicate clips
- [ ] Paste attributes (CapCut `PasteSegmentAttribute`): apply one clip's look to others
- [ ] Use the system clipboard, so clips can be pasted into another tab or after a reload
- [ ] Confirm where CapCut puts pasted clips and how it settles a conflict (not observable from a draft)
- [x] Clip grouping on `group_id`: Link and Unlink for any selection
- [x] Linked audio/video (and linking any clips together)
- [ ] Linked clips trim together (a trim currently changes one clip only)
- [ ] Move a link to another track (a link moves in time only)
- [x] Main-track magnet: the main track is kept packed from zero; trims, deletes, speed changes and new clips ripple
- [x] Ripple delete (Shift+Delete) on any track
- [ ] Linkage (CapCut `linkage_enabled`) for clips that are not linked: overlays and titles that travel with the main-track clip they sit over
- [ ] Ripple trim on tracks other than the main one
- [ ] A group move that includes main-track clips: with the magnet on the group is blocked by the packed clips around it, or jumps past them
- [x] Timeline markers, and markers on clips that travel with the clip
- [x] Snapping while moving and trimming: playhead, markers, other clips' edges
- [ ] Rename and recolour markers
- [ ] Drag a marker to move it
- [ ] Snapping for the playhead, keyframes, the export range and reordering on the main track
- [ ] Confirm CapCut's timeline-level `time_marks` shape (null in every local draft) and what its auto snap snaps to
- [x] Beat markers on audio: CapCut's are imported as clip markers (its `user_beats` and `mark_items` are the same list)
- [ ] Detect beats automatically (CapCut `ai_beats`)
- [x] Thumbnails on video clips
- [x] Waveforms on audio clips
- [ ] Waveform on video clips that have sound (extracting the audio shows it on the audio clip)
- [ ] Thumbnails that reflect crop and flip
- [ ] Limit thumbnail memory on very long projects (nothing is evicted yet)

## Colour and effects

- [ ] Filters
- [ ] Video effects
- [x] Basic colour adjustment: brightness, contrast, saturation, with keyframes and easing
- [ ] More adjustments CapCut has: temperature, hue, highlights, shadows, sharpen, vignette, fade
- [ ] Calibrate brightness and contrast strength against CapCut (only saturation -1 is pinned down by a real draft)
- [x] Adjustment as its own timeline layer covering several clips
- [ ] Import CapCut adjustment layers (none in the local drafts; the engine names an adjust_track)
- [ ] CapCut's filter tracks (preset filters are CapCut's own LUT bundles)
- [ ] Thumbnails that reflect the adjustment
- [ ] HSL adjustment
- [ ] Colour curves
- [ ] Colour wheels
- [ ] LUTs
- [ ] Colour match
- [ ] HDR handling and colour-space management
- [ ] Stickers and overlays `*`
- [x] Blend modes
- [ ] CapCut's "Linear Burn" blend (no canvas equivalent), and what its `value` does (always 1 locally)
- [ ] Chroma key
- [ ] Background removal

## Text

- [x] Font selection from fonts installed with the operating system
- [x] Load other fonts: font files, and the fonts installed on this computer (Chromium, after a permission prompt)
- [ ] Try "List fonts on this computer…" in a real browser (it needs a permission prompt, which a headless browser cannot answer)
- [ ] CapCut's bold_width and italic_degree (bold and italic here are on or off)
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
- [x] Drag fade handles on the clip
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
- [x] Drag the ends of the export range on the ruler
- [ ] Read CapCut's own `export_range` (null in every local draft, so its shape is unknown)
- [ ] Cover image selection
- [ ] Background export
- [x] Long and 4K projects: the export is written to disk as it goes, and sound is decoded and mixed a stretch at a time
- [x] Save an export straight to a file the user picks ("Export to file…"; the plain Export still goes through the browser's private store and a download)
- [ ] Try "Export to file…" with the real save dialog (the checks here answer the dialog in code, since a headless browser cannot show it)
- [ ] Remove the empty file left behind when an export to a newly named file is cancelled
- [ ] Put the MP4 index at the front of a disk-written export (it is at the end, which is slower to start when streamed from a web server)
- [ ] Test hour-long and multi-gigabyte exports (verified up to 65 s, and 20 s at 4K)
- [ ] Sound from files the streaming decoder cannot read is still decoded whole

## App and platform

- [ ] Preview caching and proxy media
- [ ] Asset library (stock media, effects, templates)
- [ ] Cloud drafts, sync, team spaces and accounts
- [x] Project persistence: the current project autosaves and imported media is kept in browser storage
- [ ] Link to media files on disk instead of copying them into browser storage (needs the native file picker and a permission prompt per session; not testable headlessly)
- [x] Several saved projects with a project list
- [ ] Cover pictures in the project list (CapCut keeps a draft_cover)
- [x] Media kept per project: each lists its own files; a file is only taken out of storage when no project has it
- [ ] Keep undo history across a reload
- [x] Clear out stored media that no project uses (done when a project is deleted)
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
