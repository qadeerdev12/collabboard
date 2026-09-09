import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TaskDraftPanel from '../components/TaskDraftPanel'

const mocks = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('../lib/api', () => ({ boardApi: { draftCard: mocks.generate } }))
const draft = { description: 'Reset passwords securely.', tag: 'Feature', checklist: ['Test expiry'] }
let props
beforeEach(() => {
  vi.resetAllMocks()
  mocks.generate.mockResolvedValue({ data: { draft } })
  props = { boardId: 'board', card: { _id: 'card', checklist: [{ _id: 'existing', title: 'Existing', completed: true }] }, token: 'token', title: 'Password reset', disabled: false, onUse: vi.fn(), onSave: vi.fn().mockResolvedValue({}), onApplying: vi.fn() }
})
afterEach(cleanup)
async function generate() {
  fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
  fireEvent.change(screen.getByLabelText('Task brief'), { target: { value: 'Expire after an hour' } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }))
  return screen.findByLabelText('Suggested description')
}

describe('task draft preview', () => {
  it('requires explicit generation and review before changing anything', async () => {
    render(<TaskDraftPanel {...props} />)
    expect(mocks.generate).not.toHaveBeenCalled()
    const description = await generate()
    expect(mocks.generate).toHaveBeenCalledWith('board', 'card', { title: 'Password reset', brief: 'Expire after an hour' }, 'token')
    expect(props.onUse).not.toHaveBeenCalled()
    expect(props.onSave).not.toHaveBeenCalled()
    fireEvent.change(description, { target: { value: 'Reviewed description' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use description and label' }))
    expect(props.onUse).toHaveBeenCalledWith({ ...draft, description: 'Reviewed description' })
    expect(props.onSave).not.toHaveBeenCalled()
  })
  it('adds only a reviewed checklist item through the existing mutation', async () => {
    render(<TaskDraftPanel {...props} />)
    await generate()
    fireEvent.change(screen.getByLabelText('Suggested checklist item 1'), { target: { value: 'Test invalid and expired tokens' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add suggestion 1' }))
    await screen.findByRole('button', { name: 'Added suggestion 1' })
    expect(props.onSave).toHaveBeenCalledWith(props.card, { checklistOperation: { action: 'add', title: 'Test invalid and expired tokens' } })
    fireEvent.click(screen.getByRole('button', { name: 'Added suggestion 1' }))
    expect(props.onSave).toHaveBeenCalledTimes(1)
    expect(props.onApplying).toHaveBeenLastCalledWith(false)
  })
  it('retains the editable suggestion after an add failure', async () => {
    props.onSave.mockRejectedValueOnce(new Error('Save failed'))
    render(<TaskDraftPanel {...props} />)
    await generate()
    fireEvent.click(screen.getByRole('button', { name: 'Add suggestion 1' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Suggested checklist item 1').value).toBe('Test expiry')
    expect(screen.getByRole('button', { name: 'Add suggestion 1' }).disabled).toBe(false)
  })
  it('shows configuration errors without automatic retries', async () => {
    mocks.generate.mockRejectedValue(new Error('AI drafting is not configured on the server.'))
    render(<TaskDraftPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }))
    await screen.findByRole('alert')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })
  it('discards suggestions without saving them', async () => {
    render(<TaskDraftPanel {...props} />)
    await generate()
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(screen.queryByLabelText('Suggested description')).toBeNull()
    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onUse).not.toHaveBeenCalled()
  })
  it('ignores generation results after the panel is unmounted', async () => {
    let finish
    mocks.generate.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const view = render(<TaskDraftPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generating...' }))
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    view.unmount()
    await act(async () => finish({ data: { draft } }))
    expect(props.onUse).not.toHaveBeenCalled()
  })
})
