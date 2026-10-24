/** Shell command for a run configuration; debug adds the Node inspector through npm's `node-options` (cross-platform). */
export const runCommandLine = (script: string, debug: boolean): string =>
    debug ? `npm run ${script} --node-options=--inspect` : `npm run ${script}`;
