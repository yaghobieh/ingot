import * as React from '@theia/core/shared/react';
import type { AgentModeInfo } from '../../common/agents/agent-modes';
import { REACTION_HEART, REACTION_LIKE } from '../../common/agents/chat-round.consts';
import type { ReactionKind } from '../../common/agents/chat-round.types';
import { EDIT_RERUN_CHOICES, QUEUED_LABEL, QUEUED_TITLE } from '../../common/agents/composer-usability.consts';
import type { EditRerunChoice } from '../../common/agents/composer-usability.types';

/** IDEA-280: the chat mode as a compact pill in the composer row; opens the mode menu (⌘. still cycles). */
export const ModePill = ({ info, shortcut, open, onToggle }: {
    readonly info: AgentModeInfo;
    readonly shortcut: string;
    readonly open: boolean;
    readonly onToggle: () => void;
}): React.ReactElement =>
    <button type='button' id='ingot-composer-mode' className='ingot-pill ingot-mode-pill' data-mode={info.id}
        aria-haspopup='menu' aria-expanded={open} aria-label={`Mode: ${info.label}`}
        title={`Mode: ${info.label}. ${info.description}${shortcut ? ` (${shortcut} to switch)` : ''}`}
        style={{ '--ingot-mode-color': info.color } as React.CSSProperties}
        onClick={onToggle}>
        <span className={`codicon codicon-${info.icon}`} aria-hidden='true' />
        <span className='ingot-pill-label'>{info.label}</span>
        <span className='codicon codicon-chevron-down ingot-pill-caret' aria-hidden='true' />
    </button>;

const REACTIONS: readonly { readonly kind: ReactionKind; readonly icon: string; readonly label: string }[] = [
    { kind: REACTION_LIKE, icon: 'thumbsup', label: 'Like' },
    { kind: REACTION_HEART, icon: 'heart', label: 'Heart' }
];

/** IDEA-280: small icon-only reactions under an agent reply, muted until the reply is hovered. */
export const ReplyReactions = ({ index, reactions, onToggle }: {
    readonly index: number;
    readonly reactions: readonly ReactionKind[] | undefined;
    readonly onToggle: (kind: ReactionKind) => void;
}): React.ReactElement =>
    <span className='ingot-reactions ingot-reply-reactions'>
        {REACTIONS.map(r => {
            const on = !!reactions?.includes(r.kind);
            return <button key={r.kind} type='button' id={`ingot-react-${r.kind}-${index}`} className={`ingot-react${on ? ' on' : ''}`}
                aria-pressed={on} aria-label={on ? `Remove ${r.label.toLowerCase()}` : r.label} title={on ? `Remove ${r.label.toLowerCase()}` : r.label}
                onClick={() => onToggle(r.kind)}><span className={`codicon codicon-${r.icon}`} /></button>;
        })}
    </span>;

/** IDEA-280: a message sent during a run that the agent has not read yet. */
export const QueuedChip = (): React.ReactElement =>
    <span className='ingot-queued-chip' title={QUEUED_TITLE}><span className='codicon codicon-clock' aria-hidden='true' />{QUEUED_LABEL}</span>;

/** IDEA-280: inline edit of a sent prompt. Send asks whether to revert later changes, keep them, or cancel. */
export const EditRerunForm = ({ index, initial, onChoose, onCancel }: {
    readonly index: number;
    readonly initial: string;
    readonly onChoose: (choice: Exclude<EditRerunChoice, 'cancel'>, text: string) => void;
    readonly onCancel: () => void;
}): React.ReactElement => {
    const [text, setText] = React.useState(initial);
    const [choosing, setChoosing] = React.useState(false);
    const submit = (): void => { if (text.trim()) { setChoosing(true); } };
    return <form id='ingot-chat-edit' className='ingot-chat-edit-form' data-index={index} onSubmit={event => { event.preventDefault(); submit(); }}>
        <textarea id='ingot-chat-edit-input' className='ingot-chat-edit-input' value={text} aria-label='Edit message' autoFocus
            onChange={event => { setText(event.target.value); setChoosing(false); }}
            onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
                if (event.key === 'Escape') { event.preventDefault(); if (choosing) { setChoosing(false); } else { onCancel(); } }
            }} />
        {choosing
            ? <span className='ingot-chat-edit-choices' id='ingot-chat-edit-choices' role='group' aria-label='Rerun from here'>
                {EDIT_RERUN_CHOICES.map(choice => <button key={choice.id} type='button' id={`ingot-chat-edit-${choice.id}`} title={choice.title}
                    className={choice.id === 'revert' ? 'ingot-btn-primary' : choice.id === 'keep' ? 'ingot-btn-secondary' : 'ingot-btn-ghost'}
                    onClick={() => choice.id === 'cancel' ? setChoosing(false) : onChoose(choice.id, text)}>{choice.label}</button>)}
            </span>
            : <span className='ingot-chat-edit-actions'>
                <button type='button' id='ingot-chat-edit-cancel' className='ingot-btn-ghost' onClick={onCancel}>Cancel</button>
                <button type='submit' id='ingot-chat-edit-submit' className='ingot-btn-primary' disabled={!text.trim()}>Send</button>
            </span>}
    </form>;
};

/** IDEA-280: an ingot/ask_user question as a card in the chat; answering resumes the run. */
export const AskCard = ({ question, options, onAnswer }: {
    readonly question: string;
    readonly options: readonly string[] | undefined;
    readonly onAnswer: (text: string) => void;
}): React.ReactElement => {
    const [text, setText] = React.useState('');
    return <form id='ingot-ask' className='ingot-ask ingot-ask-card' aria-label='The agent asks' onSubmit={event => { event.preventDefault(); if (text.trim()) { onAnswer(text); } }}>
        <span className='ingot-ask-head'><span className='codicon codicon-question' aria-hidden='true' />Agent asks</span>
        <p id='ingot-ask-question' className='ingot-ask-question'>{question}</p>
        {!!options?.length && <span className='ingot-ask-options'>
            {options.map(option => <button type='button' key={option} className='ingot-ask-option' onClick={() => onAnswer(option)}>{option}</button>)}
        </span>}
        <span className='ingot-ask-row'>
            <input id='ingot-ask-input' className='ingot-input' aria-label='Your answer' placeholder={options?.length ? 'Or type an answer' : 'Type your answer'}
                value={text} onChange={event => setText(event.target.value)} onKeyDown={event => event.stopPropagation()} />
            <button type='submit' id='ingot-ask-submit' className='ingot-btn-primary' disabled={!text.trim()}>Send</button>
        </span>
    </form>;
};
