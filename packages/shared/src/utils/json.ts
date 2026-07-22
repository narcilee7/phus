/**
 * JSON helpers — safe parse, fence-stripping for LLM output.
 */

/** Strip a leading ```json / ``` fence pair from a model response. The
 *  body inside the fence is returned trimmed; if no fence is found the
 *  whole string is trimmed. */
export const stripJson = (text: string): string => {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	if (fenced && fenced[1]) return fenced[1].trim();
	return text.trim();
};

/** Best-effort JSON parse. Returns `undefined` on failure rather than
 *  throwing — useful for parsing LLM output where failure is common. */
export const tryParseJson = <T = unknown>(raw: string): T | undefined => {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
};

/** Safe JSON.stringify wrapper that returns a sentinel rather than
 *  throwing on circular structures or BigInt. */
export const safeStringify = (value: unknown, indent = 0): string => {
	const seen = new WeakSet();
	return JSON.stringify(
		value,
		(_key, v) => {
			if (typeof v === "bigint") return `[bigint:${v.toString()}]`;
			if (typeof v === "object" && v !== null) {
				if (seen.has(v)) return "[Circular]";
				seen.add(v);
			}
			return v;
		},
		indent,
	);
};