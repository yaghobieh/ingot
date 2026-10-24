import type { AuthProvidersInfo } from '@/types/domain.types';

export type AuthMode = 'sign-in' | 'sign-up';

export interface AuthFormProps {
    mode: AuthMode;
    providers: AuthProvidersInfo;
    next: string;
    initialError?: string;
}
