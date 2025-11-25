import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		global: 'globalThis'
	},
	optimizeDeps: {
		include: ['d3', 'apexcharts', 'mapbox-gl']
	},
	server: {
		port: 3000,
		host: '0.0.0.0'
	}
});