import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';
import { take } from './calls.js';

export default defineEndpoint({
	id: 'geospatial-spikes-hook',
	handler: (router) => {
		// What the hooks received since the last read. Only the admin reads it, since it holds the accountability of
		// whoever asked.
		router.get('/calls', (req, res, next) => {
			if (req.accountability?.admin !== true) {
				next(new ForbiddenError());

				return;
			}

			res.json({ data: take() });
		});
	},
});
