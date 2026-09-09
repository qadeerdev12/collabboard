import { Component } from 'react'

// Suspense handles pending imports, not rejected ones. A full reload also fetches
// the current asset manifest after a deployment replaces an old page chunk.
export default class PageErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-4 text-center text-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
          <p>We couldn't load this page. Please try again.</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
