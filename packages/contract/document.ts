import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { parse } from 'yaml';

// The document of the contract in JSON, which the build of the extension embeds and its route serves (D-016). It
// comes from openapi.yaml, as the types do, and a test fails when it falls behind.
const output = join(import.meta.dirname, 'src', 'generated', 'openapi.json');
const document: unknown = parse(await readFile(join(import.meta.dirname, 'openapi.yaml'), 'utf8'));
const options = { ...(await resolveConfig(output, { editorconfig: true })), filepath: output };

await writeFile(output, await format(JSON.stringify(document), options));
