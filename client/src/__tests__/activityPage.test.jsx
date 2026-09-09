import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityPage from '../pages/ActivityPage'

const mocks = vi.hoisted(() => ({ auth: { token: 'one' }, list: vi.fn(), boards: vi.fn(), getOne: vi.fn(), project: vi.fn() }))
vi.mock('../context/useAuth', () => ({ useAuth: () => mocks.auth }))
vi.mock('../components/AppHeader', () => ({ default: () => null }))
vi.mock('../lib/api', () => ({ activityApi: { list: mocks.list }, boardApi: { list: mocks.boards, getOne: mocks.getOne, getActivities: mocks.project } }))

const item = (id) => ({ _id: id, targetTitle: `Task ${id}`, actor: { name: 'Sam' }, action: 'card.created', createdAt: '2026-01-01', boardName: 'Uptime Desk' })
const response = (ids, nextCursor = null) => ({ data: { activities: ids.map(item), nextCursor } })
function page(path = '/activity') {
  return <MemoryRouter initialEntries={[path]}><Routes><Route path="/activity" element={<ActivityPage />} /><Route path="/boards/:boardId/activity" element={<ActivityPage />} /></Routes></MemoryRouter>
}
beforeEach(() => { vi.resetAllMocks(); mocks.auth.token = 'one' })
afterEach(cleanup)

describe('workspace activity page', () => {
  it('loads a single feed and appends older pages without project request fan-out', async () => {
    mocks.list.mockResolvedValueOnce(response(['1'], 'older')).mockResolvedValueOnce(response(['1', '2']))
    render(page())
    await screen.findByText('Task 1')
    expect(screen.getByText('Uptime Desk')).toBeTruthy()
    expect(mocks.list).toHaveBeenCalledTimes(1)
    expect(mocks.boards).not.toHaveBeenCalled()
    expect(mocks.project).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Task 2')
    expect(screen.getAllByText('Task 1')).toHaveLength(1)
    expect(mocks.list).toHaveBeenLastCalledWith('one', { cursor: 'older' })
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('retains existing rows and the cursor when loading more fails', async () => {
    mocks.list.mockResolvedValueOnce(response(['1'], 'older')).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(response(['2']))
    render(page())
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await screen.findByRole('alert')
    expect(screen.getByText('Task 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading more' }))
    await screen.findByText('Task 2')
    expect(mocks.list).toHaveBeenLastCalledWith('one', { cursor: 'older' })
  })

  it('supports initial retry and an empty workspace', async () => {
    mocks.list.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(response([]))
    render(page())
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await screen.findByText('No activity yet.')
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('keeps the project-specific requests unchanged', async () => {
    mocks.getOne.mockResolvedValue({ data: { board: { name: 'Project timeline' } } })
    mocks.project.mockResolvedValue(response(['1']))
    render(page('/boards/abc/activity'))
    await screen.findByText('Task 1')
    expect(screen.getByRole('heading', { name: 'Project timeline' })).toBeTruthy()
    expect(mocks.getOne).toHaveBeenCalledWith('abc', 'one')
    expect(mocks.project).toHaveBeenCalledWith('abc', 'one')
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('ignores a pending old-session page and prevents duplicate load-more requests', async () => {
    let finish
    const pending = new Promise((resolve) => { finish = resolve })
    mocks.list.mockResolvedValueOnce(response(['1'], 'older')).mockReturnValueOnce(pending).mockResolvedValueOnce(response(['new']))
    const view = render(page())
    const button = await screen.findByRole('button', { name: 'Load more' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.list).toHaveBeenCalledTimes(2)
    mocks.auth.token = 'two'
    view.rerender(page())
    await screen.findByText('Task new')
    await act(async () => finish(response(['old'])))
    expect(screen.queryByText('Task old')).toBeNull()
    expect(screen.queryByText('Task 1')).toBeNull()
  })
})
