/**
 * 帆装师排版工作台 · 浏览器端
 *  - 帆布/补片/候选的录入与编辑（数量按题面限制）
 *  - 点击排版后展示：帆布示意（可裁区、禁裁边、采用裁片）、采用/排除明细
 *  - 草稿修改后旧结论立即标记为失效
 */

const $ = (sel) => document.querySelector(sel);

const state = {
  version: 0,
  draft: null,
  result: null, // { version, output }
  resultVersion: null, // 当前页面上展示的结论对应的草稿版本
  cutResult: null, // { version, kerf, plan, review }
  cutResultVersion: null,
  kerf: 2,
};

const GRAIN_TEXT = { warp: '经纱 warp', weft: '纬纱 weft' };
const ROT_TEXT = { none: '不旋转', cw90: '顺时针 90°' };
const PATCH_COLORS = ['#2e7d43', '#1f6aa5', '#9c4a1a', '#7a3e9d', '#5d6d2c'];

// ---------- 数据访问 ----------

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.errors || [`HTTP ${res.status}`]);
  return body;
}
class ApiError extends Error {
  constructor(errors) { super(errors.join('\n')); this.errors = errors; }
}

async function load() {
  const r = await api('/api/draft');
  state.draft = r.draft;
  state.version = r.version;
  state.result = r.result;
  state.resultVersion = r.result ? r.result.version : null;
  state.cutResult = r.cutResult || null;
  state.cutResultVersion = r.cutResult ? r.cutResult.version : null;
  if (r.cutResult) state.kerf = r.cutResult.kerf;
  $('#inp-kerf').value = state.kerf;
  renderAll();
}

function markDirty() {
  // 任何草稿录入变更都使旧结论在 UI 上立即失效（保存后服务端版本推进）。
  let changed = false;
  if (state.result) { state.resultVersion = -1; changed = true; }
  if (state.cutResult) { state.cutResultVersion = -1; changed = true; }
  if (changed) { renderResult(); renderCutResult(); }
}

function markCutDirty() {
  if (state.cutResult) {
    state.cutResultVersion = -1;
    renderCutResult();
  }
}

// ---------- 录入区渲染 ----------

function renderCanvases() {
  const root = $('#canvases');
  root.innerHTML = '';
  state.draft.canvases.forEach((c, ci) => {
    const div = document.createElement('div');
    div.className = 'entity';
    div.innerHTML = `
      <div class="entity-head">
        <span class="idx">帆布 ${ci + 1}</span>
        <input class="w-id" data-k="id" placeholder="编号" value="${escapeHtml(c.id)}" />
        <input class="w-name" data-k="name" placeholder="名称" value="${escapeHtml(c.name)}" />
        <span class="grow"></span>
        <button type="button" class="mini danger" data-act="del-canvas">删除</button>
      </div>
      <div class="row">
        <span class="field"><label>宽</label><input type="number" min="1" step="1" data-k="width" value="${c.width}" /></span>
        <span class="field"><label>高</label><input type="number" min="1" step="1" data-k="height" value="${c.height}" /></span>
        <span class="field"><label>纤维方向</label>
          <select class="w-canvas" data-k="grain">
            <option value="warp" ${c.grain === 'warp' ? 'selected' : ''}>经纱 warp（沿高）</option>
            <option value="weft" ${c.grain === 'weft' ? 'selected' : ''}>纬纱 weft（沿高）</option>
          </select>
        </span>
        <span class="field"><label>边缘禁裁宽度</label><input type="number" min="0" step="1" data-k="margin" value="${c.margin}" /></span>
      </div>`;
    div.querySelector('[data-act="del-canvas"]').addEventListener('click', () => {
      state.draft.canvases.splice(ci, 1);
      renderAll(); markDirty();
    });
    div.querySelectorAll('input[data-k], select[data-k]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.k;
        c[k] = el.tagName === 'SELECT' || k === 'id' || k === 'name' ? el.value : toInt(el.value);
        markDirty();
      });
    });
    root.appendChild(div);
  });
}

function renderPatches() {
  const root = $('#patches');
  root.innerHTML = '';
  state.draft.patches.forEach((p, pi) => {
    const div = document.createElement('div');
    div.className = 'entity';
    div.innerHTML = `
      <div class="entity-head">
        <span class="idx">补片 ${pi + 1}</span>
        <input class="w-id" data-k="id" placeholder="编号" value="${escapeHtml(p.id || '')}" />
        <input class="w-name" data-k="name" placeholder="名称" value="${escapeHtml(p.name)}" />
        <span class="grow"></span>
        <button type="button" class="mini danger" data-act="del-patch">删除</button>
      </div>
      <div class="row">
        <span class="field"><label>毛坯宽</label><input type="number" min="1" step="1" data-k="width" value="${p.width}" /></span>
        <span class="field"><label>毛坯高</label><input type="number" min="1" step="1" data-k="height" value="${p.height}" /></span>
        <span class="field"><label>纤维方向</label>
          <select class="w-canvas" data-k="grain">
            <option value="warp" ${p.grain === 'warp' ? 'selected' : ''}>经纱 warp</option>
            <option value="weft" ${p.grain === 'weft' ? 'selected' : ''}>纬纱 weft</option>
          </select>
        </span>
      </div>
      <div class="cands">
        <div class="entity-head"><span class="reason">批准候选（${p.candidates.length} 个，序号从 1 计；选择顺序影响字典序平局判定）</span>
          <span class="grow"></span>
          <button type="button" class="mini" data-act="add-cand">＋ 候选</button>
        </div>
        <div data-cands></div>
      </div>`;
    div.querySelector('[data-act="del-patch"]').addEventListener('click', () => {
      state.draft.patches.splice(pi, 1);
      renderAll(); markDirty();
    });
    div.querySelector('[data-act="add-cand"]').addEventListener('click', () => {
      if (p.candidates.length >= 4) return;
      const first = state.draft.canvases[0];
      p.candidates.push({
        canvasId: first ? first.id : '', x: 0, y: 0,
        width: p.width, height: p.height, rotation: 'none',
      });
      renderAll(); markDirty();
    });
    div.querySelectorAll('input[data-k], select[data-k]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.k;
        p[k] = el.tagName === 'SELECT' || k === 'id' || k === 'name' ? el.value : toInt(el.value);
        markDirty();
      });
    });

    const candsBox = div.querySelector('[data-cands]');
    p.candidates.forEach((cd, cdi) => {
      const row = document.createElement('div');
      row.className = 'cand';
      row.dataset.patch = String(pi);
      row.dataset.cand = String(cdi);
      row.innerHTML = candidateRowHtml(cd, cdi, p);
      row.querySelector('[data-act="del-cand"]').addEventListener('click', () => {
        p.candidates.splice(cdi, 1);
        renderAll(); markDirty();
      });
      row.querySelectorAll('input[data-cf], select[data-cf]').forEach((el) => {
        el.addEventListener('change', () => {
          const k = el.dataset.cf;
          cd[k] = el.tagName === 'SELECT' ? el.value : toInt(el.value);
          markDirty();
        });
      });
      candsBox.appendChild(row);
    });
    root.appendChild(div);
  });
}

function candidateRowHtml(cd, cdi, patch) {
  const opts = state.draft.canvases.map((c) =>
    `<option value="${escapeHtml(c.id)}" ${c.id === cd.canvasId ? 'selected' : ''}>${escapeHtml(c.id)} ${escapeHtml(c.name)}</option>`).join('');
  return `
    <span class="cnum">#${cdi + 1}</span>
    <span class="field"><label>帆布</label>
      <select class="w-canvas" data-cf="canvasId">${opts}</select>
    </span>
    <span class="field"><label>左上 x</label><input type="number" min="0" step="1" data-cf="x" value="${cd.x}" /></span>
    <span class="field"><label>左上 y</label><input type="number" min="0" step="1" data-cf="y" value="${cd.y}" /></span>
    <span class="field"><label>宽</label><input type="number" min="1" step="1" data-cf="width" value="${cd.width}" /></span>
    <span class="field"><label>高</label><input type="number" min="1" step="1" data-cf="height" value="${cd.height}" /></span>
    <span class="field"><label>旋转</label>
      <select data-cf="rotation">
        <option value="none" ${cd.rotation === 'none' ? 'selected' : ''}>不旋转</option>
        <option value="cw90" ${cd.rotation === 'cw90' ? 'selected' : ''}>顺时针 90°</option>
      </select>
    </span>
    <button type="button" class="mini danger" data-act="del-cand">移除</button>`;
}

// ---------- 裁切复核结论区 ----------

const DIR_TEXT = { vertical: '竖切', horizontal: '横切' };

function updateStaleBanner() {
  const planStale = state.result && (state.result.version !== state.version || state.resultVersion === -1);
  const cutStale = state.cutResult && (state.cutResult.version !== state.version || state.cutResultVersion === -1);
  $('#stale-banner').classList.toggle('hidden', !planStale && !cutStale);
}

function renderCutResult() {
  updateStaleBanner();
  const body = $('#cut-body');
  const cr = state.cutResult;
  if (!cr) {
    body.innerHTML = '<p class="hint">尚未复核。</p>';
    return;
  }
  if (!cr.plan.feasible) {
    body.innerHTML = '<p class="verdict-bad">✘ 当前草稿联合排版本身无解，无法进行裁切复核。请先在上方排版结论中处理冲突。</p>';
    return;
  }
  if (!cr.review.feasible) {
    body.innerHTML = renderCutBlocked(cr);
    const host = body.querySelector('[data-block-svg]');
    if (host) host.appendChild(renderBlockedSvg(cr));
    return;
  }
  body.innerHTML = renderCutFeasible(cr);
  bindCutSteppers(cr);
}

function renderCutFeasible(cr) {
  const { review, kerf } = cr;
  const seqText = review.cutSequence.length
    ? review.cutSequence.map((c) => `${canvasName(c.canvasId)} ${c.dir === 'vertical' ? 'V' : 'H'}${c.at}`).join(' → ')
    : '（无需下刀，裁片已与可裁区相等）';
  const sheets = review.reviews.map((rv) => cutSheetCard(cr, rv)).join('');
  return `
    <p class="verdict-ok">✔ 采用裁片可在不伤片的前提下依次切下（锯缝宽 ${kerf}）。</p>
    <div class="summary">
      <span class="metric">总刀数 <b>${review.totalCuts}</b></span>
      <span class="metric">切线序列（按帆布顺序）<b>${seqText}</b></span>
    </div>
    <p class="reason">切线记号：V=竖切（沿 x 坐标的竖直锯缝带），H=横切（沿 y 坐标的水平锯缝带）。
      序列在总刀数最少的全部切法中字典序最小。拖动每张帆布下的步骤滑块可查看每刀前后的剩余区域与已取下补片。</p>
    ${sheets}`;
}

function cutSheetCard(cr, rv) {
  const usage = cr.plan.usage.find((u) => u.canvasId === rv.canvasId);
  const steps = rv.steps || [];
  const cutCount = rv.cutCount;
  const rows = steps.map((s, i) => {
    if (s.kind === 'take') {
      const p = state.draft.patches[s.patchIndex];
      return `<tr class="step-take">
        <td>${i + 1}</td><td>取下补片</td>
        <td>「${escapeHtml(p.name)}」（补片 ${s.patchIndex + 1}）矩形 (${s.rect.x},${s.rect.y}) ${s.rect.width}×${s.rect.height}</td>
        <td>该矩形已与所在剩余矩形完全相等，直接取下，不耗刀。</td></tr>`;
    }
    const band = s.dir === 'vertical'
      ? `x∈[${s.at}, ${s.at + s.kerf})`
      : `y∈[${s.at}, ${s.at + s.kerf})`;
    const produced = s.produced.map((r) => rectText(r)).join('、') || '无';
    const waste = (s.discarded || []).map((r) => rectText(r)).join('、') || '无';
    return `<tr class="step-cut" data-step="${i}">
      <td>${i + 1}</td>
      <td><b>${DIR_TEXT[s.dir]}</b> @${s.at}<br><span class="reason">锯缝带 ${band}，宽 ${s.kerf}</span></td>
      <td>落刀于剩余矩形 ${rectText(s.region)}<br>
        切前活动区域：${s.before.map(rectText).join('、')}<br>
        切后活动区域：${s.after.map(rectText).join('、')}</td>
      <td>新剩余矩形：${produced}<br>废料（停止处理）：${waste}</td></tr>`;
  }).join('');
  return `
  <div class="canvas-sheet cut-sheet" data-canvas="${rv.canvasId}">
    <h3>${escapeHtml(rv.canvasName)}（${escapeHtml(rv.canvasId)}）
      <span class="legend">${cutCount === 0 ? '无需下刀' : `共 ${cutCount} 刀，取下 ${usage.placed.length} 片`}</span></h3>
    <div class="cut-viz-row">
      <div class="sheet-wrap" data-cut-svg></div>
      <div class="cut-legend">
        <div><span class="sw patch"></span>采用裁片（P# 为补片序号）</div>
        <div><span class="sw band"></span>锯缝带（标号＝下刀次序）</div>
        <div><span class="sw region"></span>当前活动剩余矩形轮廓</div>
        <div><span class="sw taken"></span>已取下补片</div>
        <div class="step-control">
          <label>步骤进度 <input type="range" min="0" max="${steps.length}" value="0" data-step-slider /></label>
          <div data-step-caption class="reason">第 0 / ${steps.length} 步：初始可裁区，尚未下刀。</div>
        </div>
      </div>
    </div>
    <table class="detail-table cut-steps">
      <thead><tr><th style="width:42px">#</th><th style="width:150px">动作</th><th>每刀前后的剩余区域</th><th>分割结果</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderCutBlocked(cr) {
  const { review, kerf } = cr;
  const bi = review.blockedCanvasIndex;
  const rv = review.reviews[bi];
  const b = rv.blocked;
  const p = state.draft.patches[b.patchIndex];
  const prior = (rv.steps || []).map((s, i) => {
    if (s.kind === 'take') return `<li>第 ${i + 1} 步：取下「${escapeHtml(state.draft.patches[s.patchIndex].name)}」</li>`;
    return `<li>第 ${i + 1} 步：在 ${rectText(s.region)} 内${DIR_TEXT[s.dir]}@${s.at}（锯缝 [${s.at}, ${s.at + s.kerf})），` +
      `切后区域：${s.after.map(rectText).join('、')}</li>`;
  }).join('');
  // 其它帆布状态
  const others = review.reviews.filter((_, i) => i !== bi).map((o) =>
    `<li>${escapeHtml(o.canvasName)}（${o.canvasId}）：${o.feasible ? `可切，${o.cutCount} 刀` : '同样被阻断'}</li>`).join('');
  return `
    <p class="verdict-bad">✘ 锯缝宽 ${kerf} 时无法裁切。按帆布录入顺序与步骤顺序，首个被锯缝阻断的是
      ${escapeHtml(rv.canvasName)}（${rv.canvasId}）上的补片 ${b.patchIndex + 1} ·「${escapeHtml(p.name)}」。</p>
    <div class="summary">
      <span class="metric">阻断裁片矩形 <b>(${b.rect.x},${b.rect.y}) ${b.rect.width}×${b.rect.height}</b></span>
      <span class="metric">所处剩余矩形 <b>(${b.region.x},${b.region.y}) ${b.region.width}×${b.region.height}</b></span>
    </div>
    <p class="reason bad">${escapeHtml(b.reason)}</p>
    <div class="cut-viz-row"><div class="sheet-wrap" data-block-svg></div></div>
    ${prior ? `<p class="reason">阻断前已执行的步骤：</p><ul class="reason">${prior}</ul>` : '<p class="reason">第一刀就无处可落：初始可裁区内不存在不伤片的横/竖贯穿刀位。</p>'}
    ${others ? `<p class="reason">其余帆布：</p><ul class="reason">${others}</ul>` : ''}
    <p class="reason">可减小锯缝宽度、移动候选位置以留出落刀缝隙，或调整草稿后重新复核。</p>`;
}

function rectText(r) {
  return `(${r.x},${r.y}) ${r.width}×${r.height}`;
}

function cssEsc(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

/** 阻断情形的静态示意：标出可裁区、各采用裁片与被阻断的剩余矩形。 */
function renderBlockedSvg(cr) {
  const bi = cr.review.blockedCanvasIndex;
  const rv = cr.review.reviews[bi];
  const usage = cr.plan.usage.find((u) => u.canvasId === rv.canvasId);
  const b = rv.blocked;
  const pad = 14;
  const scale = Math.min(480 / usage.width, 3.4);
  const w = usage.width * scale;
  const h = usage.height * scale;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'sheet cut-sheet-svg');
  svg.setAttribute('viewBox', `0 0 ${w + pad * 2} ${h + pad * 2}`);
  svg.setAttribute('width', w + pad * 2);
  svg.setAttribute('height', h + pad * 2);
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('transform', `translate(${pad},${pad})`);
  svg.appendChild(g);
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text != null) el.textContent = text;
    g.appendChild(el);
    return el;
  };
  add('rect', { x: 0, y: 0, width: w, height: h, fill: '#e9dfc6' });
  const cut = usage.cuttable;
  add('rect', {
    x: cut.x * scale, y: cut.y * scale, width: cut.width * scale, height: cut.height * scale,
    fill: '#f8f2df', stroke: '#8a7a50', 'stroke-dasharray': '4 3',
  });
  usage.placed.forEach((pl) => {
    const blocked = pl.patchIndex === b.patchIndex;
    const color = blocked ? '#b03a2e' : PATCH_COLORS[pl.patchIndex % PATCH_COLORS.length];
    add('rect', {
      x: pl.rect.x * scale, y: pl.rect.y * scale,
      width: pl.rect.width * scale, height: pl.rect.height * scale,
      fill: color, 'fill-opacity': blocked ? 0.82 : 0.55, stroke: color, 'stroke-width': 1.5,
    });
    add('text', { x: pl.rect.x * scale + 4, y: pl.rect.y * scale + 14,
      'font-size': 11, fill: '#fff', 'font-weight': 700 }, `P${pl.patchIndex + 1}${blocked ? ' 阻断' : ''}`);
  });
  add('rect', {
    x: b.region.x * scale, y: b.region.y * scale,
    width: b.region.width * scale, height: b.region.height * scale,
    fill: 'none', stroke: '#b03a2e', 'stroke-width': 2.4, 'stroke-dasharray': '7 3',
  });
  return svg;
}

/** 交互式帆布 SVG：概览（全部锯缝带标号）＋ 滑块驱动的每步状态。 */
function bindCutSteppers(cr) {
  cr.review.reviews.forEach((rv) => {
    const card = document.querySelector(`.cut-sheet[data-canvas="${cssEsc(rv.canvasId)}"]`);
    if (!card) return;
    const usage = cr.plan.usage.find((u) => u.canvasId === rv.canvasId);
    const svgHost = card.querySelector('[data-cut-svg]');
    const slider = card.querySelector('[data-step-slider]');
    const caption = card.querySelector('[data-step-caption]');
    const ctx = makeCutSvg(usage, rv, cr.kerf);
    svgHost.innerHTML = ctx.svg;

    const states = buildCutStates(usage, rv.steps);
    slider.addEventListener('input', () => {
      const t = Number(slider.value);
      ctx.render(states, t);
      const s = rv.steps[t - 1];
      if (!s) caption.textContent = `第 0 / ${rv.steps.length} 步：初始可裁区，尚未下刀。`;
      else if (s.kind === 'take') caption.textContent = `第 ${t} / ${rv.steps.length} 步：取下「${state.draft.patches[s.patchIndex].name}」。`;
      else caption.textContent = `第 ${t} / ${rv.steps.length} 步：在 ${rectText(s.region)} 内${DIR_TEXT[s.dir]}@${s.at}，锯缝带宽 ${s.kerf}。`;
      card.querySelectorAll('tr.step-cut').forEach((tr) => {
        tr.classList.toggle('active', Number(tr.dataset.step) === t - 1);
      });
    });
    slider.dispatchEvent(new Event('input'));
  });
}

/** 依据步骤序列重建每一步之后的（活动区域、已取裁片、当步刀带）状态。 */
function buildCutStates(usage, steps) {
  let regions = [usage.cuttable];
  const removed = new Set();
  const states = [{ regions: [usage.cuttable], removed: new Set(), band: null }];
  steps.forEach((s) => {
    if (s.kind === 'cut') {
      regions = s.after.map((r) => ({ ...r }));
      states.push({
        regions: regions.map((r) => ({ ...r })),
        removed: new Set(removed),
        band: { dir: s.dir, at: s.at, kerf: s.kerf, region: s.region },
      });
    } else {
      removed.add(s.patchIndex);
      states.push({ regions: regions.map((r) => ({ ...r })), removed: new Set(removed), band: null });
    }
  });
  return states;
}

function makeCutSvg(usage, rv, kerf) {
  const pad = 14;
  const maxW = 480;
  const scale = Math.min(maxW / usage.width, 3.4);
  const w = usage.width * scale;
  const h = usage.height * scale;
  const cut = usage.cuttable;
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'sheet cut-sheet-svg');
  svg.setAttribute('width', w + pad * 2);
  svg.setAttribute('height', h + pad * 2);
  svg.setAttribute('viewBox', `0 0 ${w + pad * 2} ${h + pad * 2}`);
  const g = document.createElementNS(svgNs, 'g');
  g.setAttribute('transform', `translate(${pad},${pad})`);
  svg.appendChild(g);

  const bg = document.createElementNS(svgNs, 'rect');
  bg.setAttribute('x', 0); bg.setAttribute('y', 0);
  bg.setAttribute('width', w); bg.setAttribute('height', h);
  bg.setAttribute('fill', '#e9dfc6');
  g.appendChild(bg);

  const cutEl = document.createElementNS(svgNs, 'rect');
  cutEl.setAttribute('x', cut.x * scale); cutEl.setAttribute('y', cut.y * scale);
  cutEl.setAttribute('width', cut.width * scale); cutEl.setAttribute('height', cut.height * scale);
  cutEl.setAttribute('fill', '#f8f2df'); cutEl.setAttribute('stroke', '#8a7a50');
  cutEl.setAttribute('stroke-dasharray', '4 3');
  g.appendChild(cutEl);

  // 裁片层（取片状态驱动透明度）
  const patchEls = new Map();
  usage.placed.forEach((pl) => {
    const pg = document.createElementNS(svgNs, 'g');
    const color = PATCH_COLORS[pl.patchIndex % PATCH_COLORS.length];
    const r = document.createElementNS(svgNs, 'rect');
    r.setAttribute('x', pl.rect.x * scale); r.setAttribute('y', pl.rect.y * scale);
    r.setAttribute('width', pl.rect.width * scale); r.setAttribute('height', pl.rect.height * scale);
    r.setAttribute('fill', color); r.setAttribute('fill-opacity', '0.7');
    r.setAttribute('stroke', color); r.setAttribute('stroke-width', '1.5');
    const t = document.createElementNS(svgNs, 'text');
    t.setAttribute('x', pl.rect.x * scale + 4); t.setAttribute('y', pl.rect.y * scale + 14);
    t.setAttribute('font-size', '11'); t.setAttribute('fill', '#fff'); t.setAttribute('font-weight', '700');
    t.textContent = `P${pl.patchIndex + 1}`;
    pg.appendChild(r); pg.appendChild(t);
    g.appendChild(pg);
    patchEls.set(pl.patchIndex, { pg, r });
  });

  // 全部锯缝带（淡显，标号＝下刀次序）
  const bandEls = [];
  let cutNo = 0;
  (rv.steps || []).forEach((s) => {
    if (s.kind !== 'cut') return;
    cutNo += 1;
    const bx = s.dir === 'vertical' ? s.at * scale : s.region.x * scale;
    const by = s.dir === 'horizontal' ? s.at * scale : s.region.y * scale;
    const bw = s.dir === 'vertical' ? Math.max(kerf * scale, 2) : s.region.width * scale;
    const bh = s.dir === 'horizontal' ? Math.max(kerf * scale, 2) : s.region.height * scale;
    const band = document.createElementNS(svgNs, 'rect');
    band.setAttribute('x', bx); band.setAttribute('y', by);
    band.setAttribute('width', bw); band.setAttribute('height', bh);
    band.setAttribute('fill', '#b03a2e'); band.setAttribute('fill-opacity', '0.12');
    band.setAttribute('stroke', '#b03a2e'); band.setAttribute('stroke-dasharray', '3 2');
    band.setAttribute('stroke-width', '0.8');
    const label = document.createElementNS(svgNs, 'text');
    const lx = s.dir === 'vertical' ? bx + bw / 2 : bx + 4;
    const ly = s.dir === 'horizontal' ? by + bh / 2 + 3 : by + 12;
    label.setAttribute('x', lx); label.setAttribute('y', ly);
    label.setAttribute('font-size', '10'); label.setAttribute('fill', '#7c2419');
    label.setAttribute('font-weight', '700');
    label.textContent = String(cutNo);
    g.appendChild(band); g.appendChild(label);
    bandEls.push({ step: s, band, label });
  });

  // 活动剩余矩形轮廓层（滑块驱动）
  const regionLayer = document.createElementNS(svgNs, 'g');
  g.appendChild(regionLayer);

  function render(states, t) {
    const st = states[t];
    regionLayer.innerHTML = '';
    st.regions.forEach((rg) => {
      const r = document.createElementNS(svgNs, 'rect');
      r.setAttribute('x', rg.x * scale); r.setAttribute('y', rg.y * scale);
      r.setAttribute('width', rg.width * scale); r.setAttribute('height', rg.height * scale);
      r.setAttribute('fill', 'none'); r.setAttribute('stroke', '#1b3350');
      r.setAttribute('stroke-width', '1.6'); r.setAttribute('stroke-dasharray', '6 3');
      regionLayer.appendChild(r);
    });
    patchEls.forEach((els, pi) => {
      const taken = st.removed.has(pi);
      els.r.setAttribute('fill-opacity', taken ? '0.12' : '0.7');
      els.pg.setAttribute('opacity', taken ? '0.55' : '1');
    });
    bandEls.forEach(({ step, band, label }) => {
      const active = st.band && st.band.dir === step.dir && st.band.at === step.at;
      band.setAttribute('fill-opacity', active ? '0.42' : '0.12');
      band.setAttribute('stroke-width', active ? '2' : '0.8');
      label.setAttribute('opacity', active ? '1' : '0.55');
    });
  }

  return { svg, render };
}

// ---------- 结论区 ----------

function renderResult() {
  const body = $('#result-body');
  const r = state.result;
  updateStaleBanner();

  if (!r) {
    body.innerHTML = '<p class="hint">尚未排版。</p>';
    return;
  }

  const out = r.output;
  if (!out.feasible) {
    body.innerHTML = renderInfeasible(out);
    return;
  }
  body.innerHTML = renderFeasible(out);
}

function renderFeasible(out) {
  const { objective, usage, alternatives } = out;
  const sheets = usage.map((u) => sheetSvg(u)).join('');
  const tables = out.candidateEvals.map((evs, pi) => {
    const p = state.draft.patches[pi];
    const chosen = out.assignment[pi];
    const rows = evs.map((ev, ci) => {
      const alt = alternatives[pi][ci];
      const isChosen = ci === chosen;
      const cls = isChosen ? 'chosen' : ev.compatible ? 'excluded' : 'incompat';
      const tag = altTag(alt, isChosen);
      const detail = isChosen
        ? `<span class="reason">采用。落于 <b>${canvasName(ev.canvasId)}</b> (${ev.rect.x},${ev.rect.y})，实际裁切 ${ev.rect.width}×${ev.rect.height}${ev.rotation === 'cw90' ? '（旋转 90°）' : ''}。</span>`
        : altDetail(p, pi, ci, ev, alt);
      return `<tr class="${cls}">
        <td>候选 ${ci + 1} ${tag}</td>
        <td>${escapeHtml(canvasName(ev.canvasId))}</td>
        <td>(${ev.rect ? ev.rect.x : '—'},${ev.rect ? ev.rect.y : '—'}) ${ev.rect ? `${ev.rect.width}×${ev.rect.height}` : ''} ${ROT_TEXT[ev.rotation] || ''}</td>
        <td>${detail}</td>
      </tr>`;
    }).join('');
    return `<div class="canvas-sheet">
      <h3>补片 ${pi + 1} · ${escapeHtml(p.name)}（${GRAIN_TEXT[p.grain]}，毛坯 ${p.width}×${p.height}）→ 采用候选 ${chosen + 1}</h3>
      <table class="detail-table">
        <thead><tr><th style="width:130px">候选</th><th style="width:120px">所属帆布</th><th style="width:180px">裁切矩形 / 旋转</th><th>采用与排除理由</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join('');

  return `
    <p class="verdict-ok">✔ 存在可行联合排版。</p>
    <div class="summary">
      <span class="metric">使用帆布 <b>${objective.canvasCount}</b> 张</span>
      <span class="metric">已用帆布剩余面积最大值 <b>${objective.maxRemaining}</b></span>
      <span class="metric">采用候选序号（按补片顺序）<b>[${objective.tuple.join(', ')}]</b></span>
    </div>
    ${sheets}
    <h3 style="color:var(--navy);margin-top:18px">采用与排除明细</h3>
    ${tables}`;
}

function renderInfeasible(out) {
  const { infeasible } = out;
  let head;
  if (infeasible.firstPatchIndex !== null && infeasible.firstPatchIndex !== undefined) {
    const pi = infeasible.firstPatchIndex;
    const p = state.draft.patches[pi];
    const reasons = out.candidateEvals[pi]
      .map((ev, ci) => `<li>候选 ${ci + 1}（${escapeHtml(canvasName(ev.canvasId))}）：${ev.compatible ? '意外可兼容' : escapeHtml(ev.reasons.join('；'))}</li>`)
      .join('');
    head = `
      <p class="verdict-bad">✘ 无可行排版。按补片录入顺序，首块不存在任何可兼容候选的是
        <b>补片 ${pi + 1} · ${escapeHtml(p.name)}</b>——它的全部候选都无法单独落位：</p>
      <ul>${reasons}</ul>
      <p class="reason">请先修改该补片或帆布草稿（放宽禁裁边、调整坐标/旋转、更换同纤维方向帆布），再重新排版。</p>`;
  } else {
    const top = infeasible.conflicts.slice(0, 12).map((cf) =>
      `<li>「${escapeHtml(state.draft.patches[cf.patchAIndex].name)}」候选 ${cf.candidateAIndex + 1} 与
        「${escapeHtml(state.draft.patches[cf.patchBIndex].name)}」候选 ${cf.candidateBIndex + 1}
        在 ${escapeHtml(canvasName(cf.canvasId))} 上正面积重叠 ${cf.overlapArea}</li>`).join('');
    head = `
      <p class="verdict-bad">✘ 每块补片都有可兼容候选，但候选之间的正面积冲突致使无法同时落位。</p>
      <p class="reason">检测到的候选对冲突（节选）：</p><ul>${top}</ul>
      <p class="reason">请增加候选位置或更换帆布后重新排版。</p>`;
  }

  // 即使无解也给出静态候选评估明细。
  const evals = out.candidateEvals.map((evs, pi) => {
    const p = state.draft.patches[pi];
    const rows = evs.map((ev, ci) => `<tr class="${ev.compatible ? '' : 'incompat'}">
      <td>候选 ${ci + 1}</td>
      <td>${escapeHtml(canvasName(ev.canvasId))}</td>
      <td>${ev.rect ? `(${ev.rect.x},${ev.rect.y}) ${ev.rect.width}×${ev.rect.height}` : '—'}</td>
      <td>${ev.compatible ? '<span class="reason">单看本候选可兼容，但联合落位时被冲突堵死。</span>' : `<span class="reason bad">${escapeHtml(ev.reasons.join('；'))}</span>`}</td>
    </tr>`).join('');
    return `<div class="canvas-sheet">
      <h3>补片 ${pi + 1} · ${escapeHtml(p.name)}</h3>
      <table class="detail-table"><thead><tr><th>候选</th><th>帆布</th><th>矩形</th><th>评估</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }).join('');

  return head + evals;
}

function altTag(alt, isChosen) {
  if (isChosen) return '<span class="tag chosen">采用</span>';
  switch (alt.kind) {
    case 'incompatible': return '<span class="tag incompatible">不可采用</span>';
    case 'blocks': return '<span class="tag blocks">强制则无解</span>';
    case 'dominated': return '<span class="tag dominated">可行但更差</span>';
    case 'equivalent': return '<span class="tag dominated">平局落选</span>';
    default: return '';
  }
}

function altDetail(p, pi, ci, ev, alt) {
  if (alt.kind === 'incompatible') {
    return `<span class="reason bad">${escapeHtml(alt.reasons.join('；'))}</span>`;
  }
  if (alt.kind === 'blocks') return `<span class="reason bad">${escapeHtml(alt.detail)}</span>`;
  if (alt.kind === 'dominated' || alt.kind === 'equivalent') {
    return `<span class="reason">${escapeHtml(alt.detail)}</span>`;
  }
  return '<span class="reason muted">未采用。</span>';
}

// ---------- SVG 帆布示意 ----------

function sheetSvg(u) {
  const pad = 14;
  const maxW = 520;
  const scale = Math.min(maxW / u.width, 3.6);
  const w = u.width * scale;
  const h = u.height * scale;
  const cut = u.cuttable;

  const placedRects = u.placed.map((pl, i) => {
    const color = PATCH_COLORS[pl.patchIndex % PATCH_COLORS.length];
    return `
      <rect x="${pl.rect.x * scale}" y="${pl.rect.y * scale}"
        width="${pl.rect.width * scale}" height="${pl.rect.height * scale}"
        fill="${color}" fill-opacity="0.72" stroke="${color}" stroke-width="1.5" />
      <text x="${pl.rect.x * scale + 4}" y="${pl.rect.y * scale + 15}"
        font-size="12" fill="#fff" font-weight="700">P${pl.patchIndex + 1}·#${pl.candidateIndex + 1}</text>`;
  }).join('');

  // 未采用但需提示的候选（虚线），从全局 alternatives 拿：这里只画采用布上被采用补片同布的落选候选
  const ghost = ghostRects(u, scale);

  const grainArrow = u.grain === 'warp'
    ? `<line x1="${w - 18}" y1="8" x2="${w - 18}" y2="34" stroke="#6b5c3c" stroke-width="1.4" marker-end="url(#arr)"/><text x="${w - 44}" y="26" font-size="10" fill="#6b5c3c">经</text>`
    : `<line x1="${w - 34}" y1="${h - 12}" x2="${w - 8}" y2="${h - 12}" stroke="#6b5c3c" stroke-width="1.4" marker-end="url(#arr)"/><text x="${w - 30}" y="${h - 18}" font-size="10" fill="#6b5c3c">纬</text>`;

  return `
  <div class="canvas-sheet ${u.inUse ? '' : 'idle'}">
    <h3>${escapeHtml(u.canvasName)}（${escapeHtml(u.canvasId)}）
      <span class="legend">${u.width}×${u.height}，${GRAIN_TEXT[u.grain]}，四边禁裁 ${u.margin}；
      ${u.inUse ? `已用 ${u.placed.length} 片共 ${u.used}，剩余 ${u.remaining}` : '本方案未使用（剩余 ' + u.remaining + '）'}</span>
    </h3>
    <div class="sheet-wrap">
      <svg class="sheet" width="${w + pad * 2}" height="${h + pad * 2}" viewBox="0 0 ${w + pad * 2} ${h + pad * 2}">
        <defs>
          <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#6b5c3c"/>
          </marker>
          <pattern id="hatch-${u.canvasId}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="#c9b586" stroke-width="2"/>
          </pattern>
        </defs>
        <g transform="translate(${pad},${pad})">
          <rect x="0" y="0" width="${w}" height="${h}" fill="#e9dfc6"/>
          <rect x="0" y="0" width="${w}" height="${h}" fill="url(#hatch-${u.canvasId})" opacity="0.55"/>
          <rect x="${cut.x * scale}" y="${cut.y * scale}" width="${cut.width * scale}" height="${cut.height * scale}"
            fill="#f8f2df" stroke="#8a7a50" stroke-dasharray="4 3"/>
          ${ghost}
          ${placedRects}
          ${grainArrow}
        </g>
      </svg>
    </div>
  </div>`;
}

function ghostRects(u, scale) {
  const r = state.result;
  if (!r || !r.output.feasible) return '';
  const out = r.output;
  let html = '';
  state.draft.patches.forEach((p, pi) => {
    if (out.assignment[pi] === undefined) return;
    p.candidates.forEach((cd, ci) => {
      if (ci === out.assignment[pi]) return;
      if (cd.canvasId !== u.canvasId) return;
      const ev = out.candidateEvals[pi][ci];
      if (!ev.rect) return;
      const alt = out.alternatives[pi][ci];
      if (alt.kind === 'incompatible') return; // 不兼容候选不画，避免噪声
      const dash = alt.kind === 'blocks' ? '#b03a2e' : '#9a6a08';
      html += `<rect x="${ev.rect.x * scale}" y="${ev.rect.y * scale}"
        width="${ev.rect.width * scale}" height="${ev.rect.height * scale}"
        fill="none" stroke="${dash}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    });
  });
  return html;
}

function canvasName(id) {
  const c = state.draft.canvases.find((x) => x.id === id);
  return c ? `${c.name}` : id;
}

function toInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---------- 全局渲染与事件 ----------

function renderAll() {
  renderCanvases();
  renderPatches();
  renderResult();
  renderCutResult();
  // 数量约束按钮可用性
  $('#btn-add-canvas').disabled = state.draft.canvases.length >= 3;
  $('#btn-add-patch').disabled = state.draft.patches.length >= 5;
}

function setStatus(text, cls = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = `status ${cls}`;
}

function showErrors(errors) {
  const box = $('#errors');
  box.textContent = ['草稿未通过校验：', ...errors].join('\n• ');
  box.classList.remove('hidden');
}

async function onSave() {
  try {
    const r = await api('/api/draft', { method: 'PUT', body: JSON.stringify({ draft: state.draft }) });
    state.version = r.version;
    state.result = null;
    state.resultVersion = null;
    state.cutResult = null;
    state.cutResultVersion = null;
    $('#errors').classList.add('hidden');
    renderResult();
    renderCutResult();
    setStatus('草稿已保存，旧排版与裁切复核结论均已失效', 'saved');
  } catch (e) {
    showErrors(e.errors || [e.message]);
    setStatus('保存被拒绝', 'error');
  }
}

async function onPlan() {
  setStatus('排版中…');
  try {
    // 先保存当前编辑（保证结论针对当前草稿版本），再求方案。
    const save = await api('/api/draft', { method: 'PUT', body: JSON.stringify({ draft: state.draft }) });
    state.version = save.version;
    // 保存使服务端旧裁切复核失效：保留页面展示但标记为旧结论（横幅提示重新复核）。
    if (state.cutResult) state.cutResultVersion = -1;
    const r = await api('/api/plan', { method: 'POST' });
    state.result = r.result;
    state.resultVersion = r.result.version;
    $('#errors').classList.add('hidden');
    renderResult();
    renderCutResult();
    setStatus(r.result.output.feasible ? `排版完成（草稿版本 v${r.version}）；如需裁切请重新复核` : '排版完成：无解', 'saved');
  } catch (e) {
    showErrors(e.errors || [e.message]);
    setStatus('无法排版：草稿未通过校验', 'error');
  }
}

async function onCutReview() {
  const kerf = Number.parseInt($('#inp-kerf').value, 10);
  if (!Number.isInteger(kerf) || kerf <= 0) {
    showErrors(['锯缝宽度须为正整数。']);
    setStatus('复核被拒绝：锯缝宽度非法', 'error');
    return;
  }
  state.kerf = kerf;
  setStatus('裁切复核中（先重新联合排版）…');
  try {
    // 先保存当前草稿（服务端版本推进），再发起复核；
    // 采用结果由服务端按当前草稿重新排版产生，页面不上传任何采用结果。
    const save = await api('/api/draft', { method: 'PUT', body: JSON.stringify({ draft: state.draft }) });
    state.version = save.version;
    const r = await api('/api/cut-review', { method: 'POST', body: JSON.stringify({ kerf }) });
    state.cutResult = r.cutResult;
    state.cutResultVersion = r.cutResult.version;
    // 复核内部重排的结果同步为当前排版结论（同一草稿版本）。
    state.result = { version: r.cutResult.version, output: r.cutResult.plan };
    state.resultVersion = r.cutResult.version;
    $('#errors').classList.add('hidden');
    renderResult();
    renderCutResult();
    const ok = r.cutResult.review && r.cutResult.review.feasible;
    setStatus(ok
      ? `裁切复核完成：共 ${r.cutResult.review.totalCuts} 刀（锯缝 ${kerf}，草稿 v${r.version}）`
      : (r.cutResult.review ? '裁切复核完成：存在锯缝阻断' : '草稿无解，无法复核'), 'saved');
  } catch (e) {
    showErrors(e.errors || [e.message]);
    setStatus('无法复核：请求被拒绝', 'error');
  }
}

async function onReset() {
  const r = await api('/api/reset', { method: 'POST' });
  state.draft = r.draft;
  state.version = r.version;
  state.result = null;
  state.resultVersion = null;
  state.cutResult = null;
  state.cutResultVersion = null;
  state.kerf = 2;
  $('#inp-kerf').value = 2;
  $('#errors').classList.add('hidden');
  renderAll();
  setStatus('已恢复内置示例草稿', 'saved');
}

$('#btn-plan').addEventListener('click', onPlan);
$('#btn-save').addEventListener('click', onSave);
$('#btn-reset').addEventListener('click', onReset);
$('#btn-cut-review').addEventListener('click', onCutReview);
$('#inp-kerf').addEventListener('change', () => {
  markCutDirty();
});

load().catch((e) => {
  $('#result-body').innerHTML = `<p class="verdict-bad">加载草稿失败：${escapeHtml(e.message)}</p>`;
});
