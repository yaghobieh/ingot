import * as React from '@theia/core/shared/react';
import {
    durationLabel, highlightShell, toolCard, TOOL_OUTPUT_PREVIEW_LINES, type ProfileCard, type TerminalCard, type ToolCallInfo
} from '../../common/agents/tool-cards';

/** IDEA-177: one tool step in the agent chat, drawn as a terminal block, a profile card or a compact card. */
export interface ToolCardProps {
    readonly info: ToolCallInfo;
    readonly text: string;
    readonly from?: string;
    readonly expanded: boolean;
    readonly onToggle: () => void;
    readonly openLink: (url: string) => void;
    readonly now?: number;
}

const Spinner = (): React.ReactElement => <span className='ingot-tc-spinner' role='progressbar' aria-label='Running' />;

const statusOf = (info: ToolCallInfo, exitCode?: number): React.ReactNode => {
    if (info.state === 'running') {
        return <Spinner />;
    }
    const failed = info.state === 'error' || (exitCode !== undefined && exitCode !== 0);
    const took = info.endedAt ? durationLabel(info.endedAt - info.startedAt) : undefined;
    return <span className={`ingot-tc-status ${failed ? 'failed' : 'ok'}`} title={exitCode !== undefined ? `Exit code ${exitCode}` : failed ? 'Failed' : 'Done'}>
        <span className={`codicon codicon-${failed ? 'error' : 'check'}`} />
        {exitCode !== undefined && <span className='ingot-tc-exit'>{exitCode === 0 ? 'exit 0' : `exit ${exitCode}`}</span>}
        {took && <span className='ingot-tc-took'>{took}</span>}
    </span>;
};

const Command = ({ command }: { command: string }): React.ReactElement =>
    <pre className='ingot-tc-command'><span className='ingot-sh-prompt'>$ </span>{highlightShell(command).map((t, i) =>
        t.kind === 'text' ? <React.Fragment key={i}>{t.text}</React.Fragment> : <span key={i} className={`ingot-sh-${t.kind}`}>{t.text}</span>)}</pre>;

const Output = ({ output, expanded, onToggle }: { output: string; expanded: boolean; onToggle: () => void }): React.ReactElement | null => {
    if (!output.trim()) {
        return null;
    }
    const lines = output.split('\n');
    const long = lines.length > TOOL_OUTPUT_PREVIEW_LINES;
    const shown = expanded || !long ? output : lines.slice(-TOOL_OUTPUT_PREVIEW_LINES).join('\n');
    return <div className='ingot-tc-output-wrap'>
        {long && <button type='button' className='ingot-tc-more' aria-expanded={expanded} onClick={onToggle}>
            <span className={`codicon codicon-chevron-${expanded ? 'up' : 'down'}`} />{expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>}
        <pre className='ingot-tc-output'>{shown}</pre>
    </div>;
};

const Terminal = ({ card, props }: { card: TerminalCard; props: ToolCardProps }): React.ReactElement => {
    const [open, setOpen] = React.useState(props.info.state === 'running');
    const [allOutput, setAllOutput] = React.useState(false);
    const touched = React.useRef(false);
    // Open while it runs; a clean finish folds it to one line, a failure stays open (unless the user chose).
    React.useEffect(() => {
        if (!touched.current && props.info.state !== 'running') {
            setOpen(props.info.state === 'error' || (card.exitCode ?? 0) !== 0);
        }
    }, [props.info.state, card.exitCode]);
    const isOpen = open || props.expanded;
    return <div className={`ingot-chat-tool ingot-tc ingot-tc-terminal ${props.info.state}${isOpen ? ' open' : ''}`} data-tool={`${props.info.server}/${props.info.tool}`}>
        <button type='button' className='ingot-tc-head' aria-expanded={isOpen} title={card.command}
            onClick={() => { touched.current = true; setOpen(!isOpen); if (isOpen && props.expanded) { props.onToggle(); } }}>
            <span className='codicon codicon-terminal ingot-tc-icon' />
            <span className='ingot-tc-title'>{card.title}</span>
            {card.programs.length > 0 && <span className='ingot-tc-programs'>{card.programs.join(', ')}</span>}
            <span className='ingot-flex' />
            {statusOf(props.info, card.exitCode)}
            <span className={`codicon codicon-chevron-${isOpen ? 'down' : 'right'} ingot-tc-chevron`} />
        </button>
        {isOpen && <div className='ingot-tc-body'>
            <Command command={card.command} />
            {card.note && <div className='ingot-tc-note'>{card.note}</div>}
            <Output output={card.output} expanded={allOutput} onToggle={() => setAllOutput(!allOutput)} />
        </div>}
    </div>;
};

const Profile = ({ profile, title, props }: { profile: ProfileCard; title: string; props: ToolCardProps }): React.ReactElement => {
    const link = (url: string, label: string): React.ReactElement => <a href={url} onClick={e => { e.preventDefault(); props.openLink(url); }}>{label}</a>;
    const stat = (icon: string, value: number | undefined, label: string): React.ReactNode => value === undefined ? undefined
        : <div className='ingot-pc-stat'><b><span className={`codicon codicon-${icon}`} />{value.toLocaleString()}</b><span>{label}</span></div>;
    const [server] = (props.from ?? props.info.server).split('/');
    return <div className='ingot-chat-tool ingot-tc ingot-tc-profile done' data-tool={`${props.info.server}/${props.info.tool}`}>
        <div className='ingot-tc-line'><span className='codicon codicon-plug ingot-tc-icon' /><span className='ingot-tc-title'>{title}</span><span className='ingot-dim'> in {server}</span></div>
        <div className='ingot-pc' id={`ingot-pc-${profile.login}`}>
            <div className='ingot-pc-top'>
                {profile.avatarUrl ? <img className='ingot-pc-avatar' src={profile.avatarUrl} alt='' referrerPolicy='no-referrer' />
                    : <span className='ingot-pc-avatar ingot-pc-avatar-letter'>{(profile.name ?? profile.login).slice(0, 1).toUpperCase()}</span>}
                <div className='ingot-pc-names'>
                    <div className='ingot-pc-name'>{profile.name ?? profile.login}</div>
                    <div className='ingot-pc-login'>{profile.url ? link(profile.url, `@${profile.login}`) : `@${profile.login}`}</div>
                </div>
            </div>
            {profile.bio && <div className='ingot-pc-bio'>{profile.bio}</div>}
            {(profile.location || profile.website || profile.email) && <div className='ingot-pc-facts'>
                {profile.location && <div><span className='codicon codicon-location' />{profile.location}</div>}
                {profile.website && <div><span className='codicon codicon-link' />{link(profile.website, profile.website)}</div>}
                {profile.email && <div><span className='codicon codicon-mail' />{link(`mailto:${profile.email}`, profile.email)}</div>}
            </div>}
            {(profile.repos ?? profile.followers ?? profile.following) !== undefined && <div className='ingot-pc-stats'>
                {stat('repo', profile.repos, 'Repos')}{stat('person', profile.followers, 'Followers')}{stat('person-add', profile.following, 'Following')}
            </div>}
        </div>
    </div>;
};

export const ToolCardView = (props: ToolCardProps): React.ReactElement => {
    const card = toolCard(props.info, props.text);
    if (card.kind === 'terminal') {
        return <Terminal card={card} props={props} />;
    }
    if (card.kind === 'profile') {
        return <Profile profile={card.profile} title={card.title} props={props} />;
    }
    const output = card.output.trim();
    const summary = props.info.tool === 'summary';
    const short = !summary && output.split('\n').length <= 3 && output.length <= 240;
    const open = summary || props.expanded || (short && props.info.state !== 'running');
    return <div id={summary ? 'ingot-work-summary' : undefined} className={`ingot-chat-tool ingot-tc ingot-tc-generic ${props.info.state}${open ? ' open' : ''}`} data-tool={`${props.info.server}/${props.info.tool}`}>
        <button type='button' className='ingot-tc-head' aria-expanded={open} onClick={props.onToggle} disabled={short && props.info.state !== 'running'}>
            <span className='codicon codicon-tools ingot-tc-icon' />
            <span className='ingot-tc-title'>{card.title}</span>
            {card.detail && <span className='ingot-tc-programs'>{card.detail}</span>}
            <span className='ingot-tc-from'>{props.from}</span>
            <span className='ingot-flex' />
            {statusOf(props.info)}
            {!short && <span className={`codicon codicon-chevron-${open ? 'down' : 'right'} ingot-tc-chevron`} />}
        </button>
        {open && output && <pre className='ingot-tc-output'>{output}</pre>}
    </div>;
};

/** "Thought" row: the model's reasoning, collapsed; shimmering while it is still thinking. */
export const ThoughtRow = ({ thought, thinking, expanded, onToggle }: { thought: string; thinking: boolean; expanded: boolean; onToggle: () => void }): React.ReactElement =>
    <div className={`ingot-chat-thought${thinking ? ' thinking' : ''}${expanded ? ' open' : ''}`}>
        <button type='button' className='ingot-chat-thought-row' aria-expanded={expanded} onClick={onToggle}>
            <span className='codicon codicon-lightbulb-sparkle' />
            <span className='ingot-chat-thought-label'>{thinking ? 'Thinking' : 'Thought'}</span>
            <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
        </button>
        {expanded && thought && <div className='ingot-chat-thought-text'>{thought}</div>}
    </div>;
