import { ForbiddenError } from '@directus/errors';
import { defineEndpoint } from '@directus/extensions-sdk';
import { measured, takeLag, takeLast } from './reads.js';

export default defineEndpoint({
	id: 'geospatial-test-observer',
	handler: (router, { database }) => {
		// The times of the last read of a collection, the one of the measurements unless the request names another, and its
		// statement with the values in place, for the measurements and the suite to read its plan with EXPLAIN. Only the
		// admin reads it, since the statement holds the rule of whoever asked.
		router.get('/last', (req, res, next) => {
			if (req.accountability?.admin !== true) {
				next(new ForbiddenError());

				return;
			}

			const { collection } = req.query;
			const read = takeLast(typeof collection === 'string' ? collection : measured);

			if (read === undefined) {
				res.json({ data: null });

				return;
			}

			const { build, database: answer, statement } = read;

			// Knex numbers the values in the order they appear, so each position goes back to a placeholder of its own.
			const sql = database.raw(statement.sql.replaceAll(/\$\d+/g, '?'), statement.bindings).toQuery();

			res.json({ data: { build, database: answer, statement: sql } });
		});

		// The longest the event loop of Directus ran late since the last read. Only the admin reads it.
		router.get('/lag', (req, res, next) => {
			if (req.accountability?.admin !== true) {
				next(new ForbiddenError());

				return;
			}

			res.json({ data: takeLag() });
		});
	},
});
