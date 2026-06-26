import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces — clean white with very light greys for separation
        ink: "#ffffff",       // page background (was near-black)
        panel: "#ffffff",     // card background
        edge: "#e2e8f0",      // hairline border (slate-200)
        muted: "#f8fafc",     // subtle stripe / input background (slate-50)

        // Text helpers (used inline as well as via Tailwind's slate scale)
        body: "#0f172a",      // primary text (slate-900)
        subtle: "#64748b",    // secondary text (slate-500)

        // MongoDB accents
        accent: "#00684A",    // MongoDB forest green — primary action colour
        accentSoft: "#E3FCEF",// pale green wash for backgrounds / chips
        accentEdge: "#00ED64",// brighter green for highlights / focus

        // Status colours
        warn: "#b45309",      // amber-700 — readable on white
        danger: "#b91c1c",    // red-700
        ok: "#15803d",        // green-700

        // Classification colours (kept distinct so chips remain readable on white)
        ts: "#b91c1c",        // TOP SECRET — red
        s: "#c2410c",         // SECRET — burnt orange
        official: "#15803d",  // OFFICIAL — green
      },
    },
  },
  plugins: [],
};

export default config;
