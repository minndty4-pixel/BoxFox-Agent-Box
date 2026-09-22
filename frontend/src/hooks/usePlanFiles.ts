import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PlanRepositoryHttpError,
  createPlanRepository,
  createPlanStatusClient,
  reconcilePlanSelection,
} from '../lib/plans'
import type {
  PlanDocument,
  PlanEvaluation,
  PlanManifest,
  PlanRepository,
  PlanReviewState,
  PlanSelection,
  PlanStatusClient,
  PlanStatusReview,
} from '../lib/plans'
import { useUiStore } from '../store/uiStore'

export type PlanFilesStatus = 'loading' | 'ready' | 'empty' | 'error'

/** Quyết định người dùng đã lưu cho một bản plan (hợp đồng §2 `POST /api/agent/plans/review`). */
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
 *
 * Từ vòng 20 hàm này KHÔNG còn là nguồn kết luận "đã duyệt": `.reviews/` trên box rỗng trong khi
 * giao diện vẫn hiện hai nhóm "approved", vì nhãn cũ chỉ là vị trí trong danh sách version. Nguồn
 * thật là sổ duyệt của harness (`plan_reviews`), đọc qua `PlanStatusClient`. Giữ hàm lại vì nó mô
 * tả đúng hợp đồng của route box và còn dùng để đọc lại vết sau này.
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
  /** Quyết định đã lưu cho bản đang chọn, đọc từ sổ duyệt của harness (`plan_reviews`). */
  selectedReview: PlanStatusReview | null
  /** Trạng thái thật của nhóm: `none | draft | submitted | approved | changes_requested | unknown`. */
  planState: PlanReviewState
  /** `true` = bản đã bị sửa sau khi duyệt, chuẩn thuận cũ không còn áp dụng. */
  reviewStale: boolean
  /** `false` = chỉ mục box không đọc được, chưa biết bản này có được chấm P1–P8 hay không. */
  indexAvailable: boolean
  /** Bản chấm P1–P8 của đúng bản đang chọn; `null` với bản cũ chưa từng được chấm. */
  evaluation: PlanEvaluation | null
  /** Lỗi đọc trạng thái duyệt; hiện ở dải cảnh báo riêng, không lẫn với lỗi tải kế hoạch. */
  statusError: string | null
  /** `false` = quyết định đã vào sổ harness nhưng chưa chuyển được sang box; `null` = chưa ghi lần nào. */
  reviewForwarded: boolean | null
  reviewStatus: PlanReviewStatus
  reviewError: string | null
  /** Ghi quyết định duyệt / yêu cầu sửa xuống harness rồi tải lại kế hoạch + trạng thái. */
  submitReview: (decision: PlanReviewDecision, note?: string) => Promise<void>
}

/** Hook cho manifest/content, giữ lựa chọn khi refresh và bỏ mọi response cũ. */
export function usePlanFiles(
  repository?: PlanRepository,
  statusClient?: PlanStatusClient,
): PlanFilesState {
  const defaultRepository = useRef<PlanRepository | null>(null)
  if (!defaultRepository.current) defaultRepository.current = createPlanRepository()
  const activeRepository = repository ?? defaultRepository.current
  const defaultStatusClient = useRef<PlanStatusClient | null>(null)
  if (!defaultStatusClient.current) defaultStatusClient.current = createPlanStatusClient()
  const activeStatusClient = statusClient ?? defaultStatusClient.current
  const [manifest, setManifest] = useState<PlanManifest | null>(null)
  const [selection, setSelection] = useState<PlanSelection | null>(null)
  const [document, setDocument] = useState<PlanDocument | null>(null)
  const [status, setStatus] = useState<PlanFilesStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reviewStatus, setReviewStatus] = useState<PlanReviewStatus>('idle')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewForwarded, setReviewForwarded] = useState<boolean | null>(null)
  const [planState, setPlanState] = useState<PlanReviewState>('unknown')
  const [reviewStale, setReviewStale] = useState(false)
  const [indexAvailable, setIndexAvailable] = useState(true)
  const [evaluation, setEvaluation] = useState<PlanEvaluation | null>(null)
  const [selectedReview, setSelectedReview] = useState<PlanStatusReview | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  // `plan_written` của agent làm số này tăng → manifest được tải lại; lần nạp
  // khi mount vẫn giữ nguyên.
  const planRevision = useUiStore((s) => s.planRevision)
  const generationRef = useRef(0)
  // Lượt đọc trạng thái có bộ đếm riêng: tải manifest không được vô hiệu hoá một lượt đọc sổ duyệt
  // đang bay, và ngược lại.
  const statusGenerationRef = useRef(0)
  const selectionRef = useRef<PlanSelection | null>(null)
  const refreshRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  const resetStatus = useCallback(() => {
    statusGenerationRef.current += 1
    setPlanState('unknown')
    setReviewStale(false)
    setIndexAvailable(true)
    setEvaluation(null)
    setSelectedReview(null)
    setStatusError(null)
  }, [])

  /**
   * Đọc trạng thái duyệt thật + bản chấm P1–P8 cho đúng bản đang chọn.
   *
   * Hỏng đường này (`/api/agent/plans/status` chưa có, thiếu quyền, mất mạng) thì trạng thái là
   * `unknown` và chỉ có một dải cảnh báo — tuyệt đối không rơi về `approved` theo vị trí như trước.
   */
  const loadStatus = useCallback(
    async (nextSelection: PlanSelection | null) => {
      if (!nextSelection) {
        resetStatus()
        return
      }
      const generation = ++statusGenerationRef.current
      try {
        const report = await activeStatusClient.read(nextSelection.identity, nextSelection.version)
        if (generation !== statusGenerationRef.current) return
        setPlanState(report.state)
        setReviewStale(report.reviewStale)
        setIndexAvailable(report.indexAvailable)
        setEvaluation(report.evaluation)
        setSelectedReview(report.review)
        setStatusError(null)
      } catch (cause) {
        if (generation !== statusGenerationRef.current) return
        setPlanState('unknown')
        setReviewStale(false)
        setIndexAvailable(false)
        setEvaluation(null)
        // Không đọc được sổ duyệt thì không có quyết định nào để hiện: thà nói "không đọc được"
        // còn hơn giữ lại một quyết định cũ và để người dùng tưởng nó còn hiệu lực.
        setSelectedReview(null)
        setStatusError(messageFor(cause))
      }
    },
    [activeStatusClient, resetStatus],
  )

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
        await loadStatus(nextSelection)
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
    [activeRepository, loadStatus],
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
        resetStatus()
        return
      }

      const nextDocument = await activeRepository.read(nextSelection.identity, nextSelection.version)
      if (generation !== generationRef.current) return
      setDocument(nextDocument)
      setStatus('ready')
      await loadStatus(nextSelection)
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
            resetStatus()
            return
          }
          const retryDocument = await activeRepository.read(retrySelection.identity, retrySelection.version)
          if (generation !== generationRef.current) return
          setDocument(retryDocument)
          setStatus('ready')
          await loadStatus(retrySelection)
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
  }, [activeRepository, loadStatus, resetStatus])

  refreshRef.current = refresh

  useEffect(() => {
    void refresh()
    return () => {
      generationRef.current += 1
      statusGenerationRef.current += 1
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

  const submitReview = useCallback(
    async (decision: PlanReviewDecision, note = '') => {
      const current = selectionRef.current
      if (!current) {
        setReviewStatus('error')
        setReviewError('PLAN_REVIEW_NO_SELECTION: no plan document is selected')
        return
      }
      setReviewStatus('saving')
      setReviewError(null)
      setReviewForwarded(null)
      try {
        // Ghi vào SỔ DUYỆT của harness (kèm số version, để duyệt v1 không làm v2 thành đã duyệt);
        // harness tự chuyển tiếp sang box và trả `forwarded`.
        const outcome = await activeStatusClient.submitReview(
          current.identity,
          current.version,
          decision,
          note,
        )
        setReviewForwarded(outcome.forwarded)
        await refresh()
        setReviewStatus('idle')
      } catch (cause) {
        setReviewStatus('error')
        setReviewError(messageFor(cause))
      }
    },
    [activeStatusClient, refresh],
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
    planState,
    reviewStale,
    indexAvailable,
    evaluation,
    statusError,
    reviewForwarded,
    reviewStatus,
    reviewError,
    submitReview,
  }
}

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unable to load plan files.'
}
