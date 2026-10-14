/**
 * Play is still coming soon on the live site (surround.gg): the Dojo (#lobby
 * and its games) and Study (#study, the #play board) stay closed, and their
 * entry points show "Coming soon". They open in the dev server, and in any
 * build made with VITE_OPEN_PLAY=true.
 */
export const COMING_SOON = !(
  import.meta.env?.DEV || import.meta.env?.VITE_OPEN_PLAY === "true"
);

/**
 * The documentation site (apps/docs): its dev server in development, else
 * VITE_DOCS_URL, else docs.surround.gg.
 */
export const DOCS_URL: string = import.meta.env?.DEV
  ? "http://localhost:5190"
  : (import.meta.env?.VITE_DOCS_URL ?? "https://docs.surround.gg");
