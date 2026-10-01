import type { ValidateFunction } from 'ajv/dist/2020.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { OpenApiDocument } from './generated/index.js';

// A response of a route of the extension, as a test received it.
export interface Response {
	method: string;
	// The path of the request, without the query, such as /geospatial/capabilities.
	path: string;
	status: number;
	// The Content-Type header, or null when the response has none.
	contentType: string | null;
	body: unknown;
}

// The keys of an OpenAPI document around its schemas, and the ones OpenAPI 3.1 adds to JSON Schema. Ajv takes them as
// annotations, and still checks strictly every schema of the document a response reaches.
const annotations = [
	'openapi',
	'info',
	'jsonSchemaDialect',
	'servers',
	'paths',
	'webhooks',
	'components',
	'security',
	'tags',
	'externalDocs',
	'discriminator',
	'xml',
	'example',
];

const id = 'urn:geospatial:openapi';

// A token of a JSON Pointer inside the fragment of a URI: ~ and / escaped as JSON Pointer asks, and the braces of a path
// template encoded, as a URI asks.
const tokenOf = (token: string) => encodeURIComponent(token.replaceAll('~', '~0').replaceAll('/', '~1'));

// The path of the document a request path falls into, with each {parameter} of a template standing for one segment.
const templateOf = (paths: string[], path: string) =>
	paths.find((template) => {
		const pattern = template.replaceAll(/[.*+?^$()|[\]\\]/g, '\\$&').replaceAll(/\{[^}]+\}/g, '[^/]+');

		return new RegExp(`^${pattern}$`).test(path);
	});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The responses a test receives from the extension, checked against the document of the contract (D-016): the route,
// the method and the status must be in it, and the body must match the JSON Schema it declares for them. The schemas
// are compiled in strict mode, so a schema of the document that Ajv cannot read fails too.
export const contractOf = (document: OpenApiDocument) => {
	const ajv = new Ajv2020({ strict: true, allErrors: true });

	ajv.addVocabulary(annotations);
	ajv.addSchema({ ...document, $id: id });

	const compiled = new Map<string, ValidateFunction>();

	return {
		errorsOf: ({ method, path, status, contentType, body }: Response): string[] => {
			const template = templateOf(Object.keys(document.paths), path);
			const route = `${method.toUpperCase()} ${path}`;

			if (template === undefined) {
				return [`The contract has no route for ${route}.`];
			}

			const operation = document.paths[template];
			const responses = isRecord(operation) ? operation[method.toLowerCase()] : undefined;
			const response =
				isRecord(responses) && isRecord(responses.responses) ? responses.responses[String(status)] : undefined;
			const answer = `The response ${String(status)} of ${route}`;

			if (!isRecord(response)) {
				return [`The contract has no response ${String(status)} for ${route}.`];
			}

			// A response the contract declares without content comes back empty, as a 204 does.
			if (!isRecord(response.content)) {
				return body === '' ? [] : [`${answer} has a body, and the contract declares none.`];
			}

			const media = contentType?.split(';')[0]?.trim() ?? '';

			if (!isRecord(response.content[media])) {
				return [`${answer} came as ${media === '' ? 'no type' : media}, which the contract does not declare.`];
			}

			// The schema of a JSON body is checked, and a body of another type, such as a vector tile, only by its type.
			if (!/^application\/(.+\+)?json$/.test(media) || !('schema' in response.content[media])) {
				return [];
			}

			const pointer = [template, method.toLowerCase(), 'responses', String(status), 'content', media, 'schema'];
			const key = pointer.join(' ');
			const validate = compiled.get(key) ?? ajv.compile({ $ref: `${id}#/paths/${pointer.map(tokenOf).join('/')}` });

			compiled.set(key, validate);

			if (validate(body)) {
				return [];
			}

			return (validate.errors ?? []).map(
				({ instancePath, message }) =>
					`${answer} is off the contract at ${instancePath === '' ? 'the root' : instancePath}: ${message ?? 'invalid'}.`,
			);
		},
	};
};
