import { createDirectus, rest, staticToken } from '@directus/sdk';

// What the fake server answers: the status, the media type and the body.
export interface Answer {
	status?: number;
	type?: string;
	body: unknown;
}

// A client of the Directus SDK, with the rest and the token of an installation, whose fetch answers each request with
// the answer of the test, or with the next one of a list, one for each request in order, and keeps the request, so the
// unit tests run the commands through the request of the SDK itself. The integration suite runs them against Directus.
export const fakeClient = <Schema>(answers: Answer | Answer[]) => {
	const requests: Request[] = [];
	const fetch = (input: string | URL | Request, init?: RequestInit) => {
		requests.push(new Request(input, init));

		const answer = Array.isArray(answers) ? answers[requests.length - 1] : answers;

		if (answer === undefined) {
			return Promise.reject(new Error(`The test has no answer for request ${String(requests.length)}.`));
		}

		return Promise.resolve(
			new Response(JSON.stringify(answer.body), {
				status: answer.status ?? 200,
				headers: { 'Content-Type': answer.type ?? 'application/json; charset=utf-8' },
			}),
		);
	};
	const client = createDirectus<Schema>('https://directus.example.com', { globals: { fetch } })
		.with(rest())
		.with(staticToken('token'));

	return { client, requests };
};
