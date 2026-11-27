(function (global) {
  'use strict';

  const EDITOR_TITLES = {
    guidance: '导向标识编辑器',
    transfer: '换乘标识编辑器',
    platform: '站台标识编辑器',
  };

  function ensureOverlay(editor) {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      document.body.prepend(overlay);
    }
    if (!overlay.querySelector('.loading-card')) {
      overlay.innerHTML = `
        <div class="loading-card" role="status" aria-live="polite">
          <div class="loading-header">
            <div class="loading-identity">
              <span class="loading-dot" aria-hidden="true"></span>
              <strong class="loading-title"></strong>
            </div>
            <span class="loading-percent" id="loading-percent">0%</span>
          </div>
          <div class="loading-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-labelledby="loading-text">
            <div class="loading-bar" id="loading-bar"></div>
          </div>
          <p class="loading-summary" id="loading-text">正在准备编辑环境…</p>
          <ul class="loading-stages" id="loading-stages" aria-label="加载详情"></ul>
        </div>`;
    }
    const title = overlay.querySelector('.loading-title');
    if (title) title.textContent = EDITOR_TITLES[editor] || 'CRT标识编辑器';
    return overlay;
  }

  function createSession(options = {}) {
    const editor = options.editor || document.body?.dataset.editor || 'guidance';
    const stages = (options.stages || []).map(stage => ({
      id: stage.id,
      label: stage.label,
      weight: stage.weight ?? 1,
      progress: 0,
      status: 'pending',
      detail: stage.detail || '等待中',
    }));

    const overlay = ensureOverlay(editor);
    const bar = overlay.querySelector('#loading-bar');
    const track = overlay.querySelector('.loading-track');
    const percentNode = overlay.querySelector('#loading-percent');
    const summaryNode = overlay.querySelector('#loading-text');
    const list = overlay.querySelector('#loading-stages');
    const stageElements = new Map();
    let hidden = false;
    let hideTimer = 0;

    list.replaceChildren();
    for (const stage of stages) {
      const item = document.createElement('li');
      item.className = 'loading-stage';
      item.dataset.stageId = stage.id;
      item.dataset.stageState = stage.status;
      const indicator = document.createElement('span');
      indicator.className = 'loading-stage-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'loading-stage-name';
      name.textContent = stage.label;
      const detail = document.createElement('span');
      detail.className = 'loading-stage-detail';
      detail.textContent = stage.detail;
      item.append(indicator, name, detail);
      list.append(item);
      stageElements.set(stage.id, { item, detail });
    }

    function totalPercent() {
      const totalWeight = stages.reduce((sum, item) => sum + item.weight, 0) || 1;
      const weighted = stages.reduce((sum, item) => sum + item.weight * Math.max(0, Math.min(1, item.progress)), 0);
      return Math.round((weighted / totalWeight) * 100);
    }

    function renderProgress(summary) {
      const percent = totalPercent();
      if (bar) bar.style.width = percent + '%';
      if (track) track.setAttribute('aria-valuenow', String(percent));
      if (percentNode) percentNode.textContent = percent + '%';
      if (summary && summaryNode) summaryNode.textContent = summary;
      overlay.dataset.progress = String(percent);
    }

    function show(summary) {
      hidden = false;
      clearTimeout(hideTimer);
      overlay.classList.remove('loading-leaving');
      overlay.hidden = false;
      renderProgress(summary);
    }

    function setStage(id, status, progress, detail, summary) {
      const stage = stages.find(item => item.id === id);
      if (!stage) {
        if (summary && summaryNode) summaryNode.textContent = summary;
        return;
      }
      stage.status = status;
      if (typeof progress === 'number') stage.progress = Math.max(0, Math.min(1, progress));
      if (detail !== undefined) stage.detail = detail;
      const nodes = stageElements.get(id);
      if (nodes) {
        nodes.item.dataset.stageState = stage.status;
        nodes.detail.textContent = stage.detail;
      }
      renderProgress(summary);
    }

    function setSummary(summary) {
      if (summaryNode) summaryNode.textContent = summary;
    }

    function finish(summary = '准备就绪') {
      if (hidden) return;
      hidden = true;
      for (const stage of stages) {
        if (stage.status !== 'warning') {
          stage.status = 'done';
          stage.progress = 1;
          const nodes = stageElements.get(stage.id);
          if (nodes) {
            nodes.item.dataset.stageState = 'done';
            if (nodes.detail.textContent === '等待中') nodes.detail.textContent = '已完成';
          }
        }
      }
      renderProgress(summary);
      const duration = global.EditorMotion?.timing(overlay, 'dismiss').duration || 0;
      if (!duration) {
        overlay.hidden = true;
        return;
      }
      overlay.classList.add('loading-leaving');
      hideTimer = global.setTimeout(() => {
        if (!hidden) return;
        overlay.hidden = true;
        overlay.classList.remove('loading-leaving');
      }, Math.min(duration + 60, 420));
    }

    async function loadFonts(specs, options = {}) {
      const sampleText = options.sampleText;
      const timeoutMs = options.timeoutMs ?? 12000;
      const slowHintMs = options.slowHintMs ?? 4500;
      const retries = options.retries ?? 2;
      const stageId = options.stageId || 'fonts';
      const total = specs.length || 1;
      let settled = 0;
      let failed = 0;
      let timedOut = false;

      const labels = {
        zh400: 'MiSans 常规',
        zh600: 'MiSans 中粗',
        zh700: 'MiSans 粗体',
        num400: 'Frutiger 编号',
      };

      setStage(stageId, 'active', 0, `0 / ${total}`, '正在加载标识牌字体…');

      if (global.SignFontManager && typeof global.SignFontManager.restoreLocalFonts === 'function') {
        await global.SignFontManager.restoreLocalFonts().catch(() => {});
      }

      const slowHint = global.setTimeout(() => {
        if (!hidden && settled < total) {
          setSummary('字体加载较慢，仍在重试…（也可在「设置」导入本机字体）');
        }
      }, slowHintMs);

      function loadSpecWithRetry(spec, maxRetries) {
        const text = spec.sampleText !== undefined ? spec.sampleText : sampleText;
        let attempt = 0;
        function run() {
          attempt += 1;
          const loader = text
            ? document.fonts.load(spec.css, text)
            : document.fonts.load(spec.css);
          return loader.then(faces => {
            if (Array.isArray(faces) && faces.length > 0) return true;
            if (document.fonts.check(spec.css, text || ' ')) return true;
            throw new Error('empty font load result');
          }).catch(() => {
            if (attempt > maxRetries) return false;
            return new Promise(resolve => global.setTimeout(resolve, 600 * attempt)).then(run);
          });
        }
        return run();
      }

      const tasks = specs.map(spec => {
        const name = spec.label || labels[spec.key] || spec.css;
        return loadSpecWithRetry(spec, retries).then(ok => {
          settled += 1;
          if (!ok) failed += 1;
          if (!timedOut) {
            const state = settled === total ? (failed ? 'warning' : 'done') : 'active';
            const detail = settled === total
              ? (failed ? `已加载 ${total - failed}/${total}（后台继续重试）` : `${total} / ${total} 已就绪`)
              : `${settled} / ${total} · ${name}`;
            const summary = settled === total
              ? (failed ? '部分字体暂未就绪，将在后台继续重试' : '标识牌字体已全部就绪')
              : `正在加载字体（${settled}/${total}）：${name}`;
            setStage(stageId, state, settled / total, detail, summary);
          }
          return ok;
        });
      });

      const all = Promise.all(tasks).then(results => results.every(Boolean));
      const timeout = new Promise(resolve => {
        global.setTimeout(() => {
          timedOut = true;
          resolve(false);
        }, timeoutMs);
      });

      const ready = await Promise.race([all, timeout]);
      global.clearTimeout(slowHint);
      if (timedOut) {
        setStage(stageId, 'warning', 1, '已先进入编辑器，后台继续加载', '字体加载较慢，已先打开编辑器并在后台继续加载');
      }
      if (!ready) {
        // 超时或首轮失败时不放弃，在后台再做一次静默重试，就绪后触发重排。
        all.then(completed => {
          if (completed) {
            global.SignFontManager?.notifyFontsUpdated({ reason: 'background-ready' });
            if (typeof options.onLateReady === 'function') options.onLateReady();
            return;
          }
          global.setTimeout(() => {
            Promise.all(specs.map(spec => loadSpecWithRetry(spec, 1))).then(results => {
              if (results.some(Boolean)) {
                global.SignFontManager?.notifyFontsUpdated({ reason: 'background-retry-ready' });
                if (typeof options.onLateReady === 'function') options.onLateReady();
              }
            });
          }, 2000);
        });
      }
      return ready;
    }

    show();
    return { overlay, show, setStage, setSummary, finish, loadFonts };
  }

  global.EditorLoader = { createSession };
})(typeof window !== 'undefined' ? window : globalThis);
