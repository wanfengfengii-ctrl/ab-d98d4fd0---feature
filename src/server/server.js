import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { validateDraft, validateKerf } from '../core/validation.js';
import { planLayout } from '../core/planner.js';
import { reviewCutting } from '../core/cutting.js';
import { defaultDraft } from './defaultDraft.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // 内存中的“草稿 + 结论”。结论仅对生成它的草稿版本有效（version 单调递增）。
  let currentVersion = 0;
  let draft = structuredClone(defaultDraft);
  let result = null; // { version, output }
  let cutResult = null; // { version, kerf, plan, review }

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', version: currentVersion });
  });

  app.get('/api/draft', (_req, res) => {
    res.json({ version: currentVersion, draft, result, cutResult });
  });

  // 保存草稿（任何修改都会使旧结论失效）。
  app.put('/api/draft', (req, res) => {
    const incoming = req.body && req.body.draft ? req.body.draft : null;
    const check = validateDraft(incoming);
    if (!check.ok) {
      return res.status(400).json({ ok: false, errors: check.errors });
    }
    currentVersion += 1;
    draft = incoming;
    result = null;    // 旧排版结论随草稿修改立即失效
    cutResult = null; // 旧裁切复核结论同样失效
    return res.json({ ok: true, version: currentVersion });
  });

  // 恢复内置示例草稿（同样使旧结论失效）。
  app.post('/api/reset', (_req, res) => {
    currentVersion += 1;
    draft = structuredClone(defaultDraft);
    result = null;
    cutResult = null;
    res.json({ ok: true, version: currentVersion, draft });
  });

  // 运行联合排版；结论与当前草稿版本绑定。
  app.post('/api/plan', (req, res) => {
    const output = planLayout(draft);
    result = { version: currentVersion, output };
    res.json({ ok: true, version: currentVersion, result });
  });

  // 直线裁切顺序复核。
  // 必须先按当前草稿重新执行联合排版取得“采用裁片”，不接收页面上传的采用结果；
  // 请求体仅提供正整数锯缝宽度 kerf。
  app.post('/api/cut-review', (req, res) => {
    const kerf = req.body && req.body.kerf;
    const kerfCheck = validateKerf(kerf);
    if (!kerfCheck.ok) {
      return res.status(400).json({ ok: false, errors: kerfCheck.errors });
    }
    // 无论如何先重新跑联合排版，采用结果一律以服务端当前草稿为准。
    const plan = planLayout(draft);
    if (!plan.feasible) {
      cutResult = { version: currentVersion, kerf, plan, review: null };
      return res.json({ ok: true, version: currentVersion, cutResult });
    }
    const review = reviewCutting(draft, plan, kerf);
    cutResult = { version: currentVersion, kerf, plan, review };
    return res.json({ ok: true, version: currentVersion, cutResult });
  });

  const distDir = path.join(root, 'dist');
  const webDir = path.join(root, 'web');
  const staticDir = existsSync(distDir) ? distDir : webDir;
  app.use(express.static(staticDir));
  app.get('/', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createApp().listen(PORT, HOST, () => {
    console.log(`[web] 帆布排版工作台已启动：http://${HOST}:${PORT}（静态资源目录：${existsSync(path.join(root, 'dist')) ? 'dist' : 'web'}）`);
  });

  const shutdown = (sig) => {
    console.log(`[web] 收到 ${sig}，关闭中…`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
