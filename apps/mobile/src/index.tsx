// apps/mobile/src/index.tsx
//
// React Native / Expo entry point (placeholder). Once the mobile
// host is designed, this becomes the registration root:
//   AppRegistry.registerComponent("Phus", () => App);
// and App will mirror apps/web's App shell.

import * as React from "react";

export const App: React.FC = () =>
	React.createElement(
		"main",
		{ className: "phus-mobile-placeholder" },
		React.createElement(
			"h1",
			null,
			"⛵️  Phus mobile — placeholder",
		),
	);

export default App;