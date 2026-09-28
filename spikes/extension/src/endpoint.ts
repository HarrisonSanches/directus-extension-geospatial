import { getDatabase } from '@directus/api/database/index';
import { ItemsService } from '@directus/api/services/items';
import { getSchema } from '@directus/api/utils/get-schema';
import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';
import { radius, radiusRequestOf } from './radius.js';

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

		// The radius over the permitted query of whoever asks (F01-02). Any error, from Directus or from the database,
		// goes to the error handler of Directus.
		router.get('/radius/:collection', (req, res, next) => {
			Promise.resolve()
				.then(() => radius(radiusRequestOf(req.params.collection, req.query, req.accountability), context))
				.then((data) => res.json({ data }))
				.catch(next);
		});
	},
});
