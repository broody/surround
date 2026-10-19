import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MODES } from "./modes.ts";

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
});
