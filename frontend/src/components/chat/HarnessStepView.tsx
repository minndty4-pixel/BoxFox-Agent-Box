import React, { useState, useMemo, useEffect } from 'react'
import { useT } from '../../i18n/context'
import {
  Terminal,
  Camera,
  FileText,
  Search,
  BrainCircuit,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Copy,
  Check,
  Hexagon,
  X,
  Maximize2,
  Layers,
  Film,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react'
import type { HarnessEvent } from '../../store/harnessChatStore'
import type { ProviderSnapshot } from '../../types/provider'
import type { RouterChatSelection } from '../../store/routerChatStore'
import { MarkdownRenderer } from './MarkdownRenderer'
import { formatAttachmentSize } from './AttachmentPicker'
import { absoluteWorkspacePath } from '../../lib/chat/attachmentUpload'
import { appendStreamText } from '../../lib/streamText'
import { ProviderIcon } from '../providers/ProviderIcon'
import type { LightboxMediaProps } from './MediaLightboxModal'

/** Tab mà một chip trong transcript có thể mở (hợp đồng §3 — gợi ý, không ra lệnh). */
export type TranscriptTabId = 'plan' | 'decisions' | 'subagents'

interface HarnessStepViewProps {
  events: HarnessEvent[]
  status: string
  error: string | null
  connectionWarning?: string | null
  onDismissWarning?: () => void
  onOpenLightbox?: (media: LightboxMediaProps) => void
  snapshot?: ProviderSnapshot | null
  selection?: RouterChatSelection | null
  /** Mở tab tại chỗ khi người dùng bấm chip kế hoạch / sub-agent / quyết định. */
  onOpenTab?: (tab: TranscriptTabId, target?: Record<string, unknown> | null) => void
}

/**
 * Một mục trong dòng thời gian của lượt (F2). Lượt được vẽ như MỘT danh sách
 * phẳng theo `seq`, không gom tool/ảnh vào accordion hay gallery riêng.
 */
type TurnTimelineItem =
  | { kind: 'text'; id: string; seq: number; text: string; live: boolean }
  | { kind: 'tool'; id: string; seq: number; start: HarnessEvent | null; end: HarnessEvent | null }
  | { kind: 'child'; id: string; seq: number; event: HarnessEvent }
  | { kind: 'plan'; id: string; seq: number; event: HarnessEvent }
  | { kind: 'decision'; id: string; seq: number; event: HarnessEvent; resolution?: HarnessEvent }
  | { kind: 'compression'; id: string; seq: number; event: HarnessEvent }
  | { kind: 'notice'; id: string; seq: number; event: HarnessEvent }

interface HarnessTurn {
  id: string
  modelChange?: { from: string; to: string } | null
  userEvent: HarnessEvent | null
  thought: string | null
  items: TurnTimelineItem[]
  finalAssistant: HarnessEvent | null
  usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    reasoning_tokens?: number
  } | null
  target: {
    modelId?: string
    connectionId?: string
    aliasId?: string | null
  } | null
  finish: HarnessEvent | null
  startTime: number
  endTime: number
  isCompleted: boolean
  error?: string | null
}

/** Ảnh/video sinh ra bởi một lần gọi tool (nguồn thật: payload `tool_end`). */
export interface ToolMedia {
  eventSeq: number
  kind: 'image' | 'video'
  src: string
  mime: string | null
  dimensions: [number, number] | null
  artifactPath: string | null
  caption: string
  sourceUrl?: string
  durationSec?: number
  /** D3: tệp có thật nhưng bản ghi không chạy `stop` trọn vẹn → không có số thời lượng. */
  unfinished?: boolean
}

/** i18n thuộc workstream khác — hai nhãn này được export thẳng từ component. */
export const FINAL_ANSWER_EXPAND_LABEL = 'View details'
export const FINAL_ANSWER_COLLAPSE_LABEL = 'Hide details'
export const FINAL_ANSWER_SUMMARY_MAX_CHARS = 600
export const FINAL_ANSWER_SUMMARY_MAX_LINES = 6

/** R2 (yêu cầu 5): số liệu của khối hoạt động — đếm từ chính dữ liệu lượt, không phải từ prop. */
export interface ActivityCounts {
  thinking: boolean
  commands: number
  captures: number
  failed: number
  unfinished: number
}

export interface ActivityReceiptPart {
  label: string
  tone: 'muted' | 'rose' | 'amber'
}

export const ACTIVITY_TONE_CLASS: Record<ActivityReceiptPart['tone'], string> = {
  muted: 'text-zinc-400',
  rose: 'text-rose-400',
  amber: 'text-amber-400',
}

/**
 * R2: dòng biên nhận in đúng những gì đang nằm trong khối hoạt động, để việc gấp khối không
 * giấu mất chuyện "có lệnh chưa trả kết quả". Trả mảng đoạn thuần (không JSX) để kiểm thử được
 * bằng đơn vị; đoạn đếm 0 bị bỏ, không có gì thì trả mảng rỗng.
 */
export function activityReceipt(counts: ActivityCounts): ActivityReceiptPart[] {
  const parts: ActivityReceiptPart[] = []
  if (counts.thinking) parts.push({ label: 'Thinking', tone: 'muted' })
  if (counts.commands > 0) {
    parts.push({ label: `${counts.commands} ${counts.commands === 1 ? 'command' : 'commands'}`, tone: 'muted' })
  }
  if (counts.captures > 0) {
    parts.push({ label: `${counts.captures} ${counts.captures === 1 ? 'capture' : 'captures'}`, tone: 'muted' })
  }
  if (counts.failed > 0) parts.push({ label: `${counts.failed} failed`, tone: 'rose' })
  if (counts.unfinished > 0) parts.push({ label: `${counts.unfinished} without result`, tone: 'amber' })
  return parts
}

/** Văn xuôi: không mở đầu bằng tiêu đề, bảng, danh sách hay trích dẫn. */
const SUMMARY_BLOCK_OPENER = /^\s*(#{1,6}\s|\||[-*+]\s|>\s?|\d+[.)]\s|```)/
const SUMMARY_SENTENCE_MARKS = ['.', '!', '?', ':', '…']

/**
 * R3 (yêu cầu 6): bộ nhận biết ranh giới tóm tắt/chi tiết đọc **cấu trúc của chính câu trả lời**.
 * Đoạn đầu tới dòng trống đầu tiên là tóm tắt khi nó là văn xuôi, nằm trong hạn 6 dòng/600 ký tự
 * và **có** phần còn lại để mở. Trả `null` khi không chắc — người gọi quay về đường cắt cũ, chứ
 * không im lặng cắt ở một chỗ vô nghĩa.
 */
export function splitAuthoredSummary(text: string): { summary: string; rest: string } | null {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const blank = lines.findIndex((line) => line.trim() === '')
  // Không có dòng trống (hoặc đoạn đầu rỗng) → không có gì tách ra.
  if (blank <= 0) return null
  const block = lines.slice(0, blank)
  const rest = lines.slice(blank).join('\n').trim()
  if (!rest) return null
  if (block.length > FINAL_ANSWER_SUMMARY_MAX_LINES) return null
  let summary = block.join('\n').trim()
  if (!summary || summary.length > FINAL_ANSWER_SUMMARY_MAX_CHARS) return null
  if (SUMMARY_BLOCK_OPENER.test(summary) || summary.includes('```')) return null
  // Đoạn kết giữa câu → lùi về mốc câu cuối cùng trong đoạn đó; không có mốc nào thì không nhận.
  if (!/[.!?:…]$/.test(summary)) {
    let cut = -1
    for (const mark of SUMMARY_SENTENCE_MARKS) cut = Math.max(cut, summary.lastIndexOf(mark))
    if (cut < 0) return null
    summary = summary.slice(0, cut + 1).trim()
    if (!summary) return null
  }
  return { summary, rest }
}

/**
 * R3: hai luật an toàn khối cho lát cắt cũ — không kết thúc trong khối ``` ``` chưa đóng và không
 * giữ nửa hàng bảng. Chỉ bỏ phần đuôi; không bao giờ làm lát cắt rỗng.
 */
function safetyTrim(summary: string): string {
  let result = summary
  const fences = (result.match(/```/g) ?? []).length
  if (fences % 2 === 1) {
    const fenceLineStart = result.lastIndexOf('\n', result.lastIndexOf('```')) + 1
    if (fenceLineStart > 0) result = result.slice(0, fenceLineStart).replace(/\s+$/, '')
  }
  const rows = result.split('\n')
  if (rows.length > 1) {
    const last = rows[rows.length - 1].trim()
    const prev = rows[rows.length - 2].trim()
    if (last.includes('|') && !last.endsWith('|') && prev.startsWith('|')) {
      result = rows.slice(0, -1).join('\n').replace(/\s+$/, '')
    }
  }
  return result || summary
}

/** F3: không bịa nội dung suy luận — chỉ nói đúng những gì model trả về. */
export function reasoningTokensNotice(reasoningTokens: number): string {
  return `Model returned ${reasoningTokens} reasoning tokens; no streamed reasoning text.`
}

/** F7: thông báo nén context ở cấp cao nhất của lượt, kèm số token thật. */
export function compactionNoticeText(data: Record<string, unknown>): string {
  const kind = String(data.kind ?? 'unchanged')
  const before = typeof data.beforeEstimate === 'number' ? data.beforeEstimate : null
  const after = typeof data.afterEstimate === 'number' ? data.afterEstimate : null
  if (kind === 'unchanged') return 'No compaction needed — context is still within budget.'
  if (kind === 'summary_failed') {
    return before === null
      ? 'Context compaction failed; the original transcript was preserved.'
      : `Context compaction failed; the original transcript was preserved (${before} tokens).`
  }
  if (before !== null && after !== null) return `Context compacted: ${before} → ${after} tokens`
  if (before !== null) return `Context compaction requested (${before} tokens)`
  return 'Context compaction applied'
}

function toMs(t?: number): number {
  if (!t) return Date.now()
  return t < 1e11 ? t * 1000 : t
}

function formatTokens(n?: number): string {
  if (typeof n !== 'number') return '0'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return 'Just now'
  const d = new Date(toMs(timestamp))
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** F4: đọc kích thước thật từ payload (`dimensions` có thể là mảng, object hay chuỗi). */
export function parseDimensions(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const w = Number(value[0])
    const h = Number(value[1])
    return Number.isFinite(w) && Number.isFinite(h) ? [w, h] : null
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const w = Number(obj.width ?? obj.w)
    const h = Number(obj.height ?? obj.h)
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? [w, h] : null
  }
  if (typeof value === 'string') {
    const match = value.match(/(\d+)\s*[x×]\s*(\d+)/)
    if (match) return [Number(match[1]), Number(match[2])]
  }
  return null
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv']

const MIME_LABELS: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/webp': 'WEBP',
  'image/svg+xml': 'SVG',
  'image/gif': 'GIF',
  'video/mp4': 'MP4',
  'video/webm': 'WEBM',
  'video/quicktime': 'MOV',
}

function extensionOf(path: string): string {
  const clean = path.split('?')[0].toLowerCase()
  const dot = clean.lastIndexOf('.')
  return dot === -1 ? '' : clean.slice(dot)
}

/** F4: nhãn `1280 × 800 · PNG` — số đo lấy từ chính `tool_end`, không hardcode. */
export function formatMediaLabel(media: Pick<ToolMedia, 'mime' | 'dimensions' | 'artifactPath' | 'durationSec' | 'kind'>): string {
  const parts: string[] = []
  if (media.dimensions) parts.push(`${media.dimensions[0]} × ${media.dimensions[1]}`)
  const ext = media.artifactPath ? extensionOf(media.artifactPath) : ''
  const mimeLabel =
    (media.mime && MIME_LABELS[media.mime.toLowerCase()]) ||
    (ext ? ext.replace('.', '').toUpperCase() : '')
  if (media.kind === 'video' && typeof media.durationSec === 'number') parts.push(`${media.durationSec}s`)
  if (mimeLabel) parts.push(mimeLabel)
  return parts.join(' · ')
}

function boxMediaUrl(artifactPath: string): string {
  const relPath = artifactPath.replace(/^\/home\/agent\/workspace\//, '')
  return `/__box/file/media?path=${encodeURIComponent(relPath)}`
}

/**
 * Đường dẫn tệp thật của một hàng `tool_end` (nếu có). Dùng để biết hàng `start` của một bản ghi
 * đã có hàng nào khác trong cùng lượt nói tới chưa — xem `TurnBlock` (D3).
 */
export function artifactPathOf(event: HarnessEvent | null | undefined): string | null {
  const result = event?.data?.result
  const resObj = result && typeof result === 'object' ? (result as Record<string, unknown>) : null
  if (!resObj) return null
  // Hàng `ok:false` nói về một lần gọi hỏng, không nói về một tệp có thật.
  if (resObj.ok === false) return null
  return typeof resObj.artifact === 'string' ? resObj.artifact : typeof resObj.path === 'string' ? resObj.path : null
}

/**
 * F2 + F4: ảnh/video của `tool_end` lấy từ payload thật, gắn ngay dưới hàng tool.
 *
 * `opts.allowStartMedia` chỉ có tác dụng với hàng `start` của `computer_screen_record` — hàng này
 * trả về đường dẫn tệp ĐANG ghi, không phải tệp đã đóng. Mặc định `false` để một bản ghi đã đóng
 * đúng không hiện hai player (một ở hàng `start`, một ở hàng `stop`). `TurnBlock` bật nó lên **chỉ
 * khi** trong lượt không hàng nào khác nói về chính tệp ấy — ca bản ghi bị cắt ngang
 * (`1789929795687-screen.mp4`): tệp có thật trên đĩa mà trước đây không có đường nào mở.
 */
export function extractToolMedia(
  event: HarnessEvent,
  opts?: { allowStartMedia?: boolean },
): ToolMedia | null {
  const result = event.data?.result
  const resObj = result && typeof result === 'object' ? (result as Record<string, unknown>) : null
  if (!resObj) return null
  // Hàng `ok:false` nói về một lần gọi hỏng, không nói về một tệp có thật → không có dòng media.
  if (resObj.ok === false) return null

  const name = String(event.data?.name ?? '')
  const args = event.data?.args as Record<string, unknown> | null
  const action = String(args?.action ?? '')
  const inlineImage = typeof resObj.image === 'string' ? resObj.image : null
  const artifactPath = artifactPathOf(event)
  const mime = typeof resObj.mime === 'string' ? resObj.mime : null
  const dimensions = parseDimensions(resObj.dimensions)
  const durationSec = typeof resObj.durationSec === 'number' ? resObj.durationSec : undefined

  let src: string | null = inlineImage ? `data:${mime || 'image/png'};base64,${inlineImage}` : null
  let kind: 'image' | 'video' = 'image'
  let unfinished = false
  if (!src && artifactPath) {
    const ext = extensionOf(artifactPath)
    if (VIDEO_EXTENSIONS.includes(ext)) {
      // `action=start` của computer_screen_record trả về đường dẫn tệp ĐANG ghi. Chỉ nhận nó khi
      // người gọi xác nhận không hàng nào khác trong lượt nói về chính tệp ấy; nếu không, một bản
      // ghi sẽ hiện thành hai player: một ở hàng `start`, một ở hàng `stop`.
      if (action === 'start' && !opts?.allowStartMedia) return null
      // D3: thiếu `durationSec` không có nghĩa là không có tệp. Bản ghi bị cắt ngang (`stop`
      // không trả số) vẫn là một tệp CÓ THẬT trên đĩa — bỏ nó đi là không còn đường nào mở tệp
      // đó ra. Giữ dòng media, để trống thời lượng và đánh dấu là chưa trọn.
      if (typeof durationSec !== 'number') unfinished = true
      src = boxMediaUrl(artifactPath)
      kind = 'video'
    } else if (IMAGE_EXTENSIONS.includes(ext)) {
      src = boxMediaUrl(artifactPath)
    }
  }
  if (!src) return null

  return {
    eventSeq: event.seq,
    kind,
    src,
    mime,
    dimensions,
    artifactPath,
    caption:
      kind === 'video'
        ? 'Sandbox Screen Recording'
        : name === 'browser_use'
          ? 'Browser Page Screenshot'
          : 'Sandbox Desktop Screen Capture',
    sourceUrl: typeof args?.url === 'string' ? args.url : undefined,
    durationSec,
    unfinished,
  }
}

function resolveProvider(modelId?: string, connectionId?: string, snapshot?: ProviderSnapshot | null): string {
  if (connectionId && snapshot?.connections) {
    const conn = snapshot.connections.find((c) => c.id === connectionId)
    if (conn?.providerId) return conn.providerId
  }
  const m = (modelId || '').toLowerCase()
  if (m.includes('gemini') || m.includes('google')) return 'gemini'
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic'
  if (m.includes('gpt') || m.includes('openai') || m.includes('o1') || m.includes('o3')) return 'openai'
  if (m.includes('antigravity') || m.includes('boxfox')) return 'antigravity'
  return 'antigravity'
}

function getToolDisplay(name: string, args: Record<string, unknown> | null, isError: boolean): {
  actionLabel: string
  detailLabel: string
  icon: React.ReactNode
} {
  switch (name) {
    case 'terminal_exec': {
      const cmd = String(args?.command || args?.cmd || 'command')
      const shortCmd = cmd.length > 38 ? cmd.slice(0, 35) + '...' : cmd
      return {
        actionLabel: 'Ran',
        detailLabel: shortCmd,
        icon: <Terminal className="size-3.5 text-brand" />,
      }
    }
    case 'file_write':
    case 'file_edit': {
      const path = String(args?.path || args?.target || 'file')
      const fileName = path.split(/[/\\]/).pop() || path
      return {
        actionLabel: 'Edited',
        detailLabel: fileName,
        icon: <FileText className="size-3.5 text-amber-400" />,
      }
    }
    case 'file_read': {
      const path = String(args?.path || args?.target || 'file')
      const fileName = path.split(/[/\\]/).pop() || path
      return {
        actionLabel: 'Explored',
        detailLabel: fileName,
        icon: <FileText className="size-3.5 text-sky-400" />,
      }
    }
    case 'codebase_grep':
    case 'codebase_glob': {
      const q = String(args?.query || args?.pattern || 'patterns')
      return {
        actionLabel: 'Explored',
        detailLabel: `codebase (${q})`,
        icon: <Search className="size-3.5 text-purple-400" />,
      }
    }
    case 'computer_screen_capture': {
      return {
        actionLabel: 'Captured',
        detailLabel: 'sandbox display',
        icon: <Camera className="size-3.5 text-blue-400" />,
      }
    }
    case 'computer_screen_record': {
      return {
        actionLabel: 'Recorded',
        detailLabel: 'sandbox display',
        icon: <Film className="size-3.5 text-fuchsia-400" />,
      }
    }
    case 'browser_use': {
      return {
        actionLabel: 'Explored',
        detailLabel: 'browser page',
        icon: <Camera className="size-3.5 text-emerald-400" />,
      }
    }
    case 'delegate_task': {
      return {
        actionLabel: 'Delegated',
        detailLabel: `specialist (${String(args?.role || 'agent')})`,
        icon: <BrainCircuit className="size-3.5 text-brand" />,
      }
    }
    default: {
      return {
        actionLabel: isError ? 'Failed' : 'Executed',
        detailLabel: name,
        icon: <Terminal className="size-3.5 text-brand" />,
      }
    }
  }
}

/** F6 + R3 (yêu cầu 6): tóm tắt do chính câu trả lời viết, hoặc lát cắt cũ có luật an toàn khối. */
export function summarizeFinalText(text: string): { summary: string; truncated: boolean } {
  const normalized = text.replace(/\r\n/g, '\n')

  // R3: đoạn đầu nguyên văn của chính câu trả lời là tóm tắt — không rút gọn, không viết lại.
  const authored = splitAuthoredSummary(normalized)
  if (authored) return { summary: authored.summary, truncated: true }

  // Không nhận ra cấu trúc → giữ nguyên đường cắt hôm nay (6 dòng, rồi 600 ký tự)…
  const lines = normalized.split('\n')
  const cutOff =
    lines.length > FINAL_ANSWER_SUMMARY_MAX_LINES || normalized.length > FINAL_ANSWER_SUMMARY_MAX_CHARS
  let summary = lines.slice(0, FINAL_ANSWER_SUMMARY_MAX_LINES).join('\n')
  if (summary.length > FINAL_ANSWER_SUMMARY_MAX_CHARS) {
    summary = summary.slice(0, FINAL_ANSWER_SUMMARY_MAX_CHARS)
  }
  // …cộng hai luật an toàn khối, để lát cắt không rơi vào giữa khối code hay nửa hàng bảng.
  if (cutOff) summary = safetyTrim(summary)
  const truncated = summary.length < normalized.length
  return {
    summary: truncated ? summary.replace(/\s+$/, '') + '…' : normalized,
    truncated,
  }
}

function applyTimelineEvent(turn: HarnessTurn, event: HarnessEvent) {
  // F5: thời lượng chỉ được cộng khi lượt CHƯA kết thúc. Event `finish`/`error` đầu tiên
  // vẫn chốt được mốc kết thúc (kể cả khi `assistant` final đã tới trước đó), nhưng sau đó
  // lượt đóng băng — không còn bị kéo dài bởi event tới muộn (lượt cancel 36s từng hiện 1702s).
  const terminal = event.type === 'finish' || event.type === 'error'
  const firstTerminal = terminal && !turn.finish && !turn.error
  if (!turn.isCompleted || firstTerminal) {
    turn.endTime = Math.max(turn.endTime, event.created)
  }

  switch (event.type) {
    case 'thought': {
      // Event có thể là văn bản tích luỹ (harness cũ) hoặc mảnh rời (harness mới).
      turn.thought = appendStreamText(turn.thought ?? '', String(event.data.text ?? ''))
      return
    }
    case 'usage': {
      turn.usage = event.data.usage as HarnessTurn['usage']
      turn.target =
        (event.data.target as HarnessTurn['target']) || (event.data.model ? { modelId: String(event.data.model) } : null)
      return
    }
    case 'assistant_delta': {
      const text = String(event.data.text ?? '')
      const last = turn.items[turn.items.length - 1]
      if (last && last.kind === 'text' && last.live) {
        last.text = appendStreamText(last.text, text)
      } else {
        turn.items.push({ kind: 'text', id: `text_${event.seq}`, seq: event.seq, text, live: true })
      }
      return
    }
    case 'assistant': {
      if (event.data.thought) turn.thought = String(event.data.thought)
      const text = String(event.data.text ?? '')
      const isFinal = event.data.final !== false
      const last = turn.items[turn.items.length - 1]
      if (isFinal) {
        turn.finalAssistant = event
        turn.isCompleted = true
        // Văn bản đang stream chính là câu trả lời cuối: bỏ khỏi timeline để không lặp.
        if (last && last.kind === 'text' && (last.live || (text && text.startsWith(last.text)))) {
          turn.items.pop()
        }
      } else if (last && last.kind === 'text') {
        // Event `assistant` (final:false) là bản đầy đủ của đúng đoạn vừa stream.
        last.text = text
        last.live = false
      } else if (text) {
        turn.items.push({ kind: 'text', id: `text_${event.seq}`, seq: event.seq, text, live: false })
      }
      return
    }
    case 'tool_start': {
      turn.items.push({
        kind: 'tool',
        id: `tool_${event.data.id ?? event.seq}`,
        seq: event.seq,
        start: event,
        end: null,
      })
      return
    }
    case 'tool_end': {
      const callId = event.data.id
      const pending = findPendingTool(turn, callId)
      if (pending) pending.end = event
      else turn.items.push({ kind: 'tool', id: `tool_${event.seq}`, seq: event.seq, start: null, end: event })
      return
    }
    case 'child': {
      turn.items.push({ kind: 'child', id: `child_${event.seq}`, seq: event.seq, event })
      return
    }
    case 'plan_written': {
      // Chip kế hoạch trong transcript — bấm để mở đúng bản vừa ghi ở tab Plan.
      turn.items.push({ kind: 'plan', id: `plan_${event.seq}`, seq: event.seq, event })
      return
    }
    case 'decision_requested': {
      turn.items.push({
        kind: 'decision',
        id: `decision_${String(event.data.decisionId ?? event.seq)}`,
        seq: event.seq,
        event,
      })
      return
    }
    case 'decision_resolved': {
      // Một hàng duy nhất cho mỗi quyết định: cập nhật tại chỗ, không thêm hàng mới.
      const existing = turn.items.find(
        (item): item is Extract<TurnTimelineItem, { kind: 'decision' }> =>
          item.kind === 'decision' && item.event.data.decisionId === event.data.decisionId,
      )
      if (existing) existing.resolution = event
      else {
        turn.items.push({
          kind: 'decision',
          id: `decision_${String(event.data.decisionId ?? event.seq)}`,
          seq: event.seq,
          event,
          resolution: event,
        })
      }
      return
    }
    case 'compression': {
      turn.items.push({ kind: 'compression', id: `compaction_${event.seq}`, seq: event.seq, event })
      return
    }
    case 'notice': {
      // Harness báo thử lại yêu cầu model: câu trả lời vừa stream bị bỏ, nên phần văn bản
      // đang hiện của lượt này phải biến mất — nếu không, câu trả lời mới bị dán vào phần cũ.
      if (event.data.reset) {
        while (turn.items.length > 0) {
          const last = turn.items[turn.items.length - 1]
          if (last.kind !== 'text' || !last.live) break
          turn.items.pop()
        }
        turn.thought = ''
      }
      turn.items.push({ kind: 'notice', id: `notice_${event.seq}`, seq: event.seq, event })
      return
    }
    case 'finish': {
      turn.finish = event
      turn.isCompleted = true
      return
    }
    case 'error': {
      turn.error = String(event.data?.message ?? 'Turn execution error')
      turn.isCompleted = true
      return
    }
    default:
      // `step`, `command_resolved`, `skill_loaded`, `executor`... chỉ là telemetry.
      return
  }
}

function findPendingTool(turn: HarnessTurn, callId: unknown): Extract<TurnTimelineItem, { kind: 'tool' }> | null {
  for (let i = turn.items.length - 1; i >= 0; i -= 1) {
    const item = turn.items[i]
    if (item.kind === 'tool' && !item.end && (item.start?.data.id === callId || callId === undefined)) return item
  }
  return null
}

/**
 * Một hàng cho mỗi quyết định của agent: câu hỏi nằm ngay chỗ nó được hỏi, và
 * một nút mở tab Decisions tại đúng yêu cầu đó. Trạng thái đọc từ
 * `decision_resolved` thật — không có bộ đếm hạn nào do giao diện bịa.
 */
function DecisionRow({
  event,
  resolution,
  onOpenTab,
}: {
  event: HarnessEvent
  resolution?: HarnessEvent
  onOpenTab?: (tab: TranscriptTabId, target?: Record<string, unknown> | null) => void
}) {
  const t = useT()
  const data = event.data ?? {}
  const decisionId = String(data.decisionId ?? '')
  const question = String(data.question ?? data.action ?? '')
  const kind = String(data.kind ?? 'question')
  const status = resolution ? String(resolution.data?.status ?? '') : 'pending'
  const timedOut = resolution ? String(resolution.data?.reason ?? '') === 'timeout' : false

  const statusLabel = timedOut
    ? t('decisions.status.expired')
    : status === 'approved'
      ? t('decisions.status.approved')
      : status === 'rejected'
        ? t('decisions.status.rejected')
        : status === 'cancelled'
          ? t('decisions.status.cancelled')
          : t('decisions.status.pending')

  return (
    <div
      data-timeline="decision"
      data-decision-id={decisionId || undefined}
      data-decision-status={status}
      className="max-w-2xl rounded-lg border border-amber-500/45 bg-amber-500/5 px-2.5 py-2"
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
        <span
          className={`size-1.5 rounded-full bg-amber-500 ${status === 'pending' ? 'animate-pulse' : 'opacity-50'}`}
        />
        <span>
          {status === 'pending'
            ? t('chat.decisionWaiting')
            : `${kind === 'approval' ? t('decisions.kind.approval') : t('decisions.kind.question')} · ${statusLabel}`}
        </span>
      </div>
      {question && <p className="mt-1 text-xs leading-relaxed text-fg select-text">{question}</p>}
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenTab?.('decisions', decisionId ? { requestId: decisionId } : null)}
          className="group inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] font-medium text-muted transition hover:bg-panel2 hover:text-fg cursor-pointer"
        >
          <ShieldAlert className="size-3" />
          <span className="group-hover:underline">{t('chat.openDecisionTab')}</span>
          <ChevronRight className="size-3 opacity-0 transition group-hover:opacity-100" />
        </button>
        {resolution && (
          <span className="font-mono text-[10px] text-muted">{statusLabel}</span>
        )}
      </div>
    </div>
  )
}

function emptyTurn(id: string, modelChange: { from: string; to: string } | null, userEvent: HarnessEvent | null, created: number): HarnessTurn {
  return {
    id,
    modelChange,
    userEvent,
    thought: null,
    items: [],
    finalAssistant: null,
    usage: null,
    target: null,
    finish: null,
    startTime: created,
    endTime: created,
    isCompleted: false,
  }
}

function sortItems(items: TurnTimelineItem[]): TurnTimelineItem[] {
  return [...items].sort((a, b) => a.seq - b.seq)
}

/** F2 + F5: nhóm event thành lượt theo `user`, dựng timeline phẳng theo `seq`. */
export function buildHarnessTurns(events: HarnessEvent[]): HarnessTurn[] {
  const list: HarnessTurn[] = []
  let current: HarnessTurn | null = null
  let pendingModelChange: { from: string; to: string } | null = null
  // `command_resolved` được phát TRƯỚC `user` ở mọi lượt. F5: không dựng lượt "ma" từ
  // những event này — chỉ gắn vào lượt kế tiếp (và chúng vốn không được vẽ).
  let preUserEvents: HarnessEvent[] = []

  const closeTurn = () => {
    if (!current) return
    current.items = sortItems(current.items)
    list.push(current)
    current = null
  }

  for (const event of events) {
    if (event.type === 'model_change') {
      pendingModelChange = { from: String(event.data.from || ''), to: String(event.data.to || '') }
      continue
    }

    if (event.type === 'user') {
      closeTurn()
      current = emptyTurn(`turn_${event.seq}`, pendingModelChange, event, event.created)
      pendingModelChange = null
      preUserEvents = []
      continue
    }

    if (!current) {
      preUserEvents.push(event)
      continue
    }

    applyTimelineEvent(current, event)
  }

  closeTurn()

  // Fallback: transcript không có event `user` nào (dữ liệu cũ/không đầy đủ) — vẫn phải
  // hiển thị thay vì làm mất toàn bộ nội dung.
  if (list.length === 0 && preUserEvents.length > 0) {
    const fallback = emptyTurn('turn_pre_user', pendingModelChange, null, preUserEvents[0].created)
    for (const event of preUserEvents) applyTimelineEvent(fallback, event)
    fallback.items = sortItems(fallback.items)
    list.push(fallback)
  }

  return list
}

export function HarnessStepView({
  events,
  status,
  error,
  connectionWarning,
  onDismissWarning,
  onOpenLightbox,
  snapshot,
  selection,
  onOpenTab,
}: HarnessStepViewProps) {
  const isBusy = status === 'running' || status === 'starting'

  const turns = useMemo(() => buildHarnessTurns(events), [events])

  return (
    <div className="space-y-6 font-sans select-text">
      {turns.map((turn, index) => {
        const isLastTurn = index === turns.length - 1
        const isTurnBusy = isLastTurn && isBusy && !turn.isCompleted

        return (
          <div key={turn.id} data-turn-latest={isLastTurn ? 'true' : undefined} data-turn-user="true">
            <TurnBlock
              turn={turn}
              isTurnBusy={isTurnBusy}
              onOpenLightbox={onOpenLightbox}
              snapshot={snapshot}
              selection={selection}
              onOpenTab={onOpenTab}
            />
          </div>
        )
      })}

      {/* Provider Connection Warning / Error: báo cùng chữ đỏ inline, không tạo box mới, tự động ẩn khi chat mới / đang chạy */}
      {!isBusy && connectionWarning && (
        <div className="flex items-center justify-between gap-2 py-1 text-xs text-rose-400 font-sans leading-relaxed select-text animate-in fade-in duration-150">
          <span className="flex-1">{connectionWarning}</span>
          {onDismissWarning && (
            <button
              type="button"
              onClick={onDismissWarning}
              className="text-zinc-500 hover:text-zinc-300 transition p-0.5 rounded cursor-pointer shrink-0"
              title="Đóng cảnh báo"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Global Error: only show if the session is currently failed AND error is not already shown in any turn AND not busy */}
      {!isBusy && status === 'failed' && error && !turns.some(t => t.error === error) && (
        <div className="py-1.5 text-xs text-rose-400 font-sans leading-relaxed select-text animate-in fade-in duration-150">
          {error}
        </div>
      )}
    </div>
  )
}

function TurnBlock({
  turn,
  isTurnBusy,
  onOpenLightbox,
  snapshot,
  selection,
  onOpenTab,
}: {
  turn: HarnessTurn
  isTurnBusy: boolean
  onOpenLightbox?: (media: LightboxMediaProps) => void
  snapshot?: ProviderSnapshot | null
  selection?: RouterChatSelection | null
  onOpenTab?: (tab: TranscriptTabId, target?: Record<string, unknown> | null) => void
}) {
  const t = useT()
  const [copiedUser, setCopiedUser] = useState(false)
  const [copiedAssistant, setCopiedAssistant] = useState(false)

  // Xác định Model info và Provider
  const targetModelId =
    turn.target?.modelId ??
    (selection?.kind === 'model' ? selection.modelId : selection?.kind === 'alias' ? selection.aliasId : 'gemini-3.7-flash-high')

  const targetConnId =
    turn.target?.connectionId ??
    (selection?.kind === 'model' ? selection.connectionId : undefined)

  const providerId = resolveProvider(targetModelId, targetConnId, snapshot)

  // F5: endTime chỉ được cộng khi lượt chưa xong.
  const durationSec = Math.max(1, Math.round((toMs(turn.endTime) - toMs(turn.startTime)) / 1000))

  // Tool đang chạy (chưa có `tool_end`) — vẫn nằm đúng vị trí trong timeline.
  const pendingTool = useMemo(
    () => turn.items.find((item) => item.kind === 'tool' && !item.end) ?? null,
    [turn.items],
  )

  // D3: hàng `start` chỉ được hiện tệp khi trong lượt KHÔNG hàng nào khác nói về chính tệp ấy.
  // Ca thật: `1789929795687-screen.mp4` (560 s) — lượt chết vì DEADLINE trước khi kịp chạy `stop`,
  // tệp nằm trên đĩa mà chat không có đường nào mở. Nhiều hàng `start` cùng một tệp thì chỉ hàng
  // đầu tiên được hiện, để một tệp không thành hai player.
  const startAllowedSeqs = useMemo(() => {
    const startSeqs = new Map<string, number[]>()
    const closed = new Set<string>()
    for (const item of turn.items) {
      if (item.kind !== 'tool' || !item.end) continue
      const path = artifactPathOf(item.end)
      if (!path) continue
      const action = String((item.end.data?.args as Record<string, unknown> | null)?.action ?? '')
      if (action === 'start') {
        startSeqs.set(path, [...(startSeqs.get(path) ?? []), item.end.seq])
      } else {
        closed.add(path)
      }
    }
    const allowed = new Set<number>()
    for (const [path, seqs] of startSeqs) {
      if (!closed.has(path)) allowed.add(Math.min(...seqs))
    }
    return allowed
  }, [turn.items])

  const turnMedia = useMemo(() => {
    const media: ToolMedia[] = []
    const seen = new Set<string>()
    for (const item of turn.items) {
      if (item.kind !== 'tool' || !item.end) continue
      const found = extractToolMedia(item.end, { allowStartMedia: startAllowedSeqs.has(item.end.seq) })
      // Cùng một tệp có thể xuất hiện ở nhiều tool_end; chỉ hiện một lần.
      const key = found?.artifactPath ?? found?.src ?? ''
      if (found && !seen.has(key)) {
        seen.add(key)
        media.push(found)
      }
    }
    return media
  }, [turn.items, startAllowedSeqs])

  const reasoningTokens = typeof turn.usage?.reasoning_tokens === 'number' ? turn.usage.reasoning_tokens : 0
  const thoughtText = turn.thought && turn.thought.trim() ? turn.thought : null

  // R2 (yêu cầu 5): số liệu của dòng biên nhận đếm từ chính dữ liệu lượt — không có con số nào
  // được viết tay ở đây. `captures` dùng danh sách media đã khử trùng của lượt.
  const counts = useMemo<ActivityCounts>(() => {
    let commands = 0
    let failed = 0
    let unfinished = 0
    for (const item of turn.items) {
      if (item.kind !== 'tool') continue
      commands += 1
      const result = item.end?.data?.result
      if (result && typeof result === 'object' && (result as Record<string, unknown>).is_error) failed += 1
      if (!item.end && turn.isCompleted) unfinished += 1
    }
    return { thinking: Boolean(thoughtText), commands, captures: turnMedia.length, failed, unfinished }
  }, [turn.items, turn.isCompleted, thoughtText, turnMedia])

  const receipt = useMemo(() => activityReceipt(counts), [counts])

  // Khối hoạt động: mở khi lượt đang chạy, gấp còn dòng biên nhận khi lượt xong — nhưng ý định
  // của người dùng thắng: đã bấm thì không tự đổi nữa.
  const hasActivity = Boolean(thoughtText) || turn.items.length > 0 || isTurnBusy
  const [activityOpen, setActivityOpen] = useState(() => !turn.isCompleted)
  const [activityTouched, setActivityTouched] = useState(false)
  useEffect(() => {
    if (!activityTouched && turn.isCompleted) setActivityOpen(false)
  }, [turn.isCompleted, activityTouched])

  const handleCopyUser = () => {
    const text = String(turn.userEvent?.data?.text ?? '')
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedUser(true)
    setTimeout(() => setCopiedUser(false), 2000)
  }

  const handleCopyAssistant = () => {
    const text = String(turn.finalAssistant?.data?.text ?? '')
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedAssistant(true)
    setTimeout(() => setCopiedAssistant(false), 2000)
  }

  const userImage = turn.userEvent?.data?.image as string | undefined
  // A10: một lượt có thể mang NHIỀU ảnh (`images`) — bản ghi cũ chỉ có `image` số ít, và
  // lượt cũ không có `attachments`: cả hai trường hợp phải render y như trước.
  const rawUserImages = turn.userEvent?.data?.images
  const userImages = Array.isArray(rawUserImages)
    ? (rawUserImages.filter((item) => typeof item === 'string') as string[])
    : userImage
      ? [userImage]
      : []
  const rawAttachments = turn.userEvent?.data?.attachments
  const userAttachments = Array.isArray(rawAttachments)
    ? (rawAttachments.filter(
        (item): item is { name?: string; path?: string; sizeBytes?: number } =>
          Boolean(item) && typeof item === 'object',
      ))
    : []

  return (
    <div className="space-y-4">
      {/* 0. Model Changed Notice (if model was changed before this turn) */}
      {turn.modelChange && (
        <div className="flex items-center justify-center gap-2 py-1.5 select-none animate-in fade-in duration-200">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-panel2 border border-line text-zinc-400 text-[11px] shadow-2xs">
            <Hexagon className="size-3.5 text-brand" />
            <span>
              Model changed from <strong className="text-zinc-200 font-medium">{turn.modelChange.from}</strong> to <strong className="text-zinc-200 font-medium">{turn.modelChange.to}</strong>
            </span>
          </div>
        </div>
      )}

      {/* 1. User Prompt Bubble — Căn phải, chiếm tối đa 2/3 khung chat */}
      {turn.userEvent && (
        <div className="flex flex-col items-end gap-1.5 ml-auto max-w-[68%]">
          <div className="w-fit rounded-2xl bg-panel2 border border-line px-4 py-3 text-xs leading-relaxed text-fg shadow-xs">
            {userImages.map((src, index) => (
              <div
                key={`user-image-${index}`}
                onClick={() => onOpenLightbox?.({ type: 'image', src, caption: 'Attached image' })}
                className="mb-2 max-w-sm cursor-pointer overflow-hidden rounded-xl border border-line/80 bg-panel hover:border-brand/60 transition shadow-xs group"
                title="Nhấp vào để phóng to ảnh"
              >
                <img
                  src={src}
                  alt="Attached"
                  className="w-full object-cover max-h-56 rounded-lg group-hover:scale-[1.02] transition duration-200"
                />
              </div>
            ))}
            <MarkdownRenderer content={String(turn.userEvent.data.text ?? '')} />
            {/* A10: chip tệp đính kèm của lượt — người dùng phải thấy tệp nào ĐÃ tới box.
                `title` là đường dẫn tuyệt đối để đối chiếu với đường dẫn agent đọc. */}
            {userAttachments.length > 0 && (
              <div data-testid="user-attachments" className="mt-2 flex flex-col gap-1">
                {userAttachments.map((file, index) => {
                  const path = typeof file.path === 'string' ? file.path : ''
                  const name = typeof file.name === 'string' && file.name ? file.name : path
                  const sizeBytes = typeof file.sizeBytes === 'number' ? file.sizeBytes : undefined
                  return (
                    <div
                      key={`user-attachment-${index}`}
                      data-testid="user-attachment-chip"
                      title={path ? absoluteWorkspacePath(path) : undefined}
                      className="flex items-center gap-1.5 rounded-lg border border-line/80 bg-panel px-2 py-1 text-[10px] text-muted"
                    >
                      <FileText className="size-3 shrink-0" />
                      <span className="truncate font-mono text-fg" data-testid="user-attachment-name">
                        {name}
                      </span>
                      {sizeBytes !== undefined && <span className="shrink-0">{formatAttachmentSize(sizeBytes)}</span>}
                      {path && path !== name && (
                        <span className="truncate font-mono">{path}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* User Bubble Footer */}
          <div className="flex items-center gap-2 text-[10px] text-muted pr-1 select-none">
            <span>{formatTime(turn.userEvent.created)}</span>
            <button
              type="button"
              onClick={handleCopyUser}
              className="hover:text-fg transition cursor-pointer"
              title="Copy message"
            >
              {copiedUser ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            </button>
            <span className="flex size-4 items-center justify-center rounded-full bg-panel border border-line text-[8px] font-bold text-muted">
              KV
            </span>
          </div>
        </div>
      )}

      {/* 2. Slim turn header — hàng nhãn là NÚT GẤP của khối hoạt động, dưới nó là dòng biên nhận (F2 + R2) */}
      <div className="space-y-1.5 pl-0.5" data-turn-header="true">
        {/* `data-thinking-toggle` giữ nguyên tên cũ: vùng hoạt động **chính là** vùng suy luận sau
            yêu cầu 5, nên nút này vừa là nút của khối vừa là nút mở văn bản suy luận. */}
        <button
          type="button"
          data-activity-toggle="true"
          data-thinking-toggle="true"
          aria-expanded={activityOpen}
          onClick={() => {
            setActivityTouched(true)
            setActivityOpen(!activityOpen)
          }}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-fg transition cursor-pointer select-none group"
        >
          <span
            className={`size-1.5 rounded-full transition duration-200 ${
              isTurnBusy ? 'bg-brand animate-pulse scale-110' : 'bg-brand/80'
            }`}
          />
          <span className="text-zinc-400">
            {isTurnBusy ? 'Working...' : `Worked for ${durationSec}s`}
          </span>
          {hasActivity &&
            (activityOpen ? (
              <ChevronDown className="size-3 text-muted group-hover:text-fg" />
            ) : (
              <ChevronRight className="size-3 text-muted group-hover:text-fg" />
            ))}
        </button>

        {/* R2: dòng biên nhận — in đúng những gì đang nằm trong khối, kể cả lệnh chưa trả kết quả */}
        {receipt.length > 0 && (
          <div className="flex flex-wrap items-center text-[11px] font-mono select-none" data-activity-receipt="true">
            {receipt.map((part, index) => (
              <span key={part.label} className="flex items-center">
                {/* Dấu phân tách mang chính khoảng trắng của nó, nên chữ trong DOM đọc
                    đúng `Thinking · 6 commands · …` chứ không dính liền nhau. */}
                {index > 0 && <span className="text-zinc-600">{' · '}</span>}
                <span className={ACTIVITY_TONE_CLASS[part.tone]}>{part.label}</span>
              </span>
            ))}
          </div>
        )}

        {/* Suy luận thật (stream từ model) hoặc dòng trung thực khi model chỉ trả token (F3).
            Dòng token ở LẠI header, ngoài khối gấp — không giấu khi model chỉ trả token. */}
        {!thoughtText && reasoningTokens > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted" data-thinking-tokens="true">
            <Sparkles className="size-3 text-brand/70 shrink-0" />
            <span className="text-zinc-400">{reasoningTokensNotice(reasoningTokens)}</span>
          </div>
        )}
      </div>

      {/* 3. MỘT khối hoạt động (R2): văn xuôi suy luận + mọi hàng theo `seq` + chỉ báo bận.
          Câu trả lời cuối và khối lỗi nằm NGOÀI khối này. */}
      <div data-activity="true" data-activity-open={activityOpen ? 'true' : 'false'}>
        {activityOpen && (
          <div className="space-y-3">
            {thoughtText && <ThoughtProse thought={thoughtText} isLive={isTurnBusy} />}

            {turn.items.map((item) => {
              if (item.kind === 'text') {
                return <TimelineTextBlock key={item.id} text={item.text} isLive={item.live && isTurnBusy} />
              }
              if (item.kind === 'tool') {
                return (
                  <ToolTimelineRow
                    key={item.id}
                    start={item.start}
                    end={item.end}
                    isTurnBusy={isTurnBusy}
                    allowStartMedia={item.end ? startAllowedSeqs.has(item.end.seq) : false}
                    onOpenLightbox={onOpenLightbox}
                  />
                )
              }
              if (item.kind === 'child') {
                const childSessionId = String(item.event.data.sessionId ?? item.event.data.role ?? '')
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-timeline="child"
                    aria-label={t('chat.openSubagentTab')}
                    onClick={() => onOpenTab?.('subagents', childSessionId ? { sessionId: childSessionId } : null)}
                    className="group inline-flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand/5 px-2 py-0.5 text-[11px] text-brand font-medium select-none transition hover:bg-brand/10 cursor-pointer"
                  >
                    <BrainCircuit className="size-3 animate-pulse" />
                    <span className="group-hover:underline">
                      Specialist: {String(item.event.data.role)} ({String(item.event.data.status)})
                    </span>
                    <ChevronRight className="size-3 opacity-0 transition group-hover:opacity-100" />
                  </button>
                )
              }
              if (item.kind === 'plan') {
                const identity = String(item.event.data.identity ?? '')
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-timeline="plan"
                    data-plan-identity={identity || undefined}
                    aria-label={t('chat.openPlanTab')}
                    onClick={() => onOpenTab?.('plan', identity ? { identity } : null)}
                    className="group inline-flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand/5 px-2 py-0.5 text-[11px] text-brand font-medium select-none transition hover:bg-brand/10 cursor-pointer"
                  >
                    <FileText className="size-3" />
                    <span className="group-hover:underline">{t('chat.planWritten')}</span>
                    {identity && <span className="font-mono text-[10px] text-muted">{identity}</span>}
                    <ChevronRight className="size-3 opacity-0 transition group-hover:opacity-100" />
                  </button>
                )
              }
              if (item.kind === 'decision') {
                return (
                  <DecisionRow
                    key={item.id}
                    event={item.event}
                    resolution={item.resolution}
                    onOpenTab={onOpenTab}
                  />
                )
              }
              if (item.kind === 'notice') {
                return <ServicingNotice key={item.id} event={item.event} />
              }
              return <CompactionNotice key={item.id} event={item.event} />
            })}

            {/* Lightweight Text-only Thinking Indicator (Không viền hộp to) */}
            {isTurnBusy && !pendingTool && (
              <div className="flex items-center gap-2 py-1 text-xs text-muted select-none" data-state-indicator="thinking">
                <Sparkles className="size-3.5 text-brand animate-pulse shrink-0" />
                <span className="text-zinc-300">BoxFox is thinking and synthesizing response...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Final answer — tóm tắt + nút mở rộng, kèm ảnh/video của lượt (F6) */}
      <FinalAnswerBlock
        turn={turn}
        providerId={providerId}
        targetModelId={targetModelId}
        media={turnMedia}
        isTurnBusy={isTurnBusy}
        copiedAssistant={copiedAssistant}
        onCopyAssistant={handleCopyAssistant}
        onOpenLightbox={onOpenLightbox}
      />

      {/* 5. Turn Error: Rendered cleanly within the specific turn where it occurred */}
      {turn.error && (
        <div className="py-2 text-xs text-rose-400 font-sans leading-relaxed select-text animate-in fade-in duration-150">
          {turn.error}
        </div>
      )}
    </div>
  )
}

/** Văn bản trợ lý giữa lượt (kể cả `final:false`) — hiện đúng vị trí theo `seq`. */
function TimelineTextBlock({ text, isLive }: { text: string; isLive: boolean }) {
  if (!text) return null
  return (
    <div className="max-w-3xl pl-0.5 text-sm text-fg leading-relaxed" data-timeline="assistant-text">
      <ProgressiveMarkdown content={text} isLive={isLive} />
    </div>
  )
}

/** Một hàng cho mỗi cặp `tool_start` + `tool_end`, ảnh/video nằm ngay dưới hàng đó (F2/F4). */
function ToolTimelineRow({
  start,
  end,
  isTurnBusy,
  allowStartMedia,
  onOpenLightbox,
}: {
  start: HarnessEvent | null
  end: HarnessEvent | null
  isTurnBusy?: boolean
  /** D3: hàng `start` của bản ghi chưa từng `stop` vẫn có đường mở tệp — xem `TurnBlock`. */
  allowStartMedia?: boolean
  onOpenLightbox?: (media: LightboxMediaProps) => void
}) {
  const [open, setOpen] = useState(false)

  const source = end ?? start
  const name = String(source?.data.name ?? '')
  const args = (source?.data.args ?? null) as Record<string, unknown> | null
  const result = end?.data.result
  const isError = Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).is_error)
  const display = getToolDisplay(name, args, isError)
  const media = useMemo(
    () => (end ? extractToolMedia(end, { allowStartMedia }) : null),
    [end, allowStartMedia],
  )
  // Chỉ hiện trạng thái "đang chạy" khi lượt thực sự đang chạy; lượt đã xong mà thiếu
  // `tool_end` (bị huỷ / hết hạn) phải nói thật là không có kết quả.
  const running = !end && Boolean(isTurnBusy)
  const unfinished = !end && !isTurnBusy

  return (
    <div className="space-y-1.5" data-timeline="tool" data-tool-name={name} data-tool-pending={running ? 'true' : undefined} data-tool-unfinished={unfinished ? 'true' : undefined}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-fg transition cursor-pointer select-none group"
      >
        <div className="flex items-center gap-1.5">
          {running ? (
            <Loader2 className="size-3.5 text-blue-400 animate-spin shrink-0" />
          ) : isError || unfinished ? (
            <AlertCircle className={`size-3 shrink-0 ${isError ? 'text-red-400' : 'text-amber-400'}`} />
          ) : (
            display.icon
          )}
          <span className={running ? 'text-blue-300 animate-pulse' : 'text-zinc-400'}>
            {running ? 'Running' : display.actionLabel}
          </span>
          <span className="font-mono text-[11px] text-zinc-200 font-semibold">{display.detailLabel}</span>
          {running && <span className="text-[10px] text-blue-300">…</span>}
          {!running && isError && <span className="text-[10px] text-red-400">· failed</span>}
          {unfinished && <span className="text-[10px] text-amber-400">· no result recorded</span>}
        </div>
        {open ? (
          <ChevronDown className="size-3 text-muted group-hover:text-fg" />
        ) : (
          <ChevronRight className="size-3 text-muted group-hover:text-fg" />
        )}
      </button>

      {/* Ảnh/video của chính tool này — không gom vào gallery riêng */}
      {media && <ToolMediaBlock media={media} onOpenLightbox={onOpenLightbox} />}

      {open && (
        <div className="ml-4 space-y-2 rounded-xl border border-line bg-panel2/60 p-2.5 text-xs animate-in fade-in duration-150">
          {args && Object.keys(args).length > 0 && (
            <div className="text-[11px] text-zinc-400 font-mono">
              <span className="text-zinc-500">Input:</span> {JSON.stringify(args)}
            </div>
          )}

          {media?.artifactPath && (
            <div className="text-[11px] text-zinc-400 font-mono flex items-center gap-1">
              <span className="text-zinc-500">Artifact:</span>
              <span className="text-blue-400 truncate">{media.artifactPath}</span>
            </div>
          )}

          {end && (
            <pre className="max-h-48 overflow-auto font-mono text-[11px] text-zinc-300 whitespace-pre-wrap">
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function ToolMediaBlock({
  media,
  onOpenLightbox,
}: {
  media: ToolMedia
  onOpenLightbox?: (media: LightboxMediaProps) => void
}) {
  const t = useT()
  // R1 (yêu cầu 4): ảnh chụp gấp theo mặc định. State nằm trong chính hàng này (cùng khuôn với
  // `ToolTimelineRow`), nên vòng poll 1200 ms không tự mở/gấp lại ảnh.
  const [open, setOpen] = useState(false)
  // Payload `dimensions` là nguồn chính; nếu tool không kèm (ví dụ browser_use) thì lấy
  // kích thước thật của chính ảnh khi nó tải xong — không đoán, không hardcode.
  const [naturalSize, setNaturalSize] = useState<[number, number] | null>(null)
  const dimensions = media.dimensions ?? naturalSize
  const label = formatMediaLabel({ ...media, dimensions })
  const measure = (el: HTMLImageElement) => {
    if (el.naturalWidth && el.naturalHeight) setNaturalSize([el.naturalWidth, el.naturalHeight])
  }
  const openLightbox = () =>
    onOpenLightbox?.({
      type: media.kind,
      src: media.src,
      caption: media.caption,
      sourceUrl: media.sourceUrl,
      duration: media.durationSec,
    })

  return (
    <div
      className="max-w-2xl space-y-1 pl-0.5"
      data-tool-media={media.kind}
      data-media-collapsed={open ? undefined : 'true'}
      data-media-unfinished={media.unfinished ? 'true' : undefined}
    >
      {/* Hàng gấp nói thật là CÓ ảnh đã tới: ảnh thu 56 × 36 (hoặc chip chữ cho video),
          nhãn dựng từ payload, và đúng một mũi tên. Mở rồi thì hàng gấp biến mất — một tài
          liệu chỉ hiện một lần. */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          data-media-toggle="true"
        className="flex items-center gap-2 text-xs text-muted hover:text-fg transition cursor-pointer select-none group rounded-md text-left"
      >
          {media.kind === 'video' ? (
            <span className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md border border-line bg-panel2 text-fuchsia-400">
              <Film className="size-3.5" />
            </span>
          ) : (
            <img
              data-media-thumb="true"
              src={media.src}
              alt={media.caption}
              loading="lazy"
              onLoad={(e) => measure(e.currentTarget)}
              onError={(e) => {
                // Ảnh không tải được thì nhãn chỉ in định dạng — không suy ra số.
                e.currentTarget.style.display = 'none'
              }}
              className="h-9 w-14 shrink-0 rounded-md border border-line bg-panel2 object-cover"
            />
          )}
          <span className="truncate font-mono text-[10px] text-zinc-400" data-media-label="true">
            {label}
          </span>
          <ChevronRight className="size-3 shrink-0 text-muted group-hover:text-fg" />
        </button>
      ) : null}

      {/* Nhánh mở: giữ nguyên khối markup cũ (ảnh/video lớn + chip Zoom + dòng caption có đường dẫn) */}
      {open && (
        <div className="space-y-1" data-media-full="true">
          <div
            className="group relative overflow-hidden rounded-xl border border-line bg-panel2 shadow-xs transition hover:border-brand/50 hover:shadow-md cursor-pointer"
            onClick={openLightbox}
            data-media-open="true"
            title="Nhấp để phóng to"
          >
            {media.kind === 'video' ? (
              <video src={media.src} muted playsInline className="w-full max-h-80 rounded-lg" data-tool-media-element="video" />
            ) : (
              <img
                src={media.src}
                alt={media.caption}
                onLoad={(e) => measure(e.currentTarget)}
                onError={(e) => {
                  (e.currentTarget as HTMLElement).style.display = 'none'
                }}
                className="w-full object-contain max-h-96 rounded-lg transition group-hover:scale-[1.01]"
              />
            )}
            <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition bg-black/75 backdrop-blur-xs px-2.5 py-1 rounded-md text-[11px] text-white shadow-xs">
              <Maximize2 className="size-3 text-zinc-200" />
              <span>{t('chat.zoom')}</span>
            </div>
          </div>
          {/* F4: nhãn lấy từ `dimensions` + `mime` thật của payload; đường dẫn artifact chỉ ở đây */}
          <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono" data-media-label="true">
            <span className="shrink-0">{label}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              {media.artifactPath && <span className="truncate">{media.artifactPath}</span>}
              {/* Nút thu lại nằm NGOÀI khung ảnh, nên bấm nó không mở khung xem lớn. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-expanded
                data-media-toggle="true"
                data-media-collapse="true"
                title="Thu hàng ảnh lại"
                className="flex shrink-0 items-center text-muted hover:text-fg transition cursor-pointer"
              >
                <ChevronUp className="size-3" />
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** F7: thông báo nén context ở cấp cao nhất của lượt, bấm để xem chi tiết. */
/** Thông báo ngắn của harness (ví dụ `UPSTREAM_RETRY`). Cùng khung chữ mờ như nhật ký
 * hệ thống khác trong lượt; không thêm bảng màu mới. */
function ServicingNotice({ event }: { event: HarnessEvent }) {
  const code = String(event.data.code ?? 'NOTICE')
  const message = String(event.data.message ?? '').trim()
  return (
    <div
      className="max-w-2xl rounded-xl border border-line/60 bg-panel/40 px-3 py-2 text-[11px] text-muted"
      data-timeline="notice"
      data-notice-code={code}
    >
      <div className="flex items-start gap-1.5">
        <RefreshCw className="mt-0.5 size-3 shrink-0 text-zinc-500" />
        <span className="flex-1">
          {message || code}
        </span>
      </div>
    </div>
  )
}


function CompactionNotice({ event }: { event: HarnessEvent }) {
  const [open, setOpen] = useState(false)
  const kind = String(event.data.kind ?? 'unchanged')
  const before = typeof event.data.beforeEstimate === 'number' ? event.data.beforeEstimate : null
  const after = typeof event.data.afterEstimate === 'number' ? event.data.afterEstimate : null
  const pruned = typeof event.data.pruned === 'number' ? event.data.pruned : null

  return (
    <div className="max-w-2xl rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2" data-timeline="compaction" data-compaction-kind={kind}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-xs text-amber-200/90 hover:text-amber-100 transition cursor-pointer select-none text-left"
      >
        <Layers className="size-3.5 text-amber-400 shrink-0" />
        <span className="flex-1">{compactionNoticeText(event.data)}</span>
        {open ? (
          <ChevronDown className="size-3.5 text-amber-400/80" />
        ) : (
          <ChevronRight className="size-3.5 text-amber-400/80" />
        )}
      </button>

      {open && (
        <dl className="mt-1.5 space-y-0.5 pl-5 text-[11px] text-zinc-400 font-mono animate-in fade-in duration-150" data-compaction-detail="true">
          <div>
            <dt className="inline text-zinc-500">Kind: </dt>
            <dd className="inline">{kind}</dd>
          </div>
          <div>
            <dt className="inline text-zinc-500">Before: </dt>
            <dd className="inline">{before === null ? '—' : `${before} tokens`}</dd>
          </div>
          <div>
            <dt className="inline text-zinc-500">After: </dt>
            <dd className="inline">{after === null ? '—' : `${after} tokens`}</dd>
          </div>
          {pruned !== null && (
            <div>
              <dt className="inline text-zinc-500">Tool outputs pruned: </dt>
              <dd className="inline">{pruned}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}

/** F6: tóm tắt câu trả lời cuối + nút mở rộng + ảnh/video gắn kèm của cả lượt. */
function FinalAnswerBlock({
  turn,
  providerId,
  targetModelId,
  media,
  isTurnBusy,
  copiedAssistant,
  onCopyAssistant,
  onOpenLightbox,
}: {
  turn: HarnessTurn
  providerId: string
  targetModelId: string
  media: ToolMedia[]
  isTurnBusy: boolean
  copiedAssistant: boolean
  onCopyAssistant: () => void
  onOpenLightbox?: (media: LightboxMediaProps) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const fullText = String(turn.finalAssistant?.data?.text ?? '')
  const { summary, truncated } = useMemo(() => summarizeFinalText(fullText), [fullText])

  if (!turn.finalAssistant) return null

  const visibleText = truncated && !expanded ? summary : fullText
  // R3: nút chỉ tồn tại khi có gì để mở — phần chữ còn lại, hoặc lưới ảnh của lượt.
  const hasMore = truncated || media.length > 0

  return (
    <div className="space-y-1.5 pl-0.5" data-final-answer="true">
      {/* Model Info Header */}
      <div className="flex items-center gap-1.5 text-[11px] text-muted select-none">
        <ProviderIcon providerId={providerId} className="size-3.5" />
        <span className="font-semibold text-fg">{targetModelId}</span>
        <span className="text-zinc-500">·</span>
        <span>{formatTime(turn.finalAssistant.created || turn.endTime)}</span>
        <span className="flex items-center gap-1 text-emerald-400 font-medium">
          <CheckCircle2 className="size-3" />
          <span>done</span>
        </span>

        {/* Token Usage Metrics (↑ prompt_tokens ↓ completion_tokens) */}
        {turn.usage && (
          <>
            <span className="text-zinc-500">·</span>
            <span
              className="font-mono text-[10px] text-zinc-400"
              title={`Prompt tokens: ${turn.usage.prompt_tokens ?? 0} | Completion tokens: ${turn.usage.completion_tokens ?? 0}`}
            >
              ↑ {formatTokens(turn.usage.prompt_tokens)} ↓ {formatTokens(turn.usage.completion_tokens)}
            </span>
          </>
        )}

        {isTurnBusy && (
          <span className="flex items-center gap-1 text-brand font-medium animate-pulse">
            <Loader2 className="size-3 animate-spin" />
            <span>streaming</span>
          </span>
        )}

        <button
          type="button"
          onClick={onCopyAssistant}
          className="ml-auto hover:text-fg text-muted transition cursor-pointer p-0.5"
          title="Copy response"
        >
          {copiedAssistant ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
        </button>
      </div>

      {/* Summary (mặc định) hoặc toàn bộ markdown khi người dùng mở rộng */}
      <div className="max-w-3xl text-sm text-fg leading-relaxed" data-final-text={expanded ? 'expanded' : 'summary'}>
        <MarkdownRenderer content={visibleText} />

        {/* R3 (yêu cầu 6): nút nằm NGAY DƯỚI đoạn tóm tắt, và chỉ tồn tại khi có gì để mở. */}
        {hasMore && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            data-final-expander="true"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-brand hover:text-brand/80 font-medium transition cursor-pointer select-none"
          >
            <ChevronRight className="size-3" />
            <span>› {FINAL_ANSWER_EXPAND_LABEL}</span>
          </button>
        )}
      </div>

      {/* Ảnh/video sinh ra trong lượt — nằm TRONG phần chi tiết: chỉ hiện sau khi người dùng mở */}
      {expanded && media.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-0.5" data-final-media="true">
          {media.map((item) => (
            <div
              key={`${item.eventSeq}_${item.src.slice(0, 32)}`}
              onClick={() =>
                onOpenLightbox?.({
                  type: item.kind,
                  src: item.src,
                  caption: item.caption,
                  sourceUrl: item.sourceUrl,
                  duration: item.durationSec,
                })
              }
              className="group relative overflow-hidden rounded-lg border border-line bg-panel2 cursor-pointer hover:border-brand/60 transition"
              title={item.caption}
            >
              {item.kind === 'video' ? (
                <>
                  <video src={item.src} muted playsInline className="h-20 w-32 object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white text-[10px] gap-1">
                    <Film className="size-3.5" />
                    <span>{formatMediaLabel(item) || 'video'}</span>
                  </span>
                </>
              ) : (
                <img src={item.src} alt={item.caption} className="h-20 w-32 object-cover" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Nút gấp nằm ở CUỐI phần vừa mở — sau lưới ảnh, đúng thứ tự tài liệu của mockup */}
      {hasMore && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded
          data-final-expander="true"
          className="inline-flex items-center gap-1 text-[11px] text-brand hover:text-brand/80 font-medium transition cursor-pointer select-none"
        >
          <ChevronDown className="size-3" />
          <span>› {FINAL_ANSWER_COLLAPSE_LABEL}</span>
        </button>
      )}
    </div>
  )
}

/** Progressive Typewriter Markdown Reveal component */
function ProgressiveMarkdown({
  content,
  isLive,
}: {
  content: string
  isLive?: boolean
}) {
  const [displayedLength, setDisplayedLength] = useState(() => (isLive ? 0 : content.length))

  React.useEffect(() => {
    if (!isLive) {
      setDisplayedLength(content.length)
      return
    }

    if (displayedLength < content.length) {
      // Natural cadence: between 2 and 8 characters per tick (approx 1 word every 1-2 ticks)
      const remaining = content.length - displayedLength
      const step = Math.min(remaining, Math.max(2, Math.ceil(remaining / 12)))
      const timer = window.setTimeout(() => {
        setDisplayedLength((prev) => Math.min(content.length, prev + step))
      }, 18)
      return () => window.clearTimeout(timer)
    }
  }, [content, displayedLength, isLive])

  const isTyping = isLive && displayedLength < content.length
  const currentText = isLive ? content.slice(0, displayedLength) : content

  return (
    <div className="relative">
      <MarkdownRenderer content={currentText} />
      {isTyping && (
        <span className="inline-block w-1.5 h-3.5 bg-brand animate-pulse ml-0.5 align-middle rounded-xs" />
      )}
    </div>
  )
}

/**
 * R2 (yêu cầu 5): văn bản suy luận nằm TRONG khối hoạt động, không còn nút `Thinking (Xs)` riêng —
 * thông tin của nút đó nay nằm ở hàng nhãn (`Worked for Xs`) và dòng biên nhận (`Thinking · …`).
 * Khung giữ nguyên như trước, chỉ bỏ state riêng vì việc mở/gấp do khối hoạt động quyết định.
 */
function ThoughtProse({ thought, isLive }: { thought: string; isLive?: boolean }) {
  return (
    <div className="ml-3 pl-3 border-l-2 border-brand/50 py-1.5 text-xs text-zinc-300/95 leading-relaxed bg-panel2/40 rounded-r-xl animate-in fade-in duration-150">
      <ProgressiveMarkdown content={thought} isLive={isLive} />
    </div>
  )
}
