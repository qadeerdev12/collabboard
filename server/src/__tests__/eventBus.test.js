import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, EVENTS } from '../events/eventBus.js';

afterEach(() => vi.restoreAllMocks());

describe('internal event bus', () => {
  it('delivers only to subscribers for the published event', async () => {
    const bus = createEventBus();
    const assigned = vi.fn().mockResolvedValue('saved');
    const unrelated = vi.fn();
    bus.subscribe(EVENTS.CARD_ASSIGNED, assigned);
    bus.subscribe('unrelated', unrelated);
    const payload = { cardId: 'example' };
    expect(await bus.publish(EVENTS.CARD_ASSIGNED, payload)).toEqual([
      { status: 'fulfilled', value: 'saved' },
    ]);
    expect(assigned).toHaveBeenCalledWith(payload);
    expect(unrelated).not.toHaveBeenCalled();
  });

  it('waits for async subscribers before finishing publication', async () => {
    const bus = createEventBus();
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const handler = vi.fn(() => pending);
    bus.subscribe(EVENTS.CARD_ASSIGNED, handler);
    let finished = false;
    const publication = bus.publish(EVENTS.CARD_ASSIGNED, {}).then((results) => {
      finished = true;
      return results;
    });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    release('persisted');
    expect(await publication).toEqual([{ status: 'fulfilled', value: 'persisted' }]);
  });

  it('collects synchronous and async failures without blocking another subscriber', async () => {
    const bus = createEventBus();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const syncFailure = new Error('Synchronous failure');
    const asyncFailure = new Error('Database unavailable');
    bus.subscribe(EVENTS.CARD_ASSIGNED, () => { throw syncFailure; });
    bus.subscribe(EVENTS.CARD_ASSIGNED, async () => { throw asyncFailure; });
    const healthy = vi.fn().mockResolvedValue('ok');
    bus.subscribe(EVENTS.CARD_ASSIGNED, healthy);
    expect(await bus.publish(EVENTS.CARD_ASSIGNED, { privateTitle: 'Do not log' })).toEqual([
      { status: 'rejected', reason: syncFailure },
      { status: 'rejected', reason: asyncFailure },
      { status: 'fulfilled', value: 'ok' },
    ]);
    expect(healthy).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat()).not.toContain('Do not log');
  });

  it('supports cleanup and does not replay events published without subscribers', async () => {
    const bus = createEventBus();
    expect(await bus.publish(EVENTS.CARD_ASSIGNED, {})).toEqual([]);
    const handler = vi.fn();
    const stop = bus.subscribe(EVENTS.CARD_ASSIGNED, handler);
    expect(handler).not.toHaveBeenCalled();
    stop();
    stop();
    expect(await bus.publish(EVENTS.CARD_ASSIGNED, {})).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });
});
