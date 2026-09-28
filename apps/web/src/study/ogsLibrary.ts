import type { Lesson, LessonBoard, LessonPage, PageTask } from "./lessonEngine";

/** A page as imported from the Online-Go.com Learning Hub, with its original
 * text. See scripts/import-ogs-lessons.ts. */
export type OgsPage = LessonBoard & {
  /** "<section>/<lesson>/<page class>", stable across imports. */
  id: string;
  text: string;
  issues?: string[];
} & PageTask;

export type OgsLesson = {
  id: string;
  title: string;
  subtext: string;
  /** The lesson's file under OGS's src/views/LearningHub/Sections. */
  file: string;
  pages: OgsPage[];
};

export type OgsSection = { id: string; title: string; lessons: OgsLesson[] };

export type OgsIndex = {
  source: string;
  sections: { id: string; title: string; lessons: number; pages: number }[];
};

/** Splits OGS's text into Ayu's explanation and the task, taken as its last
 * sentence ("…White to play. Capture the marked stone."). */
export function splitTask(text: string) {
  const sentences = text.trim().split(/(?<=[.!?])\s+(?=["'(A-Z0-9])/);
  const goal = sentences.pop() ?? "";
  return { text: sentences.join(" "), goal };
}

export const toLesson = (lesson: OgsLesson): Lesson => ({
  title: lesson.title,
  subtext: lesson.subtext,
  pages: lesson.pages.map(
    (page) => ({ ...page, ...splitTask(page.text) }) as LessonPage,
  ),
});

// The import is kept out of git until the lessons move to the database, so it
// is fetched at runtime and may be missing.
const base = `${import.meta.env?.BASE_URL ?? "/"}lessons/ogs/`;

async function fetchJson<T>(file: string): Promise<T | null> {
  try {
    const response = await fetch(base + file);
    const type = response.headers.get("content-type") ?? "";
    return response.ok && type.includes("json") ? await response.json() : null;
  } catch {
    return null;
  }
}

export const loadOgsIndex = () => fetchJson<OgsIndex>("index.json");
export const loadOgsSection = (id: string) =>
  fetchJson<OgsSection>(`${id}.json`);
