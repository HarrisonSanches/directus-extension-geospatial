import { defineHook } from '@directus/extensions-sdk';
import type { Query } from '@directus/types';
import type { Knex } from 'knex';
import { answered, hooked, inTransaction, sent } from './reads.js';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isValue = (value: unknown): value is Knex.Value =>
	value === null || ['string', 'number', 'boolean'].includes(typeof value) || value instanceof Date;

// What Knex emits about each statement, with the id that ties the statement to its answer.
const uidOf = (event: unknown): string | undefined =>
	isRecord(event) && typeof event.__knexQueryUid === 'string' ? event.__knexQueryUid : undefined;

// Times the reads of the radius inside Directus, through what Directus already emits: the hooks of items.query, and the
// events of its connection, the one the radius runs on (V-141). It also keeps the statements of each transaction.
export default defineHook(({ filter }, { database }) => {
	filter<Query>('items.query', (query, meta) => {
		if (typeof meta.collection === 'string') {
			hooked(meta.collection);
		}

		return query;
	});

	database.on('query', (event: unknown) => {
		const uid = uidOf(event);

		if (uid === undefined || !isRecord(event) || typeof event.sql !== 'string') {
			return;
		}

		const bindings: unknown = event.bindings ?? [];

		if (Array.isArray(bindings) && bindings.every(isValue)) {
			sent({ uid, sql: event.sql, bindings });

			// A statement inside a transaction, with the id Knex gives the transaction.
			if (typeof event.__knexTxId === 'string') {
				inTransaction(event.__knexTxId, { uid, sql: event.sql, bindings });
			}
		}
	});

	database.on('query-response', (_response: unknown, event: unknown) => {
		const uid = uidOf(event);

		if (uid !== undefined) {
			answered(uid);
		}
	});
});
