# AI Task Drafting

## Setup

Set `OPENAI_API_KEY` and `OPENAI_TASK_DRAFT_MODEL` in `server/.env`, then restart
the API server. Use a model available to your OpenAI API project that supports
the Responses API and strict JSON-schema output. No default model is silently
selected. Missing configuration returns `503 AI_NOT_CONFIGURED`; the rest of
SDLCFlow works normally. Never expose these values through `VITE_` variables or
commit secrets. API usage is billed to the configured provider account.

The provider integration follows the official
[Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).
It uses native server-side fetch, so no SDK/package is required.

## Flow and ownership

1. In an existing card, open **Draft with AI**, enter an optional brief, and generate.
2. `POST /boards/:boardId/cards/:cardId/draft` authenticates the user, verifies
   membership and card scope, then validates `{ title, brief }`.
3. `taskDraftService` sends only the submitted title (up to 300 characters) and
   brief (up to 4000 characters) to OpenAI. Stored descriptions, comments,
   checklist contents, member identities, and GitHub data are not fetched/sent.
4. A strict schema requests `{ description, tag, checklist }`; the server also
   validates lengths, labels, and item count before returning `{ data: { draft } }`.
   Refusals, incomplete output, malformed output, and upstream errors fail safely.
5. The editable preview is local state. **Use description and label** replaces
   the modal's unsaved fields; **Save changes** persists them normally. Individual
   checklist plus buttons save reviewed items immediately through `checklistOperation`.
   Discarding/closing a draft does not undo checklist items already added.

Generation does not mutate the database, create activity, or emit socket events.
Applying a suggestion uses the existing card mutation path, including permission
checks and realtime broadcasts. Existing checklist items/completion states are
never replaced. Concurrent scalar field edits retain existing last-write behavior.

## Boundaries

- No tools, repository access, retrieval, or autonomous actions are granted to AI.
  User input is untrusted data; generated text is rendered as text, never HTML.
- `store: false` is sent; this is not a promise of zero provider retention. Review
  the provider's data policies before sending confidential data.
- Requests time out after 20 seconds, output is capped at 1800 tokens, and no
  automatic retries occur. The local per-user guard permits one in-flight request
  and five attempts per minute per server process. Errors count as attempts.
- This guard is not a spending cap. Before multi-instance/public deployment, use
  a shared limiter, abuse controls, and provider billing limits/monitoring.
- Generation may finish after the user closes the modal; it is ignored by the UI
  but may still incur provider usage. Accepted writes may finish after closing.
- Reopening/regenerating does not track prior suggestions across sessions. Review
  the live checklist before adding an item again. Existing checklist limit is 100.

## Verification

`taskDraft.test.js` uses a temporary database and mocked provider responses to
cover permissions, privacy boundaries, validation, provider errors, and limits.
`taskDraftPanel.test.jsx` covers explicit review, edited suggestions, checklist
additions, discard, errors, and stale responses. No paid/live provider calls are
made by the tests. A real model smoke test and output-quality review are required
after local credentials/model selection and before release.
