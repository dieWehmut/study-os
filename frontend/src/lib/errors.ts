import { ApiError } from "@/api/client"

/** Reader-facing copy in this app is Chinese; an English 5xx is ours internally. */
const readerFacing = /[\u3400-\u9fff]/

/**
 * What to tell the reader when a call fails.
 *
 * The distinction that matters: a thrown fetch means the backend did not answer
 * at all, so 「请确认本地后端正在运行」 is the likely cause. An `ApiError` means it
 * *did* answer — telling the reader to check whether it is running is then simply
 * false, and it hides the one party that knows what happened.
 *
 * 4xx messages are written for the reader, so they are passed on. 5xx messages
 * are ours: one is used when it was written for a reader too (「AI 服务商未配置」
 * is the whole point, and 「校验失败」 says what to do next), and the status is
 * named instead when it is an internal like `list lessons failed`.
 */
export function failureMessage(reason: unknown, action: string): string {
  if (!(reason instanceof ApiError)) {
    // Not an HTTP reply: usually fetch itself throwing because nothing is
    // listening. A message written for the reader is still worth passing on --
    // callers reject with plain Errors too -- while "Failed to fetch" is not.
    const text = reason instanceof Error ? reason.message.trim() : ""
    return readerFacing.test(text) ? `${action}：${text}` : `${action}，请确认本地后端正在运行。`
  }
  const server = reason.message.trim()
  const usable = reason.status < 500 || readerFacing.test(server)
  const detail = usable && server ? server : `服务出错（${reason.status}）`
  // Some handlers name the failure the same way the caller would: say it once.
  return detail === action ? action : `${action}：${detail}`
}