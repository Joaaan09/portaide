// Datos mock de la vista Chat — conversaciones calcadas del mockup canónico
// `Editor Movil (offline).html` (CHAT0/CHAT1) para validar el tono visual 1:1.
// Desaparecen cuando llegue el puente real con el CLI `claude` (Fase 3).
import type { AssistantChatItem, ChatSession } from './types'

let seq = 0

/** Id secuencial legible para items/sesiones mock */
export function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${seq}`
}

/** Conversación 1 del mockup: "auth refactor" */
function createAuthRefactorChat(): ChatSession {
  return {
    id: uid('chat'),
    name: 'auth refactor',
    items: [
      {
        kind: 'user',
        id: uid('msg'),
        text: 'Refactor auth.service.ts to use the new TokenService and add refresh-token rotation.',
      },
      {
        kind: 'assistant',
        id: uid('msg'),
        blocks: [
          {
            type: 'thinking',
            text: 'The service signs JWTs inline with a shared secret. I’ll inject TokenService, move signing there, and add rotate() so each login mints a fresh refresh token.',
          },
          { type: 'read', file: 'src/services/auth.service.ts', meta: '142 lines' },
          {
            type: 'edit',
            id: uid('edit'),
            file: 'src/services/auth.service.ts',
            additions: 2,
            deletions: 1,
            decision: 'pending',
            diff: [
              { kind: 'ctx', text: '  async login(email, password) {' },
              { kind: 'ctx', text: '    const user = await this.users.verify(...)' },
              { kind: 'del', text: '    const token = jwt.sign(payload, SECRET)' },
              { kind: 'add', text: '    const token = this.tokens.issue(payload)' },
              { kind: 'add', text: '    const refresh = this.tokens.rotate(user.id)' },
              { kind: 'ctx', text: '    return { token, refresh }' },
            ],
          },
          {
            type: 'text',
            text: 'Signing now lives in TokenService and each login rotates the refresh token. Want me to run the tests?',
          },
        ],
      },
      { kind: 'user', id: uid('msg'), text: 'Yes, run them.' },
      {
        kind: 'assistant',
        id: uid('msg'),
        blocks: [
          {
            type: 'bash',
            command: 'npm test -- auth',
            output: [
              { text: 'PASS  tests/auth.test.ts', ok: true },
              { text: '  ✓ issues a token pair on login (18ms)', ok: true },
              { text: '  ✓ rotates refresh token (7ms)', ok: true },
              { text: 'Tests: 12 passed, 12 total', ok: true },
            ],
          },
          { type: 'text', text: 'All 12 tests pass — the refactor is complete.' },
        ],
      },
    ],
  }
}

/** Conversación 2 del mockup: "fix flaky test" */
function createFlakyTestChat(): ChatSession {
  return {
    id: uid('chat'),
    name: 'fix flaky test',
    items: [
      {
        kind: 'user',
        id: uid('msg'),
        text: 'The user.service test is flaky on CI. Can you find out why?',
      },
      {
        kind: 'assistant',
        id: uid('msg'),
        blocks: [
          {
            type: 'thinking',
            text: 'Likely shared in-memory state between tests that isn’t reset.',
          },
          { type: 'read', file: 'tests/user.service.test.ts', meta: '86 lines' },
          {
            type: 'text',
            text: 'The suite reuses one in-memory DB across tests without resetting it. Add a beforeEach that clears it?',
          },
        ],
      },
    ],
  }
}

/** Estado inicial: las dos conversaciones del mockup */
export function createInitialSessions(): ChatSession[] {
  return [createAuthRefactorChat(), createFlakyTestChat()]
}

/** Sesión vacía para el botón `+` (nuevo chat) */
export function createEmptySession(): ChatSession {
  return { id: uid('chat'), name: 'new chat', items: [] }
}

/** Respuesta mock tras enviar un mensaje (misma que la del mockup) */
export function createMockReply(): AssistantChatItem {
  return {
    kind: 'assistant',
    id: uid('msg'),
    blocks: [
      { type: 'read', file: 'src/services/auth.service.ts', meta: '142 lines' },
      {
        type: 'text',
        text: 'On it — reading the relevant files, then I’ll propose an edit you can review.',
      },
    ],
  }
}
