/**
 * Node.js `events` 模块的浏览器端最小实现
 *
 * 背景: 依赖链 @cornerstonejs/core -> @kitware/vtk.js -> xmlbuilder2 中使用
 * `class XMLBuilderCBImpl extends events_1.EventEmitter`。在浏览器构建中 Node 内置模块
 * `events` 会被 Vite 外部化为空对象，导致 `extends undefined` 抛
 * "Class extends value undefined is not a constructor or null"，整个页面白屏。
 *
 * 这里提供与 Node 兼容的 EventEmitter 子集，并在 vite.config.ts 中通过 alias 注入，
 * 使开发与生产产物的行为保持一致。
 */

export type Listener = (...args: any[]) => void;

export class EventEmitter {
  /** 默认最大监听数 (仅为兼容 Node API，不做实际限制) */
  static defaultMaxListeners = 10;

  private _events: Map<string | symbol, Listener[]> = new Map();
  private _maxListeners = EventEmitter.defaultMaxListeners;

  /** 注册事件监听 */
  on(event: string | symbol, listener: Listener): this {
    return this.addListener(event, listener);
  }

  addListener(event: string | symbol, listener: Listener): this {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type function');
    }
    const list = this._events.get(event);
    if (list) list.push(listener);
    else this._events.set(event, [listener]);
    return this;
  }

  /** 在监听器数组头部插入 */
  prependListener(event: string | symbol, listener: Listener): this {
    const list = this._events.get(event);
    if (list) list.unshift(listener);
    else this._events.set(event, [listener]);
    return this;
  }

  /** 只触发一次的监听 */
  once(event: string | symbol, listener: Listener): this {
    const wrapped: Listener = (...args: any[]) => {
      this.removeListener(event, wrapped);
      listener.apply(this, args);
    };
    (wrapped as any).listener = listener;
    return this.addListener(event, wrapped);
  }

  prependOnceListener(event: string | symbol, listener: Listener): this {
    const wrapped: Listener = (...args: any[]) => {
      this.removeListener(event, wrapped);
      listener.apply(this, args);
    };
    (wrapped as any).listener = listener;
    return this.prependListener(event, wrapped);
  }

  /** 移除监听 */
  off(event: string | symbol, listener: Listener): this {
    return this.removeListener(event, listener);
  }

  removeListener(event: string | symbol, listener: Listener): this {
    const list = this._events.get(event);
    if (!list) return this;

    let index = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === listener || (list[i] as any).listener === listener) {
        index = i;
        break;
      }
    }

    if (index >= 0) {
      list.splice(index, 1);
      if (list.length === 0) this._events.delete(event);
    }
    return this;
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this._events.clear();
    else this._events.delete(event);
    return this;
  }

  /** 触发事件，返回是否存在监听器 */
  emit(event: string | symbol, ...args: any[]): boolean {
    const list = this._events.get(event);
    if (!list || list.length === 0) return false;
    // 触发前拷贝，避免监听器内部修改数组影响遍历
    for (const listener of list.slice()) {
      listener.apply(this, args);
    }
    return true;
  }

  listeners(event: string | symbol): Listener[] {
    return (this._events.get(event) || []).slice();
  }

  rawListeners(event: string | symbol): Listener[] {
    return this.listeners(event);
  }

  listenerCount(event: string | symbol): number {
    const list = this._events.get(event);
    return list ? list.length : 0;
  }

  eventNames(): (string | symbol)[] {
    return Array.from(this._events.keys());
  }

  setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return this._maxListeners;
  }
}

export default EventEmitter;
