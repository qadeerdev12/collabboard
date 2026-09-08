import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, EVENTS } from '../events/eventBus.js';
import { registerNotificationSubscriber } from '../events/notificationSubscriber.js';
import { createNotification } from '../services/notificationService.js';

// Service persistence has its own database tests. These tests isolate the
// subscriber's payload mapping, registration lifecycle, and failure handling.
vi.mock('../services/notificationService.js', () => ({ createNotification: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); vi.mocked(createNotification).mockReset(); });

const assignment = { actorId: 'actor', assigneeId: 'recipient', boardId: 'board', cardId: 'card' };

describe('notification subscriber', () => {
  it('maps an assignment event to the creation service and returns its result', async () => {
    const bus = createEventBus();
    registerNotificationSubscriber(bus);
    const saved = { _id: 'notification', readAt: null };
    vi.mocked(createNotification).mockResolvedValue(saved);
    expect(await bus.publish(EVENTS.CARD_ASSIGNED, assignment)).toEqual([{ status: 'fulfilled', value: saved }]);
    expect(createNotification).toHaveBeenCalledExactlyOnceWith({
      actorId: 'actor', recipientId: 'recipient', boardId: 'board', cardId: 'card', type: 'card.assigned',
    });
  });

  it('does not register twice and can be stopped and registered again', async () => {
    const bus = createEventBus();
    const stop = registerNotificationSubscriber(bus);
    expect(registerNotificationSubscriber(bus)).toBe(stop);
    await bus.publish(EVENTS.CARD_ASSIGNED, assignment);
    expect(createNotification).toHaveBeenCalledOnce();
    stop();
    expect(await bus.publish(EVENTS.CARD_ASSIGNED, assignment)).toEqual([]);
    const stopAgain = registerNotificationSubscriber(bus);
    stop(); // Old cleanup must not remove the new registration.
    await bus.publish(EVENTS.CARD_ASSIGNED, assignment);
    expect(createNotification).toHaveBeenCalledTimes(2);
    stopAgain();
  });

  it('preserves an intentional service skip as a fulfilled null result', async () => {
    const bus = createEventBus();
    registerNotificationSubscriber(bus);
    vi.mocked(createNotification).mockResolvedValue(null);
    expect(await bus.publish(EVENTS.CARD_ASSIGNED, assignment)).toEqual([{ status: 'fulfilled', value: null }]);
  });

  it('reports a failed service call without rejecting publication', async () => {
    const bus = createEventBus();
    registerNotificationSubscriber(bus);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('Save failed');
    vi.mocked(createNotification).mockRejectedValue(failure);
    expect(await bus.publish(EVENTS.CARD_ASSIGNED, assignment)).toEqual([{ status: 'rejected', reason: failure }]);
    expect(log).toHaveBeenCalledWith('Subscriber failed for card.assigned:', 'Save failed');
  });
});
