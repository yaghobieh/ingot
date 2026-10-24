import type { PRODUCT } from './product.consts';

export type ProductInfo = typeof PRODUCT;

export interface WindowTitleParts {
    readonly file?: string;
    readonly workspace?: string;
}
