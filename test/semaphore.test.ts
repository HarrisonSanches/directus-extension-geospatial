import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { withSlot } from './semaphore.ts';

const run = promisify(execFile);

const folders: string[] = [];

// A folder of slots of its own for each test, as the global setup creates one for each run.
const newFolder = async () => {
	const folder = await mkdtemp(join(tmpdir(), 'geospatial-semaphore-'));

	folders.push(folder);

	return folder;
};

afterEach(async () => {
	await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

// The most runs at the same time, out of when each one started and ended.
const mostAtOnce = (spans: { start: number; end: number }[]) =>
	Math.max(...spans.map(({ start }) => spans.filter((other) => other.start <= start && start < other.end).length));

describe('o semáforo entre os processos da suíte', () => {
	it('nunca roda mais que o limite ao mesmo tempo, e roda tudo', async () => {
		const folder = await newFolder();
		let running = 0;
		let most = 0;

		const results = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				withSlot(folder, 3, async () => {
					running += 1;
					most = Math.max(most, running);
					await setTimeout(50);
					running -= 1;

					return index;
				}),
			),
		);

		expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		expect(most).toBe(3);
		expect(await readdir(folder)).toEqual([]);
	});

	it('a vaga de uma corrida que falha volta para a fila', async () => {
		const folder = await newFolder();

		await expect(withSlot(folder, 1, () => Promise.reject(new Error('Directus did not start.')))).rejects.toThrow(
			'Directus did not start.',
		);
		expect(await withSlot(folder, 1, () => Promise.resolve('next'))).toBe('next');
	});

	// The test files run in workers of their own, whose memory the others do not see, so the limit holds across processes.
	it('vale entre processos', { timeout: 30_000 }, async () => {
		const folder = await newFolder();
		const script = `
import { setTimeout } from 'node:timers/promises';
import { withSlot } from ${JSON.stringify(new URL('semaphore.ts', import.meta.url).href)};

const span = await withSlot(process.argv[1], 2, async () => {
	const start = performance.timeOrigin + performance.now();

	await setTimeout(300);

	return { start, end: performance.timeOrigin + performance.now() };
});

process.stdout.write(JSON.stringify(span));
`;
		const outputs = await Promise.all(
			Array.from({ length: 5 }, () => run('node', ['--input-type=module', '--eval', script, folder])),
		);
		const spans = outputs.map(({ stdout }) => JSON.parse(stdout) as { start: number; end: number });

		expect(spans).toHaveLength(5);
		expect(mostAtOnce(spans)).toBeLessThanOrEqual(2);
	});
});
