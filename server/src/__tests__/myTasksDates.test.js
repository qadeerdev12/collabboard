import { describe, expect, it } from 'vitest';
import { taskGroup, taskDateLabel } from '../../../client/src/lib/myTasks.js';

describe('My Tasks calendar grouping', () => {
  const today = new Date(2026, 8, 8, 0, 15);
  it('groups by local calendar date, keeping completed work separate', () => {
    expect(taskGroup({ dueDate: '2026-09-07T00:00:00.000Z' }, today)).toBe('Overdue');
    expect(taskGroup({ dueDate: '2026-09-08T00:00:00.000Z' }, today)).toBe('Today');
    expect(taskGroup({ dueDate: '2026-09-09T00:00:00.000Z' }, today)).toBe('Upcoming');
    expect(taskGroup({ dueDate: null }, today)).toBe('No due date');
    expect(taskGroup({ status: 'Done', dueDate: '2026-01-01' }, today)).toBe('Completed');
    expect(taskGroup({ checklist: [{ completed: true }] }, today)).toBe('No due date');
  });
  it('handles year boundaries and date display without UTC conversion', () => {
    expect(taskGroup({ dueDate: '2025-12-31' }, new Date(2026, 0, 1))).toBe('Overdue');
    expect(taskGroup({ dueDate: '2026-01-01' }, new Date(2025, 11, 31))).toBe('Upcoming');
    expect(taskDateLabel(null)).toBe('No due date');
    expect(taskDateLabel('2026-09-08T00:00:00.000Z')).toBe(
      new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(2026, 8, 8))
    );
  });
});
