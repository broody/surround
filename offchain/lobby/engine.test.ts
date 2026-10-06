import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyPosition } from "../../apps/web/src/game/rules.ts";
import { KataGo } from "./engine.ts";

// Protocol fixture: deliberately replies out of order, emits progress and
// warnings, and checks the real KataGo rules field names.
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "surround-engine-test-"));
  const bin = join(dir, "engine");
  await writeFile(
    bin,
    `#!${process.execPath}
const readline = require('node:readline');
const jobs = new Map();
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line);
 if(q.action==='query_models') return send({id:q.id,models:[{usesHumanSLProfile:true}]});
 if(q.action==='terminate') { clearTimeout(jobs.get(q.terminateId)); send({id:q.terminateId,isDuringSearch:false,noResults:true}); return send(q); }
 if(q.komi===9.5) return process.exit(7);
 if(q.rules.ko!=='POSITIONAL'||q.rules.scoring!=='AREA'||q.rules.suicide!==false||q.rules.tax!=='NONE') return send({id:q.id,error:'Incorrect rules schema'});
 const rank=q.overrideSettings?.humanSLProfile;
 if(rank==='rank_1d') return;
 send({id:q.id,isDuringSearch:true,rootInfo:{scoreLead:-999}});
 send({id:q.id,warning:'Fixture warning',field:'komi'});
 jobs.set(q.id,setTimeout(()=>send({id:q.id,isDuringSearch:false,rootInfo:{scoreLead:rank==='rank_20k'?20:5},ownership:Array(q.boardXSize*q.boardYSize).fill(0)}),rank==='rank_20k'?40:0));
});
`,
    { mode: 0o700 },
  );
  const engine = new KataGo({
    KATAGO_BIN: bin,
    KATAGO_MODEL: "test-model",
    KATAGO_HUMAN_MODEL: "test-human",
  });
  return {
    engine,
    close: async () => {
      engine.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("one process correlates out-of-order strength queries and ignores progress", async () => {
  const h = await fixture();
  try {
    await h.engine.ready();
    assert.equal(h.engine.status().human, true);
    const completed: number[] = [];
    const queries = [
      h.engine.analyze(emptyPosition(9), 6.5, "20k"),
      h.engine.analyze(emptyPosition(19), 6.5, "5d"),
    ].map((query) =>
      query.then((result) => {
        completed.push(result.rootInfo!.scoreLead);
        return result;
      }),
    );
    const results = await Promise.all(queries);
    assert.deepEqual(
      results.map((result) => result.rootInfo!.scoreLead),
      [20, 5],
    );
    assert.deepEqual(completed, [5, 20]);
    assert.notEqual(results[0].id, results[1].id);
    assert.equal(results[0].ownership!.length, 81);
    assert.equal(results[1].ownership!.length, 361);
    assert.equal(h.engine.status().pending, 0);
  } finally {
    await h.close();
  }
});
test("abort releases a query and terminates work without affecting another game", async () => {
  const h = await fixture();
  try {
    await h.engine.ready();
    const controller = new AbortController();
    const pending = h.engine.analyze(
      emptyPosition(9),
      6.5,
      "1d",
      controller.signal,
    );
    const rejected = assert.rejects(pending, /cancelled/);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await rejected;
    assert.equal(h.engine.status().pending, 0);
    assert.equal(
      (await h.engine.analyze(emptyPosition(9), 6.5, "5d")).rootInfo!.scoreLead,
      5,
    );
  } finally {
    await h.close();
  }
});
test("pending queries are bounded and process failure rejects every waiter", async () => {
  const h = await fixture();
  try {
    await h.engine.ready();
    const pending = Array.from({ length: 32 }, () =>
      h.engine.analyze(emptyPosition(9), 6.5, "1d").then(
        () => null,
        (error: Error) => error,
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.engine.status().pending, 32);
    await assert.rejects(h.engine.analyze(emptyPosition(9), 6.5, "5d"), /busy/);
    h.engine.close();
    assert.ok(
      (await Promise.all(pending)).every((error) => error instanceof Error),
    );
    assert.equal(h.engine.status().pending, 0);
  } finally {
    await h.close();
  }
});
test("an engine crash clears requests and readiness enters a restart cooldown", async () => {
  const h = await fixture();
  try {
    await h.engine.ready();
    await assert.rejects(
      h.engine.analyze(emptyPosition(9), 9.5, "5d"),
      /stopped/,
    );
    assert.equal(h.engine.status().state, "unavailable");
    assert.equal(h.engine.status().pending, 0);
    await assert.rejects(h.engine.ready(), /unavailable/);
  } finally {
    await h.close();
  }
});
