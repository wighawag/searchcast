// Without @searchcast/browser installed, a library-mode browser engine fails
// with an error naming the package; HTTP engines never need it.
// @searchcast/browser is an optional peer that this workspace installs (as a
// devDependency), so the import is made to fail the way Node fails for a
// missing package.

import {vi, describe, expect, it} from 'vitest';

vi.mock('@searchcast/browser', () => {
	throw Object.assign(new Error("Cannot find package '@searchcast/browser'"), {
		code: 'ERR_MODULE_NOT_FOUND',
	});
});

const {createSearchcast, SearchcastError} = await import('../src/index.js');
const {engine, fakeTransport, pages} = await import('./engines.js');

describe('without @searchcast/browser installed', () => {
	it('library mode fails naming the package to install; HTTP engines still answer', async () => {
		const {transport} = fakeTransport({a: () => pages.results('A')});
		const searchcast = createSearchcast({transport});
		const browser = {
			name: 'browser',
			searchcast: {recipe: engine('browser')},
		};
		const error = await searchcast
			.search('q', {engines: [browser]})
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SearchcastError);
		const [failure] = (error as InstanceType<typeof SearchcastError>).failures!;
		expect(failure!.error.kind).toBe('transport');
		expect(failure!.error.message).toContain('npm install @searchcast/browser');

		const answer = await searchcast.search('q', {
			engines: [engine('a'), browser],
		});
		expect(answer.engine).toBe('a');
		await searchcast.close();
	});
});
