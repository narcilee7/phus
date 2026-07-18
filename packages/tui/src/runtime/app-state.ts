// src/tui/runtime/app-state.ts
// Wraps the pure reducer in a tiny store object so non-React code
// (the pi-tui App class, slash-command handlers, plan event hooks)
// can `dispatch(...)` without going through React's `useReducer`.
//
// The store also owns the single render-notification callback that
// every Component subscribes to (replacing React's per-component
// re-render loop).

import {
	appReducer,
	initialState,
	type AppAction,
	type AppState,
} from "@/state/state.js";

export type AppStore = {
	readonly getState: () => AppState;
	readonly dispatch: (action: AppAction) => void;
	/** Replace the listener used to schedule re-renders. */
	setRenderTrigger(fn: () => void): void;
};

export function createAppStore(): AppStore {
	let state: AppState = initialState;
	let renderTrigger: () => void = () => {};
	return {
		getState: () => state,
		dispatch(action) {
			state = appReducer(state, action);
			renderTrigger();
		},
		setRenderTrigger(fn) {
			renderTrigger = fn;
		},
	};
}

export type { AppAction, AppState };
