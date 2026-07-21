// Re-export every shadcn-style component. Consumers can
//   import { Button, Card, CardHeader } from "@phus/phus-design"
//
// Components are split across files so consumers can tree-shake
// unused ones; the barrel is only for convenience.

export * from "./button.js";
export * from "./card.js";
export * from "./badge.js";
export * from "./input.js";
export * from "./avatar.js";