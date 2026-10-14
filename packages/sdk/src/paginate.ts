import type { RestClient, RestCommand } from '@directus/sdk';
import type { Cursor } from 'directus-geospatial-contract';
import { throwWithoutMeta } from './whole-body.js';

// A list as the list commands give it, of items or of shapes, whose meta brings the cursor of the next page.
interface List {
	readonly meta?: { readonly next?: Cursor };
}

// The command, asking for the page that starts at a cursor.
const startingAt =
	<Output, Schema>(command: RestCommand<Output, Schema>, cursor: Cursor): RestCommand<Output, Schema> =>
	() => {
		const options = command();

		return { ...options, params: { ...options.params, cursor } };
	};

// Every page of a list, in order, for a for await (§7.8). The first is the one the command asks for, and each next one
// starts at the cursor the meta of the page before brings, until a page brings none. The command keeps the collection,
// the question, the sort and the limit the cursor belongs to (D-054). Each page comes whole, as the command gives it,
// so the capped of a list the server of the extension could only order in part reaches whoever reads it (D-052). An
// error of a page, as the id Directus forgot, rejects the for await after the pages before it, and so does a page that
// came without its meta, which cannot tell whether another one follows (D-058).
export async function* geoPaginate<Schema, Output extends List>(
	client: RestClient<Schema>,
	command: RestCommand<Output, Schema>,
): AsyncGenerator<Output, void> {
	let page = await client.request(command);

	throwWithoutMeta(page);

	yield page;

	while (page.meta?.next !== undefined) {
		page = await client.request(startingAt(command, page.meta.next));
		throwWithoutMeta(page);

		yield page;
	}
}
