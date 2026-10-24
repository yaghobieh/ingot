export const en = {
    common: {
        signIn: 'Sign in', signUp: 'Sign up', signOut: 'Sign out', dashboard: 'Dashboard', pricing: 'Pricing', getStarted: 'Get started',
        save: 'Save', saved: 'Saved', cancel: 'Cancel', delete: 'Delete', copy: 'Copy', copied: 'Copied', loading: 'Loading…',
        tbd: 'TBD', perMonth: '/ month', back: 'Back', continue: 'Continue', theme: 'Theme', language: 'Language',
        light: 'Light', dark: 'Dark', system: 'System', toggleTheme: 'Toggle theme', openSource: 'Open source · Apache-2.0', never: 'Never', menu: 'Menu'
    },
    landing: {
        badge: 'Open-source AI IDE',
        title: 'The AI IDE with the soul of WebStorm',
        subtitle: 'Agents, every model, the IntelliJ keymap you already know, and plugins from Open VSX. Bring your own key or use ours.',
        ctaPrimary: 'Get started free', ctaSecondary: 'See pricing', download: 'Download for macOS & Windows (soon)',
        featuresTitle: 'Everything you need, nothing you don’t',
        features: {
            agents: { title: 'Multiple agents, multiple chats', body: 'Run agents in parallel with plans, steps and inline diffs you accept or reject.' },
            models: { title: 'Every model in one picker', body: 'Claude, GPT, Gemini, DeepSeek, Qwen, Llama and local models, with your keys or hosted.' },
            keymap: { title: 'IntelliJ keymap', body: 'Search Everywhere, Find Action, refactorings and the shortcuts your hands already know.' },
            plugins: { title: 'Plugins and themes', body: 'A store for extensions and color themes from Open VSX, and an SDK to publish your own.' },
            rules: { title: '.alloy rules and skills', body: 'Type / in the agent for rules, skills and commands. Reads .cursor folders too.' },
            sync: { title: 'Synced everywhere', body: 'Settings, model defaults and usage stay in sync between the IDE and this portal.' }
        }
    },
    pricing: {
        title: 'Simple, fair pricing',
        subtitle: 'Start free with your own keys. Upgrade when you want hosted models and sync.',
        tbdNote: 'Paid plan prices are not final yet and are shown as TBD.',
        plans: {
            free: { name: 'Free', desc: 'Bring your own key. The full IDE, forever free.', cta: 'Start free' },
            pro: { name: 'Pro', desc: 'Hosted models and autocomplete, no keys needed.', cta: 'Choose Pro' },
            team: { name: 'Team', desc: 'Seats, roles and shared rules for your team.', cta: 'Choose Team' }
        },
        features: {
            byok: 'Bring your own model keys', allModels: 'Every model in the picker', agents: 'Agents and multiple chats', plugins: 'Plugins and themes', community: 'Community support',
            everythingFree: 'Everything in Free', hostedModels: 'Hosted models included', autocomplete: 'Fast autocomplete', sync: 'Settings sync', priority: 'Priority support',
            everythingPro: 'Everything in Pro', seats: 'Per-seat billing', roles: 'Owner, admin and member roles', sharedRules: 'Shared rules and skills', adminUsage: 'Team usage dashboard'
        },
        popular: 'Most popular'
    },
    auth: {
        signInTitle: 'Sign in to Ingot', signUpTitle: 'Create your Ingot account',
        signInSubtitle: 'We’ll email you a 6-digit code.', signUpSubtitle: 'Free forever with your own keys.',
        email: 'Email', name: 'Name', sendCode: 'Email me a code', or: 'or',
        github: 'Continue with GitHub', google: 'Continue with Google', notConfigured: 'Not configured yet',
        noAccount: 'New to Ingot?', haveAccount: 'Already have an account?',
        verifyTitle: 'Check your email', verifySubtitle: 'Enter the 6-digit code we sent to {email}.', code: 'Verification code',
        verify: 'Verify', resend: 'Resend code', resent: 'A new code is on its way.', changeEmail: 'Use a different email',
        errors: {
            invalid_email: 'Enter a valid email address.', invalid_code: 'That code is not right. Try again.', code_expired: 'That code expired. Send a new one.',
            too_many_codes: 'Too many codes requested. Wait a few minutes.', too_many_attempts: 'Too many tries. Send a new code.',
            oauth_failed: 'Sign-in with that provider failed. Try again.', generic: 'Something went wrong. Try again.'
        }
    },
    nav: { overview: 'Overview', usage: 'Usage', models: 'Models', billing: 'Plan & billing', keys: 'API keys', team: 'Team', settings: 'Settings' },
    overview: {
        title: 'Overview', range: 'Last {days} days', requests: 'Requests', tokens: 'Tokens', cost: 'Spend', plan: 'Plan',
        requestsByDay: 'Requests per day', tokensByDay: 'Tokens per day', costByModel: 'Spend by model',
        emptyTitle: 'No usage yet', emptyBody: 'Sign in from the Ingot IDE and your requests, tokens and spend show up here.',
        loadSample: 'Load sample usage', connectIde: 'Connect the IDE', input: 'Input', output: 'Output'
    },
    usage: {
        title: 'Usage', subtitle: 'Every request the IDE reported, newest first.', export: 'Export CSV',
        date: 'Date', model: 'Model', feature: 'Feature', requests: 'Requests', input: 'Input tokens', output: 'Output tokens', cost: 'Cost',
        prev: 'Previous', next: 'Next', page: 'Page {page} of {pages}', empty: 'No usage in this range.'
    },
    models: {
        title: 'Models', subtitle: 'Choose which models appear in the IDE picker and the default for new chats. Synced to the IDE.',
        chat: 'Chat & agents', autocomplete: 'Autocomplete', default: 'Default', makeDefault: 'Make default', enabled: 'Enabled'
    },
    billing: {
        title: 'Plan & billing', currentPlan: 'Current plan', status: 'Status', renews: 'Renews', upgrade: 'Upgrade to {plan}',
        stubTitle: 'Billing isn’t connected yet', stubBody: 'Checkout opens once the payment provider is connected. Your plan stays Free until then.',
        checkoutStubbed: 'Checkout is not available yet. Nothing was charged.', none: 'No subscription', comparePlans: 'Compare plans'
    },
    keys: {
        title: 'API keys',
        tokensTitle: 'Ingot access tokens', tokensBody: 'Tokens let the IDE and scripts call the Ingot API. Treat them like passwords.',
        tokenName: 'Token name', createToken: 'Create token', newToken: 'Copy this token now. You won’t be able to see it again.',
        prefix: 'Prefix', noTokens: 'No tokens yet.', revoke: 'Revoke', lastUsed: 'Last used', created: 'Created', source: 'Source', sources: { manual: 'Manual', device: 'IDE sign-in' },
        byokTitle: 'Bring your own key', byokBody: 'Use your own model keys on the Free plan. Keys are encrypted at rest and never shown again after you save them.',
        family: 'Models', label: 'Label', secret: 'Key', baseUrl: 'Base URL', addKey: 'Save key', noKeys: 'No keys saved yet.', ending: 'ending in {last4}'
    },
    team: {
        title: 'Team', noTeamTitle: 'Create a team', noTeamBody: 'Invite teammates, assign roles and share rules.',
        teamName: 'Team name', create: 'Create team', members: 'Members', invite: 'Invite a teammate', inviteEmail: 'Email address',
        role: 'Role', roles: { owner: 'Owner', admin: 'Admin', member: 'Member' }, sendInvite: 'Send invite', pending: 'Pending invites',
        inviteSent: 'Invite sent. You can also share this link:', remove: 'Remove', revokeInvite: 'Revoke', you: 'you', expires: 'Expires'
    },
    settings: {
        title: 'Settings', profile: 'Profile', name: 'Name', email: 'Email', appearance: 'Appearance',
        syncTitle: 'IDE sync', syncBody: 'Settings version {version}. The IDE reads and writes these through the Ingot API.', lastSync: 'Last updated'
    },
    device: {
        title: 'Sign in from Ingot', subtitle: 'Enter the code shown in the Ingot IDE.', code: 'Device code', lookup: 'Continue',
        confirm: '{client} wants to sign in to your Ingot account.', approve: 'Approve', deny: 'Deny',
        approved: 'You’re signed in. You can go back to Ingot now.', denied: 'Request denied. Nothing was shared.', invalid: 'That code is invalid or expired.'
    },
    invite: {
        title: 'Team invitation', body: 'You’re invited to join {team} as {role}.', accept: 'Accept invitation',
        accepted: 'You joined the team.', invalid: 'This invitation is invalid or has expired.', wrongEmail: 'This invite was sent to {email}. Sign in with that address to accept.',
        signIn: 'Sign in to accept'
    },
    errors: { generic: 'Something went wrong. Try again.', forbidden: 'You don’t have permission to do that.', encryption_not_configured: 'Key storage is not configured on this server.' }
};
