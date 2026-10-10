import { ApiError } from "@/api/client"

/**
 * What to tell the reader when a call fails.
 *
 * The distinction that matters: a thrown fetch means the backend did not answer
 * at all, so 「请确认本地后端正在运行」 is the likely cause. An `ApiError` means it
 * *did* answer — telling the reader to check whether it is running is then simply
 * false, and it hides the one party that knows what happened. 4xx messages come
 * from the server in the reader's language; a 5xx is ours, so it is named as such
 * rather than leaking an English internal.
 */
export function failureMessage(reason: unknown, action: string): string {
  if (!(reason instanceof ApiError)) return `${action}，请确认本地后端正在运行。`
  const detail = reason.status >= 500 ? `服务出错（${reason.status}）` : reason.message.trim()
  return detail ? `${action}：${detail}` : `${action}（${reason.status}）`
}