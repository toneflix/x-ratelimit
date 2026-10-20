// Firefox and Safari expose the promise-based `browser`; Chrome exposes
// `chrome`, whose MV3 APIs also return promises. Same shape for our use.
export const api: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;
