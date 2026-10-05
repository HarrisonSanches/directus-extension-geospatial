import { setTimeout } from 'node:timers/promises';
import { getContainerRuntimeClient, type StartedTestContainer } from 'testcontainers';

// Stopping a container without a timeout kills it, the way a database or a Redis goes down.
export const takeDown = async (container: StartedTestContainer): Promise<void> => {
	const runtime = await getContainerRuntimeClient();

	await runtime.container.stop(runtime.container.getById(container.getId()));
};

// Starts the container again, and waits until the command that checks it is ready succeeds inside it.
export const bringBack = async (container: StartedTestContainer, ready: string[]): Promise<void> => {
	const runtime = await getContainerRuntimeClient();

	await runtime.container.start(runtime.container.getById(container.getId()));

	const deadline = Date.now() + 60_000;

	while (Date.now() < deadline) {
		const { exitCode } = await container.exec(ready);

		if (exitCode === 0) {
			return;
		}

		await setTimeout(500);
	}

	throw new Error(`${ready.join(' ')} did not succeed within 60 s.`);
};
