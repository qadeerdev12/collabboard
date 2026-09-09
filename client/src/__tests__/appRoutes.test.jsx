import { lazy, Suspense } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import PageErrorBoundary from '../components/PageErrorBoundary'
import PageLoading from '../components/PageLoading'

const mocks = vi.hoisted(() => {
  let releaseBoard
  const boardReady = new Promise((resolve) => { releaseBoard = resolve })
  return { auth: { user: null, loading: false }, boardReady, releaseBoard, boardImport: vi.fn() }
})
vi.mock('../context/useAuth', () => ({ useAuth: () => mocks.auth }))
vi.mock('../pages/LandingPage', () => ({ default: () => <h1>Landing</h1> }))
vi.mock('../pages/LoginPage', () => ({ default: () => <h1>Login</h1> }))
vi.mock('../pages/RegisterPage', () => ({ default: () => <h1>Register</h1> }))
vi.mock('../pages/DashboardPage', () => ({ default: () => <h1>Dashboard</h1> }))
vi.mock('../pages/ProfilePage', () => ({ default: () => <h1>Profile</h1> }))
vi.mock('../pages/MyTasksPage', () => ({ default: () => <h1>My Tasks</h1> }))
vi.mock('../pages/ActivityPage', () => ({ default: () => <h1>Activity</h1> }))
vi.mock('../pages/BoardPage', async () => {
  mocks.boardImport()
  await mocks.boardReady
  return { default: () => <h1>Board</h1> }
})

function LocationProbe() {
  const location = useLocation()
  return <p>{location.pathname}{location.search}{location.hash}</p>
}

function show(path) {
  return render(<MemoryRouter initialEntries={[path]}><App /><LocationProbe /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  mocks.auth = { user: null, loading: false }
})

describe('lazy application routes', () => {
  it('does not import a protected page while checking auth or redirecting a guest', async () => {
    mocks.auth.loading = true
    show('/boards/project-1')
    expect(screen.getByRole('status')).toBeTruthy()
    expect(mocks.boardImport).not.toHaveBeenCalled()
    cleanup()
    mocks.auth.loading = false
    show('/boards/project-1')
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeTruthy()
    expect(mocks.boardImport).not.toHaveBeenCalled()
  })

  it('shows the fallback for a pending page and preserves the complete deep link', async () => {
    mocks.auth.user = { id: 'owner' }
    const path = '/boards/project-1?workflow=workflow-2&card=card-3#details'
    show(path)
    expect(screen.getByRole('status')).toBeTruthy()
    await act(async () => mocks.releaseBoard())
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy()
    expect(screen.getByText(path)).toBeTruthy()
  })

  it.each([
    ['/', 'Landing'], ['/login', 'Login'], ['/register', 'Register'],
    ['/dashboard', 'Dashboard'], ['/profile', 'Profile'], ['/my-tasks', 'My Tasks'],
    ['/activity', 'Activity'], ['/boards/project-1/activity', 'Activity'],
    ['/not-a-route', 'Landing'],
  ])('renders %s through its existing route', async (path, heading) => {
    mocks.auth.user = { id: 'owner' }
    show(path)
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
  })

  it('offers recovery when a page import rejects instead of leaving a blank screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const BrokenPage = lazy(() => Promise.reject(new Error('Chunk unavailable')))
    render(<PageErrorBoundary><Suspense fallback={<PageLoading />}><BrokenPage /></Suspense></PageErrorBoundary>)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
