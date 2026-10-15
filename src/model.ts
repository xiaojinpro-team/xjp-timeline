/**
 * @xjp/timeline 的数据模型与纯函数(无 React、无 DOM)。
 *
 * 时间一律是秒(number),x = 秒 × pps(每秒像素)。宿主把自己的业务(镜头、版本、看片记录、切点…)
 * 翻译成这套 tracks / markers,时间轴只管画和换算 —— 没有任何宿主私有分支。
 */

/* ══════════════════════════ 数据 */

export type TrackKind = "video" | "audio" | "subtitle" | "music" | "fx" | "overlay";

/**
 * 缩略图:一张精灵图,格子按行优先排(单行条 = rows 1)。第 i 格代表片段内 [i·frameStep, (i+1)·frameStep) 这一段。
 * `cellWidth / cellHeight` 是图里一格的像素尺寸(不给就按轨道高、16:9 推)。
 */
export interface ThumbStrip {
  url: string;
  cols: number;
  /** 一格代表多少秒 */
  frameStep: number;
  /** 总格数(默认 cols × rows,rows 默认 1) */
  count?: number;
  rows?: number;
  cellWidth?: number;
  cellHeight?: number;
  /** 精灵图第 0 格对应片段内的哪一秒(整片共用一张精灵图时 = 片段在源里的起点) */
  offset?: number;
}

/** 音频峰值:`array` 是 0..1 的 |峰值|,每 `step` 秒一个;只给 `url` 时组件自己 fetch(JSON 数组,或 `{peaks}` / `{audio:{peaks}}`)。 */
export interface Peaks {
  array?: number[];
  url?: string;
  step: number;
}

export type ClipHighlight = "change" | "fading" | "selected-for" | "warn";

/** 片段内的一段(相对片段起点的秒):改动区间、褪色中的区间;`covered` = 已看过的部分(底边画实线)。 */
export interface ClipRange {
  start: number;
  end: number;
  kind?: "change" | "fading";
  covered?: [number, number][];
}

export interface ClipBadge {
  /** version:小字(如 v7);dots:n 个小点(最后一个实心);new:强调色圆点;error:红点;text:小字标签;star:强调色小牌 */
  kind: "version" | "dots" | "new" | "error" | "text" | "star";
  label?: string;
  count?: number;
}

export type DataAttrs = Record<`data-${string}`, string | number | boolean | undefined>;

export interface Clip {
  id: string;
  start: number;
  end: number;
  label?: string;
  sublabel?: string;
  thumbStrip?: ThumbStrip;
  peaks?: Peaks;
  /** 覆盖轨道色(任何 CSS 颜色) */
  color?: string;
  /** 整段高亮;`ranges` 有值时只亮那几段 */
  highlight?: ClipHighlight | null;
  ranges?: ClipRange[];
  /** 整段高亮(change / fading)时已看过的部分(相对片段起点的秒),底边画实线 */
  covered?: [number, number][];
  badges?: ClipBadge[];
  disabled?: boolean;
  /** 原生 title(没给 renderTooltip 时用) */
  title?: string;
  /** 透传到片段元素上的 data-* 属性(宿主的冒烟 / 定位用) */
  attrs?: DataAttrs;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  hidden?: boolean;
  muted?: boolean;
  /** 轨道头开关:默认音频类 = mute,其余 = hide;none = 不给开关 */
  toggle?: "hide" | "mute" | "none";
  /** 轨道头开关的提示补一句(如「同 M 键」) */
  toggleHint?: string;
  height?: number;
  clips: Clip[];
}

export type MarkerKind = "chapter" | "change" | "version" | "cut-hard" | "cut-soft" | "cut-manual" | "candidate" | "missing";

export interface Marker {
  id?: string;
  t: number;
  kind: MarkerKind;
  label?: string;
  /** 区间标记(章节 / 改动说明)的终点 */
  until?: number;
  title?: string;
  selected?: boolean;
  attrs?: DataAttrs;
}

export type ClipActionName = "split" | "merge-prev" | "set-in" | "set-out" | "toggle-pick" | "nudge-in-prev" | "nudge-in-next" | "nudge-out-prev" | "nudge-out-next";

/* ══════════════════════════ 轨道默认 */

export const TRACK_HEIGHTS: Record<TrackKind, number> = { subtitle: 24, overlay: 40, video: 58, audio: 44, music: 38, fx: 34 };
export const trackHeight = (t: Track) => t.height ?? TRACK_HEIGHTS[t.kind];
export const trackToggle = (t: Track): "hide" | "mute" | "none" => t.toggle ?? (t.kind === "audio" || t.kind === "music" || t.kind === "fx" ? "mute" : "hide");
export const trackOff = (t: Track) => (trackToggle(t) === "mute" ? !!t.muted : !!t.hidden);

/* ══════════════════════════ 缩放与滚动 */

export const DEFAULT_MAX_PPS = 400;
export const DEFAULT_MIN_USABLE_PPS = 6;

export const fitPps = (viewW: number, total: number) => (total > 0 && viewW > 0 ? viewW / total : 10);
export const clampPps = (pps: number, minPps: number, maxPps = DEFAULT_MAX_PPS) => Math.max(minPps, Math.min(Math.max(minPps * 1.01, maxPps), pps));
export const clampScroll = (x: number, pps: number, total: number, viewW: number) => Math.max(0, Math.min(x, Math.max(0, total * pps - viewW)));
export const ppsToSlider = (pps: number, minPps: number, maxPps = DEFAULT_MAX_PPS) => (minPps >= maxPps ? 0 : Math.log(pps / minPps) / Math.log(maxPps / minPps));
export const sliderToPps = (v: number, minPps: number, maxPps = DEFAULT_MAX_PPS) => minPps * Math.pow(maxPps / minPps, Math.max(0, Math.min(1, v)));
/** 以视口里 anchorPx 那一点为不动点换缩放,返回新的 scrollX。 */
export const zoomAround = (scrollX: number, oldPps: number, newPps: number, anchorPx: number) => ((scrollX + anchorPx) / oldPps) * newPps - anchorPx;

/* ══════════════════════════ 刻度 */

export interface RulerTick {
  t: number;
  major: boolean;
  label?: string;
}

/** 主刻度间距 ≥ 72 px,步长从帧级到分钟级里挑;次刻度 2/4/5 分(≥ 8 px)。标签整秒 `m:ss`,帧级 `m:ss:ffF`。 */
export function rulerTicks(t0: number, t1: number, pps: number, fps: number): RulerTick[] {
  const f = Math.max(1, Math.round(fps));
  const frameSteps = [1, 2, 5, 10].filter((n) => n < f).map((n) => n / f);
  const steps = [...frameSteps, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find((s) => s * pps >= 72) ?? 600;
  const subs = [5, 4, 2].find((d) => (major * pps) / d >= 8 && (major < 1 ? Math.abs(((major * f) / d) % 1) < 1e-6 : true)) ?? 1;
  const minor = major / subs;
  const out: RulerTick[] = [];
  const start = Math.max(0, Math.floor(t0 / minor) * minor);
  for (let i = 0; i < 5000; i++) {
    const t = start + i * minor;
    if (t > t1 + 1e-9) break;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    out.push({ t, major: isMajor, ...(isMajor ? { label: rulerLabel(t, major < 1, f) } : {}) });
  }
  return out;
}

export function rulerLabel(t: number, frames: boolean, fps: number): string {
  const totalFrames = Math.round(t * fps);
  const s = Math.floor(totalFrames / fps);
  const p = (n: number) => String(n).padStart(2, "0");
  const base = `${Math.floor(s / 60)}:${p(s % 60)}`;
  return frames ? `${base}:${p(totalFrames % fps)}f` : base;
}

/** `mm:ss:ffF`(帧号从 0)—— 播放头与角落读数用。 */
export function timecode(seconds: number, fps: number): string {
  const f = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.floor(seconds * fps + 1e-6));
  const p = (n: number) => String(n).padStart(2, "0");
  const totalS = Math.floor(totalFrames / f);
  return `${p(Math.floor(totalS / 60))}:${p(totalS % 60)}:${p(totalFrames % f)}f`;
}

/* ══════════════════════════ 缩略图与波形 */

export interface StripGeom {
  url: string;
  cols: number;
  rows: number;
  count: number;
  frameStep: number;
  cellW: number;
  cellH: number;
  offset: number;
}

export function stripGeom(s: ThumbStrip, laneH: number): StripGeom {
  const rows = s.rows ?? 1;
  const cellH = s.cellHeight ?? laneH;
  const cellW = s.cellWidth ?? Math.round((cellH * 16) / 9);
  return { url: s.url, cols: s.cols, rows, count: s.count ?? s.cols * rows, frameStep: s.frameStep, cellW, cellH, offset: s.offset ?? 0 };
}

/**
 * 一个片段宽 widthPx(在 pps 下),铺 [visA, visB)(片段内像素)里的格子:每格显示宽 = tileW(轨道高按格子比例),
 * 第 k 格取它中点那一刻所在的那一格图。返回每格在精灵图里的列 / 行。
 */
export function stripTiles(g: StripGeom, pps: number, widthPx: number, tileW: number, visA = 0, visB = widthPx): { x: number; col: number; row: number }[] {
  const out: { x: number; col: number; row: number }[] = [];
  const k0 = Math.max(0, Math.floor(visA / tileW));
  const k1 = Math.min(Math.ceil(widthPx / tileW), Math.ceil(visB / tileW));
  for (let k = k0; k < k1 && out.length < 2000; k++) {
    const tc = g.offset + (k * tileW + tileW / 2) / pps;
    const i = Math.max(0, Math.min(g.count - 1, Math.floor(tc / g.frameStep)));
    out.push({ x: k * tileW, col: i % g.cols, row: Math.floor(i / g.cols) });
  }
  return out;
}

/** 峰值 → SVG 路径(viewBox 0..n × 0..100,上下对称,中线 50),缩放时只拉伸不重算。 */
export function waveformPath(peaks: number[], gain = 1): string {
  const n = peaks.length;
  if (!n) return "";
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.min(1, Math.max(0, peaks[i] * gain)) * 48;
    top.push(`${i},${(50 - a - 0.6).toFixed(1)}`);
    bottom.push(`${i},${(50 + a + 0.6).toFixed(1)}`);
  }
  return `M0,50L${top.join("L")}L${n},50L${bottom.reverse().join("L")}Z`;
}

/** 取 fetch 回来的 JSON 里的峰值:数组 / {peaks} / {audio:{peaks}}。 */
export function peaksFromJson(j: unknown): number[] | null {
  if (Array.isArray(j)) return j.filter((x) => typeof x === "number");
  if (j && typeof j === "object") {
    const o = j as { peaks?: unknown; audio?: { peaks?: unknown } };
    if (Array.isArray(o.peaks)) return o.peaks as number[];
    if (o.audio && Array.isArray(o.audio.peaks)) return o.audio.peaks as number[];
  }
  return null;
}

/* ══════════════════════════ 可视区间 */

export const intersects = (a: number, b: number, t0: number, t1: number) => b >= t0 && a <= t1;

/** 某条轨在 t 处的片段(播放头所在的那段)。 */
export function clipAt(track: Track | undefined, t: number): Clip | undefined {
  if (!track) return undefined;
  return track.clips.find((c) => t >= c.start && t < c.end) ?? (track.clips.length && t >= track.clips[track.clips.length - 1].end - 1e-6 ? track.clips[track.clips.length - 1] : undefined);
}
