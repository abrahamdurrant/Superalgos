import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#08080C",
          900: "#0A0A12",
          800: "#0F0F1A",
          700: "#15151F",
          600: "#1C1C2A",
          500: "#262636",
        },
        violet: {
          glow: "#A855F7",
          DEFAULT: "#8B5CF6",
          deep: "#7C3AED",
          dark: "#5B21B6",
        },
        mist: {
          DEFAULT: "#B4B4C8",
          dim: "#7A7A92",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(168,85,247,0.18), 0 18px 60px -18px rgba(124,58,237,0.55)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 60px -28px rgba(0,0,0,0.8)",
      },
      backgroundImage: {
        "violet-radial":
          "radial-gradient(120% 120% at 50% 0%, rgba(124,58,237,0.22) 0%, rgba(8,8,12,0) 55%)",
        "grid-faint":
          "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        pulseglow: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.7s cubic-bezier(0.22,1,0.36,1) both",
        float: "float 6s ease-in-out infinite",
        pulseglow: "pulseglow 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
