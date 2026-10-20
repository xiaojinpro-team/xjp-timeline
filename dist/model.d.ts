/**
 * @xjp/timeline 的数据模型与纯函数(无 React、无 DOM)。
 *
 * 时间一律是秒(number),x = 秒 × pps(每秒像素)。宿主把自己的业务(镜头、版本、看片记录、切点…)
 * 翻译成这套 tracks / markers,时间轴只管画和换算 —— 没有任何宿主私有分支。
 */
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
    attrs?: DataAttrs;
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
export type MarkerKind = "chapter" | "change" | "version" | "cut-hard" | "cut-soft" | "cut-manual" | "candidate" | "missing" | "note";
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
export declare const TRACK_HEIGHTS: Record<TrackKind, number>;
export declare const trackHeight: (t: Track) => number;
export declare const trackToggle: (t: Track) => "hide" | "mute" | "none";
export declare const trackOff: (t: Track) => boolean;
export declare const DEFAULT_MAX_PPS = 400;
export declare const DEFAULT_MIN_USABLE_PPS = 6;
export declare const fitPps: (viewW: number, total: number) => number;
export declare const clampPps: (pps: number, minPps: number, maxPps?: number) => number;
export declare const clampScroll: (x: number, pps: number, total: number, viewW: number) => number;
export declare const ppsToSlider: (pps: number, minPps: number, maxPps?: number) => number;
export declare const sliderToPps: (v: number, minPps: number, maxPps?: number) => number;
/** 以视口里 anchorPx 那一点为不动点换缩放,返回新的 scrollX。 */
export declare const zoomAround: (scrollX: number, oldPps: number, newPps: number, anchorPx: number) => number;
export interface RulerTick {
    t: number;
    major: boolean;
    label?: string;
}
/** 主刻度间距 ≥ 72 px,步长从帧级到分钟级里挑;次刻度 2/4/5 分(≥ 8 px)。标签整秒 `m:ss`,帧级 `m:ss:ffF`。 */
export declare function rulerTicks(t0: number, t1: number, pps: number, fps: number): RulerTick[];
export declare function rulerLabel(t: number, frames: boolean, fps: number): string;
/** `mm:ss:ffF`(帧号从 0)—— 播放头与角落读数用。 */
export declare function timecode(seconds: number, fps: number): string;
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
export declare function stripGeom(s: ThumbStrip, laneH: number): StripGeom;
/**
 * 一个片段宽 widthPx(在 pps 下),铺 [visA, visB)(片段内像素)里的格子:每格显示宽 = tileW(轨道高按格子比例),
 * 第 k 格取它中点那一刻所在的那一格图。返回每格在精灵图里的列 / 行。
 */
export declare function stripTiles(g: StripGeom, pps: number, widthPx: number, tileW: number, visA?: number, visB?: number): {
    x: number;
    col: number;
    row: number;
}[];
/** 峰值 → SVG 路径(viewBox 0..n × 0..100,上下对称,中线 50),缩放时只拉伸不重算。 */
export declare function waveformPath(peaks: number[], gain?: number): string;
/** 取 fetch 回来的 JSON 里的峰值:数组 / {peaks} / {audio:{peaks}}。 */
export declare function peaksFromJson(j: unknown): number[] | null;
export declare const intersects: (a: number, b: number, t0: number, t1: number) => boolean;
/** 某条轨在 t 处的片段(播放头所在的那段)。 */
export declare function clipAt(track: Track | undefined, t: number): Clip | undefined;
export type GestureMode = "idle" | "scrub" | "maybe-pan" | "pan" | "pinch";
/**
 * 拖动中收到一个 pointermove,却已经没有按键按着(鼠标在控件外松开、浏览器把 pointerup 吞了 / 丢了 capture):
 * 这次拖动其实早结束了,必须当场收尾,不然鼠标回来「不按也跟着走」。
 */
export declare function isStaleDrag(mode: GestureMode, pointerType: string, buttons: number): boolean;
/** 划过预览只在:开着、没在播、没有拖动 / 手势、鼠标(或笔)悬停时生效;触屏没有悬停。 */
export declare function canSkim(on: boolean, playing: boolean, mode: GestureMode, pointerType: string): boolean;
