# Fix: Slash Command Dropdown Not Showing

## Root Cause
`App.ts` creates an `InputBox` but never calls `setAutocompleteProvider()` on it.
The `Editor` component inside `InputBox` has full autocomplete logic but it's gated behind having an `AutocompleteProvider` wired up.

## Fix 1: `packages/tui/src/components/input/InputBox.ts`

Add import at top:
```ts
import type { AutocompleteProvider } from "@/vendor/pi-tui/autocomplete.js";
```

Add method inside `InputBox` class (after constructor):
```ts
/** Wire up autocomplete (slash commands, file paths, @-mentions). */
setAutocompleteProvider(provider: AutocompleteProvider): void {
    this.editor.setAutocompleteProvider(provider);
}
```

## Fix 2: `packages/tui/src/App.ts`

Add imports at top:
```ts
import { CombinedAutocompleteProvider } from "@/vendor/pi-tui/autocomplete.js";
import { SLASH_COMMANDS } from "@/handler/commands/commands.js";
```

In `attach()` method, after `this.inputBox = new InputBox(...)` add:
```ts
// Wire up autocomplete: slash commands + file paths + @-file search
const fdPath = (() => {
    const env = process.env.FD_PATH;
    if (env) return env;
    // Probe shell for fd location
    try {
        const { execSync } = await import("node:child_process");
        return execSync("which fd 2>/dev/null", { encoding: "utf-8" }).trim() || null;
    } catch { return null; }
})();
this.inputBox.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
        SLASH_COMMANDS.map(c => ({ name: c.name, description: c.description })),
        process.cwd(),
        await fdPath,
    ),
);
```

Wait, `attach()` is not async. Simpler approach — just use `which fd` sync:

```ts
import { execSync } from "node:child_process";

// In attach(), after inputBox creation:
let fdPath: string | null = null;
try {
    fdPath = execSync("which fd 2>/dev/null", { encoding: "utf-8" }).trim() || null;
} catch { /* fd not found, file autocomplete will use readdirSync fallback */ }

this.inputBox.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
        SLASH_COMMANDS.map(c => ({ name: c.name, description: c.description })),
        process.cwd(),
        fdPath,
    ),
);
```

## What This Enables
- Type `/` → dropdown with fuzzy-filtered slash commands
- Type `/skill ` → if a command has `getArgumentCompletions`, it'll show arg suggestions  
- Type `@` → fuzzy file path completion using `fd`
- Tab on a file path → path completion
- Tab on a slash command name → autocomplete the command
