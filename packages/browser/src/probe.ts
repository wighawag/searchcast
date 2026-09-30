import type {FieldSpec, Recipe} from './recipe.js';

export type Result = {title: string; url: string} & Record<string, string>;

export type ProbeState =
	| {state: 'blocked'; reason: string}
	| {state: 'ready'; results: Result[]}
	| {state: 'empty'}
	| {state: 'pending'};

interface ProbeSpec {
	ready: string;
	empty?: string;
	blocked: string[];
	blockedUrl: string[];
	item: string;
	fields: Record<string, FieldSpec>;
	limit: number;
}

/**
 * Runs INSIDE the page (serialised with toString), so it must stay
 * self-contained: no imports, no references to anything outside its body.
 */
function probe(spec: ProbeSpec): ProbeState {
	for (const pattern of spec.blockedUrl) {
		if (new RegExp(pattern).test(location.href)) {
			return {state: 'blocked', reason: `url matched ${pattern}`};
		}
	}
	for (const selector of spec.blocked) {
		if (document.querySelector(selector))
			return {state: 'blocked', reason: `found ${selector}`};
	}
	if (document.querySelector(spec.ready)) {
		const read = (root: Element, field: FieldSpec): string | undefined => {
			const el = field.selector ? root.querySelector(field.selector) : root;
			if (!el) return undefined;
			let value: unknown;
			if (!field.attr) {
				value = (el as HTMLElement).innerText ?? el.textContent;
			} else if (
				(field.attr === 'href' || field.attr === 'src') &&
				field.attr in el
			) {
				value = (el as any)[field.attr];
			} else {
				value = el.getAttribute(field.attr);
			}
			if (value === null || value === undefined) return undefined;
			const text = String(value).replace(/\s+/g, ' ').trim();
			return text || undefined;
		};
		const results: Result[] = [];
		for (const item of document.querySelectorAll(spec.item)) {
			const row: Record<string, string> = {};
			for (const [key, field] of Object.entries(spec.fields)) {
				const value = read(item, field);
				if (value !== undefined) row[key] = value;
			}
			if (row.title && row.url) results.push(row as Result);
			if (results.length >= spec.limit) break;
		}
		return {state: 'ready', results};
	}
	if (spec.empty && document.querySelector(spec.empty)) return {state: 'empty'};
	return {state: 'pending'};
}

/** The expression to evaluate in the page to check its state and extract results. */
export function probeExpression(recipe: Recipe): string {
	const spec: ProbeSpec = {
		ready: recipe.ready,
		empty: recipe.empty,
		blocked: recipe.blocked ?? [],
		blockedUrl: recipe.blockedUrl ?? [],
		item: recipe.results.item,
		fields: recipe.results.fields,
		limit: recipe.limit ?? 10,
	};
	return `(${probe.toString()})(${JSON.stringify(spec)})`;
}
