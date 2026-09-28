import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitTask, toLesson, type OgsLesson } from "./ogsLibrary.ts";

describe("imported OGS lessons", () => {
  it("takes the last sentence as the page's task", () => {
    assert.deepEqual(
      splitTask("White to play. Both players are in atari. Capture a stone."),
      {
        text: "White to play. Both players are in atari.",
        goal: "Capture a stone.",
      },
    );
    assert.deepEqual(splitTask("Connect your black stones."), {
      text: "",
      goal: "Connect your black stones.",
    });
    assert.deepEqual(
      splitTask("Is White allowed to recapture stone 1 immediately?"),
      { text: "", goal: "Is White allowed to recapture stone 1 immediately?" },
    );
  });
  it("keeps each page's id and issues for review", () => {
    const lesson: OgsLesson = {
      id: "basic-principles/ko",
      title: "Ko",
      subtext: "",
      file: "BasicPrinciples/BPKo.tsx",
      pages: [
        {
          id: "basic-principles/ko/Page01",
          kind: "puzzle",
          text: "Black to play. Capture the stone.",
          correct: ["e5"],
          issues: ["needs review"],
        },
      ],
    };
    const [page] = toLesson(lesson).pages;
    assert.equal(page.goal, "Capture the stone.");
    assert.equal(page.text, "Black to play.");
    assert.equal(page.id, "basic-principles/ko/Page01");
    assert.deepEqual(page.issues, ["needs review"]);
  });
});
