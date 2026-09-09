import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from '../pages/DashboardPage'

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'owner', name: 'Alex Lee' }, token: 'token-a' },
  boards: vi.fn(),
  github: vi.fn(),
}))

vi.mock('../context/useAuth', () => ({ useAuth: () => mocks.auth }))
vi.mock('../context/useToast', () => ({ useToast: () => ({}) }))
vi.mock('../components/AppHeader', () => ({ default: () => null }))
vi.mock('../lib/api', () => ({
  boardApi: { list: mocks.boards },
  integrationApi: { getGitHubDashboard: mocks.github },
}))

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function boardResponse(name = 'Uptime Desk') {
  return { data: { boards: [{
    _id: 'project-1', name, color: 'teal',
    members: [{ user: 'owner', role: 'owner' }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }] } }
}

const disconnected = { data: { connected: false } }
const connectCopy = 'Connect GitHub to bring repository context into your SDLCFlow projects.'

function page() {
  return (
    <StrictMode>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/boards/:boardId" element={<p>Project opened</p>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.token = 'token-a'
})
afterEach(cleanup)

describe('independent dashboard loading', () => {
  it('shows and opens projects while GitHub is still pending', async () => {
    const github = deferred()
    mocks.boards.mockResolvedValue(boardResponse())
    mocks.github.mockReturnValue(github.promise)
    render(page())

    expect(await screen.findByText('Uptime Desk')).toBeTruthy()
    expect(screen.queryByText('Loading your workspace...')).toBeNull()
    expect(screen.queryByText(connectCopy)).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Uptime Desk', exact: true })[0])
    expect(screen.getByText('Project opened')).toBeTruthy()
    // Completion after navigation must be ignored by the unmounted dashboard.
    await act(async () => github.resolve(disconnected))
    expect(screen.getByText('Project opened')).toBeTruthy()
  })

  it('shows GitHub independently while projects are pending', async () => {
    const boards = deferred()
    mocks.boards.mockReturnValue(boards.promise)
    mocks.github.mockResolvedValue(disconnected)
    render(page())

    expect(await screen.findByText(connectCopy)).toBeTruthy()
    expect(screen.getByText('Loading your workspace...')).toBeTruthy()
    await act(async () => boards.resolve(boardResponse()))
    expect(screen.getByText('Uptime Desk')).toBeTruthy()
  })

  it('keeps projects usable when GitHub fails without automatically retrying', async () => {
    const github = deferred()
    mocks.boards.mockResolvedValue(boardResponse())
    mocks.github.mockReturnValue(github.promise)
    render(page())
    await screen.findByText('Uptime Desk')
    const attempts = mocks.github.mock.calls.length

    await act(async () => github.reject(new Error('GitHub unavailable')))
    expect(screen.getByText('GitHub unavailable')).toBeTruthy()
    expect(screen.getByText('Uptime Desk')).toBeTruthy()
    expect(mocks.github).toHaveBeenCalledTimes(attempts)
  })

  it('shows a project error without waiting for GitHub', async () => {
    const github = deferred()
    mocks.boards.mockRejectedValue(new Error('Projects unavailable'))
    mocks.github.mockReturnValue(github.promise)
    render(page())

    expect(await screen.findByText('Projects unavailable')).toBeTruthy()
    expect(screen.queryByText('Loading your workspace...')).toBeNull()
    await act(async () => github.resolve(disconnected))
    expect(screen.getByText(connectCopy)).toBeTruthy()
    expect(screen.getByText('Projects unavailable')).toBeTruthy()
  })

  it.each(['resolve', 'reject'])('ignores stale %s results and loading updates after a token change', async (outcome) => {
    const oldBoards = deferred(), oldGithub = deferred()
    const newBoards = deferred(), newGithub = deferred()
    mocks.boards.mockImplementation((token) => token === 'token-a' ? oldBoards.promise : newBoards.promise)
    mocks.github.mockImplementation((token) => token === 'token-a' ? oldGithub.promise : newGithub.promise)
    const view = render(page())
    mocks.auth.token = 'token-b'
    view.rerender(page())

    await act(async () => {
      oldBoards[outcome](outcome === 'resolve' ? boardResponse('Old project') : new Error('Old project error'))
      oldGithub[outcome](outcome === 'resolve' ? disconnected : new Error('Old GitHub error'))
    })
    expect(screen.getByText('Loading your workspace...')).toBeTruthy()
    expect(screen.queryByText(connectCopy)).toBeNull()
    expect(screen.queryByText(/Old project/)).toBeNull()
    expect(screen.queryByText('Old GitHub error')).toBeNull()

    await act(async () => {
      newBoards.resolve(boardResponse('Current project'))
      newGithub.resolve(disconnected)
    })
    expect(screen.getByText('Current project')).toBeTruthy()
    expect(screen.getByText(connectCopy)).toBeTruthy()
  })
})
