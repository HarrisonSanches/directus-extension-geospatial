// Knex types its client as any. The name of its class tells the database, as getDatabaseClient() of Directus reads it.
export const knexClassOf = (database: { client: unknown }): string => {
	const { client } = database;

	return typeof client === 'object' && client !== null ? client.constructor.name : '';
};
