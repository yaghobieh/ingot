import type { en } from '@i18n/messages/en';

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

export type Messages = Widen<typeof en>;
export type TranslateParams = Record<string, string | number>;
export type Translate = (key: string, params?: TranslateParams) => string;
