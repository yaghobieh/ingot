export type PlanId = 'free' | 'pro' | 'team';
export type TeamRole = 'owner' | 'admin' | 'member';
export type ThemePreference = 'light' | 'dark' | 'system';
export type Locale = 'en' | 'he' | 'es';
export type KeyFamily = 'claude' | 'gpt' | 'gemini' | 'deepseek' | 'custom';
export type OAuthProvider = 'github' | 'google';
export type OtpPurpose = 'sign-in' | 'sign-up';

export interface PlanDefinition {
    id: PlanId;
    /** null = price not decided yet; shown as TBD. */
    monthlyPriceUsd: number | null;
    priceStatus: 'tbd' | 'final';
    featureKeys: string[];
    highlighted: boolean;
}

export interface ModelDefinition {
    id: string;
    label: string;
    kind: 'chat' | 'autocomplete';
    defaultEnabled: boolean;
}

export interface PublicUser {
    id: string;
    email: string;
    name: string;
    avatarUrl: string;
    theme: ThemePreference;
    locale: Locale;
    plan: PlanId;
    emailVerified: boolean;
}

export interface UsageTotals {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}

export interface UsageDay extends UsageTotals {
    day: string;
}

export interface UsageByModel extends UsageTotals {
    model: string;
}

export interface UsageSummary {
    days: number;
    totals: UsageTotals;
    byDay: UsageDay[];
    byModel: UsageByModel[];
}

export interface UsageRow extends UsageTotals {
    id: string;
    model: string;
    feature: string;
    occurredAt: string;
}

export interface AccessTokenInfo {
    id: string;
    name: string;
    prefix: string;
    source: string;
    lastUsedAt: string | null;
    createdAt: string;
}

export interface ProviderKeyInfo {
    id: string;
    family: KeyFamily;
    label: string;
    last4: string;
    baseUrl: string;
    createdAt: string;
}

export interface TeamMemberInfo {
    userId: string;
    email: string;
    name: string;
    role: TeamRole;
}

export interface TeamInviteInfo {
    id: string;
    email: string;
    role: TeamRole;
    expiresAt: string;
}

export interface TeamInfo {
    id: string;
    name: string;
    myRole: TeamRole;
    members: TeamMemberInfo[];
    invites: TeamInviteInfo[];
}

export interface BillingInfo {
    plan: PlanId;
    status: string;
    provider: string;
    configured: boolean;
    renewsAt: string | null;
}

export interface SyncedSettings {
    data: Record<string, unknown>;
    version: number;
    updatedAt: string;
}

export interface AuthProvidersInfo {
    email: boolean;
    github: boolean;
    google: boolean;
}
