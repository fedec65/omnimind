/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  // No `compilerOptions.runes` here: forcing runes mode globally breaks
  // @lucide/svelte (legacy `$$props` icon components). Svelte 5 auto-detects
  // runes per component, so app files using `$state`/`$props` still compile
  // in runes mode.
};
