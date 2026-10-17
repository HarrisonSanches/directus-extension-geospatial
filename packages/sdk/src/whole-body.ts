import { wholeBodyType } from 'directus-geospatial-contract';

// Whether the request of the Directus SDK handed over the response itself, as it does when the response comes as a
// media type other than application/json, the way it checks one.
const isResponse = (value: unknown): value is Response =>
	typeof value === 'object' && value !== null && 'json' in value && typeof value.json === 'function';

// The lists whose response came as application/json, which only bring the data, without telling whether a page follows.
const withoutMeta = new WeakSet<object>();

// The whole body of a list, the meta included (D-058). The request of the Directus SDK hands over the response itself
// when it comes as the media type of the extension, and only the data when it comes as application/json, as an
// extension older than the SDK or a proxy on the way answers.
export const wholeBodyOf = async (response: unknown): Promise<unknown> => {
	if (isResponse(response)) {
		return response.json();
	}

	const list = { data: response };

	withoutMeta.add(list);

	return list;
};

// Fails where a list came without its meta, so whoever pages through it never takes its first page for the whole list.
export const throwWithoutMeta = (list: object): void => {
	if (withoutMeta.has(list)) {
		throw new Error(
			`The list came as application/json, without its meta, so the pages after this one cannot be read: the extension, or a proxy on the way, does not answer ${wholeBodyType}.`,
		);
	}
};
