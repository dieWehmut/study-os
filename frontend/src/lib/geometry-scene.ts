/**
 * A deliberately small, data-only contract for math diagrams.
 *
 * Model output may eventually populate this object, but the renderer only
 * accepts these primitives and sampled points. It never evaluates an
 * expression or mounts HTML supplied by a model.
 */
export interface GeometryCoordinate {
  x: number
  y: number
}

export interface GeometryPoint extends GeometryCoordinate {
  id: string
  label?: string
  draggable?: boolean
}

export interface GeometrySegment {
  id: string
  from: string
  to: string
  label?: string
  dashed?: boolean
}

export interface GeometryCircle {
  id: string
  center: string
  radius: number
  label?: string
}

export interface GeometryGraph {
  id: string
  samples: GeometryCoordinate[]
  label?: string
}

export type GeometryConditionKind = "equal_length" | "parallel" | "perpendicular" | "angle"

export interface GeometryCondition {
  id: string
  kind: GeometryConditionKind
  refs: string[]
  label: string
}

export interface GeometryScene {
  version: 1
  title: string
  viewBox: { width: number; height: number }
  points: GeometryPoint[]
  segments: GeometrySegment[]
  circles: GeometryCircle[]
  graphs: GeometryGraph[]
  conditions: GeometryCondition[]
}

export type GeometrySceneValidation =
  | { ok: true; errors: [] }
  | { ok: false; errors: string[] }

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const MAX_LABEL_LENGTH = 200

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function validCoordinate(point: GeometryCoordinate, width: number, height: number): boolean {
  return finite(point.x) && finite(point.y) && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height
}

function checkLabel(label: string | undefined, name: string, errors: string[]) {
  if (label !== undefined && label.length > MAX_LABEL_LENGTH) {
    errors.push(`${name}不能超过 ${MAX_LABEL_LENGTH} 个字符`)
  }
}

function registerID(id: string, kind: string, seen: Set<string>, errors: string[]) {
  if (!ID_PATTERN.test(id)) {
    errors.push(`${kind} ID 无效：${id}`)
    return
  }
  if (seen.has(id)) {
    errors.push(`${kind} ID 重复：${id}`)
    return
  }
  seen.add(id)
}

/** Validate a scene before it reaches the SVG renderer. */
export function validateGeometryScene(scene: GeometryScene): GeometrySceneValidation {
  const errors: string[] = []
  if (!scene || scene.version !== 1) errors.push("只支持 version 1 的图形场景")
  if (typeof scene?.title !== "string") errors.push("标题必须是文本")
  else checkLabel(scene.title, "标题", errors)

  const width = scene?.viewBox?.width
  const height = scene?.viewBox?.height
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0 || width > 4000 || height > 4000) {
    errors.push("画布尺寸必须是 0 到 4000 之间的正数")
  }
  const safeWidth = finite(width) && width > 0 ? width : 1
  const safeHeight = finite(height) && height > 0 ? height : 1
  const seen = new Set<string>()
  const pointIDs = new Set<string>()
  const segmentIDs = new Set<string>()

  for (const point of scene?.points ?? []) {
    registerID(point.id, "点", seen, errors)
    pointIDs.add(point.id)
    if (!validCoordinate(point, safeWidth, safeHeight)) errors.push(`点 ${point.id} 超出画布范围`)
    checkLabel(point.label, `点 ${point.id} 标签`, errors)
  }

  for (const segment of scene?.segments ?? []) {
    registerID(segment.id, "线段", seen, errors)
    segmentIDs.add(segment.id)
    if (!pointIDs.has(segment.from) || !pointIDs.has(segment.to)) {
      const missing = [segment.from, segment.to].filter((id) => !pointIDs.has(id)).join("、")
      errors.push(`线段 ${segment.id} 引用了不存在的点：${missing}`)
    } else if (segment.from === segment.to) {
      errors.push(`线段 ${segment.id} 不能连接同一个点`)
    }
    checkLabel(segment.label, `线段 ${segment.id} 标签`, errors)
  }

  for (const circle of scene?.circles ?? []) {
    registerID(circle.id, "圆", seen, errors)
    if (!pointIDs.has(circle.center)) errors.push(`圆 ${circle.id} 引用了不存在的中心点：${circle.center}`)
    if (!finite(circle.radius) || circle.radius <= 0) errors.push(`圆 ${circle.id} 的半径必须是正数`)
    checkLabel(circle.label, `圆 ${circle.id} 标签`, errors)
  }

  for (const graph of scene?.graphs ?? []) {
    registerID(graph.id, "曲线", seen, errors)
    if (graph.samples.length < 2) errors.push(`曲线 ${graph.id} 至少需要两个采样点`)
    for (const sample of graph.samples) {
      if (!validCoordinate(sample, safeWidth, safeHeight)) errors.push(`曲线 ${graph.id} 的采样点超出画布范围`)
    }
    checkLabel(graph.label, `曲线 ${graph.id} 标签`, errors)
  }

  for (const condition of scene?.conditions ?? []) {
    registerID(condition.id, "条件", seen, errors)
    if (condition.refs.length === 0) errors.push(`条件 ${condition.id} 至少需要一个引用`)
    const missing = condition.refs.filter((ref) => !seen.has(ref))
    if (missing.length > 0) errors.push(`条件 ${condition.id} 引用了不存在的元素：${missing.join("、")}`)
    checkLabel(condition.label, `条件 ${condition.id} 标签`, errors)
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors }
}

export const defaultTriangleScene: GeometryScene = {
  version: 1,
  title: "任意解三角形：先看条件关系",
  viewBox: { width: 320, height: 220 },
  points: [
    { id: "A", x: 58, y: 176, label: "A", draggable: false },
    { id: "B", x: 262, y: 176, label: "B", draggable: false },
    { id: "C", x: 150, y: 42, label: "C", draggable: true },
  ],
  segments: [
    { id: "AB", from: "A", to: "B", label: "底边 c" },
    { id: "BC", from: "B", to: "C", label: "边 a" },
    { id: "CA", from: "C", to: "A", label: "边 b" },
  ],
  circles: [],
  graphs: [],
  conditions: [
    { id: "given-angle-C", kind: "angle", refs: ["CA", "BC"], label: "已知 ∠C" },
    { id: "target-side", kind: "equal_length", refs: ["AB"], label: "先找出所求边" },
  ],
}
