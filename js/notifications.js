(function (global) {
  'use strict';

  const categories = {
    information: { label: '提示', symbol: 'i', duration: 3200 },
    success: { label: '成功', symbol: '✓', duration: 3000 },
    warning: { label: '注意', symbol: '!', duration: 4600 },
    error: { label: '失败', symbol: '×', duration: 5600 },
  };
  const active = new Set();
  let container;
  let status;
  let alert;

  function createContainer() {
    container = document.createElement('div');
    container.id = 'toasts';
    container.setAttribute('aria-hidden', 'true');
    if (typeof container.showPopover === 'function') container.setAttribute('popover', 'manual');
    status = document.createElement('div');
    alert = document.createElement('div');
    for (const [region, role] of [[status, 'status'], [alert, 'alert']]) {
      region.className = 'sr-only';
      region.setAttribute('role', role);
      region.setAttribute('aria-atomic', 'true');
    }
    document.body.append(container, status, alert);
  }

  function show(message, kind = 'information') {
    if (!Object.hasOwn(categories, kind)) kind = 'information';
    if (!container) createContainer();
    if (active.size >= 3) active.values().next().value();
    const { label, symbol, duration } = categories[kind];
    const notification = document.createElement('div');
    notification.className = 'toast';
    notification.dataset.kind = kind;
    for (const [className, text] of [['toast-symbol', symbol], ['toast-label', label], ['toast-message', message]]) {
      const part = document.createElement('span');
      part.className = className;
      part.textContent = text;
      notification.append(part);
    }
    container.append(notification);
    if (container.hasAttribute('popover')) {
      // 原生对话框上方需要由浏览器的顶层来显示，层级值无法盖过对话框。
      if (container.matches(':popover-open') && document.querySelector('dialog:modal')) container.hidePopover();
      container.showPopover();
    }
    const announcement = kind === 'error' ? alert : status;
    announcement.textContent = label + '。' + message;
    const timer = global.setTimeout(dismiss, duration);
    active.add(dismiss);

    function dismiss() {
      if (!active.delete(dismiss)) return;
      global.clearTimeout(timer);
      notification.classList.add('leaving');
      global.EditorMotion.afterMotion(notification, () => {
        notification.remove();
        if (!container.childElementCount && container.matches(':popover-open')) container.hidePopover();
      });
    }

    return dismiss;
  }

  global.EditorNotifications = { show };
})(window);
