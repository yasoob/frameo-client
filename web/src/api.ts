let token = ''
export function setToken(value: string) { token = value }
export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const form = body instanceof FormData
  const response = await fetch(`/api${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'X-Frameo-Token': token, ...(!form ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) })
  if (!response.ok) { const text = await response.text(); let message = text; try { message = JSON.parse(text).error || text } catch { /* plain HTTP error */ } throw new Error(message) }
  return response.json()
}
