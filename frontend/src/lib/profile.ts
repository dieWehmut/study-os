// 头像走的是 GitHub 的公开端点：给个用户名就能拿到图，不需要 token，也就不需要
// 登录、回调地址和一份要保管的 client secret。整个应用只跑在本机回环上
// （见 httpapi 的 loopbackHostOnly），能省掉一套凭据就该省掉。
export const githubUser = "dieWehmut"

// 侧栏里头像的边长（px）。同时决定向 GitHub 请求哪一档尺寸，两者不该各写各的。
export const avatarRenderSize = 152

export function githubAvatarURL(username: string): string {
  // 不带 ?s= 时 GitHub 给的是 460px 以上的原图，塞进 152px 的圆里多下来的全是浪费；
  // 乘 2 是留给高分屏的。
  const size = avatarRenderSize * 2
  return `https://avatars.githubusercontent.com/${encodeURIComponent(username)}?s=${size}`
}

// 取首字符而不是 [0]：JS 的字符串下标按 UTF-16 码元走，遇到不在基本平面里的字
// （包括不少生僻汉字）会切出半个代理对，渲染成一个乱码方块。
export function profileInitial(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?"
}
