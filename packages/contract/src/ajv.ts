import { Ajv2020 } from 'ajv/dist/2020.js';
import type { OpenApiDocument } from './generated/index.js';

// The keys of an OpenAPI document around its schemas, and the ones OpenAPI 3.1 adds to JSON Schema. Ajv takes them as
// annotations, and still checks strictly every schema of the document a value reaches.
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

// The id the document goes by inside Ajv, which a reference to one of its schemas starts with.
export const id = 'urn:geospatial:openapi';

// A token of a JSON Pointer inside the fragment of a URI: ~ and / escaped as JSON Pointer asks, and the braces of a path
// template encoded, as a URI asks.
export const tokenOf = (token: string) => encodeURIComponent(token.replaceAll('~', '~0').replaceAll('/', '~1'));

// An Ajv that knows the whole document, so a schema of it compiles with every reference it makes. The schemas are
// compiled in strict mode, so a schema of the document that Ajv cannot read fails too.
export const ajvOf = (document: OpenApiDocument): Ajv2020 => {
	const ajv = new Ajv2020({ strict: true, allErrors: true });

	ajv.addVocabulary(annotations);
	ajv.addSchema({ ...document, $id: id });

	return ajv;
};
