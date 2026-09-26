/**
 * 直线裁切顺序复核（贯穿切 + 正整数锯缝）。
 *
 * 复核对象：对当前草稿重新执行既有联合排版（planLayout）得到的采用裁片——
 * 不接收页面上传的采用结果。
 *
 * 裁切模型：
 *  - 每张帆布的可裁区域（扣四边禁裁带）是初始剩余矩形；
 *  - 每刀在一块尚未分割的剩余矩形内作横（h）或竖（v）的贯穿直线；
 *    锯缝占据同宽 k 的带状区域，把该矩形分成两侧独立的剩余矩形，带本身成为废料；
 *  - 锯缝带不得与任何采用裁片正面积相交（边贴边的零面积接触允许）。
 *    由于锯缝带贯穿整个剩余矩形而裁片又完整落在矩形内，
 *    「带与裁片正面积相交」等价于「裁片跨带」，即每块裁片必须完整落在带的某一侧；
 *  - 剩余矩形只剩 1 块裁片时该裁片即可取下（余皆废料，修边不再计入贯穿裁切），
 *    不含裁片的废料区域停止处理；
 *  - 执行顺序：一刀切下的两个剩余矩形，先处理靠左/上侧，再处理靠右/下侧（前序展开）。
 *
 * 选优（在全部能保全裁片的切法中依次比较）：
 *  ① 总刀数最少（各帆布相互独立，刀数相加）；
 *  ② 按帆布录入顺序展开的切线（坐标, 方向）序列最小：
 *     坐标数值小者优先；坐标相同则横切（h）先于竖切（v）（题面「横或竖」的枚举顺序）。
 *     切线坐标 = 锯缝带靠左/上边缘的位置。
 *
 * 正确性论证（化简的依据）：
 *  - 分离切（两侧都有裁片）的锯缝带必然完整落在当前剩余矩形内：
 *    带起点不低于左侧某裁片的右/下边缘、带终点不高于右侧某裁片的左/上边缘，
 *    而裁片都在剩余矩形内。因此一个状态能否分离、最少几刀只取决于裁片集合，
 *    与剩余矩形的具体边界无关（剩余矩形仅用于展示与逐步回放）；
 *  - 同一划分的所有切线中，坐标最小者是把锯缝带贴到「靠左/上侧裁片最右/下边缘」
 *    的位置（c = 某裁片的右/下边缘）。故只枚举这些贴边位置即可覆盖全部划分，
 *    且每个划分都以其最小坐标代表参与选优；
 *  - 同一状态的不同候选切线其（坐标, 方向）键必然不同，而序列比较的第一个元素
 *    就是本刀切线键，因此「刀数相同取键最小者」的逐状态局部选择，
 *    与整段切线序列字典序最小完全等价（最优子结构：刀数可加、序列按键前序拼接）。
 */

import { planLayout, cuttableArea } from './planner.js';
import { intersectionArea } from './validation.js';

/** 方向序号：横切先于竖切（题面「横或竖」的枚举顺序），用于切线键比较。 */
export const DIR_RANK = Object.freeze({ h: 0, v: 1 });
export const DIR_TEXT = Object.freeze({ h: '横切', v: '竖切' });

/** 切线比较键：先坐标、后方向。 */
function compareCuts(a, b) {
  if (a.coord !== b.coord) return a.coord - b.coord;
  return DIR_RANK[a.dir] - DIR_RANK[b.dir];
}

/** 锯缝带矩形：在剩余矩形内贯穿，宽为 kerf。 */
export function bandRect(region, cut, kerf) {
  return cut.dir === 'v'
    ? { x: cut.coord, y: region.y, width: kerf, height: region.height }
    : { x: region.x, y: cut.coord, width: region.width, height: kerf };
}

/** 切后两侧独立剩余矩形：[靠左/上侧, 靠右/下侧]。 */
export function splitRegion(region, cut, kerf) {
  if (cut.dir === 'v') {
    return [
      { x: region.x, y: region.y, width: cut.coord - region.x, height: region.height },
      { x: cut.coord + kerf, y: region.y, width: region.x + region.width - cut.coord - kerf, height: region.height },
    ];
  }
  return [
    { x: region.x, y: region.y, width: region.width, height: cut.coord - region.y },
    { x: region.x, y: cut.coord + kerf, width: region.width, height: region.y + region.height - cut.coord - kerf },
  ];
}

/**
 * 裁片相对切线的位置：'A' 靠左/上侧，'B' 靠右/下侧，'hit' 与锯缝带正面积相交。
 * 带贯穿整个剩余矩形，跨带 ⇔ 正面积相交（横向重叠即裁片全高/全宽的正面积）。
 */
export function pieceSide(rect, cut, kerf) {
  if (cut.dir === 'v') {
    if (rect.x + rect.width <= cut.coord) return 'A';
    if (rect.x >= cut.coord + kerf) return 'B';
    return 'hit';
  }
  if (rect.y + rect.height <= cut.coord) return 'A';
  if (rect.y >= cut.coord + kerf) return 'B';
  return 'hit';
}

/**
 * 当前裁片集合的全部候选分离切。
 * 只枚举「锯缝带贴某裁片右/下边缘」的位置（覆盖全部划分且每划分取最小坐标），
 * 只返回两侧均有裁片、且锯缝带不与任何裁片正面积相交的切线。
 */
export function candidateCuts(pieces, kerf) {
  const cuts = [];
  const seen = new Set();
  for (const p of pieces) {
    const spots = [
      { dir: 'v', coord: p.rect.x + p.rect.width },
      { dir: 'h', coord: p.rect.y + p.rect.height },
    ];
    for (const cut of spots) {
      const key = `${cut.dir}@${cut.coord}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let sideA = 0;
      let sideB = 0;
      let hit = false;
      for (const q of pieces) {
        const side = pieceSide(q.rect, cut, kerf);
        if (side === 'hit') { hit = true; break; }
        if (side === 'A') sideA += 1; else sideB += 1;
      }
      if (!hit && sideA > 0 && sideB > 0) cuts.push(cut);
    }
  }
  return cuts;
}

/** 按切线把裁片分到两侧（调用前须保证无 'hit'）。 */
function splitPieces(pieces, cut, kerf) {
  const left = [];
  const right = [];
  for (const p of pieces) {
    (pieceSide(p.rect, cut, kerf) === 'A' ? left : right).push(p);
  }
  return { left, right };
}

/**
 * 分离一个裁片集合的最优切法（记忆化搜索）。
 * @returns {{cost:number, tree:object|null}|null} null 表示无法分离（锯缝阻断）。
 *   tree 节点 { cut, left, right }；叶子（≤1 块裁片）为 { cost: 0, tree: null }。
 */
function solveSet(pieces, kerf, memo) {
  if (pieces.length <= 1) return { cost: 0, tree: null };
  const key = pieces.map((p) => p.patchIndex).sort((a, b) => a - b).join(',');
  if (memo.has(key)) return memo.get(key);

  let best = null;
  for (const cut of candidateCuts(pieces, kerf)) {
    const { left, right } = splitPieces(pieces, cut, kerf);
    const L = solveSet(left, kerf, memo);
    if (L === null) continue;
    const R = solveSet(right, kerf, memo);
    if (R === null) continue;
    const cost = 1 + L.cost + R.cost;
    if (best === null || cost < best.cost ||
        (cost === best.cost && compareCuts(cut, best.cut) < 0)) {
      best = { cost, cut, tree: { cut, left: L.tree, right: R.tree } };
    }
  }
  const result = best === null ? null : { cost: best.cost, tree: best.tree };
  memo.set(key, result);
  return result;
}

/** 把最优切法树按执行顺序（先根、先左/上侧、后右/下侧）展开为带区域的刀序。 */
function flattenCuts(tree, region, kerf, out = []) {
  if (tree === null) return out;
  const { cut } = tree;
  const [regionA, regionB] = splitRegion(region, cut, kerf);
  out.push({
    dir: cut.dir, coord: cut.coord, region,
    band: bandRect(region, cut, kerf), regionA, regionB,
  });
  flattenCuts(tree.left, regionA, kerf, out);
  flattenCuts(tree.right, regionB, kerf, out);
  return out;
}

const rectEq = (a, b) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** 区域命运：无裁片→废料停止处理；单裁片→取下；多裁片→继续裁切。 */
function fateOf(pieceIndexes) {
  if (pieceIndexes.length === 0) return 'waste';
  if (pieceIndexes.length === 1) return 'taken';
  return 'live';
}

/**
 * 依刀序在帆布上逐步执行，生成每刀前后的剩余区域快照与取下记录。
 * cutList 中每一刀都必须落在当前某个剩余（live）矩形上。
 */
function replayCuts(canvas, pieces, cutList, kerf) {
  const steps = [];
  const takenOff = [];
  const byIndex = new Map(pieces.map((p) => [p.patchIndex, p]));
  let live = [];
  if (pieces.length >= 2) {
    live = [{ region: cuttableArea(canvas), pieces: pieces.map((p) => p.patchIndex) }];
  } else if (pieces.length === 1) {
    takenOff.push({ patchIndex: pieces[0].patchIndex, atStep: 0 });
  }

  cutList.forEach((c) => {
    const n = steps.length + 1;
    const targetIdx = live.findIndex((r) => rectEq(r.region, c.region));
    const target = live[targetIdx];
    const takenBefore = takenOff.map((t) => t.patchIndex);
    const liveBefore = live.map((r) => ({ region: r.region, pieces: r.pieces.slice() }));

    const piecesA = [];
    const piecesB = [];
    for (const pi of target.pieces) {
      (pieceSide(byIndex.get(pi).rect, c, kerf) === 'A' ? piecesA : piecesB).push(pi);
    }
    const after = [
      { region: c.regionA, pieces: piecesA, fate: fateOf(piecesA) },
      { region: c.regionB, pieces: piecesB, fate: fateOf(piecesB) },
    ];
    const stepTaken = [];
    for (const a of after) {
      if (a.fate === 'taken') stepTaken.push(a.pieces[0]);
    }
    steps.push({
      n,
      dir: c.dir,
      coord: c.coord,
      band: c.band,
      regionBefore: c.region,
      piecesBefore: target.pieces.slice(),
      liveBefore,
      takenOffBefore: takenBefore,
      after,
      takenOff: stepTaken,
    });

    live.splice(targetIdx, 1);
    for (const a of after) {
      if (a.fate === 'live') live.push({ region: a.region, pieces: a.pieces });
    }
    for (const pi of stepTaken) takenOff.push({ patchIndex: pi, atStep: n });
  });

  return { steps, takenOff, liveAfter: live };
}

/**
 * 卡死状态的完整证据：枚举全部贴边候选切线（覆盖全部分划），
 * 逐条给出锯缝带与裁片的正面积相交（精确面积），或标注「一侧无裁片不能切分」。
 */
function analyzeAttempts(pieces, region, kerf) {
  const spots = new Map();
  for (const p of pieces) {
    spots.set(`v@${p.rect.x + p.rect.width}`, { dir: 'v', coord: p.rect.x + p.rect.width });
    spots.set(`h@${p.rect.y + p.rect.height}`, { dir: 'h', coord: p.rect.y + p.rect.height });
  }
  return [...spots.values()].sort(compareCuts).map((cut) => {
    const band = bandRect(region, cut, kerf);
    const blockedBy = pieces
      .map((q) => ({ patchIndex: q.patchIndex, overlapArea: intersectionArea(band, q.rect) }))
      .filter((e) => e.overlapArea > 0)
      .sort((a, b) => a.patchIndex - b.patchIndex);
    let sideA = 0;
    let sideB = 0;
    for (const q of pieces) {
      const side = pieceSide(q.rect, cut, kerf);
      if (side === 'A') sideA += 1;
      else if (side === 'B') sideB += 1;
    }
    return {
      dir: cut.dir,
      coord: cut.coord,
      band,
      blockedBy,
      sideA,
      sideB,
      separates: blockedBy.length === 0 && sideA > 0 && sideB > 0,
    };
  });
}

/**
 * 定位首个被锯缝阻断的卡死状态。
 * 沿切线优选顺序（坐标、方向）下钻：每个不可分离的状态取其最小候选切线，
 * 先进入不可分离的一侧；若靠左/上侧可分离，则其全部刀序在执行顺序上先于另一侧。
 * 返回 { path, region, trapped, attempts }：path 为到达卡死区域前执行的刀序。
 */
function findBlockage(canvas, pieces, kerf, memo) {
  let region = cuttableArea(canvas);
  let current = pieces;
  const path = [];
  for (;;) {
    const cuts = candidateCuts(current, kerf).sort(compareCuts);
    if (cuts.length === 0) {
      return {
        path,
        region,
        trapped: current.map((p) => p.patchIndex),
        attempts: analyzeAttempts(current, region, kerf),
      };
    }
    const cut = cuts[0];
    const { left, right } = splitPieces(current, cut, kerf);
    const [regionA, regionB] = splitRegion(region, cut, kerf);
    path.push({
      dir: cut.dir, coord: cut.coord, region,
      band: bandRect(region, cut, kerf), regionA, regionB,
    });
    const L = solveSet(left, kerf, memo);
    if (L === null) {
      current = left;
      region = regionA;
      continue;
    }
    // 靠左/上侧可分离：它的全部刀序在执行顺序上先于另一侧。
    path.push(...flattenCuts(L.tree, regionA, kerf));
    current = right;
    region = regionB;
  }
}

/**
 * 单张帆布的裁切规划。pieces = [{ patchIndex, rect }]。
 * 可行：{ feasible:true, totalCuts, sequence, steps, takenOff }；
 * 不可行：{ feasible:false, steps（卡死前已执行的刀）, takenOff, blockage }。
 */
export function planCanvasCuts(canvas, pieces, kerf) {
  if (pieces.length <= 1) {
    const { steps, takenOff } = replayCuts(canvas, pieces, [], kerf);
    return { feasible: true, totalCuts: 0, sequence: [], steps, takenOff };
  }
  const memo = new Map();
  const best = solveSet(pieces, kerf, memo);
  if (best === null) {
    const found = findBlockage(canvas, pieces, kerf, memo);
    const { steps, takenOff, liveAfter } = replayCuts(canvas, pieces, found.path, kerf);
    return {
      feasible: false,
      steps,
      takenOff,
      blockage: {
        region: found.region,
        trapped: found.trapped,
        attempts: found.attempts,
        liveAtBlock: liveAfter,
        takenOffAtBlock: takenOff,
        stepsBefore: found.path.length,
      },
    };
  }
  const cutList = flattenCuts(best.tree, cuttableArea(canvas), kerf);
  const { steps, takenOff } = replayCuts(canvas, pieces, cutList, kerf);
  return {
    feasible: true,
    totalCuts: best.cost,
    sequence: cutList.map((c) => ({ dir: c.dir, coord: c.coord })),
    steps,
    takenOff,
  };
}

/**
 * 复核主入口：先按当前草稿重新执行既有联合排版（不接收页面上传的采用结果），
 * 再逐帆布验证采用裁片能否以贯穿直线依次切下。
 * @param {object} draft 当前草稿
 * @param {number} kerf 正整数锯缝宽度
 */
export function reviewCutting(draft, kerf) {
  if (!Number.isInteger(kerf) || kerf < 1) {
    throw new Error('锯缝宽度须为正整数。');
  }

  const layout = planLayout(draft);
  if (!layout.feasible) {
    return {
      feasible: false,
      stage: 'layout',
      kerf,
      layout: {
        feasible: false,
        firstPatchIndex: layout.infeasible.firstPatchIndex,
        conflictCount: layout.infeasible.conflicts.length,
      },
      canvases: [],
      totalCuts: 0,
      blockage: null,
    };
  }

  const layoutSummary = {
    feasible: true,
    tuple: layout.objective.tuple.slice(),
    canvasCount: layout.objective.canvasCount,
    maxRemaining: layout.objective.maxRemaining,
  };

  const canvases = draft.canvases.map((canvas, canvasIndex) => {
    const pieces = [];
    layout.assignment.forEach((ci, pi) => {
      const ev = layout.candidateEvals[pi][ci];
      if (ev.canvasId === canvas.id) pieces.push({ patchIndex: pi, rect: ev.rect });
    });
    pieces.sort((a, b) => a.patchIndex - b.patchIndex);
    return {
      canvasId: canvas.id,
      canvasIndex,
      cuttable: cuttableArea(canvas),
      pieces: pieces.map((p) => ({ patchIndex: p.patchIndex, rect: p.rect })),
      ...planCanvasCuts(canvas, pieces, kerf),
    };
  });

  const feasible = canvases.every((c) => c.feasible);
  const totalCuts = canvases.reduce((s, c) => s + (c.feasible ? c.totalCuts : 0), 0);

  // 按帆布录入顺序取首个不可裁帆布；其中补片序号最小者即首个被锯缝阻断的裁片。
  let blockage = null;
  if (!feasible) {
    const first = canvases.find((c) => !c.feasible);
    blockage = {
      canvasId: first.canvasId,
      canvasIndex: first.canvasIndex,
      firstPieceIndex: Math.min(...first.blockage.trapped),
      trapped: first.blockage.trapped.slice().sort((a, b) => a - b),
      stepsBefore: first.blockage.stepsBefore,
    };
  }

  return { feasible, stage: 'cut', kerf, layout: layoutSummary, canvases, totalCuts, blockage };
}
