/**
 * 直线（闸刀/推台锯式）裁切顺序复核。
 *
 * 在联合排版确定“采用裁片”之后，逐张帆布复核：这些裁片能否只凭
 * “在一块尚未分割的剩余矩形内作横或竖的贯穿直线”依次切下。
 *
 * 锯缝模型：
 *  - 每一刀在某个剩余矩形内切出一条贯穿全矩形、宽度 kerf（正整数）的带状区域，
 *    坐标与裁片整数网格对齐：
 *      竖切 vertical：带 = [at, at + kerf) × [r.y, r.y + r.height)
 *      横切 horizontal：带 = [r.x, r.x + r.width) × [at, at + kerf)
 *    带两侧各自成为独立剩余矩形（带本身成为锯缝损耗）。
 *  - 该带与任何“尚未取下”的采用裁片若发生**正面积相交**即伤片，此刀非法
 *    （边界相贴不算）。
 *  - 当某剩余矩形与其中一块待取裁片的矩形完全相等时，该裁片可直接取下，
 *    不再耗费刀数。
 *  - 不含任何待取裁片的剩余矩形是废料，可停止处理，不再下刀。
 *
 * 只需枚举贴裁片边缘的刀位（每条可落刀缝隙的两个极端位置）：
 *      竖切 at = p.x - kerf（带右缘贴裁片左缘）或 at = p.x + p.width（带左缘贴裁片右缘）
 *      横切 at = p.y - kerf 或 at = p.y + p.height
 * 缝隙中段下刀只改变两侧余量、不改变裁片归属，而余量可作废料丢弃，
 * 故不可能产生更优（更短）切法。
 *
 * 求解：子集区间 DP。每个状态是“一个剩余矩形 + 其中所含裁片子集（位掩码）”，
 * 与到达它的切法历史无关——各子矩形相互独立，因此
 *      f(R, S) = min(1 + f(R左, S左) + f(R右, S右))
 * 取片基例 f(R, {p}) = 0（当 R 恰为 p）。一侧子集为空即切下废料。
 *
 * 选优（严格按序）：
 *  1) 总刀数最少；
 *  2) 刀数相同时，按帆布录入顺序展开的切线序列字典序最小
 *     （每刀记为方向+坐标：竖切 V 先于横切 H，同方向坐标小者先）。
 *  字典序由“在全部活动矩形上贪心选择保持最优刀数的最小下一刀”回放得到。
 */

import { cuttableArea } from './planner.js';

const DIR_RANK = { vertical: 0, horizontal: 1 };

/** 带状锯缝是否与矩形发生正面积相交（边贴边允许）。 */
export function kerfHitsRect(band, rect) {
  return band.x < rect.x + rect.width &&
    rect.x < band.x + band.width &&
    band.y < rect.y + rect.height &&
    rect.y < band.y + band.height;
}

const strip = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });

const contains = (region, p) =>
  p.x >= region.x && p.y >= region.y &&
  p.x + p.width <= region.x + region.width &&
  p.y + p.height <= region.y + region.height;

const sameRect = (a, b) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const INF = Number.POSITIVE_INFINITY;

/**
 * 单张帆布的裁切复核求解器（子集 DP + 字典序回放 + 阻断证据）。
 */
class CanvasCutSolver {
  constructor(root, patches, kerf) {
    this.root = root;
    this.patches = patches; // [{x,y,width,height,patchIndex}]
    this.kerf = kerf;
    this.n = patches.length;
    this.memo = new Map();   // key -> 最少刀数（Infinity 不可切）
  }

  key(r, mask) {
    return `${r.x},${r.y},${r.width},${r.height}|${mask}`;
  }

  members(mask) {
    const out = [];
    for (let i = 0; i < this.n; i += 1) if (mask & (1 << i)) out.push(i);
    return out;
  }

  /**
   * 状态 (R, mask) 下的全部合法刀位，并给出分割后的子状态。
   * 按 (方向 V<H, 坐标, 区域 y,x) 升序。
   */
  legalMoves(r, mask) {
    const idxs = this.members(mask);
    const live = idxs.map((i) => this.patches[i]);
    const moves = [];
    const seen = new Set();
    const maxX = r.x + r.width;
    const maxY = r.y + r.height;

    const add = (dir, at) => {
      const tag = `${dir}:${at}`;
      if (seen.has(tag)) return;
      if (dir === 'vertical' && (at < r.x || at + this.kerf > maxX)) return;
      if (dir === 'horizontal' && (at < r.y || at + this.kerf > maxY)) return;
      const band = dir === 'vertical'
        ? { x: at, y: r.y, width: this.kerf, height: r.height }
        : { x: r.x, y: at, width: r.width, height: this.kerf };
      if (live.some((p) => kerfHitsRect(band, p))) return;
      seen.add(tag);

      let rA; let rB; let maskA = 0; let maskB = 0;
      if (dir === 'vertical') {
        rA = { x: r.x, y: r.y, width: at - r.x, height: r.height };
        rB = { x: at + this.kerf, y: r.y, width: maxX - at - this.kerf, height: r.height };
        for (const i of idxs) {
          const p = this.patches[i];
          if (p.x + p.width <= at) maskA |= 1 << i;
          else maskB |= 1 << i; // 合法刀位保证裁片不跨带
        }
      } else {
        rA = { x: r.x, y: r.y, width: r.width, height: at - r.y };
        rB = { x: r.x, y: at + this.kerf, width: r.width, height: maxY - at - this.kerf };
        for (const i of idxs) {
          const p = this.patches[i];
          if (p.y + p.height <= at) maskA |= 1 << i;
          else maskB |= 1 << i;
        }
      }
      const childA = maskA && rA.width > 0 && rA.height > 0 ? { r: rA, mask: maskA } : null;
      const childB = maskB && rB.width > 0 && rB.height > 0 ? { r: rB, mask: maskB } : null;
      const waste = [];
      if (rA.width > 0 && rA.height > 0 && !childA) waste.push(rA);
      if (rB.width > 0 && rB.height > 0 && !childB) waste.push(rB);
      if (!childA && !childB) return;
      moves.push({ dir, at, childA, childB, waste });
    };

    for (const p of live) {
      add('vertical', p.x - this.kerf);
      add('vertical', p.x + p.width);
      add('horizontal', p.y - this.kerf);
      add('horizontal', p.y + p.height);
    }
    moves.sort((a, b) =>
      DIR_RANK[a.dir] - DIR_RANK[b.dir] || a.at - b.at);
    return moves;
  }

  /** 最少刀数 DP；Infinity 表示该状态无法保全裁片。 */
  cost(r, mask) {
    if (mask === 0) return 0;
    const k = this.key(r, mask);
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;

    // 基例：只剩一块裁片且矩形恰为裁片 → 直接取下，0 刀。
    if ((mask & (mask - 1)) === 0) {
      const p = this.patches[this.members(mask)[0]];
      if (sameRect(r, p)) { this.memo.set(k, 0); return 0; }
    }

    let best = INF;
    for (const m of this.legalMoves(r, mask)) {
      const cA = m.childA ? this.cost(m.childA.r, m.childA.mask) : 0;
      const cB = m.childB ? this.cost(m.childB.r, m.childB.mask) : 0;
      if (cA === INF || cB === INF) continue;
      const total = 1 + cA + cB;
      if (total < best) best = total;
    }
    this.memo.set(k, best);
    return best;
  }

  /**
   * 在最少刀数前提下回放字典序最小的展开序列，产出页面步骤明细。
   * 任务列表 tasks：当前所有活动剩余矩形（各自带裁片子集，互不依赖）。
   */
  reconstruct(totalCost) {
    const steps = [];
    const allMask = (1 << this.n) - 1;
    let tasks = [{ r: this.root, mask: allMask }];
    let remaining = totalCost;
    let stepNo = 0;

    const takeSingletons = () => {
      const kept = [];
      for (const t of tasks) {
        if ((t.mask & (t.mask - 1)) === 0) {
          const i = this.members(t.mask)[0];
          if (sameRect(t.r, this.patches[i])) {
            stepNo += 1;
            steps.push({ no: stepNo, kind: 'take', patchIndex: this.patches[i].patchIndex, rect: strip(t.r) });
            continue;
          }
        }
        kept.push(t);
      }
      tasks = kept;
    };

    takeSingletons();
    while (tasks.length) {
      // 收集所有任务上“保持全局最优”的合法下一刀。
      const options = [];
      for (const t of tasks) {
        for (const m of this.legalMoves(t.r, t.mask)) {
          const cA = m.childA ? this.cost(m.childA.r, m.childA.mask) : 0;
          const cB = m.childB ? this.cost(m.childB.r, m.childB.mask) : 0;
          if (cA === INF || cB === INF) continue;
          // 此刀处于该任务的某条最优切法上（替换后总刀数不变）。
          if (1 + cA + cB === this.cost(t.r, t.mask)) {
            options.push({ t, m });
          }
        }
      }
      options.sort((a, b) =>
        DIR_RANK[a.m.dir] - DIR_RANK[b.m.dir] || a.m.at - b.m.at ||
        a.t.r.y - b.t.r.y || a.t.r.x - b.t.r.x);
      const choice = options[0];
      if (!choice) break; // 不应发生（总成本有限）
      const { t, m } = choice;
      const before = tasks.map((x) => strip(x.r));
      const produced = [];
      if (m.childA) produced.push(m.childA.r);
      if (m.childB) produced.push(m.childB.r);
      const others = tasks.filter((x) => x !== t);
      tasks = others.concat(
        m.childA ? [{ r: m.childA.r, mask: m.childA.mask }] : [],
        m.childB ? [{ r: m.childB.r, mask: m.childB.mask }] : [],
      );
      remaining -= 1;
      stepNo += 1;
      steps.push({
        no: stepNo,
        kind: 'cut',
        dir: m.dir,
        at: m.at,
        kerf: this.kerf,
        region: strip(t.r),
        before,
        after: tasks.map((x) => strip(x.r)),
        produced: produced.map(strip),
        discarded: m.waste.map(strip),
      });
      takeSingletons();
    }
    return steps;
  }

  /**
   * 不可切时的证据：沿字典序最小的刀路深入注定无解的子状态，
   * 返回第一个“区域含裁片却没有任何能通向成功的刀”的死胡同。
   */
  blockedEvidence() {
    const allMask = (1 << this.n) - 1;
    const trace = [];
    let stepNo = 0;

    function descend(solver, r, mask, trace) {
      // 单矩形恰为裁片：取片（对不可切根而言仅在局部子树出现）。
      if ((mask & (mask - 1)) === 0) {
        const i = solver.members(mask)[0];
        if (sameRect(r, solver.patches[i])) {
          stepNo += 1;
          trace.push({ no: stepNo, kind: 'take', patchIndex: solver.patches[i].patchIndex, rect: strip(r) });
          return null;
        }
      }
      const moves = solver.legalMoves(r, mask);
      if (moves.length === 0) {
        // 真正的死胡同：此剩余矩形内不存在任何不伤片的横/竖贯穿刀位。
        const live = solver.members(mask)
          .map((i) => solver.patches[i])
          .sort((a, b) => a.patchIndex - b.patchIndex);
        return { region: strip(r), hit: strip(live[0]), patchIndex: live[0].patchIndex, steps: trace.slice() };
      }
      const doomed = moves.filter((m) => {
        const cA = m.childA ? solver.cost(m.childA.r, m.childA.mask) : 0;
        const cB = m.childB ? solver.cost(m.childB.r, m.childB.mask) : 0;
        return cA === INF || cB === INF;
      });
      if (doomed.length === 0) return null; // 该子树可解
      // 状态不可切 ⇒ 每一刀都注定至少一侧无解；沿字典序最小的刀路继续，
      // 按几何顺序先进入注定无解的子矩形（可解的一侧不再处理）。
      const m = doomed[0];
      const children = [];
      if (m.childA) children.push({ c: m.childA, side: 0 });
      if (m.childB) children.push({ c: m.childB, side: 1 });
      const produced = children.map((x) => strip(x.c.r));
      stepNo += 1;
      trace.push({
        no: stepNo, kind: 'cut', dir: m.dir, at: m.at, kerf: solver.kerf,
        region: strip(r),
        before: [strip(r)],
        after: produced,
        produced,
        discarded: m.waste.map(strip),
      });
      for (const { c } of children) {
        if (solver.cost(c.r, c.mask) === INF) {
          const ev = descend(solver, c.r, c.mask, trace);
          if (ev) return ev;
        }
      }
      return null;
    }

    return descend(this, this.root, allMask, trace);
  }
}

/**
 * 复核单张帆布。
 * @param {object} canvas 帆布（含 margin）
 * @param {Array<{rect:object, patchIndex:number}>} placed 采用裁片（来自 usage.placed）
 * @param {number} kerf 正整数锯缝宽度
 */
export function reviewCanvasCutting(canvas, placed, kerf) {
  const root = cuttableArea(canvas);
  const initial = placed.map((pl) => ({ ...pl.rect, patchIndex: pl.patchIndex }));

  if (initial.some((p) => !contains(root, p))) {
    const bad = initial.find((p) => !contains(root, p));
    return {
      feasible: false, cutCount: null, cuts: [], steps: [],
      blocked: { patchIndex: bad.patchIndex, rect: strip(bad), region: strip(root),
        reason: '采用裁片超出可裁区域，无法复核裁切。' },
    };
  }

  if (initial.length === 0) {
    return { feasible: true, cutCount: 0, cuts: [], steps: [], blocked: null };
  }

  const solver = new CanvasCutSolver(root, initial, kerf);
  const allMask = (1 << initial.length) - 1;
  const total = solver.cost(root, allMask);

  if (total !== INF) {
    const steps = solver.reconstruct(total);
    const cuts = steps.filter((s) => s.kind === 'cut').map((s) => ({ dir: s.dir, at: s.at }));
    return { feasible: true, cutCount: total, cuts, steps, blocked: null };
  }

  const ev = solver.blockedEvidence() || {
    region: strip(root),
    hit: strip(initial[0]),
    patchIndex: initial[0].patchIndex,
    steps: [],
  };
  return {
    feasible: false,
    cutCount: null,
    cuts: [],
    steps: ev.steps,
    blocked: {
      patchIndex: ev.patchIndex,
      rect: ev.hit,
      region: ev.region,
      reason: `在剩余矩形 (${ev.region.x},${ev.region.y})–(${ev.region.x + ev.region.width},${ev.region.y + ev.region.height}) 内，` +
        `所有横/竖贯穿刀位的 ${kerf} 单位宽锯缝都会与该裁片正面积相交，无法在不伤片的前提下继续分割。`,
    },
  };
}

/**
 * 复核整份排版结果：按帆布录入顺序逐布复核。
 * 任一帆布被锯缝阻断即整体不可切，并给出按帆布、步骤顺序的首个阻断证据。
 */
export function reviewCutting(draft, plan, kerf) {
  const reviews = draft.canvases.map((canvas) => {
    const usage = plan.usage.find((u) => u.canvasId === canvas.id);
    return reviewCanvasCutting(canvas, usage ? usage.placed : [], kerf);
  });

  const feasible = reviews.every((r) => r.feasible);
  const totalCuts = feasible ? reviews.reduce((s, r) => s + r.cutCount, 0) : null;

  // 按帆布顺序展开的（方向、坐标）切线序列，用于页面与目标说明。
  const cutSequence = [];
  reviews.forEach((r, ci) => {
    r.cuts.forEach((cut) => cutSequence.push({
      canvasIndex: ci,
      canvasId: draft.canvases[ci].id,
      dir: cut.dir,
      at: cut.at,
    }));
  });

  const blockedCanvasIndex = reviews.findIndex((r) => !r.feasible);
  return {
    kerf,
    feasible,
    totalCuts,
    cutSequence,
    reviews: reviews.map((r, ci) => ({
      canvasId: draft.canvases[ci].id,
      canvasName: draft.canvases[ci].name,
      feasible: r.feasible,
      cutCount: r.cutCount,
      cuts: r.cuts,
      steps: r.steps,
      blocked: r.blocked,
    })),
    blockedCanvasIndex: blockedCanvasIndex < 0 ? null : blockedCanvasIndex,
  };
}
