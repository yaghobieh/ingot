import * as React from '@theia/core/shared/react';
import type { ProjectRule } from '../../common/project-config/project-config.types';
import { ruleKindLabel } from '../../common/project-config/project-config.utils';

/** IDEA-287: a rule in the composer's @ menu; picking it attaches the rule's body as a chip. */
export const RuleMentionItem = ({ rule, selected, onPick }: { rule: ProjectRule; selected: boolean; onPick: () => void }): React.ReactElement =>
    <div data-rule={rule.name} role='option' aria-selected={selected} title={rule.description ?? rule.path}
        className={`ingot-slash-item ingot-mention-item ingot-mention-rule${selected ? ' selected' : ''}`}
        onMouseDown={e => { e.preventDefault(); onPick(); }}>
        <span className='codicon codicon-law' aria-hidden='true' />
        <span className='ingot-mention-name'>{rule.name}</span>
        <span className='ingot-slash-desc'>{ruleKindLabel(rule)}</span>
    </div>;
