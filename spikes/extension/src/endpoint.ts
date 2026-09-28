import { getDatabase } from '@directus/api/database/index';
import { ItemsService } from '@directus/api/services/items';
import { getSchema } from '@directus/api/utils/get-schema';
import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';

export default defineEndpoint({
	id: 'geospatial-spikes',
	handler: (router, context) => {
		// Whether what the spike imports from @directus/api is the running Directus, and not a copy: the same class, the
		// same connection and the same function behind the context Directus hands to the extension (F01-01).
		router.get('/internals', (req, res, next) => {
			if (req.accountability?.admin !== true) {
				next(new ForbiddenError());

				return;
			}

			res.json({
				data: {
					itemsService: ItemsService === context.services.ItemsService,
					database: getDatabase() === context.database,
					getSchema: getSchema === context.getSchema,
					// Where Node resolved the package from, inside the image of Directus.
					resolved: import.meta.resolve('@directus/api/services/items'),
				},
			});
		});
	},
});
