import * as React from '@theia/core/shared/react';
import { createRoot } from '@theia/core/shared/react-dom/client';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { OpenerService, open, type Breadcrumb } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { OutlineBreadcrumb, OutlineBreadcrumbsContribution } from '@theia/outline-view/lib/browser/outline-breadcrumbs-contribution';
import type { OutlineSymbolInformationNode } from '@theia/outline-view/lib/browser/outline-view-widget';
import { filterOutline, pathTo, visibleRows, type OutlineItem } from '../../common/breadcrumbs/breadcrumbs.utils';

interface SymbolItem extends OutlineItem {
    readonly icon: string;
    readonly node: OutlineSymbolInformationNode;
    readonly children: readonly SymbolItem[];
}

interface TreeProps {
    readonly items: readonly SymbolItem[];
    readonly current?: string;
    readonly onOpen: (item: SymbolItem) => void;
}

const contains = (r: { start: { line: number; character: number }; end: { line: number; character: number } }, p: { line: number; character: number }): boolean =>
    (p.line > r.start.line || (p.line === r.start.line && p.character >= r.start.character)) && (p.line < r.end.line || (p.line === r.end.line && p.character <= r.end.character));

interface TreeState { query: string; expanded: Set<string>; active: number }

/** Whole-file outline tree in the breadcrumb popup: expandable, kind icons, current symbol highlighted, type to filter, Enter navigates. */
export class OutlineTreePopup extends React.Component<TreeProps, TreeState> {
    protected list: HTMLDivElement | null = null;

    constructor(props: TreeProps) {
        super(props);
        const path = props.current ? pathTo(props.items, props.current) : [];
        const expanded = new Set(path.slice(0, -1));
        const rows = visibleRows(props.items, expanded);
        this.state = { query: '', expanded, active: Math.max(0, rows.findIndex(r => r.item.id === props.current)) };
    }

    override componentDidMount(): void { this.reveal(); }
    override componentDidUpdate(): void { this.reveal(); }

    protected reveal(): void {
        this.list?.querySelector('.ingot-bc-row.active')?.scrollIntoView({ block: 'nearest' });
    }

    protected get rows(): { item: SymbolItem; depth: number }[] {
        return visibleRows(this.props.items, this.state.expanded, filterOutline(this.props.items, this.state.query));
    }

    protected toggle(id: string, open?: boolean): void {
        const expanded = new Set(this.state.expanded);
        if (open ?? !expanded.has(id)) { expanded.add(id); } else { expanded.delete(id); }
        this.setState({ expanded });
    }

    protected onKeyDown(e: React.KeyboardEvent): void {
        const rows = this.rows;
        const row = rows[this.state.active];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            this.setState({ active: Math.min(rows.length - 1, Math.max(0, this.state.active + (e.key === 'ArrowDown' ? 1 : -1))) });
        } else if (e.key === 'ArrowRight' && row?.item.children.length && !this.state.query) {
            e.preventDefault();
            this.toggle(row.item.id, true);
        } else if (e.key === 'ArrowLeft' && row && !this.state.query) {
            e.preventDefault();
            this.toggle(row.item.id, false);
        } else if (e.key === 'Enter' && row) {
            e.preventDefault();
            this.props.onOpen(row.item);
        }
    }

    override render(): React.ReactNode {
        const rows = this.rows;
        return <div className='ingot-bc-outline' onKeyDown={e => this.onKeyDown(e)}>
            <input className='ingot-input ingot-bc-filter' id='ingot-bc-filter' autoFocus placeholder='Filter symbols' value={this.state.query} aria-label='Filter symbols'
                onChange={e => this.setState({ query: e.currentTarget.value, active: 0 })} />
            <div className='ingot-bc-tree' role='tree' ref={el => { this.list = el; }}>
                {rows.length === 0 && <div className='ingot-bc-empty'>No symbols match.</div>}
                {rows.map(({ item, depth }, i) => {
                    const open = !!this.state.query || this.state.expanded.has(item.id);
                    return <div key={item.id} role='treeitem' aria-expanded={item.children.length ? open : undefined} data-id={item.id}
                        className={`ingot-bc-row${i === this.state.active ? ' active' : ''}${item.id === this.props.current ? ' current' : ''}`}
                        style={{ paddingLeft: 6 + depth * 14 }} onMouseEnter={() => this.setState({ active: i })}
                        onMouseDown={e => e.preventDefault()} onClick={() => this.props.onOpen(item)}>
                        <span className={`ingot-bc-twisty codicon ${item.children.length ? (open ? 'codicon-chevron-down' : 'codicon-chevron-right') : ''}`}
                            onClick={e => { if (item.children.length) { e.stopPropagation(); this.toggle(item.id); } }} />
                        <span className={`codicon codicon-symbol-${item.icon} ingot-bc-kind`} />
                        <span className='ingot-bc-row-label'>{item.name}</span>
                    </div>;
                })}
            </div>
        </div>;
    }
}

/** Symbol segments follow the caret; clicking one opens the whole outline as a tree (IDEA-76). */
@injectable()
export class IngotOutlineBreadcrumbs extends OutlineBreadcrumbsContribution {

    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    protected caretListener?: Disposable;

    @postConstruct()
    override init(): void {
        super.init();
        this.followCaret();
    }

    protected followCaret(): void {
        const listen = (): void => {
            this.caretListener?.dispose();
            const editor = this.editors.currentEditor?.editor;
            this.caretListener = editor?.onCursorPositionChanged(() => this.refreshFromCaret());
        };
        this.editors.onCurrentEditorChanged(listen);
        listen();
    }

    protected refreshFromCaret(): void {
        const first = this.roots[0] as (OutlineSymbolInformationNode & { uri?: URI }) | undefined;
        if (first?.uri) {
            this.updateOutlineItems(first.uri, this.findSelectedNode(this.roots));
        }
    }

    /** Theia stops at the first collapsed symbol; the bar shows the full chain down to the innermost symbol at the caret (e.g. `add › forEach() callback`). */
    protected override updateOutlineItems(uri: URI, selectedNode: OutlineSymbolInformationNode | undefined): Promise<void> {
        const editor = this.editors.currentEditor?.editor;
        const caret = editor && editor.uri.toString() === uri.toString() ? editor.cursor : undefined;
        return super.updateOutlineItems(uri, caret ? this.innermost(this.roots, caret) ?? selectedNode : selectedNode);
    }

    protected innermost(nodes: readonly OutlineSymbolInformationNode[], caret: { line: number; character: number }): OutlineSymbolInformationNode | undefined {
        for (const node of nodes) {
            const range = (node as OutlineSymbolInformationNode & { fullRange?: { start: { line: number; character: number }; end: { line: number; character: number } } }).fullRange;
            if (range && contains(range, caret)) {
                const children = (node.children ?? []).filter((c): c is OutlineSymbolInformationNode => 'iconClass' in c);
                return this.innermost(children, caret) ?? node;
            }
        }
        return undefined;
    }

    protected toItems(nodes: readonly OutlineSymbolInformationNode[]): SymbolItem[] {
        return nodes.map(node => ({
            id: node.id, name: this.labelProvider.getName(node), icon: node.iconClass, node,
            children: this.toItems((node.children ?? []).filter((c): c is OutlineSymbolInformationNode => 'iconClass' in c))
        }));
    }

    override async attachPopupContent(breadcrumb: Breadcrumb, parent: HTMLElement): Promise<Disposable | undefined> {
        if (!OutlineBreadcrumb.is(breadcrumb) || !this.roots.length) {
            return undefined;
        }
        const current = Array.isArray(breadcrumb.node) ? undefined : breadcrumb.node.id;
        const host = document.createElement('div');
        parent.appendChild(host);
        const root = createRoot(host);
        const onOpen = (item: SymbolItem): void => {
            const node = item.node as OutlineSymbolInformationNode & { uri?: URI; range?: unknown };
            if (node.uri && node.range) {
                open(this.opener, node.uri, { selection: node.range });
            }
        };
        root.render(<OutlineTreePopup items={this.toItems(this.roots)} current={current} onOpen={onOpen} />);
        return Disposable.create(() => { root.unmount(); host.remove(); });
    }
}
