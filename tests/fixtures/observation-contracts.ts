import type { CanonicalObservationRecord, ObserverProposal, SupportKind } from "../../lib/observation-contracts";

/** These are invented contract examples, not delivered session evidence or provider results. */
export type SyntheticObservationFixture = {
  fixtureStatus: "synthetic_example_not_delivered_evidence";
  name: string;
  record: CanonicalObservationRecord;
  proposal?: ObserverProposal;
};

function fixture(
  name: string,
  response: { _id: string; atMs: number; evidence?: CanonicalObservationRecord["events"][number]["evidence"] },
  options: {
    scene?: { _id: string; atMs: number; targetQuantity: number };
    support?: {
      _id: string;
      atMs: number;
      source: "sprout" | "parent" | "other";
      description: string;
      kinds: SupportKind[];
    };
    uncertain?: "ambiguous_speaker" | "unclear_speech" | "disrupted_exchange" | "missing_scene_context";
    behavior?: "quantity_identification" | "counting_aloud_with_total";
    statedTotal?: number;
  } = {},
): SyntheticObservationFixture {
  const record: CanonicalObservationRecord = {
    session: { _id: "sessions_synthetic", state: "ended", recordStatus: "complete" },
    events: [
      ...(options.scene
        ? [
            {
              _id: options.scene._id,
              atMs: options.scene.atMs,
              evidence: {
                type: "scene_displayed" as const,
                sceneId: "ducks-3",
                targetQuantity: options.scene.targetQuantity,
                items: [{ emoji: "🦆", label: "duck" }],
                arrangement: "row",
              },
            },
          ]
        : []),
      ...(options.support
        ? [
            {
              _id: options.support._id,
              atMs: options.support.atMs,
              evidence: {
                type: "support" as const,
                source: options.support.source,
                mode: "spoken" as const,
                description: options.support.description,
              },
            },
          ]
        : []),
      ...(response.evidence ? [{ _id: response._id, atMs: response.atMs, evidence: response.evidence }] : []),
    ],
  };
  const proposal = options.uncertain
    ? {
        kind: "observer_proposal" as const,
        proposalId: `proposal-${name}`,
        sessionId: record.session._id,
        exchangeAtMs: response.atMs,
        observation: {
          behavior: "uncertain_exchange" as const,
          outcome: "uncertain" as const,
          speakerAttribution:
            response.evidence?.type === "utterance" && response.evidence.speaker === "unknown"
              ? ("unknown" as const)
              : ("child_or_nearby_speaker" as const),
          countSequenceObserved: false,
          ...(options.scene ? { targetQuantity: options.scene.targetQuantity } : {}),
          description: "The exchange does not support a determinate counting observation.",
          support: { status: "not_established" as const, kinds: [], sourceEventIds: [] },
          uncertaintyReasons: [options.uncertain],
        },
        sources: [
          ...(options.scene ? [{ eventId: options.scene._id, role: "scene" as const }] : []),
          ...(response.evidence ? [{ eventId: response._id, role: "response" as const }] : []),
        ],
      }
    : options.behavior
      ? {
          kind: "observer_proposal" as const,
          proposalId: `proposal-${name}`,
          sessionId: record.session._id,
          exchangeAtMs: response.atMs,
          observation: {
            behavior: options.behavior,
            outcome:
              options.statedTotal === options.scene?.targetQuantity ? ("correct" as const) : ("incorrect" as const),
            speakerAttribution: "child_or_nearby_speaker" as const,
            statedTotal: options.statedTotal,
            countSequenceObserved: options.behavior === "counting_aloud_with_total",
            targetQuantity: options.scene?.targetQuantity ?? 3,
            description: "The synthetic response is described only in relation to the recorded scene.",
            support: options.support
              ? { status: "recorded" as const, kinds: options.support.kinds, sourceEventIds: [options.support._id] }
              : { status: "not_established" as const, kinds: [], sourceEventIds: [] },
            uncertaintyReasons: [],
          },
          sources: [
            ...(options.scene ? [{ eventId: options.scene._id, role: "scene" as const }] : []),
            { eventId: response._id, role: "response" as const },
            ...(options.support ? [{ eventId: options.support._id, role: "support" as const }] : []),
          ],
        }
      : undefined;
  if (name === "wrong-scene-context" && proposal) proposal.observation.targetQuantity = 3;
  return { fixtureStatus: "synthetic_example_not_delivered_evidence", name, record, proposal };
}

export const observationFixtures: SyntheticObservationFixture[] = [
  fixture(
    "correct-total-without-spoken-count",
    {
      _id: "sessionEvents_synthetic_answer_1",
      atMs: 1800,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "Three",
        startMs: 1700,
        endMs: 1900,
        state: "finalized",
      },
    },
    {
      scene: { _id: "sessionEvents_synthetic_scene_1", atMs: 900, targetQuantity: 3 },
      behavior: "quantity_identification",
      statedTotal: 3,
    },
  ),
  fixture(
    "counting-aloud-with-total",
    {
      _id: "sessionEvents_synthetic_answer_2",
      atMs: 2200,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "One, two, three",
        startMs: 1700,
        endMs: 2200,
        state: "finalized",
      },
    },
    {
      scene: { _id: "sessionEvents_synthetic_scene_2", atMs: 800, targetQuantity: 3 },
      behavior: "counting_aloud_with_total",
      statedTotal: 3,
    },
  ),
  fixture(
    "hint-and-counting-together",
    {
      _id: "sessionEvents_synthetic_answer_3",
      atMs: 3600,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "One, two, three",
        startMs: 3100,
        endMs: 3600,
        state: "finalized",
      },
    },
    {
      scene: { _id: "sessionEvents_synthetic_scene_3", atMs: 900, targetQuantity: 3 },
      support: {
        _id: "sessionEvents_synthetic_support_3",
        atMs: 1200,
        source: "sprout",
        description: "Try starting with one; count with me.",
        kinds: ["hint", "counting_together"],
      },
      behavior: "counting_aloud_with_total",
      statedTotal: 3,
    },
  ),
  fixture(
    "parent-reported-assistance",
    {
      _id: "sessionEvents_synthetic_answer_4",
      atMs: 2800,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "Three",
        startMs: 2600,
        endMs: 2800,
        state: "finalized",
      },
    },
    {
      scene: { _id: "sessionEvents_synthetic_scene_4", atMs: 900, targetQuantity: 3 },
      support: {
        _id: "sessionEvents_synthetic_support_4",
        atMs: 2500,
        source: "parent",
        description: "Parent reports giving a hint before the response.",
        kinds: ["parent_reported_assistance"],
      },
      behavior: "quantity_identification",
      statedTotal: 3,
    },
  ),
  fixture(
    "ambiguous-speaker",
    {
      _id: "sessionEvents_synthetic_answer_5",
      atMs: 1900,
      evidence: {
        type: "utterance",
        speaker: "unknown",
        text: "Three?",
        startMs: 1700,
        endMs: 1900,
        state: "finalized",
      },
    },
    { scene: { _id: "sessionEvents_synthetic_scene_5", atMs: 900, targetQuantity: 3 }, uncertain: "ambiguous_speaker" },
  ),
  fixture(
    "unclear-speech",
    {
      _id: "sessionEvents_synthetic_answer_6",
      atMs: 2100,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "[unclear]",
        startMs: 1800,
        endMs: 2100,
        state: "interrupted",
      },
    },
    { scene: { _id: "sessionEvents_synthetic_scene_6", atMs: 900, targetQuantity: 3 }, uncertain: "unclear_speech" },
  ),
  fixture(
    "interrupted-exchange",
    {
      _id: "sessionEvents_synthetic_answer_7",
      atMs: 1600,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "One, two—",
        startMs: 1100,
        endMs: 1600,
        state: "interrupted",
      },
    },
    {
      scene: { _id: "sessionEvents_synthetic_scene_7", atMs: 900, targetQuantity: 3 },
      uncertain: "disrupted_exchange",
    },
  ),
  fixture(
    "missing-scene-context-concrete-claim-rejected",
    {
      _id: "sessionEvents_synthetic_answer_8",
      atMs: 1800,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "Three",
        startMs: 1600,
        endMs: 1800,
        state: "finalized",
      },
    },
    { behavior: "quantity_identification", statedTotal: 3 },
  ),
  fixture(
    "missing-scene-context-uncertain",
    {
      _id: "sessionEvents_synthetic_answer_10",
      atMs: 1800,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "Three",
        startMs: 1600,
        endMs: 1800,
        state: "finalized",
      },
    },
    { uncertain: "missing_scene_context" },
  ),
  fixture(
    "wrong-scene-context",
    {
      _id: "sessionEvents_synthetic_answer_9",
      atMs: 1800,
      evidence: {
        type: "utterance",
        speaker: "child_or_nearby_speaker",
        text: "Three",
        startMs: 1600,
        endMs: 1800,
        state: "finalized",
      },
    },
    {
      scene: { _id: "sessionEvents_synthetic_scene_9", atMs: 900, targetQuantity: 4 },
      behavior: "quantity_identification",
      statedTotal: 3,
    },
  ),
  fixture("silence-produces-no-observation", {
    _id: "sessionEvents_synthetic_scene_11",
    atMs: 1200,
  }),
];
