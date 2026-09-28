// Imports every page of the Online-Go.com Learning Hub (AGPL-3.0-or-later) as
// Study Room lesson data, for choosing which lessons Surround uses.
//
//   git clone --depth 1 https://github.com/online-go/online-go.com.git /tmp/ogs
//   npm run lessons:ogs -- /tmp/ogs
//
// Reads the live sections in src/views/LearningHub/sections.ts, in order:
// move puzzles, multiple-choice questions, the dead-stone removal page and the
// button pages. Each page is checked under Surround's rules; a page that
// doesn't hold up keeps an `issues` list so it can be reviewed or adapted.
//
// The output goes to public/lessons/ogs/, which is not committed: the lessons
// are headed for the database. Every page has a stable id,
// "<section>/<lesson>/<page class>", to key it by there.

import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { groupAt } from "../src/game/rules.ts";
import {
  lessonMarks,
  lessonPosition,
  replayLine,
  type LessonBoard,
} from "../src/study/lessonEngine.ts";
import type { OgsPage } from "../src/study/ogsLibrary.ts";

const WEB_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const OUTPUT = path.join(WEB_ROOT, "public/lessons/ogs");

const checkout = process.argv[2];
if (!checkout) {
  console.error("Usage: npm run lessons:ogs -- <online-go.com checkout>");
  process.exit(1);
}
const hub = path.join(checkout, "src/views/LearningHub");
const commit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"])
  .toString()
  .trim();

async function parse(file: string) {
  return ts.createSourceFile(
    file,
    await readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function propertyName(name: ts.PropertyName) {
  return ts.isIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
    ? name.text
    : name.getText();
}

/** The value of a literal expression. A call, such as the move tree's
 * `this.makePuzzleMoveTree([...], [...])`, gives its arguments' values. */
function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isParenthesizedExpression(node)) return literal(node.expression);
  if (ts.isCallExpression(node)) return node.arguments.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property))
          throw new Error(`Unsupported property ${property.getText()}`);
        return [propertyName(property.name), literal(property.initializer)];
      }),
    );
  throw new Error(`Not a literal: ${node.getText()}`);
}

const method = (declaration: ts.ClassDeclaration, name: string) =>
  declaration.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) && propertyName(member.name) === name,
  );

function returned(declaration: ts.ClassDeclaration, name: string) {
  const body = method(declaration, name)?.body;
  return body?.statements.findLast(ts.isReturnStatement)?.expression;
}

/** The English text of `_("…")` or the last argument of `pgettext(…, "…")`. */
function translated(node: ts.Node | undefined) {
  if (
    node &&
    ts.isCallExpression(node) &&
    ["_", "pgettext"].includes(node.expression.getText())
  ) {
    const last = node.arguments.at(-1);
    if (last && ts.isStringLiteralLike(last)) return last.text;
  }
  return undefined;
}

function extendsClass(declaration: ts.Statement, base: string) {
  return (
    ts.isClassDeclaration(declaration) &&
    declaration.heritageClauses?.[0]?.types[0]?.expression.getText() === base
  );
}

/** The live sections, in order, with each lesson's class and file. */
async function readSections() {
  const source = await parse(path.join(hub, "sections.ts"));
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = (statement.moduleSpecifier as ts.StringLiteral).text;
    const bindings = statement.importClause?.namedBindings;
    if (
      from.startsWith("./Sections/") &&
      bindings &&
      ts.isNamedImports(bindings)
    )
      for (const element of bindings.elements)
        imports.set(element.name.text, path.join(hub, `${from}.tsx`));
  }
  const list = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((item) => item.name.getText() === "sections")?.initializer;
  if (!list || !ts.isArrayLiteralExpression(list))
    throw new Error("sections.ts no longer exports a sections array");
  return list.elements.map((entry) => {
    const [title, lessons] = (entry as ts.ArrayLiteralExpression).elements;
    if (!ts.isArrayLiteralExpression(lessons))
      throw new Error("Unexpected lessons");
    return {
      title: translated(title)!,
      lessons: lessons.elements.map((lesson) => {
        const file = imports.get(lesson.getText());
        if (!file) throw new Error(`No import for ${lesson.getText()}`);
        return { name: lesson.getText(), file };
      }),
    };
  });
}

/** A multiple-choice page's question, option labels and answer, from the
 * radio buttons its text() renders. */
function readChoice(text: ts.MethodDeclaration) {
  const question: string[] = [];
  const options: { value?: string; label: string[] }[] = [];
  let answer: string | undefined;
  const visit = (node: ts.Node, option?: (typeof options)[number]) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText() === "label"
    ) {
      const found = { label: [] as string[] } as (typeof options)[number];
      options.push(found);
      node.forEachChild((child) => visit(child, found));
      return;
    }
    if (ts.isJsxAttribute(node) && option && node.name.getText() === "value") {
      if (node.initializer && ts.isStringLiteral(node.initializer))
        option.value = node.initializer.text;
      return;
    }
    const words =
      translated(node) ??
      (ts.isJsxText(node) && node.text.trim() ? node.text.trim() : undefined);
    if (words !== undefined) {
      (option ? option.label : question).push(words);
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText() === "selectedValue" &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isStringLiteralLike(node.right)
    )
      answer = node.right.text;
    node.forEachChild((child) => visit(child, option));
  };
  visit(text);
  const labels = options.map((option) => option.label.join(" "));
  const correct = options.find((option) => option.value === answer);
  if (!question.length || options.length < 2 || !correct)
    throw new Error("Unreadable multiple-choice page");
  return {
    text: question.join(" "),
    options: labels,
    answer: correct.label.join(" "),
  };
}

// OGS counts Japanese-style (territory plus prisoners); Surround counts area.
const SCORING = /\b(territory|points?|prisoners?|score|won|wins?|winner)\b/i;

function readPage(page: ts.ClassDeclaration, id: string): OgsPage {
  const config = literal(returned(page, "config")!) as Record<string, unknown>;
  const size = (config.width as number | undefined) ?? 9;
  if ((config.height ?? size) !== size)
    throw new Error(`${id}: rectangular boards are not supported`);
  const state = config.initial_state as { black?: string; white?: string };
  const board: LessonBoard = {
    ...(size !== 9 && { size: size as 9 | 13 | 19 }),
    ...(state.black && { black: state.black }),
    ...(state.white && { white: state.white }),
    ...(config.initial_player === "white" && { toPlay: "white" as const }),
    ...(config.marks !== undefined && {
      marks: config.marks as Record<string, string>,
    }),
    ...(config.bounds !== undefined && {
      bounds: config.bounds as LessonBoard["bounds"],
    }),
  };
  const text = translated(returned(page, "text"));

  const button = method(page, "button");
  if (button) {
    let label: string | undefined;
    button.forEachChild(function find(node) {
      label ??= translated(node);
      node.forEachChild(find);
    });
    return { id, kind: "action", text: text!, ...board, button: label! };
  }
  if (text === undefined)
    return {
      id,
      kind: "choice",
      ...board,
      ...readChoice(method(page, "text")!),
    };
  if (config.phase === "stone removal") {
    // onStoneRemoval compares the marked stones against one string.
    let dead: string | undefined;
    method(page, "onStoneRemoval")!.forEachChild(function find(node) {
      if (ts.isBinaryExpression(node) && ts.isStringLiteralLike(node.right))
        dead = node.right.text;
      node.forEachChild(find);
    });
    return { id, kind: "removal", text, ...board, dead: dead! };
  }
  if (config.move_tree === undefined)
    throw new Error(`${id}: a page without moves, choices or a button`);
  // The tree's width and height arguments repeat the board size. OGS
  // occasionally lists an empty line, which marks nothing.
  const [correct, wrong] = (config.move_tree as string[][])
    .slice(0, 2)
    .map((lines) => lines.filter(Boolean));
  return {
    id,
    kind: "puzzle",
    text,
    ...board,
    correct,
    ...(wrong.length && { wrong }),
  };
}

function validate(page: OgsPage) {
  const issues: string[] = [];
  try {
    const { board } = lessonPosition(page);
    // Illustrations may show a capture in progress; only boards the learner
    // plays on must start legal.
    if (page.kind === "puzzle" || page.kind === "removal")
      board.forEach((stone, point) => {
        if (stone && !groupAt(board, point).liberties.size)
          issues.push(`The stone at ${point} starts without a liberty.`);
      });
    lessonMarks(page);
  } catch (error) {
    return [`Setup: ${(error as Error).message}`];
  }
  if (page.kind === "choice" && SCORING.test(page.text))
    issues.push(
      "Asks about points or the winner as OGS counts them (territory and prisoners); check the answer under area scoring.",
    );
  if (page.kind !== "puzzle" || page.correct === "anywhere") return issues;
  if (!page.correct.length) issues.push("No line solves the page.");
  const lines = [
    ...page.correct.map((line) => [line, "correct"] as const),
    ...(page.wrong ?? []).map((line) => [line, "wrong"] as const),
  ];
  for (const [line, expected] of lines) {
    try {
      const outcome = replayLine(page, line).outcome;
      if (outcome !== expected)
        issues.push(`"${line}" should be ${expected} but ends ${outcome}.`);
    } catch (error) {
      issues.push((error as Error).message.replace(/[^.!?]$/, "$&."));
    }
  }
  return issues;
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function main() {
  const sections = await readSections();
  // Files are replaced in place so a running dev server keeps serving them.
  await mkdir(OUTPUT, { recursive: true });
  for (const file of await readdir(OUTPUT))
    if (file.endsWith(".json")) await rm(path.join(OUTPUT, file));
  const index = [];
  const kinds: Record<string, number> = {};
  let flagged = 0;
  for (const section of sections) {
    const sectionId = slug(section.title);
    const lessons = [];
    for (const { name, file } of section.lessons) {
      const source = await parse(file);
      const classes = new Map(
        source.statements
          .filter(ts.isClassDeclaration)
          .map((declaration) => [declaration.name?.text, declaration]),
      );
      const lesson = classes.get(name);
      if (!lesson || !extendsClass(lesson, "LearningHubSection"))
        throw new Error(`${name} is not a lesson in ${file}`);
      const lessonId = (returned(lesson, "section") as ts.StringLiteral).text;
      const pageNames = (
        returned(lesson, "pages") as ts.ArrayLiteralExpression
      ).elements.map((element) => element.getText());
      const pages = pageNames.map((pageName) => {
        const declaration = classes.get(pageName);
        if (!declaration || !extendsClass(declaration, "LearningPage"))
          throw new Error(`${pageName} is not a page in ${file}`);
        const page = readPage(
          declaration,
          `${sectionId}/${lessonId}/${pageName}`,
        );
        const issues = validate(page);
        if (issues.length) {
          page.issues = issues;
          flagged++;
        }
        kinds[page.kind] = (kinds[page.kind] ?? 0) + 1;
        return page;
      });
      lessons.push({
        id: `${sectionId}/${lessonId}`,
        title: translated(returned(lesson, "title"))!,
        subtext: translated(returned(lesson, "subtext")) ?? "",
        file: path.relative(path.join(hub, "Sections"), file),
        pages,
      });
    }
    await writeFile(
      path.join(OUTPUT, `${sectionId}.json`),
      `${JSON.stringify({ id: sectionId, title: section.title, lessons })}\n`,
    );
    const pages = lessons.reduce((sum, lesson) => sum + lesson.pages.length, 0);
    index.push({
      id: sectionId,
      title: section.title,
      lessons: lessons.length,
      pages,
    });
    console.log(`${section.title}: ${lessons.length} lessons, ${pages} pages`);
  }
  await writeFile(
    path.join(OUTPUT, "index.json"),
    `${JSON.stringify(
      {
        source: `https://github.com/online-go/online-go.com/tree/${commit}/src/views/LearningHub`,
        copyright: "Copyright (C) Online-Go.com",
        license: "AGPL-3.0-or-later",
        importedAt: new Date().toISOString(),
        sections: index,
      },
      null,
      2,
    )}\n`,
  );
  const total = Object.values(kinds).reduce((sum, count) => sum + count, 0);
  console.log(
    `Imported ${total} pages (${Object.entries(kinds)
      .map(([kind, count]) => `${count} ${kind}`)
      .join(
        ", ",
      )}); ${flagged} flagged for review. Source ${commit.slice(0, 7)}.`,
  );
}

await main();
