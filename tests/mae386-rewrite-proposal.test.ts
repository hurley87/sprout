import { describe, expect, it } from "vitest";
import { MAE386_LESSON as lesson } from "../lib/lesson-runtime/mae386-lesson";
import { REWRITE_RUBRIC } from "../lib/lesson-runtime/mae386/rewrite-rubric";
import {
  projectRewrite,
  rewriteWords,
  type RewriteProposal,
  type RewriteTranscript,
} from "../lib/lesson-runtime/mae386/rewrite-proposal";
import {
  conversationStateQuestions,
  mapConversationObservation,
  normalizeConversationOutputs,
  type ConversationStateOutputs,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { classificationSource, runtimeSource } from "../lib/lesson-runtime/lesson-runtime-reducer";
import { parseConversationStateProposal } from "../lib/lesson-runtime/conversation-state-classifier";
import { transcriptMessages } from "../lib/lesson-runtime/tutor-observation";
import { createReducerHarness } from "./helpers/runtime-harness";
import { parseLiveClassificationDiagnostic } from "../lib/lesson-runtime/live-classification-diagnostic";
import {
  CLASSIFIER_VERSION,
  CONVERSATION_CLASSIFICATION_THRESHOLDS,
} from "../lib/lesson-runtime/conversation-observer-contract";
import { COUNTING_LESSON } from "../lib/lesson-runtime/counting-lesson";
import { CATCHING_UNICORNS_LESSON } from "../lib/lesson-runtime/catching-unicorns-lesson";

const correct: RewriteProposal["criteria"] = {
  meaning: "demonstrated",
  concise: "demonstrated",
  grammatical: "demonstrated",
};
const wrong: RewriteProposal["criteria"] = { meaning: "incorrect", concise: "incorrect", grammatical: "demonstrated" };
function selection(transcript: string, text: string, options: Partial<RewriteProposal> = {}): RewriteProposal {
  const words = rewriteWords(transcript),
    tokens = text.split(/\s+/u);
  const start = words.findLastIndex((_, i) => tokens.every((word, j) => words[i + j]?.text === word));
  if (start < 0) throw new Error(`Missing fixture span ${text}`);
  return {
    state: "complete",
    start: words[start].id,
    end: words[start + tokens.length - 1].id,
    assistance: "independent",
    criteria: correct,
    ...options,
  };
}
function body(nodeId: string, transcript: string, selected: RewriteProposal) {
  const choices: Record<string, string> = {
    objectiveState: "unclear_or_incomplete",
    tutorState: "asking",
    rewrite_state: selected.state,
    rewrite_start: selected.start,
    rewrite_end: selected.end,
    rewrite_assistance: selected.assistance,
    ...Object.fromEntries(Object.entries(selected.criteria).map(([id, value]) => [`rewrite_${id}`, value])),
  };
  return {
    answers: Object.fromEntries(
      Object.entries(conversationStateQuestions(lesson, nodeId, transcript)).map(([id, q]) => {
        const choice = choices[id] ?? (id.startsWith("concept_") ? "not_yet" : "none");
        return [
          id,
          {
            type: "choice",
            choice,
            confidence: 1,
            probabilities: Object.fromEntries(Object.keys(q.criteria).map(key => [key, Number(key === choice)])),
          },
        ];
      }),
    ),
  };
}
function mapped(nodeId: string, transcript: string, selected: RewriteProposal, revision = 1) {
  const outputs = normalizeConversationOutputs(body(nodeId, transcript, selected), lesson, nodeId, transcript)!;
  expect(outputs).not.toBeNull();
  return mapConversationObservation({ lesson, nodeId, transcriptRevision: revision, transcript }, outputs);
}
function harness(nodeId = "q10-1") {
  const h = createReducerHarness("rewrite", { lesson: { ...lesson, initialNodeId: nodeId } });
  function observe(transcript: string, selected: RewriteProposal, turnMap?: RewriteTranscript["turns"]) {
    h.send({ type: "child.turn.started", source: runtimeSource(h.state) });
    const revision = h.state.transcriptRevision + 1;
    const turns =
      turnMap ??
      (transcriptMessages(transcript) ?? []).flatMap((message, messageIndex) =>
        message.speaker === "Child"
          ? [{ messageIndex, start: 0, end: message.text.length, childTurnId: h.state.childTurnId }]
          : [],
      );
    h.send({
      type: "transcript.updated",
      source: runtimeSource(h.state),
      revision,
      speaker: "child",
      transcriptSnapshot: transcript,
      rewriteTranscript: { text: transcript, turns },
    });
    h.send({ type: "child.turn.ended", source: runtimeSource(h.state) });
    const source = classificationSource(h.state)!;
    const decision = mapped(nodeId, transcript, selected, revision);
    const event = {
      type: "proposal.received" as const,
      source,
      proposal: decision.proposal,
      transcriptSnapshot: transcript,
    };
    h.send(event);
    return { event, decision };
  }
  return {
    h,
    observe,
    get current() {
      return h.state.rewriteProposals?.[nodeId]?.current;
    },
  };
}

// Semantic labels and selected spans below are authored provider fixtures, NOT a
// local language grader or evidence of live Jev semantic selection reliability.
describe.each(REWRITE_RUBRIC.units)("current proposal for $id", unit => {
  const sample = (suffix: string) => unit.examples.find(example => example.name === `${unit.id}-${suffix}`)!;
  const good = sample("complete").turns[0].text;
  const bad = sample("meaning-changed").turns[0].text;
  it("retains partial criterion coverage and unresolved transcription without inventing success", () => {
    const t = harness(unit.id);
    const partial = sample("partial").turns[0].text;
    t.observe(
      `Child: ${partial}`,
      selection(`Child: ${partial}`, partial, {
        criteria: { meaning: "partial", concise: "partial", grammatical: "demonstrated" },
      }),
    );
    expect(t.current?.outcome).toBe("partial");
    const ambiguous = sample("unclear-transcription").turns[0].text;
    t.observe(`Child: ${ambiguous}`, {
      state: "unresolved",
      start: "none",
      end: "none",
      assistance: "unknown",
      criteria: correct,
    });
    expect(t.current?.outcome).toBe("unresolved");
  });
  it("replaces a correct answer with a later incorrect answer without borrowing credit", () => {
    const t = harness(unit.id);
    t.observe(`Child: ${good}`, selection(`Child: ${good}`, good));
    expect(t.current?.outcome).toBe("independent");
    const transcript = `Child: ${good}\nChild: Actually replace that with: ${bad}`;
    t.observe(transcript, selection(transcript, bad, { criteria: wrong }));
    expect(t.current).toMatchObject({
      text: bad,
      outcome: "incorrect",
      source: { nodeId: unit.id, transcriptRevision: 2 },
    });
    expect(t.h.state.rewriteProposals?.[unit.id]?.history.map(attempt => attempt.outcome)).toEqual([
      "independent",
      "incorrect",
    ]);
    expect(t.current?.selection.criteria).toEqual(wrong);
  });
  it("accepts an incorrect to correct replacement and both genuine alternative formulations", () => {
    const t = harness(unit.id);
    t.observe(`Child: ${bad}`, selection(`Child: ${bad}`, bad, { criteria: wrong }));
    for (const suffix of ["alternate", "modest-valid-reduction"]) {
      const alternate = sample(suffix).turns[0].text;
      const transcript = `Child: ${bad}\nChild: No, my revision is: ${alternate}`;
      t.observe(transcript, selection(transcript, alternate));
      expect(t.current).toMatchObject({ text: alternate, outcome: "independent" });
    }
  });
  it("does not resurrect the only correct answer after explicit withdrawal", () => {
    const t = harness(unit.id),
      withdrawal = "I withdraw my answer. I haven't got a replacement yet.";
    t.observe(`Child: ${good}`, selection(`Child: ${good}`, good));
    const transcript = `Child: ${good}\nChild: ${withdrawal}`;
    t.observe(transcript, selection(transcript, withdrawal, { state: "withdrawn" }));
    expect(t.current).toMatchObject({ outcome: "unresolved", text: withdrawal, selection: { state: "withdrawn" } });
    expect(t.h.state.rewriteProposals?.[unit.id]?.history[0].text).toBe(good);
  });
  it("retains the selected proposal through an aside and an unfinished non-withdrawing edit", () => {
    const t = harness(unit.id);
    for (const aside of ["That wording reminds me of an email I received.", "Maybe I could also say..."]) {
      const transcript = `Child: ${good}\nChild: ${aside}`;
      t.observe(transcript, selection(transcript, good));
      expect(t.current).toMatchObject({ outcome: "independent", text: good });
    }
  });
  it("separates a quoted original from a rewrite in the same learner message", () => {
    const transcript = `Child: The original says, ${unit.visibleSource} My revision is: ${good}`;
    const t = harness(unit.id);
    t.observe(transcript, selection(transcript, good));
    expect(t.current?.text).toBe(good);
    expect(t.current?.context[0].text).toContain(unit.visibleSource);
    expect(t.current?.words[0].start).toBeGreaterThan(unit.visibleSource!.length);
  });
  it("does not confuse source access with a tutor-supplied rewrite when the learner proposes an incorrect excerpt", () => {
    const excerpt = unit.visibleSource!.split(" ").slice(0, 4).join(" ");
    const transcript = `Tutor: The original is: ${unit.visibleSource} How would you revise it?\nChild: ${excerpt}`;
    const t = harness(unit.id);
    t.observe(transcript, selection(transcript, excerpt, { criteria: wrong }));
    expect(t.current).toMatchObject({ text: excerpt, outcome: "incorrect", selection: { assistance: "independent" } });
  });
  it("rejects unchanged source and tutor-solution echoes even with overconfident success scores", () => {
    const t = harness(unit.id);
    const original = `Tutor: ${unit.visibleSource}\nChild: ${unit.visibleSource}`;
    t.observe(original, selection(original, unit.visibleSource!));
    expect(t.current?.outcome).toBe("not_demonstrated");
    const echo = `Tutor: You could say: ${good}\nChild: ${good}`;
    t.observe(echo, selection(echo, good));
    expect(t.current).toMatchObject({ outcome: "not_demonstrated", selection: { assistance: "echo" } });
    const none = {
      state: "none",
      start: "none",
      end: "none",
      assistance: "unknown",
      criteria: correct,
    } as RewriteProposal;
    t.observe(original, none);
    expect(t.current).toMatchObject({ outcome: "not_demonstrated", text: null });
  });
  it("tracks fragmented self-correction and exact authenticated turns, excluding the abandoned proposal", () => {
    const pieces = good.split(" ");
    const first = pieces.slice(0, 3).join(" "),
      last = pieces.slice(3).join(" ");
    const prefix = `Child: ${bad}\nChild: No, replace that with: ${first}`;
    const transcript = `${prefix}\nTutor: Mm-hm.\nChild: ${last}`;
    const t = harness(unit.id);
    const words = rewriteWords(transcript);
    const start = words.findLastIndex((word, index) => word.text === pieces[0] && words[index + 1]?.text === pieces[1]);
    const selected = {
      state: "complete",
      start: words[start].id,
      end: words.at(-1)!.id,
      assistance: "independent",
      criteria: correct,
    } as RewriteProposal;
    const length = transcriptMessages(prefix)![0].text.length;
    t.observe(transcript, selected, [
      { messageIndex: 0, start: 0, end: bad.length, childTurnId: 1 },
      { messageIndex: 0, start: bad.length + 1, end: length, childTurnId: 2 },
      { messageIndex: 2, start: 0, end: last.length, childTurnId: 3 },
    ]);
    expect(t.current).toMatchObject({ text: good, outcome: "independent" });
    expect([...new Set(t.current?.words.map(word => word.childTurnId))]).toEqual([2, 3]);
    expect(t.current?.context.map(message => message.speaker)).toEqual(["Child", "Tutor", "Child"]);
  });
  it("attributes relevant help to the latest selected proposal, not an earlier independent attempt", () => {
    const alternate = sample("alternate").turns[0].text;
    const hint = sample("help-and-own-revision").turns[0].text;
    const transcript = `Child: ${good}\nTutor: ${hint}\nChild: My revised answer is: ${alternate}`;
    const t = harness(unit.id);
    t.observe(`Child: ${good}`, selection(`Child: ${good}`, good));
    t.observe(transcript, selection(transcript, alternate, { assistance: "assisted" }));
    expect(t.current).toMatchObject({ text: alternate, outcome: "assisted", selection: { assistance: "assisted" } });
    expect(t.h.state.rewriteProposals?.[unit.id]?.history[0].outcome).toBe("independent");
  });
});

it("exposes opt-in questions with a shared proposal and unchanged cumulative source selection", () => {
  const questions = conversationStateQuestions(lesson, "q10-1", "Child: He was late because he overslept.");
  expect(questions.source_meaning.instructions).toContain("earliest");
  for (const id of ["meaning", "concise", "grammatical"]) {
    expect(questions[`rewrite_${id}`].instructions).toContain("SAME selected current proposal");
    expect(questions[`rewrite_${id}`].instructions).toContain(
      lesson.nodes["q10-1"].concepts!.find(c => c.id === id)!.description,
    );
  }
  for (const other of [COUNTING_LESSON, CATCHING_UNICORNS_LESSON]) {
    expect(
      Object.keys(conversationStateQuestions(other, other.initialNodeId, "Child: An answer.")).some(key =>
        key.startsWith("rewrite_"),
      ),
    ).toBe(false);
    expect(createReducerHarness("legacy", { lesson: other }).state.rewriteProposals).toBeUndefined();
  }
});

it("fails closed on missing, stale, reversed and tutor-owned word locators and uncertain scores", () => {
  const transcript = "Tutor: Try again.\nChild: He was late because he overslept.";
  const selected = selection(transcript, "He was late because he overslept.");
  const invalid = body("q10-1", transcript, selected);
  delete invalid.answers.rewrite_end;
  expect(normalizeConversationOutputs(invalid, lesson, "q10-1", transcript)).toBeNull();
  for (const start of ["word_0_0", "word_8_0"]) {
    expect(
      normalizeConversationOutputs(body("q10-1", transcript, { ...selected, start }), lesson, "q10-1", transcript),
    ).toBeNull();
  }
  const t = harness();
  t.observe(transcript, { ...selected, start: selected.end, end: selected.start });
  expect(t.current?.outcome).toBe("unresolved");
  const raw = body("q10-1", transcript, selected);
  const scores = raw.answers.rewrite_start;
  scores.confidence = 0.5;
  scores.probabilities[scores.choice] = 0.5;
  scores.probabilities.none = 0.5;
  const outputs = normalizeConversationOutputs(raw, lesson, "q10-1", transcript)!;
  const mapped = mapConversationObservation({ lesson, nodeId: "q10-1", transcriptRevision: 1, transcript }, outputs);
  expect(mapped.proposal?.currentRewrite?.start).toBe("none");
  expect(
    parseConversationStateProposal({
      ...mapped.proposal,
      currentRewrite: { ...selected, criteria: { meaning: "demonstrated" } },
    }),
  ).toBeNull();
});

it("rejects stale source identities and revised transcript contents, keeping sibling sentences isolated", () => {
  const t = harness();
  const transcript = "Child: He was late because he overslept.";
  const { event } = t.observe(transcript, selection(transcript, "He was late because he overslept."));
  const previous = t.h.state.rewriteProposals;
  for (const source of [
    { ...event.source, visitId: 99 },
    { ...event.source, childTurnId: 99 },
    { ...event.source, runtimeId: "stale" },
    { ...event.source, nodeId: "q10-2" },
  ]) {
    t.h.send({ ...event, source });
    expect(t.h.state.rewriteProposals).toBe(previous);
  }
  t.h.send({
    type: "transcript.updated",
    source: runtimeSource(t.h.state),
    speaker: "child",
    revision: 2,
    transcriptSnapshot: "Child: He left.",
  });
  expect(t.current).toBeNull();
  t.h.send(event);
  expect(t.current).toBeNull();
  const fresh = {
    ...event,
    source: { ...event.source, transcriptRevision: 2 },
    proposal: { ...event.proposal!, transcriptRevision: 2 },
  };
  t.h.send(fresh);
  expect(t.current).toBeNull(); // Same revision with changed literal snapshot cannot select old words.
  expect(t.h.state.rewriteProposals?.["q10-2"]).toBeUndefined();
  expect(t.h.state.rewriteProposals?.["q10-3"]).toBeUndefined();
});

it("keeps the cumulative ledger's stronger independent demonstration when current rewrite worsens", () => {
  const t = harness();
  const good = "He was late because he overslept.",
    bad = "He overslept because he was late.";
  const first = `Child: ${good}`;
  const apply = (transcript: string, selected: RewriteProposal, index: number) => {
    t.h.send({ type: "child.turn.started", source: runtimeSource(t.h.state) });
    const revision = t.h.state.transcriptRevision + 1;
    t.h.send({
      type: "transcript.updated",
      source: runtimeSource(t.h.state),
      speaker: "child",
      revision,
      transcriptSnapshot: transcript,
      rewriteTranscript: {
        text: transcript,
        turns: (transcriptMessages(transcript) ?? []).flatMap((message, messageIndex) =>
          message.speaker === "Child"
            ? [{ messageIndex, start: 0, end: message.text.length, childTurnId: t.h.state.childTurnId }]
            : [],
        ),
      },
    });
    t.h.send({ type: "child.turn.ended", source: runtimeSource(t.h.state) });
    const proposal = mapped("q10-1", transcript, selected, revision).proposal!;
    t.h.send({
      type: "proposal.received",
      source: classificationSource(t.h.state)!,
      transcriptSnapshot: transcript,
      proposal: {
        ...proposal,
        conceptObservations: [
          {
            criterionId: "meaning",
            observation: revision === 1 ? "demonstrated_independent" : "partial",
            childMessageIndex: index,
          },
        ],
      },
    });
  };
  apply(first, selection(first, good), 0);
  const accepted = t.h.state.conceptEvidence["q10-1:meaning"];
  const later = `${first}\nTutor: Any revision?\nChild: ${bad}`;
  apply(later, selection(later, bad, { criteria: wrong }), 2);
  expect(t.current?.outcome).toBe("incorrect");
  expect(t.h.state.conceptEvidence["q10-1:meaning"].source).toEqual(accepted.source);
  expect(t.h.state.conceptEvidence["q10-1:meaning"].understanding).toBe("independent");
});

it("round-trips Q10 selection scores through redacted classifier diagnostics", () => {
  const transcript = "Child: He was late because he overslept.";
  const decision = mapped("q10-1", transcript, selection(transcript, "He was late because he overslept."));
  const diagnostic = {
    classifierVersion: CLASSIFIER_VERSION,
    rewriteAssessment: "complete",
    decision: decision.status,
    outcome: decision.outcome,
    outputs: decision.outputs as ConversationStateOutputs,
    labelCompletionEligible: decision.labelCompletionEligible,
    thresholds: CONVERSATION_CLASSIFICATION_THRESHOLDS,
    nodeId: "q10-1",
    transcriptRevision: 1,
    elapsedMs: 1,
  };
  expect(parseLiveClassificationDiagnostic(diagnostic, lesson, "q10-1", transcript)?.rewriteAssessment).toBe(
    "complete",
  );
  expect(parseLiveClassificationDiagnostic(diagnostic, lesson, "q10-1", transcript)?.outputs?.rewrite).toEqual(
    decision.outputs?.rewrite,
  );
});

it("leaves proposal claims unresolved without authenticated word-level turn attribution", () => {
  const transcript = "Child: He was late because he overslept.";
  const selected = selection(transcript, "He was late because he overslept.");
  const source = { runtimeId: "test", nodeId: "q10-1", visitId: 1, childTurnId: 1, transcriptRevision: 1 };
  expect(projectRewrite(selected, source, transcript).outcome).toBe("unresolved");
  expect(projectRewrite(selected, source, transcript, { text: "revised", turns: [] }).outcome).toBe("unresolved");
});

it("rejects a rewrite opt-in without source text or the authored criterion set", async () => {
  const { validateLessonDefinition } = await import("../lib/lesson-runtime/lesson-definition");
  for (const node of [
    { ...lesson.nodes["q10-1"], presentation: {} },
    { ...lesson.nodes["q10-1"], concepts: [] },
  ]) {
    expect(() => validateLessonDefinition({ ...lesson, nodes: { ...lesson.nodes, "q10-1": node } })).toThrow(
      "three authored rewrite criteria",
    );
  }
});
