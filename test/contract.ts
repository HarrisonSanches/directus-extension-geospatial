import { openapi } from 'directus-geospatial-contract';
import { contractOf } from 'directus-geospatial-contract/responses';

const contract = contractOf(openapi);

// The layer "contrato da API" of docs/padroes/testes.md: the fetch of the suite checks each response of a route of the
// extension against the document of the contract (D-016), and a response off it rejects the request, with what is off.
// The SDK client of the suite and the tests that call fetch themselves use it.
export const checkedFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
	const request = new Request(input, init);
	const response = await fetch(request);
	const { pathname } = new URL(request.url);

	if (!pathname.startsWith('/geospatial/')) {
		return response;
	}

	const contentType = response.headers.get('Content-Type');
	const text = await response.clone().text();
	const body: unknown = text !== '' && contentType?.includes('json') === true ? JSON.parse(text) : text;
	const errors = contract.errorsOf({
		method: request.method,
		path: pathname,
		status: response.status,
		contentType,
		body,
	});

	if (errors.length > 0) {
		throw new Error(errors.join('\n'));
	}

	return response;
};
