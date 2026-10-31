import { inject, injectable, optional } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import { PlaybookService } from './playbook-service';
import type { AgentSession } from '../../common/agents/agents.types';
import type { AgentToolCall } from '../../common/agents/agent-protocol';
import type { AgentActionResult } from '../../common/agents/agent-actions-service';
import { BUILTIN_TOOL_SERVER } from '../../common/agents/agent-actions';
import { TERMINAL_CONTEXT_LINES } from '../../common/agents/agent-modes';
import { MAX_DIAGNOSTICS, USE_HABIT_TOOL } from '../../common/habits/playbook.consts';
import type { HabitDiagnostic, HabitSignals, Playbook } from '../../common/habits/playbook.types';
import { bestPlaybook, matchReason, terminalErrorLines } from '../../common/habits/playbook-match.utils';
import {
    activeHabit, doneNudge, findPlaybook, formatActiveHabit, formatHabitIndex, habitMarks, habitToolAllowed, refreshHabit, tickCommand, tickHabit
} from '../../common/habits/playbook.utils';

const ERROR_SEVERITY = 1;

/** What the agent loop knows at the start of a turn. */
export interface HabitTurn {
    readonly root: URI | undefined;
    readonly prompt: string;
    readonly attachments: string;
    readonly files: readonly string[];
    readonly canUseTools: boolean;
}

/**
 * IDEA-296 Habits v2 in the agent loop: picks a matching habit at the start of a turn (deterministic match on the
 * prompt, attached files, problems and terminal errors), puts the habit index and the active habit in the system
 * prompt, runs `ingot/use_habit`, limits tools to `allowedTools`, ticks steps and checks done criteria before finishing.
 */
@injectable()
export class HabitRunner {

    @inject(PlaybookService) protected readonly playbooks: PlaybookService;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(ProblemManager) @optional() protected readonly problems?: ProblemManager;

    /** Habits loaded for each chat's current turn (for use_habit). */
    protected readonly loaded = new Map<string, readonly Playbook[]>();

    /** Picks or refreshes the chat's habit and returns its system-prompt section ('' when there are no habits). */
    async prepare(session: AgentSession, turn: HabitTurn): Promise<string> {
        if (!turn.canUseTools) {
            return '';
        }
        const playbooks = await this.playbooks.enabledPlaybooks(turn.root).catch(() => []);
        this.loaded.set(session.id, playbooks);
        let habit = session.habit;
        if (habit && !habit.off) {
            const current = playbooks.find(p => p.id === habit!.id);
            habit = current ? refreshHabit(habit, current) : undefined;
        }
        if (!habit && this.playbooks.autoSelect) {
            const match = bestPlaybook(playbooks, this.signals(turn));
            habit = match ? activeHabit(match.playbook, 'auto', matchReason(match)) : undefined;
        }
        session.habit = habit ? { ...habit, nudged: 0 } : undefined;
        const active = session.habit && !session.habit.off ? formatActiveHabit(session.habit, playbooks.find(p => p.id === session.habit!.id)?.notes) : '';
        return [formatHabitIndex(playbooks, `${BUILTIN_TOOL_SERVER}/${USE_HABIT_TOOL}`), active].filter(Boolean).join('\n\n');
    }

    protected signals(turn: HabitTurn): HabitSignals {
        return { prompt: turn.prompt, attachments: turn.attachments, files: turn.files, diagnostics: this.diagnostics(turn.root), terminalErrors: terminalErrorLines(this.terminalText()) };
    }

    /** Errors in the Problems view, with project-relative paths. */
    protected diagnostics(root: URI | undefined): HabitDiagnostic[] {
        try {
            return (this.problems?.findMarkers({}) ?? []).filter(m => m.data.severity === ERROR_SEVERITY).slice(0, MAX_DIAGNOSTICS).map(m => {
                const uri = new URI(m.uri);
                return { path: root?.relative(uri)?.toString() ?? uri.path.base, message: m.data.message };
            });
        } catch {
            return [];
        }
    }

    /** The last lines of every open terminal. */
    protected terminalText(): string {
        return this.terminals.all.map(t => {
            try {
                const buffer = t.buffer;
                const start = Math.max(0, buffer.length - TERMINAL_CONTEXT_LINES);
                return buffer.length ? buffer.getLines(start, buffer.length - start, true).join('\n') : '';
            } catch {
                return '';
            }
        }).join('\n');
    }

    /** `ingot/use_habit {"name": "…"}`: switches the chat to that habit and returns its steps. */
    use(session: AgentSession, name: string): AgentActionResult {
        const playbooks = this.loaded.get(session.id) ?? [];
        const p = findPlaybook(playbooks, name);
        if (!p) {
            return { text: `No habit "${name}".${playbooks.length ? ` Habits: ${playbooks.map(x => x.name).join(', ')}.` : ''}`, isError: true };
        }
        session.habit = activeHabit(p, 'agent', 'picked by the agent');
        return { text: formatActiveHabit(session.habit, p.notes), isError: false };
    }

    /** The user picked a habit (or turned it off with `undefined`) from the pill; returns the text the model should see. */
    async choose(session: AgentSession, root: URI | undefined, id: string | undefined): Promise<string> {
        if (!id) {
            session.habit = session.habit ? { ...session.habit, off: true } : undefined;
            return 'The user turned the habit off for this chat. Ignore its steps and tool limits.';
        }
        const playbooks = await this.playbooks.enabledPlaybooks(root);
        this.loaded.set(session.id, playbooks);
        const p = playbooks.find(x => x.id === id);
        if (!p) {
            return '';
        }
        session.habit = activeHabit(p, 'user', 'chosen by you');
        return `The user switched this chat to a habit.\n${formatActiveHabit(session.habit, p.notes)}`;
    }

    allows(session: AgentSession, server: string, tool: string): boolean {
        return habitToolAllowed(session.habit, server, tool, BUILTIN_TOOL_SERVER);
    }

    /** Why a tool call is refused while the habit is active; undefined when it may run. */
    refuse(session: AgentSession, call: AgentToolCall): string | undefined {
        const habit = session.habit;
        return habit && !this.allows(session, call.server, call.tool)
            ? `The habit "${habit.name}" allows only these tools: ${habit.allowedTools.join(', ')}. Use one of them, call ${BUILTIN_TOOL_SERVER}/${USE_HABIT_TOOL} to switch habits, or ask the user.`
            : undefined;
    }

    /** A command the agent ran ticks the steps (and, when it passed, the done criteria) that name it. */
    afterTool(session: AgentSession, call: AgentToolCall, failed: boolean): void {
        const command = call.server === BUILTIN_TOOL_SERVER && call.tool === 'run' && typeof call.args.command === 'string' ? call.args.command : '';
        if (session.habit && !session.habit.off && command) {
            session.habit = tickCommand(session.habit, command, !failed);
        }
    }

    /** `HABIT-STEP` / `HABIT-DONE` lines in a finished reply. */
    consume(session: AgentSession, reply: string): void {
        if (session.habit && !session.habit.off) {
            session.habit = tickHabit(session.habit, habitMarks(reply));
        }
    }

    /** The hidden reminder to verify open done criteria before finishing (once per turn). */
    doneNudge(session: AgentSession): string | undefined {
        const text = doneNudge(session.habit);
        if (text && session.habit) {
            session.habit = { ...session.habit, nudged: (session.habit.nudged ?? 0) + 1 };
        }
        return text;
    }
}
