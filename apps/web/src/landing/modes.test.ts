import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODES, pageFromHash } from "./modes.ts";

describe("landing navigation", () => {
  it("exposes story, study, and online without claiming unfinished modes are live", () => {
    assert.deepEqual(
      MODES.map((mode) => mode.id),
      ["story", "study", "online"],
    );
    assert.equal(
      MODES.find((mode) => mode.id === "study")?.status,
      "Board preview",
    );
    assert.ok(
      MODES.find((mode) => mode.id === "story")?.status === "Coming soon",
    );
    assert.equal(MODES.find((mode) => mode.id === "online")?.status, "Open for play");
  });
  it("supports the play deep link and returns other anchors to the landing page", () => {
    assert.equal(pageFromHash("#play"), "play");
    for (const hash of [
      "",
      "#home",
      "#modes",
      "#story",
      "#rewards",
      "#learn",
      "#training",
      "#study",
      "#unknown",
    ])
      assert.equal(pageFromHash(hash), "home");
  });
});
