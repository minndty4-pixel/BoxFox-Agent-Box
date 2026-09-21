export async function agentApi<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/agent${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', 'X-BoxFox-Admin': '1' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Harness engine unavailable. Start the BoxFox launcher.' }))
    const message = error.error ?? `Harness HTTP ${response.status}`
    // Giữ mã lỗi trong câu: người dùng thấy `SESSION_NOT_FOUND` thay vì một chữ "Not found"
    // không tra cứu được, và store nhận ra được phiên cũ để tự mở phiên mới.
    throw new Error(error.code && !message.startsWith(error.code) ? `${error.code}: ${message}` : message)
  }
  return response.json() as Promise<T>
}
