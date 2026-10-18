import { mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const isTaken = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EEXIST';

// Runs once one of the slots of a folder is free, with the number of the slot, and frees it when the run ends, also when
// it fails: a counting semaphore across the processes of a run, since each test file runs in a worker whose memory the
// others do not see. Each slot is a folder, which mkdir creates or refuses at once, whatever process asks. A run that
// waits looks again every so often, in no particular order.
export const withSlot = async <T>(
	folder: string,
	slots: number,
	run: (slot: number) => Promise<T>,
	every = 500,
): Promise<T> => {
	for (;;) {
		for (let slot = 0; slot < slots; slot += 1) {
			const path = join(folder, String(slot));

			try {
				await mkdir(path);
			} catch (error) {
				if (isTaken(error)) {
					continue;
				}

				throw error;
			}

			try {
				return await run(slot);
			} finally {
				await rmdir(path);
			}
		}

		await setTimeout(every);
	}
};
