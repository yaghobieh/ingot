/** How big the current agent run is, measured from the chat. */
export interface RunWeight {
    /** The agent is still working (thinking, editing, paused at a checkpoint or waiting on an approval). */
    readonly active: boolean;
    readonly planSteps: number;
    /** Distinct files the run touched or the prompt attached. */
    readonly files: number;
    readonly toolSteps: number;
    /** Numbered or bulleted steps in the prompt. */
    readonly promptSteps: number;
    readonly runningMs: number;
}

/** Everything the title bar T-rex depends on. */
export interface RexHandoffGate {
    /** Settings › AI & Zaprex › Show the Zaprex button. */
    readonly enabled: boolean;
    /** PRO+ account (admins count). */
    readonly proPlus: boolean;
    /** The plan includes Rex. */
    readonly canRex: boolean;
    readonly heavy: boolean;
}
