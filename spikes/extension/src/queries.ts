// Every query that reached the database through the connection of Directus, in the order they came, for the spikes to
// see that a refused request sent none (F01-06).
const queries: string[] = [];

export const record = ({ sql }: { sql: string }): void => {
	queries.push(sql);
};

// The queries since the last take, forgotten once handed over.
export const take = (): string[] => queries.splice(0);
