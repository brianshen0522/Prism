import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../store/auth';

export interface WSMessage {
  type: string;
  channel?: string;
  payload?: unknown;
  ts: number;
}

interface UseWebSocketOptions {
  channels: string[];
  onMessage: (msg: WSMessage) => void;
  enabled?: boolean;
}

const RECONNECT_DELAY_MS = 3000;

export function useWebSocket({ channels, onMessage, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const channelsRef = useRef(channels);
  const onMessageRef = useRef(onMessage);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  channelsRef.current = channels;
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token || !mountedRef.current) return;

    const ws = new WebSocket(`${import.meta.env.BASE_URL}ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Subscribe to all requested channels
      for (const ch of channelsRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe', channel: ch }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg: WSMessage = JSON.parse(ev.data as string);
        onMessageRef.current(msg);
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      retryRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    connect();

    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [enabled, connect]);
}
