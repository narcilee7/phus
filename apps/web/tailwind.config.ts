import type { Config } from "tailwindcss";
import baseConfig from "@phus/phus-design/tailwind.config.mjs";

const config: Config = {
  darkMode: baseConfig.darkMode,
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "../node_modules/@phus/phus-design/dist/**/*.{js,ts,tsx}",
    "../../node_modules/@phus/phus-design/dist/**/*.{js,ts,tsx}",
  ],
  theme: baseConfig.theme,
  plugins: baseConfig.plugins,
};

export default config;
