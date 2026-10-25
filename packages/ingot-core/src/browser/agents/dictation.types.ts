export type DictationState = 'idle' | 'listening' | 'transcribing';

export interface DictationHandlers {
    /** Interim text (Web Speech); replaced by each new interim result until it is final. */
    interim(text: string): void;
    /** Final text to insert at the caret. */
    final(text: string): void;
    state(state: DictationState): void;
    error(message: string): void;
}

/** Records audio and turns it into text when the Web Speech API is unavailable (desktop app). */
export type Transcriber = (audioBase64: string, mimeType: string) => Promise<string>;
