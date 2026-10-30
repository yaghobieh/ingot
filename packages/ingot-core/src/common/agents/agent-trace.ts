import type { AgentSession } from './agents.types';
import type { AgentTrace, AgentTraceMessage } from './agent-trace.types';

const traceMessage = (message: AgentSession['messages'][number]): AgentTraceMessage => ({
    role: message.role,
    text: message.text,
    ...(message.from ? { from: message.from } : {}),
    ...(message.hidden ? { hidden: true } : {}),
    ...(message.tool ? { tool: `${message.tool.server}/${message.tool.tool}`, toolState: message.tool.state, toolArgs: JSON.stringify(message.tool.args) } : {})
});

export const agentTrace = (session: AgentSession, running: boolean): AgentTrace => ({
    id: session.id,
    title: session.title,
    status: session.status,
    running,
    model: session.model,
    plan: session.plan.map(item => ({ ...item })),
    steps: session.steps.map(step => ({ ...step })),
    messages: session.messages.map(traceMessage),
    ...(session.ask ? { ask: session.ask.question } : {}),
    ...(session.approval ? { approval: `${session.approval.label}: ${session.approval.detail}` } : {})
});
