import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BoardPage from '../pages/BoardPage'

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'owner', name: 'Alex Lee' }, token: 'token' },
  socket: { connected: false, connectionError: '', emitWithAck: vi.fn(), onSocketEvent: vi.fn(() => () => {}) },
  toast: { success: vi.fn(), error: vi.fn() },
  boardApi: {
    getOne: vi.fn(), getActivities: vi.fn(), getMessages: vi.fn(), listTemplates: vi.fn(),
    getGitHubIntegration: vi.fn(), getGitHubCommits: vi.fn(), getGitHubStats: vi.fn(),
    createCard: vi.fn(), createList: vi.fn(),
  },
  integrationApi: { getGitHubAccount: vi.fn(), listGitHubRepos: vi.fn() },
}))
vi.mock('../lib/api', () => ({ boardApi: mocks.boardApi, integrationApi: mocks.integrationApi }))
vi.mock('../context/useAuth', () => ({ useAuth: () => mocks.auth }))
vi.mock('../context/useToast', () => ({ useToast: () => mocks.toast }))
vi.mock('../context/useTheme', () => ({ useTheme: () => ({ dark: false, toggle: () => {} }) }))
vi.mock('../hooks/useSocket', () => ({ useSocket: () => mocks.socket }))
vi.mock('../components/board/BoardHeader', () => ({ default: ({ board }) => <h1 data-testid="project-name">{board.name}</h1> }))
// Inspect the real page's panel state independently of presentational details.
vi.mock('../components/board/GitHubIntegrationPanel', () => ({ default: (props) => <output data-testid="panel">{JSON.stringify(props)}</output> }))
vi.mock('../components/ChatPanel', () => ({ default: (props) => <output data-testid="panel">{JSON.stringify(props)}</output> }))
vi.mock('../components/ActivityPanel', () => ({ default: (props) => <output data-testid="panel">{JSON.stringify(props)}</output> }))

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const data = (value) => ({ data: value })
const integration = (id) => ({ id, repoFullName: `example/${id}` })
function snapshot(id, name = id) {
  return data({
    board: { _id: id, name, members: [{ user: mocks.auth.user, role: 'owner' }] },
    workflows: [{ _id: `${id}-workflow`, name: 'General', templateKey: 'default' }],
    lists: [], cards: [],
  })
}
async function settle() {
  for (let i = 0; i < 20; i++) await act(() => vi.advanceTimersByTimeAsync(10))
}
function tree(panel = 'github') {
  return <StrictMode><MemoryRouter initialEntries={[`/boards/alpha?panel=${panel}`]}>
    <Link to={`/boards/alpha?panel=${panel}`}>Go alpha</Link>
    <Link to={`/boards/beta?panel=${panel}`}>Go beta</Link>
    <Link to="/boards/alpha?panel=chat">Open chat</Link>
    <Routes><Route path="/boards/:boardId" element={<BoardPage />} /></Routes>
  </MemoryRouter></StrictMode>
}
const panelState = () => JSON.parse(screen.getByTestId('panel').textContent)

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  mocks.auth.token = 'token'
  mocks.socket.connected = false
  mocks.socket.emitWithAck.mockResolvedValue({ presence: [] })
  mocks.socket.onSocketEvent.mockImplementation(() => () => {})
  mocks.boardApi.getOne.mockImplementation(async (id) => snapshot(id))
  mocks.boardApi.getActivities.mockImplementation(async (id) => data({ activities: [{ _id: `${id}-activity` }] }))
  mocks.boardApi.getMessages.mockImplementation(async (id) => data({ messages: [{ _id: `${id}-message`, body: id }] }))
  mocks.boardApi.listTemplates.mockResolvedValue(data({ templates: [] }))
  mocks.boardApi.getGitHubIntegration.mockImplementation(async (id) => data({ integration: integration(id) }))
  mocks.boardApi.getGitHubCommits.mockImplementation(async (id) => data({ commits: [{ sha: id }], integration: integration(id) }))
  mocks.boardApi.getGitHubStats.mockImplementation(async (id) => data({ stats: { project: id }, integration: integration(id) }))
  mocks.integrationApi.getGitHubAccount.mockResolvedValue(data({ account: { username: 'alex' } }))
  mocks.integrationApi.listGitHubRepos.mockResolvedValue(data({ repositories: [] }))
})

describe('REST create response and socket echo', () => {
  it.each(['card', 'list'].flatMap((kind) => ['socket-first', 'http-first'].map((order) => [kind, order])))('merges %s creation once (%s)', async (kind, order) => {
    const pending = deferred()
    const list = { _id: 'alpha-list', workflow: 'alpha-workflow', title: 'Backlog', position: 1000 }
    const createdList = { ...list, _id: 'new-list', title: 'Review', position: 2000 }
    const card = { _id: 'new-card', list: kind === 'list' ? createdList._id : list._id, workflow: list.workflow, title: 'New task', position: 1000 }
    mocks.boardApi.getOne.mockImplementation(async () => ({ data: { ...snapshot('alpha').data, lists: [list] } }))
    mocks.boardApi[kind === 'card' ? 'createCard' : 'createList'].mockReturnValue(pending.promise)
    const handlers = new Map()
    mocks.socket.onSocketEvent.mockImplementation((event, handler) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    })
    const view = render(tree())
    await settle()
    if (kind === 'card') {
      fireEvent.change(screen.getByPlaceholderText('Add a task'), { target: { value: card.title } })
      fireEvent.submit(screen.getByPlaceholderText('Add a task').closest('form'))
    } else {
      fireEvent.change(screen.getByLabelText('Add list to active workflow'), { target: { value: createdList.title } })
      fireEvent.click(screen.getByRole('button', { name: 'Add list', exact: true }))
    }
    expect(mocks.boardApi[kind === 'card' ? 'createCard' : 'createList']).toHaveBeenCalledOnce()
    // Reconnect while the HTTP response is pending, then deliver both paths.
    mocks.socket.connected = true
    view.rerender(tree())
    await settle()
    const value = kind === 'card' ? card : createdList
    const socketDelivery = async () => {
      await act(async () => handlers.get(`${kind}:created`)({ boardId: 'alpha', [kind]: value }))
      if (kind === 'list') await act(async () => handlers.get('card:created')({ boardId: 'alpha', card }))
    }
    if (order === 'socket-first') await socketDelivery()
    await act(async () => pending.resolve(data({ [kind]: value })))
    if (order === 'http-first') await socketDelivery()
    await settle()
    expect(screen.getAllByRole('button', { name: /New task/ })).toHaveLength(1)
    if (kind === 'list') expect(screen.getAllByRole('button', { name: 'Review', exact: true })).toHaveLength(1)
  })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('project request isolation', () => {
  it.each(['resolve', 'reject'])('ignores an old project snapshot that later %ss', async (outcome) => {
    const old = deferred()
    mocks.boardApi.getOne.mockImplementation((id) => id === 'alpha' ? old.promise : Promise.resolve(snapshot(id)))
    render(tree())
    await settle()
    fireEvent.click(screen.getByText('Go beta'))
    await settle()
    expect(screen.getByTestId('project-name').textContent).toBe('beta')
    await act(async () => old[outcome](outcome === 'resolve' ? snapshot('alpha') : new Error('Old project failed')))
    await settle()
    expect(screen.getByTestId('project-name').textContent).toBe('beta')
    expect(screen.queryByText('Old project failed')).toBeNull()
  })

  it('keeps the new project loading when an old request finishes first', async () => {
    const old = deferred(), current = deferred()
    mocks.boardApi.getOne.mockImplementation((id) => id === 'alpha' ? old.promise : current.promise)
    render(tree())
    await settle()
    fireEvent.click(screen.getByText('Go beta'))
    await settle()
    await act(async () => old.resolve(snapshot('alpha')))
    expect(screen.queryByTestId('project-name')).toBeNull()
    await act(async () => current.resolve(snapshot('beta')))
    await settle()
    expect(screen.getByTestId('project-name').textContent).toBe('beta')
  })

  it('does not revive an old session when navigating alpha -> beta -> alpha', async () => {
    const old = deferred()
    mocks.boardApi.getOne.mockImplementationOnce(() => old.promise)
    render(tree())
    await settle()
    fireEvent.click(screen.getByText('Go beta'))
    await settle()
    fireEvent.click(screen.getByText('Go alpha'))
    await settle()
    await act(async () => old.resolve(snapshot('alpha', 'Obsolete Alpha')))
    await settle()
    expect(screen.getByTestId('project-name').textContent).toBe('alpha')
  })

  it.each(['resolve', 'reject'])('keeps the latest reconnect snapshot when the old read %ss', async (outcome) => {
    const old = deferred()
    mocks.boardApi.getOne.mockImplementationOnce(() => old.promise)
    const view = render(tree())
    await settle()
    mocks.socket.connected = true
    view.rerender(tree())
    await settle()
    expect(mocks.boardApi.getOne).toHaveBeenCalledTimes(2)
    await act(async () => old[outcome](outcome === 'resolve' ? snapshot('alpha', 'Obsolete Alpha') : new Error('Old read failed')))
    await settle()
    expect(screen.getByTestId('project-name').textContent).toBe('alpha')
    expect(screen.queryByText('Old read failed')).toBeNull()
  })

  it.each([
    ['getActivities', 'activity'], ['getMessages', 'chat'],
    ['getGitHubIntegration', 'github'], ['getGitHubCommits', 'github'], ['getGitHubStats', 'github'],
  ].flatMap(([method, panel]) => ['resolve', 'reject'].map((outcome) => [method, panel, outcome])))('isolates delayed %s (%s panel, %s)', async (method, panel, outcome) => {
    const old = deferred()
    const original = mocks.boardApi[method].getMockImplementation()
    mocks.boardApi[method].mockImplementation((id) => id === 'alpha' ? old.promise : original(id))
    render(tree(panel))
    await settle()
    expect(mocks.boardApi[method]).toHaveBeenCalledWith('alpha', 'token')
    fireEvent.click(screen.getByText('Go beta'))
    await settle()
    const expected = panelState()
    await act(async () => old[outcome](outcome === 'resolve' ? await original('alpha') : Object.assign(new Error('Old read failed'), { status: 429, retryAfter: 60 })))
    await settle()
    expect(panelState()).toEqual(expected)
    expect(screen.getByTestId('project-name').textContent).toBe('beta')
  })

  it('does not let an old repository-picker response replace the new session', async () => {
    const old = deferred()
    mocks.integrationApi.listGitHubRepos.mockImplementationOnce(() => old.promise)
    render(tree())
    await settle()
    fireEvent.click(screen.getByText('Go beta'))
    await settle()
    await act(async () => old.resolve(data({ repositories: [{ id: 99, fullName: 'old/repository' }] })))
    await settle()
    expect(panelState().repos).toEqual([])
    expect(panelState().reposLoading).toBe(false)
  })

  it('isolates an old account request after the auth token changes', async () => {
    const old = deferred()
    mocks.integrationApi.getGitHubAccount.mockImplementationOnce(() => old.promise)
    const view = render(tree())
    await settle()
    mocks.auth.token = 'new-token'
    mocks.integrationApi.getGitHubAccount.mockResolvedValue(data({ account: { username: 'new-account' } }))
    view.rerender(tree())
    await settle()
    await act(async () => old.resolve(data({ account: { username: 'old-account' } })))
    await settle()
    expect(panelState().account.username).toBe('new-account')
  })

  it('does not remount project state for panel-only navigation', async () => {
    render(tree())
    await settle()
    const calls = mocks.boardApi.getOne.mock.calls.length
    fireEvent.click(screen.getByText('Open chat'))
    await settle()
    expect(mocks.boardApi.getOne).toHaveBeenCalledTimes(calls)
    expect(panelState().messages[0].body).toBe('alpha')
  })
})
