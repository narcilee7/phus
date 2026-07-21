// postcss.config.mjs
// Minimal PostCSS config for Tailwind v3 — autoprefixer + tailwindcss.
// Consumers can extend this with their own plugins if needed.

const config = {
	plugins: {
		tailwindcss: {},
		autoprefixer: {},
	},
};

export default config;