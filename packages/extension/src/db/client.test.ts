import knex from 'knex';
import { describe, expect, it } from 'vitest';
import { databaseClientOf } from '../capabilities/detect.js';
import { knexClassOf } from './client.js';

// Knex creates the client without a driver or a connection, so these are the real classes of Knex 3.1.0.
describe('identificação do banco pelo Knex', () => {
	it.each([
		['pg', 'postgres'],
		['cockroachdb', 'cockroachdb'],
		['sqlite3', 'sqlite'],
		['mysql2', 'mysql'],
		['mssql', 'mssql'],
		['oracledb', 'oracle'],
		['redshift', 'redshift'],
		['better-sqlite3', 'unknown'],
	])('o cliente %s do Knex é o banco %s', async (client, expected) => {
		const database = knex({ client, useNullAsDefault: true });

		expect(databaseClientOf(knexClassOf(database))).toBe(expected);
		await database.destroy();
	});

	it('um objeto sem cliente é um banco desconhecido', () => {
		expect(databaseClientOf(knexClassOf({ client: undefined }))).toBe('unknown');
	});
});
