# AI Video Editor Frontend Design

## Goal

Build a desktop-first interactive frontend for an AI-native video editor. The first milestone demonstrates asset stacks, immutable versions, a multi-track timeline, a resizable AI panel, and separate conversational and generation model selectors.

## Layout

- Desktop window with translucent macOS-style chrome.
- Upper row: asset library, preview canvas, resizable AI conversation panel.
- Lower row: timeline spanning the full width of all upper modules.
- The AI panel stays at the upper-right and resizes from its left edge.

## Product behavior

- Each asset owns an immutable version stack and a current library version.
- A timeline clip stores the exact version used when it was inserted; changing the library's current version does not update existing clips.
- A user may replace one timeline clip with another version explicitly.
- Conversation and generation model selectors appear at the bottom of the AI composer.
- Editing commands are represented as reversible transactions.

## Interaction principles

- Pointer-down feedback is immediate.
- Timeline clips track pointer movement 1:1, inherit release velocity, and settle onto snap points with an interruptible spring.
- Panel resizing tracks the pointer continuously and applies rubber-band resistance at its limits.
- Translucent materials express hierarchy without stacking glass on glass.
- Reduced motion, reduced transparency, high contrast, keyboard focus, and Chinese/English-ready typography are supported.

## Milestone boundary

The milestone is a local frontend MVP with seeded demo data. It does not call OpenAI, render video, persist projects, or package Electron yet. Provider, persistence, and render services are typed ports so later milestones can implement them without rewriting UI state.
