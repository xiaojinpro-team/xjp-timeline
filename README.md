# @xjp/timeline

xjp 各站共用的**多轨时间线**:轨道像 Premiere(V/A/T 多轨、轨道头能隐藏 / 静音),样子像 FCPX(深灰底、圆角片段、缩略图条、波形、红播放头)。
React 组件,运行时只依赖 `react`(peer ≥ 18);样式是一份 CSS,颜色全走 `--xtl-*` 变量,跟宿主主题走。

> owner 2026-10-15:「以后我只迭代这一个,所有的都跟着变。」—— 改时间轴只改这里,宿主升级 tag 即可。
> 消费方:cuthub 看片页、cuthub 复刻工作台、launchreel 工作台。

## 安装

不发 npm。每个版本是一个 git tag,`dist/` 已构建好提交在仓库里:

```jsonc
// package.json
"dependencies": {
  "@xjp/timeline": "github:xiaojinpro-team/xjp-timeline#v0.1.0"
}
```

```ts
import { Timeline, type Track, type Marker } from "@xjp/timeline";
import "@xjp/timeline/styles.css";
```

Next.js 里组件已带 `"use client"`;直接在客户端组件里用。

## 数据模型

时间一律是**秒**。宿主把自己的业务翻译成下面这套,时间轴不认识任何宿主概念。

```ts
<Timeline
  fps={25}
  duration={288.2}
  tracks={Track[]}            // 从上到下的顺序
  markers={Marker[]}
  playhead={183.04}
  selection="clip-id" | ["v-S08F", "a-S08F"] | null
  zoom={pps?} fit={bool?}     // 不给 = 组件自己管(初始「适应」)
  follow={playing}            // 播放中播放头出视口就翻页
  onSeek={(t) => …}           // 点 / 拖刻度或轨道(连续触发)
  onSelect={(clip, track) => …}
  onToggleTrack={(trackId) => …}   // 宿主翻转 track.hidden / track.muted
  onZoom={(pps, fit) => …}
  onMarkerClick={(marker) => …}    // missing / candidate / version 可点
  onClipAction={(action, { t, clip, track }) => …}
  keymap={{ c: "split", m: "merge-prev", "[": "set-in", "]": "set-out" }}
  renderTooltip={(clip, track) => <…/>}
  onVisibleRangeChange={(t0, t1) => …}   // 按需加载缩略图 / 峰值
  toolbarStart={<统计/>} toolbarEnd={<按钮/>} corner={<读数/>}
  theme="dark" | "light"
  labels={{ … }}                         // 默认中文,见 ZH_LABELS
/>
```

```ts
interface Track {
  id: string;                    // 轨道头显示它:V1 / A1 / T1 / M1 …
  kind: "video" | "audio" | "subtitle" | "music" | "fx" | "overlay";
  name: string;                  // 视频 / 旁白 / 字幕 …
  hidden?: boolean; muted?: boolean;
  toggle?: "hide" | "mute" | "none";   // 默认:音频类 mute,其余 hide
  toggleHint?: string; height?: number;
  clips: Clip[];
}

interface Clip {
  id: string; start: number; end: number;
  label?: string; sublabel?: string;    // 左上名字 / 右下小字(如时长)
  thumbStrip?: { url; cols; frameStep; rows?; count?; cellWidth?; cellHeight?; offset? };
  peaks?: { array?: number[]; url?: string; step: number };   // 0..1,每 step 秒一个
  color?: string;
  highlight?: "change" | "fading" | "selected-for" | "warn" | null;   // 整段
  ranges?: { start; end; kind?: "change" | "fading"; covered?: [a, b][] }[];  // 片段内区间(相对片段起点)
  badges?: { kind: "version" | "dots" | "new" | "error" | "text" | "star"; label?; count? }[];
  disabled?: boolean; title?: string;
  attrs?: Record<`data-${string}`, …>;   // 透传到片段元素(宿主冒烟定位用)
}

interface Marker {
  t: number; until?: number;
  kind: "chapter" | "change" | "version" | "cut-hard" | "cut-soft" | "cut-manual" | "candidate" | "missing";
  label?: string; title?: string; selected?: boolean; id?: string; attrs?: …;
}
```

**缩略图**:一张精灵图,格子行优先;第 i 格 = 片段内 `[offset + i·frameStep, …)`。单行条(cuthub `ops/film/assets.mjs` 的 `<hash>.strip.jpg`)填 `cols = count`;
整片一张精灵图(复刻工作台的 `sprite.jpg`)每个片段填同一个 url,`offset = 片段在源里的起点`。图加载失败 = 纯色片段,不报错。

**怎么表达常见东西**

| 想要 | 写法 |
|---|---|
| 某镜有新版(整段亮) | `clip.highlight = "change"` |
| 只亮改动区间 + 已看部分 | `clip.ranges = [{ start, end, covered }]` |
| 看完褪掉(0.9 s) | 下一帧把它换成 `kind: "fading"` / `highlight: "fading"`,动画后去掉 |
| 版本号与历史点 | `badges: [{kind:"version",label:"v7"},{kind:"dots",count:5},{kind:"new"}]` |
| Part 章节 | `markers: {kind:"chapter", t, until, label}`(滚出去时标题贴左边) |
| 改动说明 | `markers: {kind:"change", t, until, label}` |
| 没视频的镜 | `markers: {kind:"missing", t, label}`(同一时刻多个并排,可点) |
| 硬切 / 软切 / 手切 / 软切候选 | `markers: {kind:"cut-hard"|"cut-soft"|"cut-manual"|"candidate", t}`(候选可点) |
| 选为复刻的镜头 | `highlight: "selected-for"` 或 `badges:[{kind:"star",label:"复刻"}]` |

**交互**:鼠标点 / 拖 = 跳(片段上同时 onSelect);触屏轻点 = 跳、单指拖 = 滚、双指 = 缩放;⌘/Ctrl + 滚轮、触控板捏合(含 Safari gesture)= 以指针为不动点缩放;
触控板左右划 / ⇧ + 滚轮 / 拖底部滚动条 = 横向滚(滚动条上有改动高亮小地图)。只渲染可视区附近的片段;滚动与缩放都只改 transform。

**主题**:`theme="light"` 换浅色变量;宿主可在 `.xtl` 上覆盖任何 `--xtl-*`(例:`.xtl { --xtl-accent: hsl(var(--brand-accent)); }`)。

## 开发与发布

```bash
npm install            # 只为 typescript / @types/react / react(devDependencies)
npm test               # tsc 构建 dist + node --test test/*.test.mjs
```

发布一个版本(**dist 必须提交**,消费方不构建):

1. 改 `src/`,`npm test` 过;在一个宿主里用 `"file:../xjp-timeline"` 联调并截图。
2. 改 `package.json` 的 `version` 与 `CHANGELOG.md`。
3. `npm run build`,把 `dist/` 一起提交:`git commit -am "release: vX.Y.Z"`。
4. `git tag vX.Y.Z`,双推:`git push origin main --tags`(codebase,SSOT)+ `git push github main --tags`(GitHub 公开镜像,消费方从这里装)。
5. 各宿主把依赖改成 `#vX.Y.Z`,`npm install` / `pnpm install`,验证后各自发版。

`npm run release:check` = 重新构建后 `dist/` 和提交的一致(忘了 build 就会红)。

## 登记

MissionD:`.missiond/v3/shards/universe/service-layer-template.lisp` 的 `timeline-standard`;入口 `integrate-xjp-timeline`(agent-navigation)。
agent-memory:`sop/xjp-timeline`。
