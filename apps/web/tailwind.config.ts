import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12263a",
        paper: "#f8f6f0",
        ember: "#f97316",
        moss: "#2f855a",
      },
      fontFamily: {
        heading: ["'IBM Plex Serif'", "serif"],
        body: ["'IBM Plex Sans'", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
