import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';
import { take, takeReads } from './calls.js';

export default defineEndpoint({
	id: 'geospatial-test-hook',
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

		// What the hooks of items.read received since the last read, also only for the admin.
		router.get('/reads', (req, res, next) => {
			if (req.accountability?.admin !== true) {
				next(new ForbiddenError());

				return;
			}

			res.json({ data: takeReads() });
		});
	},
});
