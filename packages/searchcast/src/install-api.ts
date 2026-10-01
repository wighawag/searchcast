// `searchcast/install`: the installers and reports for embedders (webveil), so
// a user installs one thing and the embedder offers searchcast's install steps
// itself. A SEPARATE entry from `searchcast` on purpose: the main entry reaches
// no download code (test/install.test.ts walks its imports), so importing
// `searchcast` can never download anything; only importing this subpath and
// calling an installer does, the embedder's explicit act (ADR 0002). The
// guarantees are the CLI's: pinned checksums, archive validation, the
// caller's proxy only. Size caps may be lowered, never raised.

export {
	InstallError,
	MAX_ARCHIVE_BYTES as MAX_LIBCURL_ARCHIVE_BYTES,
	MAX_UNPACKED_BYTES as MAX_LIBCURL_UNPACKED_BYTES,
	installLibcurl,
	type InstallOptions,
	type InstallResult,
	type Release,
} from './install.js';
export {
	MAX_ARCHIVE_BYTES as MAX_RECIPES_ARCHIVE_BYTES,
	installRecipes,
	type InstallRecipesOptions,
	type InstallRecipesResult,
} from './install-recipes.js';
export {MAX_UNPACKED_BYTES as MAX_RECIPES_UNPACKED_BYTES} from './recipe-archive.js';
export {DEFAULT_IPFS_GATEWAYS} from './ipfs.js';
export {
	formatInstalledRecipeSets,
	formatRecipeSets,
	listRecipeSets,
	recipeSetDir,
	recipesDir,
	type RecipeSet,
	type RecipeSetSource,
} from './recipes.js';
export {
	ECHO_URL,
	doctor,
	formatReport,
	healthy,
	type DoctorOptions,
	type DoctorReport,
} from './doctor.js';
export {LIBCURL_IMPERSONATE, type LibrarySource} from './libcurl.js';
export {
	dataDir,
	oldDataDir,
	oldDataDirHits,
	type OldDataDirHits,
} from './data-dir.js';
