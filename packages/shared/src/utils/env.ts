/**
 * Env helpers — typed access to process.env with sensible defaults.
 */

export type EnvKey =
	| "PHUS_HOME"
	| "PHUS_PROFILE"
	| "PHUS_LOG_FILE"
	| "PHUS_LOG_LEVEL"
	| "PHUS_DEBUG_WIRE"
	| "OPENAI_API_KEY"
	| "ANTHROPIC_API_KEY"
	| "OPENROUTER_API_KEY"
	| "GEMINI_API_KEY"
	| "DEEPSEEK_API_KEY"
	| "GROQ_API_KEY"
	| "MISTRAL_API_KEY"
	| "XAI_API_KEY"
	| "HF_TOKEN"
	| "ANTHROPIC_OAUTH_TOKEN"
	| "TELEGRAM_TOKEN"
	| "TELEGRAM_ALLOW_USERS"
	| "TELEGRAM_ALLOW_CHATS";

export const env = (key: EnvKey, fallback?: string): string | undefined =>
	process.env[key] ?? fallback;

export const requireEnv = (key: EnvKey): string => {
	const v = process.env[key];
	if (!v) throw new Error(`Missing required env var: ${key}`);
	return v;
};

export const isTruthyEnv = (key: EnvKey): boolean => {
	const v = process.env[key];
	return v === "1" || v === "true" || v === "yes";
};