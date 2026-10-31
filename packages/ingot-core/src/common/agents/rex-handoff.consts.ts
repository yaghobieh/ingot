import type { AgentStatus } from './agents.types';

/** The title bar T-rex's label: it only shows while a heavy run could go to Rex (Zaprex). */
export const REX_HANDOFF_LABEL = 'Hand off to Rex';
export const REX_HANDOFF_BUSY_LABEL = `${REX_HANDOFF_LABEL} · Zaprex is working on a piece (Harmony mode)`;
/** The agent is still working (a finished run waiting in `review` is no longer handed off). */
export const RUN_STATUSES: readonly AgentStatus[] = ['thinking', 'editing', 'paused', 'approval'];
/** A run counts as long-running after this long. */
export const LONG_RUN_MS = 90_000;
/** A run counts as multi-step from this many tool steps (reads, edits, runs, searches). */
export const HEAVY_TOOL_STEPS = 12;
/** Numbered or bulleted lines in the prompt: "1. …", "2) …", "- …", "* …". */
export const PROMPT_STEP_PATTERN = /^\s*(?:\d+[.)]|[-*•])\s+\S/;
