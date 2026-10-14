// Renders the docs' Go diagrams to PNGs with the game's own board, so the docs
// show the real board and stones without loading Pixi or WebGL.
//
// It finds every <Board rows={[...]} size={...} /> in apps/docs/src/pages,
// draws each one with BoardCanvas (main.tsx) in headless Chrome at 2× for
// sharp Retina displays, and writes apps/docs/public/diagrams/<key>.png,
// removing images no page uses any more. Run it after changing a diagram:
//
//   npm run diagrams:docs --prefix apps/web
//
// It uses the installed Chrome; set CHROME_PATH to use another browser.
import { readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";
import {
  diagramKey,
  DIAGRAM_SIZE,
} from "../../../docs/src/components/diagramKey.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const web = join(here, "../..");
const pages = join(web, "../docs/src/pages");
const out = join(web, "../docs/public/diagrams");
const SCALE = 2;

async function mdxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return mdxFiles(path);
      return Promise.resolve(entry.name.endsWith(".mdx") ? [path] : []);
    }),
  );
  return files.flat();
}

type Diagram = { key: string; rows: string[]; size: number; from: string };

async function diagrams() {
  const found = new Map<string, Diagram>();
  for (const file of await mdxFiles(pages)) {
    const text = await readFile(file, "utf8");
    for (const [, props] of text.matchAll(/<Board\b([\s\S]*?)\/>/g)) {
      const list = props.match(/rows=\{\[([\s\S]*?)\]\}/)?.[1];
      if (!list) throw new Error(`${file}: a Board without rows`);
      const rows = [...list.matchAll(/'([^']*)'|"([^"]*)"/g)].map(
        (match) => match[1] ?? match[2],
      );
      const size = Number(props.match(/size=\{(\d+)\}/)?.[1] ?? DIAGRAM_SIZE);
      const key = diagramKey(rows, size);
      found.set(key, { key, rows, size, from: file });
    }
  }
  return [...found.values()];
}

const wanted = await diagrams();
const server = await createServer({
  root: here,
  configFile: false,
  logLevel: "warn",
  plugins: [react()],
  server: { port: 0, fs: { allow: [web] } },
});
await server.listen();
const url = server.resolvedUrls!.local[0];
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  // WebGL without a GPU.
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ deviceScaleFactor: SCALE });
  await mkdir(out, { recursive: true });
  for (const { key, rows, size, from } of wanted) {
    await page.setViewportSize({ width: size + 40, height: size + 40 });
    await page.goto(`${url}?d=${encodeURIComponent(JSON.stringify({ rows, size }))}`);
    const board = page.locator('.board-canvas[data-ready="true"]');
    await board.waitFor({ timeout: 20_000 }).catch(() => {
      throw new Error(`${from}: diagram ${key} never finished drawing`);
    });
    // A frame for the last paint to reach the screen.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await writeFile(join(out, `${key}.png`), await board.screenshot());
    console.log(`${key}.png  ${size}px  ${from.slice(pages.length + 1)}`);
  }
} finally {
  await browser.close();
  await server.close();
}

const keep = new Set(wanted.map(({ key }) => `${key}.png`));
for (const name of await readdir(out))
  if (name.endsWith(".png") && !keep.has(name)) {
    await rm(join(out, name));
    console.log(`removed ${name}`);
  }
