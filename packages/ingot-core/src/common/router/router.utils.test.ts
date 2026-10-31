import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG } from '../models/models.consts';
import type { CatalogModel } from '../models/models.types';
import { toCatalogModel } from '../account/gateway.utils';
import { blendedPrice, priceOf } from '../cost/cost.utils';
import { classifyTask, hasUnknownUpstream, isChineseOriginModel, isRouterSafe, pickRoute, profileTask } from './router.utils';
import type { RouteRequest, TaskProfile } from './router.types';

const SIMPLE: TaskProfile = { type: 'explain', complexity: 'simple' };
const model = (id: string, label: string, provider: CatalogModel['provider'], name: string, cost: CatalogModel['cost'] = '$'): CatalogModel =>
    ({ id, label, provider, model: name, speed: 'fast', cost, contextWindow: 128_000, thinking: false, recommended: false });
const byId = (id: string): CatalogModel => MODEL_CATALOG.find(m => m.id === id)!;
const request = (current: CatalogModel, candidates: readonly CatalogModel[], extra: Partial<RouteRequest<CatalogModel>> = {}): RouteRequest<CatalogModel> => ({
    current, candidates, profile: SIMPLE, tokens: 4_000, priceOf: m => blendedPrice(priceOf(m)), configured: () => true, ...extra
});

/** Every Chinese-origin family the router must refuse, as catalog, gateway, OpenRouter-style and local names. */
const CHINESE: readonly CatalogModel[] = [
    model('deepseek-v3', 'DeepSeek V3', 'deepseek', 'deepseek-chat'),
    model('ds-r1', 'Reasoner', 'openrouter', 'deepseek/deepseek-r1'),
    model('ollama-local', 'Qwen2.5 Coder (local)', 'ollama', 'qwen2.5-coder', 'free'),
    model('ingot:qwen3-coder', 'Coder', 'ingot', 'qwen3-coder'),
    model('or-qwq', 'QwQ', 'openrouter', 'qwen/qwq-32b'),
    model('ingot:kimi-k2', 'Kimi K2', 'ingot', 'kimi-k2'),
    model('or-moonshot', 'Moonshot v1', 'openrouter', 'moonshotai/moonshot-v1-8k'),
    model('ingot:glm-4.5', 'GLM 4.5', 'ingot', 'glm-4.5'),
    model('or-chatglm', 'ChatGLM', 'openrouter', 'thudm/chatglm3-6b'),
    model('or-zhipu', 'Zhipu', 'openrouter', 'zhipuai/glm4'),
    model('ingot:minimax-m1', 'MiniMax M1', 'ingot', 'minimax-m1'),
    model('or-abab', 'abab', 'openrouter', 'minimax/abab6.5s'),
    model('ingot:baichuan4', 'Baichuan 4', 'ingot', 'baichuan4'),
    model('ingot:yi-lightning', 'Yi Lightning', 'ingot', 'yi-lightning'),
    model('or-yi', 'Yi 34B', 'openrouter', '01-ai/yi-34b-chat'),
    model('ingot:ernie-4', 'ERNIE 4', 'ingot', 'ernie-4.0'),
    model('ingot:hunyuan', 'Hunyuan', 'ingot', 'hunyuan-turbo'),
    model('ingot:doubao', 'Doubao Pro', 'ingot', 'doubao-pro-32k'),
    model('ingot:internlm', 'InternLM', 'ingot', 'internlm2_5-7b'),
    model('ingot:step-2', 'Step 2', 'ingot', 'step-2-16k')
];

describe('IDEA-307 task profile', () => {
    it('classifies prompts by kind', () => {
        expect(classifyTask('explain what the cart module does')).toBe('explain');
        expect(classifyTask('rename getUser to fetchUser')).toBe('rename');
        expect(classifyTask('fix the crash in checkout')).toBe('bugfix');
        expect(classifyTask('add a settings page with dark mode')).toBe('feature');
        expect(classifyTask('refactor the payments service')).toBe('refactor');
        expect(classifyTask('update the README')).toBe('docs');
        expect(classifyTask('where is the router defined?')).toBe('question');
        expect(classifyTask('hello there')).toBe('general');
    });

    it('only short prompts of a simple kind, outside Plan / Multi / Debug, are simple steps', () => {
        expect(profileTask('explain what the cart module does', { mode: 'agent', files: 0 })).toEqual({ type: 'explain', complexity: 'simple' });
        expect(profileTask('explain what the cart module does', { mode: 'plan', files: 0 }).complexity).toBe('complex');
        expect(profileTask('explain these', { mode: 'agent', files: 3 }).complexity).toBe('complex');
        expect(profileTask('fix the crash in checkout', { mode: 'agent', files: 0 }).complexity).toBe('complex');
        expect(profileTask(`explain ${'word '.repeat(60)}`, { mode: 'agent', files: 0 }).complexity).toBe('complex');
    });
});

describe('IDEA-307 router never picks Chinese-origin models', () => {
    it('flags every Chinese-origin family (DeepSeek, Qwen, Kimi/Moonshot, GLM/Zhipu, MiniMax, Baichuan, Yi and more)', () => {
        for (const m of CHINESE) {
            expect(isChineseOriginModel(m), m.id).toBe(true);
            expect(isRouterSafe(m), m.id).toBe(false);
        }
        expect(isChineseOriginModel(byId('deepseek-v3'))).toBe(true);
        expect(isChineseOriginModel(byId('ollama-local'))).toBe(true);
    });

    it('does not flag the other catalog models or Ingot gateway models', () => {
        for (const id of ['claude-sonnet-4-5', 'claude-opus-4-1', 'gpt-5', 'gpt-5-mini', 'gemini-2-5-pro']) {
            expect(isChineseOriginModel(byId(id)), id).toBe(false);
        }
        for (const name of ['ingot-fast', 'ingot-mock', 'ingot-reasoning']) {
            expect(isRouterSafe(toCatalogModel({ id: name, label: name, contextWindow: 128_000 })), name).toBe(true);
        }
    });

    it('catches a Chinese model hidden behind a provider-side name override', () => {
        const llama = model('ollama-llama', 'Llama (local)', 'ollama', 'llama3.2', 'free');
        expect(isChineseOriginModel(llama)).toBe(false);
        expect(isChineseOriginModel(llama, 'qwen2.5-coder:7b')).toBe(true);
        const sonnet = byId('claude-sonnet-4-5');
        expect(pickRoute(request(sonnet, [llama], { overrideOf: () => 'deepseek-coder' }))).toBeUndefined();
    });

    it('never routes to OpenRouter auto or Auto (their upstream may be Chinese)', () => {
        expect(hasUnknownUpstream(byId('openrouter-auto'))).toBe(true);
        expect(hasUnknownUpstream({ id: 'auto', model: 'auto' })).toBe(true);
        const cheapAuto = { ...byId('openrouter-auto'), cost: 'free' as const };
        expect(pickRoute(request(byId('claude-opus-4-1'), [cheapAuto], { priceOf: m => m.id === 'openrouter-auto' ? 0 : 50 }))).toBeUndefined();
    });

    it('skips Chinese-origin models even when they are the cheapest and the learned choice', () => {
        const opus = byId('claude-opus-4-1');
        const candidates = [...CHINESE, byId('gpt-5-mini'), byId('claude-sonnet-4-5')];
        const decision = pickRoute(request(opus, candidates, { learned: 'deepseek-v3' }));
        expect(decision?.to).toBe('gpt-5-mini');
        expect(decision?.learned).toBe(false);
        for (const m of CHINESE) {
            expect(pickRoute(request(opus, [m]))).toBeUndefined();
        }
    });

    it('over the whole catalog, from every model, the target is never Chinese-origin', () => {
        const pool = [...MODEL_CATALOG, ...CHINESE];
        for (const current of MODEL_CATALOG) {
            const decision = pickRoute(request(current, pool));
            if (decision) {
                const target = pool.find(m => m.id === decision.to)!;
                expect(isChineseOriginModel(target), `${current.id} -> ${decision.to}`).toBe(false);
                expect(hasUnknownUpstream(target)).toBe(false);
            }
        }
    });
});

describe('IDEA-307 pickRoute', () => {
    const fast = toCatalogModel({ id: 'ingot-fast', label: 'Ingot Fast', contextWindow: 128_000 });
    const mock = toCatalogModel({ id: 'ingot-mock', label: 'Ingot Mock', contextWindow: 32_000 });

    it('sends a simple step to the cheapest safe, connected model that fits', () => {
        const decision = pickRoute(request(mock, [mock, fast]));
        expect(decision).toMatchObject({ from: 'ingot:ingot-mock', to: 'ingot:ingot-fast', taskType: 'explain', learned: false });
        expect(decision!.saving).toBeGreaterThan(0.5);
    });

    it('keeps complex steps, unconnected targets and targets too small for the step on the current model', () => {
        expect(pickRoute(request(mock, [fast], { profile: { type: 'feature', complexity: 'complex' } }))).toBeUndefined();
        expect(pickRoute(request(mock, [fast], { configured: id => id !== fast.id }))).toBeUndefined();
        expect(pickRoute(request(mock, [fast], { tokens: 200_000 }))).toBeUndefined();
        expect(pickRoute(request(fast, [mock]))).toBeUndefined();
    });

    it('prefers the model the user accepted for this task type', () => {
        const mini = byId('gpt-5-mini');
        const decision = pickRoute(request(byId('claude-opus-4-1'), [fast, mini], { learned: 'gpt-5-mini' }));
        expect(decision).toMatchObject({ to: 'gpt-5-mini', learned: true });
    });
});
