import { TSchema } from "@mariozechner/pi-ai";

/**
 * Meta Tool definition (Phus-internal tools that let the AI modify itself.)
 */
export interface MetaTool {
  name: string;
  description: string;
  // JSON Schema
  parameters: TSchema;
  /** Map from validated args → result. Throwing is treated as failure. */
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
