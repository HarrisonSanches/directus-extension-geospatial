// Types only: the SDK follows the style of @directus/sdk, and the input is validated by Ajv from the same document.
// A plain object, so the declarations of the generator stay out of the type check.
export default {
	input: 'openapi.yaml',
	output: { path: 'src/generated', postProcess: ['prettier'] },
	plugins: ['@hey-api/typescript'],
};
