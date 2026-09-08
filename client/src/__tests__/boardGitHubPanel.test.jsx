import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GitHubIntegrationPanel from '../components/board/GitHubIntegrationPanel'

afterEach(cleanup)
const repo = { id: 12, fullName: 'example/api', description: 'API service', language: 'JavaScript', defaultBranch: 'main' }
const props = () => ({
  board: { name: 'Uptime Desk' }, account: { username: 'alex' }, integration: null,
  repos: [repo, { id: 13, fullName: 'example/web', language: 'TypeScript' }], reposLoaded: true,
  commits: [], canEdit: true, onClose: vi.fn(), onRefreshRepos: vi.fn(),
  onLinkRepo: vi.fn().mockResolvedValue({}), onUnlinkRepo: vi.fn(),
  onRefreshStats: vi.fn(), onRefreshCommits: vi.fn(),
})
const panel = (values) => <MemoryRouter><GitHubIntegrationPanel {...values} /></MemoryRouter>

describe('project GitHub panel', () => {
  it('keeps the disconnected-account link and escape dismissal', () => {
    const values = { ...props(), account: null }
    render(panel(values))
    expect(screen.getByRole('link', { name: 'Open profile' }).getAttribute('href')).toBe('/profile')
    expect(screen.queryByLabelText('Search repositories')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(values.onClose).toHaveBeenCalledOnce()
  })

  it('searches repository name, description, and language and forwards the chosen repository', async () => {
    const values = props()
    render(panel(values))
    fireEvent.change(screen.getByLabelText('Search repositories'), { target: { value: ' javascript ' } })
    expect(screen.queryByRole('button', { name: /example\/web/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /example\/api/ }))
    await waitFor(() => expect(values.onLinkRepo).toHaveBeenCalledExactlyOnceWith(repo))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }))
    expect(values.onRefreshRepos).toHaveBeenCalledOnce()
  })

  it('retains read-only permissions, repository statistics, and commit links', () => {
    const values = {
      ...props(), canEdit: false, integration: { repoId: '12', repoFullName: repo.fullName, repoUrl: 'https://github.com/example/api', defaultBranch: 'main' },
      stats: { openPullRequests: 3, openIssues: 7 }, statsLoaded: true, commitsLoaded: true,
      commits: [{ sha: 'abc123', shortSha: 'abc123', message: 'Fix authentication\nExtra context', authorUsername: 'alex', committedAt: new Date().toISOString(), htmlUrl: 'https://github.com/example/api/commit/abc123' }],
    }
    render(panel(values))
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change repo' })).toBeNull()
    expect(screen.getByText('View only')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Fix authentication/ }).getAttribute('href')).toContain('/commit/abc123')
    fireEvent.click(within(screen.getByText('Repository pulse').closest('section')).getByRole('button', { name: 'Refresh' }))
    fireEvent.click(within(screen.getByText('Recent commits').closest('section')).getByRole('button', { name: 'Refresh' }))
    expect(values.onRefreshStats).toHaveBeenCalledOnce()
    expect(values.onRefreshCommits).toHaveBeenCalledOnce()
  })

  it('shows owner/admin link controls and prevents relinking the selected repository', () => {
    const values = { ...props(), integration: { repoId: '12', repoFullName: repo.fullName, repoUrl: 'https://github.com/example/api' } }
    render(panel(values))
    fireEvent.click(screen.getByRole('button', { name: 'Change repo' }))
    expect(screen.getByRole('button', { name: /example\/api/ }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    expect(values.onUnlinkRepo).toHaveBeenCalledOnce()
  })
})
