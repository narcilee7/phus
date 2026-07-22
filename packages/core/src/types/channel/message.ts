// Re-export from @phus/shared. The wire-format protocol shapes live in
// @phus/shared/protocol/envelope.js so channels / plugins / apps can
// reference them without pulling in core's runtime business logic.
export * from "@phus/shared/protocol/envelope.js";