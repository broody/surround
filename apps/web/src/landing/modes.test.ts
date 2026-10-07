import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODES, pageFromHash } from "./modes.ts";

describe("landing navigation", () => {
  it("exposes online, study, and story, labelling only the unfinished one", () => {
    assert.deepEqual(
      MODES.map((mode) => mode.id),
      ["online", "study", "story"],
    );
    assert.deepEqual(
      MODES.map((mode) => ("status" in mode ? mode.status : null)),
      [null, null, "Coming soon"],
    );
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
