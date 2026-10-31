import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { FILE_LIST_TTL_MS } from '../../common/rules-insight/rules-insight.consts';
import type { RulesInsightService } from '../../common/rules-insight/rules-insight.types';
import { runDoctor } from '../../common/rules-engine/doctor.utils';
import { effectiveRules } from '../../common/rules-engine/effective-rules.utils';
import { GIT_LOG_FORMAT, packFor, parseGitLog, sourceLabel } from '../../common/rules-engine/provenance.utils';
import { classifyRulePath, loadRuleDocs, ruleDocFromFile } from '../../common/rules-engine/rule-docs.utils';
import { GLOBAL_PREFIX } from '../../common/rules-engine/rules-engine.consts';
import type { DoctorOptions, DoctorReport, EffectiveRules, RuleDoc, RuleProvenance, RulesWorkspace } from '../../common/rules-engine/rules-engine.types';
import { listProjectFiles, nodeWorkspace, readGlobalRules, runGit } from './project-files';

/** Rules Doctor, effective rules, provenance and file lists for the IDE (IDEA-317/318/321/327). */
@injectable()
export class IngotRulesInsightService implements RulesInsightService {

    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected readonly fileCache = new Map<string, { at: number; files: Promise<string[]> }>();

    protected checkRoot(root: string): string {
        const resolved = path.resolve(root);
        if (!path.isAbsolute(root) || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
            throw new Error('Not a project folder on this machine.');
        }
        return resolved;
    }

    /** A project-relative path that stays inside the project. */
    protected checkRelative(root: string, rel: string): string {
        const clean = rel.replace(/\\/g, '/').replace(/^\.?\//, '');
        const full = path.resolve(root, clean);
        if (!full.startsWith(`${root}${path.sep}`) && full !== root) {
            throw new Error('Path is outside the project.');
        }
        return clean;
    }

    async listFiles(root: string): Promise<string[]> {
        const dir = this.checkRoot(root);
        const cached = this.fileCache.get(dir);
        if (cached && Date.now() - cached.at < FILE_LIST_TTL_MS) {
            return cached.files;
        }
        const files = listProjectFiles(dir);
        this.fileCache.set(dir, { at: Date.now(), files });
        return files;
    }

    async invalidateFiles(root: string): Promise<void> {
        this.fileCache.delete(this.checkRoot(root));
    }

    protected async workspace(root: string): Promise<RulesWorkspace> {
        const dir = this.checkRoot(root);
        const configDir = FileUri.fsPath(await this.env.getConfigDirUri());
        return nodeWorkspace(dir, await this.listFiles(dir), readGlobalRules(configDir));
    }

    async doctor(root: string, options?: DoctorOptions): Promise<DoctorReport> {
        return runDoctor(await this.workspace(root), options);
    }

    async effective(root: string, file: string): Promise<EffectiveRules> {
        const ws = await this.workspace(root);
        return effectiveRules(loadRuleDocs(ws), ws.files, this.checkRelative(this.checkRoot(root), file));
    }

    async habits(root: string): Promise<RuleDoc[]> {
        return loadRuleDocs(await this.workspace(root)).filter(d => d.source === 'habit');
    }

    async provenance(root: string, rulePath: string): Promise<RuleProvenance> {
        const ws = await this.workspace(root);
        if (rulePath.startsWith(GLOBAL_PREFIX)) {
            const global = ws.globalFiles?.find(f => f.path === rulePath);
            const doc = ruleDocFromFile(rulePath, global?.text ?? '', { source: 'global', scope: '' });
            return { path: rulePath, sourceLabel: sourceLabel(doc), uncommitted: false };
        }
        const dir = this.checkRoot(root);
        const rel = this.checkRelative(dir, rulePath);
        const doc = ruleDocFromFile(rel, ws.read(rel) ?? '', classifyRulePath(rel));
        const [history, added, status] = await Promise.all([
            runGit(dir, ['log', '-1', `--format=${GIT_LOG_FORMAT}`, '--', rel]),
            runGit(dir, ['log', '--follow', '--diff-filter=A', `--format=${GIT_LOG_FORMAT}`, '--', rel]),
            runGit(dir, ['status', '--porcelain', '--', rel])
        ]);
        const last = parseGitLog(history ?? '').last;
        const first = parseGitLog(added ?? '').first ?? last;
        const pack = packFor(doc, ws);
        return {
            path: rel,
            sourceLabel: sourceLabel(doc),
            uncommitted: !last || !!status?.trim(),
            ...(last ? { lastCommit: last } : {}),
            ...(first ? { firstCommit: first } : {}),
            ...(pack ? { pack } : {})
        };
    }
}
