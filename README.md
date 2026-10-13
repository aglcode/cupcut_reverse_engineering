# CupCut

A browser video editor whose timeline model and export pipeline are modelled on
CapCut Desktop, based on read-only inspection of a local CapCut 9.4 install and
its draft files.

```
npm install
npm run dev      # editor at http://localhost:5173
npm run test     # model + importer unit tests
npm run build
npm run lint
```

Needs a Chromium-based browser (WebCodecs is used for export).

## What it does

- Video, audio and text tracks; import video, audio and images.
- Move, trim, split and delete clips with frame snapping; clips never overlap on a track.
- Constant speed, volume, scale, position, rotation and opacity per clip.
- Keyframes for position, scale, rotation, opacity and volume, with Linear, Ease
  in, Ease out or Ease in-out between them. Drag a keyframe on its clip to move it.
- Audio fade in and fade out per clip.
- Crop from each edge, and flip horizontally or vertically.
- Transitions between adjacent video clips: Mix, Fade through black, Wipe, Slide.
- Thumbnails on video and photo clips and waveforms on audio clips.
- Reverse a video clip (picture and sound), and freeze the frame under the
  playhead as a still.
- Frame background per clip: a colour, or the clip's own picture blurred, behind
  a clip that does not fill the frame.
- Text styling: system fonts, bold, italic, underline, alignment, letter and line
  spacing, outline, shadow and background box.
- Select several clips (Ctrl/Shift-click, drag a box on empty timeline, Ctrl+A)
  and move or delete them together.
- Extract a video clip's sound into its own audio clip, linked to the video.
- Link clips so they are selected, moved and deleted together (Alt-click picks
  one on its own). A clip linked to one on the main track follows it when the
  magnet closes that track up.
- Main-track magnet: the first video track stays packed with no gaps, so
  deleting, trimming or adding a clip there moves the rest along, and dragging a
  clip's leading edge past the middle of its neighbour reorders them. On by default; toggle it in the toolbar.
- Ripple delete (Shift+Delete) closes the gap on any other track.
- The project autosaves, and it and its media are kept in the browser's storage
  and restored on the next visit.
- Undo/redo, save/open project JSON.
- Open a CapCut `draft_content.json`: tracks, timing, transforms, text, speed,
  keyframes, audio fades, crops, flips, transitions, text styles and canvas backgrounds are imported, media is relinked by file name, and anything unsupported is listed.
- Export MP4 at a chosen resolution, frame rate and bitrate, as H.264, HEVC, AV1
  or VP9 (whichever this computer can encode), with AAC audio. Mark a range with
  I and O to export only part of the timeline.

Shortcuts: Space play/pause, Ctrl+B split, Delete remove, Shift+Delete ripple
delete, Ctrl+A select all,
Escape clear selection, I / O mark the export range, Ctrl+Z / Ctrl+Shift+Z
undo/redo, ←/→ step one frame.

## How it maps to CapCut

| CapCut (observed) | Here |
|---|---|
| `draft_content.json`: `tracks[].segments[]` referencing a `materials` pool by id | `src/model/types.ts`, same field names |
| Integer microsecond times; frame n stored as `floor(n × 1e6 / fps)` | `src/model/time.ts` |
| `source_timerange` / `target_timerange`, with `source = target × speed` | `src/model/ops.ts` |
| No overlap inside a track; draft duration is the last segment's end | `src/model/ops.ts` (covered by tests) |
| `clip { scale, rotation, transform, alpha }` relative to the canvas | `src/engine/compositor.ts` |
| Extracted audio: an audio material (`type: "extract_music"`, `name: "Extracted…"`) whose `path` is the video's own file | `extractAudio` in `src/model/ops.ts` |
| `config.maintrack_adsorb`: the main (flag 0) video track runs from zero with no gaps | `finalize` in `src/model/ops.ts`, same setting name |
| `segment.common_keyframes`: one list per property, `time_offset` in source-media time | `src/model/keyframes.ts` |
| Easing as bezier handles on the keyframes (`right_control`, `left_control`); "Ease In" is a right handle of 0.42 of the interval | `src/model/easing.ts` |
| Crop as four corners on the video material, normalised to the media; `clip.flip` on the segment | `src/model/crop.ts`, `Clip.flip` in `src/model/types.ts` |
| Text style fields on the text material (`alignment`, `border_*`, `shadow_*`, `background_*`, `letter_spacing`, `line_spacing`, `underline`) | `src/model/textStyle.ts`, same names; drawn by `src/engine/text.ts` |
| Per-media thumbnail cache (`Cache\frameThumbnail\<media>\82x46\<µs>.png`) and waveform cache (`Cache\audioWave\<media>.waveDataV2`) | `src/engine/clipVisuals.ts`, in memory |
| `reverse` flag on the segment | `src/model/timing.ts`, same flag; freeze frames are a `freeze` flag of this editor's own |
| `materials.canvases` entry (`type`, `color`, `blur`) referenced from each video clip | `src/model/background.ts`, same fields kept on the segment |
| `materials.transitions` entry (`name`, `duration`) referenced from the outgoing clip; clips stay adjacent on the timeline | `src/model/transitions.ts`, kept on the outgoing segment |
| `materials.audio_fades` entry (`fade_in_duration`, `fade_out_duration`) referenced from the segment | `src/model/fades.ts`, same fields kept on the segment |
| `config.export_range`, with engine operations `export_range_in`, `_out`, `_cancel`, `_by_segment` | `src/model/exportRange.ts` |
| GPU compositing, then a hardware encoder and MP4 mux through FFmpeg | `src/engine/exporter.ts`: Canvas compositing, WebCodecs encode, mediabunny mux |

## Where things are stored

CapCut reopens a draft by reading each file's absolute path from disk. A web
page cannot, so the current project and a copy of every imported file are kept
in this browser's IndexedDB (`src/engine/persistence.ts`). That means:

- Media is duplicated: the copies count against the browser's storage quota for
  this site, shown under the media list.
- It is per browser and per site address. Another browser, a private window or
  a different port starts empty, and clearing site data removes it.
- Only the current project is kept. Use Save to keep others as files; opening
  one relinks its media by file name.

## Not implemented

Effects, filters, in/out animations, masks, speed ramps (imported
at their average speed), a curve editor for custom keyframe easing, compound
clips, and writing drafts back to CapCut. See `TASK_PROGRESS.md` for the full list.

Audio fades are linear and measured in timeline time. No local CapCut draft
uses a fade, so CapCut's actual curve and time base are unconfirmed.

Transition looks are original, not CapCut's: only its "Mix" has an equivalent,
and any other imported transition becomes a Mix of the same length. The
transition window is centred on the cut, which is an assumption.

Of the easing presets only Ease In is confirmed against CapCut: it is the only
eased kind in the drafts inspected. Ease out and Ease in-out mirror its handle.

Linking is this editor's own design. CapCut drafts store no connection between
an extracted clip and its video; the `group_id` field used here for links is
empty in every draft inspected, so what CapCut uses it for is not known.

Reverse follows CapCut's `reverse` flag in name only: no local draft has a
reversed clip, and CapCut renders a separate reversed copy of the file, so which
part of the source it plays is unconfirmed. Reversed clips preview without
sound; the sound is in the export.

Canvas backgrounds follow CapCut's field names only: no local draft sets one,
so the scale of the blur value is this editor's own, and image backgrounds are
not supported.

A cropped clip is refitted to the canvas at scale 1. That sizing rule is
inferred; CapCut also stores a `crop_scale` value whose role is not established.

Text size, text style and transform units are approximations of CapCut's: its
drafts store the numbers but not their meaning, so imported text and offsets
may not match CapCut pixel for pixel. CapCut's fonts are downloaded files that
cannot be loaded, so imported text uses the default font, and text with several
styled ranges takes the style of the first.
