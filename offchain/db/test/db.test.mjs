// The Surround database: migrations applied once, in order, by whichever
// process opens it first, and a file from newer code refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, backup, openDatabase } from '../db.mjs';

const version = db => db.prepare('PRAGMA user_version').get().user_version;
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'surround-db-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a new database gets every migration; opening it again changes nothing', () => inDir(dir => {
  const file = join(dir, 'surround.sqlite');
  const first = openDatabase(file);
  assert.equal(version(first), MIGRATIONS.length);
  assert.deepEqual(tables(first), ['profiles', 'released', 'reserved']);
  first.prepare("INSERT INTO reserved (key) VALUES ('kept')").run();
  // A second process, the indexer say, opens the same file meanwhile.
  const second = openDatabase(file);
  assert.equal(version(second), MIGRATIONS.length);
  assert.deepEqual(second.prepare('SELECT key FROM reserved').all().map(r => r.key), ['kept']);
  first.close();
  second.close();
}));

test('an older database gets only the migrations it lacks', () => inDir(dir => {
  const file = join(dir, 'surround.sqlite');
  openDatabase(file).close();
  const next = [...MIGRATIONS, 'CREATE TABLE games (id TEXT PRIMARY KEY);'];
  const db = openDatabase(file, next);
  assert.equal(version(db), next.length);
  assert.ok(tables(db).includes('games'));
  db.close();
  // Code that knows fewer migrations than the file refuses it.
  assert.throws(() => openDatabase(file), /newer than this code's/);
}));

test('a failed migration leaves the database as it was', () => inDir(dir => {
  const file = join(dir, 'surround.sqlite');
  openDatabase(file).close();
  assert.throws(() => openDatabase(file, [...MIGRATIONS, 'CREATE TABLE ok (x); CREATE TABLE broken (']));
  const db = openDatabase(file);
  assert.equal(version(db), MIGRATIONS.length);
  assert.ok(!tables(db).includes('ok'));
  // And a backup is a database of its own, at the same version.
  const copy = join(dir, 'copy.sqlite');
  backup(db, copy);
  db.close();
  const restored = openDatabase(copy);
  assert.equal(version(restored), MIGRATIONS.length);
  restored.close();
}));
