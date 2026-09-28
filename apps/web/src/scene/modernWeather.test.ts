import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLOUD_SPAN,
  CLOUD_SPEED,
  roomClock,
  roomCloudOffset,
  roomTreeOffset,
} from "./modernWeather.ts";

describe("modern study-room motion", () => {
  it("ticks once per second, not once per render frame", () => {
    const start = new Date(2026, 8, 26, 10, 58, 0);
    const beforeTick = new Date(start.getTime() + 999);
    const nextTick = new Date(start.getTime() + 1000);
    assert.deepEqual(roomClock(start), roomClock(beforeTick));
    assert.notDeepEqual(roomClock(start), roomClock(nextTick));
    assert.ok(Math.abs(roomClock(nextTick).second - Math.PI / 30) < 1e-12);
    assert.equal(roomClock(new Date(2026, 8, 26, 10, 59, 0)).second, 0);
  });
  it("advances hour and minute hands at their real relative rates", () => {
    const before = roomClock(new Date(2026, 8, 26, 10, 58, 0));
    const after = roomClock(new Date(2026, 8, 26, 10, 59, 0));
    assert.ok(Math.abs(after.minute - before.minute - Math.PI / 30) < 1e-12);
    assert.ok(Math.abs(after.hour - before.hour - Math.PI / 360) < 1e-12);
  });
  it("shows local time on a 12-hour face, including noon and midnight", () => {
    assert.deepEqual(roomClock(new Date(2026, 8, 26, 0, 0, 0)), {
      second: 0,
      minute: 0,
      hour: 0,
    });
    assert.deepEqual(roomClock(new Date(2026, 8, 26, 12, 0, 0)), {
      second: 0,
      minute: 0,
      hour: 0,
    });
    const afternoon = roomClock(new Date(2026, 8, 26, 15, 30, 30));
    assert.equal(afternoon.second, Math.PI);
    assert.ok(Math.abs(afternoon.minute - (30.5 / 60) * Math.PI * 2) < 1e-12);
    assert.ok(
      Math.abs(afternoon.hour - (3.5083333333333333 / 12) * Math.PI * 2) <
        1e-12,
    );
  });
  it("resyncs after a long suspension or a backward system-clock change", () => {
    const early = new Date(2026, 8, 26, 8, 15, 45);
    const later = new Date(2026, 8, 26, 19, 42, 10);
    const expectedEarly = roomClock(early);
    assert.notDeepEqual(roomClock(later), expectedEarly);
    assert.deepEqual(roomClock(early), expectedEarly);
    assert.ok(
      Math.abs(roomClock(later).minute - ((42 + 10 / 60) / 60) * Math.PI * 2) <
        1e-12,
    );
  });
  it("keeps the canopy attached with gentle, bounded, continuous movement", () => {
    for (const t of [0, 1, 10, 300, 3600, 86400, 1e8]) {
      assert.equal(roomTreeOffset(156, 156, t), 0);
      assert.equal(roomTreeOffset(200, 156, t), 0);
      for (const row of [0, 24, 96, 156]) {
        assert.ok(Math.abs(roomTreeOffset(row, 156, t)) <= 2.8);
        assert.ok(
          Math.abs(
            roomTreeOffset(row, 156, t + 1 / 24) - roomTreeOffset(row, 156, t),
          ) < 0.1,
        );
      }
    }
  });
  it("moves clouds slowly and tiles continuously across the wrap", () => {
    assert.ok(Math.abs(roomCloudOffset(10) - CLOUD_SPEED * 10) < 1e-10);
    const period = CLOUD_SPAN / CLOUD_SPEED;
    assert.ok(
      Math.abs(roomCloudOffset(period + 1) - roomCloudOffset(1)) < 1e-10,
    );
    for (const t of [0, 1, 300, period, 86400, 1e8]) {
      assert.ok(roomCloudOffset(t) >= 0 && roomCloudOffset(t) < CLOUD_SPAN);
    }
  });
  it("keeps paused weather independent from the local wall clock", () => {
    const sample = (t: number) => [
      roomCloudOffset(t),
      roomTreeOffset(12, 156, t),
    ];
    assert.deepEqual(sample(12.4), sample(12.4));
    assert.notDeepEqual(sample(12.4), sample(15.4));
  });
});
