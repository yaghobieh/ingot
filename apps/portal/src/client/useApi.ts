'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorCode } from '@/client/api';

/** Loads a GET endpoint and exposes reload(); used by every dashboard page. */
export function useApi<T>(path: string) {
    const [data, setData] = useState<T | undefined>();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const latest = useRef(0);

    const reload = useCallback(async () => {
        const requestId = ++latest.current;
        setLoading(true);
        try {
            const result = await api<T>(path);
            if (requestId !== latest.current) { return; }
            setData(result);
            setError('');
        } catch (err) {
            if (requestId === latest.current) { setError(errorCode(err)); }
        } finally {
            if (requestId === latest.current) { setLoading(false); }
        }
    }, [path]);

    useEffect(() => { void reload(); }, [reload]);

    return { data, error, loading, reload, setData };
}
