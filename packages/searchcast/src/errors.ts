// The one error type searchcast throws. Every failure carries a `kind` (see the
// Errors section of CONTEXT.md); an empty result list is never an error. Its
// serpcast name stays exported as a deprecated alias for one release
// (deprecated.ts).

/** What went wrong, from the caller's point of view. */
export type SearchcastErrorKind =
	| 'blocked'
	| 'recipe'
	| 'timeout'
	| 'transport'
	| 'impersonation'
	/**
	 * An engine named in `decoyGuard` answered with a page unrelated to the
	 * query (see decoy.ts). A kind of its own, not `blocked` with a flag: it
	 * starts no cooldown (decoys are per query), and a caller branching on
	 * `blocked` would otherwise conflate a refusal with a relevance judgement.
	 */
	| 'decoy'
	| 'exhausted';

/** One engine of the chain that did not answer, and why. */
export interface EngineFailure {
	/** The engine's name. */
	engine: string;
	error: SearchcastError;
}

/** A typed searchcast failure. Branch on `kind`, not on the message. */
export class SearchcastError extends Error {
	override name = 'SearchcastError';
	readonly kind: SearchcastErrorKind;
	/** For `exhausted`: every engine of the chain, in order, with its failure. */
	readonly failures?: EngineFailure[];

	constructor(
		kind: SearchcastErrorKind,
		message: string,
		options?: {cause?: unknown; failures?: EngineFailure[]},
	) {
		super(message, options);
		this.kind = kind;
		if (options?.failures) this.failures = options.failures;
	}
}
