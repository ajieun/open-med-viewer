export type EventHandler<T = any> = (data: T) => void;

export class EventEmitter<TEvents extends Record<string, any>> {
  private listeners: Map<keyof TEvents, Set<EventHandler>> = new Map();

  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  once<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
    const wrapped = (data: TEvents[K]) => {
      this.off(event, wrapped);
      handler(data);
    };
    return this.on(event, wrapped);
  }

  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  emit<K extends keyof TEvents>(event: K, data?: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((handler) => {
        try {
          handler(data!);
        } catch (err) {
          console.error(`Error in event handler for "${String(event)}":`, err);
        }
      });
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
