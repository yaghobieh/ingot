/**
 * The `.ingot` kit shared by the `ingot` CLI and the Ingot IDE: rule packs and the lockfile (IDEA-322), specs (IDEA-324)
 * and policy.yaml (IDEA-325, IDEA-326). Canonical copy: ingot-portal/packages/ingot-cli/src/ingot-kit; the IDE copy
 * (packages/ingot-core/src/common/ingot-kit) is overwritten by `node scripts/sync-ingot-kit.mjs`. Edit the CLI copy.
 */
export * from './ingot-kit.consts';
export type * from './ingot-kit.types';
export * from './yaml.utils';
export * from './semver.utils';
export * from './packs.utils';
export * from './specs.utils';
export * from './policy.utils';
