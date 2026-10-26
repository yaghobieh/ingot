/** IDEA-143: the provider photo cached on this device (data URL, never a token). */
export interface AvatarCache {
    readonly url: string;
    readonly dataUrl: string;
    readonly savedAt: number;
}
