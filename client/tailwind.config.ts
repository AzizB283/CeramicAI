import type { Config } from "tailwindcss";

/**
 * Aurex Auto brand palette for CeramicBot.
 * Cream background, dark bot bubbles, coral accent (per build spec).
 */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Aurex Auto brand
        cream: {
          DEFAULT: "#faf3e7", // page / chat background
          deep: "#f3e9d6",
        },
        coral: {
          DEFAULT: "#e85d04", // primary accent (spec: widget_color default e85d04)
          dark: "#c44d00",
          light: "#fb8b24",
        },
        ink: {
          DEFAULT: "#2b2b2b", // bot bubble / text
          soft: "#4a4a4a",
        },
      },
      fontFamily: {
        sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "30%": { transform: "translateY(-4px)", opacity: "1" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.25s ease-out",
        "typing-dot": "typing-dot 1.2s infinite ease-in-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
