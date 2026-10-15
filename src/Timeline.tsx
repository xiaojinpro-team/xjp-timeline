"use client";

/**
 * <Timeline>:多轨时间线(轨道像 Premiere、样子像 FCPX)。
 *
 *   · 轨道按 `tracks` 的顺序从上到下画;轨道头在左(轨名 + 隐藏 / 静音)。上方两行:刻度(随缩放变密)+ 标记行(章节 / 说明 / 切点 / 缺镜)。
 *   · 时间是一条直线(x = 秒 × pps);只渲染可视区附近的片段;横向滚动与缩放都只改一层 transform。
 *   · 缩放:滑杆(对数)、− / + / 适应、⌘ 或 Ctrl + 滚轮、触控板捏合(含 Safari gesture)、触屏双指。
 *     横向滚:触控板左右划、⇧ + 滚轮、拖底部滚动条(带高亮小地图)、触屏单指拖。
 *   · 鼠标在刻度或轨道上点 / 拖 = onSeek(连续);点在片段上同时 onSelect;触屏轻点 = 跳,拖 = 滚。
 *   · 播放头跑出视口(播放中 follow,或键盘跳转)时自动翻页;用户自己滚开的不抢。
 *
 * 宿主负责:把业务翻译成 tracks / markers,接 onSeek / onSelect / onToggleTrack / onClipAction,给缩略图与峰值的地址或数组。
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  clampPps,
  clampScroll,
  clipAt,
  DEFAULT_MAX_PPS,
  DEFAULT_MIN_USABLE_PPS,
  fitPps,
  intersects,
  peaksFromJson,
  ppsToSlider,
  rulerTicks,
  sliderToPps,
  stripGeom,
  stripTiles,
  timecode,
  trackHeight,
  trackOff,
  trackToggle,
  waveformPath,
  zoomAround,
  type Clip,
  type ClipActionName,
  type DataAttrs,
  type Marker,
  type Peaks,
  type Track,
} from "./model.js";

const RULER_H = 24;
const MARK_H = 36;
const SCROLLBAR_H = 12;

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
}

export const ZH_LABELS: TimelineLabels = {
  zoomIn: "放大",
  zoomOut: "缩小",
  zoomSlider: "时间线缩放",
  fit: "适应",
  fitTitle: "整片放进视口",
  visible: "可见",
  hide: "隐藏",
  show: "显示",
  mute: "静音",
  unmute: "取消静音",
  timeline: "时间线",
  empty: "还没有内容",
  missing: "还没有视频",
};

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
}

export function Timeline(props: TimelineProps) {
  const { fps, duration: total, tracks, playhead, follow = false } = props;
  const L10N = { ...ZH_LABELS, ...props.labels };
  const maxPps = props.maxPps ?? DEFAULT_MAX_PPS;
  const minUsable = props.minUsablePps ?? DEFAULT_MIN_USABLE_PPS;
  const selection = useMemo(() => new Set(props.selection == null ? [] : Array.isArray(props.selection) ? props.selection : [props.selection]), [props.selection]);

  /* ── 视口 ── */
  const viewport = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── 缩放 / 滚动 ── */
  const minPps = Math.max(1e-3, fitPps(viewW, total));
  const [view, setView] = useState<{ pps: number; x: number; fit: boolean }>({ pps: props.zoom ?? 0, x: 0, fit: props.fit ?? props.zoom === undefined });
  const fitMode = props.fit ?? view.fit;
  const wantPps = props.zoom ?? view.pps;
  const fitTarget = Math.max(minPps, viewW && viewW < 640 ? Math.min(minUsable, maxPps) : minPps);
  const pps = fitMode || wantPps <= 0 ? fitTarget : clampPps(wantPps, minPps, maxPps);
  const x = clampScroll(view.x, pps, total, viewW);
  const live = useRef({ pps, x, viewW, total, minPps, playhead });
  useLayoutEffect(() => {
    Object.assign(live.current, { pps, x, viewW, total, minPps, playhead });
  });

  const setZoom = (nextPps: number, anchorPx?: number) => {
    const S = live.current;
    const np = clampPps(nextPps, S.minPps, maxPps);
    const ph = S.playhead * S.pps - S.x;
    const a = anchorPx ?? (ph >= 0 && ph <= S.viewW ? ph : S.viewW / 2);
    const nx = clampScroll(zoomAround(S.x, S.pps, np, a), np, S.total, S.viewW);
    Object.assign(live.current, { pps: np, x: nx });
    setView({ pps: np, x: nx, fit: false });
    props.onZoom?.(np, false);
  };
  const setScroll = (nx: number) => {
    const S = live.current;
    const cx = clampScroll(nx, S.pps, S.total, S.viewW);
    Object.assign(live.current, { x: cx });
    setView((v) => ({ ...v, pps: S.pps, x: cx, fit: v.fit && cx === 0 ? v.fit : false }));
  };
  const fitAll = () => {
    setView({ pps: 0, x: 0, fit: true });
    props.onZoom?.(fitTarget, true);
  };
  const act = useRef({ setZoom, setScroll });
  useLayoutEffect(() => {
    act.current = { setZoom, setScroll };
  });

  /* ── 滚轮 / 手势(原生非 passive)── */
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const S = live.current;
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        act.current.setZoom(S.pps * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX - rect.left);
        return;
      }
      const dx = e.shiftKey && Math.abs(e.deltaX) < 1 ? e.deltaY : e.deltaX;
      if (Math.abs(dx) > Math.abs(e.deltaY) || e.shiftKey) {
        e.preventDefault();
        act.current.setScroll(S.x + dx * (e.deltaMode === 1 ? 16 : 1));
      }
    };
    let gScale = 1;
    let gAnchor = 0;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gScale = 1;
      const r = el.getBoundingClientRect();
      gAnchor = ((e as unknown as { clientX?: number }).clientX ?? r.left + el.clientWidth / 2) - r.left;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const s = (e as unknown as { scale: number }).scale;
      act.current.setZoom(live.current.pps * (s / gScale), gAnchor);
      gScale = s;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  /* ── 指针 ── */
  const gesture = useRef<{ pointers: Map<number, { x: number; y: number }>; mode: "idle" | "scrub" | "maybe-pan" | "pan" | "pinch"; startX: number; startScroll: number; pinch?: { d0: number; pps0: number; x0: number; mid0: number } }>({
    pointers: new Map(),
    mode: "idle",
    startX: 0,
    startScroll: 0,
  });
  const [scrubbing, setScrubbing] = useState(false);
  const tAtClient = (clientX: number) => {
    const el = viewport.current;
    if (!el) return 0;
    const S = live.current;
    return Math.max(0, Math.min(S.total - 1e-3, (clientX - el.getBoundingClientRect().left + S.x) / S.pps));
  };
  const selectAt = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.("[data-xtl-clip]") as HTMLElement | null;
    if (!el || !props.onSelect) return;
    const tr = tracks.find((t) => t.id === el.dataset.xtlTrack);
    const c = tr?.clips.find((k) => k.id === el.dataset.xtlClip);
    if (tr && c && !c.disabled) props.onSelect(c, tr);
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest("[data-xtl-marker-hit]")) return;
    const g = gesture.current;
    const el = viewport.current;
    if (!el) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture?.(e.pointerId);
    const onRuler = (e.target as HTMLElement).closest("[data-xtl-ruler]") !== null;
    if (g.pointers.size === 2 && e.pointerType === "touch") {
      const [a, b] = [...g.pointers.values()];
      const rect = el.getBoundingClientRect();
      g.mode = "pinch";
      g.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), pps0: live.current.pps, x0: live.current.x, mid0: (a.x + b.x) / 2 - rect.left };
      setScrubbing(false);
      return;
    }
    if (e.pointerType === "touch" && !onRuler) {
      g.mode = "maybe-pan";
      g.startX = e.clientX;
      g.startScroll = live.current.x;
      return;
    }
    g.mode = "scrub";
    setScrubbing(true);
    selectAt(e.target);
    props.onSeek(tAtClient(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.mode === "scrub") props.onSeek(tAtClient(e.clientX));
    else if (g.mode === "maybe-pan" && Math.abs(e.clientX - g.startX) > 6) g.mode = "pan";
    if (g.mode === "pan") setScroll(g.startScroll - (e.clientX - g.startX));
    if (g.mode === "pinch" && g.pinch && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const rect = viewport.current!.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = (a.x + b.x) / 2 - rect.left;
      const S = live.current;
      const np = clampPps(g.pinch.pps0 * (d / g.pinch.d0), S.minPps, maxPps);
      const cx = clampScroll(zoomAround(g.pinch.x0, g.pinch.pps0, np, g.pinch.mid0) - (mid - g.pinch.mid0), np, S.total, S.viewW);
      Object.assign(live.current, { pps: np, x: cx });
      setView({ pps: np, x: cx, fit: false });
    }
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    if (g.mode === "maybe-pan" && e.type === "pointerup") {
      selectAt(e.target);
      props.onSeek(tAtClient(e.clientX));
    }
    if (g.mode === "pinch") props.onZoom?.(live.current.pps, false);
    g.pointers.delete(e.pointerId);
    if (g.pointers.size === 0) {
      g.mode = "idle";
      setScrubbing(false);
    } else if (g.mode === "pinch") g.mode = "idle";
  };

  /* ── 跟随播放头 ── */
  useLayoutEffect(() => {
    const S = live.current;
    if (!S.viewW || gesture.current.mode !== "idle") return;
    const px = playhead * S.pps - S.x;
    if (px >= 24 && px <= S.viewW - 24) return;
    if (!follow && px >= 0 && px <= S.viewW) return;
    act.current.setScroll(playhead * S.pps - S.viewW * (follow ? 0.15 : 0.3));
  }, [playhead, follow]);

  /* ── 片段动作快捷键 ── */
  const keymapRef = useRef(props);
  useLayoutEffect(() => {
    keymapRef.current = props;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const P = keymapRef.current;
      if (!P.keymap || !P.onClipAction || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const action = P.keymap[e.key];
      if (!action) return;
      e.preventDefault();
      const sel = new Set(P.selection == null ? [] : Array.isArray(P.selection) ? P.selection : [P.selection]);
      let clip: Clip | undefined;
      let track: Track | undefined;
      for (const tr of P.tracks) {
        const c = tr.clips.find((k) => sel.has(k.id));
        if (c) {
          clip = c;
          track = tr;
          break;
        }
      }
      P.onClipAction(action, { t: P.playhead, clip, track });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /* ── 可视区间 ── */
  const t0 = (x - viewW * 0.5) / pps;
  const t1 = (x + viewW * 1.5) / pps;
  const onVis = props.onVisibleRangeChange;
  useEffect(() => {
    if (!onVis || !viewW) return;
    const id = window.setTimeout(() => onVis(Math.max(0, t0), Math.min(total, t1)), 80);
    return () => window.clearTimeout(id);
  }, [onVis, t0, t1, total, viewW]);

  /* ── 布局 ── */
  const contentW = total * pps;
  const narrow = viewW > 0 && viewW < 480;
  const headW = narrow ? 64 : 112;
  const lanesH = tracks.reduce((n, t) => n + trackHeight(t), 0);
  const edge = playhead * pps - x < 34 ? "left" : playhead * pps - x > viewW - 34 ? "right" : null;

  const [tip, setTip] = useState<{ x: number; y: number; node: ReactNode } | null>(null);
  const tipTimer = useRef<number | null>(null);
  const onClipHover = props.renderTooltip
    ? (clip: Clip | null, track: Track | null, ev?: React.PointerEvent) => {
        if (tipTimer.current) window.clearTimeout(tipTimer.current);
        if (!clip || !track || !ev) return setTip(null);
        const cx = ev.clientX;
        const cy = (ev.currentTarget as HTMLElement).getBoundingClientRect().top;
        tipTimer.current = window.setTimeout(() => setTip({ x: cx, y: cy, node: props.renderTooltip!(clip, track) }), 220);
      }
    : undefined;

  return (
    <section aria-label={L10N.timeline} className={cx("xtl", props.className)} data-theme={props.theme ?? "dark"} {...props.attrs}>
      <header className="xtl-toolbar">
        <div className="xtl-toolbar-start">{props.toolbarStart}</div>
        <div className="xtl-toolbar-end">
          {props.toolbarEnd}
          <ZoomControl pps={pps} minPps={minPps} maxPps={maxPps} viewW={viewW} onZoom={(p) => setZoom(p)} onFit={fitAll} fitOn={fitMode} L={L10N} />
        </div>
      </header>

      <div className="xtl-body">
        <div className="xtl-heads" style={{ width: headW }}>
          <div className="xtl-corner" style={{ height: RULER_H + MARK_H }}>
            {props.corner ?? <span className="xtl-mono xtl-faint">{timecode(playhead, fps)}</span>}
          </div>
          {tracks.map((t) => (
            <TrackHead key={t.id} track={t} narrow={narrow} L={L10N} onToggle={props.onToggleTrack ? () => props.onToggleTrack!(t.id) : undefined} />
          ))}
          <div style={{ height: SCROLLBAR_H }} />
        </div>

        <div
          ref={viewport}
          data-xtl-viewport=""
          className={cx("xtl-viewport", scrubbing && "xtl-scrubbing")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <div className="xtl-content" style={{ width: Math.max(contentW, viewW), transform: `translate3d(${-x}px,0,0)` }}>
            <Ruler t0={Math.max(0, x / pps)} t1={(x + viewW) / pps} pps={pps} fps={fps} total={total} />
            <MarkerRow markers={props.markers ?? []} pps={pps} t0={t0} t1={t1} viewX={x} onMarkerClick={props.onMarkerClick} L={L10N} />
            <div
              role="slider"
              tabIndex={-1}
              aria-label={L10N.timeline}
              aria-valuemin={0}
              aria-valuemax={Math.round(total * 100) / 100}
              aria-valuenow={Math.round(playhead * 100) / 100}
              aria-valuetext={timecode(playhead, fps)}
              data-xtl-lanes=""
              className="xtl-lanes"
              style={{ height: lanesH }}
            >
              <Lanes tracks={tracks} pps={pps} t0={t0} t1={t1} viewX={x} viewW={viewW} playhead={playhead} selection={selection} onHover={onClipHover} />
            </div>
            <div data-xtl-playhead="" className="xtl-playhead" style={{ transform: `translate3d(${playhead * pps}px,0,0)` }}>
              <span className="xtl-playhead-tc xtl-mono" style={edge ? { transform: edge === "left" ? "translateX(-2px)" : "translateX(calc(-100% + 2px))" } : undefined}>
                {timecode(playhead, fps)}
              </span>
            </div>
          </div>
          {!total && <p className="xtl-empty">{L10N.empty}</p>}
        </div>
      </div>

      <Scrollbar x={x} viewW={viewW} contentW={contentW} headW={headW} tracks={tracks} total={total} onScroll={setScroll} />
      {tip && (
        <div className="xtl-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.node}
        </div>
      )}
    </section>
  );
}

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

/* ══════════════════════════ 工具条:缩放 */

const Icon = {
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  fit: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: <path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  vol: <path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />,
  volOff: <path d="M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6" />,
};

function Svg({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function ZoomControl({ pps, minPps, maxPps, viewW, onZoom, onFit, fitOn, L }: { pps: number; minPps: number; maxPps: number; viewW: number; onZoom: (p: number) => void; onFit: () => void; fitOn: boolean; L: TimelineLabels }) {
  const span = viewW > 0 ? viewW / pps : 0;
  return (
    <div className="xtl-zoom" data-xtl-zoom="">
      <button type="button" className="xtl-btn" aria-label={L.zoomOut} title={L.zoomOut} onClick={() => onZoom(pps / 1.6)} disabled={pps <= minPps * 1.001}>
        <Svg>{Icon.minus}</Svg>
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(ppsToSlider(pps, minPps, maxPps) * 1000)}
        aria-label={L.zoomSlider}
        aria-valuetext={`${L.visible} ${spanLabel(span)}`}
        className="xtl-zoom-range"
        onChange={(e) => onZoom(sliderToPps(Number(e.target.value) / 1000, minPps, maxPps))}
      />
      <button type="button" className="xtl-btn" aria-label={L.zoomIn} title={L.zoomIn} onClick={() => onZoom(pps * 1.6)} disabled={pps >= maxPps * 0.999}>
        <Svg>{Icon.plus}</Svg>
      </button>
      <button type="button" className={cx("xtl-btn xtl-btn-wide", fitOn && "xtl-btn-on")} title={L.fitTitle} aria-pressed={fitOn} onClick={onFit} data-xtl-fit="">
        <Svg size={12}>{Icon.fit}</Svg>
        <span>{L.fit}</span>
      </button>
      <span className="xtl-span xtl-mono xtl-faint" data-xtl-span="">
        {span > 0 ? `${L.visible} ${spanLabel(span)}` : ""}
      </span>
    </div>
  );
}

function spanLabel(s: number): string {
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

/* ══════════════════════════ 轨道头 */

function TrackHead({ track, narrow, L, onToggle }: { track: Track; narrow: boolean; L: TimelineLabels; onToggle?: () => void }) {
  const mode = trackToggle(track);
  const off = trackOff(track);
  const verb = mode === "mute" ? (off ? L.unmute : L.mute) : off ? L.show : L.hide;
  return (
    <div className={cx("xtl-head", narrow && "xtl-head-narrow", off && "xtl-head-off")} style={{ height: trackHeight(track) }} data-xtl-head={track.id}>
      <span className={cx("xtl-chip xtl-mono", `xtl-kind-${track.kind}`)}>{track.id}</span>
      {!narrow && <span className="xtl-head-name">{track.name}</span>}
      {mode !== "none" && onToggle && (
        <button type="button" aria-pressed={off} aria-label={`${track.id} ${track.name} ${verb}`} title={`${verb} ${track.id} ${track.name}${track.toggleHint ? `(${track.toggleHint})` : ""}`} data-xtl-toggle={track.id} onClick={onToggle} className="xtl-iconbtn">
          <Svg>{mode === "mute" ? (off ? Icon.volOff : Icon.vol) : off ? Icon.eyeOff : Icon.eye}</Svg>
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════ 刻度 */

const Ruler = memo(function Ruler({ t0, t1, pps, fps, total }: { t0: number; t1: number; pps: number; fps: number; total: number }) {
  const ticks = rulerTicks(Math.max(0, t0 - 2), Math.min(total, t1 + 2), pps, fps);
  return (
    <div data-xtl-ruler="" className="xtl-ruler" style={{ height: RULER_H }}>
      {ticks.map((k) => (
        <div key={k.t.toFixed(4)} className={k.major ? "xtl-tick xtl-tick-major" : "xtl-tick"} style={{ left: k.t * pps }}>
          {k.label && <span className="xtl-tick-label xtl-mono">{k.label}</span>}
        </div>
      ))}
    </div>
  );
});

/* ══════════════════════════ 标记行 */

const MarkerRow = memo(function MarkerRow({ markers, pps, t0, t1, viewX, onMarkerClick, L }: { markers: Marker[]; pps: number; t0: number; t1: number; viewX: number; onMarkerClick?: (m: Marker) => void; L: TimelineLabels }) {
  // 同一时刻的几个「缺」并排
  let run = 0;
  let prevMissing: number | null = null;
  const missingX = new Map<Marker, number>();
  for (const m of markers) {
    if (m.kind !== "missing") continue;
    run = prevMissing !== null && Math.abs(prevMissing - m.t) < 1e-6 ? run + 1 : 0;
    prevMissing = m.t;
    missingX.set(m, Math.max(0, m.t * pps - 9) + run * 9);
  }
  return (
    <div className="xtl-marks" style={{ height: MARK_H }}>
      {markers.map((m, i) => {
        const a = m.t;
        const b = m.until ?? m.t;
        if (!intersects(a, b, t0, t1)) return null;
        const key = m.id ?? `${m.kind}-${i}`;
        const common = { "data-xtl-marker": m.kind, title: m.title ?? m.label, ...m.attrs };
        if (m.kind === "chapter") {
          const w = Math.max(0, (b - a) * pps);
          return (
            <div key={key} {...common} className="xtl-chapter" style={{ left: a * pps, width: w }}>
              <span className="xtl-chapter-pin" aria-hidden />
              <span className="xtl-chapter-label" style={{ marginLeft: Math.max(0, Math.min(viewX - a * pps, w - 120)) }}>
                {m.label}
              </span>
            </div>
          );
        }
        if (m.kind === "change") {
          return (
            <p key={key} {...common} className="xtl-note" style={{ left: a * pps + 1, width: Math.max(0, (b - a) * pps - 2) }}>
              {m.label}
            </p>
          );
        }
        if (m.kind === "missing") {
          return (
            <button
              key={key}
              type="button"
              {...common}
              data-xtl-marker-hit=""
              aria-label={`${m.label ?? ""}:${L.missing}`}
              className={cx("xtl-missing", m.selected && "xtl-marker-selected")}
              style={{ left: missingX.get(m) }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onMarkerClick?.(m);
              }}
            />
          );
        }
        // 切点 / 候选 / 版本:标记行底部的小刻,候选可点
        const clickable = !!onMarkerClick && (m.kind === "candidate" || m.kind === "version");
        return (
          <button
            key={key}
            type="button"
            {...common}
            {...(clickable ? { "data-xtl-marker-hit": "" } : {})}
            tabIndex={clickable ? 0 : -1}
            className={cx("xtl-cut", `xtl-cut-${m.kind}`, m.selected && "xtl-marker-selected")}
            style={{ left: a * pps }}
            onPointerDown={
              clickable
                ? (e) => {
                    e.stopPropagation();
                    onMarkerClick!(m);
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
});

/* ══════════════════════════ 轨道内容 */

interface LanesProps {
  tracks: Track[];
  pps: number;
  t0: number;
  t1: number;
  viewX: number;
  viewW: number;
  playhead: number;
  selection: Set<string>;
  onHover?: (clip: Clip | null, track: Track | null, ev?: React.PointerEvent) => void;
}

function Lanes(p: LanesProps) {
  const tops = p.tracks.map((_, i) => p.tracks.slice(0, i).reduce((n, t) => n + trackHeight(t), 0));
  return (
    <>
      {p.tracks.map((t, i) => (
        <Lane key={t.id} {...p} track={t} top={tops[i]} cur={clipAt(t, p.playhead)?.id} />
      ))}
    </>
  );
}

const Lane = memo(function Lane({ track, top, cur, pps, t0, t1, viewX, viewW, selection, onHover }: LanesProps & { track: Track; top: number; cur?: string }) {
  const h = trackHeight(track);
  return (
    <div data-xtl-lane={track.id} className={cx("xtl-lane", `xtl-lane-${track.kind}`, trackOff(track) && "xtl-lane-off")} style={{ top, height: h }}>
      {track.clips.map((c) =>
        intersects(c.start, c.end, t0, t1) ? (
          <ClipView key={c.id} clip={c} track={track} laneH={h} pps={pps} viewX={viewX} viewW={viewW} isCur={c.id === cur} selected={selection.has(c.id)} onHover={onHover} />
        ) : null,
      )}
    </div>
  );
});

function ClipView({ clip: c, track, laneH, pps, viewX, viewW, isCur, selected, onHover }: { clip: Clip; track: Track; laneH: number; pps: number; viewX: number; viewW: number; isCur: boolean; selected: boolean; onHover?: LanesProps["onHover"] }) {
  const dur = Math.max(1e-6, c.end - c.start);
  const left = c.start * pps;
  const w = dur * pps;
  const strip = useImage(c.thumbStrip?.url);
  const peaks = usePeaks(c.peaks);
  const hasStrip = strip === "ok";
  const ranges = c.ranges ?? [];
  const isAudio = track.kind === "audio" || track.kind === "music" || track.kind === "fx";
  const thin = track.kind === "subtitle";
  const badges = c.badges ?? [];
  return (
    <div
      data-xtl-clip={c.id}
      data-xtl-track={track.id}
      data-current={isCur}
      data-selected={selected}
      data-highlight={c.highlight ?? undefined}
      data-partial={ranges.some((r) => (r.kind ?? "change") === "change")}
      data-strip={c.thumbStrip ? (hasStrip ? "on" : strip === "fail" ? "fallback" : "pending") : "none"}
      data-wave={c.peaks ? (peaks?.length ? "on" : "off") : undefined}
      {...c.attrs}
      title={onHover ? undefined : c.title}
      onPointerEnter={onHover ? (e) => onHover(c, track, e) : undefined}
      onPointerLeave={onHover ? () => onHover(null, null) : undefined}
      className={cx("xtl-clip", `xtl-kind-${track.kind}`, thin && "xtl-clip-thin", hasStrip && "xtl-clip-strip", c.disabled && "xtl-clip-disabled", isCur && "xtl-clip-cur", selected && "xtl-clip-selected", (c.highlight === "selected-for" || c.highlight === "warn") && `xtl-hl-${c.highlight}`)}
      style={{ left: left + 1, width: Math.max(1, w - 2), ...(c.color ? { background: c.color } : null) }}
    >
      {hasStrip && c.thumbStrip && <Filmstrip strip={c.thumbStrip} laneH={laneH} pps={pps} width={w - 2} visA={viewX - left - viewW * 0.25} visB={viewX + viewW * 1.25 - left} />}
      {isAudio && peaks && peaks.length > 0 && <Wave peaks={peaks} step={c.peaks!.step} dur={dur} />}
      {ranges.map((r, k) => (
        <div key={`${r.start}-${r.end}-${k}`} data-xtl-range={r.kind ?? "change"} className={cx("xtl-range", r.kind === "fading" && "xtl-fade")} style={{ left: `${(r.start / dur) * 100}%`, width: `${((r.end - r.start) / dur) * 100}%` }}>
          {(r.covered ?? []).map(([ca, cb], j) => {
            const lo = Math.max(r.start, ca);
            const hi = Math.min(r.end, cb);
            if (hi <= lo) return null;
            return <div key={j} className="xtl-range-seen" style={{ left: `${((lo - r.start) / (r.end - r.start)) * 100}%`, width: `${((hi - lo) / (r.end - r.start)) * 100}%` }} />;
          })}
        </div>
      ))}
      {(c.highlight === "change" || c.highlight === "fading") && (
        <div data-xtl-range={c.highlight} data-whole="" className={cx("xtl-whole", c.highlight === "fading" && "xtl-fade")}>
          {(c.covered ?? []).map(([ca, cb], j) => {
            const lo = Math.max(0, ca);
            const hi = Math.min(dur, cb);
            if (hi <= lo) return null;
            return <div key={j} className="xtl-range-seen" style={{ left: `${(lo / dur) * 100}%`, width: `${((hi - lo) / dur) * 100}%` }} />;
          })}
        </div>
      )}
      {w > 14 && (c.label || badges.length > 0) && (
        <div className={cx("xtl-clip-label", thin && "xtl-clip-label-thin")}>
          {c.label && <span className="xtl-clip-name">{c.label}</span>}
          {badges.map((b, k) => (
            <Badge key={k} b={b} w={w} />
          ))}
        </div>
      )}
      {c.sublabel && w > 44 && <span className="xtl-clip-sub xtl-mono">{c.sublabel}</span>}
    </div>
  );
}

function Badge({ b, w }: { b: NonNullable<Clip["badges"]>[number]; w: number }) {
  if (b.kind === "new") return <span aria-label={b.label ?? "new"} className="xtl-badge-new" />;
  if (b.kind === "error") return <span aria-label={b.label ?? "error"} className="xtl-badge-error" />;
  if (b.kind === "version") return w > 70 ? <span className="xtl-badge-ver xtl-mono">{b.label}</span> : null;
  if (b.kind === "star") return w > 40 ? <span className="xtl-badge-star">{b.label ?? "★"}</span> : null;
  if (b.kind === "dots") {
    const n = Math.min(b.count ?? 0, 6);
    if (w <= 96 || n < 2) return null;
    return (
      <span className="xtl-dots" aria-label={b.label ?? `${b.count}`} data-xtl-dots="">
        {Array.from({ length: n }, (_, k) => (
          <span key={k} className={k === n - 1 ? "xtl-dot xtl-dot-cur" : "xtl-dot"} />
        ))}
      </span>
    );
  }
  return w > 60 ? <span className="xtl-badge-text">{b.label}</span> : null;
}

function Filmstrip({ strip, laneH, pps, width, visA, visB }: { strip: NonNullable<Clip["thumbStrip"]>; laneH: number; pps: number; width: number; visA: number; visB: number }) {
  const g = stripGeom(strip, laneH - 4);
  // 显示高 = 轨道高 − 4;宽按格子比例
  const dispH = laneH - 4;
  const scale = dispH / g.cellH;
  const tileW = Math.max(8, Math.round(g.cellW * scale));
  const tiles = stripTiles(g, pps, width, tileW, Math.max(0, visA), Math.min(width, visB));
  return (
    <div className="xtl-strip" aria-hidden>
      {tiles.map((t) => (
        <div
          key={t.x}
          style={{
            left: t.x,
            width: tileW,
            height: dispH,
            backgroundImage: `url("${g.url}")`,
            backgroundPosition: `${-t.col * g.cellW * scale}px ${-t.row * g.cellH * scale}px`,
            backgroundSize: `${g.cols * g.cellW * scale}px ${g.rows * g.cellH * scale}px`,
          }}
        />
      ))}
    </div>
  );
}

function Wave({ peaks, step, dur }: { peaks: number[]; step: number; dur: number }) {
  const d = useMemo(() => waveformPath(peaks), [peaks]);
  const widthPct = Math.min(100, ((peaks.length * step) / dur) * 100);
  return (
    <svg className="xtl-wave" style={{ width: `${widthPct}%` }} viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/* ══════════════════════════ 图 / 峰值加载(带缓存) */

const imageState = new Map<string, "ok" | "fail" | Promise<void>>();
function useImage(url: string | undefined): "ok" | "fail" | "pending" | undefined {
  const [, bump] = useState(0);
  const s = url ? imageState.get(url) : undefined;
  useEffect(() => {
    if (!url) return;
    let st = imageState.get(url);
    if (st === "ok" || st === "fail") return;
    if (!st) {
      st = new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => (imageState.set(url, "ok"), resolve());
        img.onerror = () => (imageState.set(url, "fail"), resolve());
        img.src = url;
      });
      imageState.set(url, st);
    }
    let dead = false;
    void (st as Promise<void>).then(() => !dead && bump((n) => n + 1));
    return () => {
      dead = true;
    };
  }, [url]);
  if (!url) return undefined;
  return s === "ok" || s === "fail" ? s : "pending";
}

const peakCache = new Map<string, number[] | null | Promise<void>>();
function usePeaks(p: Peaks | undefined): number[] | null | undefined {
  const [, bump] = useState(0);
  const url = p?.array ? undefined : p?.url;
  useEffect(() => {
    if (!url) return;
    let st = peakCache.get(url);
    if (Array.isArray(st) || st === null) return;
    if (!st) {
      st = fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => void peakCache.set(url, peaksFromJson(j)))
        .catch(() => void peakCache.set(url, null));
      peakCache.set(url, st);
    }
    let dead = false;
    void (st as Promise<void>).then(() => !dead && bump((n) => n + 1));
    return () => {
      dead = true;
    };
  }, [url]);
  if (!p) return undefined;
  if (p.array) return p.array;
  const v = url ? peakCache.get(url) : undefined;
  return Array.isArray(v) ? v : v === null ? null : undefined;
}

/* ══════════════════════════ 滚动条(带高亮小地图) */

function Scrollbar({ x, viewW, contentW, headW, tracks, total, onScroll }: { x: number; viewW: number; contentW: number; headW: number; tracks: Track[]; total: number; onScroll: (x: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startScroll: number } | null>(null);
  const trackW = Math.max(1, viewW);
  const thumbW = Math.max(24, Math.min(trackW, contentW > 0 ? (viewW * trackW) / contentW : trackW));
  const scrollable = contentW > viewW + 1;
  const thumbX = scrollable ? (x / (contentW - viewW)) * (trackW - thumbW) : 0;
  const marks = useMemo(
    () => tracks.flatMap((t) => t.clips.filter((c) => c.highlight === "change" || (c.ranges ?? []).some((r) => (r.kind ?? "change") === "change")).map((c) => ({ a: c.start, b: c.end, k: `${t.id}:${c.id}` }))),
    [tracks],
  );
  const toScroll = (px: number) => ((px - thumbW / 2) / Math.max(1, trackW - thumbW)) * (contentW - viewW);
  return (
    <div className="xtl-scroll" style={{ height: SCROLLBAR_H }}>
      <div style={{ width: headW, flex: "none" }} />
      <div
        ref={track}
        className="xtl-scroll-track"
        data-xtl-scrollbar=""
        onPointerDown={(e) => {
          if (!scrollable || !track.current) return;
          const px = e.clientX - track.current.getBoundingClientRect().left;
          const outside = px < thumbX || px > thumbX + thumbW;
          if (outside) onScroll(toScroll(px));
          drag.current = { startX: e.clientX, startScroll: outside ? toScroll(px) : x };
          track.current.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) onScroll(d.startScroll + ((e.clientX - d.startX) / Math.max(1, trackW - thumbW)) * (contentW - viewW));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {total > 0 && marks.map((m) => <span key={m.k} className="xtl-scroll-mark" style={{ left: `${(m.a / total) * 100}%`, width: `max(2px, ${((m.b - m.a) / total) * 100}%)` }} />)}
        {scrollable && <div className="xtl-scroll-thumb" style={{ left: thumbX, width: thumbW }} />}
      </div>
    </div>
  );
}
