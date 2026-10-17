import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';
import { defineCollection } from 'astro:content';

// The pages of the docs, in src/content/docs, and the texts of the interface of Starlight, in src/content/i18n, as
// Starlight reads them. The en.json there changes none of them, and without a file Starlight warns on each build.
export const collections = {
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
	i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
