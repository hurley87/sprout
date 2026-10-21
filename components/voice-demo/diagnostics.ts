export function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/(?:secret|credential|authorization|api.?key|sdp|raw.?body|provider.?body|access.?token)/iu.test(key),
      )
      .map(([key, nested]) => [key, scrubSecrets(nested)]),
  );
}
