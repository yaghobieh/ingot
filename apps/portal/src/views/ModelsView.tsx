'use client';

import { Badge, Button, Switch } from '@forgedevstack/bear';
import { DEFAULT_MODEL_ID, MODELS } from '@/constants/models.consts';
import { api } from '@/client/api';
import { useApi } from '@/client/useApi';
import type { SyncedSettings } from '@/types/domain.types';
import { PageHeader } from '@components/PageHeader';
import { usePortal } from '@components/Providers';

const ENABLED_KEY = 'models.enabled';
const DEFAULT_KEY = 'models.default';

export function ModelsView() {
    const { t } = usePortal();
    const { data, setData } = useApi<SyncedSettings>('/api/settings');
    const enabled = Array.isArray(data?.data[ENABLED_KEY]) ? data.data[ENABLED_KEY] as string[] : MODELS.filter(m => m.defaultEnabled).map(m => m.id);
    const defaultModel = typeof data?.data[DEFAULT_KEY] === 'string' ? data.data[DEFAULT_KEY] as string : DEFAULT_MODEL_ID;

    const save = async (patch: Record<string, unknown>) => {
        setData(await api<SyncedSettings>('/api/settings', { method: 'PUT', body: { data: patch } }));
    };

    const toggle = (id: string, on: boolean) => save({ [ENABLED_KEY]: on ? [...new Set([...enabled, id])] : enabled.filter(item => item !== id) });

    return (
        <div className="stack">
            <PageHeader title={t('models.title')} subtitle={t('models.subtitle')} />
            {(['chat', 'autocomplete'] as const).map(kind => (
                <div className="panel" key={kind} data-testid={`models-${kind}`}>
                    <div className="panel-head"><h2>{t(`models.${kind}`)}</h2></div>
                    {MODELS.filter(model => model.kind === kind).map(model => (
                        <div className="model-row" key={model.id} data-testid={`model-${model.id}`}>
                            <b>{model.label}</b>
                            <code className="muted">{model.id}</code>
                            {defaultModel === model.id ? <Badge variant="primary" pill testId={`default-${model.id}`}>{t('models.default')}</Badge> : null}
                            <span className="spacer" />
                            {kind === 'chat' && defaultModel !== model.id && enabled.includes(model.id) ? (
                                <Button variant="ghost" size="sm" onClick={() => save({ [DEFAULT_KEY]: model.id })} testId={`make-default-${model.id}`}>{t('models.makeDefault')}</Button>
                            ) : null}
                            <Switch checked={enabled.includes(model.id)} onCheckedChange={on => void toggle(model.id, on)} aria-label={`${t('models.enabled')} ${model.label}`} testId={`toggle-${model.id}`} />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
