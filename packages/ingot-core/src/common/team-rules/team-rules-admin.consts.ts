/** IDEA-287: the account server's team rules API (GET returns `{ rules }`, PUT takes `{ rules }`; admins only). */
export const TEAM_RULES_API_PATH = '/v1/team/rules';
export const TEAM_RULES_METHODS: readonly string[] = ['GET', 'PUT'];
export const TEAM_RULES_STUB_FILE = 'team-rules.local.json';
export const TEAM_RULES_STUB_VERSION = 1;
/** Written into the stub file, so whoever opens it knows why it exists. */
export const TEAM_RULES_STUB_TODO =
    'TODO(IDEA-287): ingot-server has no /v1/team/rules endpoint yet. These team rules are kept on this machine only and apply here; ' +
    'once the endpoint exists, Settings > Team Rules saves to the server and every team member gets them through /v1/config.';

export const HTTP_OK = 200;
export const HTTP_FORBIDDEN = 403;
/** Statuses meaning "this server has no team rules API" (or it is unreachable / signed out: 0). */
export const TEAM_RULES_UNSUPPORTED_STATUSES: readonly number[] = [0, 404, 405, 501];

export const TEAM_RULE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,63}$/;

export const TEAM_RULES_COMMAND = { id: 'ingot.teamRules.edit', label: 'Team Rules: Edit for the Team (Admin)…', category: 'Ingot' } as const;
export const TEAM_RULES_SETTINGS_PAGE = 'team-rules';

export const TEAM_RULES_TEXT = {
    server: 'Saved on your Ingot team. Members get enabled rules automatically.',
    local: 'Saved on this machine only (team-rules.local.json). TODO: the Ingot server has no team rules API yet; rules apply on this machine until it does.',
    notAdmin: 'Only team admins can edit team rules.',
    forbidden: 'The server refused: only team admins can edit team rules.',
    nameRequired: 'Give the rule a name (letters, digits, spaces, . _ -).',
    bodyRequired: 'Write the rule.',
    duplicate: 'A team rule with this name already exists.'
} as const;
