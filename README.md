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
- Speed ramps: CapCut's Hero and Bullet curves or your own, edited on a graph.
- Track headers with Lock, Hide track clips and Mute, as in CapCut. Tracks come
  and go as there: drag a clip above the top track (below the bottom one, for
  sound) to put it on a new track; a track left empty is removed.
- In and out animations on clips and titles: fade, slide and zoom.
- Masks on a clip's picture: Split, Mirror, Circle, Rectangle, Heart or Star, with a soft
  edge, round corners and invert. Every mask setting can be keyframed, and the
  mask can be moved, sized and turned with handles on the preview.
- Blend modes: Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge,
  Overlay, Soft Light and Hard Light.
- Crop on the preview with a crop box, free or held to 16:9, 9:16, 1:1, 4:3 or 3:4.
- Compound clips: fold any clips into one, double-click it to edit inside, or
  break it apart again.
- Several projects kept in the browser, listed under Projects, each with its
  own media list.
- Adjustment layers: brightness, contrast and saturation over everything
  beneath them for as long as they last.
- Font files (.ttf, .otf, .woff) import like media and appear under Font; the
  fonts installed on the computer can be listed too.
- Drag the dots on a selected clip to change its fades and animation lengths.
- Keyframes for position, scale, rotation, opacity and volume, with Linear, Ease
  in, Ease out or Ease in-out between them. Drag a keyframe on its clip to move it.
- Audio fade in and fade out per clip.
- Crop from each edge, and flip horizontally or vertically.
- Transitions between adjacent video clips: Mix, Fade through black, Wipe, Slide.
- Thumbnails on video and photo clips and waveforms on audio clips.
- Reverse a video clip (picture and sound), and freeze the frame under the
  playhead as a still.
- Colour adjustment per clip: brightness, contrast and saturation, which can be
  keyframed.
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
- Markers on the timeline and on clips (M). A clip's markers stay on the same
  moment of its footage when it is moved, trimmed or retimed.
- Snapping (N to switch off): a clip dragged or trimmed near the playhead, a
  marker or another clip's edge jumps onto it.
- Copy, cut, paste and duplicate clips, including several at once and between
  projects.
- Undo/redo, save/open project JSON.
- Open a CapCut `draft_content.json`: tracks, timing, transforms, text, speed,
  keyframes, speed ramps, masks, in/out animations, audio fades, crops, flips, transitions, text styles, canvas backgrounds, markers and colour adjustments are imported, media is relinked by file name, and anything unsupported is listed.
- Export MP4 at a chosen resolution, frame rate and bitrate, as H.264, HEVC, AV1
  or VP9 (whichever this computer can encode), with AAC audio. Mark a range with
  I and O to export only part of the timeline, and drag either end of the marked
  range on the ruler. The file is written to disk as it is encoded, so a long or
  4K export does not have to fit in memory; "Export to file…" writes it straight
  to a file you pick.

Shortcuts: Space play/pause, Ctrl+B split, Delete remove, Shift+Delete ripple
delete, Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste, Ctrl+D duplicate, Ctrl+A select all,
Escape clear selection, M add or remove a marker, Shift+←/→ previous or next
marker, N snapping on or off, I / O mark the export range, Ctrl+Z / Ctrl+Shift+Z
undo/redo, ←/→ step one frame.

## How it maps to CapCut

| CapCut (observed) | Here |
|---|---|
| `draft_content.json`: `tracks[].segments[]` referencing a `materials` pool by id | `src/model/types.ts`, same field names |
| Integer microsecond times; frame n stored as `floor(n × 1e6 / fps)` | `src/model/time.ts` |
| `source_timerange` / `target_timerange`, with `source = target × speed` | `src/model/ops.ts` |
| In/out animation: a `materials.material_animations` entry listing `{type: "in" \| "out" \| "loop" \| "group", name, duration}`; an out animation is placed by the clip's end, its `start` being 0 | `src/model/animations.ts`, same type, name and duration kept on the segment |
| Mask: a `materials.common_mask` entry (`resource_type`, `config` with `width`, `height`, `centerX`, `centerY`, `rotation`, `feather`, `roundCorner`, `invert`), animated by `KFTypeCommonMask…` keyframes | `src/model/mask.ts`, same fields kept on the segment and the same keyframe names |
| Speed ramp: `curve_speed.speed_points` on the clip's `materials.speeds` entry, x a fraction of the clip's source and y a speed; `speed` is then the average | `src/model/speedCurve.ts`, same points kept on the segment |
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
| Colour adjustment as `materials.effects` entries of type `brightness`, `contrast`, `saturation`, each with a `value` from -1 to 1 | `src/model/adjust.ts`, same values kept on the segment |
| `materials.canvases` entry (`type`, `color`, `blur`) referenced from each video clip | `src/model/background.ts`, same fields kept on the segment |
| `materials.transitions` entry (`name`, `duration`) referenced from the outgoing clip; clips stay adjacent on the timeline | `src/model/transitions.ts`, kept on the outgoing segment |
| `materials.audio_fades` entry (`fade_in_duration`, `fade_out_duration`) referenced from the segment | `src/model/fades.ts`, same fields kept on the segment |
| Clip markers: `mark_items` (`title`, `color`, `time_range.start`) in a `materials.time_marks` entry the clip references, in the clip's source time | `src/model/markers.ts`, same items kept on the segment |
| Auto snap (`auto_adsorb`); video cuts sit exactly on beat markers | `src/model/snap.ts` |
| `config.export_range`, with engine operations `export_range_in`, `_out`, `_cancel`, `_by_segment` | `src/model/exportRange.ts` |
| GPU compositing, then a hardware encoder and MP4 mux through FFmpeg | `src/engine/exporter.ts`: Canvas compositing, WebCodecs encode, mediabunny mux |

## Where things are stored

CapCut reopens a draft by reading each file's absolute path from disk. A web
page cannot, so every project and a copy of every imported file are kept in
this browser's IndexedDB (`src/engine/persistence.ts`), and the project open
last comes back on the next visit. Each project's entry has CapCut's draft-list
fields (`draft_id`, `draft_name`, `tm_draft_create`, `tm_draft_modified`,
`tm_duration`, from `root_meta_info.json`). That means:

- Media is duplicated: the copies count against the browser's storage quota for
  this site, shown under the media list.
- It is per browser and per site address. Another browser, a private window or
  a different port starts empty, and clearing site data removes it.
- Each project lists its own files, as CapCut lists a draft's imported files
  under `draft_materials` in `draft_meta_info.json`. A file shared by two
  projects is stored once; removing it from one project only takes it out of
  storage when no other project has it, and deleting a project clears out the
  files nothing else has. Save keeps a project as a file too; opening one
  relinks its media by file name.

An export is written, as it is encoded, to this site's private file store in the
browser (`src/engine/exportFile.ts`), and the Download link then copies it to
where you choose. Only the latest export is kept there, a cancelled one is
removed, and it counts against the same storage quota. Sound is decoded and
mixed ten seconds at a time (`src/engine/audioSources.ts`,
`src/engine/audioMix.ts`). Where the browser has no private file store, the
export is built in memory as before. A file written to disk has its index at
the end; it plays normally but starts more slowly if streamed from a web server.

"Export to file…" (Chromium browsers) skips that store: it asks where to save
and writes there directly, so the video is on disk once, not twice. The chosen
file only takes its new contents when the export finishes, so cancelling leaves
an existing file as it was; a newly named one is left empty.

## Checked against CapCut desktop

CapCut 9.4's own interface text and engine names (in `VECreator.dll` and
`videoeditor.dll`, read only) confirm that it has: the main-track magnet,
box selection on the timeline, auto snapping, In point (I) / Out point (O),
compound clips, curve speed, freeze frame, extract audio, ripple delete, blend
modes such as Color dodge and Soft light, Heart and Star masks with feather and
round corners, font upload, and track Lock / Hide / Mute. It names no "remove
track" or "add track" buttons, and its engine removes empty tracks, so this
editor does the same. Features with no match there: the project list and file
handling (a web page cannot work like a desktop app here), and the adjustment
layer, whose CapCut counterpart is only an engine name.

## Not implemented

Effects, filters, loop and combo animations, a curve editor for custom keyframe
easing, and writing drafts back to CapCut. See `TASK_PROGRESS.md` for the full list.

A compound clip is stored as in CapCut in what it holds (a whole draft) but
not where: CapCut puts that draft in a `materials.drafts` entry of type
"combination" referenced by the clip, while here it sits on the clip's video
material, so copying, splitting and cropping the clip carry it along. Its
sound is the sound of the clips inside, moved out to where it plays, with the
compound clip's own volume, volume keyframes and fades on top; a reversed,
frozen or ramped compound clip is silent. Breaking one apart works at any
constant speed (the clips are sped up to match) but not reversed, frozen or
ramped, and its own position, effects and fades do not carry over to the clips.

An adjustment layer is a clip on a track of type `adjust` (CapCut's engine
names an `adjust_track`; no local draft has one, so the shape is this
editor's own) with no media, whose brightness, contrast and saturation recolour
everything drawn beneath it. Fonts are matched by file name: a CapCut text asks
for the family named after its `font_path` file, so importing that file draws
it in its font.

Blend modes use CapCut's names (`mix_mode` effects, "Screen" and "Overlay"
in the local drafts) drawn with the canvas compositing operations of the same
names. The crop ratio is kept in CapCut's `crop_ratio` field; only "free"
appears locally.

How a speed ramp maps to time is worked out from CapCut's drafts, not read
from them: taking each point as a place in the clip's source, with speed
changing steadily over time between points, gives the timeline length of all 62
ramped clips in the local drafts to within a frame. Hero and Bullet are CapCut's
curves as found. CapCut also has Montage, Jump Cut, Flash In and Flash Out, but
their curves are not on this computer, so they are not offered rather than
guessed. A ramp on a reversed
clip is assumed to run in playing order. While playing, the preview can trail a
steep ramp by about a third of a second; paused frames and the export are exact.

Animation looks are original, not CapCut's: only its Fade In and Fade Out have
an equivalent, and any other imported in or out animation becomes a fade of the
same length. How the motion eases is this editor's own.

Masks keep CapCut's fields and keyframe names, and size is confirmed as a share
of the picture's width and height. The two masked clips in the local drafts (a
Mirror and a Split) leave everything else at zero, so the centre's units, the
direction of rotation, how soft a given feather is, and which side of a Split
shows are this editor's own. The shapes are drawn here, not with CapCut's mask
resources, and any other kind of mask is reported and left out on import.

Audio fades are linear and measured in timeline time. No local CapCut draft
uses a fade, so CapCut's actual curve and time base are unconfirmed.

Transition looks are original, not CapCut's: only its "Mix" has an equivalent,
and any other imported transition becomes a Mix of the same length. The
transition window is centred on the cut, which is an assumption.

Of the easing presets only Ease In is confirmed against CapCut: it is the only
eased kind in the drafts inspected. Ease out and Ease in-out mirror its handle.

Where pasted clips land is this editor's own design: clips from one track stay
together, on the track they came from if there is room, otherwise another or a
new one; with the magnet on, main-track clips are slotted in at the nearest cut.
CapCut has copy, cut, paste and duplicate, but a draft does not show its rules.

Markers on a clip follow CapCut exactly, including their time base. Markers on
the timeline itself and the details of snapping (what it snaps to, and from how
far) are this editor's own: CapCut's timeline-level `time_marks` is null in
every draft inspected, and its snap settings are not stored in a draft.

Linking is this editor's own design. CapCut drafts store no connection between
an extracted clip and its video; the `group_id` field used here for links is
empty in every draft inspected, so what CapCut uses it for is not known.

Reverse follows CapCut's `reverse` flag in name only: no local draft has a
reversed clip, and CapCut renders a separate reversed copy of the file, so which
part of the source it plays is unconfirmed. Reversed clips preview without
sound; the sound is in the export.

Colour adjustment uses CapCut's three values and their -1 to 1 range, and -1
saturation gives a grey picture as CapCut's value implies. How strong brightness
and contrast are is this editor's own (each from half to one and a half times
normal): CapCut draws them with a shader bundle, and the one adjusted clip in
the drafts inspected has both at 0.

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
