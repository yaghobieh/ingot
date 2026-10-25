import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { IngotGroupService } from './ingot-group-service';
import { GROUP_COMMANDS, PROJECT_TABS_ID } from '../../common/groups/groups.consts';
import { projectInitials } from '../../common/welcome/welcome.utils';

/** WebStorm-like project tabs under the main toolbar, visible while a project group is open (IDEA-52). */
@injectable()
export class IngotProjectTabsWidget extends ReactWidget {

    @inject(IngotGroupService) protected readonly groups: IngotGroupService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    @postConstruct()
    protected init(): void {
        this.id = PROJECT_TABS_ID;
        this.addClass('ingot-project-tabs');
        this.toDispose.push(this.groups.onDidChange(() => this.sync()));
        this.sync();
    }

    protected sync(): void {
        const group = this.groups.isGroup;
        this.setHidden(!group);
        // The top panel grows by one row for the tabs; Lumino re-reads its min-height on fit().
        document.body.classList.toggle('ingot-has-group', group);
        this.parent?.fit();
        this.parent?.parent?.fit();
        this.update();
    }

    protected render(): React.ReactNode {
        const active = this.groups.active?.uri;
        const projects = this.groups.projects;
        return <div className='ingot-project-tabs-row' role='tablist' aria-label='Projects in group'>
            {projects.map(p => (
                <div key={p.uri} id={`ingot-project-tab-${p.name}`} role='tab' aria-selected={p.uri === active} tabIndex={0}
                    className={`ingot-project-tab ${p.uri === active ? 'active' : ''}`} title={p.uri}
                    onClick={() => this.groups.switchTo(p.uri)} onKeyDown={e => e.key === 'Enter' && this.groups.switchTo(p.uri)}>
                    <span className='ingot-project-tab-initials'>{projectInitials(p.name)}</span>
                    <span className='ingot-project-tab-name'>{p.name}</span>
                    {projects.length > 1 && <button type='button' className='ingot-project-tab-close' title={`Remove ${p.name} from group`} aria-label={`Remove ${p.name} from group`}
                        onClick={e => { e.stopPropagation(); this.groups.removeProject(p.uri); }}>×</button>}
                </div>
            ))}
            <button type='button' id='ingot-project-tabs-add' className='ingot-project-tabs-add' title={GROUP_COMMANDS.addProject.label}
                onClick={() => this.commands.executeCommand(GROUP_COMMANDS.addProject.id)}>+</button>
        </div>;
    }
}
