(function (global) {
  'use strict';

  const buttons = [...document.querySelectorAll('[data-panel-toggle]')];
  const openPanels = new Map();
  for (const collapse of buttons) {
    const identifier = collapse.getAttribute('aria-controls');
    const panel = document.getElementById(identifier);
    if (!panel.contains(collapse)) continue;
    const expand = buttons.find(button => button !== collapse && button.getAttribute('aria-controls') === identifier);

    function setCollapsed(collapsed, moveFocus = true) {
      panel.classList.toggle('collapsed', collapsed);
      panel.inert = collapsed;
      for (const button of [collapse, expand]) button.setAttribute('aria-expanded', String(!collapsed));
      if (collapsed) expand.hidden = false;
      if (moveFocus) (collapsed ? expand : collapse).focus({ preventScroll: true });
      if (!collapsed) expand.hidden = true;
    }

    collapse.addEventListener('click', () => setCollapsed(true));
    expand.addEventListener('click', () => setCollapsed(false));
    openPanels.set(identifier, () => {
      if (panel.inert) setCollapsed(false, false);
    });
  }

  global.EditorPanels = {
    expand(identifier) { openPanels.get(identifier)?.(); },
  };
})(window);
