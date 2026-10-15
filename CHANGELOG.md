# Changelog

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
