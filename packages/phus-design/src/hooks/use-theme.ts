// src/hooks/use-theme.ts
// Tiny theme controller — toggles the `.dark` class on the root
// element. Reads from localStorage so the choice persists across
// reloads. Consumers wire it once at the app shell.

import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "phus-design.theme";

const systemPrefersDark = (): boolean =>
	typeof window !== "undefined" &&
	window.matchMedia("(prefers-color-scheme: dark)").matches;

export const useTheme = () => {
	const [theme, setThemeState] = useState<Theme>(() => {
		if (typeof window === "undefined") return "system";
		const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
		return stored ?? "system";
	});

	useEffect(() => {
		const root = document.documentElement;
		const apply = (t: Theme) => {
			const isDark = t === "dark" || (t === "system" && systemPrefersDark());
			root.classList.toggle("dark", isDark);
		};
		apply(theme);
		window.localStorage.setItem(STORAGE_KEY, theme);
	}, [theme]);

	return { theme, setTheme: setThemeState };
};