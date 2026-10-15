import { test } from "node:test";
import assert from "node:assert/strict";
import { rulerTicks, rulerLabel, timecode, stripGeom, stripTiles, waveformPath, peaksFromJson, clampPps, clampScroll, zoomAround, ppsToSlider, sliderToPps, clipAt, trackToggle, trackOff, fitPps } from "../dist/model.js";

test("刻度:整片时整秒标签,放大到帧级带 f", () => {
  const coarse = rulerTicks(0, 288, 3.7, 25).filter((t) => t.major);
  assert.ok(coarse.every((t) => /^\d+:\d\d$/.test(t.label)));
  assert.ok(coarse[1].t * 3.7 >= 72, "主刻度间距 ≥ 72 px");
  const fine = rulerTicks(10, 12, 400, 25).filter((t) => t.major);
  assert.ok(fine.some((t) => /^\d+:\d\d:\d\df$/.test(t.label)));
  assert.equal(rulerLabel(6.4, true, 25), "0:06:10f");
});

test("时码", () => {
  assert.equal(timecode(183.04, 25), "03:03:01f");
  assert.equal(timecode(0, 30), "00:00:00f");
});

test("缩略图:单行条按中点取格;精灵图按行优先", () => {
  const g = stripGeom({ url: "x", cols: 5, frameStep: 2, cellWidth: 96, cellHeight: 54 }, 54);
  const tiles = stripTiles(g, 48, 400, 96);
  assert.deepEqual(tiles.map((t) => t.col), [0, 1, 2, 3, 4], "第 k 格中点 = 2k+1 s → 第 k 格图");
  const s = stripGeom({ url: "x", cols: 10, rows: 3, count: 25, frameStep: 0.25, cellWidth: 160, cellHeight: 90, offset: 3 }, 54);
  const t = stripTiles(s, 100, 100, 96);
  assert.deepEqual([t[0].col, t[0].row], [3, 1], "源内 3.48 s → 第 13 格 → 第 2 行第 4 列");
});

test("波形路径与峰值 JSON 三种形状", () => {
  assert.match(waveformPath([0, 1, 0.5]), /^M0,50L/);
  assert.equal(waveformPath([]), "");
  assert.deepEqual(peaksFromJson([0.1, 0.2]), [0.1, 0.2]);
  assert.deepEqual(peaksFromJson({ peaks: [0.3] }), [0.3]);
  assert.deepEqual(peaksFromJson({ audio: { peaks: [0.4] } }), [0.4]);
  assert.equal(peaksFromJson({ x: 1 }), null);
});

test("缩放与滚动", () => {
  assert.equal(fitPps(1000, 100), 10);
  assert.equal(clampPps(1, 10), 10);
  assert.equal(clampPps(1e6, 10, 400), 400);
  assert.equal(clampScroll(-5, 10, 100, 500), 0);
  assert.equal(clampScroll(1e9, 10, 100, 500), 500);
  const x = zoomAround(100, 10, 20, 50);
  assert.equal((x + 50) / 20, (100 + 50) / 10, "锚点那一刻不动");
  assert.ok(Math.abs(sliderToPps(ppsToSlider(55, 5), 5) - 55) < 1e-9);
});

test("轨道开关默认与播放头所在片段", () => {
  assert.equal(trackToggle({ id: "A1", kind: "audio", name: "", clips: [] }), "mute");
  assert.equal(trackToggle({ id: "V1", kind: "video", name: "", clips: [] }), "hide");
  assert.equal(trackOff({ id: "A1", kind: "audio", name: "", muted: true, clips: [] }), true);
  const tr = { id: "V1", kind: "video", name: "", clips: [{ id: "a", start: 0, end: 2 }, { id: "b", start: 2, end: 5 }] };
  assert.equal(clipAt(tr, 2).id, "b");
  assert.equal(clipAt(tr, 5).id, "b");
});
