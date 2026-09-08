import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BoardPage from '../pages/BoardPage'

const mocks = vi.hoisted(() => ({
  user: { id: 'owner', name: 'Alex Lee' },
  toast: { success: vi.fn(), error: vi.fn() },
  socket: { connected: false, connectionError: '', emitWithAck: vi.fn(), onSocketEvent: vi.fn(() => () => {}) },
  boardApi: {
    getOne: vi.fn(), getActivities: vi.fn(), listTemplates: vi.fn(),
    getGitHubIntegration: vi.fn(), getGitHubCommits: vi.fn(), getGitHubStats: vi.fn(),
    linkGitHubRepo: vi.fn(),
  },
  integrationApi: { getGitHubAccount: vi.fn(), listGitHubRepos: vi.fn() },
}))
vi.mock('../lib/api', () => ({ boardApi: mocks.boardApi, integrationApi: mocks.integrationApi }))
vi.mock('../context/useAuth', () => ({ useAuth: () => ({ user: mocks.user, token: 'token' }) }))
vi.mock('../context/useToast', () => ({ useToast: () => mocks.toast }))
vi.mock('../context/useTheme', () => ({ useTheme: () => ({ dark: false, toggle: () => {} }) }))
vi.mock('../hooks/useSocket', () => ({ useSocket: () => mocks.socket }))
vi.mock('../components/BoardSwitcher', () => ({ default: ({ currentBoard }) => <span>{currentBoard.name}</span> }))
vi.mock('../components/NotificationBell', () => ({ default: () => null }))

const integration = { id: 'integration', repoId: '12', repoFullName: 'example/api', repoUrl: 'https://github.com/example/api' }
const reads = () => [mocks.integrationApi.listGitHubRepos, mocks.boardApi.getGitHubCommits, mocks.boardApi.getGitHubStats]
const failure = (status, extra = {}) => Object.assign(new Error('GitHub unavailable'), { status, ...extra })

// Drive the real page effects with bounded time advances: a retry loop must fail
// a call-count assertion, not hang the test by continually creating new timers.
async function settle() {
  for (let i = 0; i < 20; i++) await act(() => vi.advanceTimersByTimeAsync(10))
}

function mount() {
  return render(<StrictMode><MemoryRouter initialEntries={['/boards/project?panel=github']}>
    <Routes><Route path="/boards/:boardId" element={<BoardPage />} /></Routes>
  </MemoryRouter></StrictMode>)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-08T00:00:00Z'))
  vi.clearAllMocks()
  mocks.boardApi.getOne.mockResolvedValue({ data: {
    board: { _id: 'project', name: 'Uptime Desk', members: [{ user: mocks.user, role: 'owner' }] },
    workflows: [{ _id: 'workflow', name: 'General', templateKey: 'default' }], lists: [], cards: [],
  } })
  mocks.boardApi.getActivities.mockResolvedValue({ data: { activities: [] } })
  mocks.boardApi.listTemplates.mockResolvedValue({ data: { templates: [] } })
  mocks.boardApi.getGitHubIntegration.mockResolvedValue({ data: { integration } })
  mocks.integrationApi.getGitHubAccount.mockResolvedValue({ data: { account: { username: 'alex' } } })
  mocks.integrationApi.listGitHubRepos.mockResolvedValue({ data: { repositories: [] } })
  mocks.boardApi.getGitHubCommits.mockResolvedValue({ data: { commits: [], integration } })
  mocks.boardApi.getGitHubStats.mockResolvedValue({ data: { stats: { openPullRequests: 0, openIssues: 0 }, integration } })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('board GitHub request lifecycle', () => {
  it.each([undefined, 401, 500, 429])('does not automatically retry a failed read (status %s), even after reopening', async (status) => {
    reads().forEach((read) => read.mockRejectedValue(failure(status)))
    mount()
    await settle()
    reads().forEach((read) => expect(read).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'GitHub', exact: true }))
    await settle()
    reads().forEach((read) => expect(read).toHaveBeenCalledOnce())
  })

  it('allows one explicit retry per resource and remains stopped if it fails again', async () => {
    reads().forEach((read) => read.mockRejectedValue(failure(500)))
    mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Change repo' }))
    screen.getAllByRole('button', { name: 'Retry' }).forEach((button) => fireEvent.click(button))
    await settle()
    reads().forEach((read) => expect(read).toHaveBeenCalledTimes(2))
  })

  it('honors the longer rate-limit deadline and waits for a click after expiry', async () => {
    const start = Date.now()
    reads().forEach((read) => read.mockRejectedValue(failure(429, {
      retryAfter: 60, resetAt: new Date(start + 90000).toISOString(),
    })))
    mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Change repo' }))
    screen.getAllByRole('button', { name: 'Retry' }).forEach((button) => {
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
    })
    await act(() => vi.advanceTimersByTimeAsync(start + 89999 - Date.now()))
    screen.getAllByRole('button', { name: 'Retry' }).forEach((button) => expect(button.disabled).toBe(true))
    await act(() => vi.advanceTimersByTimeAsync(1))
    screen.getAllByRole('button', { name: 'Retry' }).forEach((button) => expect(button.disabled).toBe(false))
    reads().forEach((read) => expect(read).toHaveBeenCalledOnce())

    mocks.integrationApi.listGitHubRepos.mockResolvedValue({ data: { repositories: [] } })
    mocks.boardApi.getGitHubCommits.mockResolvedValue({ data: { commits: [], integration } })
    mocks.boardApi.getGitHubStats.mockResolvedValue({ data: { stats: { openPullRequests: 3, openIssues: 7 }, integration } })
    screen.getAllByRole('button', { name: 'Retry' }).forEach((button) => fireEvent.click(button))
    await settle()
    reads().forEach((read) => expect(read).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Could not load commits')).toBeNull()
    expect(screen.queryByText('Could not load repositories')).toBeNull()
    expect(screen.queryByText('Could not load repository pulse')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Refresh', exact: true })).toHaveLength(3)
  })

  it('preserves successful lazy loading without extra requests when the panel reopens', async () => {
    mount()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'GitHub', exact: true }))
    await settle()
    reads().forEach((read) => expect(read).toHaveBeenCalledOnce())
  })

  it('loads commits and stats for a newly linked repository after an ordinary failure', async () => {
    const repository = { id: 13, fullName: 'example/web', htmlUrl: 'https://github.com/example/web' }
    const nextIntegration = { ...integration, repoId: '13', repoFullName: repository.fullName }
    mocks.integrationApi.listGitHubRepos.mockResolvedValue({ data: { repositories: [repository] } })
    mocks.boardApi.getGitHubCommits.mockRejectedValueOnce(failure(500))
    mocks.boardApi.getGitHubStats.mockRejectedValueOnce(failure(500))
    mocks.boardApi.linkGitHubRepo.mockResolvedValue({ data: { integration: nextIntegration } })
    mount()
    await settle()
    mocks.boardApi.getGitHubCommits.mockResolvedValue({ data: { commits: [], integration: nextIntegration } })
    mocks.boardApi.getGitHubStats.mockResolvedValue({ data: { stats: {}, integration: nextIntegration } })
    fireEvent.click(screen.getByRole('button', { name: 'Change repo' }))
    fireEvent.click(screen.getByRole('button', { name: /example\/web/ }))
    await settle()
    expect(mocks.boardApi.linkGitHubRepo).toHaveBeenCalledExactlyOnceWith('project', repository, 'token')
    expect(mocks.boardApi.getGitHubCommits).toHaveBeenCalledTimes(2)
    expect(mocks.boardApi.getGitHubStats).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Could not load commits')).toBeNull()
    expect(screen.queryByText('Could not load repository pulse')).toBeNull()
  })
})
