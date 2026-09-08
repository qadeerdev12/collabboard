import { EventEmitter } from 'node:events';

export const EVENTS = Object.freeze({ CARD_ASSIGNED: 'card.assigned' });

export function createEventBus() {
  const emitter = new EventEmitter();

  return {
    subscribe(eventName, handler) {
      emitter.on(eventName, handler);
      return () => emitter.off(eventName, handler);
    },

    // EventEmitter.emit() does not await async listeners. Invoke a snapshot of
    // the listeners ourselves so synchronous throws and rejected promises are
    // both collected, and one failed subscriber cannot stop the others.
    async publish(eventName, payload) {
      const results = await Promise.allSettled(
        emitter.listeners(eventName).map((handler) =>
          Promise.resolve().then(() => handler(payload))
        )
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          // Do not log the payload: it may contain private project/user data.
          console.error(`Subscriber failed for ${eventName}:`, result.reason?.message || 'Unknown error');
        }
      }
      return results;
    },
  };
}

// One bus per server process. Tests create their own instances for isolation.
export const appEvents = createEventBus();
