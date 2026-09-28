import { getDatabase } from '@directus/api/database/index';
import { ItemsService } from '@directus/api/services/items';
import { getSchema } from '@directus/api/utils/get-schema';
import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';
import { adapters, candidates } from './adapters.js';
import { problemsOf } from './check.js';
import { envelope, envelopeRequestOf } from './envelope.js';
import { record, take } from './queries.js';
import { radius, radiusRequestOf } from './radius.js';
import { tile, tileRequestOf } from './tile.js';

export default defineEndpoint({
	id: 'geospatial-spikes',
	handler: (router, context) => {
		context.database.on('query', record);

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

		// What the running Directus lacks of what each adapter expects, and the adapter the radius takes (F01-06). Only
		// the admin reads it, since it describes the internals of Directus.
		router.get('/adapters', (req, res, next) => {
			if (req.accountability?.admin !== true) {
				next(new ForbiddenError());

				return;
			}

			Promise.resolve()
				.then(async () => {
					const chain = { schema: await context.getSchema(), knex: context.database };
					const problems = Object.fromEntries(
						await Promise.all(
							Object.values(adapters).map(async (adapter): Promise<[string, string[]]> => [
								adapter.name,
								await problemsOf(adapter, chain),
							]),
						),
					);
					const selected = candidates.find(({ name }) => problems[name]?.length === 0)?.name ?? null;

					res.json({ data: { selected, problems } });
				})
				.catch(next);
		});

		// The queries that reached the database since the last read (F01-06). Only the admin reads them.
		router.get('/queries', (req, res, next) => {
			if (req.accountability?.admin !== true) {
				next(new ForbiddenError());

				return;
			}

			res.json({ data: take() });
		});

		// The radius over the permitted query of whoever asks (F01-02). Any error, from Directus or from the database,
		// goes to the error handler of Directus.
		router.get('/radius/:collection', (req, res, next) => {
			Promise.resolve()
				.then(() =>
					radius(radiusRequestOf(req.params.collection, req.query, req.sanitizedQuery, req.accountability), context),
				)
				.then((data) => res.json({ data }))
				.catch(next);
		});

		// The minimal envelope over the permitted query of whoever asks, on a database outside the suite (F01-08).
		router.get('/envelope/:collection', (req, res, next) => {
			Promise.resolve()
				.then(() =>
					envelope(
						envelopeRequestOf(req.params.collection, req.query, req.sanitizedQuery, req.accountability),
						context,
					),
				)
				.then((data) => res.json({ data }))
				.catch(next);
		});

		// The vector tile of the permitted query of whoever asks, with the items grouped by cells of the screen (F01-13).
		router.get('/tile/:collection/:z/:x/:y', (req, res, next) => {
			Promise.resolve()
				.then(() =>
					tile(
						tileRequestOf(req.params.collection, req.params, req.query, req.sanitizedQuery, req.accountability),
						context,
					),
				)
				.then((data) => res.type('application/vnd.mapbox-vector-tile').send(data))
				.catch(next);
		});
	},
});
