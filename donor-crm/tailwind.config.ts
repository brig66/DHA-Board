import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        teal: {
          50: "#eef7f5",
          100: "#d7ece7",
          600: "#1f6f66",
          700: "#195c54",
        },
        coral: {
          100: "#f6e6de",
          600: "#c4623f",
        },
        ink: "#22201b",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        body: ["'Source Sans 3'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
