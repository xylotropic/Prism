#!/usr/bin/env node
// Usage: node scripts/inspect-mic-startup.mjs /path/to/handy.log
// Aggregate local durations only. No network or microphone access.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export function durationMs(input) {
  const match = /^(\d+(?:\.\d+)?)(ns|µs|μs|us|ms|s)$/.exec(input ?? "");
  if (!match) return undefined;
  const factor = {
    ns: 0.000001,
    us: 0.001,
    µs: 0.001,
    μs: 0.001,
    ms: 1,
    s: 1000,
  };
  return Number(match[1]) * factor[match[2]];
}

export function distribution(samples) {
  if (!samples.length) return { count: 0 };
  const sorted = samples.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const round = (value) => Math.round(value * 100) / 100;
  return {
    count: sorted.length,
    medianMs: round(median),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    maxMs: round(sorted.at(-1)),
  };
}

export function createAnalyzer() {
  const starts = [];
  const openTimes = [];
  const playTimes = [];
  const firstSampleTimes = [];
  let activeOnReady = 0;
  let inactiveOnReady = 0;
  let endedWithoutSamples = 0;
  let active;
  let waitingForStop = false;
  let lastStop;
  let incomplete = 0;
  let unpairedCompletions = 0;
  let openTimeouts = 0;
  function read(line) {
    // Ignore unrelated log fields entirely, including settings and transcript text.
    const exact =
      /^\[(\d{4}-\d\d-\d\d)\]\[(\d\d:\d\d:\d\d)\]\[([^\]]+)\]\[\w+\] (.*)$/.exec(
        line,
      );
    if (!exact) return;
    const [, date, time, source, message] = exact;
    const second = Date.parse(date + "T" + time + "Z") / 1000;
    if (!Number.isFinite(second)) return;
    if (
      source.endsWith("managers::history") &&
      message.startsWith("Initializing database at ")
    ) {
      if (active) incomplete++;
      active = undefined;
      waitingForStop = false;
      lastStop = undefined;
      return;
    }
    if (source.endsWith("backend::cpal")) {
      const play = /^build_stream=\S+ play=(\S+)/.exec(message);
      const value = durationMs(play?.[1]);
      if (value !== undefined) playTimes.push(value);
      return;
    }
    if (source.endsWith("managers::audio")) {
      const opened = /^Microphone stream initialized in (\S+)/.exec(message);
      const value = durationMs(opened?.[1]);
      if (value !== undefined) {
        openTimes.push(value);
        if (active) active.opened = true;
      }
      if (message.startsWith("Failed to open microphone stream:")) {
        if (/timed? ?out|timeout|did not finish opening in time/i.test(message))
          openTimeouts++;
        if (active) active.openFailed = true;
      }
      return;
    }
    if (!source.endsWith("::actions")) return;
    const firstSample =
      /^First microphone samples observed (\S+) after dictation action start$/.exec(
        message,
      );
    if (firstSample) {
      const elapsed = durationMs(firstSample[1]);
      if (elapsed !== undefined) firstSampleTimes.push(elapsed);
      return;
    }
    if (message === "Microphone is receiving samples; recording is ready")
      activeOnReady++;
    if (message === "Microphone became ready for an inactive recording")
      inactiveOnReady++;
    if (message === "Microphone readiness wait ended without receiving samples")
      endedWithoutSamples++;
    if (message.startsWith("TranscribeAction::start called for binding:")) {
      if (active) incomplete++;
      const gap = lastStop === undefined ? undefined : second - lastStop;
      active = { gap: gap >= 0 ? gap : undefined };
      lastStop = undefined;
      waitingForStop = false;
    } else if (
      message.startsWith("TranscribeAction::stop called for binding:")
    ) {
      if (waitingForStop) lastStop = second;
      waitingForStop = false;
    } else {
      if (active && message === "Microphone mode - always_on: false")
        active.onDemand = true;
      if (active && message.startsWith("Recording request accepted in "))
        active.accepted = true;
      const completed = /^TranscribeAction::start completed in (\S+)/.exec(
        message,
      );
      const value = durationMs(completed?.[1]);
      if (value !== undefined) {
        if (!active) unpairedCompletions++;
        starts.push({ ...active, totalMs: value });
        waitingForStop = active?.accepted === true;
        active = undefined;
      }
    }
  }
  function report() {
    const cold = starts.filter(
      (s) => s.onDemand && (s.opened || s.openFailed) && s.gap !== undefined,
    );
    return {
      completedStarts: distribution(starts.map((s) => s.totalMs)),
      incompleteStarts: incomplete + Number(Boolean(active)),
      unpairedCompletions,
      microphoneOpens: distribution(openTimes),
      devicePlayCalls: distribution(playTimes),
      actionToFirstSampleObserved: distribution(firstSampleTimes),
      readiness: { activeOnReady, inactiveOnReady, endedWithoutSamples },
      confirmedOpenTimeouts: openTimeouts,
      onDemandColdStartsWithPriorStop: cold.length,
      warmWindowReplay: [30, 60, 120].map((seconds) => {
        // At the exact boundary the whole-second log stamps cannot resolve ordering.
        const eligible = cold.filter((s) => s.gap < seconds);
        return {
          seconds,
          potentiallyWarmStarts: eligible.length,
          amongThemAtLeastOneSecond: eligible.filter((s) => s.totalMs >= 1000)
            .length,
          boundaryAmbiguous: cold.filter((s) => s.gap === seconds).length,
        };
      }),
    };
  }
  return { read, report };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const path = process.argv[2];
  if (process.argv.length !== 3 || !path || path === "--help") {
    console.error(
      "Usage: node scripts/inspect-mic-startup.mjs /path/to/handy.log",
    );
    process.exitCode = path === "--help" ? 0 : 2;
  } else {
    const analyzer = createAnalyzer();
    try {
      const lines = createInterface({
        input: createReadStream(path),
        crlfDelay: Infinity,
      });
      for await (const line of lines) analyzer.read(line);
      const report = analyzer.report();
      if (!report.completedStarts.count) {
        console.error(
          "No complete dictation starts found. A debug-level Prism log is needed.",
        );
        process.exitCode = 1;
      }
      console.log(JSON.stringify(report, null, 2));
    } catch {
      console.error("Could not read the selected log.");
      process.exitCode = 1;
    }
  }
}
