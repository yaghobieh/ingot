/** IDEA-292: a project command or skill pinned into the system prompt of one chat ("Use as mode"). */
export interface CustomMode {
    readonly name: string;
    readonly kind: 'command' | 'skill';
    readonly description?: string;
    /** The instructions when the mode was picked; used if the file is gone later. */
    readonly body: string;
}
