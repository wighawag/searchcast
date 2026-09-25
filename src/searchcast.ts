import {Browser, type BrowserOptions, type Page} from './browser.js';
import {probeExpression, type ProbeState, type Result} from './probe.js';
import type {Recipe} from './recipe.js';

/**
 * - `blocked`: the site served a challenge or block page.
 * - `timeout`: the page never reached a ready or empty state in time.
 * - `recipe`: the page does not match the recipe (e.g. submit element missing).
 * - `browser`: the browser could not be started or talked to.
 */
export type SearchcastErrorCode = 'blocked' | 'timeout' | 'recipe' | 'browser';

export class SearchcastError extends Error {
	override name = 'SearchcastError';
	constructor(
		readonly code: SearchcastErrorCode,
		message: string,
	) {
		super(message);
	}
}

export interface SearchResponse {
	recipe: string;
	query: string;
	results: Result[];
	elapsedMs: number;
}

export interface SearchcastOptions {
	browser: BrowserOptions;
	/** Maximum simultaneous tabs. Default 2. */
	concurrency?: number;
	/** Poll interval while waiting for the page. Default 150 ms. */
	pollMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Runs recipes against one long-lived browser. Each search gets its own tab,
 * closed afterwards; all tabs share the persistent profile. The browser is
 * started on first use and restarted if it dies.
 */
export class Searchcast {
	#options: SearchcastOptions;
	#browser?: Promise<Browser>;
	#active = 0;
	#queue: Array<() => void> = [];

	constructor(options: SearchcastOptions) {
		this.#options = options;
	}

	async search(recipe: Recipe, query: string): Promise<SearchResponse> {
		await this.#acquire();
		const started = Date.now();
		try {
			const browser = await this.#getBrowser();
			const page = await browser.newPage().catch((e: Error) => {
				throw new SearchcastError('browser', e.message);
			});
			try {
				const results = await this.#run(
					page,
					recipe,
					query,
					started + (recipe.timeoutMs ?? DEFAULT_TIMEOUT_MS),
				);
				return {
					recipe: recipe.name,
					query,
					results,
					elapsedMs: Date.now() - started,
				};
			} finally {
				await page.close();
			}
		} finally {
			this.#release();
		}
	}

	/** Start the browser now instead of on the first search. */
	async warmup(): Promise<void> {
		await this.#getBrowser();
	}

	async close(): Promise<void> {
		const browser = this.#browser;
		this.#browser = undefined;
		if (browser) await (await browser.catch(() => undefined))?.close();
	}

	async #run(
		page: Page,
		recipe: Recipe,
		query: string,
		deadline: number,
	): Promise<Result[]> {
		const pollMs = this.#options.pollMs ?? 150;
		const probe = probeExpression(recipe);
		const withinDeadline = async <T>(
			step: string,
			action: () => Promise<T>,
		): Promise<T> => {
			const remaining = deadline - Date.now();
			if (remaining <= 0)
				throw new SearchcastError(
					'timeout',
					`${recipe.name}: timed out ${step}`,
				);
			let timer: NodeJS.Timeout | undefined;
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new SearchcastError(
								'timeout',
								`${recipe.name}: timed out ${step}`,
							),
						),
					remaining,
				);
			});
			try {
				return await Promise.race([action(), timeout]);
			} finally {
				clearTimeout(timer);
			}
		};
		const check = async (): Promise<ProbeState> => {
			try {
				return await page.evaluate<ProbeState>(probe);
			} catch {
				// Mid-navigation the execution context can vanish; try again next tick.
				return {state: 'pending'};
			}
		};
		const throwIfBlocked = (state: ProbeState) => {
			if (state.state === 'blocked') {
				throw new SearchcastError(
					'blocked',
					`${recipe.name}: blocked (${state.reason})`,
				);
			}
		};

		if (recipe.navigate) {
			const url = recipe.navigate.url.replaceAll(
				'{query}',
				encodeURIComponent(query),
			);
			await withinDeadline('navigating', () => page.navigate(url));
		} else if (recipe.form) {
			const form = recipe.form;
			await withinDeadline('loading the form', () => page.navigate(form.url));
			const inputReady = `!!document.querySelector(${JSON.stringify(form.input)})`;
			while (!(await page.evaluate<boolean>(inputReady).catch(() => false))) {
				throwIfBlocked(await check());
				if (Date.now() > deadline) {
					throw new SearchcastError(
						'timeout',
						`${recipe.name}: form input ${form.input} never appeared`,
					);
				}
				await sleep(pollMs);
			}
			await withinDeadline('filling the form', async () => {
				await page.click(form.input);
				// Select any existing value so typing replaces it.
				await page.evaluate(`(() => {
					const el = document.querySelector(${JSON.stringify(form.input)});
					el.focus();
					if (typeof el.select === 'function') el.select();
				})()`);
				await page.type(query);
				if (form.submit === 'enter') {
					await page.pressEnter();
				} else if (!(await page.click(form.submit.click))) {
					throw new SearchcastError(
						'recipe',
						`${recipe.name}: submit ${form.submit.click} not found`,
					);
				}
			});
		}

		for (;;) {
			const state = await check();
			throwIfBlocked(state);
			if (state.state === 'ready' && state.results.length > 0)
				return state.results;
			if (state.state === 'empty') return [];
			if (Date.now() > deadline) {
				throw new SearchcastError(
					'timeout',
					state.state === 'ready'
						? `${recipe.name}: ready but no result had both a title and a url`
						: `${recipe.name}: timed out waiting for ${recipe.ready}`,
				);
			}
			await sleep(pollMs);
		}
	}

	async #getBrowser(): Promise<Browser> {
		const current = this.#browser;
		if (!current) return this.#launch();
		const browser = await current.catch(() => undefined);
		if (browser && !browser.closed) return browser;
		// Only the first caller to notice a dead browser relaunches it; the rest
		// pick up that launch, so two browsers never share one profile.
		if (this.#browser === current) return this.#launch();
		return this.#getBrowser();
	}

	#launch(): Promise<Browser> {
		const launching = Browser.launch(this.#options.browser).catch(
			(e: Error) => {
				if (this.#browser === launching) this.#browser = undefined;
				throw new SearchcastError('browser', e.message);
			},
		);
		this.#browser = launching;
		return launching;
	}

	#acquire(): Promise<void> {
		const limit = this.#options.concurrency ?? 2;
		if (this.#active < limit) {
			this.#active++;
			return Promise.resolve();
		}
		return new Promise((resolve) => this.#queue.push(resolve));
	}

	#release(): void {
		const next = this.#queue.shift();
		if (next) next();
		else this.#active--;
	}
}
