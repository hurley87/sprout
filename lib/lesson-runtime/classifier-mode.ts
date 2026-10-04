export const CLASSIFIER_MODES = ["legacy", "simplified-full-context"] as const;
export type ClassifierMode = (typeof CLASSIFIER_MODES)[number];
/** Issue #57 branch default; an experiment, not a production promotion. */
export const DEFAULT_CLASSIFIER_MODE: ClassifierMode = "simplified-full-context";
export function parseClassifierMode(value: unknown): ClassifierMode | null {
  return CLASSIFIER_MODES.find(mode => mode === value) ?? null;
}
export function localClassifierMode(): ClassifierMode {
  // Static public env read is required by Next's client bundler. Restart dev after switching.
  return parseClassifierMode(process.env.NEXT_PUBLIC_SPROUT_CLASSIFIER_MODE) ?? DEFAULT_CLASSIFIER_MODE;
}
