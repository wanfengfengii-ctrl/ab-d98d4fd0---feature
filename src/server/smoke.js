/**
 * 业务冒烟：不经 HTTP，直接以默认草稿走一遍领域管线。
 *  1) 候选冲突：断言联合求解识别出“局部省料会令其他补片无处可裁”的情形；
 *  2) 锯缝裁切：断言裁切顺序复核在默认草稿上重新执行联合排版，
 *     判定可切（锯缝 ≤ 间隙，边贴边零面积接触允许）并给出最少刀数与最小切线序列，
 *     以及锯缝超宽时按帆布与步骤顺序给出首个被阻断裁片的精确证据。
 *
 * @returns {{passed: boolean, checks: Array<{name:string, ok:boolean, detail:string}>}}
 */
import { planLayout } from '../core/planner.js';
import { validateDraft } from '../core/validation.js';
import { reviewCutting } from '../core/cutting.js';
import { defaultDraft } from './defaultDraft.js';

export function runSmoke() {
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail: detail || '' });

  const v = validateDraft(defaultDraft);
  record('默认草稿通过录入校验（2–3 帆布 / 3–5 补片 / 每补片 2–4 候选）', v.ok,
    v.ok ? '' : v.errors.join('；'));

  const plan = planLayout(defaultDraft);

  record('默认草稿存在可行联合方案', plan.feasible,
    plan.feasible ? `使用帆布 ${plan.objective.canvasCount} 张` : '误判为无解');

  if (plan.feasible) {
    // 贪心（局部最省料：大肘补 P1 取甲布角落的候选 1）必然与方肘补 P2 的
    // 全部甲布可兼容候选正面积重叠——冒烟必须确认该冲突被识别。
    const p1C0 = plan.candidateEvals[0][0];
    const p2Compat = plan.candidateEvals[1].filter((e) => e.compatible);
    const blocksAll = p2Compat.every((e) => e.canvasId !== p1C0.canvasId ||
      p1C0.rect.x < e.rect.x + e.rect.width && e.rect.x < p1C0.rect.x + p1C0.rect.width &&
      p1C0.rect.y < e.rect.y + e.rect.height && e.rect.y < p1C0.rect.y + p1C0.rect.height);
    record('局部省料选择（P1 候选 1 落甲布）会令 P2 在甲布无处可裁', blocksAll,
      blocksAll ? 'P2 的全部甲布兼容候选均与之正面积重叠' : '冲突几何构造失效');

    // 联合最优必须把 P1 放到第 2 个候选（乙布、旋转 90°）。
    const p1Choice = plan.objective.tuple[0];
    record('联合求解避开局部陷阱：P1 改用候选 2（乙布 cw90）', p1Choice === 2,
      `实际 P1 采用候选 ${p1Choice}`);

    record('每块补片恰采用一个候选', plan.assignment.length === defaultDraft.patches.length &&
      plan.assignment.every((i) => Number.isInteger(i) && i >= 0),
      `采用序列（1 起）：${plan.objective.tuple.join(', ')}`);

    record('使用帆布张数达到下界 2', plan.objective.canvasCount === 2,
      `实际 ${plan.objective.canvasCount} 张`);
  }

  // 反例：把大肘补限制为只能选甲布角落 → P2 无任何可落位候选。
  const trapped = structuredClone(defaultDraft);
  trapped.patches[0].candidates = [trapped.patches[0].candidates[0]];
  // 每块补片要求 2–4 候选，这里改为直接调用求解器以构造“无兼容候选”的极端情形：
  // 再把 P2 所有候选挪入与 P1 冲突的位置。
  trapped.patches[1].candidates = trapped.patches[1].candidates
    .filter((c) => c.canvasId === 'C1')
    .map((c) => ({ ...c, x: 14, y: 14 }));
  const bad = planLayout(trapped);
  record('全部候选互斥时判定无解', !bad.feasible, bad.feasible ? '误判为有解' : '已报告无解');

  // 首块不存在任何可兼容候选的补片：P2 的候选全部越出可裁区。
  const noFit = structuredClone(defaultDraft);
  noFit.patches[1].candidates = noFit.patches[1].candidates.map((c) => ({ ...c, x: 1000, y: 1000 }));
  const noFitPlan = planLayout(noFit);
  record('无解时按录入顺序指出首块无兼容候选的补片（P2）',
    !noFitPlan.feasible && noFitPlan.infeasible.firstPatchIndex === 1,
    noFitPlan.feasible ? '误判为有解' :
      `首块序号（0 起）=${noFitPlan.infeasible.firstPatchIndex}`);

  // —— 直线裁切顺序复核（锯缝）——
  // 默认草稿最优采用 [2,1,4]：甲布 C1 上是 P2(12,12,30×30) 与 P3(80,20,20×20)，
  // 二者 x 向间隙为 [42, 80) 共 38、y 向投影相交；乙布 C2 上仅 P1 一片。
  const cut38 = reviewCutting(defaultDraft, 38);
  record('复核按当前草稿重新执行联合排版（采用序号 [2, 1, 4]，不接收上传结果）',
    cut38.stage === 'cut' && Array.isArray(cut38.layout.tuple) && cut38.layout.tuple.join(',') === '2,1,4',
    cut38.stage === 'cut' ? `实际 [${cut38.layout.tuple}]` : '未走到裁切阶段');

  record('锯缝 38 与 P3 边贴边（零面积接触）仍判定全部可裁，总刀数最少为 1',
    cut38.feasible && cut38.totalCuts === 1,
    cut38.feasible ? `总刀数 ${cut38.totalCuts}` : '误判为不可裁');

  const c1Plan = cut38.canvases[0];
  record('甲布切线序列为竖切 x=42（锯缝带贴 P2 右缘）',
    c1Plan.feasible && c1Plan.sequence.length === 1 &&
    c1Plan.sequence[0].dir === 'v' && c1Plan.sequence[0].coord === 42,
    c1Plan.feasible ? `实际序列 ${JSON.stringify(c1Plan.sequence)}` : '甲布误判为不可裁');

  record('乙布仅 1 片采用裁片：0 刀、初始即取下',
    cut38.canvases[1].feasible && cut38.canvases[1].totalCuts === 0 &&
    cut38.canvases[1].takenOff.some((t) => t.patchIndex === 0 && t.atStep === 0),
    `实际刀数 ${cut38.canvases[1].feasible ? cut38.canvases[1].totalCuts : '不可裁'}`);

  const cut39 = reviewCutting(defaultDraft, 39);
  record('锯缝 39 超出间隙 1 → 与 P3 正面积相交，判定无法裁切',
    !cut39.feasible && cut39.stage === 'cut',
    cut39.feasible ? '误判为可裁' : '已判定不可裁');

  record('按帆布与步骤顺序给出首个被阻断裁片：甲布补片 2（方肘补，与补片 3 互卡）',
    !cut39.feasible && cut39.blockage.canvasId === 'C1' &&
    cut39.blockage.firstPieceIndex === 1 && cut39.blockage.trapped.join(',') === '1,2',
    cut39.feasible ? '误判为可裁' : `实际首个被阻断补片序号（0 起）=${cut39.blockage.firstPieceIndex}`);

  const attempt42 = !cut39.feasible &&
    cut39.canvases[0].blockage.attempts.find((a) => a.dir === 'v' && a.coord === 42);
  record('证据精确给出：竖切 x=42 的锯缝带与 P3 正面积相交 20（1×20）',
    !!attempt42 && attempt42.blockedBy.length === 1 &&
    attempt42.blockedBy[0].patchIndex === 2 && attempt42.blockedBy[0].overlapArea === 20,
    attempt42 ? `实际相交 ${JSON.stringify(attempt42.blockedBy)}` : '缺少该候选切线证据');

  const layoutBad = reviewCutting(noFit, 5);
  record('联合排版无解时复核在排版阶段即报告，不产生裁切结论',
    layoutBad.stage === 'layout' && !layoutBad.feasible,
    layoutBad.stage === 'layout' ? '已报告排版阶段失败' : '误判进入裁切阶段');

  return { passed: checks.every((c) => c.ok), checks };
}
