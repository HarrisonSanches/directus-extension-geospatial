import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';
import { isReferenceLink, referencePath } from './src/reference.ts';

// The public docs, in English (D-060). The site goes online in F16, which also gives it its address.
export default defineConfig({
	integrations: [
		starlight({
			title: 'Geospatial',
			// The page not found is src/content/docs/404.md, which the route of Starlight would render a second time.
			disable404Route: true,
			// The build fails on a broken link, and the CI shows it on the line of the file.
			plugins: [starlightLinksValidator({ exclude: isReferenceLink, reporters: { githubActions: true } })],
			sidebar: [
				{ label: 'Guides', items: ['guides/radius'] },
				{ label: 'API reference', link: referencePath },
			],
		}),
	],
	// The reference of the API is one script of 1,575 kB, 459 kB with gzip, which only its page loads (D-060).
	vite: { build: { chunkSizeWarningLimit: 1600 } },
});
