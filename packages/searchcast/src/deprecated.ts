// The serpcast names of the public API, kept for one release (0.2.x) so a
// serpcast user can upgrade before renaming (ADR 0005). Each is the SAME value
// or type as its new name: `instanceof SerpcastError` is `instanceof
// SearchcastError`. Removed in the next minor after 0.2.x, with this file.

import {SearchcastError, type SearchcastErrorKind} from './errors.js';
import {
	createSearchcast,
	type Searchcast,
	type SearchcastOptions,
} from './chain.js';

/** @deprecated Renamed `SearchcastError` (the same class); this alias goes in the next minor after 0.2.x. */
export const SerpcastError = SearchcastError;
/** @deprecated Renamed `SearchcastError` (the same class); this alias goes in the next minor after 0.2.x. */
export type SerpcastError = SearchcastError;
/** @deprecated Renamed `SearchcastErrorKind`; this alias goes in the next minor after 0.2.x. */
export type SerpcastErrorKind = SearchcastErrorKind;
/** @deprecated Renamed `createSearchcast` (the same function); this alias goes in the next minor after 0.2.x. */
export const createSerpcast = createSearchcast;
/** @deprecated Renamed `Searchcast`; this alias goes in the next minor after 0.2.x. */
export type Serpcast = Searchcast;
/** @deprecated Renamed `SearchcastOptions`; this alias goes in the next minor after 0.2.x. */
export type SerpcastOptions = SearchcastOptions;
