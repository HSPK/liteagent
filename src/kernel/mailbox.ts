import type { SignalLike } from '../agent/types.js';

type MailboxHandler = (signal: SignalLike) => Promise<void> | void;
type MailboxErrorHandler = (error: unknown, signal: SignalLike | undefined) => Promise<void> | void;

export class Mailbox {
  #queue: SignalLike[] = [];
  #draining = false;
  #idleResolvers: Array<(value: void | PromiseLike<void>) => void> = [];
  #handler: MailboxHandler;
  #errorHandler: MailboxErrorHandler | null;

  constructor(handler: MailboxHandler, errorHandler: MailboxErrorHandler | null = null) {
    this.#handler = handler;
    this.#errorHandler = errorHandler;
  }

  enqueue(signal: SignalLike): SignalLike {
    this.#queue.push(signal);

    if (!this.#draining) {
      this.#draining = true;
      void this.#drain();
    }

    return signal;
  }

  async #drain(): Promise<void> {
    while (this.#queue.length > 0) {
      const signal = this.#queue.shift();
      if (!signal) {
        continue;
      }

      try {
        await this.#handler(signal);
      } catch (error) {
        if (!this.#errorHandler) {
          continue;
        }

        try {
          await this.#errorHandler(error, signal);
        } catch {
          // Mailbox errors must not wedge the queue.
        }
      }
    }

    this.#draining = false;

    if (this.#queue.length > 0) {
      this.#draining = true;
      void this.#drain();
      return;
    }

    const resolvers = this.#idleResolvers.splice(0, this.#idleResolvers.length);
    for (const resolve of resolvers) {
      resolve();
    }
  }

  whenIdle(): Promise<void> {
    if (!this.#draining && this.#queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.#idleResolvers.push(resolve);
    });
  }

  isIdle(): boolean {
    return !this.#draining && this.#queue.length === 0;
  }

  size(): number {
    return this.#queue.length;
  }
}
