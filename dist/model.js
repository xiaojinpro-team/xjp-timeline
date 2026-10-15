/**
 * @xjp/timeline 的数据模型与纯函数(无 React、无 DOM)。
 *
 * 时间一律是秒(number),x = 秒 × pps(每秒像素)。宿主把自己的业务(镜头、版本、看片记录、切点…)
 * 翻译成这套 tracks / markers,时间轴只管画和换算 —— 没有任何宿主私有分支。
 */
/* ══════════════════════════ 轨道默认 */
export const TRACK_HEIGHTS = { subtitle: 24, overlay: 40, video: 58, audio: 44, music: 38, fx: 34 };
export const trackHeight = (t) => t.height ?? TRACK_HEIGHTS[t.kind];
export const trackToggle = (t) => t.toggle ?? (t.kind === "audio" || t.kind === "music" || t.kind === "fx" ? "mute" : "hide");
export const trackOff = (t) => (trackToggle(t) === "mute" ? !!t.muted : !!t.hidden);
/* ══════════════════════════ 缩放与滚动 */
export const DEFAULT_MAX_PPS = 400;
export const DEFAULT_MIN_USABLE_PPS = 6;
export const fitPps = (viewW, total) => (total > 0 && viewW > 0 ? viewW / total : 10);
export const clampPps = (pps, minPps, maxPps = DEFAULT_MAX_PPS) => Math.max(minPps, Math.min(Math.max(minPps * 1.01, maxPps), pps));
export const clampScroll = (x, pps, total, viewW) => Math.max(0, Math.min(x, Math.max(0, total * pps - viewW)));
export const ppsToSlider = (pps, minPps, maxPps = DEFAULT_MAX_PPS) => (minPps >= maxPps ? 0 : Math.log(pps / minPps) / Math.log(maxPps / minPps));
export const sliderToPps = (v, minPps, maxPps = DEFAULT_MAX_PPS) => minPps * Math.pow(maxPps / minPps, Math.max(0, Math.min(1, v)));
/** 以视口里 anchorPx 那一点为不动点换缩放,返回新的 scrollX。 */
export const zoomAround = (scrollX, oldPps, newPps, anchorPx) => ((scrollX + anchorPx) / oldPps) * newPps - anchorPx;
/** 主刻度间距 ≥ 72 px,步长从帧级到分钟级里挑;次刻度 2/4/5 分(≥ 8 px)。标签整秒 `m:ss`,帧级 `m:ss:ffF`。 */
export function rulerTicks(t0, t1, pps, fps) {
    const f = Math.max(1, Math.round(fps));
    const frameSteps = [1, 2, 5, 10].filter((n) => n < f).map((n) => n / f);
    const steps = [...frameSteps, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = steps.find((s) => s * pps >= 72) ?? 600;
    const subs = [5, 4, 2].find((d) => (major * pps) / d >= 8 && (major < 1 ? Math.abs(((major * f) / d) % 1) < 1e-6 : true)) ?? 1;
    const minor = major / subs;
    const out = [];
    const start = Math.max(0, Math.floor(t0 / minor) * minor);
    for (let i = 0; i < 5000; i++) {
        const t = start + i * minor;
        if (t > t1 + 1e-9)
            break;
        const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
        out.push({ t, major: isMajor, ...(isMajor ? { label: rulerLabel(t, major < 1, f) } : {}) });
    }
    return out;
}
export function rulerLabel(t, frames, fps) {
    const totalFrames = Math.round(t * fps);
    const s = Math.floor(totalFrames / fps);
    const p = (n) => String(n).padStart(2, "0");
    const base = `${Math.floor(s / 60)}:${p(s % 60)}`;
    return frames ? `${base}:${p(totalFrames % fps)}f` : base;
}
/** `mm:ss:ffF`(帧号从 0)—— 播放头与角落读数用。 */
export function timecode(seconds, fps) {
    const f = Math.max(1, Math.round(fps));
    const totalFrames = Math.max(0, Math.floor(seconds * fps + 1e-6));
    const p = (n) => String(n).padStart(2, "0");
    const totalS = Math.floor(totalFrames / f);
    return `${p(Math.floor(totalS / 60))}:${p(totalS % 60)}:${p(totalFrames % f)}f`;
}
export function stripGeom(s, laneH) {
    const rows = s.rows ?? 1;
    const cellH = s.cellHeight ?? laneH;
    const cellW = s.cellWidth ?? Math.round((cellH * 16) / 9);
    return { url: s.url, cols: s.cols, rows, count: s.count ?? s.cols * rows, frameStep: s.frameStep, cellW, cellH, offset: s.offset ?? 0 };
}
/**
 * 一个片段宽 widthPx(在 pps 下),铺 [visA, visB)(片段内像素)里的格子:每格显示宽 = tileW(轨道高按格子比例),
 * 第 k 格取它中点那一刻所在的那一格图。返回每格在精灵图里的列 / 行。
 */
export function stripTiles(g, pps, widthPx, tileW, visA = 0, visB = widthPx) {
    const out = [];
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
export function waveformPath(peaks, gain = 1) {
    const n = peaks.length;
    if (!n)
        return "";
    const top = [];
    const bottom = [];
    for (let i = 0; i < n; i++) {
        const a = Math.min(1, Math.max(0, peaks[i] * gain)) * 48;
        top.push(`${i},${(50 - a - 0.6).toFixed(1)}`);
        bottom.push(`${i},${(50 + a + 0.6).toFixed(1)}`);
    }
    return `M0,50L${top.join("L")}L${n},50L${bottom.reverse().join("L")}Z`;
}
/** 取 fetch 回来的 JSON 里的峰值:数组 / {peaks} / {audio:{peaks}}。 */
export function peaksFromJson(j) {
    if (Array.isArray(j))
        return j.filter((x) => typeof x === "number");
    if (j && typeof j === "object") {
        const o = j;
        if (Array.isArray(o.peaks))
            return o.peaks;
        if (o.audio && Array.isArray(o.audio.peaks))
            return o.audio.peaks;
    }
    return null;
}
/* ══════════════════════════ 可视区间 */
export const intersects = (a, b, t0, t1) => b >= t0 && a <= t1;
/** 某条轨在 t 处的片段(播放头所在的那段)。 */
export function clipAt(track, t) {
    if (!track)
        return undefined;
    return track.clips.find((c) => t >= c.start && t < c.end) ?? (track.clips.length && t >= track.clips[track.clips.length - 1].end - 1e-6 ? track.clips[track.clips.length - 1] : undefined);
}
