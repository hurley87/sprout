# Research note: Play, intentional teaching, and learning evidence

**Reviewed:** 2026-11-03. **Method:** targeted reading of official NAEYC guidance and the IES/What Works Clearinghouse preschool practice-guide recommendation summary. We have not reviewed every underlying study or tested these recommendations in Sprout.

## Source findings

### NAEYC: developmentally appropriate practice

NAEYC describes practice that builds on children's strengths and uses play to support engaged learning. Decisions consider common developmental knowledge, the individual child, and the child's context. Cultural, linguistic, and ability differences belong in that decision process. This is professional guidance, not evidence that a particular app works. [Source: defining developmentally appropriate practice](https://www.naeyc.org/resources/position-statements/dap/definition).

### NAEYC: teaching

The guidance combines child-directed play, guided play, and direct instruction. Meaningful choice can coexist with planned learning goals. Demonstrations and vocabulary instruction can support exploration. It also calls for multiple ways to engage, encounter content, and express understanding. Its scope includes birth through age eight. [Source: teaching to enhance development and learning](https://www.naeyc.org/node/3812).

### NAEYC: observation and assessment

Assessment should inform teaching and account for language, context, and uneven development. Observations can arise during ordinary play and conversation. The guidance stresses appropriate validity and reliability, multiple information sources for consequential decisions, and limits on digital assessment. This does not endorse automatic mastery judgments from conversational AI. [Source: observing, documenting, and assessing](https://www.naeyc.org/resources/position-statements/dap/assessing-development).

### IES / What Works Clearinghouse: Preparing Young Children for School

The August 2022 guide provides seven recommendations. The ratings below are the guide's ratings for the recommendations, not ratings of Sprout, AI tutors, or our proposed implementations. [Source: official recommendation summary](https://ies.ed.gov/ncee/wwc/PracticeGuide/30).

| Recommendation, paraphrased | Published evidence rating |
| --- | --- |
| Intentionally teach and practice social-emotional skills | Strong |
| Use specific games and activities for executive-function skills | Moderate |
| Intentionally teach mathematical concepts and skills | Strong |
| Discuss mathematical ideas and language | Moderate |
| Plan vocabulary and language instruction | Strong |
| Develop letter and sound knowledge | Strong |
| Use shared reading to support language, print knowledge, and world knowledge | Strong |

The recommendation-level evidence does not establish which digital interaction, age band, or session length Sprout should adopt. The full guide and individual studies would need closer examination before making intervention-specific efficacy claims.

## Sprout design proposals derived from this review

The following are our design hypotheses, not prescribed protocols from the sources.

| Proposal | What it means in an experience | What to test |
| --- | --- | --- |
| Give the child a purpose | Prepare a picnic or finish a broadcast | Does the child understand and care about the task? |
| Teach before expecting unfamiliar knowledge | Brief demonstration, then supported action | Does the support help on a subsequent fresh example? |
| Preserve meaningful choice | Choose an experience, decoration, or optional continuation | Can the choice be offered without obscuring the learning task? |
| Make consequences visible | A spoken selection moves an authored object or completes a pattern | Does the child understand the relationship between their answer and the scene? |
| Separate learning from speech handling | Clarify uncertain audio without marking the skill wrong | Are adult-observed answers represented accurately? |
| Check beyond the rehearsed example | Change objects, layout, or word pair within validated bounds | Does performance persist when familiar cues change? |
| Return gently to uncertain skills | Offer a fresh review on a later visit | Is later performance more independent? |

The proposed lesson rhythm is **invitation → brief demonstration if needed → supported activity → fresh attempt → optional continuation → ending**. It is a reusable starting pattern, not a requirement that every subject follow the same pedagogy.

## What would count as useful evidence?

Separate four observations:

1. The child finished the activity.
2. The child responded correctly after help.
3. The child responded independently to a fresh equivalent example.
4. The child did so again on a later occasion.

These observations answer different questions. Neither engagement nor a single correct answer establishes learning gain. Record a child's initial attempt when available: a child who could already do the task has demonstrated prior ability, not necessarily learned it from Sprout.

For open creative tasks, record a description of participation or an authored observable feature. Do not turn aesthetic choices or imaginative responses into arbitrary right/wrong scores.

## Product risks to test explicitly

- A decorated quiz may attract initial attention without creating meaningful agency.
- The tutor can accidentally supply the answer before the child attempts the task.
- Two-choice activities allow guessing; a few successes are weak evidence.
- Repeating the same images or words can reward memorization of the presentation.
- A requirement to name an unfamiliar object can confound a rhyme or quantity task.
- Voice-only input limits who can participate and which actions the app can observe.

These risks follow from the proposed product design. Their frequency and severity in Sprout are unknown. The [pilot plan](../12-pilot-and-validation.md) specifies observations that can resolve them.
