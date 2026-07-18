/**
 * Branded primitive types.
 *
 * `string` is too permissive — `sessionId` and `toolCallId` are both
 * `string` at the type level, even though mixing them is always a bug.
 * We use TypeScript's "brand via intersection" pattern to give each
 * ID type a phantom marker the compiler can enforce.
 *
 * Casts happen ONLY at I/O boundaries (HTTP, fs, env, plugin input,
 * JSON hydrate). Domain code never sees a raw string that should be
 * branded — it always receives a `SessionId` / `ToolCallId` / etc.
 *
 * Brand markers use `readonly` so the brand cannot be stripped by
 * accident (`(x as any).__brand = "..."` still works but should never
 * happen in production code).
 */

declare const __brand: unique symbol;
export type Brand<T, K extends string> = T & { readonly [__brand]: K };

export type SessionId = Brand<string, "SessionId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type TurnId = Brand<string, "TurnId">;
export type ScheduleName = Brand<string, "ScheduleName">;

/** Cast helpers. Use ONLY at I/O boundaries where raw strings come
 *  in from outside the domain (HTTP, env, JSON.parse, plugin config). */
export const asSessionId = (raw: string): SessionId => raw as SessionId;
export const asToolCallId = (raw: string): ToolCallId => raw as ToolCallId;
export const asTurnId = (raw: string): TurnId => raw as TurnId;
export const asScheduleName = (raw: string): ScheduleName =>
  raw as ScheduleName;

/**
 * Helper for places where a string MAY be a branded ID but we need
 * to defend against the empty sentinel. Returns `undefined` for empty
 * input rather than casting "" as a valid id.
 */
export const asOptionalSessionId = (raw: string | undefined): SessionId | undefined =>
  raw && raw.length > 0 ? asSessionId(raw) : undefined;
export const asOptionalTurnId = (raw: string | undefined): TurnId | undefined =>
  raw && raw.length > 0 ? asTurnId(raw) : undefined;