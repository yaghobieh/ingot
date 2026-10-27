import type { HandoffStatus, HarmonyHandoff, ZaprexDesktopInfo } from './handoff';

export const ZAPREX_DESKTOP_PATH = '/services/ingot-zaprex-desktop';
export const ZaprexDesktopService = Symbol('ZaprexDesktopService');

/** IDEA-185: backend side of the Zaprex desktop handoff (detects the app, opens deep links, serves pieces on loopback). */
export interface ZaprexDesktopService {
    detect(): Promise<ZaprexDesktopInfo>;
    /** Opens a `zaprex://` link or the web fallback with the OS handler. */
    open(url: string): Promise<void>;
    /** Puts a piece on the loopback endpoint and returns its deep link (the token is in the link only). */
    startHandoff(handoff: Omit<HarmonyHandoff, 'v' | 'id' | 'source' | 'createdAt'>): Promise<{ id: string; link: string }>;
    status(id: string): Promise<HandoffStatus | undefined>;
    cancel(id: string): Promise<void>;
}
