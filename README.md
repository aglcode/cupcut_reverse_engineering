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
- Keyframes for position, scale, rotation, opacity and volume, with linear motion.
- Audio fade in and fade out per clip.
- Crop from each edge, and flip horizontally or vertically.
- Transitions between adjacent video clips: Mix, Fade through black, Wipe, Slide.
- Undo/redo, save/open project JSON.
- Open a CapCut `draft_content.json`: tracks, timing, transforms, text, speed,
  keyframes, audio fades, crops, flips and transitions are imported, media is relinked by file name, and anything unsupported is listed.
- Export H.264 + AAC MP4 at a chosen resolution, frame rate and bitrate.

Shortcuts: Space play/pause, Ctrl+B split, Delete remove, Ctrl+Z / Ctrl+Shift+Z
undo/redo, ←/→ step one frame.

## How it maps to CapCut

| CapCut (observed) | Here |
|---|---|
| `draft_content.json`: `tracks[].segments[]` referencing a `materials` pool by id | `src/model/types.ts`, same field names |
| Integer microsecond times; frame n stored as `floor(n × 1e6 / fps)` | `src/model/time.ts` |
| `source_timerange` / `target_timerange`, with `source = target × speed` | `src/model/ops.ts` |
| No overlap inside a track; draft duration is the last segment's end | `src/model/ops.ts` (covered by tests) |
| `clip { scale, rotation, transform, alpha }` relative to the canvas | `src/engine/compositor.ts` |
| `segment.common_keyframes`: one list per property, `time_offset` in source-media time | `src/model/keyframes.ts` |
| Crop as four corners on the video material, normalised to the media; `clip.flip` on the segment | `src/model/crop.ts`, `Clip.flip` in `src/model/types.ts` |
| `materials.transitions` entry (`name`, `duration`) referenced from the outgoing clip; clips stay adjacent on the timeline | `src/model/transitions.ts`, kept on the outgoing segment |
| `materials.audio_fades` entry (`fade_in_duration`, `fade_out_duration`) referenced from the segment | `src/model/fades.ts`, same fields kept on the segment |
| GPU compositing, then a hardware encoder and MP4 mux through FFmpeg | `src/engine/exporter.ts`: Canvas compositing, WebCodecs encode, mediabunny mux |

## Not implemented

Effects, filters, in/out animations, masks, speed ramps (imported
at their average speed), keyframe easing curves (imported as linear), compound
clips, and writing drafts back to CapCut. See `TASK_PROGRESS.md` for the full list.

Audio fades are linear and measured in timeline time. No local CapCut draft
uses a fade, so CapCut's actual curve and time base are unconfirmed.

Transition looks are original, not CapCut's: only its "Mix" has an equivalent,
and any other imported transition becomes a Mix of the same length. The
transition window is centred on the cut, which is an assumption.

A cropped clip is refitted to the canvas at scale 1. That sizing rule is
inferred; CapCut also stores a `crop_scale` value whose role is not established.

Text size and the transform units are approximations of CapCut's: its drafts
store the numbers but not their meaning, so imported text and offsets may not
match CapCut pixel for pixel.
