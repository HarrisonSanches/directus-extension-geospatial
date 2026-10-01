import { ajvOf, id, tokenOf } from './ajv.js';
import type { OpenApiDocument } from './generated/index.js';

// What a value of a request is, against a schema of the document: the value itself, with its type, or the place and
// the reason of each problem, as Ajv tells them.
export type Checked<T> = { valid: true; value: T } | { valid: false; errors: string[] };

// The input of a request, checked against a schema of the document of the contract before it reaches the database
// (D-016). Each schema compiles once, by its name in components.schemas, and checks every value given to it.
export const inputsOf = (document: OpenApiDocument) => {
	const ajv = ajvOf(document);

	return {
		schema: <T>(name: string) => {
			const validate = ajv.compile<T>({ $ref: `${id}#/components/schemas/${tokenOf(name)}` });

			return (value: unknown): Checked<T> =>
				validate(value)
					? { valid: true, value }
					: {
							valid: false,
							errors: (validate.errors ?? []).map(
								({ instancePath, message }) =>
									`${instancePath === '' ? 'the root' : instancePath} ${message ?? 'is invalid'}`,
							),
						};
		},
	};
};
