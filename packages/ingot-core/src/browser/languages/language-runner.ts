import { inject, injectable } from '@theia/core/shared/inversify';
import { OutputChannelManager, OutputChannelSeverity } from '@theia/output/lib/browser/output-channel';
import { RUN_OUTPUT_CHANNEL, RUN_OUTPUT_MAX_CHARS, RUN_POLL_MS } from '../../common/languages/languages.consts';
import { ProcessService, type ProcessInfo } from '../../common/processes/processes.types';
import { runTranscriptDelta } from '../../common/languages/languages.utils';

export interface RunRequest {
    readonly cwd: string;
    readonly command: string;
    readonly env?: Readonly<Record<string, string>>;
}

/** IDEA-313: runs a file or a build and streams it into the Run output channel (Run tool window). */
@injectable()
export class LanguageRunner {

    @inject(ProcessService) protected readonly processes: ProcessService;
    @inject(OutputChannelManager) protected readonly outputs: OutputChannelManager;

    protected current?: string;

    async run(request: RunRequest): Promise<ProcessInfo | undefined> {
        if (this.current) {
            await this.processes.stop(this.current).catch(() => false);
        }
        const channel = this.outputs.getChannel(RUN_OUTPUT_CHANNEL);
        channel.clear();
        channel.appendLine(`$ ${request.command}`, OutputChannelSeverity.Info);
        channel.show({ preserveFocus: true });
        const info = await this.processes.start({ cwd: request.cwd, command: request.command, origin: 'user', background: true, ...(request.env ? { env: request.env } : {}) });
        this.current = info.id;
        let shown = '';
        let last: ProcessInfo | undefined = info;
        while (last?.status === 'running' && this.current === info.id) {
            await new Promise(resolve => setTimeout(resolve, RUN_POLL_MS));
            shown = await this.flush(info.id, shown);
            last = (await this.processes.list()).find(p => p.id === info.id);
        }
        if (this.current !== info.id) {
            return last;
        }
        await this.flush(info.id, shown);
        this.current = undefined;
        const code = last?.exitCode ?? (last?.status === 'exited' ? 0 : 1);
        channel.appendLine(`\nProcess finished with exit code ${code}`, code === 0 ? OutputChannelSeverity.Info : OutputChannelSeverity.Error);
        return last;
    }

    protected async flush(id: string, shown: string): Promise<string> {
        const output = await this.processes.output(id, RUN_OUTPUT_MAX_CHARS);
        if (!output) {
            return shown;
        }
        const delta = runTranscriptDelta(shown, output.text);
        if (delta) {
            this.outputs.getChannel(RUN_OUTPUT_CHANNEL).append(delta);
        }
        return output.text;
    }
}
