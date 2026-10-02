import type { PlaybackRequest } from "./local-playback";

/** Fixed baseline wording, public synthetic speech only. Content review and render
 * provenance are pinned with the bytes; voice continuity remains a device gate. */
export const ACKNOWLEDGMENTS = [
  {
    id: "ack-v1-hello-duck",
    sceneId: "hello-duck",
    text: "That's right, there's one duck.",
    url: "/audio/acknowledgments/hello-duck.wav",
    mimeType: "audio/wav",
    sha256: "932688631c646a7bf0b99d81d93d97bf7bc8dded7cb1ce032b2f680d6c958aa0",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "45f1f9d0c2a4816805b2a81dd7013aab0cc7ed98ca1e5a3ddb2b79cd0ffeb774",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_25912c6ff3f24042ad810c6569c94d76",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "That's right, there's one duck.",
    },
  },
  {
    id: "ack-v1-duck-friends",
    sceneId: "duck-friends",
    text: "That's right, there are two ducks.",
    url: "/audio/acknowledgments/duck-friends.wav",
    mimeType: "audio/wav",
    sha256: "7a222f821445cc48174031859c3ebf8933b8a48ec8e2f3dc544db4d009c6bf6a",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "d1fe1d11fa7892b2efdfbd461936b1efefd38a9402df7ec61b5654bd3f14a215",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_f3e305ee587c436c8d04ca774127637e",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "That's right, there are two ducks.",
    },
  },
  {
    id: "ack-v1-butterfly-garden",
    sceneId: "butterfly-garden",
    text: "That's right, there are three butterflies.",
    url: "/audio/acknowledgments/butterfly-garden.wav",
    mimeType: "audio/wav",
    sha256: "99c80e72eb3a3eefd9e84f7ed4797fdd5117fb8c8c6c66b8958d36b72d506b97",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "8c07f5ece52df8dd1720668a7a00beb8ab7fddda0fe142ba1498e439065c86ca",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_a53c005a1db241aab498fd46df9adde1",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "That's right, there are three butterflies.",
    },
  },
  {
    id: "ack-v1-picnic",
    sceneId: "picnic",
    text: "That's right, there are three strawberries.",
    url: "/audio/acknowledgments/picnic.wav",
    mimeType: "audio/wav",
    sha256: "ef60d584b6a498f0f2fa7beed008af4b9a72eaed08892455cd73aeb445a0e42f",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "f48ef2263ca02386e78cb96ab8b9796aed65b65de963c6d401e28e8623db5948",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_529fbdcf025f409181d475d8da051e3d",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "That's right, there are three strawberries.",
    },
  },
  {
    id: "ack-v1-pond",
    sceneId: "pond",
    text: "That's right, there are four ducks.",
    url: "/audio/acknowledgments/pond.wav",
    mimeType: "audio/wav",
    sha256: "c40d5a7df0105ab7471669e27e870602d2b9ba9a92fd66b1c98cd924c68798f5",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "ed4ee0d75eb3a6438be41a589cc1d324f9f15f0a102fb7b43388a0e88991fe9d",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_0644cfc49c1842ffae5f1180f194f13c",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "That's right, there are four ducks.",
    },
  },
] as const;

/** Versioned alternatives make wording variation audible while keeping each
 * accepted answer's choice stable across playback retries. */
export const ACKNOWLEDGMENT_VARIANTS = [
  {
    id: "ack-v2-hello-duck-careful-count",
    sceneId: "hello-duck",
    text: "You found that little duck! What a careful count.",
    url: "/audio/acknowledgments/hello-duck-variation.wav",
    mimeType: "audio/wav",
    sha256: "5f9aa14d779e1b99b997f64f4f7d609ff603d24216757be09beb5d4c906fd8c2",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "5fa29573cd5d9a42f644511c41e105fec0c96a52903bddc47b249b7625d8d0d3",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_c36d89154d024dd3b0de04feba27ff3c",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "You found that little duck. What a careful count!",
    },
  },
  {
    id: "ack-v2-duck-friends-fine-team",
    sceneId: "duck-friends",
    text: "Those two ducks make a fine team!",
    url: "/audio/acknowledgments/duck-friends-variation.wav",
    mimeType: "audio/wav",
    sha256: "83bc854c75e5734ca5cd61176ebf80751313112d7a740e1a3aa6ba27414293f3",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "c141ca994664a5f5b2d563ab01d024f398bcbb5be9c03ee1840e88c9bfa89b26",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_41d0342044f54d92a90b104d6cb5298b",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "Those two ducks make a fine team.",
    },
  },
  {
    id: "ack-v2-butterfly-garden-fluttering",
    sceneId: "butterfly-garden",
    text: "You counted three butterflies! Imagine they are playing follow-the-leader!",
    url: "/audio/acknowledgments/butterfly-garden-variation.wav",
    mimeType: "audio/wav",
    sha256: "02981933e57a132799872f39a3ce3f8715e052ea6f9add52cd9b9dd737bed720",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "ea603d270e2bcd235d8b64e0cfc57ae5143fffcdb363c3a8932c22c6593a5490",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_27c22860aaa648a9a057ee6fd754a35c",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "You counted three butterflies. Imagine they are playing follow the leader.",
    },
  },
  {
    id: "ack-v2-picnic-careful-count",
    sceneId: "picnic",
    text: "You counted those strawberries so carefully!",
    url: "/audio/acknowledgments/picnic-variation.wav",
    mimeType: "audio/wav",
    sha256: "8fce9c0fa265fcb2ef5eb7ffede893a0401d1334b4bfd43fd12c4d598591ccac",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "dfaad125646aebf1ca155709bc3c883814364100bfd20f0bf34ef4492e877057",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_2e08201228884887a3ec5fd04e44b7fd",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "You counted those strawberries so carefully.",
    },
  },
  {
    id: "ack-v2-pond-waddling",
    sceneId: "pond",
    text: "You counted four ducks! Imagine they are waddling in a parade!",
    url: "/audio/acknowledgments/pond-variation.wav",
    mimeType: "audio/wav",
    sha256: "88137c915a084bff571362d826c2097bb201b96fa0c3b1b961445df98c0065c9",
    formatReview: {
      operation: "Finalize streaming WAV RIFF and data lengths; PCM unchanged",
      renderSha256: "fb059057dee304a2aed9e11ef5ca30b6f5778271bcb4a68a3421592b72e1c719",
    },
    render: {
      model: "gpt-4o-mini-tts",
      voice: "marin",
      language: "en",
      instructions:
        "Speak English as a warm preschool counting tutor. Short, clear, unhurried. Say exactly the supplied sentence, nothing else.",
      date: "2026-10-02",
      requestId: "req_927e92b655044a79a84d8970001164aa",
    },
    contentReview: {
      method: "gpt-4o-transcribe; normalized exact match",
      transcript: "You counted four ducks. Imagine they are waddling in a parade.",
    },
  },
] as const;

export function acknowledgmentFor(sceneIndex: number, answerIdentity: string) {
  const baseline = ACKNOWLEDGMENTS[sceneIndex];
  const variant = ACKNOWLEDGMENT_VARIANTS[sceneIndex];
  if (!baseline || !variant) throw new Error("No reviewed acknowledgment for this scene");
  let hash = 2166136261;
  for (const character of answerIdentity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % 2 === 0 ? baseline : variant;
}

export function acknowledgmentAsset(sceneIndex: number) {
  const asset = ACKNOWLEDGMENTS[sceneIndex];
  if (!asset) throw new Error("No reviewed acknowledgment for this scene");
  return asset;
}

/** Startup preflight. No credentials, TTS calls or device voice fallback. */
export async function preloadAcknowledgments(signal: AbortSignal): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  try {
    for (const asset of [...ACKNOWLEDGMENTS, ...ACKNOWLEDGMENT_VARIANTS]) {
      signal.throwIfAborted();
      const response = await fetch(asset.url, { signal });
      if (!response.ok) throw new Error("Acknowledgment catalog unavailable");
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), x =>
        x.toString(16).padStart(2, "0"),
      ).join("");
      signal.throwIfAborted();
      if (sha256 !== asset.sha256 || bytes.byteLength < 44 || bytes.byteLength > 4 * 1024 * 1024)
        throw new Error("Acknowledgment catalog integrity failed");
      // Catalog is reviewed mono 24 kHz PCM WAV, at most ten seconds. Actual
      // decoding/route validation also occurs in the private playback attempt.
      const wav = new DataView(bytes);
      if (
        wav.getUint32(0) !== 0x52494646 ||
        wav.getUint32(8) !== 0x57415645 ||
        wav.getUint16(20, true) !== 1 ||
        wav.getUint16(22, true) !== 1 ||
        wav.getUint32(24, true) !== 24000 ||
        wav.getUint16(34, true) !== 16 ||
        wav.getUint32(40, true) !== bytes.byteLength - 44 ||
        (bytes.byteLength - 44) / 48000 > 10
      )
        throw new Error("Acknowledgment catalog format failed");
      urls.set(asset.id, URL.createObjectURL(new Blob([bytes], { type: asset.mimeType })));
    }
    return urls;
  } catch (error) {
    urls.forEach(url => URL.revokeObjectURL(url));
    throw error;
  }
}

export function catalogPlaybackAsset(sceneIndex: number): PlaybackRequest["asset"] {
  const { id, sha256, url, mimeType } = acknowledgmentAsset(sceneIndex);
  return { id, sha256, url, mimeType };
}

export function catalogPlaybackAssetFor(
  asset: (typeof ACKNOWLEDGMENTS)[number] | (typeof ACKNOWLEDGMENT_VARIANTS)[number],
): PlaybackRequest["asset"] {
  return { id: asset.id, sha256: asset.sha256, url: asset.url, mimeType: asset.mimeType };
}
