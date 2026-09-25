/**
 * Cầu nối giữa luồng sự kiện phiên (đã được `ChatPanel` hỏi mỗi 1200 ms) và `researchStore`.
 *
 * Vì sao không phải một vòng hỏi riêng: hợp đồng §5.12 cấm `ResearchPanel` hỏi
 * `/research/jobs` mỗi 5000 ms. Nguồn sự thật là sự kiện `research_*` trên luồng sự kiện phiên;
 * hook này đẩy (cấu hình chế độ, sự kiện mới) sang store, và store chỉ gọi mạng khi có sự kiện
 * mới hoặc chế độ vừa đổi.
 */
import { useEffect } from 'react'
import { useAgentStore } from '../store/agentStore'
import { useHarnessChatStore } from '../store/harnessChatStore'
import { useResearchStore } from '../store/researchStore'
import type { ResearchMode } from '../lib/researchMode'

export function useResearchSync(): ResearchMode {
  const chatId = useAgentStore((s) => s.activeSessionId)
  const run = useHarnessChatStore((s) => s.sessions[chatId])
  const events = run?.events
  const researchMode = run?.researchMode
  const sync = useResearchStore((s) => s.sync)
  const mode = useResearchStore((s) => s.mode)

  useEffect(() => {
    sync(chatId, { researchMode }, events ?? [])
  }, [chatId, researchMode, events, sync])

  return mode
}
