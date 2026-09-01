# Media Preview and Image Detail Design

## Goal

Keep generated media inside the AI conversation layout, provide an image detail viewer, and let users inspect image and video library assets in the central preview without changing the timeline program. Returning focus to the timeline restores timeline preview.

## Scope

This change covers:

- responsive generated images and videos in assistant messages;
- an image detail viewer with zoom and pan;
- image and video asset preview from the media library;
- explicit switching between asset preview and timeline preview;
- regression and interaction tests.

Audio asset preview, export behavior, editing media contents, and persistent preview state are outside this change.

## Preview State

`App` owns one explicit preview source:

```ts
type PreviewSource =
  | { mode: 'timeline' }
  | { mode: 'asset'; assetId: string };
```

The state defaults to `timeline` and is not persisted.

- A single click on an image or video tile selects the asset and sets asset mode.
- Selecting audio does not replace the central preview.
- Any pointer or keyboard focus entering the timeline root sets timeline mode.
- Switching back to timeline mode preserves the timeline playhead time.
- Leaving asset mode unmounts its media element, stopping asset video playback and resetting zoom/pan.

The existing project/timeline state remains authoritative for editing. Preview source is transient UI state and must not enter undo history.

## Component Boundaries

### App

`App` resolves the selected local or retained project asset into a small preview descriptor containing ID, name, kind, URL, and optional duration. It passes either this descriptor or the resolved timeline program to `Preview`.

`App` also receives a timeline-activity callback from `Timeline` and resets preview source to timeline.

### AssetLibrary

The existing click callbacks remain the selection boundary. Local and project-backed tile clicks notify `App`; `App` decides whether the asset kind activates asset preview.

Context-menu selection follows the same selection behavior but does not otherwise change add-to-conversation or add-to-timeline behavior.

### Timeline

The timeline root is keyboard focusable only where needed for accessibility and reports activity through one `onActivate` callback. Pointer-down and focus-capture are sufficient; child controls and clips need no duplicate reset logic.

### Preview

`Preview` supports two render paths:

- timeline mode: existing program frame, audio tracks, timeline progress, and timeline transport;
- asset mode: an isolated image or video viewer that never reads or writes timeline playback time.

Asset image behavior:

- initial scale is `fit`;
- mouse wheel zooms around the visible image area;
- `−`, `适应`, and `＋` controls are provided;
- zoom is clamped to a practical range;
- a zoomed image can be dragged with pointer capture;
- reduced-motion users receive immediate or short cross-fade feedback without spring movement.

Asset video behavior:

- native video decoding is used;
- play/pause and a dedicated seek range control are shown;
- current time and duration reflect the asset video, not the timeline;
- leaving asset mode pauses and unmounts the video.

The preview identifies its source as `素材预览` or `来自时间线`.

## AI Message Media

Generated linked images and conversation image attachments must use the width of their containing message, with `max-width: 100%`, bounded height, preserved aspect ratio, and `object-fit: contain`. No intrinsic image dimension may widen the assistant panel or message bubble.

Clicking an available image opens an accessible modal detail viewer. The original link actions remain available.

The detail viewer:

- uses a dialog with an overlay and clear close button;
- closes on overlay click or `Escape`;
- supports mouse-wheel zoom, `−`, `适应`, and `＋`;
- supports pointer-drag pan while zoomed;
- exposes the existing download action;
- resets transform state each time it opens;
- prevents the background conversation from being the active interaction target while open.

The viewer should be shared by linked AI-generated images and stored conversation image attachments so both behave consistently.

## Motion and Accessibility

- Buttons respond immediately on press with restrained scale feedback.
- Zoom and pan remain interruptible and track pointer movement one-to-one.
- Dialog entrance and exit share the same spatial path.
- All icon-only controls have accessible names.
- Keyboard users can close the detail viewer with `Escape` and operate zoom controls.
- `prefers-reduced-motion` replaces transform-heavy transitions with short opacity feedback.
- Media error states remain visible and do not open the detail viewer.

## Error Handling

- Failed images retain the current unavailable state and cannot open details.
- Failed asset videos show a preview-local error without changing timeline state.
- Unknown or removed selected assets automatically return preview source to timeline.
- Missing media duration keeps seeking disabled until metadata is available.

## Tests

Behavioral tests will cover:

1. Generated images remain inside the message container and open the detail dialog.
2. Detail zoom buttons, wheel zoom, drag pan, `Escape`, and overlay close work.
3. Clicking a library image enters image asset preview with fit/zoom controls.
4. Clicking a library video enters video asset preview with independent playback and seeking.
5. Asset preview does not mutate timeline playhead state.
6. Pointer or keyboard focus entering the timeline restores timeline preview.
7. Removing the active asset restores timeline preview.
8. Existing timeline playback, conversation media, attachment, and library tests remain green.

Completion requires the focused regression tests, full test suite, TypeScript check, production build, and visual inspection in the running local app.
