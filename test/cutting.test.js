import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewCutting,
  planCanvasCuts,
  candidateCuts,
  pieceSide,
  bandRect,
  splitRegion,
} from '../src/core/cutting.js';
import { planLayout } from '../src/core/planner.js';
import { defaultDraft } from '../src/server/defaultDraft.js';

const P = (patchIndex, x, y, width, height) => ({ patchIndex, rect: { x, y, width, height } });
const canvas = (over = {}) => ({ width: 60, height: 20, margin: 0, ...over });

test('裁片分侧：边贴锯缝带（零面积接触）不算相交', () => {
  const r = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(pieceSide(r, { dir: 'v', coord: 10 }, 5), 'A'); // 右缘贴带左缘
  assert.equal(pieceSide({ x: 15, y: 0, width: 10, height: 10 }, { dir: 'v', coord: 10 }, 5), 'B'); // 左缘贴带右缘
  assert.equal(pieceSide({ x: 12, y: 0, width: 10, height: 10 }, { dir: 'v', coord: 10 }, 5), 'hit'); // 跨带
  assert.equal(pieceSide(r, { dir: 'h', coord: 10 }, 5), 'A');
  assert.equal(pieceSide({ x: 0, y: 14, width: 10, height: 10 }, { dir: 'h', coord: 10 }, 5), 'hit');
});

test('锯缝带与切后区域：竖切横切的几何正确', () => {
  const region = { x: 0, y: 0, width: 60, height: 20 };
  assert.deepEqual(bandRect(region, { dir: 'v', coord: 10 }, 5), { x: 10, y: 0, width: 5, height: 20 });
  assert.deepEqual(bandRect(region, { dir: 'h', coord: 8 }, 4), { x: 0, y: 8, width: 60, height: 4 });
  assert.deepEqual(splitRegion(region, { dir: 'v', coord: 10 }, 5), [
    { x: 0, y: 0, width: 10, height: 20 },
    { x: 15, y: 0, width: 45, height: 20 },
  ]);
  assert.deepEqual(splitRegion(region, { dir: 'h', coord: 8 }, 4), [
    { x: 0, y: 0, width: 60, height: 8 },
    { x: 0, y: 12, width: 60, height: 8 },
  ]);
});

test('候选切线：只保留两侧均有裁片且锯缝带不相交的贴边位置', () => {
  const two = [P(0, 0, 0, 10, 10), P(1, 20, 0, 10, 10)];
  assert.deepEqual(candidateCuts(two, 5), [{ dir: 'v', coord: 10 }]);
  // 间隙 4 < 锯缝 5：横竖两个方向都放不下锯缝带 → 无候选
  assert.deepEqual(candidateCuts(two, 11), []);
});

test('单裁片帆布：0 刀，初始即取下', () => {
  const one = planCanvasCuts(canvas(), [P(0, 5, 5, 10, 10)], 5);
  assert.equal(one.feasible, true);
  assert.equal(one.totalCuts, 0);
  assert.deepEqual(one.sequence, []);
  assert.deepEqual(one.takenOff, [{ patchIndex: 0, atStep: 0 }]);
});

test('三块裁片一排：总刀数最少且切线坐标序列最小（先切 x=10 而非 x=30）', () => {
  const row = planCanvasCuts(canvas(), [P(0, 0, 0, 10, 10), P(1, 20, 0, 10, 10), P(2, 40, 0, 10, 10)], 5);
  assert.equal(row.feasible, true);
  assert.equal(row.totalCuts, 2);
  assert.deepEqual(row.sequence, [{ dir: 'v', coord: 10 }, { dir: 'v', coord: 30 }]);
  // 取下顺序：第 1 刀后 P1 取下；第 2 刀后 P2、P3 取下
  assert.deepEqual(row.takenOff, [
    { patchIndex: 0, atStep: 1 },
    { patchIndex: 1, atStep: 2 },
    { patchIndex: 2, atStep: 2 },
  ]);
  // 步骤快照：第 2 刀前 P1 已取下，剩余区域为 (15,0)–(60,20)
  assert.deepEqual(row.steps[1].takenOffBefore, [0]);
  assert.deepEqual(row.steps[1].regionBefore, { x: 15, y: 0, width: 45, height: 20 });
});

test('坐标相同平局时横切先于竖切', () => {
  const diag = planCanvasCuts(canvas({ width: 40, height: 40 }),
    [P(0, 0, 0, 10, 10), P(1, 20, 20, 10, 10)], 5);
  assert.equal(diag.feasible, true);
  assert.equal(diag.totalCuts, 1);
  assert.deepEqual(diag.sequence, [{ dir: 'h', coord: 10 }]);
});

test('2×2 网格：先横后竖共 3 刀，序列按执行顺序展开', () => {
  const grid = planCanvasCuts(canvas({ width: 40, height: 40 }), [
    P(0, 0, 0, 10, 10), P(1, 20, 0, 10, 10),
    P(2, 0, 20, 10, 10), P(3, 20, 20, 10, 10),
  ], 5);
  assert.equal(grid.feasible, true);
  assert.equal(grid.totalCuts, 3);
  assert.deepEqual(grid.sequence, [
    { dir: 'h', coord: 10 },
    { dir: 'v', coord: 10 },
    { dir: 'v', coord: 10 },
  ]);
  // 第 1 刀（横切）后两片区域都仍需继续切；第 2 刀后 P1、P2 取下
  assert.deepEqual(grid.steps[0].takenOff, []);
  assert.deepEqual(grid.steps[1].takenOff, [0, 1]);
  assert.deepEqual(grid.takenOff.map((t) => t.patchIndex), [0, 1, 2, 3]);
});

test('锯缝阻断：两块裁片横竖间隙都放不下锯缝带 → 卡死并给出精确证据', () => {
  const stuck = planCanvasCuts(canvas({ width: 40, height: 40 }),
    [P(0, 0, 0, 10, 10), P(1, 12, 12, 10, 10)], 5);
  assert.equal(stuck.feasible, false);
  assert.equal(stuck.blockage.stepsBefore, 0);
  assert.deepEqual(stuck.blockage.trapped, [0, 1]);
  // 每条候选切线要么被锯缝正面积相交阻断，要么一侧无裁片不能切分
  assert.ok(stuck.blockage.attempts.length > 0);
  assert.ok(stuck.blockage.attempts.every((a) =>
    a.blockedBy.length > 0 || a.sideA === 0 || a.sideB === 0));
  assert.ok(stuck.blockage.attempts.every((a) => !a.separates));
  // 竖切 x=10 的锯缝带 [10,15] 与 P2 (12,12,10×10) 相交 3×10 = 30
  const v10 = stuck.blockage.attempts.find((a) => a.dir === 'v' && a.coord === 10);
  assert.deepEqual(v10.blockedBy, [{ patchIndex: 1, overlapArea: 30 }]);
});

test('嵌套阻断：外圈可切一刀，内圈两块卡死，证据含到达路径', () => {
  const nested = planCanvasCuts(canvas({ width: 40, height: 40 }), [
    P(0, 0, 0, 10, 40), P(1, 20, 0, 10, 10), P(2, 23, 12, 10, 10),
  ], 5);
  assert.equal(nested.feasible, false);
  // 第 1 刀竖切 x=10 把 P1 单独切下，随后 P2、P3 在剩余区域卡死
  assert.equal(nested.steps.length, 1);
  assert.equal(nested.steps[0].dir, 'v');
  assert.equal(nested.steps[0].coord, 10);
  assert.deepEqual(nested.takenOff, [{ patchIndex: 0, atStep: 1 }]);
  assert.equal(nested.blockage.stepsBefore, 1);
  assert.deepEqual(nested.blockage.trapped, [1, 2]);
  assert.deepEqual(nested.blockage.region, { x: 15, y: 0, width: 25, height: 40 });
});

test('复核主流程：按当前草稿重新执行联合排版，锯缝贴边（38）可切、超 1（39）阻断', () => {
  const ok = reviewCutting(defaultDraft, 38);
  assert.equal(ok.stage, 'cut');
  // 复核用的是重新执行的联合排版，而非外部传入的采用结果
  assert.deepEqual(ok.layout.tuple, planLayout(defaultDraft).objective.tuple);
  assert.equal(ok.feasible, true);
  assert.equal(ok.totalCuts, 1);
  assert.deepEqual(ok.canvases[0].sequence, [{ dir: 'v', coord: 42 }]);
  assert.equal(ok.canvases[1].totalCuts, 0);

  const blocked = reviewCutting(defaultDraft, 39);
  assert.equal(blocked.feasible, false);
  assert.equal(blocked.blockage.canvasId, 'C1');
  assert.equal(blocked.blockage.firstPieceIndex, 1); // 补片 2（方肘补）
  assert.deepEqual(blocked.blockage.trapped, [1, 2]);
  const attempt = blocked.canvases[0].blockage.attempts.find((a) => a.dir === 'v' && a.coord === 42);
  assert.deepEqual(attempt.blockedBy, [{ patchIndex: 2, overlapArea: 20 }]);
});

test('联合排版无解时复核在排版阶段报告，不产生裁切结论', () => {
  const noFit = structuredClone(defaultDraft);
  noFit.patches[1].candidates = noFit.patches[1].candidates.map((c) => ({ ...c, x: 1000, y: 1000 }));
  const r = reviewCutting(noFit, 5);
  assert.equal(r.stage, 'layout');
  assert.equal(r.feasible, false);
  assert.equal(r.layout.firstPatchIndex, 1);
});

test('锯缝宽度须为正整数', () => {
  assert.throws(() => reviewCutting(defaultDraft, 0), /正整数/);
  assert.throws(() => reviewCutting(defaultDraft, -3), /正整数/);
  assert.throws(() => reviewCutting(defaultDraft, 1.5), /正整数/);
  assert.throws(() => reviewCutting(defaultDraft, '8'), /正整数/);
});
