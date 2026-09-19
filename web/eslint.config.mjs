import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

/**
 * `eslint-config-next` (>=15) ships flat config arrays directly, so this just spreads it rather
 * than going through `FlatCompat` (which is for legacy `.eslintrc`-style shareable configs and
 * chokes on these with a "circular structure" error). Pin `eslint` itself to the 9.x line
 * (package.json) - `eslint-config-next@16` pulls in a `typescript-eslint` build that breaks under
 * `eslint@10`'s flat-config internals (`scopeManager.addGlobals is not a function`).
 */
const config = [
  ...nextCoreWebVitals,
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**'],
  },
];

export default config;
