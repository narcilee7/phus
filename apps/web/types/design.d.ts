declare module "@phus/phus-design/tailwind.config.mjs" {
  import type { Config } from "tailwindcss";
  const config: Config;
  export default config;
}

declare module "*.css" {
  const content: string;
  export default content;
}
