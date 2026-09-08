import { appEvents, EVENTS } from './eventBus.js';
import { createNotification } from '../services/notificationService.js';

// Track registration per bus so repeated setup cannot create duplicate inbox
// entries. WeakMap does not keep discarded test buses alive.
const registrations = new WeakMap();

export function registerNotificationSubscriber(bus = appEvents) {
  if (registrations.has(bus)) return registrations.get(bus);

  const unsubscribe = bus.subscribe(EVENTS.CARD_ASSIGNED, async ({
    actorId, assigneeId, boardId, cardId,
  }) => {
    // The mutation service supplies facts from the saved assignment. The handler
    // maps the assignee to the recipient; the service checks eligibility.
    return createNotification({
      actorId,
      recipientId: assigneeId,
      type: EVENTS.CARD_ASSIGNED,
      boardId,
      cardId,
    });
  });

  function stop() {
    // Make repeated cleanup safe, including after a later re-registration.
    if (registrations.get(bus) !== stop) return;
    unsubscribe();
    registrations.delete(bus);
  }

  registrations.set(bus, stop);
  return stop;
}
