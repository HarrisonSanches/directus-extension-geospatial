import { type ItemsResponse, wholeBodyType } from 'directus-geospatial-contract';

// A list of items as the media type of the extension when the request prefers it, with the same body, which is how the
// SDK of the extension reads the meta (D-058), and as application/json, the type of Directus, otherwise. A cache keeps
// the two apart by the Accept.
export const sendList = (
	req: { accepts: (types: string[]) => string | false },
	res: { vary: (field: string) => unknown; type: (type: string) => unknown; json: (body: unknown) => unknown },
	body: ItemsResponse,
): void => {
	res.vary('Accept');

	if (req.accepts(['application/json', wholeBodyType]) === wholeBodyType) {
		res.type(wholeBodyType);
	}

	res.json(body);
};
