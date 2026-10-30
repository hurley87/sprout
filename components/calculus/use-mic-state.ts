"use client";

import { useEffect, useState } from "react";
import { micState, type MicStateInput } from "./mic-state";
import { createTutorSpeakingHold } from "./tutor-speaking-hold";

export function useMicState(input: MicStateInput) {
  const kind = micState(input).kind;
  const [tutorSpeaking, setTutorSpeaking] = useState(false);
  const [hold] = useState(() => createTutorSpeakingHold(setTutorSpeaking));

  useEffect(() => {
    hold.update(kind);
    return hold.cancel;
  }, [hold, kind]);

  return micState({ ...input, tutorSpeaking: kind === "your-turn" && tutorSpeaking });
}
