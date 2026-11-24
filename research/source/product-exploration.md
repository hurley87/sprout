# Sprout — Product Exploration

**Working concept:** Interactive learning adventures with animated AI instructors.

**Tagline ideas:**
- Little adventures. Big discoveries.
- Learning comes alive.
- Curious minds grow here.

**Status:** Early product exploration and prototyping.

## 1. Vision

Sprout is an interactive learning platform for young children, featuring a cast of animated AI instructors who guide kids through playful, conversational learning experiences.

Think **Peloton meets an animated children's world**.

Instead of watching a prerecorded lesson or interacting with a generic chatbot, children join live, personalized learning adventures with characters they recognize and enjoy.

Each instructor has a distinct personality, voice, visual identity, and teaching style.

The characters listen, ask questions, respond naturally, adapt their guidance, and help children work through challenges.

**The core idea:** Children learn by actively participating, explaining, experimenting, and discovering—not simply watching or being given answers.

## 2. Target Audience

### Initial market

- Children approximately 3–7 years old.
- Start narrowly with preschoolers aged 3–5.
- Parents looking for educational, engaging, age-appropriate screen time.
- Families interested in early math, language, creativity, and foundational skills.

### Customer vs. user

**The child is the user.**
- Wants to have fun.
- Develops favourite characters.
- Enjoys stories, exploration, discovery, and interaction.
- Should not feel like they're doing homework.

**The parent is the customer.**
- Wants a meaningful educational experience.
- Values observable learning and development.
- Needs confidence in the safety and appropriateness of the product.
- Wants an easy way to understand what their child practiced.

## 3. The Peloton Model

Peloton's experience is built around instructors people enjoy spending time with.

Sprout applies a similar idea to early childhood education.

Instead of choosing a cycling instructor, children choose an animated character to learn with.

### Potential characteristics

- Multiple AI instructors with distinctive personalities.
- Different learning subjects and activities.
- Short, interactive learning sessions.
- A catalogue of lessons and adventures.
- New activities and seasonal themes.
- Familiar instructors children want to return to.
- Personalized difficulty and guidance.

### Important distinction

**Sprout is not prerecorded educational television.**

Each experience is interactive.

The child's voice, answers, questions, and choices influence what happens next within a structured lesson.

The experience should feel alive, without allowing an unrestricted AI model to invent the curriculum or make unverified claims about a child's understanding.

## 4. Characters and Instructors

The instructors are central to the product experience.

Each character should have a recognizable personality, communication style, and animated presence.

### Initial character concepts

**Pip the Fox — Numbers and Math**
- Curious, playful, adventurous.
- Loves counting, patterns, and solving problems.
- Uses animals, objects, and environments to introduce math concepts.
- Encourages children to discover answers themselves.

**Bo the Bear — Stories and Language**
- Calm, patient, encouraging.
- Helps with storytelling, vocabulary, and comprehension.
- Asks children to predict events and explain ideas.
- Creates a comfortable space for experimentation.

**Ollie the Owl — Science and Curiosity**
- Thoughtful, inquisitive, fascinated by the world.
- Explores animals, weather, nature, and simple scientific ideas.
- Encourages questions and observations.

**Ziggy the Frog — Shapes and Patterns**
- Energetic, silly, expressive.
- Uses movement, shapes, puzzles, and sequences.
- Makes problem-solving feel like a game.

These are exploratory character concepts, not a commitment to building four instructors.

### Potential instructor differentiation

Characters could eventually differ in:
- Personality and humour.
- Speaking pace and energy.
- Teaching approaches.
- Learning subjects.
- Animated environments.
- Types of interactive challenges.

A question worth testing: do children prefer choosing instructors, or choosing an activity and discovering which character leads it?

## 5. Core Child Experience

### Home screen

The child enters the Sprout world and sees a small selection of animated instructors or adventures.

The interface is primarily visual, with minimal reading required.

### Choosing an adventure

The child selects a character or activity.

Example:

**Pip's Butterfly Garden — Let's Count!**

Pip appears and introduces a simple problem:

"Some butterflies have landed in my garden! Can you help me find out how many?"

### Interactive lesson

1. Pip introduces the activity.
2. The environment displays an interactive scene.
3. Pip asks a question.
4. The child answers aloud.
5. Sprout interprets the response.
6. Pip responds appropriately—encouraging, clarifying, or offering a hint.
7. The scene changes when the learning objective is satisfied.
8. The experience ends with a short, positive recap.

The child might also touch objects, move items, or interact with the environment.

### Personalization

Over time, Sprout could adapt:
- Difficulty.
- Pacing.
- Types of examples.
- Amount of guidance.
- Concepts requiring additional practice.
- Preferred characters or activities.

Adaptation should be based on observable evidence and explicitly designed rules—not unsupported claims that the model has established mastery.

## 6. Learning Philosophy

Sprout should combine engaging characters with sound educational principles.

### Key principles

**Active participation**
Children should speak, count, explain, choose, and interact.

**Learning through play**
Activities should feel like adventures rather than formal exercises.

**Guided discovery**
Instructors should help children find answers rather than immediately supplying them.

**Mistakes are opportunities**
Wrong answers trigger helpful feedback and further exploration.

**Age-appropriate pacing**
Short questions, simple language, thinking time, and natural pauses.

**Observable understanding**
Finishing an activity is not automatically proof of learning.

**Healthy engagement**
Design for useful, enjoyable sessions with natural stopping points—not endless screen time or emotional dependence on characters.

### Learning evidence

Sprout should distinguish:
- Correct independent responses.
- Correct responses following assistance.
- Partial understanding.
- Misunderstandings.
- Unclear or unverified responses.
- Activities skipped or abandoned.

Parents should receive understandable summaries without overstating what the child has learned.

## 7. Content and Curriculum

### Potential learning categories

**Early mathematics**
- Counting
- Number recognition
- Comparing quantities
- Shapes
- Patterns
- Simple addition and subtraction

**Language and literacy**
- Vocabulary
- Story comprehension
- Rhyming
- Phonological awareness
- Sequencing events

**Science and discovery**
- Animals
- Nature
- Weather
- Observation
- Prediction and explanation

**Creativity and reasoning**
- Storytelling
- Problem-solving
- Imagination
- Spatial reasoning
- Simple puzzles

### Lesson structure

Each lesson should define:
- Learning objectives.
- Required concepts or skills.
- Visual scenes.
- Expected learner responses.
- Acceptable variations.
- Common misunderstandings.
- Available hints and guidance.
- Completion conditions.
- Evidence captured for the parent recap.

Lessons can share a technical foundation while retaining carefully authored educational content.

## 8. Animation and Visual World

Sprout should feel like an animated children's universe rather than a conventional education app.

### Potential art directions

**2D animated cartoon**
- Expressive characters.
- Colourful environments.
- Lightweight animation.
- Easier to prototype and iterate.

**3D animated world**
- More immersive character presentation.
- Potentially richer character identity.
- Higher production complexity and cost.

**Hybrid 2D/3D**
- 3D characters over illustrated or lightweight interactive scenes.
- Potential balance between character appeal and production complexity.

### Animation requirements

For the first version, a character might need:
- Idle animations.
- Talking and listening states.
- Eye movement and blinking.
- Happy, curious, confused, and encouraging expressions.
- Simple gestures.
- Reactions to correct and incorrect answers.

Real-time AI-generated video should not be required.

A conventional animation system driven by structured application events may provide better control, consistency, latency, and cost.

## 9. Technical Approach

Sprout already has an experimental foundation for voice-based learning.

### Existing prototype capabilities

- Real-time voice conversations using GPT-Live.
- Authored lesson definitions and learning objectives.
- Semantic interpretation of learner responses.
- Deterministic progression through lessons.
- Separation between conversational output and authoritative learning state.
- Diagnostic and session evidence collection.
- A working preschool counting prototype.

The current implementation is a prototype, not a finished animated consumer app.

### Proposed architecture

**Conversation layer**
- Handles real-time speech and dialogue.
- Expresses the instructor's personality.
- Guides the learner within the current activity.

**Lesson engine**
- Controls objectives and progression.
- Validates transitions.
- Determines when the next scene can appear.

**Learning evidence layer**
- Interprets learner responses.
- Tracks assistance and demonstrated skills.
- Avoids treating AI-generated answers as learner knowledge.

**Presentation layer**
- Renders characters, scenes, and activities.
- Responds to structured animation events.
- Supports touch and other interaction where appropriate.

**Parent experience**
- Manages profiles and permissions.
- Shows learning activity and summaries.
- Provides access to settings and subscriptions.

### Important architectural principle

**AI controls the conversation; the application controls the learning environment.**

The animated character should not have unrestricted authority to modify learning state, reveal unapproved content, or declare mastery.

## 10. Parent Experience

The parent experience is a separate part of the product.

### Initial features

- Parent-controlled child profile.
- Age-appropriate lesson selection.
- Session duration controls.
- Recent activities.
- Simple learning summaries.
- Suggested offline practice.
- Privacy and data controls.

### Future possibilities

- Learning goals and progress over time.
- Multiple children under one subscription.
- Recommendations based on demonstrated skills.
- Parent-selected subjects.
- Optional progress notifications.

### Safety and privacy

- Transparent that instructors are AI characters.
- Parent-supervised experiences for younger children.
- No unrestricted conversations or requests for personal information.
- Data minimization and clearly defined retention.
- Appropriate parental consent.
- No third-party advertising inside children's learning sessions.
- Do not depend on selling children's personal learning data.
- Review applicable children's privacy and platform requirements before deployment.

## 11. Business Model

### Primary hypothesis: Parent subscription

Sprout is a direct-to-consumer subscription product.

Potential structure:
- Free introductory lesson or limited trial.
- Monthly or annual subscription.
- Access to instructors and learning adventures.
- Multiple child profiles on a family plan.

Pricing remains an experiment.

### Distribution

Potential channels:
- Meta advertising targeted to parents.
- Parent communities.
- Parenting creators and educational content.
- Referrals between families.
- Short demonstrations of the animated character interactions.

Marketing should focus on the parent benefit, while the product experience should delight the child.

### Longer-term possibilities

- Premium themed adventures.
- Expanded subject libraries.
- Partnerships with educational organizations.
- Sponsored educational access.
- Instructor or curriculum collaborations.

Rewards, sponsorship, and financial products are separate future hypotheses—not requirements for the initial Sprout experience.

## 12. MVP

### Objective

Determine whether young children enjoy and repeatedly engage with an animated voice-driven learning experience, and whether parents perceive enough educational value to pay.

### Initial scope

**One character:** Pip the Fox.

**One subject:** Early number sense.

**One audience:** Preschoolers approximately 3–5 years old.

**One initial adventure:** Counting and comparing quantities in an interactive garden.

### MVP features

- Animated instructor with voice and expressive states.
- Simple visual learning environment.
- A small progression of authored activities.
- Real-time spoken interaction.
- Appropriate hints and correction.
- Reliable start, stop, and session recovery.
- Parent-supervised access.
- Basic session recap.
- Minimal measurement of interaction failures and learning evidence.

### Explicitly out of scope

- Full animated character roster.
- Open-ended AI-generated curriculum.
- Large content library.
- Multiplayer experiences.
- Complex gamification and virtual economies.
- Banking and financial rewards.
- Advanced parent dashboards.
- Marketplace or instructor creator tools.

## 13. Initial Experiments

### Experiment A — Character engagement

Test with a small number of children, beginning with direct observation of the prototype.

Questions:
- Does the child understand what to do?
- Does the character feel engaging?
- Does the child speak naturally to it?
- Does the character handle interruptions and mistakes?
- Does the child want another activity?
- How often must a parent intervene?

### Experiment B — Repeat usage

Invite a small group of families to use multiple activities over several weeks.

Measure:
- First-session completion.
- Repeated usage.
- Voluntary returns.
- Parent assistance required.
- Technical failures.
- Child engagement.
- Parent feedback.

### Experiment C — Learning value

Test whether children can apply practiced concepts to new examples without assistance.

Separate:
- Activity completion.
- Correctness with help.
- Independent demonstration.
- Retention and transfer to new tasks.

### Experiment D — Willingness to pay

Once the experience is reliable enough:
- Test a parent-facing landing page.
- Experiment with a clear value proposition and stated price.
- Run a limited advertising campaign.
- Measure activation, repeat use, purchase conversion, and retention.
- Track acquisition and model-delivery costs.

## 14. Longer-Term Vision

Sprout could evolve into a broader interactive learning universe.

Children have favourite instructors, discover new worlds, and explore different learning activities as they grow.

Potential extensions include:
- A larger cast of AI instructors.
- More structured learning pathways.
- Interactive storytelling and world exploration.
- New adventures released regularly.
- Seasonal or themed classes.
- Personalized recommendations.
- Learning activities that involve real-world movement and objects.
- Parent-selected educational goals.
- Partnerships with curriculum creators.

The core product should remain focused on learning through active participation rather than maximizing screen time.

## 15. Open Product Questions

### Brand and characters
- Is Sprout the right consumer-facing name?
- Should the product be called Sprout Club?
- Should the home screen prioritize instructors, subjects, or adventures?
- Can children build familiarity with characters without creating unhealthy emotional dependence?
- What visual style is most compelling and economical?

### Learning experience
- How much conversation should be open-ended?
- How should voice and touch interact?
- What is the ideal lesson duration for a preschooler?
- How much adult supervision should be expected?
- How should children navigate without needing to read?

### Technology
- Is the current real-time voice stack responsive enough?
- How should speech be handled when children hesitate, interrupt, or speak unclearly?
- How should character animation synchronize with speech?
- What learning evidence is reliable enough to show parents?
- What is the cost per useful learning session?

### Business
- What benefit makes parents subscribe?
- Is the character experience a meaningful differentiator?
- What causes families to return after the novelty fades?
- What acquisition channels can work profitably?
- Could a narrow educational focus outperform a broad activity library?

## 16. Product Thesis

Sprout's potential differentiation is the combination of:

1. **Beloved animated characters** that make the learning experience enjoyable.
2. **Real-time conversation** that allows children to participate naturally.
3. **Structured educational experiences** rather than unrestricted chatbot interactions.
4. **Evidence of demonstrated learning** rather than simple activity completion.
5. **Parent trust and visibility** into the experience.

**The central hypothesis:**

Children will be more motivated to learn when they interact with engaging animated instructors who listen and respond to them, while parents will pay for an experience that produces meaningful educational value.

The first objective is not to prove that Sprout can support every subject or age group.

It is to prove that **one animated instructor, teaching one set of concepts, can create an experience children enjoy returning to and parents value.**