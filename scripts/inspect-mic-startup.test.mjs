import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnalyzer,
  durationMs,
  distribution,
} from "./inspect-mic-startup.mjs";

function verifyAnalyzer(durationMs, distribution, createAnalyzer, assert) {
  assert(durationMs("7µs") === 0.007, "microseconds");
  assert(durationMs("0.8s") === 800, "seconds");
  assert(durationMs("private text") === undefined, "unrecognized input");
  assert(distribution([3, 5, 1, 7]).medianMs === 4, "even median");
  const analyzer = createAnalyzer();
  const actions = "handy_app_lib::actions",
    audio = "handy_app_lib::managers::audio";
  const line = (second, source, message) =>
    analyzer.read(
      "[2025-01-01][00:" +
        String(Math.floor(second / 60)).padStart(2, "0") +
        ":" +
        String(second % 60).padStart(2, "0") +
        "][" +
        source +
        "][DEBUG] " +
        message,
    );
  function start(t, onDemand = true) {
    line(t, actions, "TranscribeAction::start called for binding: test");
    line(t, actions, "Microphone mode - always_on: " + !onDemand);
  }
  function accepted(t, ms) {
    line(t, audio, "Microphone stream initialized in " + ms + "ms");
    line(
      t,
      actions,
      "Recording request accepted in " +
        ms +
        "ms; waiting for first microphone samples",
    );
    line(t, actions, "TranscribeAction::start completed in " + ms + "ms");
  }
  const stop = (t) =>
    line(t, actions, "TranscribeAction::stop called for binding: test");
  start(0);
  accepted(0, 45);
  stop(5);
  start(60);
  line(60, "handy_recorder::backend::cpal", "build_stream=20ms play=1.5s");
  accepted(62, 1600);
  stop(65);
  start(95);
  line(96, audio, "Failed to open microphone stream: timed out");
  line(96, actions, "TranscribeAction::start completed in 1s");
  start(98, false);
  accepted(98, 20);
  stop(100);
  line(
    105,
    "handy_app_lib::managers::history",
    "Initializing database at PERSONAL_PATH",
  );
  start(110);
  accepted(110, 30);
  stop(112);
  line(113, "handy_app_lib::settings", "Loaded settings: PRIVATE_VALUE");
  start(115);
  const r = analyzer.report();
  assert(r.completedStarts.count === 5, "completed starts");
  assert(r.incompleteStarts === 1, "incomplete starts");
  assert(
    r.devicePlayCalls.maxMs === 1500 && r.microphoneOpens.count === 4,
    "phase timings",
  );
  assert(r.confirmedOpenTimeouts === 1, "timeout");
  assert(
    r.onDemandColdStartsWithPriorStop === 2,
    "requires known previous accepted stop and uninterrupted process",
  );
  assert(
    r.warmWindowReplay[0].potentiallyWarmStarts === 0 &&
      r.warmWindowReplay[0].boundaryAmbiguous === 1,
    "whole-second boundary",
  );
  assert(
    r.warmWindowReplay[1].potentiallyWarmStarts === 2 &&
      r.warmWindowReplay[1].amongThemAtLeastOneSecond === 2,
    "60-second candidate",
  );
  assert(
    !JSON.stringify(r).includes("PRIVATE") &&
      !JSON.stringify(r).includes("PERSONAL"),
    "private contents omitted",
  );
}

test("microphone timing aggregation, fixed-window replay, and privacy", () => {
  verifyAnalyzer(durationMs, distribution, createAnalyzer, assert.ok);
});

test("recognizes rotated logs with a timeout already in progress", () => {
  const a = createAnalyzer();
  a.read(
    "[2025-01-01][11:22:33][handy_app_lib::managers::audio][ERROR] Failed to open microphone stream: test input did not finish opening in time: no result within 10.0 s",
  );
  a.read(
    "[2025-01-01][11:22:33][handy_app_lib::actions][DEBUG] TranscribeAction::start completed in 10.005s",
  );
  const r = a.report();
  assert.equal(r.unpairedCompletions, 1);
  assert.equal(r.confirmedOpenTimeouts, 1);
  assert.equal(r.completedStarts.maxMs, 10005);
  assert.equal(r.onDemandColdStartsWithPriorStop, 0);
});

test("distinguishes receiving the first samples from readiness for an active session", () => {
  const analyzer = createAnalyzer();
  const action = (message) =>
    analyzer.read(
      "[2025-01-01][11:00:00][handy_app_lib::actions][DEBUG] " + message,
    );
  action("First microphone samples observed 81ms after dictation action start");
  action("Microphone is receiving samples; recording is ready");
  action("First microphone samples observed 8.9s after dictation action start");
  action("Microphone became ready for an inactive recording");
  action("Microphone readiness wait ended without receiving samples");
  const result = analyzer.report();
  assert.equal(result.actionToFirstSampleObserved.count, 2);
  assert.equal(result.actionToFirstSampleObserved.maxMs, 8900);
  assert.deepEqual(result.readiness, {
    activeOnReady: 1,
    inactiveOnReady: 1,
    endedWithoutSamples: 1,
  });
  assert.equal(createAnalyzer().report().actionToFirstSampleObserved.count, 0);
});
