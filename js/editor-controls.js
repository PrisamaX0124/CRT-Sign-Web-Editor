(function (global) {
  'use strict';

  const selectMap = new WeakMap();
  const rangeSet = new WeakSet();
  const detailsSet = new WeakSet();
  const segmentedSet = new WeakSet();
  const popoverSupported = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';

  let activeDropdown = null;
  let dropdownMenu = null;
  let patchedPrototypes = false;

  function syncRange(input) {
    if (!input || input.type !== 'range') return;
    const min = input.min === '' ? 0 : Number(input.min);
    const max = input.max === '' ? 100 : Number(input.max);
    const value = Number(input.value);
    const ratio = max > min && Number.isFinite(value) ? (value - min) / (max - min) : 0;
    const percent = Math.max(0, Math.min(100, ratio * 100));
    input.style.setProperty('--range-progress', percent.toFixed(2) + '%');
  }

  function enhanceRange(input) {
    if (!input || input.type !== 'range' || rangeSet.has(input)) return;
    rangeSet.add(input);
    input.classList.add('custom-range');
    input.addEventListener('input', () => syncRange(input));
    input.addEventListener('change', () => syncRange(input));
    syncRange(input);
  }

  function ensureDropdownMenu() {
    if (dropdownMenu) return dropdownMenu;
    dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'custom-select-menu';
    dropdownMenu.setAttribute('role', 'listbox');
    if (popoverSupported) dropdownMenu.setAttribute('popover', 'manual');
    dropdownMenu.hidden = true;
    return dropdownMenu;
  }

  function visibleOptions(select) {
    return Array.from(select.options).filter(option => !option.hidden);
  }

  function selectedLabel(select) {
    const selected = select.options[select.selectedIndex];
    if (selected) return selected.textContent.trim();
    const first = visibleOptions(select)[0];
    return first ? first.textContent.trim() : '';
  }

  function syncSelect(select) {
    const entry = selectMap.get(select);
    if (!entry) return;
    const { wrapper, trigger, valueSpan, iconOnly } = entry;
    wrapper.classList.toggle('is-disabled', select.disabled);
    trigger.setAttribute('aria-disabled', String(select.disabled));
    trigger.tabIndex = select.disabled ? -1 : 0;
    const label = selectedLabel(select);
    if (!iconOnly && valueSpan) {
      valueSpan.textContent = label;
    }
    const accessibleName = select.getAttribute('aria-label');
    if (accessibleName) trigger.setAttribute('aria-label', accessibleName + (label ? '：' + label : ''));
    if (select.title) trigger.title = select.title;
    if (activeDropdown && activeDropdown.select === select) {
      renderDropdownOptions(entry);
    }
  }

  function positionDropdownMenu(trigger, menu, preferUp) {
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const minWidth = Math.max(rect.width, 132);
    menu.style.minWidth = Math.min(minWidth, viewportWidth - margin * 2) + 'px';
    menu.style.maxWidth = Math.min(Math.max(rect.width + 80, 260), viewportWidth - margin * 2) + 'px';
    const menuRect = menu.getBoundingClientRect();
    const spaceBelow = viewportHeight - rect.bottom - margin - gap;
    const spaceAbove = rect.top - margin - gap;
    const openUp = preferUp || (spaceBelow < Math.min(menuRect.height, 220) && spaceAbove > spaceBelow);
    const maxHeight = Math.max(110, Math.min(280, openUp ? spaceAbove : spaceBelow));
    menu.style.maxHeight = maxHeight + 'px';
    const measuredHeight = Math.min(menu.scrollHeight + 10, maxHeight);
    let left = rect.left;
    const width = Math.max(menuRect.width, minWidth);
    if (left + width > viewportWidth - margin) {
      left = Math.max(margin, rect.right - width);
    }
    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));
    const top = openUp
      ? Math.max(margin, rect.top - gap - measuredHeight)
      : Math.min(viewportHeight - margin - measuredHeight, rect.bottom + gap);
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    menu.dataset.placement = openUp ? 'top' : 'bottom';
  }

  function renderDropdownOptions(entry) {
    const { select } = entry;
    const menu = ensureDropdownMenu();
    const options = visibleOptions(select);
    menu.replaceChildren();
    if (!options.length) {
      const empty = document.createElement('div');
      empty.className = 'custom-select-empty';
      empty.textContent = '暂无可选项';
      menu.append(empty);
      return;
    }
    options.forEach(option => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'custom-select-option';
      item.setAttribute('role', 'option');
      const isSelected = option.selected;
      item.setAttribute('aria-selected', String(isSelected));
      item.dataset.value = option.value;
      item.disabled = option.disabled;
      const text = document.createElement('span');
      text.className = 'custom-select-option-label';
      text.textContent = option.textContent;
      const check = document.createElement('span');
      check.className = 'custom-select-option-check';
      check.setAttribute('aria-hidden', 'true');
      check.innerHTML = '<svg viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      item.append(text, check);
      item.addEventListener('click', event => {
        event.stopPropagation();
        if (option.disabled) return;
        chooseOption(entry, option.value);
      });
      menu.append(item);
    });
  }

  function chooseOption(entry, value) {
    const { select } = entry;
    const changed = select.value !== value;
    select.value = value;
    syncSelect(select);
    closeDropdown(true);
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function openDropdown(entry) {
    const { select, trigger } = entry;
    if (select.disabled) return;
    if (activeDropdown === entry) {
      closeDropdown(true);
      return;
    }
    if (activeDropdown) closeDropdown(false);
    const menu = ensureDropdownMenu();
    if (popoverSupported && menu.matches(':popover-open')) menu.hidePopover();
    // 打开的模态弹窗会阻止用户操作弹窗外的控件。
    const menuParent = trigger.closest('dialog[open]') || document.body;
    if (menu.parentElement !== menuParent) menuParent.append(menu);
    activeDropdown = entry;
    trigger.setAttribute('aria-expanded', 'true');
    entry.wrapper.classList.add('is-open');
    renderDropdownOptions(entry);
    menu.hidden = false;
    menu.classList.remove('is-closing');
    if (popoverSupported) {
      try { menu.showPopover(); } catch {}
    }
    const preferUp = Boolean(select.closest('.editor-footer, .image-export'));
    positionDropdownMenu(trigger, menu, preferUp);
    const selectedItem = menu.querySelector('.custom-select-option[aria-selected="true"]:not(:disabled)')
      || menu.querySelector('.custom-select-option:not(:disabled)');
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
      selectedItem.focus({ preventScroll: true });
    }
  }

  function closeDropdown(restoreFocus) {
    if (!activeDropdown) return;
    const closing = activeDropdown;
    activeDropdown = null;
    closing.trigger.setAttribute('aria-expanded', 'false');
    closing.wrapper.classList.remove('is-open');
    const menu = dropdownMenu;
    if (menu) {
      const duration = global.EditorMotion?.timing(menu, 'dismiss').duration || 0;
      if (duration > 0) {
        menu.classList.add('is-closing');
        global.setTimeout(() => {
          if (activeDropdown || !menu.classList.contains('is-closing')) return;
          menu.classList.remove('is-closing');
          menu.hidden = true;
          if (popoverSupported && menu.matches(':popover-open')) {
            try { menu.hidePopover(); } catch {}
          }
        }, duration);
      } else {
        menu.hidden = true;
        if (popoverSupported && menu.matches(':popover-open')) {
          try { menu.hidePopover(); } catch {}
        }
      }
    }
    if (restoreFocus && closing.trigger.isConnected) {
      closing.trigger.focus({ preventScroll: true });
    }
  }

  function enhanceSelect(select) {
    if (!select || select.tagName !== 'SELECT' || select.multiple || select.size > 1) return;
    if (selectMap.has(select)) return;
    if (select.closest('.custom-select')) return;

    const iconOnly = Boolean(select.closest('.clipboard-history'));
    const wrapper = document.createElement('span');
    wrapper.className = 'custom-select' + (iconOnly ? ' custom-select-icon-only' : '');

    const trigger = document.createElement('span');
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-disabled', 'false');
    trigger.tabIndex = 0;

    let valueSpan = null;
    if (!iconOnly) {
      valueSpan = document.createElement('span');
      valueSpan.className = 'custom-select-value';
      const chevron = document.createElement('span');
      chevron.className = 'custom-select-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = '<svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      trigger.append(valueSpan, chevron);
    }

    const parent = select.parentNode;
    if (!parent) return;
    if (iconOnly) {
      wrapper.classList.add('custom-select-overlay');
    }
    parent.insertBefore(wrapper, select);
    wrapper.append(select, trigger);

    select.classList.add('custom-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const entry = { select, wrapper, trigger, valueSpan, iconOnly };
    selectMap.set(select, entry);

    if (select.id) {
      document.addEventListener('click', event => {
        const label = event.target.closest?.('label[for="' + CSS.escape(select.id) + '"]');
        if (label && !wrapper.contains(event.target)) {
          event.preventDefault();
          trigger.focus({ preventScroll: true });
          openDropdown(entry);
        }
      });
    }

    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openDropdown(entry);
    });

    trigger.addEventListener('keydown', event => {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        openDropdown(entry);
      }
    });

    select.addEventListener('change', () => syncSelect(select));
    select.addEventListener('input', () => syncSelect(select));

    const observer = new MutationObserver(() => syncSelect(select));
    observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'title', 'aria-label'] });

    syncSelect(select);
  }

  function enhanceDetails(details) {
    if (!details || details.tagName !== 'DETAILS' || detailsSet.has(details)) return;
    if (details.classList.contains('footer-shortcuts') || details.classList.contains('project-card-menu')) {
      detailsSet.add(details);
      return;
    }
    const summary = details.querySelector(':scope > summary');
    if (!summary) return;
    detailsSet.add(details);
    details.classList.add('animated-details');

    let body = details.querySelector(':scope > .details-collapse');
    if (!body) {
      body = document.createElement('div');
      body.className = 'details-collapse';
      const inner = document.createElement('div');
      inner.className = 'details-collapse-inner';
      const siblings = [];
      let cursor = summary.nextSibling;
      while (cursor) {
        siblings.push(cursor);
        cursor = cursor.nextSibling;
      }
      inner.append(...siblings);
      body.append(inner);
      details.append(body);
    }

    let animation = null;

    function animateToggle(opening) {
      const timing = global.EditorMotion?.timing(details, opening ? 'reveal' : 'dismiss');
      if (!timing || !timing.duration || typeof body.animate !== 'function') {
        details.open = opening;
        return;
      }
      if (animation) {
        animation.cancel();
        animation = null;
      }
      const easing = global.getComputedStyle(details).getPropertyValue(opening ? '--motion-enter' : '--motion-exit').trim() || timing.easing;
      if (opening) {
        details.open = true;
        const targetHeight = body.scrollHeight;
        body.style.overflow = 'hidden';
        animation = body.animate(
          [
            { height: '0px', opacity: 0, transform: 'translateY(-4px)' },
            { height: targetHeight + 'px', opacity: 1, transform: 'none' },
          ],
          { duration: timing.duration, easing }
        );
        animation.finished.then(() => {
          body.style.overflow = '';
          animation = null;
        }, () => {
          body.style.overflow = '';
          animation = null;
        });
      } else {
        const startHeight = body.getBoundingClientRect().height;
        body.style.overflow = 'hidden';
        animation = body.animate(
          [
            { height: startHeight + 'px', opacity: 1, transform: 'none' },
            { height: '0px', opacity: 0, transform: 'translateY(-3px)' },
          ],
          { duration: timing.duration, easing }
        );
        animation.finished.then(() => {
          details.open = false;
          body.style.overflow = '';
          animation = null;
        }, () => {
          body.style.overflow = '';
          animation = null;
        });
      }
    }

    details.setOpenAnimated = animateToggle;

    summary.addEventListener('click', event => {
      event.preventDefault();
      animateToggle(!details.open);
    });
  }

  function updateSegmentedIndicator(container, animate) {
    if (!container || !container.isConnected) return;
    const active = container.querySelector(':scope > button[aria-selected="true"], :scope > button[aria-pressed="true"], :scope > button.active');
    if (!active || active.hidden || !active.offsetWidth) {
      container.style.setProperty('--seg-opacity', '0');
      return;
    }
    const left = active.offsetLeft;
    const width = active.offsetWidth;
    const top = active.offsetTop;
    const height = active.offsetHeight;
    if (!animate) container.classList.add('seg-instant');
    container.style.setProperty('--seg-left', left + 'px');
    container.style.setProperty('--seg-top', top + 'px');
    container.style.setProperty('--seg-width', width + 'px');
    container.style.setProperty('--seg-height', height + 'px');
    container.style.setProperty('--seg-opacity', '1');
    if (!animate) {
      container.getBoundingClientRect();
      container.classList.remove('seg-instant');
    }
  }

  function enhanceSegmented(container) {
    if (!container || segmentedSet.has(container)) return;
    segmentedSet.add(container);
    container.classList.add('has-seg-indicator');
    let initialized = false;
    const refresh = () => {
      updateSegmentedIndicator(container, initialized);
      initialized = true;
    };
    const observer = new MutationObserver(() => global.requestAnimationFrame(refresh));
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-pressed', 'class', 'hidden'],
    });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => updateSegmentedIndicator(container, false)).observe(container);
    }
    global.requestAnimationFrame(refresh);
  }

  function patchPrototypes() {
    if (patchedPrototypes) return;
    patchedPrototypes = true;

    const selectValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (selectValueDesc?.set) {
      Object.defineProperty(HTMLSelectElement.prototype, 'value', {
        configurable: true,
        get() { return selectValueDesc.get.call(this); },
        set(val) {
          selectValueDesc.set.call(this, val);
          if (selectMap.has(this)) syncSelect(this);
        },
      });
    }
    const selectIndexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    if (selectIndexDesc?.set) {
      Object.defineProperty(HTMLSelectElement.prototype, 'selectedIndex', {
        configurable: true,
        get() { return selectIndexDesc.get.call(this); },
        set(val) {
          selectIndexDesc.set.call(this, val);
          if (selectMap.has(this)) syncSelect(this);
        },
      });
    }
    const selectDisabledDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'disabled');
    if (selectDisabledDesc?.set) {
      Object.defineProperty(HTMLSelectElement.prototype, 'disabled', {
        configurable: true,
        get() { return selectDisabledDesc.get.call(this); },
        set(val) {
          selectDisabledDesc.set.call(this, val);
          if (selectMap.has(this)) syncSelect(this);
        },
      });
    }

    const inputValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (inputValueDesc?.set) {
      Object.defineProperty(HTMLInputElement.prototype, 'value', {
        configurable: true,
        get() { return inputValueDesc.get.call(this); },
        set(val) {
          inputValueDesc.set.call(this, val);
          if (this.type === 'range') syncRange(this);
        },
      });
    }
    const stepUp = HTMLInputElement.prototype.stepUp;
    const stepDown = HTMLInputElement.prototype.stepDown;
    if (stepUp) {
      HTMLInputElement.prototype.stepUp = function (...args) {
        stepUp.apply(this, args);
        if (this.type === 'range') syncRange(this);
      };
    }
    if (stepDown) {
      HTMLInputElement.prototype.stepDown = function (...args) {
        stepDown.apply(this, args);
        if (this.type === 'range') syncRange(this);
      };
    }
  }

  function scan(root = document) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches?.('select')) enhanceSelect(root);
    if (root.matches?.('input[type="range"]')) enhanceRange(root);
    if (root.matches?.('details')) enhanceDetails(root);
    if (root.matches?.('.mode-tabs, .property-tabs, .palette-tabs, .library-tabs, #transfer-arrangements')) enhanceSegmented(root);

    root.querySelectorAll('select').forEach(enhanceSelect);
    root.querySelectorAll('input[type="range"]').forEach(enhanceRange);
    root.querySelectorAll('details').forEach(enhanceDetails);
    root.querySelectorAll('.mode-tabs, .property-tabs, .palette-tabs, .library-tabs, #transfer-arrangements').forEach(enhanceSegmented);
  }

  function wireGlobalEvents() {
    document.addEventListener('pointerdown', event => {
      if (!activeDropdown) return;
      if (dropdownMenu?.contains(event.target) || activeDropdown.wrapper.contains(event.target)) return;
      closeDropdown(false);
    }, true);

    document.addEventListener('keydown', event => {
      if (!activeDropdown || !dropdownMenu) return;
      const items = Array.from(dropdownMenu.querySelectorAll('.custom-select-option:not(:disabled)'));
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDropdown(true);
        return;
      }
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[(current + 1 + items.length) % items.length].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[(current - 1 + items.length) % items.length].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        items[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (event.key === 'Tab') {
        closeDropdown(false);
      }
    }, true);

    window.addEventListener('resize', () => {
      if (activeDropdown && dropdownMenu) {
        const preferUp = Boolean(activeDropdown.select.closest('.editor-footer, .image-export'));
        positionDropdownMenu(activeDropdown.trigger, dropdownMenu, preferUp);
      }
    });

    document.addEventListener('scroll', event => {
      if (activeDropdown && dropdownMenu && !dropdownMenu.contains(event.target)) {
        closeDropdown(false);
      }
    }, true);
  }

  function init() {
    patchPrototypes();
    wireGlobalEvents();
    scan(document);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) scan(node);
        }
      }
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  global.EditorControls = { scan, syncSelect, syncRange, closeDropdown };
})(typeof window !== 'undefined' ? window : globalThis);
