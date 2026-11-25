(function (window) {
  'use strict';

  const storageKey = 'public-editor-preferences';
  const tutorialKey = 'public-editor-tutorial-';
  const defaults = { theme: 'system', canvas: 'dots', motion: 'system', showTutorial: true };
  const root = window.document.documentElement;
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  const completedTutorials = new Set();

  function normalize(values) {
    return {
      theme: ['system', 'light', 'dark'].includes(values?.theme) ? values.theme : defaults.theme,
      canvas: ['dots', 'grid', 'plain'].includes(values?.canvas) ? values.canvas : defaults.canvas,
      motion: values?.motion === 'reduced' ? 'reduced' : defaults.motion,
      showTutorial: values?.showTutorial !== false,
    };
  }

  function restore() {
    try { return normalize(JSON.parse(window.localStorage.getItem(storageKey))); }
    catch { return normalize(); }
  }

  let preferences = restore();

  function apply() {
    root.dataset.editorTheme = preferences.theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preferences.theme;
    root.dataset.canvasBackground = preferences.canvas;
    root.dataset.editorMotion = preferences.motion;
  }

  function update() {
    apply();
    for (const listener of listeners) listener();
  }

  function write(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch { return false; }
  }

  function save(values) {
    preferences = normalize(values);
    const saved = write(storageKey, JSON.stringify(preferences));
    update();
    return saved;
  }

  systemTheme.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    preferences = restore();
    update();
  });
  apply();

  window.EditorPreferences = {
    read() { return { ...preferences }; },
    save,
    reset() { return save(defaults); },
    subscribe(listener) { listeners.add(listener); },
    tutorialSeen(editor) {
      if (completedTutorials.has(editor)) return true;
      try { return window.localStorage.getItem(tutorialKey + editor) === 'seen'; }
      catch { return false; }
    },
    markTutorialSeen(editor) {
      completedTutorials.add(editor);
      return write(tutorialKey + editor, 'seen');
    },
  };
})(window);
