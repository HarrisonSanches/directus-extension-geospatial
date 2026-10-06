import { createDirectus, rest, staticToken } from '@directus/sdk';

// What the fake server answers: the status, the media type and the body.
export interface Answer {
	status?: number;
	type?: string;
	body: unknown;
}

// A client of the Directus SDK, with the rest and the token of an installation, whose fetch answers each request with
// the answer of the test and keeps the request, so the unit tests run the commands through the request of the SDK
// itself. The integration suite runs them against Directus.
export const fakeClient = <Schema>(answer: Answer) => {
	const requests: Request[] = [];
	const fetch = (input: string | URL | Request, init?: RequestInit) => {
		requests.push(new Request(input, init));

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
