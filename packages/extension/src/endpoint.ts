import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';
import type { CapabilitiesResponse, ItemsResponse, RegisterQueryResponse } from 'directus-geospatial-contract';
import { pageQueryWith } from './internals/page.js';
import { permittedQueryWith } from './internals/permitted.js';
import { checkOnStartup } from './internals/startup.js';
import { limits } from './limits.js';
import { idKeyOf } from './query/id.js';
import { memoryRegistry } from './query/registry.js';
import { readCapabilities } from './routes/capabilities.js';
import { getItems, queryItems, searchItems } from './routes/items.js';
import { readOpenapi } from './routes/openapi.js';
import { registerQuery } from './routes/queries.js';

export default defineEndpoint({
	id: 'geospatial',
	handler: (router, context) => {
		const logger = context.logger.child({ extension: 'geospatial' });
		const internals = checkOnStartup({ getSchema: () => context.getSchema(), database: context.database, logger });
		const permittedQuery = permittedQueryWith(internals, logger);
		const pageQuery = pageQueryWith(internals, logger);
		// The registered queries, in the memory of the process, which a restart empties (§7.8), and the key of their ids.
		const registry = memoryRegistry({ ...limits.registry, now: Date.now });
		const key = idKeyOf(context.env.SECRET);

		router.get('/capabilities', (req, res, next) => {
			// Any error, from the detection or from sending the response, goes to the error handler of Directus.
			readCapabilities(context, req.accountability, internals)
				.then((capabilities) => {
					if (capabilities === 'forbidden') {
						next(new ForbiddenError());

						return;
					}

					const body: CapabilitiesResponse = { data: capabilities };

					res.json(body);
				})
				.catch(next);
		});

		router.get('/items/:collection', (req, res, next) => {
			// Any error, the one of a geo off the contract included, goes to the error handler of Directus.
			Promise.resolve()
				.then(() => getItems(context, req, { internals, permittedQuery }))
				.then((body: ItemsResponse) => {
					res.json(body);
				})
				.catch(next);
		});

		// The same items, with the geo and the query in the body, as Directus takes its own SEARCH (V-11).
		router.search('/items/:collection', (req, res, next) => {
			Promise.resolve()
				.then(() => searchItems(context, req, { internals, permittedQuery, pageQuery }))
				.then((body: ItemsResponse) => {
					res.json(body);
				})
				.catch(next);
		});

		// The registration of a query, whose id the parts of its result are read by (D-004).
		router.post('/queries', (req, res, next) => {
			Promise.resolve()
				.then(() => registerQuery(req, { registry, key, now: Date.now, pageQuery }))
				.then((body: RegisterQueryResponse) => {
					res.json(body);
				})
				.catch(next);
		});

		router.get('/queries/:id/items', (req, res, next) => {
			Promise.resolve()
				.then(() => queryItems(context, req, { internals, permittedQuery, pageQuery, registry }))
				.then((body: ItemsResponse) => {
					res.json(body);
				})
				.catch(next);
		});

		router.get('/openapi.json', (req, res, next) => {
			const document = readOpenapi(req.accountability);

			if (document === 'forbidden') {
				next(new ForbiddenError());

				return;
			}

			// The document itself, as Directus serves its own at /server/specs/oas, without the data of the other routes.
			res.json(document);
		});
	},
});
