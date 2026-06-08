import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        // Warm "atelier" palette — bone paper, ink, signature evergreen.
        paper: "#F4F1EA",
        "paper-deep": "#EBE5D9",
        surface: "#FDFCFA",
        "surface-raised": "#FFFFFF",
        ink: {
          DEFAULT: "#1B1814",
          soft: "#6E675B",
          faint: "#A49B8B",
        },
        line: {
          DEFAULT: "#E6E0D2",
          strong: "#D7CFBE",
        },
        accent: {
          DEFAULT: "#1C4A3A",
          bright: "#2C6F54",
          wash: "#E7EFE9",
          ink: "#12342A",
        },
        honey: {
          DEFAULT: "#A8761F",
          wash: "#F3E9D3",
        },
        clay: {
          DEFAULT: "#A8432B",
          wash: "#F4E3DC",
        },
        slatey: {
          DEFAULT: "#3C5A78",
          wash: "#E3E9F0",
        },
      },
      borderRadius: {
        card: "16px",
        field: "10px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(27,24,20,0.04), 0 1px 3px rgba(27,24,20,0.03)",
        card: "0 1px 2px rgba(27,24,20,0.04), 0 16px 32px -18px rgba(27,24,20,0.18)",
        lift: "0 2px 6px rgba(27,24,20,0.06), 0 28px 54px -22px rgba(27,24,20,0.26)",
        ring: "0 0 0 1px rgba(27,24,20,0.06)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "draw-line": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
      },
      animation: {
        rise: "rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.5s ease both",
        "draw-line": "draw-line 0.8s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
