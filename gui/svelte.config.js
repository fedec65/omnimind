/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  // No `compilerOptions.runes` here: Svelte 5 auto-detects runes mode per
  // component, and we deliberately keep that auto-detection. Forced global
  // runes was originally dropped because the then-used icon lib (lucide-svelte)
  // shipped legacy-mode `$$props` components; the current lib (@lucide/svelte)
  // is fully runes-native, but auto-detection is retained as a conservative
  // choice so any future legacy-mode component still compiles.
};
