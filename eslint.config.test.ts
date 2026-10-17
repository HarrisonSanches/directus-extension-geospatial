import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { engineLayers } from './eslint.config.ts';

// One module in each layer of the engine, which the imports of each case resolve to. The zones only see an import
// that resolves to a file.
const modules = [
	'endpoint.ts',
	'hook.ts',
	'errors.ts',
	'routes/items.ts',
	'routes/capabilities.ts',
	'operations/radius/index.ts',
	'query/registry.ts',
	'capabilities/detect.ts',
	'db/postgis.ts',
	'internals/chain.ts',
];

const extension = 'packages/extension/src';

let root: string;
let eslint: ESLint;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'geospatial-layers-'));

	for (const module of modules) {
		const path = join(root, extension, module);

		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, 'export const value = 1;\n');
	}

	// The same rules the repository lints with, on the fixture folder, with only the parser beside them.
	eslint = new ESLint({
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } }, ...engineLayers(root)],
	});
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

// The rules that report the code of a file, which the importer of the case says, from the root of the repository.
const rulesFor = async (importer: string, code: string) => {
	const [result] = await eslint.lintText(code, { filePath: join(root, importer) });

	return result?.messages.map(({ ruleId }) => ruleId) ?? [];
};

const zone = 'import-x/no-restricted-paths';
const staticImport = 'no-restricted-imports';
const syntax = 'no-restricted-syntax';

describe('camadas do motor', () => {
	it.each([
		[
			'uma operação não importa uma rota',
			'operations/radius/index.ts',
			"import { value } from '../../routes/items.js';",
		],
		['uma rota não importa outra rota', 'routes/items.ts', "import { value } from './capabilities.js';"],
		['o hook não importa uma rota', 'hook.ts', "import { value } from './routes/items.js';"],
		[
			'um adaptador não importa uma operação',
			'db/postgis.ts',
			"import { value } from '../operations/radius/index.js';",
		],
		[
			'um adaptador não importa a consulta registrada',
			'db/postgis.ts',
			"import { value } from '../query/registry.js';",
		],
		[
			'os internos não importam uma operação',
			'internals/chain.ts',
			"import { value } from '../operations/radius/index.js';",
		],
		['os internos não importam a matriz', 'internals/chain.ts', "import { value } from '../capabilities/detect.js';"],
		['os internos não importam um adaptador', 'internals/chain.ts', "import { value } from '../db/postgis.js';"],
		[
			'o import dinâmico também conta',
			'db/postgis.ts',
			"const { value } = await import('../operations/radius/index.js');",
		],
	])('%s', async (_, importer, code) => {
		expect(await rulesFor(`${extension}/${importer}`, code)).toEqual([zone]);
	});

	it.each([
		['o endpoint registra as rotas', 'endpoint.ts', "import { value } from './routes/items.js';"],
		[
			'uma rota chama a operação, o adaptador e os internos',
			'routes/items.ts',
			[
				"import { value as a } from '../operations/radius/index.js';",
				"import { value as b } from '../db/postgis.js';",
				"import { value as c } from '../internals/chain.js';",
			].join('\n'),
		],
		[
			'uma operação usa a matriz, o adaptador e os internos',
			'operations/radius/index.ts',
			[
				"import { value as a } from '../../capabilities/detect.js';",
				"import { value as b } from '../../db/postgis.js';",
				"import { value as c } from '../../internals/chain.js';",
			].join('\n'),
		],
		['um adaptador usa os internos', 'db/postgis.ts', "import { value } from '../internals/chain.js';"],
		['os internos usam os erros da extensão', 'internals/chain.ts', "import { value } from '../errors.js';"],
	])('%s', async (_, importer, code) => {
		expect(await rulesFor(`${extension}/${importer}`, code)).toEqual([]);
	});
});

describe('o @directus/api só nos internos (D-001)', () => {
	it.each([
		['num adaptador', `${extension}/db/postgis.ts`, "import emitter from '@directus/api/emitter';", staticImport],
		[
			'o pacote inteiro, numa rota',
			`${extension}/routes/items.ts`,
			"import * as api from '@directus/api';",
			staticImport,
		],
		[
			'só o tipo',
			`${extension}/operations/radius/index.ts`,
			"import type { Item } from '@directus/api/types';",
			staticImport,
		],
		[
			'reexportado',
			`${extension}/capabilities/detect.ts`,
			"export { getSchema } from '@directus/api/utils/get-schema';",
			staticImport,
		],
		['fora da extensão', 'test/helper.ts', "import emitter from '@directus/api/emitter';", staticImport],
		[
			'no import dinâmico',
			`${extension}/db/postgis.ts`,
			"const emitter = await import('@directus/api/emitter');",
			syntax,
		],
		[
			'no import dinâmico com template',
			`${extension}/db/postgis.ts`,
			'const name = "emitter";\nconst module = await import(`@directus/api/${name}`);',
			syntax,
		],
		[
			'no tipo de um import',
			`${extension}/db/postgis.ts`,
			"type Emitter = typeof import('@directus/api/emitter');",
			syntax,
		],
	])('recusa o @directus/api %s', async (_, importer, code, rule) => {
		expect(await rulesFor(importer, code)).toEqual([rule]);
	});

	it('os internos importam o @directus/api de todos os jeitos', async () => {
		const code = [
			"import emitter from '@directus/api/emitter';",
			"import type { Item } from '@directus/api/types';",
			"const module = await import('@directus/api/utils/get-schema');",
			"type Emitter = typeof import('@directus/api/emitter');",
		].join('\n');

		expect(await rulesFor(`${extension}/internals/chain.ts`, code)).toEqual([]);
	});

	it('um pacote de nome parecido e os outros pacotes do Directus passam', async () => {
		const code = [
			"import { createError } from '@directus/errors';",
			"import { value } from '@directus/api-helpers';",
			"const module = await import('@directus/apis');",
		].join('\n');

		expect(await rulesFor(`${extension}/db/postgis.ts`, code)).toEqual([]);
	});
});
