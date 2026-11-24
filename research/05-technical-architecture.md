# Sprout — Technical Architecture

Reported prototype capabilities, proposed layers, and authority over learning state.

**Status:** Early product exploration and prototyping.

Based on sections 9 of the [original product exploration](source/product-exploration.md), updated with the user’s 2026-10-30 product direction.

## Technical Approach

Sprout already has an experimental foundation for voice-based learning.

### Existing prototype capabilities

- Real-time voice conversations using GPT-Live.
- Authored lesson definitions and learning objectives.
- Semantic interpretation of learner responses.
- Deterministic progression through lessons.
- Separation between conversational output and authoritative learning state.
- Diagnostic and session evidence collection.
- A working preschool counting prototype.

The current implementation is a prototype, not a finished animated consumer app. These capabilities come from the original notes and have not been independently verified against its code.

**Voice responsiveness:** The user reports that the existing real-time voice stack is responsive enough. Treat it as the starting foundation; the remaining work concerns the game experience, interruption/recovery behavior, evidence, and speech-synchronized animation.

### Proposed architecture

**Conversation layer**
- Handles real-time speech and dialogue.
- Expresses the instructor's personality.
- Guides the learner within the current activity.
- Supports voice-only answers, choices, and navigation during child play.
- Provides spoken instructions without assuming reading ability.

**Lesson engine**
- Controls objectives and progression.
- Validates transitions.
- Determines when the next scene and level can appear.
- Runs authored lesson structures and progression; voice input does not bypass transition rules.

**Learning evidence layer**
- Interprets learner responses.
- Tracks assistance and demonstrated skills.
- Avoids treating AI-generated answers as learner knowledge.

**Presentation layer**
- Renders characters, scenes, and activities.
- Responds to structured animation events.
- Synchronizes character speech animation with audio playback.
- Presents the scene and level changes produced by the lesson engine.
- Communicates talking and listening states without requiring reading or touch input.

**Parent experience**
- Manages profiles, permissions, and adult lesson setup.
- Allows the child to play independently after the adult starts the lesson.
- Shows learning activity and summaries.
- Provides access to settings and subscriptions.

### Important architectural principle

**AI controls the conversation; the application controls the learning environment.**

The animated character should not have unrestricted authority to modify learning state, reveal unapproved content, or declare mastery.

### Open implementation details

- Choose an animation system and its speech-timing input; synchronization is a requirement, but its mechanism is not yet decided.
- Define behavior for hesitation, unclear speech, interruptions, silence, and connection loss.
- Keep adult-only setup and settings separate from the child's spoken gameplay.
- Define what happens when a session cannot recover without adult help.

The Margin Call repository is a visual reference. It does not establish Sprout's application stack or voice architecture.
