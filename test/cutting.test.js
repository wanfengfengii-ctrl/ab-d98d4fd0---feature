import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewCanvasCutting, reviewCutting, kerfHitsRect } from '../src/core/cutting.js';
import { validateKerf } from '../src/core/validation.js';
import { planLayout } from '../src/core/planner.js';
import { defaultDraft } from '../src/server/defaultDraft.js';

const canvas = (over = {}) => ({ id: 'C1', name: '甲', width: 100, height: 100, grain: 'warp', margin: 0, ...over });
const placed = (rects) => rects.map(([i, x, y, width, height], idx) => ({
  patchIndex: i ?? idx,
  patchName: `P${(i ?? idx) + 1}`,
  candidateIndex: 0,
  rect: { x, y, width, height },
}));

test('锯缝带相交判定：正面积相交才算，边贴边允许', () => {
  const band = { x: 18, y: 0, width: 2, height: 100 };
  assert.equal(kerfHitsRect(band, { x: 20, y: 10, width: 10, height: 10 }), false); // 带右缘贴裁片左缘
  assert.equal(kerfHitsRect(band, { x: 19, y: 10, width: 10, height: 10 }), true);  // 侵入 1 单位
  assert.equal(kerfHitsRect(band, { x: 0, y: 10, width: 18, height: 10 }), false);  // 带左缘贴裁片右缘
});

test('裁片恰为可裁区：0 刀直接取下', () => {
  const r = reviewCanvasCutting(canvas({ margin: 10 }), placed([[0, 10, 10, 80, 80]]), 2);
  assert.equal(r.feasible, true);
  assert.equal(r.cutCount, 0);
  assert.deepEqual(r.steps.map((s) => s.kind), ['take']);
});

test('单片隔离：4 刀，首刀按竖先横后、坐标升序字典序', () => {
  const r = reviewCanvasCutting(canvas(), placed([[0, 20, 20, 20, 20]]), 2);
  assert.equal(r.feasible, true);
  assert.equal(r.cutCount, 4);
  assert.deepEqual(r.cuts.map((c) => [c.dir, c.at]), [
    ['vertical', 18], ['vertical', 40],
    ['horizontal', 18], ['horizontal', 40],
  ]);
});

test('两片之间无落刀缝隙（边贴边而锯缝宽 2）→ 判定阻断，给出首个被伤裁片', () => {
  // 两 20×20 裁片横向边贴边：缝隙 0，锯缝带放不下；
  // 竖切必伤其一，横切贯穿也会同时伤及两片 → 无法切下。
  const r = reviewCanvasCutting(canvas(), placed([[0, 20, 20, 20, 20], [1, 40, 20, 20, 20]]), 2);
  assert.equal(r.feasible, false);
  assert.equal(r.blocked.patchIndex, 0);
  assert.match(r.blocked.reason, /锯缝/);
});

test('边贴边但锯缝宽 0 不允许（宽度必须为正整数，由校验拦截）', () => {
  assert.equal(validateKerf(0).ok, false);
  assert.equal(validateKerf(-1).ok, false);
  assert.equal(validateKerf(1.5).ok, false);
  assert.equal(validateKerf('3').ok, false);
  assert.deepEqual(validateKerf(3), { ok: true, errors: [] });
});

test('总刀数最少优先于字典序：不会为了坐标小而多切', () => {
  // 上下两块占满宽向的裁片，可裁区恰好只含两片与中间锯缝：
  // (0,0,100,40) 与 (0,42,100,40)，kerf 2，可裁区 100×82 → 仅 1 刀 H40，
  // 分离后两片各自等于子矩形，直接取下。
  const r = reviewCanvasCutting(canvas({ height: 82 }), placed([[0, 0, 0, 100, 40], [1, 0, 42, 100, 40]]), 2);
  assert.equal(r.feasible, true);
  assert.equal(r.cutCount, 1);
  assert.deepEqual(r.cuts.map((c) => [c.dir, c.at]), [['horizontal', 40]]);
  assert.deepEqual(r.steps.map((s) => s.kind), ['cut', 'take', 'take']);
});

test('锯缝宽度决定可切性：缝隙 5、锯缝 10 阻断，锯缝 1 可切', () => {
  const cv = canvas();
  const ps = placed([[0, 0, 0, 30, 100], [1, 35, 0, 65, 100]]);
  assert.equal(reviewCanvasCutting(cv, ps, 10).feasible, false);
  const thin = reviewCanvasCutting(cv, ps, 1);
  assert.equal(thin.feasible, true);
  // 缝隙 [30,35) 容两条宽 1 锯缝：V30、V34，各片随后取下。
  assert.deepEqual(thin.cuts.map((c) => [c.dir, c.at]), [['vertical', 30], ['vertical', 34]]);
});

test('废料区域停止处理：外侧大余量只切必要的刀', () => {
  // 单片在角落 (0,0)：右、下为废料，只需 2 刀，切完裁片所在子矩形即取片。
  const r = reviewCanvasCutting(canvas(), placed([[0, 0, 0, 20, 20]]), 1);
  assert.equal(r.feasible, true);
  assert.equal(r.cutCount, 2);
  assert.deepEqual(r.cuts.map((c) => [c.dir, c.at]), [['vertical', 20], ['horizontal', 20]]);
});

test('两片贴满整布且锯缝无处安放：第一刀即阻断，无前置步骤', () => {
  // 两片各占半布、边贴边且无外边余量：竖切放不下锯缝，横切必同时伤两片。
  const ps = placed([[0, 0, 0, 50, 100], [1, 50, 0, 50, 100]]);
  const r = reviewCanvasCutting(canvas(), ps, 2);
  assert.equal(r.feasible, false);
  assert.equal(r.blocked.patchIndex, 0);
  assert.deepEqual(r.blocked.region, { x: 0, y: 0, width: 100, height: 100 });
  assert.equal(r.steps.length, 0);
});

test('步骤明细记录每刀前后的剩余区域与取下的补片', () => {
  const r = reviewCanvasCutting(canvas(), placed([[0, 0, 0, 100, 40], [1, 0, 42, 100, 40]]), 2);
  const cut = r.steps.find((s) => s.kind === 'cut');
  assert.ok(cut.before.length >= 1 && cut.after.length === 2);
  assert.equal(cut.produced.length, 2);
  const takes = r.steps.filter((s) => s.kind === 'take');
  assert.deepEqual(takes.map((t) => t.patchIndex).sort(), [0, 1]);
});

test('整稿复核：按帆布顺序展开；默认草稿 kerf=2 可切，kerf 增大可出现阻断', () => {
  const plan = planLayout(defaultDraft);
  assert.equal(plan.feasible, true);
  const ok = reviewCutting(defaultDraft, plan, 2);
  assert.equal(ok.feasible, true);
  assert.equal(ok.totalCuts, ok.reviews.reduce((s, r) => s + r.cutCount, 0));
  assert.ok(ok.cutSequence.length === ok.totalCuts);
  // cutSequence 按帆布录入顺序排列。
  let last = -1;
  for (const c of ok.cutSequence) {
    assert.ok(c.canvasIndex >= last);
    last = c.canvasIndex;
  }

  const blocked = reviewCutting(defaultDraft, plan, 3);
  assert.equal(blocked.feasible, false);
  assert.ok(blocked.blockedCanvasIndex !== null);
  const rv = blocked.reviews[blocked.blockedCanvasIndex];
  assert.equal(rv.feasible, false);
  assert.ok(Number.isInteger(rv.blocked.patchIndex));
  assert.match(rv.blocked.reason, /正面积相交/);
  // 阻断证据：被阻裁片位于所报剩余矩形内，且该矩形不是裁片本身（无落刀缝隙）。
  const b = rv.blocked;
  assert.ok(b.rect.x >= b.region.x && b.rect.y >= b.region.y);
  assert.ok(b.rect.x + b.rect.width <= b.region.x + b.region.width);
  assert.ok(b.rect.y + b.rect.height <= b.region.y + b.region.height);
  assert.ok(b.region.width >= b.rect.width && b.region.height >= b.rect.height);
  assert.ok(b.region.width > b.rect.width || b.region.height > b.rect.height);
  // 证据步骤链的最后一刀之后包含被阻剩余矩形。
  const lastCut = [...rv.steps].reverse().find((s) => s.kind === 'cut');
  assert.ok(lastCut && lastCut.after.some((r) =>
    r.x === b.region.x && r.y === b.region.y && r.width === b.region.width && r.height === b.region.height));
});

test('复核不接收页面上传的采用结果：相同草稿不同请求结论一致（纯函数）', () => {
  const plan = planLayout(defaultDraft);
  const a = reviewCutting(defaultDraft, plan, 2);
  const b = reviewCutting(defaultDraft, planLayout(structuredClone(defaultDraft)), 2);
  assert.deepEqual(a.cutSequence, b.cutSequence);
});
