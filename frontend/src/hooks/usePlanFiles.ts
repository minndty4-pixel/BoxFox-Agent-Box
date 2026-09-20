import { useCallback, useEffect, useRef, useState } from 'react'
import { createPlanRepository, PlanRepositoryHttpError, reconcilePlanSelection } from '../lib/plans'
import type { PlanDocument, PlanManifest, PlanRepository, PlanSelection } from '../lib/plans'
import { resolveBoxApiKey, resolveBoxApiUrl } from '../lib/boxApi'
import { useUiStore } from '../store/uiStore'

export type PlanFilesStatus = 'loading' | 'ready' | 'empty' | 'error'

/** Quyết định người dùng đã lưu cho một bản plan (hợp đồng §2 `/__box/plans/review`). */
export type PlanReviewDecision = 'approved' | 'changes_requested'

export interface PlanReview {
  identity: string
  decision: PlanReviewDecision
  note: string
  updatedAt: number
}

export type PlanReviewStatus = 'idle' | 'saving' | 'error'

/**
 * Đọc `review` mà `GET /__box/plans` trả kèm mỗi bản ghi (hoặc `null`). Dữ liệu
 * tới từ mạng nên kiểm tra từng trường thay vì tin vào kiểu.
 */
export function readPlanReview(entry: unknown): PlanReview | null {
  if (!entry || typeof entry !== 'object') return null
  const review = (entry as { review?: unknown }).review
  if (!review || typeof review !== 'object') return null
  const { identity, decision, note, updatedAt } = review as Record<string, unknown>
  if (typeof identity !== 'string') return null
  if (decision !== 'approved' && decision !== 'changes_requested') return null
  return {
    identity,
    decision,
    note: typeof note === 'string' ? note : '',
    updatedAt: typeof updatedAt === 'number' ? updatedAt : 0,
  }
}

export interface PlanFilesState {
  status: PlanFilesStatus
  manifest: PlanManifest | null
  selection: PlanSelection | null
  document: PlanDocument | null
  error: string | null
  refresh: () => Promise<void>
  selectIdentity: (identity: string, version?: number) => void
  selectVersion: (version: number) => void
  /** Quyết định đã lưu cho bản plan đang chọn (đọc từ chính manifest của container). */
  selectedReview: PlanReview | null
  reviewStatus: PlanReviewStatus
  reviewError: string | null
  /** Ghi quyết định duyệt / yêu cầu sửa xuống container rồi tải lại manifest. */
  submitReview: (decision: PlanReviewDecision, note?: string) => Promise<void>
}

/** Hook cho manifest/content, giữ lựa chọn khi refresh và bỏ mọi response cũ. */
export function usePlanFiles(repository?: PlanRepository): PlanFilesState {
  const defaultRepository = useRef<PlanRepository | null>(null)
  if (!defaultRepository.current) defaultRepository.current = createPlanRepository()
  const activeRepository = repository ?? defaultRepository.current
  const [manifest, setManifest] = useState<PlanManifest | null>(null)
  const [selection, setSelection] = useState<PlanSelection | null>(null)
  const [document, setDocument] = useState<PlanDocument | null>(null)
  const [status, setStatus] = useState<PlanFilesStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reviewStatus, setReviewStatus] = useState<PlanReviewStatus>('idle')
  const [reviewError, setReviewError] = useState<string | null>(null)
  // `plan_written` của agent làm số này tăng → manifest được tải lại; lần nạp
  // khi mount vẫn giữ nguyên.
  const planRevision = useUiStore((s) => s.planRevision)
  const generationRef = useRef(0)
  const selectionRef = useRef<PlanSelection | null>(null)
  const refreshRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  const loadDocument = useCallback(
    async (nextSelection: PlanSelection, retryOnMissing: boolean) => {
      const generation = ++generationRef.current
      setDocument(null)
      setStatus('loading')
      setError(null)
      try {
        const nextDocument = await activeRepository.read(nextSelection.identity, nextSelection.version)
        if (generation !== generationRef.current) return
        setDocument(nextDocument)
        setStatus('ready')
      } catch (cause) {
        if (generation !== generationRef.current) return
        if (retryOnMissing && cause instanceof PlanRepositoryHttpError && cause.status === 404) {
          void refreshRef.current?.()
          return
        }
        setError(messageFor(cause))
        setStatus('error')
      }
    },
    [activeRepository],
  )

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current
    setStatus('loading')
    setError(null)
    try {
      const nextManifest = await activeRepository.list()
      if (generation !== generationRef.current) return
      const nextSelection = reconcilePlanSelection(nextManifest, selectionRef.current)
      setManifest(nextManifest)
      setSelection(nextSelection)
      setDocument(null)
      if (!nextSelection) {
        setStatus('empty')
        return
      }

      const nextDocument = await activeRepository.read(nextSelection.identity, nextSelection.version)
      if (generation !== generationRef.current) return
      setDocument(nextDocument)
      setStatus('ready')
    } catch (cause) {
      if (generation !== generationRef.current) return
      if (cause instanceof PlanRepositoryHttpError && cause.status === 404) {
        // File có thể biến mất giữa list/read; refresh manifest đúng một lần.
        try {
          const retryManifest = await activeRepository.list()
          if (generation !== generationRef.current) return
          const retrySelection = reconcilePlanSelection(retryManifest, selectionRef.current)
          setManifest(retryManifest)
          setSelection(retrySelection)
          if (!retrySelection) {
            setDocument(null)
            setStatus('empty')
            return
          }
          const retryDocument = await activeRepository.read(retrySelection.identity, retrySelection.version)
          if (generation !== generationRef.current) return
          setDocument(retryDocument)
          setStatus('ready')
          return
        } catch (retryCause) {
          if (generation !== generationRef.current) return
          setError(messageFor(retryCause))
          setStatus('error')
          return
        }
      }
      setError(messageFor(cause))
      setStatus('error')
    }
  }, [activeRepository])

  refreshRef.current = refresh

  useEffect(() => {
    void refresh()
    return () => {
      generationRef.current += 1
    }
  }, [refresh, planRevision])

  const selectIdentity = useCallback(
    (identity: string, version?: number) => {
      const plan = manifest?.plans.find((item) => item.identity === identity)
      if (!plan) return
      // Ngữ cảnh của ý định tự mở tab có thể chỉ đích danh một version; không có
      // thì lấy bản mới nhất như trước.
      const target =
        version !== undefined ? plan.versions.find((item) => item.version === version) : undefined
      const chosen = target ?? plan.versions[0]
      if (!chosen) return
      const nextSelection = { identity, version: chosen.version }
      setSelection(nextSelection)
      void loadDocument(nextSelection, true)
    },
    [loadDocument, manifest],
  )

  const selectVersion = useCallback(
    (version: number) => {
      if (!selection || selection.version === version) return
      const plan = manifest?.plans.find((item) => item.identity === selection.identity)
      if (!plan?.versions.some((item) => item.version === version)) return
      const nextSelection = { identity: selection.identity, version }
      setSelection(nextSelection)
      void loadDocument(nextSelection, true)
    },
    [loadDocument, manifest, selection],
  )

  // Nhãn nút Duyệt/Yêu cầu sửa đọc thẳng trạng thái container đã lưu, không
  // giữ bản sao cục bộ nào.
  const selectedReview = readPlanReview(
    manifest?.plans.find((item) => item.identity === selection?.identity),
  )

  const submitReview = useCallback(
    async (decision: PlanReviewDecision, note = '') => {
      const identity = selectionRef.current?.identity
      if (!identity) {
        setReviewStatus('error')
        setReviewError('PLAN_REVIEW_NO_SELECTION: no plan document is selected')
        return
      }
      setReviewStatus('saving')
      setReviewError(null)
      try {
        await requestPlanReview(identity, decision, note)
        await refresh()
        setReviewStatus('idle')
      } catch (cause) {
        setReviewStatus('error')
        setReviewError(messageFor(cause))
      }
    },
    [refresh],
  )

  return {
    status,
    manifest,
    selection,
    document,
    error,
    refresh,
    selectIdentity,
    selectVersion,
    selectedReview,
    reviewStatus,
    reviewError,
    submitReview,
  }
}

/** `POST /__box/plans/review` — cùng quy ước khoá API với repository workspace. */
async function requestPlanReview(
  identity: string,
  decision: PlanReviewDecision,
  note: string,
): Promise<void> {
  const response = await fetch(`${resolveBoxApiUrl(import.meta.env)}/__box/plans/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BoxFox-Api-Key': resolveBoxApiKey(import.meta.env),
    },
    body: JSON.stringify({ identity, decision, note }),
  })
  if (response.ok) return
  let message = `Plan review failed (${response.status}).`
  try {
    const payload = (await response.json()) as { error?: string }
    if (payload && typeof payload.error === 'string') message = payload.error
  } catch {
    // Nội dung không phải JSON — giữ thông báo mặc định.
  }
  throw new Error(message)
}

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unable to load plan files.'
}
