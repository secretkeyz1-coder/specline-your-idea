import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // Content-Security-Policy for every rendered page (T200, docs/13 §3).
    // SvelteKit nonces its own inline hydration script (nothing is prerendered,
    // so "auto" means nonces), and app.html's theme script carries
    // %sveltekit.nonce%: script-src needs no 'unsafe-inline'. Styles keep it —
    // components use style="" attributes. Mockup iframes (srcdoc) inherit this
    // policy, but they are sandboxed without allow-scripts anyway and carry their
    // own stricter meta CSP. hooks.server.ts sends the same policy on endpoint
    // responses and the other security headers.
    csp: {
      mode: "auto",
      directives: {
        "default-src": ["self"],
        "script-src": ["self"],
        "style-src": ["self", "unsafe-inline"],
        "img-src": ["self", "data:", "blob:"],
        "font-src": ["self", "data:"],
        "connect-src": ["self"],
        "frame-ancestors": ["none"],
        "base-uri": ["self"],
        "form-action": ["self"],
      },
    },
  },
};

export default config;
