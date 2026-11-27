/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * main.js — 启动装配
 *
 * 字体、项目和编辑器启动。
 */
(function (global) {
  'use strict';

  var FONT_TIMEOUT_MS = 30000;   // 字体面加载的兑底放行时限
  var FONT_SLOW_HINT_MS = 8000;  // 超过此时长更新提示文案

  function wireStaticButtons() {
    document.getElementById('guidance-undo').addEventListener('click', App.undo);
    document.getElementById('guidance-redo').addEventListener('click', App.redo);
    document.getElementById('close-element-btn').addEventListener('click', function () {
      if (App.presetPreviewId) App.previewPreset(null);
      else App.select(null);
      document.getElementById('right-panel-title').focus({ preventScroll: true });
    });

    App.previewZoom = PreviewZoom.create({
      viewport: document.getElementById('canvas-scroll'),
      stage: document.getElementById('canvas-area'),
      paper: document.getElementById('canvas-wrap'),
      graphic: document.getElementById('sign-svg'),
      controls: document.getElementById('guidance-zoom'),
      addRow: document.getElementById('add-row-btn'),
      onChange: SignInteract.positionElementToolbar,
    });
  }

  function boot() {
    if (document.getElementById('app').hidden) return;
    var loader = global.EditorLoader.createSession({
      editor: 'guidance',
      stages: [
        { id: 'fonts', label: '标识牌字体', weight: 65, detail: '等待中' },
        { id: 'projects', label: '本地项目与存档', weight: 20, detail: '等待中' },
        { id: 'workspace', label: '排版与元素库', weight: 15, detail: '等待中' },
      ],
    });

    App.ready = loader.loadFonts(SignCore.FONT_LOAD_SPECS, {
      timeoutMs: FONT_TIMEOUT_MS,
      slowHintMs: FONT_SLOW_HINT_MS,
      stageId: 'fonts',
    }).then(async function (fontsReady) {
      loader.setStage('projects', 'active', 0.25, '读取偏好与存档', '正在读取本地项目…');
      App.state = SignStorage.loadAutosave() || SignState.createSign();
      App.prefs = SignStorage.loadPrefs();

      function serializeProject() { return SignState.serializeSign(App.state); }
      App.exportProject = function () {
        SignStorage.exportProject(serializeProject, 'sign-project-' + SignStorage.timestamp() + '.json', SignUI.toast);
      };
      const library = SignProjects.createLibrary({
        databaseName: 'public-guidance-projects',
        legacyKey: SignStorage.AUTOSAVE_KEY,
        legacyName: '原有导向项目',
        createDefault: SignState.createSign,
        serialize: SignState.serializeSign,
        deserialize: SignState.deserializeSign,
        projectMigration: {
          key: 'legacy-guidance-presets-v1',
          apply: SignPresets.migrateLegacy,
          onError: () => SignUI.toast('旧版预设暂未迁入，原数据仍在浏览器中', 'warning'),
        },
        describe: state => ({
          rowCount: state.rows.length,
          elementCount: state.rows.reduce((count, row) => count + row.elements.length, 0),
          presetCount: state.presets?.length || 0,
        }),
      });

      SignInteract.init();
      SignClipboard.init();
      wireStaticButtons();
      App.autosave = SignProjectDialog.init(App, {
        library,
        editor: 'guidance',
        graphic: document.getElementById('sign-svg'),
        fileInput: document.getElementById('guidance-project-file'),
        notice: SignUI.toast,
        exportProject: App.exportProject,
        deserialize: SignState.deserializeSign,
        limitSize: false,
        drawThumbnail: async (state, signal) => {
          await App.ready;
          signal.throwIfAborted();
          const drawing = document.createElementNS(SignCore.SVG_NS, 'svg');
          const size = SignRender.renderSignInto(drawing, state, App.measure, { clean: true });
          return { drawing, size, usedFonts: SignExporters.collectUsedFonts(state) };
        },
        formatDetails: project => (project.rowCount ?? 0) + ' 行 · ' + (project.elementCount ?? 0) +
          ' 个元素 · ' + (project.presetCount ?? 0) + ' 个预设',
      });
      await App.autosave.ready;
      loader.setStage('projects', 'done', 1, '已同步本地项目');
      loader.setStage('workspace', 'active', 0.5, '构建元素库与画布', '正在渲染标识牌…');
      App.measure = SignCore.createCanvasMeasurer();
      SignPanel.buildPalette();
      App.renderAll();
      loader.setStage('workspace', 'done', 1, '界面已就绪');
      loader.finish('准备就绪');
      if (!fontsReady) SignUI.toast('字体未能完全加载，文字尺寸可能不准，建议刷新重试', 'warning');
      document.fonts.ready.then(function () { App.renderAll(); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
