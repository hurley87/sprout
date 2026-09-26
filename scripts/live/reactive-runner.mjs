import { mkdirSync, writeFileSync, rmSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runLiveSession } from "./runner.mjs";
import { setupSyntheticMicrophone } from "./microphone.mjs";
import { createSimulatedChild } from "./child.mjs";
import { createReactiveChild } from "./reactive-child.mjs";
import { countingBehavior } from "./lesson-behaviors/counting.mjs";
import { createScenarioAssertions } from "./assertions.mjs";
import { exportArtifacts } from "./artifacts.mjs";

export function selectScenarios(args, scenarios) {
  const names = [];
  let repeat = 1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repeat") {
      repeat = Number(args[++i]);
      if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat requires a positive integer");
    } else if (!Object.hasOwn(scenarios, args[i])) {
      throw new Error(`Unknown scenario ${args[i]}. Available: ${Object.keys(scenarios).join(", ")}`);
    } else names.push(args[i]);
  }
  return (names.length ? names : Object.keys(scenarios)).flatMap(name =>
    Array.from({ length: repeat }, (_, i) => ({ name, label: repeat === 1 ? name : `${name}-${i + 1}` })),
  );
}

/** A deadline disables subsequent context calls and aborts microphone playback/synthesis. */
export async function executeScenario(name, definition, context, abort = async () => {}) {
  if (!Number.isFinite(definition.timeoutMs) || definition.timeoutMs <= 0)
    throw new Error(`Scenario ${name} requires a positive bounded timeout`);
  let timer;
  let expired = false;
  const guarded = Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      key !== "page" && value && typeof value === "object"
        ? new Proxy(value, {
            get(target, property) {
              const method = target[property];
              if (typeof method !== "function") return method;
              return async (...args) => {
                if (expired) throw new Error("Scenario deadline expired");
                const result = await method.apply(target, args);
                if (expired) throw new Error("Scenario deadline expired");
                return result;
              };
            },
          })
        : value,
    ]),
  );
  try {
    await Promise.race([
      Promise.resolve().then(() => definition.run({ ...guarded, scenario: name })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error(`Overall scenario timeout (${definition.timeoutMs}ms)`));
          void abort().catch(() => {});
        }, definition.timeoutMs);
      }),
    ]);
  } catch (cause) {
    throw new Error(`Scenario ${name} failed: ${cause}`, { cause });
  } finally {
    clearTimeout(timer);
  }
}

export async function runSelected(runs, run) {
  const results = [];
  for (const selected of runs) {
    try {
      results.push({ ...selected, status: "passed", value: await run(selected) });
    } catch (error) {
      results.push({ ...selected, status: "failed", error: String(error) });
    }
  }
  return results;
}

export async function runReactiveScenario(name, definition, { out, baseUrl, label = name }) {
  const metadata = {
    name,
    label,
    mode: "reactive",
    startedAt: new Date().toISOString(),
    timeoutMs: definition.timeoutMs,
    baseUrl: new URL(baseUrl).origin,
  };
  const dir = join(out, label);
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, "failure.txt"), { force: true });
  writeFileSync(
    join(dir, "log.json"),
    JSON.stringify({ browser: null, scenario: metadata, log: [], unavailable: "Session not collected" }, null, 2),
  );
  writeFileSync(join(dir, "timeline.txt"), `# ${label}\nScenario setup started; session evidence not yet collected.\n`);
  writeFileSync(join(dir, "diagnostics.json"), JSON.stringify({ unavailable: "Session not collected" }, null, 2));
  let speech;
  let failure;
  let collected = false;
  const record = (page, action, error) =>
    page.evaluate(
      ({ action, error, name }) => {
        window.__liveLog.push({ dir: "scenario", action, scenario: name, error, at: window.__liveNow() });
      },
      { action, error, name },
    );
  async function collect({ page, browser }) {
    if (collected) return;
    const result = await exportArtifacts({
      page,
      browser,
      dir,
      label,
      scenario: metadata,
      micScript: "reactive macOS say -> runtime microphone -> real GPT-Live/Jev",
      failure: failure ? (failure.stack ?? String(failure)) : undefined,
    });
    collected = true;
    return result;
  }
  try {
    await runLiveSession({
      baseUrl,
      browserArgs: ["--autoplay-policy=no-user-gesture-required"],
      setupPage: async page => {
        page.setDefaultTimeout(15000);
        const cleanup = await setupSyntheticMicrophone(page);
        speech = createSimulatedChild({ page });
        return async () => {
          try {
            await speech.close();
          } finally {
            await cleanup();
          }
        };
      },
      drive: async ({ page, observer }) => {
        await record(page, "start");
        const child = createReactiveChild({ speech, observer, page, lessonBehavior: countingBehavior });
        try {
          await executeScenario(
            name,
            definition,
            { page, observer, child, assertions: createScenarioAssertions(observer) },
            async () => {
              await speech.close();
            },
          );
        } catch (error) {
          failure = error;
          writeFileSync(join(dir, "failure.txt"), error.stack ?? String(error));
          await record(page, "assertion-failure", error.stack ?? String(error)).catch(() => {});
        } finally {
          try {
            await record(page, "end", failure ? String(failure) : undefined);
            const end = page.getByRole("button", { name: "End lesson" });
            if (await end.isVisible()) await end.click();
          } catch (error) {
            if (!failure) throw error;
          }
        }
      },
      collect,
      onFailure: async ({ page, browser, error }) => {
        failure ??= error;
        writeFileSync(join(dir, "failure.txt"), failure.stack ?? String(failure));
        await record(page, "runner-failure", failure.stack ?? String(failure)).catch(() => {});
        const end = page.getByRole("button", { name: "End lesson" });
        if (await end.isVisible().catch(() => false)) await end.click().catch(() => {});
        await collect({ page, browser });
      },
    });
  } catch (error) {
    failure ??= error;
    writeFileSync(join(dir, "failure.txt"), failure.stack ?? String(failure));
    throw new Error(`Scenario ${name} failed; artifacts: ${dir}; ${failure}`, { cause: failure });
  } finally {
    if (failure) {
      writeFileSync(join(dir, "failure.txt"), failure.stack ?? String(failure));
      // Covers launch/setup failures and failures after collection (including cleanup).
      if (!readFileSync(join(dir, "timeline.txt"), "utf8").includes("=== SCENARIO FAILED ==="))
        appendFileSync(join(dir, "timeline.txt"), `\n=== SCENARIO FAILED ===\n${failure.stack ?? String(failure)}\n`);
    }
  }
  if (failure) throw new Error(`${failure}; artifacts: ${dir}`, { cause: failure });
  return dir;
}
