import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createFactoredClassifier,
  factoredRequest,
  promptingRequest,
} from "../lib/experiments/issue-42/factored-decisions";
import { decisionsRequest, type DecisionsRequest } from "../lib/experiments/issue-42/decisions-classifier";
import { replayReducer } from "../lib/experiments/issue-42/provider-comparison";
import { input, policy, body } from "./helpers/factored-controls";
const signal = () => new AbortController().signal;

function setup(demonstration = "demonstrated", prompting = "independent", source = "message_1") {
  const transport = vi.fn(async (req: DecisionsRequest) => ({
    ok: true,
    body: body(req, demonstration, prompting, source),
  }));
  return { transport, ...createFactoredClassifier({ transport, mappingPolicy: policy }) };
}
afterEach(() => vi.useRealTimers());
it("isolates direct design and preserves frozen evidence, criteria and source options", () => {
  const d = decisionsRequest(input)!;
  const before = structuredClone(d);
  const f = factoredRequest(input)!;
  expect(f.input).toBe(d.input);
  expect(f.model).toBe("gpt-6-luna");
  expect(f.questions.filter(q => !q.name.startsWith("demonstration_"))).toEqual(
    d.questions.filter(q => !q.name.startsWith("concept_")),
  );
  for (const c of input.lesson!.nodes.engram.concepts!)
    expect(f.questions.find(q => q.name === `demonstration_${c.id}`)!.instructions).toContain(c.description);
  expect(f.questions.some(q => q.name.startsWith("prompting_"))).toBe(false);
  expect(decisionsRequest(input)).toEqual(before);
});
it.each(["independent", "prompted", "unresolved"])(
  "conditionally asks prompting and maps %s with exact identity",
  async prompting => {
    const a = setup("demonstrated", prompting);
    const r = await a.classifyWithDiagnostics(input, signal());
    expect(a.transport).toHaveBeenCalledTimes(2);
    expect(a.transport.mock.calls[1][0].input).toBe(a.transport.mock.calls[0][0].input);
    expect(a.transport.mock.calls[1][0].questions.every(q => q.name.startsWith("prompting_"))).toBe(true);
    expect(r.outputs).toBeNull();
    expect(r.proposal).toMatchObject({
      nodeId: "engram",
      transcriptRevision: 7,
      conceptObservations: [
        {
          observation: prompting === "unresolved" ? "demonstrated_unattributed" : `demonstrated_${prompting}`,
          childMessageIndex: 1,
        },
      ],
    });
    expect(replayReducer(input, r.proposal, true).proposalAccepted).toBe(false);
  },
);
it.each(["uncertain", "partial", "incorrect", "not_attempted"])(
  "does not ask prompting for %s; retains attempt distinction",
  async label => {
    const a = setup(label);
    const r = await a.classifyWithDiagnostics(input, signal());
    expect(a.transport).toHaveBeenCalledTimes(1);
    expect(Object.values(r.factored!.demonstration)[0].choice).toBe(label);
    expect(r.factored!.prompting).toEqual({});
    if (label === "uncertain") expect(r.proposal).toBeNull();
    else expect(r.proposal!.conceptObservations![0].observation).toBe(label === "partial" ? "partial" : "not_yet");
  },
);
it("never asks prompting or maps when demonstration probability or confidence is uncertain", async () => {
  for (const dimension of ["confidence", "probability"]) {
    const transport = vi.fn(async (req: DecisionsRequest) => {
      const b = body(req);
      const a = b.answers.find(a => a.name.startsWith("demonstration_"))!;
      if (dimension === "confidence") a.confidence = 0.1;
      else a.probabilities = a.probabilities.map(p => ({ ...p, probability: p.value === "demonstrated" ? 0.4 : 0.15 }));
      return { ok: true, body: b };
    });
    const r = await createFactoredClassifier({ transport, mappingPolicy: policy }).classifyWithDiagnostics(
      input,
      signal(),
    );
    expect(r.proposal).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  }
});
it("preserves demonstrated_unattributed for uncertain prompting only with valid demonstration/source", async () => {
  const transport = vi.fn(async (req: DecisionsRequest) => {
    const b = body(req);
    for (const a of b.answers) if (a.name.startsWith("prompting_")) a.confidence = 0.1;
    return { ok: true, body: b };
  });
  const r = await createFactoredClassifier({ transport, mappingPolicy: policy }).classifyWithDiagnostics(
    input,
    signal(),
  );
  expect(r.proposal!.conceptObservations![0].observation).toBe("demonstrated_unattributed");
  const bad = setup("demonstrated", "unresolved", "none");
  expect((await bad.classifyWithDiagnostics(input, signal())).reason).toBe("learner_source_unresolved");
  expect(bad.transport).toHaveBeenCalledTimes(1);
});
it("tutor-only success and assent cannot supply a learner source", async () => {
  const a = setup();
  for (const transcript of [
    "Tutor: An engram is memory in a brain. Correct!",
    "Tutor: That is correct.\nChild: Yes.",
  ]) {
    expect((await a.classifyWithDiagnostics({ ...input, transcript }, signal())).proposal).toBeNull();
  }
  expect(a.transport).not.toHaveBeenCalled();
});
it("echo adversary is explicitly non-demonstration and cannot trigger attribution", async () => {
  const a = setup("uncertain");
  const r = await a.classifyWithDiagnostics(
    { ...input, transcript: "Tutor: An engram is memory in a brain.\nChild: An engram is memory in a brain." },
    signal(),
  );
  expect(r.proposal).toBeNull();
  expect(a.transport).toHaveBeenCalledTimes(1);
  expect(factoredRequest(input)!.questions.find(q => q.name.startsWith("demonstration_"))!.instructions).toContain(
    "simple echo",
  );
});
it("no policy preserves raw first-stage outputs without inventing calibration or prompting", async () => {
  const transport = vi.fn(async (req: DecisionsRequest) => ({ ok: true, body: body(req) }));
  const r = await createFactoredClassifier({ transport }).classifyWithDiagnostics(input, signal());
  expect(r.reason).toBe("decisions_mapping_unconfigured");
  expect(r.factored).not.toBeNull();
  expect(transport).toHaveBeenCalledTimes(1);
});
it.each(["refusal", "missing", "model", "identity", "probabilities", "http"])(
  "fails closed on second-stage %s",
  async failure => {
    let n = 0;
    const transport = vi.fn(async (req: DecisionsRequest) => {
      const b = body(req);
      n++;
      if (n === 2) {
        if (failure === "refusal") b.answers[0].type = "refusal";
        if (failure === "missing") b.answers.pop();
        if (failure === "model") b.model = "gpt-6-other";
        if (failure === "identity") b.answers[0].name = "other";
        if (failure === "probabilities") b.answers[0].probabilities[0].probability = NaN;
      }
      return { ok: !(n === 2 && failure === "http"), body: b };
    });
    const r = await createFactoredClassifier({ transport, mappingPolicy: policy }).classifyWithDiagnostics(
      input,
      signal(),
    );
    expect(r.proposal).toBeNull();
    expect(r.factored).toBeNull();
  },
);
it("rejects invented/tutor sources and invalid snapshot identities", async () => {
  const a = setup("demonstrated", "independent", "message_0");
  expect((await a.classifyWithDiagnostics(input, signal())).reason).toBe("provider_invalid_probabilities");
  expect((await a.classifyWithDiagnostics({ ...input, nodeId: "foreign" }, signal())).reason).toBe("invalid_input");
  expect(() => promptingRequest(input, ["foreign"])).toThrow();
});
it("freezes caller identity across both requests and bounds total timeout/cancellation", async () => {
  const mutable = { ...structuredClone(input) };
  let n = 0;
  const transport = vi.fn(async (req: DecisionsRequest) => {
    n++;
    if (n === 1) {
      mutable.nodeId = "exogram";
      mutable.transcriptRevision++;
    }
    const b = body(req);
    req.input = "transport mutation";
    return { ok: true, body: b };
  });
  expect(
    (await createFactoredClassifier({ transport, mappingPolicy: policy }).classifyWithDiagnostics(mutable, signal()))
      .proposal!.nodeId,
  ).toBe("engram");
  vi.useFakeTimers();
  const hanging = vi.fn(() => new Promise<never>(() => {}));
  const pending = createFactoredClassifier({
    transport: hanging,
    mappingPolicy: policy,
    timeoutMs: 20,
  }).classifyWithDiagnostics(input, signal());
  await vi.advanceTimersByTimeAsync(21);
  expect((await pending).reason).toBe("timeout");
  const c = new AbortController();
  const cancelled = createFactoredClassifier({ transport: hanging, mappingPolicy: policy }).classifyWithDiagnostics(
    input,
    c.signal,
  );
  c.abort();
  expect((await cancelled).reason).toBe("cancelled");
});

it("second-stage questions include only the established subset of authored criteria", async () => {
  const node = Object.values(input.lesson!.nodes).find(n => (n.concepts?.length ?? 0) >= 2)!;
  const snapshot = { ...input, nodeId: node.id };
  const names = factoredRequest(snapshot)!
    .questions.filter(q => q.name.startsWith("demonstration_"))
    .map(q => q.name);
  const transport = vi.fn(async (req: DecisionsRequest) => {
    const b = body(req);
    for (const a of b.answers)
      if (a.name.startsWith("demonstration_") && a.name !== names[0]) {
        a.choice = "uncertain";
        a.probabilities = a.probabilities.map(p => ({
          ...p,
          probability: p.value === "uncertain" ? 0.96 : 0.04 / (a.probabilities.length - 1),
        }));
      }
    return { ok: true, body: b };
  });
  const r = await createFactoredClassifier({ transport, mappingPolicy: policy }).classifyWithDiagnostics(
    snapshot,
    signal(),
  );
  expect(transport.mock.calls[1][0].questions.map(q => q.name)).toEqual([
    names[0].replace("demonstration_", "prompting_"),
  ]);
  expect(r.proposal!.conceptObservations).toHaveLength(1);
});
