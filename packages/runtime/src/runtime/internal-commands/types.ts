// packages/runtime/src/runtime/internal-commands/types.ts
// Public types for the internal-command subsystem.
// Lives in runtime (Stage 1a moved it out of core to break the cycle
// with @/bridge/pi-agent).

import type { PhusAgentFacade } from "@/bridge/pi-agent";
import type { ChannelAdapter } from "@/channels/base";
import type { Scheduler } from "../../../core/runtime/scheduler/index.js";

/** Where the command was invoked. */
export type CommandSurface = "cli" | "tui";

/** Context passed to every command handler at execution time. */
export interface InternalCommandContext {
	args: Record<string, string>;
	positional: string[];
	surface: CommandSurface;
}

/** An internal command. Handlers may be sync or async. Returning a
 *  string prints it to the surface; returning null is silent success. */
export interface InternalCommand {
	name: string;
	description: string;
	/** Example usage, e.g. "[n=5]" or "name=<n>". */
	usage?: string;
	handler: (ctx: InternalCommandContext) => string | null | Promise<string | null>;
}

/** Parse result returned by `parse()`. */
export interface ParsedCommand {
	name: string;
	args: Record<string, string>;
	positional: string[];
}

/** Services injected into the registry. */
export interface InternalCommandServices {
	agent: PhusAgentFacade;
	home: () => string;
	mesh?: import("@/llm/provider-mesh/contract.js").MeshLike;
	scheduler?: Scheduler | undefined;
	extraChannels?: () => ChannelAdapter[];
}

/** Narrow view of the scheduler surface used by the `,schedule.*`
 *  builtins. The concrete `Scheduler` class satisfies this. */
export interface SchedulerLike {
	list(): ReadonlyArray<{
		name: string;
		cron: string;
		hookName: string;
		enabled: boolean | undefined;
	}>;
	register(schedule: unknown): void;
	unregister(name: unknown): boolean;
	setEnabled(name: unknown, enabled: boolean): boolean;
}
