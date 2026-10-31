import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AccountBackend } from '../../common/account/account-protocol';
import { HTTP_OK, TEAM_RULES_STUB_FILE, TEAM_RULES_TEXT } from '../../common/team-rules/team-rules-admin.consts';
import type { TeamRuleDraft, TeamRulesState } from '../../common/team-rules/team-rules-admin.types';
import {
    isTeamRulesUnsupported, parseTeamRuleDrafts, parseTeamRulesStub, publishedTeamRules, teamRulesStatusError, teamRulesStubText
} from '../../common/team-rules/team-rules-admin.utils';
import { IngotAccountService } from '../account/account-service';
import { IngotFeatureFlags } from '../config/feature-flags';

/**
 * IDEA-287: Team Rules for admins (Cursor's dashboard Team Rules). Saved on the account server through /v1/team/rules,
 * which publishes enabled rules to every member in /v1/config `teamRules`. While the server has no such endpoint (404,
 * offline), they are kept in `~/.ingot/team-rules.local.json` with a TODO and apply on this machine only.
 */
@injectable()
export class TeamRulesAdminService {

    @inject(AccountBackend) protected readonly backend: AccountBackend;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;
    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(FileService) protected readonly files: FileService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    /** Enabled rules from the stub file, applied on this machine. */
    protected localRules: readonly TeamRuleDraft[] = [];

    @postConstruct()
    protected init(): void {
        void this.readStub().then(rules => {
            this.localRules = rules;
            this.onDidChangeEmitter.fire();
        });
    }

    get isAdmin(): boolean {
        return this.account.isAdmin;
    }

    /** What applies from the stub file: enabled rules, in the shape of `config.teamRules`. */
    get local(): readonly TeamRuleDraft[] {
        return publishedTeamRules(this.localRules);
    }

    async load(): Promise<TeamRulesState> {
        if (!this.isAdmin) {
            return { rules: [], store: 'local', error: TEAM_RULES_TEXT.notAdmin };
        }
        const response = await this.backend.teamRulesRequest('GET');
        if (response.status === HTTP_OK) {
            return { rules: parseTeamRuleDrafts(response.body.rules), store: 'server' };
        }
        if (isTeamRulesUnsupported(response.status)) {
            return { rules: await this.readStub(), store: 'local' };
        }
        return { rules: [], store: 'server', error: teamRulesStatusError(response.status) };
    }

    /** Saves the whole list where it was loaded from; a server without the API falls back to the stub file. */
    async save(rules: readonly TeamRuleDraft[], store: TeamRulesState['store']): Promise<TeamRulesState> {
        if (!this.isAdmin) {
            return { rules, store, error: TEAM_RULES_TEXT.notAdmin };
        }
        if (store === 'server') {
            const response = await this.backend.teamRulesRequest('PUT', { rules });
            if (response.status === HTTP_OK) {
                await this.flags.refresh();
                this.onDidChangeEmitter.fire();
                return { rules: parseTeamRuleDrafts(response.body.rules ?? rules), store: 'server' };
            }
            if (!isTeamRulesUnsupported(response.status)) {
                return { rules, store, error: teamRulesStatusError(response.status) };
            }
        }
        await this.files.write(await this.stubFile(), teamRulesStubText(rules));
        this.localRules = rules;
        this.onDidChangeEmitter.fire();
        return { rules, store: 'local' };
    }

    protected async stubFile(): Promise<URI> {
        return new URI(await this.env.getConfigDirUri()).resolve(TEAM_RULES_STUB_FILE);
    }

    protected async readStub(): Promise<TeamRuleDraft[]> {
        const uri = await this.stubFile();
        return parseTeamRulesStub(await this.files.read(uri).then(content => content.value, () => undefined));
    }
}
