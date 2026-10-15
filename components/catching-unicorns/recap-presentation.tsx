import { CATCHING_UNICORNS_LESSON } from "@/lib/lesson-runtime/catching-unicorns-lesson";
import { evidenceRecap } from "@/lib/lesson-runtime/evidence-recap";
import type { LessonRuntimeState } from "@/lib/lesson-runtime/lesson-runtime-reducer";

export function RecapPresentation({ state }: { state: LessonRuntimeState | null | undefined }) {
  return (
    <div className="mx-auto max-w-2xl space-y-5" data-scene="recap" aria-live="polite">
      <h2 className="text-3xl font-semibold">What this conversation showed</h2>
      <p className="text-lg leading-relaxed text-slate-700">{evidenceRecap(CATCHING_UNICORNS_LESSON, state)}</p>
    </div>
  );
}
