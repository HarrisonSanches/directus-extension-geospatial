import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';
import { takeLast } from './reads.js';

export default defineEndpoint({
	id: 'geospatial-test-observer',
	handler: (router, { database }) => {
		// The times of the last read of the collection, and its statement with the values in place, for the measurements
		// to read its plan with EXPLAIN. Only the admin reads it, since the statement holds the rule of whoever asked.
		router.get('/last', (req, res, next) => {
			if (req.accountability?.admin !== true) {
				next(new ForbiddenError());

				return;
			}

			const read = takeLast();

			if (read === undefined) {
				res.json({ data: null });

				return;
			}

			const { build, database: answer, statement } = read;

			// Knex numbers the values in the order they appear, so each position goes back to a placeholder of its own.
			const sql = database.raw(statement.sql.replaceAll(/\$\d+/g, '?'), statement.bindings).toQuery();

			res.json({ data: { build, database: answer, statement: sql } });
		});
	},
});
