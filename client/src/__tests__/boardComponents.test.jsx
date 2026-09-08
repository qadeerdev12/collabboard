import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AddWorkflowModal from '../components/board/AddWorkflowModal'
import WorkflowSwitcher from '../components/board/WorkflowSwitcher'
import ProjectWelcomeState from '../components/board/ProjectWelcomeState'
import ActiveWorkflowToolbar from '../components/board/ActiveWorkflowToolbar'
import BoardFilters from '../components/board/BoardFilters'
import BoardHeader from '../components/board/BoardHeader'
import { BoardEmptyState, BoardLoadError } from '../components/board/BoardPageStates'
import { ThemeContext } from '../context/themeContextValue'
import { memberUserId } from '../lib/boardMembers'

vi.mock('../components/BoardSwitcher', () => ({ default: ({ currentBoard }) => <span>{currentBoard.name}</span> }))
vi.mock('../components/NotificationBell', () => ({ default: () => <button>Notifications</button> }))
afterEach(cleanup)

const template = { id: 'software-sprint', name: 'Software Sprint', icon: 'workflow', lists: ['Backlog', 'Done'], cards: [], summary: 'Sprint planning' }
const workflows = [{ _id: 'general', name: 'General' }, { _id: 'sprint', name: 'Software Sprint' }]

describe('workflow components', () => {
  it('creates a custom workflow with the unchanged request payload', async () => {
    const onCreate = vi.fn().mockResolvedValue({}), onClose = vi.fn()
    render(<AddWorkflowModal templates={[template]} onCreate={onCreate} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Add workflow', exact: true }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Custom Workflow/ }))
    fireEvent.change(screen.getByLabelText('Workflow name'), { target: { value: '  API Roadmap  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add workflow', exact: true }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ name: 'API Roadmap', templateKey: 'custom', icon: 'workflow', color: 'slate' })
  })

  it('preserves a typed name when selecting a template and allows retry after creation fails', async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error('Try again')).mockResolvedValue({})
    const onClose = vi.fn()
    render(<AddWorkflowModal templates={[template]} onCreate={onCreate} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Workflow name'), { target: { value: 'September sprint' } })
    fireEvent.click(screen.getByRole('button', { name: /Software Sprint/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add workflow', exact: true }))
    await screen.findByText('Try again')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add workflow', exact: true }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onCreate).toHaveBeenLastCalledWith({ workflowTemplateId: 'software-sprint', name: 'September sprint' })
  })

  it('retains escape dismissal and allows custom creation when templates fail to load', () => {
    const onClose = vi.fn()
    render(<AddWorkflowModal templates={[]} templatesError="Unavailable" onClose={onClose} onCreate={vi.fn()} />)
    expect(screen.getByText(/Workflow templates could not load/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Custom Workflow/ }))
    expect(screen.getByRole('button', { name: 'Add workflow', exact: true }).disabled).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('switches workflows through callbacks and gates workflow creation', () => {
    const onSelect = vi.fn(), onAdd = vi.fn()
    const props = { workflows, activeWorkflowId: 'general', listsByWorkflow: { general: 2 }, cardsByWorkflow: { general: 5 }, onSelect, onAdd }
    const view = render(<WorkflowSwitcher {...props} canAdd />)
    expect(screen.getByRole('button', { name: /General.*2 lists/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Software Sprint/ }))
    expect(onSelect).toHaveBeenCalledWith('sprint')
    fireEvent.click(screen.getByRole('button', { name: 'Add workflow' }))
    expect(onAdd).toHaveBeenCalledOnce()
    view.rerender(<WorkflowSwitcher {...props} canAdd={false} />)
    expect(screen.queryByRole('button', { name: 'Add workflow' })).toBeNull()
  })

  it('keeps quick-start permissions and duplicate-submission guards', () => {
    const onQuickStart = vi.fn()
    const props = { boardName: 'Uptime Desk', templates: [template], onQuickStart }
    const view = render(<ProjectWelcomeState {...props} canAdd />)
    fireEvent.click(screen.getByRole('button', { name: /Software Sprint/ }))
    expect(onQuickStart).toHaveBeenCalledWith(template)
    view.rerender(<ProjectWelcomeState {...props} canAdd pendingTemplateId={template.id} />)
    expect(screen.getByRole('button', { name: /Adding/ }).disabled).toBe(true)
    view.rerender(<ProjectWelcomeState {...props} canAdd={false} />)
    expect(screen.getByRole('button', { name: 'Add workflow' }).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /Software Sprint/ })).toBeNull()
  })

  it('forwards the add-list form without owning page state', () => {
    const onAddList = vi.fn((event) => event.preventDefault()), onNewListTitleChange = vi.fn()
    render(<ActiveWorkflowToolbar activeWorkflow={workflows[1]} listCount={2} cardCount={5} newListTitle="Review" onAddList={onAddList} onNewListTitleChange={onNewListTitleChange} />)
    fireEvent.change(screen.getByLabelText('Add list to active workflow'), { target: { value: 'QA' } })
    expect(onNewListTitleChange).toHaveBeenCalledWith('QA')
    fireEvent.click(screen.getByRole('button', { name: 'Add list' }))
    expect(onAddList).toHaveBeenCalledOnce()
  })
})

describe('board page presentation', () => {
  it('forwards filter controls, clear, and filtered counts', () => {
    const onSearchChange = vi.fn(), onTagChange = vi.fn(), onStatusChange = vi.fn(), onClear = vi.fn()
    render(<BoardFilters cardSearch="API" tagFilter="all" statusFilter="all" filtersActive filteredCardCount={1} totalCardCount={8} onSearchChange={onSearchChange} onTagChange={onTagChange} onStatusChange={onStatusChange} onClear={onClear} />)
    fireEvent.change(screen.getByLabelText('Search cards'), { target: { value: 'Release' } })
    fireEvent.change(screen.getByLabelText('Filter by tag'), { target: { value: 'Bug' } })
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'Done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onSearchChange).toHaveBeenCalledWith('Release')
    expect(onTagChange).toHaveBeenCalledWith('Bug')
    expect(onStatusChange).toHaveBeenCalledWith('Done')
    expect(onClear).toHaveBeenCalledOnce()
    expect(screen.getByText('1 of 8 shown')).toBeTruthy()
  })

  it.each(['owner', 'admin', 'member'])('preserves %s header actions, links, and notification access', (role) => {
    const handlers = { onManageMembers: vi.fn(), onOpenGitHub: vi.fn(), onOpenChat: vi.fn(), onEditBoard: vi.fn(), onDeleteBoard: vi.fn() }
    const toggle = vi.fn()
    render(<MemoryRouter><ThemeContext.Provider value={{ dark: false, toggle }}>
      <BoardHeader boardId="project" board={{ _id: 'project', name: 'Uptime Desk' }} members={[{ user: { _id: 'user', name: 'Alex' } }]} activeWorkflow={workflows[1]} listCount={2} totalCardCount={5} connected onlineCount={2} canEditBoard={role !== 'member'} canDeleteBoard={role === 'owner'} unreadMessages={3} {...handlers} />
    </ThemeContext.Provider></MemoryRouter>)
    expect(Boolean(screen.queryByRole('button', { name: 'Edit', exact: true }))).toBe(role !== 'member')
    expect(Boolean(screen.queryByRole('button', { name: 'Delete project' }))).toBe(role === 'owner')
    expect(screen.getByRole('link', { name: 'Activity' }).getAttribute('href')).toBe('/boards/project/activity')
    fireEvent.click(screen.getByRole('button', { name: /Members/ }))
    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }))
    fireEvent.click(screen.getByRole('button', { name: /Chat/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(handlers.onManageMembers).toHaveBeenCalledOnce()
    expect(handlers.onOpenGitHub).toHaveBeenCalledOnce()
    expect(handlers.onOpenChat).toHaveBeenCalledOnce()
    expect(toggle).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy()
  })

  it('keeps full-page error recovery and workflow empty text', () => {
    const onRetry = vi.fn(), onBack = vi.fn()
    const view = render(<BoardLoadError message="Unavailable" onRetry={onRetry} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
    view.rerender(<BoardEmptyState boardName="Project" workflowName="Sprint" />)
    expect(screen.getByText('Sprint is ready for its first list.')).toBeTruthy()
  })

  it('normalizes all existing member ID payload shapes', () => {
    for (const user of ['user', { id: 'user' }, { _id: 'user' }]) expect(memberUserId({ user })).toBe('user')
  })
})
