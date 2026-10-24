"use client";

import { useEffect, useRef } from "react";
import type { MathControllerSnapshot } from "@/lib/calculus/math-controller";
import { projectMathAction, projectMathBoard, renderMathExpression } from "@/lib/calculus/math-rendering";
import "katex/dist/katex.min.css";
import styles from "./math-whiteboard.module.css";

export interface MathWhiteboardProps {
  readonly math: MathControllerSnapshot;
  /** Display acknowledgment only. Never wire this to proposal acceptance. */
  readonly onProposalDisplayed?: (id: string, boardRevision: number) => void;
  readonly onFeedbackDisplayed?: (token: string, boardRevision: number) => void;
}

function Equation({ expression }: { readonly expression: unknown }) {
  const result = renderMathExpression(expression);
  return (
    <div className={styles.equation} tabIndex={0} role="group" aria-label="Equation; scroll horizontally if needed">
      {result.ok ? (
        <>
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: result.html }} />
          <span className={styles.srOnly}>{result.text}</span>
        </>
      ) : (
        <span>{result.text}</span>
      )}
    </div>
  );
}

const actionLabels = {
  append: "Add a step",
  replace: "Correct a step",
  undo: "Undo the latest edit",
  clarify: "Ask for clarification",
  help: "Request help",
  next: "Request the next problem",
  strategy: "Name a method",
};
const detailLabels: Record<string, string> = {
  "missing-operand": "Part of the expression is missing",
  ambiguous: "The intended expression is unclear",
  unsupported: "This expression is not supported yet",
  power: "Power rule",
  sum: "Sum rule",
  product: "Product rule",
  chain: "Chain rule",
  expand: "Expand the expression",
  other: "Another method",
};
const dispositionLabels = {
  idle: "Ready for your next step.",
  extracting: "Interpreting your words. Your recorded work stays below.",
  "pending-clarification": "Review the proposed actions and confirm your intent.",
  unavailable: "Your words could not be interpreted. Please try again.",
  committed: "Your confirmed actions are recorded below.",
};
const lifecycleLabels = {
  active: "",
  stopped: "This session is stopped.",
  completed: "This problem has been completed.",
  skipped: "This problem was skipped.",
  ended: "This session has ended.",
};

function Action({
  action,
  pending = false,
  stepNumber,
}: {
  readonly action: ReturnType<typeof projectMathAction>;
  readonly pending?: boolean;
  readonly stepNumber: (id: string) => string;
}) {
  return (
    <>
      <p>
        <strong>{actionLabels[action.operation]}</strong> · For: {stepNumber(action.target)}
        {action.detail ? ` · ${detailLabels[action.detail] ?? action.detail}` : ""}
      </p>
      {action.expression ? <Equation expression={action.expression} /> : null}
      {pending && action.expression ? <p>Mathematical operation: not yet confirmed.</p> : null}
      <ul className={styles.sources} aria-label="Learner sources">
        {action.sources.map((source, index) => (
          <li
            key={index}
            data-source-turn={source.turnId}
            data-source-start={source.start}
            data-source-end={source.end}
          >
            <q>{source.quote}</q>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Read-only projection. Callbacks acknowledge the DOM after two animation
 * frames, a paint opportunity approximation, never proof of physical paint.
 * This contract deliberately has no scene-render or acceptance callback.
 */
export function MathWhiteboard({ math, onProposalDisplayed, onFeedbackDisplayed }: MathWhiteboardProps) {
  const root = useRef<HTMLElement>(null);
  const delivered = useRef(new Set<string>());
  const current = math.current;
  const runtimeId = current?.identity.runtimeId;
  const problemId = current?.identity.problemId;
  const visitId = current?.identity.visitId;
  const revision = current?.identity.baseBoardRevision;
  const active = current?.status === "active";
  const pendingId = math.pending?.id;
  const pendingRevision = math.pending?.boardRevision;
  const feedbackToken = math.feedback?.token;
  const feedbackRevision = math.feedback?.boardRevision;
  const feedbackTarget = math.feedback?.target;
  const proposedIdentity = math.pending?.batch.identity;
  const pendingIdentityMatches =
    !!current &&
    !!proposedIdentity &&
    proposedIdentity.runtimeId === runtimeId &&
    proposedIdentity.problemId === problemId &&
    proposedIdentity.visitId === visitId &&
    proposedIdentity.baseBoardRevision === revision &&
    proposedIdentity.transcriptRevision === current.identity.transcriptRevision;

  useEffect(() => {
    if (!active || revision === undefined) return;
    const element = root.current;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (!element || root.current !== element || !element.isConnected) return;
        const d = element.dataset;
        if (
          d.runtime !== runtimeId ||
          d.problem !== problemId ||
          d.visit !== visitId ||
          d.boardRevision !== String(revision) ||
          d.active !== "true"
        )
          return;
        const proposalMatches =
          pendingIdentityMatches &&
          pendingId !== undefined &&
          pendingRevision === revision &&
          d.pendingId === pendingId &&
          d.pendingRevision === String(pendingRevision);
        const proposalKey = JSON.stringify([runtimeId, visitId, "proposal", pendingId, pendingRevision]);
        if (proposalMatches && onProposalDisplayed && !delivered.current.has(proposalKey)) {
          delivered.current.add(proposalKey);
          onProposalDisplayed(pendingId, revision);
        }
        const feedbackKey = JSON.stringify([runtimeId, visitId, "feedback", feedbackToken, revision]);
        if (
          feedbackToken &&
          feedbackRevision === revision &&
          d.feedbackToken === feedbackToken &&
          d.feedbackTarget === feedbackTarget &&
          (feedbackTarget === "board" || proposalMatches) &&
          onFeedbackDisplayed &&
          !delivered.current.has(feedbackKey)
        ) {
          delivered.current.add(feedbackKey);
          onFeedbackDisplayed(feedbackToken, revision);
        }
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [
    active,
    runtimeId,
    problemId,
    visitId,
    revision,
    pendingId,
    pendingRevision,
    pendingIdentityMatches,
    feedbackToken,
    feedbackRevision,
    feedbackTarget,
    onProposalDisplayed,
    onFeedbackDisplayed,
  ]);

  const board = current ? projectMathBoard(current) : null;
  const stepNumber = (id: string) => {
    const index = board?.steps.findIndex(step => step.id === id) ?? -1;
    return index >= 0
      ? `step ${index + 1}`
      : id === "new logical step"
        ? "a new step"
        : id === "current problem"
          ? "this problem"
          : "an unavailable step";
  };
  return (
    <section
      ref={root}
      className={styles.board}
      aria-label="Mathematical work"
      data-runtime={runtimeId}
      data-problem={problemId}
      data-visit={visitId}
      data-board-revision={revision}
      data-active={active}
      data-pending-id={pendingId}
      data-pending-revision={pendingRevision}
      data-feedback-token={feedbackToken}
      data-feedback-target={feedbackTarget}
    >
      <h2>Your mathematical work</h2>
      <p role="status">
        {board
          ? board.status === "active"
            ? dispositionLabels[math.disposition]
            : lifecycleLabels[board.status]
          : "No current mathematical work."}
      </p>
      {board ? (
        <>
          {board.clarification ? <p>Clarification requested: {detailLabels[board.clarification]}.</p> : null}
          {board.nextRequested ? <p>Next problem requested. This does not establish understanding.</p> : null}
          <h3>Current logical steps</h3>
          {board.steps.length ? (
            <ol className={styles.steps}>
              {board.steps.map((step, index) => (
                <li key={step.id} data-step-id={step.id}>
                  <strong>Step {index + 1}</strong>
                  {step.withdrawn ? (
                    <p>Withdrawn by undo; retained in history.</p>
                  ) : (
                    step.versions
                      .filter(v => v.current)
                      .map(version => (
                        <div key={version.id} data-version-id={version.id}>
                          <p className={styles.status}>{version.status}</p>
                          <Equation expression={version.expression} />
                        </div>
                      ))
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p>No accepted steps yet.</p>
          )}
        </>
      ) : null}
      {math.pending ? (
        <div className={styles.pending} aria-label="Entire pending proposal">
          <h3>Proposed actions — awaiting your confirmation</h3>
          <p>These actions have not changed your work yet. Review every action in order.</p>
          <ol>
            {math.pending.batch.actions.map((action, index) => (
              <li key={index}>
                <span className={styles.status}>Action {index + 1} · Provisional; not accepted or checked</span>
                <Action action={projectMathAction(action)} pending stepNumber={stepNumber} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {board?.history.length ? (
        <div className={styles.history}>
          <h3>Correction and action history</h3>
          <ol>
            {board.history.map((entry, index) => (
              <li key={entry.id} data-action-id={entry.id}>
                <p>
                  <strong>Action {index + 1}</strong>
                  {entry.stepId ? ` · ${stepNumber(entry.stepId)}` : ""}
                </p>
                {entry.versionId ? (
                  <p>
                    {board.steps.some(step =>
                      step.versions.some(version => version.id === entry.versionId && version.current),
                    )
                      ? "Current version for this step."
                      : "Earlier version; retained for review."}
                  </p>
                ) : null}
                {entry.withdrawsActionId ? (
                  <p>
                    Undo withdraws action {board.history.findIndex(action => action.id === entry.withdrawsActionId) + 1}
                    ; the preceding version is restored when present.
                  </p>
                ) : null}
                {entry.operation === "replace" ? (
                  <p>Correction replaces the previous version; its original expression remains in this history.</p>
                ) : null}
                <p className={styles.status}>{entry.status}</p>
                <Action action={entry} stepNumber={stepNumber} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
