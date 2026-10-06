import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CHARACTERS } from "../../../shared/lobby.ts";
import { EMOTIONS, characterPortrait } from "../src/lobby/characterArt.ts";

const publicRoot = new URL("../public/", import.meta.url);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const failures: string[] = [];
const paths = new Set<string>();
for (const character of CHARACTERS) {
  if (!character.emotions) {
    failures.push(`${character.name}: missing emotion set`);
    continue;
  }
  for (const path of [character.portrait, ...EMOTIONS.map(emotion => characterPortrait(character, emotion))]) {
    try {
      assert(!paths.has(path), `portrait is reused: ${path}`);
      paths.add(path);
      const file = fileURLToPath(new URL(path.slice(1), publicRoot));
      const data = await readFile(file);
      assert(data.subarray(0, 8).equals(signature), "not a PNG");
      assert.equal(data.toString("ascii", 12, 16), "IHDR", "missing PNG dimensions");
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      assert(width >= 128 && width === height, `expected a square portrait, got ${width}×${height}`);
      const promptFile = new URL(path.slice(1).replace(/\.png$/, ".md"), publicRoot);
      let prompt = await readFile(promptFile, "utf8");
      // The original test sets compose each exact prompt from a shared identity block.
      for (const [, base] of prompt.matchAll(/\]\(([^/)]+-emotion-prompt-base-v\d+\.md)\)/g)) {
        prompt += "\n" + await readFile(new URL(base, promptFile), "utf8");
      }
      assert(/```text\n[\s\S]+?\n```/.test(prompt), "missing exact prompt");
      assert(/built-in imagegen|built-in.*image_gen|imagegen tool/i.test(prompt), "missing generation provenance");
    } catch (error) {
      failures.push(`${character.name}: ${path}: ${(error as Error).message}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Character art check passed: ${CHARACTERS.length} identities, ${CHARACTERS.length * EMOTIONS.length} emotions, PNGs and saved prompts.`);
}
