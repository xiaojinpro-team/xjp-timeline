# Changelog

## v0.3.0 — 2026-10-20

- 修:拖播放头拖出控件后「不按也跟着走」(owner 10-20)。拖动仍用 pointer capture,收尾补全:pointerup / pointercancel 之外,
  丢 capture(lostpointercapture)、窗口级 pointerup、窗口失焦、Esc、拖动中收到「没按键」的鼠标 move 都当场收尾;
  视口上禁原生拖放(dragstart)。从播放头线、时码牌、刻度起拖行为一致,拖出控件(含窗外)照样跟,时间夹在 [0, 片长]。
- 新:划过预览(FCPX skimming)。`skim` 开着时鼠标划过刻度 / 轨道 = 一根黄色细线 + 描边时码 + `onSkim(t)`(按动画帧节流),
  播放头不动;左上读数改显示划过的时间(黄色「划过」标);离开 / 按下 / 播放中(`playing`)/ 关掉 = `onSkim(null, why)`,
  why = "leave" | "press" | "playing" | "off"。给了 `onSkimToggle(on, via)` 才在工具条出「划过预览」开关,并认 S 键(`skimKey` 可换)。
- 轨道头 112 → 128 px:四个字的轨名(「文字背景」)不再截成「文字…」;轨名带 title。
- 新导出 `EN_LABELS`、`SkimEnd`;`TimelineLabels` 加 `skim` / `skimTitle` / `skimming`。

## v0.2.0 — 2026-10-15

- 新标记 `note`:点状备注(小旗 + 一句话,宽到 `until` 为止,可点 → onMarkerClick);颜色 `--xtl-note`。
- 片段小牌 `badges[].attrs`(透传 data-*);text 小牌窄片段也渲染(被片段裁掉,不再整个消失)。
- 新回调 `onClipDoubleClick(clip, track)`(如「双击循环这一镜」)。
- 没量到宽度时(服务端渲染 / 首帧)全画所有片段,静态首屏不再只剩第一段。

## v0.1.0 — 2026-10-15

- 首版:从 cuthub 看片页多轨时间线(ce3a27d / 3795c03)抽出。轨道 video / audio / subtitle / music / fx / overlay;
  刻度随缩放变密(帧级 `m:ss:ffF`);标记行 chapter / change / missing / version / cut-hard / cut-soft / cut-manual / candidate;
  缩略图条与精灵图(行优先)、波形(数组或 URL);改动区间 + 已看覆盖线 + 褪色;选中描边;滑杆 / ± / 适应 / ⌘滚轮 / 捏合 / 双指缩放;
  只渲染可视区;深浅两套变量。
