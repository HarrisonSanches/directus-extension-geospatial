import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getContainerRuntimeClient } from 'testcontainers';
import type { Combination } from '../combinations.ts';
import { queryOn } from '../postgres.ts';

// With MEASURE_QUICK=1, every series runs, on the smallest volume and with few requests, to check the measurements in
// minutes before the long run, whose numbers are the ones that count.
export const quick = process.env.MEASURE_QUICK === '1';

// The method of F01-16 (A-036): each series warms up first, so the first requests, which load the schema, the
// permissions and the pages of the table, stay out of it, and then measures one request at a time.
export const method = { warmUps: quick ? 1 : 3, runs: quick ? 2 : 20 };

export const series = async <T>(measure: () => Promise<T>): Promise<T[]> => {
	for (let run = 0; run < method.warmUps; run += 1) {
		await measure();
	}

	const measured: T[] = [];

	for (let run = 0; run < method.runs; run += 1) {
		measured.push(await measure());
	}

	return measured;
};

// The median and the 95th percentile of a series of times, by the nearest rank, and the slowest, in milliseconds, with
// one decimal. Of 20 times, the p95 is the 19th in order: one request in twenty takes longer.
export const summaryOf = (times: number[]) => {
	const sorted = [...times].sort((a, b) => a - b);
	const rank = (share: number) => sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? 0;
	const round = (value: number) => Math.round(value * 10) / 10;

	return { runs: sorted.length, median: round(rank(0.5)), p95: round(rank(0.95)), max: round(sorted.at(-1) ?? 0) };
};

// Where the numbers of a run go, out of Git: a file for each combination, with the plans in a folder beside it.
const folder = fileURLToPath(new URL('../../test-results/measure/', import.meta.url));

// The numbers of one combination. Each measurement adds its own as it ends, so a run that stops halfway keeps what it
// measured.
export const resultsOf = (combination: Combination) => {
	const results: Record<string, unknown> = {};

	return {
		keep: async (name: string, value: unknown) => {
			results[name] = value;
			await mkdir(folder, { recursive: true });
			await writeFile(`${folder}${combination}.json`, `${JSON.stringify(results, null, '\t')}\n`);
		},
		keepPlan: async (name: string, plan: string) => {
			await mkdir(`${folder}${combination}/`, { recursive: true });
			await writeFile(`${folder}${combination}/${name}.txt`, `${plan}\n`);
		},
	};
};

// The machine of the measurements, as the database container sees it, since it shares the kernel of the host, and the
// Docker that runs it.
export const machineOf = async (container: string) => {
	const runtime = await getContainerRuntimeClient();
	const { output, exitCode } = await runtime.container.exec(runtime.container.getById(container), [
		'sh',
		'-c',
		"grep -m1 'model name' /proc/cpuinfo | cut -d: -f2; nproc; grep MemTotal /proc/meminfo | tr -s ' '; uname -r",
	]);

	if (exitCode !== 0) {
		throw new Error(`The machine could not be read from the database container: ${output}`);
	}

	const [processor, threads, memory, kernel] = output
		.trim()
		.split('\n')
		.map((line) => line.trim());

	return {
		processor,
		threads: Number(threads),
		memory,
		kernel,
		docker: runtime.info.containerRuntime.serverVersion,
		date: new Date().toISOString(),
	};
};

// The plan of a statement as Postgres runs it, with the time and the pages of each node: EXPLAIN ANALYZE runs the
// statement, and does not only estimate it. psql opens a connection of its own, whose caches start empty, and planning
// there took longer than the whole statement in Directus. So the statement runs once before, in the same connection,
// with its plan thrown away, as in the connections Directus keeps open.
export const planOf = (container: string, statement: string): Promise<string> => {
	const explain = `explain (analyze, buffers) ${statement}`;

	return queryOn(container, ['\\o /dev/null', explain, '\\o', explain]);
};

// What a plan says in a line: the time Postgres took to plan and to run the statement, the nodes that read a table, the
// time of the JIT, and the pages of the buffers of the whole statement.
export const summaryOfPlan = (plan: string) => ({
	planning: Number(/Planning Time: ([\d.]+) ms/.exec(plan)?.[1] ?? Number.NaN),
	execution: Number(/Execution Time: ([\d.]+) ms/.exec(plan)?.[1] ?? Number.NaN),
	reads: [
		...new Set(
			[
				...plan.matchAll(
					/((?:Parallel )?(?:Seq Scan|Index Scan|Index Only Scan|Bitmap Index Scan|Bitmap Heap Scan))(?: using (\w+))? on (\w+)/g,
				),
			].map((match) => `${match[1] ?? ''}${match[2] === undefined ? '' : ` using ${match[2]}`} on ${match[3] ?? ''}`),
		),
	],
	jit: Number(/Timing: .*Total ([\d.]+) ms/.exec(plan)?.[1] ?? 0),
	buffers: /Buffers: (shared [^\n]+)/.exec(plan)?.[1] ?? '',
});
