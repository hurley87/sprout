# Sprout — Visuals and Animation

The preferred visual reference, its application to Sprout, and speech animation requirements.

**Status:** Product direction updated 2026-10-30; detailed assets and implementation remain to be designed.

## Preferred visual direction

The user identified [Margin Call](https://margincall.fun/) and its [repository](https://github.com/hurley87/margin-call/) as the style reference.

The live home page was visually inspected on 2026-10-30. It uses a warm off-white background, a prominent animal illustration with crayon-like texture, irregular hand-drawn outlines, handwritten lettering, and generous spacing. These observations describe the reference, not a completed Sprout design.

Relevant implementation references confirm the visual treatment:

- [playful.css](https://github.com/hurley87/margin-call/blob/main/src/app/playful.css) defines a paper background (`#fffefa`), dark ink, a warm accent, and the handwritten product theme.
- [layout.tsx](https://github.com/hurley87/margin-call/blob/main/src/app/layout.tsx) loads Patrick Hand for that theme.
- [sketch.ts](https://github.com/hurley87/margin-call/blob/main/src/components/ui/sketch.ts) defines shared rough-stroke settings with stationary outlines.

These are reference choices; Sprout's exact palette, typeface, and rendering library have not been selected.

## Proposed application to Sprout

A hand-drawn 2D world is the working interpretation of the reference:

- Warm paper-like backgrounds and colourful illustrated scenes.
- A textured, expressive Pip the Fox with a consistent visual identity.
- Simple silhouettes and clearly distinguishable objects for counting and comparing.
- Sparse interface chrome so attention stays on the character and challenge.
- Visual subject and level cues supported by spoken guidance.
- Handwritten styling where text appears, while keeping all child-facing instructions understandable without reading.

The original 3D and hybrid ideas remain in the [source exploration](source/product-exploration.md). The current preference is the illustrated reference above; the exact animation technique remains open.

## Animation requirements

The instructor should support:

- Idle, talking, and listening states.
- Eye movement and blinking.
- Happy, curious, confused, and encouraging expressions.
- Simple gestures and reactions to learner responses.
- Transitions that clearly communicate when it is the child's turn.

**Character animation must synchronize with speech.** Proposed behavior is for speaking motion to follow actual audio playback and stop or change state when speech is interrupted, paused, or finished. The choice of simple audio-driven mouth movement versus more detailed lip sync remains an implementation question.

Structured application events should drive scene and reaction changes. Real-time AI-generated video is not required by the product direction.
