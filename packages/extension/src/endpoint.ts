import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';
import type { CapabilitiesResponse } from 'directus-geospatial-contract';
import { readCapabilities } from './routes/capabilities.js';

export default defineEndpoint({
	id: 'geospatial',
	handler: (router, context) => {
		router.get('/capabilities', (req, res, next) => {
			readCapabilities(context, req.accountability).then((capabilities) => {
				if (capabilities === 'forbidden') {
					next(new ForbiddenError());

					return;
				}

				const body: CapabilitiesResponse = { data: capabilities };

				res.json(body);
			}, next);
		});
	},
});
