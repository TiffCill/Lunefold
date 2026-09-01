# AI Video Editor Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested desktop-first React frontend for the approved AI-native video editor interaction model.

**Architecture:** A Vite React application separates immutable editor-domain state from visual components. A reducer applies reversible editor commands; feature components consume selectors and callbacks without owning project state. Motion utilities implement pointer tracking, momentum projection, spring settling, and reduced-motion behavior.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS, Pointer Events

**Spec:** `docs/superpowers/specs/2026-08-18-ai-video-frontend-design.md`

## Global Constraints

- Desktop upper row contains asset library, preview, and resizable AI conversation panel.
- Timeline spans the entire window beneath all three upper modules.
- Timeline clips bind immutable `assetId + versionId` pairs.
- Conversation and generation model selectors remain independent.
- New interaction logic is developed test-first.
- The milestone uses local seeded data and no external model or rendering calls.

---

### Task 1: Editor domain and immutable asset versions

**Files:**
- Create: `src/domain/editor.ts`
- Test: `src/domain/editor.test.ts`

**Interfaces:**
- Produces: `EditorState`, `EditorCommand`, `createDemoState()`, `applyCommand(state, command)`, `undo(state)`, `redo(state)`.

- [ ] Write failing tests proving a timeline clip retains its inserted version when an asset's current version changes, explicit replacement changes only one clip, and undo restores the prior state.
- [ ] Run `npm test -- src/domain/editor.test.ts` and confirm failures are caused by the missing domain module.
- [ ] Implement immutable state transitions with command history.
- [ ] Run the domain test and confirm it passes.

### Task 2: Desktop shell and asset stack

**Files:**
- Create: `src/App.tsx`, `src/components/AssetLibrary.tsx`, `src/components/Preview.tsx`, `src/styles.css`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `EditorState`, asset-selection and version-selection callbacks.
- Produces: desktop upper-row layout and accessible asset/version controls.

- [ ] Write a failing UI test that selects a library version and proves the previewed timeline clip remains on its frozen version.
- [ ] Run the test and confirm the expected missing UI failure.
- [ ] Implement the desktop shell, asset library, version stack, and preview canvas.
- [ ] Run the test and confirm it passes.

### Task 3: Full-width timeline and direct manipulation

**Files:**
- Create: `src/components/Timeline.tsx`, `src/motion/physics.ts`
- Test: `src/motion/physics.test.ts`, `src/components/Timeline.test.tsx`

**Interfaces:**
- Produces: `projectMomentum(velocity, rate)`, `rubberband(overshoot, dimension)`, `nearestSnap(value, interval)`, accessible clip replacement action.

- [ ] Write failing literal-value physics tests and a timeline test proving the version label comes from the clip binding.
- [ ] Run both tests and verify expected failures.
- [ ] Implement pointer capture, 1:1 dragging, projected snap target, interruptible spring, and full-width tracks.
- [ ] Run both tests and confirm they pass.

### Task 4: AI panel and independent model selectors

**Files:**
- Create: `src/components/AIAssistant.tsx`, `src/components/ResizablePanel.tsx`
- Test: `src/components/AIAssistant.test.tsx`

**Interfaces:**
- Consumes: `ModelRef`, selected conversation/generation IDs, submit callback.
- Produces: independent model changes and a submitted message containing both selected model IDs.

- [ ] Write a failing test that changes both selectors independently and submits their exact IDs with the prompt.
- [ ] Run the test and verify the missing component failure.
- [ ] Implement the assistant, composer, model selectors, seeded messages, and pointer-driven width control.
- [ ] Run the test and confirm it passes.

### Task 5: Integration, accessibility, and responsive behavior

**Files:**
- Create: `src/main.tsx`, `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`
- Modify: `src/App.tsx`, `src/styles.css`
- Test: `src/App.test.tsx`

**Interfaces:**
- Produces: runnable Vite application and production bundle.

- [ ] Extend the app test to cover undo, explicit clip-version replacement, semantic regions, and keyboard-accessible controls.
- [ ] Run the test and confirm new assertions fail.
- [ ] Wire the reducer into the complete shell; add reduced-motion, reduced-transparency, contrast, and narrow-width behavior.
- [ ] Run `npm test` and `npm run build` and confirm both pass without warnings.
- [ ] Review the rendered application at desktop and narrow widths.
