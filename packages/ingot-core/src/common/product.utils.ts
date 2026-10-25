import { PRODUCT, TITLE_SEPARATOR } from './product.consts';
import type { WindowTitleParts } from './product.types';

/** Builds a JetBrains-style window title: `workspace — file — Ingot`. */
export const formatWindowTitle = ({ file, workspace }: WindowTitleParts): string =>
    [workspace, file, PRODUCT.name].filter((part): part is string => !!part && part.trim() !== '').join(TITLE_SEPARATOR);

export const formatAboutText = (): string => `${PRODUCT.name} ${PRODUCT.version} · ${PRODUCT.license}`;
