import { create } from 'zustand'
import type { RouterRequestMeta } from '../types/provider'
import {
  RouterStreamError,
  streamRouterGenerate,
  type RouterGenerateBody,
  type RouterTokenUsage,
  type RouterToolCallDelta,
} from '../lib/routerStream'

export type RouterChatSelection =
  | { kind: 'model'; connectionId: string; modelId: string }
  | { kind: 'alias'; aliasId: string }

export type RouterChatTurnStatus = 'streaming' | 'completed' | 'failed' | 'cancelled'

export interface RouterChatTurn {
  id: string
  prompt: string
  imageUrl?: string | null
  response: string
  selection: RouterChatSelection
  status: RouterChatTurnStatus
  startedAt: string
  completedAt: string | null
  latencyMs: number | null
  meta: RouterRequestMeta | null
  usage: RouterTokenUsage | null
  finishReason: string | null
  toolCalls: RouterToolCallDelta[]
  error: string | null
}

interface RouterChatState {
  draft: string
  attachedImage: string | null
  selection: RouterChatSelection | null
  turns: RouterChatTurn[]
  isSending: boolean
  activeTurnId: string | null
  setDraft: (draft: string) => void
  setAttachedImage: (url: string | null) => void
  setSelection: (selection: RouterChatSelection | null) => void
  send: (prompt?: string, selectionOverride?: RouterChatSelection, imageOverride?: string | null) => Promise<boolean>
  retry: (turnId: string) => Promise<boolean>
  stop: () => void
  clear: () => void
}

let activeController: AbortController | null = null
let generation = 0
let idCounter = 0

function makeId() {
  idCounter += 1
  return `router-turn-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function updateTurn(
  turns: RouterChatTurn[],
  turnId: string,
  updater: (turn: RouterChatTurn) => RouterChatTurn,
) {
  return turns.map((turn) => (turn.id === turnId ? updater(turn) : turn))
}

function selectionBody(selection: RouterChatSelection): Pick<RouterGenerateBody, 'connectionId' | 'modelId' | 'aliasId'> {
  return selection.kind === 'alias'
    ? { aliasId: selection.aliasId }
    : { connectionId: selection.connectionId, modelId: selection.modelId }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

const initialData = {
  draft: '',
  attachedImage: null as string | null,
  selection: null as RouterChatSelection | null,
  turns: [] as RouterChatTurn[],
  isSending: false,
  activeTurnId: null as string | null,
}

export const useRouterChatStore = create<RouterChatState>((set, get) => ({
  ...initialData,
  setDraft: (draft) => set({ draft }),
  setAttachedImage: (attachedImage) => set({ attachedImage }),
  setSelection: (selection) => set({ selection }),

  send: async (prompt, selectionOverride, imageOverride) => {
    if (get().isSending) return false
    const text = (prompt ?? get().draft).trim()
    const selection = selectionOverride ?? get().selection
    const activeImage = imageOverride !== undefined ? imageOverride : get().attachedImage
    if (!text && !activeImage) return false
    if (!selection) return false

    const turnId = makeId()
    const startedAtMs = nowMs()
    const controller = new AbortController()
    const run = ++generation
    activeController = controller

    const turn: RouterChatTurn = {
      id: turnId,
      prompt: text,
      imageUrl: activeImage,
      response: '',
      selection,
      status: 'streaming',
      startedAt: new Date().toISOString(),
      completedAt: null,
      latencyMs: null,
      meta: null,
      usage: null,
      finishReason: null,
      toolCalls: [],
      error: null,
    }

    set((state) => ({
      turns: [...state.turns, turn],
      draft: prompt === undefined ? '' : state.draft,
      attachedImage: null,
      isSending: true,
      activeTurnId: turnId,
    }))

    // Build multi-turn conversational history with memory
    const historyMessages: RouterGenerateBody['messages'] = [
      {
        role: 'system',
        content:
          'You are BoxFox Agent, an elite autonomous AI software engineer and computer-use agent.\n' +
          'Maintain continuity across conversational turns. Remember facts, code, and instructions mentioned earlier in this session.',
      },
    ]

    for (const prev of get().turns) {
      if (prev.id !== turnId && prev.status === 'completed' && prev.response) {
        if (prev.imageUrl) {
          historyMessages.push({
            role: 'user',
            content: [
              { type: 'text', text: prev.prompt },
              { type: 'image_url', image_url: { url: prev.imageUrl } },
            ],
          })
        } else {
          historyMessages.push({ role: 'user', content: prev.prompt })
        }
        historyMessages.push({ role: 'assistant', content: prev.response })
      }
    }

    const currentContent = activeImage
      ? [
          { type: 'text' as const, text: text || 'Please inspect this image.' },
          { type: 'image_url' as const, image_url: { url: activeImage } },
        ]
      : text

    historyMessages.push({ role: 'user', content: currentContent })

    const body: RouterGenerateBody = {
      ...selectionBody(selection),
      messages: historyMessages,
      stream: true,
      max_tokens: 4096,
    }

    try {
      await streamRouterGenerate(body, {
        signal: controller.signal,
        onEvent: (event) => {
          if (run !== generation || get().activeTurnId !== turnId) return
          set((state) => ({
            turns: updateTurn(state.turns, turnId, (current) => {
              switch (event.type) {
                case 'meta':
                  return { ...current, meta: event.meta }
                case 'content':
                  return { ...current, response: current.response + event.content }
                case 'tools':
                  return { ...current, toolCalls: [...current.toolCalls, ...event.toolCalls] }
                case 'usage':
                  return { ...current, usage: event.usage }
                case 'finish':
                  return { ...current, finishReason: event.finishReason }
                case 'done':
                  return current
              }
            }),
          }))
        },
      })

      if (run !== generation || get().activeTurnId !== turnId) return false
      const completedAt = new Date().toISOString()
      const latencyMs = Math.max(0, Math.round(nowMs() - startedAtMs))
      set((state) => ({
        turns: updateTurn(state.turns, turnId, (current) => ({
          ...current,
          status: 'completed',
          completedAt,
          latencyMs,
        })),
        isSending: false,
        activeTurnId: null,
      }))
      activeController = null
      return true
    } catch (error) {
      if (run !== generation || get().activeTurnId !== turnId) return false
      const completedAt = new Date().toISOString()
      const latencyMs = Math.max(0, Math.round(nowMs() - startedAtMs))
      const cancelled = controller.signal.aborted || isAbortError(error)
      const message =
        cancelled
          ? null
          : error instanceof RouterStreamError || error instanceof Error
            ? error.message
            : 'Router request failed.'

      set((state) => ({
        turns: updateTurn(state.turns, turnId, (current) => ({
          ...current,
          status: cancelled ? 'cancelled' : 'failed',
          completedAt,
          latencyMs,
          error: message,
        })),
        isSending: false,
        activeTurnId: null,
      }))
      activeController = null
      return false
    }
  },

  retry: async (turnId) => {
    const turn = get().turns.find((item) => item.id === turnId)
    if (!turn) return false
    return get().send(turn.prompt, turn.selection)
  },

  stop: () => {
    const turnId = get().activeTurnId
    if (!turnId || !activeController) return
    generation += 1
    const controller = activeController
    activeController = null
    controller.abort()
    const completedAt = new Date().toISOString()
    set((state) => ({
      turns: updateTurn(state.turns, turnId, (current) => ({
        ...current,
        status: 'cancelled',
        completedAt,
        latencyMs: current.latencyMs,
        error: null,
      })),
      isSending: false,
      activeTurnId: null,
    }))
  },

  clear: () => {
    generation += 1
    activeController?.abort()
    activeController = null
    set({ ...initialData, selection: get().selection })
  },
}))

export function resetRouterChatStoreForTests() {
  generation += 1
  activeController?.abort()
  activeController = null
  idCounter = 0
  useRouterChatStore.setState({ ...initialData })
}
