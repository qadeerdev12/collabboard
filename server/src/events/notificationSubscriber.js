import { appEvents, EVENTS } from './eventBus.js';
import { createNotification } from '../services/notificationService.js';
import { emitInboxChanged } from '../services/notificationDeliveryService.js';

// Track registration per bus so repeated setup cannot create duplicate inbox
// entries. WeakMap does not keep discarded test buses alive.
const registrations = new WeakMap();

export function registerNotificationSubscriber(bus = appEvents, { io } = {}) {
  if (registrations.has(bus)) return registrations.get(bus);

  const unsubscribe = bus.subscribe(EVENTS.CARD_ASSIGNED, async ({
    actorId, assigneeId, boardId, cardId,
  }) => {
    // The mutation service supplies facts from the saved assignment. The handler
    // maps the assignee to the recipient; the service checks eligibility.
    const notification = await createNotification({
      actorId,
      recipientId: assigneeId,
      type: EVENTS.CARD_ASSIGNED,
      boardId,
      cardId,
    });
    // Only a saved, eligible notification can trigger delivery. Use its stored
    // recipient rather than forwarding a recipient supplied in an event payload.
    if (notification) emitInboxChanged(io, notification.recipient);
    return notification;
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
