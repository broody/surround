// Fetches a graded sample of GoProblems.com problems for local development.
//
// GoProblems has not granted redistribution rights, so the cache and output
// directories are gitignored and must not be committed or deployed. Requests
// are sequential, spaced and cached because GoProblems asks API users not to
// call it excessively; re-running only requests what is missing.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const API = "https://www.goproblems.com/api/v2/problems";
const PAGE_SIZE = 100; // Largest resultNumber the list endpoint accepts.
const CANDIDATE_FACTOR = 4; // Listing candidates gathered per selected problem.
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(WEB_ROOT, ".cache/goproblems");
const OUTPUT = path.join(WEB_ROOT, "public/problems/goproblems");

// Levels count up from 30 kyu (0) through 1 kyu (29) and 1 dan (30). Lower
// bands get many problems for repetition; higher bands fewer, better-rated ones.
const BANDS = [
  { id: "beginner", label: "Beginner", ranks: "30k–21k", min: 0, max: 9, count: 300, minStars: 4.0 },
  { id: "novice", label: "Novice", ranks: "20k–13k", min: 10, max: 17, count: 150, minStars: 4.1 },
  { id: "intermediate", label: "Intermediate", ranks: "12k–6k", min: 18, max: 24, count: 100, minStars: 4.2 },
  { id: "advanced", label: "Advanced", ranks: "5k–1k", min: 25, max: 29, count: 70, minStars: 4.3 },
  { id: "dan", label: "Dan", ranks: "1d–3d", min: 30, max: 32, count: 50, minStars: 4.4 },
  { id: "expert", label: "Expert", ranks: "4d+", min: 33, max: Infinity, count: 30, minStars: 4.5 },
];

type Band = (typeof BANDS)[number];

// Problems taken from books, magazines, broadcasts, software or other sites,
// which GoProblems cannot license. Matched against the source, description
// and SGF root; pre-modern classics are public domain and kept.
const PUBLISHED = new RegExp(
  [
    String.raw`\bbooks?\b`, "booklet", "pamphlet", "magazine", String.raw`\bmag\b`, "journal", "newspaper", "encycl?k?opedia", "dictionary",
    String.raw`\bcollection\b`, String.raw`\bvol(?:ume)?\b`, String.raw`\bno\.\s*\d`, String.raw`\bpart\s?\d`, "homepage",
    String.raw`nihon\s?ki-?in`, String.raw`kiseido(?:'s| publishing)`, "go association", "go world", String.raw`\bkido\b`,
    String.raw`\bnhk\b`, "igo-no-jikan", String.raw`\bbgj\b`, String.raw`\bngb\b`, "many faces", "nintendo",
    String.raw`graded (?:go )?problems`, "kano yoshinori", "get strong at", String.raw`\b\d{3,4}\s*(?:probs|problems|tsumego|tesuji|life)\b`, String.raw`\bbasic 1000\b`,
    "the glance", "treasure chest", "tamatebako", "basic techniques of go", "fundamentals of go", "perfectionnement",
    "tsumego master", "poketto", "die or live", "magic baduk", "king's baduk", "hikaru no go", "art of connection",
    "by the numbers", "rescue and capture", "leben und tod", "ju zhong zhen long", "elementary go series", "weekly go problems",
    String.raw`problem acad[ae]my`, String.raw`\bltpg`, "learn to play go", "one thousand", "selected life and death",
    "guide to the game", "gateway to tesuji", "tsumego pro", String.raw`go ?game ?guru`, "gobase",
    "cho chikun", String.raw`\bcho u\b`, String.raw`go ?seigen`, "maeda", "hashimoto", "segoe", "fujisawa", "takao", "sakata",
    "kageyama", "davies", "yang yilun", "bozulich", "ishida", "ishigure", "kobayashi", String.raw`(?:lee|yi) ch'?ang-?ho`,
    "jiang mingjiu", "murakami", "ohashi", "haruyama", "nagahara", "yoon young", "abe sensei", "aroutcheff", "yu shin",
    "lasker", "pritchard",
  ].join("|"),
  "i",
);
// Websites, numbered foreign collections, and sources that are unreadable
// (HTML entities, other scripts or mis-decoded text) and so cannot be vetted.
const PUBLISHED_SOURCE =
  /https?:\/\/|www\.|\.(?:com|net|org|jp|fr)\b|\b(?:tom sport|dashnet|flygo)\b|\bchinese\b.*\d|^copy$|&#\d+;|[^\x20-\x7e]/i;
const PUBLIC_DOMAIN = /xuan ?xuan|\bxxqj\b|gokyo|go kyo syu myo|guanzi|\bgzp\b|hatsuyo|genran|old chinese|classic texts?|arthur smith/i;

type Rank = { value: number; unit: string };

type Listing = {
  id: number;
  rank: Rank;
  genre: string;
  stars: number;
  votes: number;
  negativeFlags: number;
  author: string;
};

type Problem = Listing & {
  sgf: string;
  specificGenre: string | null;
  description: string | null;
  source: string | null;
  playerColor: string | null;
  hasNegativeFlags: boolean;
  isCanon: boolean;
  isStandard: boolean;
  elo: number | null;
  solveRate: number | null;
};

const { values: options } = parseArgs({
  options: {
    "delay-ms": { type: "string", default: "1500" },
    "max-pages": { type: "string", default: "500" },
    "min-votes": { type: "string", default: "3" },
    genres: { type: "string", default: "life and death,tesuji" },
  },
});
const delayMs = Number(options["delay-ms"]);
const maxPages = Number(options["max-pages"]);
const minVotes = Number(options["min-votes"]);
const genres = new Set(options.genres.split(",").map((genre) => genre.trim()));

let lastRequestAt = 0;
let requestCount = 0;

async function getJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt += 1) {
    const wait = lastRequestAt + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    requestCount += 1;
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "surround-problem-sync/0.1" },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return response.json();
    if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
      const retryAfter = Number(response.headers.get("retry-after")) || 0;
      await sleep(Math.max(retryAfter * 1000, delayMs * 2 ** attempt));
      continue;
    }
    throw new Error(`GoProblems returned ${response.status} for ${url}`);
  }
}

async function cached<T>(file: string, load: () => Promise<T>): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    const value = await load();
    await writeFile(file, JSON.stringify(value));
    return value;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function levelOf(rank: Rank) {
  return rank.unit === "dan" ? 29 + rank.value : Math.max(0, 30 - rank.value);
}

function rankLabel(rank: Rank) {
  return `${rank.value}${rank.unit === "dan" ? "d" : "k"}`;
}

function bandOf(rank: Rank) {
  const level = levelOf(rank);
  return BANDS.find((band) => level >= band.min && level <= band.max);
}

// Bayesian average: a 5-star problem with two votes should not outrank a
// 4.5-star problem with two hundred.
function ratingScore(problem: Listing) {
  return (problem.stars * problem.votes + 3 * 5) / (problem.votes + 5);
}

function toListing(row: any): Listing | null {
  if (!row.rank || (row.rank.unit !== "kyu" && row.rank.unit !== "dan")) return null;
  return {
    id: row.id,
    rank: { value: row.rank.value, unit: row.rank.unit },
    genre: row.genre,
    stars: row.rating?.stars ?? 0,
    votes: row.rating?.votes ?? 0,
    negativeFlags: row.flagStats?.negativeFlagSum ?? 0,
    author: row.author?.name ?? "unknown",
  };
}

function toProblem(listing: Listing, row: any): Problem {
  const tries = row.attempts?.tries ?? 0;
  return {
    ...listing,
    sgf: row.sgf,
    specificGenre: row.specificGenre,
    description: row.description,
    source: row.source?.trim() || null,
    playerColor: row.playerColor,
    hasNegativeFlags: row.hasNegativeFlags,
    isCanon: row.isCanon,
    isStandard: row.isStandard,
    elo: row.elo,
    solveRate: tries > 0 ? row.attempts.solved / tries : null,
  };
}

function isCandidate(listing: Listing, band: Band) {
  return (
    genres.has(listing.genre) &&
    listing.negativeFlags === 0 &&
    listing.votes >= minVotes &&
    listing.stars >= band.minStars
  );
}

function isPublished(problem: Problem) {
  const firstMove = problem.sgf.search(/;\s*[BW]\[/);
  const root = firstMove > 0 ? problem.sgf.slice(0, firstMove) : "";
  const text = [problem.source ?? "", problem.description ?? "", root].join("\n");
  if (PUBLIC_DOMAIN.test(text)) return false;
  return PUBLISHED.test(text) || PUBLISHED_SOURCE.test(problem.source ?? "");
}

// Comments after the first move, other than bare RIGHT/WRONG markers.
function explanationsIn(sgf: string) {
  const firstMove = sgf.search(/;\s*[BW]\[/);
  const explanations: string[] = [];
  for (const match of sgf.matchAll(/(?<![A-Z])C\[((?:\\.|[^\\\]])*)\]/g)) {
    if (firstMove < 0 || match.index < firstMove) continue;
    const text = match[1].replace(/\\(.)/g, "$1").trim();
    const remainder = text.replace(/\b(RIGHT|CORRECT|WRONG|INCORRECT)\b/gi, "").replace(/[\s\p{P}]+/gu, "");
    if (remainder.length >= 12) explanations.push(text);
  }
  return explanations;
}

function boardSizeOf(sgf: string) {
  const size = /SZ\[(\d+)/.exec(sgf);
  return size ? Number(size[1]) : 19;
}

// Candidates per band, filled by listing the catalogue oldest first.
const pools = new Map(BANDS.map((band) => [band.id, [] as Listing[]]));
let listedPages = 0;
let catalogueEnded = false;

async function listPage() {
  if (catalogueEnded || listedPages >= maxPages) return false;
  const offset = listedPages * PAGE_SIZE;
  const rows = await cached(path.join(CACHE, `list-${offset}.json`), async () => {
    const url = `${API}?resultNumber=${PAGE_SIZE}&offset=${offset}&sortBy=p.id&sortDirection=asc`;
    return ((await getJson(url)) as any[]).map(toListing);
  });
  listedPages += 1;
  catalogueEnded = rows.length < PAGE_SIZE;
  for (const listing of rows) {
    const band = listing && bandOf(listing.rank);
    if (band && isCandidate(listing, band)) pools.get(band.id)!.push(listing);
  }
  const counts = BANDS.map((band) => `${band.id} ${pools.get(band.id)!.length}`).join(", ");
  console.log(`listed ${offset + rows.length} problems: ${counts}`);
  return true;
}

// Walks candidates from best rated until enough have explanations, listing
// more of the catalogue whenever the band runs out. Unexplained problems only
// fill a band once the catalogue is exhausted.
async function selectProblems(band: Band) {
  const byRating = (a: Listing, b: Listing) => ratingScore(b) - ratingScore(a);
  const pool = pools.get(band.id)!;
  while (pool.length < band.count * CANDIDATE_FACTOR && (await listPage()));
  pool.sort(byRating);

  const explained: Problem[] = [];
  const unexplained: Problem[] = [];
  for (let next = 0; explained.length < band.count; next += 1) {
    if (next === pool.length) {
      const target = pool.length + band.count;
      while (pool.length < target && (await listPage()));
      if (next === pool.length) break;
      pool.splice(next, Infinity, ...pool.slice(next).sort(byRating));
    }
    const listing = pool[next];
    const row = await cached(path.join(CACHE, `problem-${listing.id}.json`), () => getJson(`${API}/${listing.id}`));
    const problem = toProblem(listing, row);
    if (problem.hasNegativeFlags || !/C\[[^\]]*\bRIGHT\b/.test(problem.sgf) || isPublished(problem)) continue;
    (explanationsIn(problem.sgf).length > 0 ? explained : unexplained).push(problem);
  }
  return [...explained, ...unexplained.slice(0, band.count - explained.length)].sort(
    (a, b) => levelOf(a.rank) - levelOf(b.rank) || a.id - b.id,
  );
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  const selections = [];
  for (const band of BANDS) selections.push(await selectProblems(band));

  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(path.join(OUTPUT, "sgf"), { recursive: true });
  const bands = [];
  for (const [index, band] of BANDS.entries()) {
    const problems = selections[index];
    for (const problem of problems) {
      await writeFile(path.join(OUTPUT, "sgf", `${problem.id}.sgf`), problem.sgf);
    }
    const explainedCount = problems.filter((problem) => explanationsIn(problem.sgf).length > 0).length;
    console.log(
      `${band.label} (${band.ranks}, ${band.minStars}+ stars): ${problems.length} of ${band.count} problems, ${explainedCount} with explanations`,
    );
    bands.push({
      id: band.id,
      label: band.label,
      ranks: band.ranks,
      minStars: band.minStars,
      problems: problems.map((problem) => ({
        id: problem.id,
        rank: rankLabel(problem.rank),
        level: levelOf(problem.rank),
        genre: problem.specificGenre || problem.genre,
        playerColor: problem.playerColor,
        boardSize: boardSizeOf(problem.sgf),
        description: problem.description,
        source: problem.source,
        stars: problem.stars,
        votes: problem.votes,
        elo: problem.elo,
        solveRate: problem.solveRate,
        canonical: problem.isCanon,
        explanations: explanationsIn(problem.sgf).length,
        author: problem.author,
        sourceUrl: `https://www.goproblems.com/problems/${problem.id}`,
        sgf: `sgf/${problem.id}.sgf`,
      })),
    });
  }

  await writeFile(
    path.join(OUTPUT, "index.json"),
    `${JSON.stringify(
      {
        source: "https://www.goproblems.com",
        notice: "Local development only. Redistribution has not been granted by GoProblems.com; do not commit or deploy.",
        fetchedAt: new Date().toISOString(),
        bands,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote ${path.relative(WEB_ROOT, OUTPUT)} using ${requestCount} API requests.`);
}

await main();
