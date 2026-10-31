import type { TaskType } from './router.types';

export const ROUTER_PREFS = { enabled: 'ingot.agent.router.enabled' } as const;
export const ROUTER_TOGGLE_COMMAND = { id: 'ingot.agent.router.toggle', label: 'Toggle Autopilot Model Router', category: 'Agents' } as const;

/** First match wins, so narrow kinds (rename, format) come before broad ones (feature). */
export const TASK_PATTERNS: readonly { readonly type: TaskType; readonly test: RegExp }[] = [
    { type: 'rename', test: /\b(rename|renaming)\b/i },
    { type: 'format', test: /\b(format|reformat|lint|prettier|typo|spelling|indent(ation)?|whitespace|sort (the )?imports)\b/i },
    { type: 'docs', test: /\b(docs?|documentation|readme|jsdoc|docstring|comment(s)?|changelog)\b/i },
    { type: 'test', test: /\b(unit tests?|tests?|spec|coverage|e2e)\b/i },
    { type: 'bugfix', test: /\b(fix|bug|broken|crash(es)?|fails?|failing|error|exception|regression|doesn'?t work|not working)\b/i },
    { type: 'refactor', test: /\b(refactor|restructure|clean ?up|extract|split|simplify|dedupe|migrate)\b/i },
    { type: 'feature', test: /\b(add|implement|build|create|support|introduce|new (page|screen|endpoint|component|feature))\b/i },
    { type: 'explain', test: /\b(explain|what does|how does|walk me through|describe|summari[sz]e|overview)\b/i },
    { type: 'question', test: /^(what|why|how|where|when|which|who|is|are|can|does|do|should)\b|\?\s*$/i }
];

/** Task types a cheaper model handles well when the prompt is short. */
export const SIMPLE_TASK_TYPES: ReadonlySet<TaskType> = new Set<TaskType>(['question', 'explain', 'docs', 'rename', 'format']);
/** Longer prompts or more attached files than this are complex whatever the type. */
export const SIMPLE_MAX_WORDS = 40;
export const SIMPLE_MAX_FILES = 2;
/** Modes whose steps stay on the chosen model. */
export const COMPLEX_MODES: ReadonlySet<string> = new Set(['plan', 'multi', 'debug']);
/** A target must cost at most this share of the current model per token. */
export const CHEAPER_RATIO = 0.8;
/** Room left in the target's context window over the step's estimated tokens. */
export const CONTEXT_HEADROOM = 1.2;

export const TASK_TYPE_LABELS: Readonly<Record<TaskType, string>> = {
    question: 'question', explain: 'explain', docs: 'docs', rename: 'rename', format: 'format',
    test: 'test', bugfix: 'bug fix', refactor: 'refactor', feature: 'feature', general: 'general'
};

/**
 * Chinese-origin model families the router must never pick (IDEA-307). Matched against the id, label, provider-side
 * name and any override, so a renamed or proxied model is still caught.
 */
export const CHINESE_ORIGIN_PATTERNS: readonly RegExp[] = [
    /deep-?seek/i, /\bqwen|qwq|qvq|tongyi|dashscope/i, /\bkimi\b|moonshot/i, /\bglm\b|glm-?\d|chatglm|zhipu|bigmodel|codegeex/i,
    /minimax|\babab\d/i, /baichuan/i, /(^|[^a-z])yi[-_ .:]?(\d|large|lightning|medium|spark|vision|coder)|01-?ai|lingyiwanwu/i,
    /\bernie\b|wenxin|qianfan|baidu/i, /hunyuan|tencent/i, /doubao|skylark|bytedance|volcengine|\bseed-?(oss|coder|\d)/i,
    /internlm|intern-?s1|shanghai ai lab/i, /stepfun|\bstep-?\d/i, /sensenova|sensechat|sensetime/i, /iflytek|xinghuo|\bspark-?(desk|v\d|max|pro|lite)/i,
    /telechat|pangu|xverse|aquila|\bbaai\b|skywork|kunlun|mimo|xiaomi|longcat|meituan|ling-?(lite|plus|\d)|inclusionai|ant-?group|alibaba/i
];
/** Providers that are themselves Chinese model vendors. */
export const CHINESE_ORIGIN_PROVIDERS: ReadonlySet<string> = new Set(['deepseek', 'moonshot', 'zhipu', 'qwen', 'minimax', 'baichuan', 'dashscope']);
/** Models whose upstream is picked elsewhere (any model, Chinese ones included): never a router target. */
export const UNKNOWN_UPSTREAM_PATTERNS: readonly RegExp[] = [/openrouter\/auto/i, /^openrouter-auto$/i, /(^|[/:-])auto$/i];
