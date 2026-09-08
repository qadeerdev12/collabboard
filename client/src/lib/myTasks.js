export const TASK_GROUPS = ['Overdue', 'Today', 'Upcoming', 'No due date']

// Due dates are calendar dates, matching the card date input. Compare their
// YYYY-MM-DD values against the viewer's local date, avoiding UTC/DST shifts.
export function taskGroup(task, now = new Date()) {
  if (task.status === 'Done') return 'Completed'
  const due = String(task.dueDate || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (!due) return 'No due date'
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return due < today ? 'Overdue' : due === today ? 'Today' : 'Upcoming'
}

export function taskDateLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return 'No due date'
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}
