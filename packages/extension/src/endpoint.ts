import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';
import type { CapabilitiesResponse } from 'directus-geospatial-contract';
import { readCapabilities } from './routes/capabilities.js';
import { readOpenapi } from './routes/openapi.js';

export default defineEndpoint({
	id: 'geospatial',
	handler: (router, context) => {
		router.get('/capabilities', (req, res, next) => {
			// Any error, from the detection or from sending the response, goes to the error handler of Directus.
			readCapabilities(context, req.accountability)
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
