import type { Metadata } from "next";
import { configuredPasscode, safeNextPath } from "@/lib/access";

export const metadata: Metadata = { title: "Sprout — family passcode" };

export default async function UnlockPage({ searchParams }: PageProps<"/unlock">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error = params.error;
  const unconfigured = !configuredPasscode() || error === "unconfigured";
  return (
    <main className="flex flex-1 items-center justify-center bg-[#fff8f1] px-4 py-12 text-[#563b2b]">
      <form
        method="post"
        action="/api/unlock"
        className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-[0_10px_40px_rgba(86,59,43,0.12)]"
      >
        <h1 className="text-2xl font-semibold">Sprout</h1>
        {unconfigured ? (
          <p className="mt-3 leading-relaxed">
            This Sprout isn’t set up for use away from home yet. A grown-up needs to set the{" "}
            <code className="font-mono text-sm">SPROUT_PASSCODE</code> setting (at least 6 characters).
          </p>
        ) : (
          <>
            <p className="mt-3 leading-relaxed">Grown-ups: enter the family passcode to start.</p>
            <input type="hidden" name="next" value={next} />
            <label className="mt-6 block text-sm font-medium" htmlFor="passcode">
              Family passcode
            </label>
            <input
              id="passcode"
              name="passcode"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              className="mt-2 w-full rounded-xl border border-[#e3d3c6] px-4 py-3 text-lg outline-none focus:border-[#c9844f] focus:ring-2 focus:ring-[#f3c79f]"
            />
            {error === "wrong" && (
              <p role="alert" className="mt-3 text-sm text-[#b3412e]">
                That passcode didn’t match. Please try again.
              </p>
            )}
            <button
              type="submit"
              className="mt-6 w-full rounded-full bg-[#c9844f] px-6 py-3 text-lg font-semibold text-white hover:bg-[#b5743f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#563b2b]"
            >
              Continue
            </button>
          </>
        )}
      </form>
    </main>
  );
}
