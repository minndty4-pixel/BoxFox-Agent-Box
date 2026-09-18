export async function agentApi<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/agent${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', 'X-BoxFox-Admin': '1' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Harness engine unavailable. Start the BoxFox launcher.' }))
    throw new Error(error.error ?? `Harness HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}
