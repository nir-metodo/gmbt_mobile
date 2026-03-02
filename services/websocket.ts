import { WS_BASE_URL } from '../constants/api';
import { secureStorage } from './storage';

type EventHandler = (data: any) => void;

class WebSocketService {
  private static instances: Map<string, WebSocketService> = new Map();
  private static maxReconnectAttempts = 5;
  private static reconnectDelayBase = 3000;

  private organization: string;
  private chatId: string | null;
  private type: string;
  private key: string;
  private eventHandlers: Map<string, EventHandler> = new Map();
  private websocket: WebSocket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private isClosedManually = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  private constructor(organization: string, chatId: string | null = null, type = 'message') {
    this.organization = organization;
    this.chatId = chatId;
    this.type = type;
    this.key = `${organization}_${chatId || 'none'}_${type}`;

    WebSocketService.instances.set(this.key, this);
    this.initWebSocket();
  }

  static getInstance(organization: string, chatId: string | null = null, type = 'message'): WebSocketService {
    const key = `${organization}_${chatId || 'none'}_${type}`;
    const existing = WebSocketService.instances.get(key);
    if (existing?.websocket?.readyState === WebSocket.OPEN ||
        existing?.websocket?.readyState === WebSocket.CONNECTING) {
      return existing;
    }
    if (existing) {
      existing.close();
    }
    return new WebSocketService(organization, chatId, type);
  }

  static closeAll() {
    WebSocketService.instances.forEach((instance) => instance.close());
    WebSocketService.instances.clear();
  }

  static closeByOrganization(orgId: string) {
    WebSocketService.instances.forEach((instance, key) => {
      if (instance.organization === orgId) {
        instance.close();
        WebSocketService.instances.delete(key);
      }
    });
  }

  private async initWebSocket() {
    const token = await secureStorage.getToken();
    if (!token) return;

    const params = new URLSearchParams({
      organization: this.organization,
      listenerType: this.type,
      token,
    });

    if (this.chatId && this.type !== 'contacts') {
      params.set('chatId', this.chatId);
    }

    const url = `${WS_BASE_URL}?${params.toString()}`;
    this.websocket = new WebSocket(url);

    this.websocket.onopen = () => {
      this.reconnectAttempts = 0;
      this.startPing();
      this.eventHandlers.get('open')?.({ type: 'open' });
    };

    this.websocket.onmessage = (event) => {
      if (event.data === '__pong__') {
        this.resetHeartbeat();
        return;
      }

      try {
        const parsed = JSON.parse(event.data);
        const type = parsed?.type;

        if (type === 'error') {
          this.eventHandlers.get('error')?.({ type: 'error', ...parsed });
          return;
        }

        if (type && this.eventHandlers.has(type)) {
          this.eventHandlers.get(type)?.(parsed);
        }

        this.eventHandlers.get('any')?.({ type, data: parsed });
      } catch {
        // non-JSON messages are ignored
      }
    };

    this.websocket.onerror = () => {
      this.eventHandlers.get('error')?.({ type: 'error' });
    };

    this.websocket.onclose = (event) => {
      this.stopPing();

      if (
        !this.isClosedManually &&
        event.code !== 1008 &&
        this.reconnectAttempts < WebSocketService.maxReconnectAttempts
      ) {
        this.reconnectAttempts++;
        const delay =
          WebSocketService.reconnectDelayBase * Math.pow(2, this.reconnectAttempts - 1);
        this.reconnectTimeout = setTimeout(() => {
          if (!this.isClosedManually) {
            this.initWebSocket();
          }
        }, delay);
      } else if (this.reconnectAttempts >= WebSocketService.maxReconnectAttempts) {
        this.eventHandlers.get('maxReconnectReached')?.({ type: 'maxReconnectReached' });
      }
    };
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.websocket?.readyState === WebSocket.OPEN) {
        this.websocket.send('__ping__');
        this.resetHeartbeat();
      }
    }, 20000);
  }

  private resetHeartbeat() {
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimeout = setTimeout(() => {
      this.websocket?.close();
    }, 30000);
  }

  private stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
  }

  close() {
    this.isClosedManually = true;
    this.stopPing();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    try {
      this.websocket?.close();
    } catch {}
    this.websocket = null;

    WebSocketService.instances.delete(this.key);
  }

  on(type: string, handler: EventHandler) {
    this.eventHandlers.set(type, handler);
  }

  off(type: string) {
    this.eventHandlers.delete(type);
  }
}

export default WebSocketService;
