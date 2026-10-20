/**
 * <Timeline>:多轨时间线(轨道像 Premiere、样子像 FCPX)。
 *
 *   · 轨道按 `tracks` 的顺序从上到下画;轨道头在左(轨名 + 隐藏 / 静音)。上方两行:刻度(随缩放变密)+ 标记行(章节 / 说明 / 切点 / 缺镜)。
 *   · 时间是一条直线(x = 秒 × pps);只渲染可视区附近的片段;横向滚动与缩放都只改一层 transform。
 *   · 缩放:滑杆(对数)、− / + / 适应、⌘ 或 Ctrl + 滚轮、触控板捏合(含 Safari gesture)、触屏双指。
 *     横向滚:触控板左右划、⇧ + 滚轮、拖底部滚动条(带高亮小地图)、触屏单指拖。
 *   · 鼠标在刻度或轨道上点 / 拖 = onSeek(连续);点在片段上同时 onSelect;触屏轻点 = 跳,拖 = 滚。
 *     拖动用 pointer capture:拖出控件(上下左右、甚至出窗口)照样跟,时间夹在 [0, 片长];松手 / 取消 / 丢 capture /
 *     窗口失焦 / Esc 都收尾,收尾后悬停绝不再动播放头(拖动中收到「没按键」的 move 也当场收尾)。
 *   · 划过预览(FCPX skimming,`skim` + `onSkim`):鼠标划过刻度或轨道 = 一根细线 + onSkim(t)(按动画帧节流),播放头不动;
 *     离开 / 按下 / 播放中 / 关掉 = onSkim(null, why)。给了 onSkimToggle 才出「划过预览」按钮与 S 键。
 *   · 播放头跑出视口(播放中 follow,或键盘跳转)时自动翻页;用户自己滚开的不抢。
 *
 * 宿主负责:把业务翻译成 tracks / markers,接 onSeek / onSelect / onToggleTrack / onClipAction,给缩略图与峰值的地址或数组。
 */
import { type ReactNode } from "react";
import { type Clip, type ClipActionName, type DataAttrs, type Marker, type Track } from "./model.js";
export interface TimelineLabels {
    zoomIn: string;
    zoomOut: string;
    zoomSlider: string;
    fit: string;
    fitTitle: string;
    visible: string;
    hide: string;
    show: string;
    mute: string;
    unmute: string;
    timeline: string;
    empty: string;
    missing: string;
    skim: string;
    skimTitle: string;
    skimming: string;
}
export declare const ZH_LABELS: TimelineLabels;
export declare const EN_LABELS: TimelineLabels;
/** 划过预览结束的原因:离开时间线 / 按下(点或拖,播放头随后由 onSeek 定)/ 开始播放 / 关掉开关 */
export type SkimEnd = "leave" | "press" | "playing" | "off";
export interface ClipActionContext {
    t: number;
    clip?: Clip;
    track?: Track;
}
export interface TimelineProps {
    fps: number;
    duration: number;
    tracks: Track[];
    markers?: Marker[];
    /** 播放头(秒) */
    playhead: number;
    /** 选中的片段 id(可多个,如同一镜头在视频轨和旁白轨上的两段) */
    selection?: string | string[] | null;
    /** 受控缩放(每秒像素);不给 = 组件自己管 */
    zoom?: number;
    /** 受控「适应」;不给 = 组件自己管(初始适应) */
    fit?: boolean;
    /** 播放中:播放头跑出视口就翻页跟上 */
    follow?: boolean;
    onSeek: (t: number) => void;
    onSelect?: (clip: Clip, track: Track) => void;
    onToggleTrack?: (trackId: string) => void;
    onZoom?: (pps: number, fit: boolean) => void;
    onMarkerClick?: (marker: Marker) => void;
    onClipAction?: (action: ClipActionName, ctx: ClipActionContext) => void;
    /** 双击片段(如「循环这一镜」) */
    onClipDoubleClick?: (clip: Clip, track: Track) => void;
    /** 键 → 片段动作(只在给了 onClipAction 时生效;输入框里与带修饰键时不响应),如 `{ c: "split", m: "merge-prev" }` */
    keymap?: Partial<Record<string, ClipActionName>>;
    /** 片段悬停提示的内容(不给就用 clip.title 原生提示) */
    renderTooltip?: (clip: Clip, track: Track) => ReactNode;
    /** 可视区间变化(防抖 80 ms):宿主按需加载缩略图 / 峰值 */
    onVisibleRangeChange?: (t0: number, t1: number) => void;
    toolbarStart?: ReactNode;
    toolbarEnd?: ReactNode;
    /** 左上角(轨道头上方)的读数;默认 = 播放头时码 */
    corner?: ReactNode;
    theme?: "dark" | "light";
    labels?: Partial<TimelineLabels>;
    maxPps?: number;
    /** 窄屏(视口 < 640)上「适应」至少给这么多 px/s */
    minUsablePps?: number;
    className?: string;
    /** 根元素上的 data-* */
    attrs?: DataAttrs;
    /** 划过预览(FCPX skimming)开着 */
    skim?: boolean;
    /** 给了才出「划过预览」开关按钮与快捷键;via = 点按钮还是按键 */
    onSkimToggle?: (on: boolean, via: "button" | "key") => void;
    /** 划过的时间(秒,按动画帧节流);null = 结束(why 说明原因,"press" 时宿主别把画面拉回旧播放头) */
    onSkim?: (t: number | null, why?: SkimEnd) => void;
    /** 宿主在播放:划过预览暂停(FCPX 同款) */
    playing?: boolean;
    /** 开关划过预览的键(不带修饰键;输入框里不响应);默认 "s" */
    skimKey?: string;
}
export declare function Timeline(props: TimelineProps): import("react/jsx-runtime").JSX.Element;
