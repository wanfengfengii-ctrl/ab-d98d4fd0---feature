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
  review: null, // { version, kerf, output } 锯缝裁切复核结论
  reviewVersion: null, // 当前页面上展示的复核结论对应的草稿版本
  dirty: false, // 录入区是否有未保存到服务端的修改
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
  state.review = r.cutReview || null;
  state.reviewVersion = state.review ? state.review.version : null;
  if (state.review) $('#kerf-input').value = state.review.kerf;
  renderAll();
}

function markDirty() {
  // 任何录入变更都使旧结论在 UI 上立即失效（保存后服务端版本推进）。
  state.dirty = true;
  if (state.result) {
    state.resultVersion = -1;
    renderResult();
  }
  if (state.review) {
    state.reviewVersion = -1;
    renderReview();
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

// ---------- 结论区 ----------

function renderResult() {
  const body = $('#result-body');
  const banner = $('#stale-banner');
  const r = state.result;

  if (!r) {
    banner.classList.add('hidden');
    body.innerHTML = '<p class="hint">尚未排版。</p>';
    return;
  }

  const stale = r.version !== state.version || state.resultVersion === -1;
  banner.classList.toggle('hidden', !stale);

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

// ---------- 裁切复核区 ----------

function currentKerf() {
  const n = Number($('#kerf-input').value);
  return Number.isInteger(n) ? n : NaN;
}

function patchName(pi) {
  const p = state.draft && state.draft.patches[pi];
  return p ? p.name : `P${pi + 1}`;
}

function renderReview() {
  const body = $('#review-body');
  const banner = $('#review-stale');
  const rv = state.review;

  if (!rv) {
    banner.classList.add('hidden');
    body.innerHTML = '<p class="hint">尚未复核。填写正整数锯缝宽度后点击「复核裁切顺序」。</p>';
    return;
  }

  // 草稿版本推进、录入变脏、或锯缝宽度与已复核值不一致 → 旧复核结论失效。
  const stale = state.reviewVersion === -1 || rv.version !== state.version || rv.kerf !== currentKerf();
  banner.classList.toggle('hidden', !stale);
  body.innerHTML = renderReviewOutput(rv.output, rv.kerf);
}

function renderReviewOutput(out, kerf) {
  if (out.stage === 'layout') {
    const lay = out.layout;
    const why = lay.firstPatchIndex !== null && lay.firstPatchIndex !== undefined
      ? `首块无兼容候选的是补片 ${lay.firstPatchIndex + 1} · ${escapeHtml(patchName(lay.firstPatchIndex))}`
      : `候选间存在 ${lay.conflictCount} 处正面积冲突`;
    return `
      <p class="verdict-bad">✘ 按当前草稿重新执行的联合排版无解（${why}），无法进行裁切复核。</p>
      <p class="reason">请先调整草稿使联合排版有解，再重新发起复核。</p>`;
  }

  const layInfo = `
    <p class="reason">复核已按当前草稿<strong>重新执行联合排版</strong>（未采用页面上传的旧结论）：
      采用候选序号 <b>[${out.layout.tuple.join(', ')}]</b>，使用帆布 <b>${out.layout.canvasCount}</b> 张，
      已用帆布剩余面积最大值 <b>${out.layout.maxRemaining}</b>；锯缝宽度 <b>${kerf}</b>。</p>`;
  const sections = out.canvases.map((c) => renderReviewCanvas(c, kerf)).join('');

  if (!out.feasible) {
    const b = out.blockage;
    const others = b.trapped.filter((pi) => pi !== b.firstPieceIndex)
      .map((pi) => `补片 ${pi + 1}·${escapeHtml(patchName(pi))}`).join('、');
    return `
      <p class="verdict-bad">✘ 无法裁切。按帆布和步骤顺序，首个被锯缝阻断的裁片是
        <b>补片 ${b.firstPieceIndex + 1} · ${escapeHtml(patchName(b.firstPieceIndex))}</b>
        （${escapeHtml(canvasName(b.canvasId))}，第 ${b.stepsBefore} 刀后的剩余区域，
        与 ${others} 互相卡住）。</p>
      ${layInfo}${sections}`;
  }

  return `
    <p class="verdict-ok">✔ 全部帆布均可按贯穿直线依次切下，总刀数 <b>${out.totalCuts}</b>。</p>
    ${layInfo}${sections}`;
}

function renderReviewCanvas(c, kerf) {
  const canvas = state.draft.canvases[c.canvasIndex];
  const title = `${escapeHtml(canvas ? canvas.name : c.canvasId)}（${escapeHtml(c.canvasId)}）`;

  if (c.pieces.length === 0) {
    return `<div class="canvas-sheet idle"><h3>${title}<span class="legend">本方案未使用，无需裁切。</span></h3></div>`;
  }

  if (!c.feasible) {
    const b = c.blockage;
    const r = b.region;
    const trapped = b.trapped.slice().sort((x, y) => x - y)
      .map((pi) => `P${pi + 1}·${escapeHtml(patchName(pi))}`).join('、');
    const stepsHtml = c.steps.map((s) => reviewStepPanel(c, s, kerf)).join('');
    return `<div class="canvas-sheet">
      <h3>${title}<span class="legend bad-legend">✘ 第 ${b.stepsBefore} 刀后在剩余区域
        (${r.x},${r.y})–(${r.x + r.width},${r.y + r.height}) 被锯缝卡死：${trapped}</span></h3>
      ${overviewSvg(c)}
      ${stepsHtml}
      ${blockagePanel(c, kerf)}
    </div>`;
  }

  const seq = c.sequence.length
    ? c.sequence.map((s) => `${s.dir === 'h' ? '横' : '竖'}@${s.coord}`).join(' → ')
    : '（无需贯穿裁切）';
  const stepsHtml = c.steps.map((s) => reviewStepPanel(c, s, kerf)).join('');
  const offOrder = c.takenOff.map((t) => (t.atStep === 0
    ? `P${t.patchIndex + 1}（初始单裁片，直接取下）`
    : `P${t.patchIndex + 1}（第 ${t.atStep} 刀后）`)).join('；');
  return `<div class="canvas-sheet">
    <h3>${title}<span class="legend">采用 ${c.pieces.length} 片，共 ${c.totalCuts} 刀；切线序列：${seq}</span></h3>
    ${overviewSvg(c)}
    ${stepsHtml}
    <p class="reason">取下顺序：${offOrder}。</p>
  </div>`;
}

const DIR_LABEL = { h: '横切', v: '竖切' };
const AXIS_LABEL = { h: 'y', v: 'x' };

function reviewStepPanel(c, s, kerf) {
  const axis = AXIS_LABEL[s.dir];
  const rb = s.regionBefore;
  const afterText = s.after.map((a, i) => {
    const piecesText = a.pieces.length ? a.pieces.map((pi) => `P${pi + 1}`).join('、') : '无裁片';
    const fateText = a.fate === 'waste'
      ? '废料，停止处理'
      : a.fate === 'taken'
        ? `单裁片 ${piecesText}，取下`
        : `含 ${piecesText}，继续裁切`;
    return `区域${'①②'[i]} (${a.region.x},${a.region.y})–(${a.region.x + a.region.width},${a.region.y + a.region.height})：${fateText}`;
  }).join('；');
  const takenText = s.takenOff.length
    ? `本刀取下：${s.takenOff.map((pi) => `P${pi + 1}·${escapeHtml(patchName(pi))}`).join('、')}。`
    : '';
  return `<div class="cut-step">
    ${cutStepSvg(c, s)}
    <div class="cut-caption">
      <b>第 ${s.n} 刀</b>：在剩余矩形 (${rb.x},${rb.y})–(${rb.x + rb.width},${rb.y + rb.height}) 内
      ${DIR_LABEL[s.dir]} ${axis}=${s.coord}，锯缝带 ${axis}∈[${s.coord}, ${s.coord + kerf}]（宽 ${kerf}）。<br/>
      切后：${afterText}。${takenText}
    </div>
  </div>`;
}

function clampRect(r, bounds) {
  const x = Math.max(r.x, bounds.x);
  const y = Math.max(r.y, bounds.y);
  const x2 = Math.min(r.x + r.width, bounds.x + bounds.width);
  const y2 = Math.min(r.y + r.height, bounds.y + bounds.height);
  return { x, y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) };
}

function reviewScale(c) {
  const canvas = state.draft.canvases[c.canvasIndex];
  const w = canvas ? canvas.width : 100;
  return Math.min(300 / w, 3.2);
}

function canvasDims(c) {
  const canvas = state.draft.canvases[c.canvasIndex];
  return {
    width: canvas ? canvas.width : c.cuttable.width + 2 * c.cuttable.x,
    height: canvas ? canvas.height : c.cuttable.height + 2 * c.cuttable.y,
  };
}

function pieceSvgRects(c, takenSet, scale, trappedSet) {
  return c.pieces.map((p) => {
    const isTaken = takenSet.has(p.patchIndex);
    const isTrapped = trappedSet && trappedSet.has(p.patchIndex);
    const color = isTrapped ? '#b03a2e' : PATCH_COLORS[p.patchIndex % PATCH_COLORS.length];
    const opacity = isTaken ? 0.16 : isTrapped ? 0.8 : 0.72;
    return `
      <rect x="${p.rect.x * scale}" y="${p.rect.y * scale}"
        width="${p.rect.width * scale}" height="${p.rect.height * scale}"
        fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="1.2"
        ${isTaken ? 'stroke-dasharray="3 3"' : ''}/>
      <text x="${p.rect.x * scale + 3}" y="${p.rect.y * scale + 13}" font-size="11"
        fill="${isTaken ? '#7c7568' : '#fff'}" font-weight="700">P${p.patchIndex + 1}${isTaken ? ' ✓' : ''}</text>`;
  }).join('');
}

function sheetFrame(c, inner, scale) {
  const dims = canvasDims(c);
  const pad = 12;
  const w = dims.width * scale;
  const h = dims.height * scale;
  const cut = c.cuttable;
  return `<svg class="sheet cut" width="${w + pad * 2}" height="${h + pad * 2}" viewBox="0 0 ${w + pad * 2} ${h + pad * 2}">
    <g transform="translate(${pad},${pad})">
      <rect x="0" y="0" width="${w}" height="${h}" fill="#e9dfc6"/>
      <rect x="${cut.x * scale}" y="${cut.y * scale}" width="${cut.width * scale}" height="${cut.height * scale}"
        fill="#f8f2df" stroke="#8a7a50" stroke-dasharray="4 3"/>
      ${inner}
    </g>
  </svg>`;
}

/** 帆布总览（落刀前）：可裁区 + 全部采用裁片。 */
function overviewSvg(c) {
  const scale = reviewScale(c);
  const inner = pieceSvgRects(c, new Set(), scale, null);
  return `<div class="cut-step"><div class="cut-caption"><b>落刀前</b>：可裁区域
    (${c.cuttable.x},${c.cuttable.y})–(${c.cuttable.x + c.cuttable.width},${c.cuttable.y + c.cuttable.height})，
    采用裁片 ${c.pieces.map((p) => `P${p.patchIndex + 1}`).join('、')}。</div>${sheetFrame(c, inner, scale)}</div>`;
}

/** 每刀前的剩余区域（虚线）、本刀目标区域与锯缝带（红）。 */
function cutStepSvg(c, s) {
  const scale = reviewScale(c);
  const liveRects = s.liveBefore.map((r) =>
    `<rect x="${r.region.x * scale}" y="${r.region.y * scale}" width="${r.region.width * scale}" height="${r.region.height * scale}"
      fill="none" stroke="#1f6aa5" stroke-width="1.1" stroke-dasharray="5 3"/>`).join('');
  const pieces = pieceSvgRects(c, new Set(s.takenOffBefore), scale, null);
  const rb = s.regionBefore;
  const band = clampRect(s.band, rb);
  const target = `<rect x="${rb.x * scale}" y="${rb.y * scale}" width="${rb.width * scale}" height="${rb.height * scale}"
      fill="none" stroke="#b03a2e" stroke-width="1.6"/>
    <rect x="${band.x * scale}" y="${band.y * scale}"
      width="${Math.max(band.width * scale, 1.5)}" height="${Math.max(band.height * scale, 1.5)}"
      fill="#b03a2e" fill-opacity="0.45" stroke="#b03a2e" stroke-width="1"/>`;
  return sheetFrame(c, liveRects + pieces + target, scale);
}

/** 卡死区域示意 + 全部候选切线的阻断证据表。 */
function blockagePanel(c, kerf) {
  const b = c.blockage;
  const r = b.region;
  const scale = reviewScale(c);
  const trappedSet = new Set(b.trapped);
  const liveRects = b.liveAtBlock.map((g) =>
    `<rect x="${g.region.x * scale}" y="${g.region.y * scale}" width="${g.region.width * scale}" height="${g.region.height * scale}"
      fill="none" stroke="#1f6aa5" stroke-width="1.1" stroke-dasharray="5 3"/>`).join('');
  const pieces = pieceSvgRects(c, new Set(b.takenOffAtBlock.map((t) => t.patchIndex)), scale, trappedSet);
  const attemptBands = b.attempts.map((a) => {
    const band = clampRect(a.band, r);
    return `<rect x="${band.x * scale}" y="${band.y * scale}"
      width="${Math.max(band.width * scale, 1)}" height="${Math.max(band.height * scale, 1)}"
      fill="#b03a2e" fill-opacity="0.14" stroke="#b03a2e" stroke-width="0.8" stroke-dasharray="3 2"/>`;
  }).join('');
  const deadlockRect = `<rect x="${r.x * scale}" y="${r.y * scale}" width="${r.width * scale}" height="${r.height * scale}"
      fill="none" stroke="#b03a2e" stroke-width="2"/>`;
  const svg = sheetFrame(c, liveRects + pieces + attemptBands + deadlockRect, scale);

  const rows = b.attempts.map((a) => {
    const axis = AXIS_LABEL[a.dir];
    const verdict = a.blockedBy.length > 0
      ? `<span class="reason bad">锯缝带与 ${a.blockedBy.map((e) =>
        `P${e.patchIndex + 1}·${escapeHtml(patchName(e.patchIndex))} 正面积相交 ${e.overlapArea}`).join('、')}</span>`
      : '<span class="reason muted">一侧无裁片，不能切分（非锯缝原因）</span>';
    return `<tr><td>${DIR_LABEL[a.dir]} ${axis}=${a.coord}</td>
      <td>${axis}∈[${a.coord}, ${a.coord + kerf}]</td><td>${verdict}</td></tr>`;
  }).join('');

  return `<div class="cut-step blocked">
    ${svg}
    <div class="cut-caption">
      <b>卡死区域</b>：剩余矩形 (${r.x},${r.y})–(${r.x + r.width},${r.y + r.height}) 内
      ${b.trapped.slice().sort((x, y) => x - y).map((pi) => `P${pi + 1}·${escapeHtml(patchName(pi))}`).join('、')}
      互相卡住——该区域全部候选切线的锯缝带均与采用裁片正面积相交（或不能切分），无法继续落刀：
      <table class="detail-table">
        <thead><tr><th style="width:110px">候选切线</th><th style="width:120px">锯缝带</th><th>判定（正面积相交证据）</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
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
  renderReview();
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
    state.review = null;
    state.reviewVersion = null;
    state.dirty = false;
    $('#errors').classList.add('hidden');
    renderResult();
    renderReview();
    setStatus('草稿已保存，旧排版与复核结论已失效', 'saved');
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
    const r = await api('/api/plan', { method: 'POST' });
    state.result = r.result;
    state.resultVersion = r.result.version;
    state.review = null; // 草稿版本已推进，旧复核结论失效
    state.reviewVersion = null;
    state.dirty = false;
    $('#errors').classList.add('hidden');
    renderResult();
    renderReview();
    setStatus(r.result.output.feasible ? `排版完成（草稿版本 v${r.version}）` : '排版完成：无解', 'saved');
  } catch (e) {
    showErrors(e.errors || [e.message]);
    setStatus('无法排版：草稿未通过校验', 'error');
  }
}

async function onReview() {
  const kerf = currentKerf();
  if (!Number.isInteger(kerf) || kerf < 1) {
    setStatus('锯缝宽度须为正整数', 'error');
    $('#review-body').innerHTML = '<p class="verdict-bad">锯缝宽度须为正整数（像素）。</p>';
    return;
  }
  setStatus('裁切复核中…');
  try {
    if (state.dirty) {
      // 有未保存修改：先保存（版本推进、旧结论失效），并重跑排版保持结论区有效。
      const save = await api('/api/draft', { method: 'PUT', body: JSON.stringify({ draft: state.draft }) });
      state.version = save.version;
      const plan = await api('/api/plan', { method: 'POST' });
      state.result = plan.result;
      state.resultVersion = plan.result.version;
      state.dirty = false;
      renderResult();
    }
    // 复核在服务端按当前草稿重新执行联合排版（不接收页面上传的采用结果）。
    const r = await api('/api/cut-review', { method: 'POST', body: JSON.stringify({ kerf }) });
    state.review = r.review;
    state.reviewVersion = r.review.version;
    $('#errors').classList.add('hidden');
    renderReview();
    const out = r.review.output;
    setStatus(out.feasible
      ? `复核完成：全部可裁，总刀数 ${out.totalCuts}（v${r.version}，锯缝 ${r.review.kerf}）`
      : '复核完成：存在被锯缝阻断的裁片', out.feasible ? 'saved' : 'error');
  } catch (e) {
    showErrors(e.errors || [e.message]);
    setStatus('无法复核：草稿未通过校验或锯缝宽度非法', 'error');
  }
}

async function onReset() {
  const r = await api('/api/reset', { method: 'POST' });
  state.draft = r.draft;
  state.version = r.version;
  state.result = null;
  state.resultVersion = null;
  state.review = null;
  state.reviewVersion = null;
  state.dirty = false;
  $('#errors').classList.add('hidden');
  renderAll();
  setStatus('已恢复内置示例草稿', 'saved');
}

$('#btn-plan').addEventListener('click', onPlan);
$('#btn-save').addEventListener('click', onSave);
$('#btn-reset').addEventListener('click', onReset);
$('#btn-review').addEventListener('click', onReview);
// 锯缝宽度变更 → 旧复核结论立即失效（仅影响复核区，不影响排版结论）。
$('#kerf-input').addEventListener('change', () => {
  if (state.review) renderReview();
});

load().catch((e) => {
  $('#result-body').innerHTML = `<p class="verdict-bad">加载草稿失败：${escapeHtml(e.message)}</p>`;
});
