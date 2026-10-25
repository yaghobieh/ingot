export type UpdateCheck =
    | { readonly kind: 'no-release'; readonly current: string }
    | { readonly kind: 'up-to-date'; readonly current: string; readonly latest: string }
    | { readonly kind: 'available'; readonly current: string; readonly latest: string };
