/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * ui.js — 全局应用上下文与 UI 基建（toast / 模态对话框 / DOM 工具）
 *
 * App 是唯一的全局可变上下文：当前状态、选中项、测量器、布局缓存。
 * 所有状态变更通过 App.update(pureFn) 走不可变更新 → 重渲染 → 自动保存。
 */
(function (global) {
  'use strict';

  // 移动布局断点（与 style.css @media、main.js 断点监听共用同一数值）
  var mobileQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 768px)')
    : null;

  // 只保存本会话最近20次有效编辑。状态本身不可变，历史复用其引用。
  var undoStack = [], redoStack = [];
  var historyKey = null, historyTime = 0;
  var HISTORY_LIMIT = 20;

  function snapshot() {
    return { state: App.state, selection: Object.assign({}, App.selection, { elementIds: App.selectedIds() }) };
  }

  function normalizeSelection(state, selection) {
    var ids = (selection.elementIds || []).filter(function (id, i, all) { return all.indexOf(id) === i && SignState.findElement(state, id); });
    var primary = ids.indexOf(selection.elementId) >= 0 ? selection.elementId : ids[ids.length - 1] || null;
    return { elementIds: ids, elementId: primary,
      anchorId: selection.anchorId && SignState.findElement(state, selection.anchorId) ? selection.anchorId : primary };
  }

  function commitState(state, selection) {
    App.state = state;
    App.selection = normalizeSelection(state, selection);
    App.renderAll();
    if (global.SignStorage) SignStorage.scheduleAutosave(state);
  }

  function restoreHistory(from, to) {
    App.breakHistoryGroup();
    if (!from.length) return false;
    to.push(snapshot());
    if (to.length > HISTORY_LIMIT) to.shift();
    var entry = from.pop();
    App.presetPreviewId = null;
    commitState(entry.state, entry.selection);
    return true;
  }

  var App = {
    state: null,                  // SignState（唯一数据源）
    measure: null,                // 文本测量器（fonts 就绪后可用）
    layout: null,                 // 最近一次渲染的布局（SignRender.layoutSign 结果）
    selection: { elementId: null, elementIds: [], anchorId: null },
    presetPreviewId: null,        // 右栏预设预览模式
    panels: { left: true, right: true },
    canvasZoom: 1,                // 画布显示缩放（会话态，不持久化；移动端 pinch 用）
    // 编辑器偏好（非标识牌数据，localStorage 持久化；main.js 启动时以存档覆盖）
    prefs: { autoLineColor: true, paletteCity: 'shanghai' },

    /** ≤768px 走移动三段式布局（palette 分支 / 底部属性带 / 触屏手势都依赖它） */
    isMobileView: function () {
      return !!(mobileQuery && mobileQuery.matches);
    },

    /** 状态变更入口：pureFn(sign) → 新 sign；continuous用于显式结束的指针会话。 */
    update: function (pureFn, key, options) {
      var next = pureFn(App.state);
      if (global.SignState && SignState.applyPaddingAuto) {
        // 相邻自动内边距：每次变更后按相邻关系重算自动侧（幂等，随当次更新落盘/撤销）
        next = SignState.applyPaddingAuto(next);
      }
      // 纯函数可能返回等值的新对象；无效移动/重复设置不消耗撤销步骤。
      if (JSON.stringify(next) === JSON.stringify(App.state)) return;
      var now = Date.now();
      if (App.state && !(key && key === historyKey && ((options && options.continuous) || now - historyTime < 800))) {
        undoStack.push(snapshot());
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      }
      redoStack = [];
      historyKey = key || null;
      historyTime = now;
      var selection = Object.assign({}, App.selection, { elementIds: App.selectedIds() });
      if (options && options.selectNew) {
        var previousIds = new Set(App.state.rows.flatMap(function (row) { return row.elements.map(function (el) { return el.id; }); }));
        var added = next.rows.flatMap(function (row) { return row.elements.map(function (el) { return el.id; }); }).filter(function (id) { return !previousIds.has(id); });
        selection = { elementIds: added, elementId: added[added.length - 1], anchorId: added[0] };
      }
      commitState(next, selection);
    },

    undo: function () { return restoreHistory(undoStack, redoStack); },
    redo: function () { return restoreHistory(redoStack, undoStack); },
    breakHistoryGroup: function () { historyKey = null; },

    /** 全量重渲染：SVG + 覆盖层 + 右栏同步（不动焦点） */
    renderAll: function () {
      if (!App.state || !App.measure) return;
      var svg = document.getElementById('sign-svg');
      App.layout = SignRender.renderSignInto(svg, App.state, App.measure, {
        selectedElementId: App.selection.elementId,
        selectedElementIds: App.selectedIds(),
      });
      App.fitSignDisplay();
      if (global.SignInteract) SignInteract.renderOverlay(App.layout, App.state);
      if (global.SignPanel) SignPanel.syncRightPanel();
      if (global.SignClipboard) SignClipboard.sync();
    },

    /**
     * 编辑区显示尺寸：适配画布宽度，但缩放不超过 100%——
     * 窄标识牌不放大（否则行高会被等比放大得过大），宽标识牌铺满画布；
     * 该适配宽度再乘 App.canvasZoom（pinch 缩放，1x 即原始适配结果）。
     * 覆盖层（指示线/行手柄的百分比基准）同步为 SVG 实际显示区，
     * 否则窄牌右侧留白会使拖放指示线漂移。
     * canvas-wrap 尺寸变化（窗口缩放/面板收展）由 ResizeObserver 触发重算（main.js）。
     */
    fitSignDisplay: function () {
      if (!App.layout) return;
      var svg = document.getElementById('sign-svg');
      var wrap = document.getElementById('canvas-wrap');
      var overlay = document.getElementById('sign-overlay');
      if (!svg || !wrap) return;
      var avail = wrap.clientWidth;
      if (avail > 0) {
        svg.style.width = Math.min(avail, App.layout.width) * (App.canvasZoom || 1) + 'px';
        if (overlay) {
          overlay.style.width = svg.style.width;
          overlay.style.height = svg.getBoundingClientRect().height + 'px';
        }
        if (global.SignInteract) SignInteract.positionElementToolbar();
      }
    },

    /** 选中元素（null = 取消选中，回到标识牌设置） */
    select: function (elementId, modifiers) {
      if (!elementId) { App.selectMany([]); return; }
      if (!SignState.findElement(App.state, elementId)) return;
      var opts = modifiers || {}, ids = App.selectedIds(), anchor = App.selection.anchorId;
      if (opts.range && anchor) {
        var order = App.elementOrder(), a = order.indexOf(anchor), b = order.indexOf(elementId);
        if (a >= 0 && b >= 0) {
          var range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
          App.selectMany(opts.toggle ? ids.concat(range) : range, elementId, anchor);
          return;
        }
      }
      if (opts.toggle) {
        var index = ids.indexOf(elementId);
        if (index >= 0) ids.splice(index, 1); else ids.push(elementId);
        App.selectMany(ids, index >= 0 ? ids[ids.length - 1] : elementId);
      } else App.selectMany([elementId], elementId);
    },

    selectedIds: function () {
      var ids = App.selection.elementIds || [];
      if (!ids.length && App.selection.elementId) ids = [App.selection.elementId];
      return ids.filter(function (id) { return App.state && SignState.findElement(App.state, id); });
    },

    selectMany: function (ids, primary, anchor) {
      var next = normalizeSelection(App.state, { elementIds: ids, elementId: primary, anchorId: anchor || primary || ids[0] });
      if (JSON.stringify(next) === JSON.stringify(App.selection)) return;
      App.breakHistoryGroup();
      App.selection = next;
      if (next.elementId) App.presetPreviewId = null;
      App.renderAll();
    },

    elementOrder: function () {
      if (App.layout) return App.layout.rows.flatMap(function (row) {
        return row.elements.slice().sort(function (a, b) { return a.x - b.x; }).map(function (slot) { return slot.id; });
      });
      return App.state.rows.flatMap(function (row) { return row.elements.map(function (el) { return el.id; }); });
    },

    selectAll: function () { App.selectMany(App.elementOrder(), App.selection.elementId); },

    alignmentTargets: function (key) {
      var types = key === 'align' ? ['bilingual-text', 'small-bilingual-text']
        : key === 'contentAlign' ? ['number-line', 'text-line', 'exit'] : null;
      return App.selectedIds().filter(function (id) {
        return !types || types.indexOf(SignState.findElement(App.state, id).element.type) >= 0;
      });
    },

    alignmentValue: function (key) {
      var prop = key === 'elementAlign' ? 'elementAlign' : 'align';
      var values = App.alignmentTargets(key).map(function (id) { return SignState.findElement(App.state, id).element.props[prop]; });
      return values.every(function (value) { return value === values[0]; }) ? values[0] || 'left' : null;
    },

    setAlignment: function (key, value) {
      if (['elementAlign', 'align', 'contentAlign'].indexOf(key) < 0 || ['left', 'center', 'right'].indexOf(value) < 0 ||
          (key === 'contentAlign' && value === 'center')) return;
      var patch = {}; patch[key === 'elementAlign' ? 'elementAlign' : 'align'] = value;
      var ids = App.alignmentTargets(key);
      App.update(function (st) { return SignState.updateElementsProps(st, ids, patch); });
    },

    deleteSelection: function () {
      var ids = App.selectedIds();
      if (ids.length) App.update(function (st) { return SignState.deleteElements(st, ids); });
    },

    paddingIds: function () {
      return App.selectedIds().filter(function (id) { return SignState.findElement(App.state, id).element.type !== 'space'; });
    },

    paddingValue: function (side) {
      var values = App.paddingIds().map(function (id) { return SignState.findElement(App.state, id).element.props.padding[side]; });
      return values.every(function (v) { return v === values[0]; }) ? values[0] || 0 : null;
    },

    setPadding: function (side, value) {
      var padding = {}; padding[side] = value;
      var ids = App.paddingIds();
      App.update(function (st) { return SignState.updateElementsProps(st, ids, { padding: padding }); });
    },

    adjustPadding: function (side, delta, key) {
      var ids = App.paddingIds();
      App.update(function (st) {
        return ids.reduce(function (next, id) { return SignState.adjustElementPadding(next, id, side, delta); }, st);
      }, key, { continuous: !!key });
    },

    /** 进入预设预览模式 */
    previewPreset: function (presetId) {
      App.breakHistoryGroup();
      App.presetPreviewId = presetId;
      App.selection = { elementId: null, elementIds: [], anchorId: null };
      App.renderAll();
    },
  };
  global.App = App;

  // ─── DOM 工具 ──────────────────────────────────────────────

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
        else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
        else if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // 编辑器工具图形独立于牌面图标库，使用 currentColor 适配系统主题。
  function toolIcon(name) {
    var svg = document.createElementNS(SignCore.SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('data-icon', name);
    if (name === 'bold') {
      svg.innerHTML = '<path d="M7 4h6a5 5 0 0 1 3.3 8.7A5 5 0 0 1 13 21H7V4Zm3 3v4h3a2 2 0 0 0 0-4h-3Zm0 7v4h3a2 2 0 0 0 0-4h-3Z" fill="currentColor"/>';
    } else {
      var starts = name === 'align-right' ? [4, 9, 4, 9] : name === 'align-center' ? [4, 6.5, 4, 6.5] : [4, 4, 4, 4];
      var lengths = [16, 11, 16, 11];
      svg.innerHTML = starts.map(function (x, i) {
        return '<path d="M' + x + ' ' + (5 + i * 4.5) + 'h' + lengths[i] + '" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
      }).join('');
    }
    return svg;
  }

  /** 浮动栏与属性面板共用原生下拉框；调用方在状态更新时执行 sync。 */
  function alignmentControl(options, getValue, onPick, label, key) {
    var icon = toolIcon('align-left');
    icon.classList.add('alignment-icon');
    var select = h('select', { 'aria-label': label }, options.map(function (opt) {
      return h('option', { value: opt.value, text: opt.label });
    }));
    var chevron = document.createElementNS(SignCore.SVG_NS, 'svg');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('aria-hidden', 'true');
    chevron.classList.add('alignment-chevron');
    chevron.innerHTML = '<path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    var node = h('div', { class: 'alignment-control', 'data-align': key }, [icon, select, chevron]);
    select.addEventListener('change', function () {
      if (options.some(function (opt) { return opt.value === select.value; })) onPick(select.value);
    });
    function sync() {
      var value = getValue(), mixed = value === null;
      var mixedOption = select.querySelector('option[value=""]');
      if (mixed && !mixedOption) select.insertBefore(h('option', { value: '', text: '不同', disabled: '' }), select.firstChild);
      if (!mixed && mixedOption) mixedOption.remove();
      if (mixed) value = '';
      else if (!options.some(function (opt) { return opt.value === value; })) value = options[0].value;
      select.value = value;
      icon.style.visibility = mixed ? 'hidden' : '';
      var name = 'align-' + value;
      if (icon.getAttribute('data-icon') !== name) {
        icon.innerHTML = toolIcon(name).innerHTML;
        icon.setAttribute('data-icon', name);
      }
      node.title = label + '：' + select.options[select.selectedIndex].text;
    }
    sync();
    return { node: node, sync: sync };
  }

  // ─── 左右内边距图标与拖动调值 ────────────────────────────────

  function paddingIcon(side) {
    var icon = document.createElementNS(SignCore.SVG_NS, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    var path = side === 'left' ? 'M3 4v16M14 7h7v10h-7Z' : 'M21 4v16M3 7h7v10H3Z';
    icon.innerHTML = '<rect x="' + (side === 'left' ? 4 : 12) + '" y="5" width="8" height="14" rx="1" fill="currentColor" opacity=".12"/>' +
      '<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    return icon;
  }

  /** 两处边距图标共用：每8px一档，读取当前状态，单次拖动合并撤销。 */
  function bindPaddingScrub(trigger, side, getElementId) {
    var session = null, swallowClick = false, clickTimer;
    trigger.classList.add('padding-scrub');
    trigger.addEventListener('click', function (ev) {
      if (!swallowClick) return;
      swallowClick = false;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }, true);
    trigger.addEventListener('pointerdown', function (ev) {
      if (session || trigger.disabled || ev.button !== 0 || ev.isPrimary === false) return;
      var id = getElementId(), found = SignState.findElement(App.state, id);
      if (!found || !App.paddingIds().length || App.selectedIds().indexOf(id) < 0) return;
      clearTimeout(clickTimer);
      swallowClick = false;
      // 聚焦图标先提交其他输入框的待编辑值，避免拖动后失焦回滚。
      if (ev.pointerType === 'mouse') { ev.preventDefault(); trigger.focus({ preventScroll: true }); }
      App.breakHistoryGroup();
      session = { id: id, ids: App.selectedIds().join(','), pointerId: ev.pointerId, startX: ev.clientX, lastX: ev.clientX, moved: false };
      try { trigger.setPointerCapture(ev.pointerId); } catch (e) { /* 合成事件无活动指针 */ }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', end);
      document.addEventListener('pointercancel', end);
      trigger.addEventListener('lostpointercapture', end);
      window.addEventListener('blur', end);
    });
    function move(ev) {
      if (!session || ev.pointerId !== session.pointerId) return;
      if (!trigger.isConnected || getElementId() !== session.id || App.selectedIds().join(',') !== session.ids) { end(); return; }
      if (Math.abs(ev.clientX - session.startX) >= 5) {
        session.moved = true;
        trigger.classList.add('scrubbing');
        document.body.classList.add('padding-scrubbing');
      }
      var steps = Math.trunc((ev.clientX - session.lastX) / 8);
      if (!steps) return;
      ev.preventDefault();
      session.lastX += steps * 8;
      App.adjustPadding(side, steps * 0.05, session.ids + ':padding-scrub:' + side);
    }
    function end(ev) {
      if (!session || (ev && ev.pointerId !== undefined && ev.pointerId !== session.pointerId)) return;
      var ended = session;
      session = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      trigger.removeEventListener('lostpointercapture', end);
      window.removeEventListener('blur', end);
      try { trigger.releasePointerCapture(ended.pointerId); } catch (e) { /* 已释放或合成事件 */ }
      trigger.classList.remove('scrubbing');
      document.body.classList.remove('padding-scrubbing');
      App.breakHistoryGroup();
      swallowClick = ended.moved;
      // 捕获节点上的拖后click不能打开输入框；无click时及时清理。
      clickTimer = setTimeout(function () { swallowClick = false; }, 0);
    }
  }

  // ─── Toast ─────────────────────────────────────────────────

  function toast(message, type) {
    var el = h('div', { class: 'toast' + (type ? ' ' + type : ''), text: message });
    document.getElementById('toasts').appendChild(el);
    setTimeout(function () {
      el.classList.add('leaving');
      setTimeout(function () { el.remove(); }, 300);
    }, type === 'error' ? 4200 : 2400);
  }

  // ─── 模态对话框 ────────────────────────────────────────────

  /**
   * 确认对话框 → Promise<boolean>
   * confirmDialog('确定要删除此行吗？', '删除行')
   */
  function confirmDialog(message, title, confirmText) {
    return new Promise(function (resolve) {
      var mask = h('div', { class: 'modal-mask' });
      var modal = h('div', { class: 'modal' }, [
        h('h3', { text: title || '确认操作' }),
        h('div', { class: 'modal-body', text: message }),
        h('div', { class: 'modal-actions' }, [
          h('button', { class: 'btn', text: '取消', 'data-act': 'cancel' }),
          h('button', {
            class: 'btn btn-danger', text: confirmText || '确定', 'data-act': 'ok',
          }),
        ]),
      ]);
      mask.appendChild(modal);
      mask.addEventListener('click', function (ev) {
        var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
        if (act === 'ok') { mask.remove(); resolve(true); }
        else if (act === 'cancel' || ev.target === mask) { mask.remove(); resolve(false); }
      });
      document.getElementById('modal-root').appendChild(mask);
      modal.querySelector('[data-act="ok"]').focus();
    });
  }

  /**
   * 输入对话框 → Promise<string|null>
   * promptDialog('预设名称', '保存为预设', '站台方向牌')
   */
  function promptDialog(message, title, defaultValue, placeholder) {
    return new Promise(function (resolve) {
      var input = h('input', {
        class: 'modal-input', type: 'text', value: defaultValue || '', placeholder: placeholder || '',
      });
      var mask = h('div', { class: 'modal-mask' });
      var modal = h('div', { class: 'modal' }, [
        h('h3', { text: title || '输入' }),
        h('div', { class: 'modal-body', text: message }),
        input,
        h('div', { class: 'modal-actions' }, [
          h('button', { class: 'btn', text: '取消', 'data-act': 'cancel' }),
          h('button', { class: 'btn btn-primary', text: '确定', 'data-act': 'ok' }),
        ]),
      ]);
      mask.appendChild(modal);
      function done(val) { mask.remove(); resolve(val); }
      mask.addEventListener('click', function (ev) {
        var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
        if (act === 'ok') done(input.value.trim() || null);
        else if (act === 'cancel' || ev.target === mask) done(null);
      });
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') done(input.value.trim() || null);
        if (ev.key === 'Escape') done(null);
      });
      document.getElementById('modal-root').appendChild(mask);
      input.focus();
      input.select();
    });
  }

  global.SignUI = {
    h: h,
    $: $,
    $$: $$,
    toolIcon: toolIcon,
    alignmentControl: alignmentControl,
    paddingIcon: paddingIcon,
    bindPaddingScrub: bindPaddingScrub,
    toast: toast,
    confirmDialog: confirmDialog,
    promptDialog: promptDialog,
  };
})(typeof window !== 'undefined' ? window : globalThis);
