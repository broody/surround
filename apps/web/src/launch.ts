/**
 * Play is still coming soon on the live site (surround.gg): the Dojo (#lobby
 * and its games) and Study (#study, the #play board) stay closed, and their
 * entry points show "Coming soon". They open in the dev server, and in any
 * build made with VITE_OPEN_PLAY=true.
 */
export const COMING_SOON = !(
  import.meta.env?.DEV || import.meta.env?.VITE_OPEN_PLAY === "true"
);
