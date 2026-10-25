import type { DictationHandlers, DictationState, Transcriber } from './dictation.types';

interface SpeechResult { readonly isFinal: boolean; readonly 0: { readonly transcript: string } }
interface SpeechEvent { readonly resultIndex: number; readonly results: ArrayLike<SpeechResult> }
interface SpeechRecognitionLike {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((e: SpeechEvent) => void) | null;
    onerror: ((e: { error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

const RECORDER_MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

const isElectron = (): boolean => typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

/** Web Speech API in browsers. The desktop runtime ships it without a speech service, so it records instead. */
const speechCtor = (): SpeechCtor | undefined => {
    if (isElectron()) {
        return undefined;
    }
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const toBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

/** Composer voice dictation (IDEA-98): live Web Speech transcript, or record and transcribe on the backend. */
export class Dictation {

    protected recognition?: SpeechRecognitionLike;
    protected recorder?: MediaRecorder;
    protected current: DictationState = 'idle';

    constructor(protected readonly handlers: DictationHandlers, protected readonly transcribe: Transcriber) { }

    get state(): DictationState {
        return this.current;
    }

    toggle(): void {
        if (this.current === 'idle') {
            this.start();
        } else if (this.current === 'listening') {
            this.stop();
        }
    }

    async start(): Promise<void> {
        const Ctor = speechCtor();
        if (Ctor) {
            this.startSpeech(Ctor);
        } else {
            await this.startRecording();
        }
    }

    stop(): void {
        this.recognition?.stop();
        if (this.recorder?.state === 'recording') {
            this.recorder.stop();
        }
    }

    protected set(state: DictationState): void {
        this.current = state;
        this.handlers.state(state);
    }

    protected startSpeech(Ctor: SpeechCtor): void {
        const recognition = new Ctor();
        recognition.lang = document.documentElement.lang || navigator.language || 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = e => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const result = e.results[i];
                if (result.isFinal) {
                    this.handlers.final(result[0].transcript);
                } else {
                    interim += result[0].transcript;
                }
            }
            this.handlers.interim(interim);
        };
        recognition.onerror = e => {
            if (e.error !== 'no-speech' && e.error !== 'aborted') {
                this.handlers.error(e.error === 'not-allowed' ? 'Microphone access was denied.' : `Dictation stopped (${e.error}).`);
            }
        };
        recognition.onend = () => {
            this.recognition = undefined;
            this.handlers.interim('');
            this.set('idle');
        };
        this.recognition = recognition;
        recognition.start();
        this.set('listening');
    }

    protected async startRecording(): Promise<void> {
        let stream: MediaStream;
        try {
            // Triggers the macOS microphone prompt the first time (NSMicrophoneUsageDescription).
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            this.handlers.error('Microphone access was denied. Allow Ingot in System Settings › Privacy & Security › Microphone.');
            return;
        }
        const mimeType = RECORDER_MIME.find(m => MediaRecorder.isTypeSupported(m)) ?? '';
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const chunks: Blob[] = [];
        recorder.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); } };
        recorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            this.recorder = undefined;
            const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
            if (!blob.size) {
                this.set('idle');
                return;
            }
            this.set('transcribing');
            try {
                const text = await this.transcribe(await toBase64(blob), blob.type);
                if (text) {
                    this.handlers.final(text);
                }
            } catch (error) {
                this.handlers.error(error instanceof Error ? error.message : String(error));
            } finally {
                this.set('idle');
            }
        };
        this.recorder = recorder;
        recorder.start(250);
        this.set('listening');
    }
}
