/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * interact.js — 编辑区交互层
 *
 * 覆盖层（HTML）承载行手柄/行按钮/拖放指示器，SVG 保持纯净可导出。
 * - 点击元素选中 / 点击空白取消选中
 * - 元素指针拖拽：行内排序 + 跨行移动（插入指示器 + 幽灵副本）
 * - 行手柄"≡"拖拽：整行排序（仅行数 > 1）
 * - 左栏卡片/预设 HTML5 拖放：新元素入行 / 预设替换空行
 * - 行管理：添加行 / 删除行（确认）/ 存为预设
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var State = global.SignState;
  var Directions = global.SignDirections;
  var Render = global.SignRender;
  var UI = global.SignUI;
  var App = global.App;
  var h = UI.h;

  var overlay, svg, elIndicator, rowIndicator, canvasScroll, elementToolbar, palettePreview;
  var positionMode, positionMovement, resetPositionButton;
  var toolbarAlignments = [];
  var toolbarPaddingControls = [];
  var toolbarTurnControls;
  var suppressClick = false;
  var pagePointer = null;
  var selectionControls = 'button, input, select, textarea, label, a, summary, [contenteditable], [role="button"], [role="tab"], .palette-card, .preset-card, .row-handle, .field, .panel-section, .padding-editor, .panel-header, #element-toolbar, .modal-mask, .toast';

  var MIME_NEW = 'application/x-sign-new';
  var MIME_PRESET = 'application/x-sign-preset';

  function init() {
    overlay = document.getElementById('sign-overlay');
    svg = document.getElementById('sign-svg');
    canvasScroll = document.getElementById('canvas-scroll');
    elementToolbar = document.getElementById('element-toolbar');
    buildElementToolbar();
    canvasScroll.addEventListener('scroll', positionElementToolbar);
    window.addEventListener('resize', positionElementToolbar);
    if (window.ResizeObserver) new ResizeObserver(positionElementToolbar).observe(canvasScroll);

    elIndicator = h('div', { id: 'element-drop-indicator' });
    rowIndicator = h('div', { id: 'row-drop-indicator' });
    overlay.appendChild(elIndicator);
    overlay.appendChild(rowIndicator);

    // Pointer Events 一套代码服务鼠标 + 触屏 + 笔（会话按 pointerId 锁定）
    svg.addEventListener('pointerdown', onElementPointerDown);
    document.addEventListener('pointerdown', onPagePointerDown, true);
    document.addEventListener('pointermove', onPagePointerMove, true);
    document.addEventListener('pointerup', onPagePointerUp, true);
    document.addEventListener('pointercancel', onPagePointerCancel, true);
    window.addEventListener('blur', function () { pagePointer = null; finishRowDrag(false, false); });
    document.addEventListener('click', onPageClick);
    document.addEventListener('keydown', onKeyDown);
    document.getElementById('add-row-btn').addEventListener('click', function () {
      App.update(State.addRow);
    });

    var wrap = document.getElementById('canvas-wrap');
    palettePreview = document.createElementNS(Core.SVG_NS, 'svg');
    palettePreview.classList.add('palette-drop-preview');
    palettePreview.setAttribute('aria-hidden', 'true');
    palettePreview.setAttribute('hidden', '');
    wrap.appendChild(palettePreview);
    positionMode = document.getElementById('guidance-position-mode');
    positionMovement = global.ElementAlignment.create({
      paper: wrap,
      graphic: svg,
      toggle: document.getElementById('guidance-alignment'),
      identifierAt: function (target) {
        if (!freeMovementEnabled()) return null;
        return target.closest('g.element')?.getAttribute('data-element-id');
      },
      select: selectPositionElements,
      rowDistance: function (selection, position) {
        var target = Math.floor(position / selection.rowHeight);
        return Core.clamp(target - selection.sourceRow, selection.firstRowDistance, selection.lastRowDistance);
      },
      preview: previewFreeMovement,
      commit: function (selection, distance, rowDistance) {
        if (!App.selectedIds().includes(selection.identifier)) App.select(selection.identifier);
        var sign = Render.moveFreeElements(App.state, App.layout, selection.identifiers, distance, rowDistance);
        App.update(function () { return sign; });
      },
    });
    positionMode.addEventListener('click', function () {
      cancelElementDrag();
      positionMovement.cancel();
      positionMode.setAttribute('aria-pressed', String(!freeMovementEnabled()));
      syncElementToolbar();
    });
    wrap.addEventListener('dragover', onPaletteDragOver);
    wrap.addEventListener('drop', onPaletteDrop);
    wrap.addEventListener('dragleave', onPaletteDragLeave);
    document.addEventListener('dragstart', function (event) {
      paletteDragActive = Boolean(readDragKind(event));
      paletteDragCancelled = false;
      palettePayload = readDragKind(event) === 'new' ? readDragPayload(event, 'new') : null;
    });
    document.addEventListener('dragend', function () {
      resetPaletteDrop();
      palettePayload = null;
      paletteDragActive = paletteDragCancelled = false;
    });
  }

  // ─── 覆盖层渲染 ────────────────────────────────────────────

  function renderOverlay(layout, state) {
    positionMovement?.cancelActive();
    finishRowDrag(false, false);
    resetPaletteDrop();
    // 保留两个指示器（挂在 overlay 底部），清掉其余
    Array.prototype.slice.call(overlay.children).forEach(function (child) {
      if (child !== elIndicator && child !== rowIndicator) child.remove();
    });
    hideIndicators();

    var totalH = layout.height || 1;
    state.rows.forEach(function (row, i) {
      var rl = layout.rows[i];
      var band = h('div', {
        class: 'row-band',
        'data-row-index': i,
        style: {
          top: (rl.y / totalH * 100) + '%',
          height: (rl.height / totalH * 100) + '%',
        },
      });

      if (state.rows.length > 1) {
        var handle = h('div', { class: 'row-handle', title: '拖动调整行顺序', text: '≡' });
        handle.addEventListener('pointerdown', function (ev) {
          // 触控拖动由样式限制，取消默认行为会导致部分浏览器无法正常点击。
          if (ev.pointerType === 'mouse') ev.preventDefault();
          ev.stopPropagation();
          startRowDrag(ev, i);
        });
        band.appendChild(handle);
      }

      var actions = h('div', { class: 'row-actions' });
      var saveBtn = SignUI.presetSaveButton(function (ev) {
        ev.stopPropagation();
        saveRowAsPreset(i);
      }, { title: '将此行保存为预设' });
      var delBtn = h('button', {
        class: 'row-del', text: '删除行', 'data-control-icon': 'delete',
        title: state.rows.length > 1 ? '删除此行' : '至少保留一行',
      });
      if (state.rows.length <= 1) delBtn.disabled = true;
      delBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        confirmDeleteRow(i);
      });
      actions.appendChild(saveBtn);
      actions.appendChild(delBtn);
      band.appendChild(actions);

      overlay.appendChild(band);
    });

    var empty = state.rows.every(function (r) { return r.elements.length === 0; });
    document.getElementById('empty-hint').hidden = !empty;
    syncElementToolbar();
  }

  function selectPositionElements(identifier) {
    var identifiers = App.selectedIds();
    // 触摸期间重绘原图会移除指针按下的位置，浏览器可能就此停止发送拖动事件。
    if (!identifiers.includes(identifier)) identifiers = [identifier];
    var selected = new Set(identifiers);
    var elements = App.layout.rows.flatMap(function (row) { return row.elements; });
    var boxes = elements.filter(function (element) { return selected.has(element.id); }).map(function (element) { return element.box; });
    if (!boxes.length) return null;
    var moving = global.ElementAlignment.selectionBounds(boxes);
    var canvasWidth = App.layout.width;
    var selectedRows = App.layout.rows.map(function (row, index) {
      return row.elements.some(function (element) { return selected.has(element.id); }) ? index : -1;
    }).filter(function (index) { return index >= 0; });
    return {
      identifier: identifier,
      identifiers: identifiers,
      moving: moving,
      others: elements.filter(function (element) { return !selected.has(element.id); }).map(function (element) { return element.box; }),
      canvasWidth: canvasWidth,
      limits: global.ElementAlignment.limitsWithinCanvas(boxes, canvasWidth),
      rowHeight: App.state.rowHeight,
      sourceRow: State.findElement(App.state, identifier).rowIndex,
      firstRowDistance: -selectedRows[0],
      lastRowDistance: App.layout.rows.length - 1 - selectedRows[selectedRows.length - 1],
    };
  }

  function freeMovementEnabled() {
    return positionMode.getAttribute('aria-pressed') === 'true';
  }

  function previewFreeMovement(preview, selection, distance, rowDistance) {
    var style = getComputedStyle(elementToolbar);
    var duration = parseFloat(style.getPropertyValue('--motion-control-duration'));
    var previousPositions = new Map();
    var readElements = preview.firstElementChild ? preview : svg;
    var selected = new Set(selection.identifiers);
    if (duration > 0) {
      readElements.querySelectorAll('g.element').forEach(function (node) {
        var identifier = node.getAttribute('data-element-id');
        if (!selected.has(identifier)) previousPositions.set(identifier, node.getCTM()?.e);
      });
    }
    var moved = Render.moveFreeElements(App.state, App.layout, selection.identifiers, distance, rowDistance);
    var next = State.applyPaddingAuto(moved);
    var layout = Render.renderSignInto(preview, next, App.measure, { selectedElementIds: selection.identifiers });
    var displayedScale = preview.getBoundingClientRect().width / layout.width;
    if (previousPositions.size && displayedScale) {
      preview.querySelectorAll('g.element').forEach(function (node) {
        var previous = previousPositions.get(node.getAttribute('data-element-id'));
        var offset = (previous - node.getCTM()?.e) / displayedScale;
        if (Math.abs(offset) > 0.5 && typeof node.animate === 'function') {
          node.animate([{ translate: offset + 'px 0px' }, { translate: '0px 0px' }], {
            duration: duration, easing: style.getPropertyValue('--motion-enter').trim(),
          });
        }
      });
    }
    var boxes = layout.rows.flatMap(function (row) { return row.elements; }).filter(function (element) {
      return selected.has(element.id);
    }).map(function (element) { return element.box; });
    var actual = global.ElementAlignment.selectionBounds(boxes);
    return Math.abs(actual.x - selection.moving.x - distance) < 0.01 && Math.abs(actual.width - selection.moving.width) < 0.01;
  }

  // ─── 选中元素的浮动操作栏（HTML，不参与SVG导出）──────────────

  function actionIcon(path) {
    var icon = document.createElementNS(Core.SVG_NS, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    return icon;
  }

  function buildToolbarPadding(side) {
    var label = side === 'left' ? '左内边距' : '右内边距';
    var trigger = h('button', { type: 'button', class: 'padding-trigger', 'aria-label': '自定义' + label }, [UI.paddingIcon(side)]);
    var display = h('span', { class: 'padding-current', 'aria-live': 'polite' });
    trigger.appendChild(display);
    var input = h('input', {
      type: 'number', min: '0', max: '8', step: 'any', tabindex: '-1',
      'aria-label': '自定义' + label + '（行高比例）', title: label + '（行高比例，0–8）',
    });
    var valueBox = h('div', { class: 'padding-value' }, [trigger, input]);
    var stepper = h('div', { class: 'padding-stepper' });
    var group = h('div', { class: 'toolbar-group toolbar-padding', 'data-padding': side, role: 'group', 'aria-label': label }, [valueBox, stepper]);
    var boundId = null;
    function current() { return State.findElement(App.state, App.selection.elementId); }
    function reset() {
      var value = App.paddingValue(side);
      input.value = value === null ? '' : value;
      input.placeholder = value === null ? '不同' : '';
      display.textContent = value === null ? '不同' : String(value);
    }
    function commit() {
      var found = current(), raw = input.value.trim(), value = Number(raw);
      if (!found || !App.paddingIds().length || !raw || !isFinite(value)) { reset(); return; }
      App.setPadding(side, Core.clamp(value, 0, 8));
      reset();
    }
    UI.bindPaddingScrub(trigger, side, function () { return App.selection.elementId; });
    trigger.addEventListener('click', function () {
      reset();
      valueBox.classList.add('editing');
      input.focus();
      input.select();
    });
    input.addEventListener('change', commit);
    input.addEventListener('focus', function () { valueBox.classList.add('editing'); });
    input.addEventListener('blur', function () {
      reset();
      valueBox.classList.remove('editing');
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.key === 'Enter') commit();
        else reset();
        input.blur();
      }
    });
    [true, false].forEach(function (increase) {
      var btn = h('button', {
        type: 'button', 'data-action': side + (increase ? '-plus' : '-minus'),
        'aria-label': (increase ? '增加' : '减少') + label,
        title: (increase ? '增加' : '减少') + label + '（每次 0.05 行高）',
      }, [actionIcon(increase ? 'm7 14 5-5 5 5' : 'm7 10 5 5 5-5')]);
      btn.addEventListener('click', function () {
        App.adjustPadding(side, increase ? 0.05 : -0.05);
      });
      stepper.appendChild(btn);
    });
    toolbarPaddingControls.push(function (found) {
      var disabled = !App.paddingIds().length;
      input.disabled = trigger.disabled = disabled;
      var signature = App.selectedIds().join(',');
      if (boundId !== signature || document.activeElement !== input) reset();
      boundId = signature;
      trigger.title = label + '：' + input.value + ' × 行高（左右拖动，每档0.05；点击输入）';
    });
    return group;
  }

  function arrowDirection(element) {
    if (element.type === 'arrow') return element.props.direction;
    if (element.type === 'icon') {
      return Directions.items.find(function (item) { return item.icon === element.props.icon; })?.direction;
    }
  }

  function buildToolbarTurnControls() {
    var group = h('div', { class: 'toolbar-group', role: 'group', 'aria-label': '箭头转向', hidden: '' });
    [
      { step: -1, icon: 'turn-counterclockwise', label: '逆时针转向 45°' },
      { step: 1, icon: 'turn-clockwise', label: '顺时针转向 45°' },
    ].forEach(function (control) {
      var button = h('button', { type: 'button', 'data-control-icon': control.icon, title: control.label, 'aria-label': control.label });
      button.addEventListener('click', function (event) {
        event.stopPropagation();
        var identifier = App.selection.elementId;
        if (!identifier || App.selectedIds().length !== 1) return;
        App.update(function (state) {
          var found = State.findElement(state, identifier);
          if (!found) return state;
          var direction = Directions.turn(arrowDirection(found.element), control.step);
          if (!direction) return state;
          var patch = found.element.type === 'arrow' ? { direction: direction } : { icon: Directions.identifier(direction) };
          return State.updateElementProps(state, identifier, patch);
        });
      });
      group.appendChild(button);
    });
    return group;
  }

  function buildElementToolbar() {
    var actions = [
      { key: 'move-left', group: '移动元素', label: '向左移动元素', path: 'M19 12H5m6-6-6 6 6 6' },
      { key: 'move-right', group: '移动元素', label: '向右移动元素', path: 'M5 12h14m-6-6 6 6-6 6' },
      { key: 'delete', group: '管理元素', label: '删除元素', icon: 'delete' },
    ];
    var actionRow = h('div', { class: 'toolbar-actions' });
    var groups = {};
    elementToolbar.appendChild(actionRow);
    actions.forEach(function (action) {
      if (action.key === 'delete') {
        actionRow.appendChild(buildToolbarPadding('left'));
        actionRow.appendChild(buildToolbarPadding('right'));
        toolbarTurnControls = buildToolbarTurnControls();
        actionRow.appendChild(toolbarTurnControls);
      }
      if (!groups[action.group]) {
        groups[action.group] = h('div', { class: 'toolbar-group', role: 'group', 'aria-label': action.group });
        actionRow.appendChild(groups[action.group]);
      }
      var btn = h('button', {
        type: 'button', 'data-action': action.key, 'aria-label': action.label,
        title: action.label,
        'data-control-icon': action.icon,
      }, action.path ? [actionIcon(action.path)] : []);
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var id = App.selection.elementId;
        if (!id || !State.findElement(App.state, id)) return;
        if (action.key === 'delete') {
          App.deleteSelection();
          UI.toast('选中元素已删除');
          return;
        }
        if (action.key === 'move-left' || action.key === 'move-right') {
          if (freeMovementEnabled()) return;
          var direction = action.key === 'move-left' ? -1 : 1;
          var moved = Render.moveVisualElementsBy(App.state, App.layout, App.selectedIds(), direction);
          App.update(function () { return moved; });
        }
      });
      groups[action.group].appendChild(btn);
    });
    resetPositionButton = h('button', { type: 'button', 'data-action': 'reset-position', text: '恢复排版', hidden: '' });
    resetPositionButton.addEventListener('click', function () {
      var identifiers = App.selectedIds();
      App.update(function (state) { return State.resetElementPositions(state, identifiers); });
    });
    actionRow.appendChild(resetPositionButton);
    var alignRow = h('div', { class: 'toolbar-alignments' });
    elementToolbar.appendChild(alignRow);
    [
      { key: 'align', label: '文字对齐', labels: ['文字左对齐', '文字居中', '文字右对齐'] },
      { key: 'contentAlign', label: '内容对齐', labels: ['内容左对齐', '内容右对齐'] },
    ].forEach(function (config) {
      var values = config.labels.length === 2 ? ['left', 'right'] : ['left', 'center', 'right'];
      var control = UI.alignmentControl(values.map(function (value, i) {
        return { value: value, label: config.labels[i] };
      }), function () {
        return App.alignmentValue(config.key);
      }, function (value) {
        var id = App.selection.elementId;
        if (!id || !State.findElement(App.state, id) || control.node.hidden) return;
        App.setAlignment(config.key, value);
      }, config.label, config.key);
      alignRow.appendChild(control.node);
      toolbarAlignments.push({ config: config, control: control });
    });
  }

  function syncElementToolbar() {
    if (!elementToolbar) return;
    var id = App.selection.elementId;
    var found = id && State.findElement(App.state, id);
    document.getElementById('center-panel').classList.toggle('has-element-selection', !!found);
    global.EditorMotion.setToolbarVisible(elementToolbar, !!found);
    if (!found) return;
    resetPositionButton.hidden = !App.selectedIds().some(function (identifier) {
      return State.findElement(App.state, identifier).element.props.positionOffset;
    });
    toolbarTurnControls.hidden = App.selectedIds().length !== 1 || !Directions.canTurn(arrowDirection(found.element));
    toolbarPaddingControls.forEach(function (sync) { sync(found); });
    toolbarAlignments.forEach(function (item) {
      item.control.node.hidden = !App.alignmentTargets(item.config.key).length;
      item.control.sync();
    });
    elementToolbar.querySelector('.toolbar-alignments').hidden = toolbarAlignments.every(function (item) { return item.control.node.hidden; });
    elementToolbar.querySelector('[data-action="move-left"]').disabled = freeMovementEnabled() || Render.moveVisualElementsBy(App.state, App.layout, App.selectedIds(), -1) === App.state;
    elementToolbar.querySelector('[data-action="move-right"]').disabled = freeMovementEnabled() || Render.moveVisualElementsBy(App.state, App.layout, App.selectedIds(), 1) === App.state;
    ['left', 'right'].forEach(function (side) {
      var values = App.paddingIds().map(function (paddingId) { return State.findElement(App.state, paddingId).element.props.padding[side]; });
      elementToolbar.querySelector('[data-action="' + side + '-minus"]').disabled = !values.some(function (v) { return v > 0; });
      elementToolbar.querySelector('[data-action="' + side + '-plus"]').disabled = !values.some(function (v) { return v < 8; });
    });
    positionElementToolbar();
  }

  function positionElementToolbar() {
    if (!elementToolbar || elementToolbar.hidden || !svg) return;
    // 不插入DOM，也不重建按钮：移动/调边距后焦点仍留在当前按钮。
    var selected = Array.prototype.slice.call(svg.querySelectorAll('g.element.selected'));
    if (!selected.length) {
      global.EditorMotion.setToolbarVisible(elementToolbar, false);
      return;
    }
    var area = canvasScroll.getBoundingClientRect();
    var right = area.left + canvasScroll.clientWidth;
    var bottom = area.top + canvasScroll.clientHeight - parseFloat(getComputedStyle(canvasScroll).paddingBottom);
    var centerPanel = document.getElementById('center-panel');
    var center = centerPanel.getBoundingClientRect();
    var rects = selected.map(function (node) { return node.getBoundingClientRect(); });
    var el = { left: Math.min.apply(null, rects.map(function (r) { return r.left; })),
      right: Math.max.apply(null, rects.map(function (r) { return r.right; })),
      top: Math.min.apply(null, rects.map(function (r) { return r.top; })),
      bottom: Math.max.apply(null, rects.map(function (r) { return r.bottom; })) };
    elementToolbar.style.maxWidth = Math.max(80, canvasScroll.clientWidth - 16) + 'px';
    var size = { width: elementToolbar.offsetWidth, height: elementToolbar.offsetHeight };
    // 工具栏换行后可能盖住加行按钮。
    centerPanel.style.setProperty('--element-toolbar-gap', Math.ceil(size.height + 12) + 'px');
    var left = Core.clamp((el.left + el.right - size.width) / 2, area.left + 8, right - size.width - 8);
    var top = el.bottom + 8;
    if (top + size.height > bottom - 8) top = el.top - size.height - 8;
    top = Core.clamp(top, area.top + 8, Math.max(area.top + 8, bottom - size.height - 8));
    global.EditorMotion.placeToolbar(elementToolbar, Math.round(left - center.left), Math.round(top - center.top), App.selection.elementId);
  }

  function hideIndicators() {
    elIndicator.style.display = 'none';
    rowIndicator.style.display = 'none';
    clearRowHighlights();
  }

  function rowBandByIndex(i) {
    return overlay.querySelector('.row-band[data-row-index="' + i + '"]');
  }

  function clearRowHighlights() {
    UI.$$('.row-band', overlay).forEach(function (b) {
      b.classList.remove('drop-ok', 'drop-invalid');
    });
  }

  // ─── 坐标换算 ──────────────────────────────────────────────

  /** 屏幕坐标 → 标识牌坐标 */
  function toSignPoint(ev) {
    var rect = svg.getBoundingClientRect();
    var layout = App.layout;
    if (!layout || rect.width === 0) return null;
    return {
      x: (ev.clientX - rect.left) * layout.width / rect.width,
      y: (ev.clientY - rect.top) * layout.height / rect.height,
    };
  }

  function rowIndexAt(y) {
    var layout = App.layout;
    if (!layout) return -1;
    for (var i = 0; i < layout.rows.length; i++) {
      var r = layout.rows[i];
      if (y >= r.y && y < r.y + r.height) return i;
    }
    return -1;
  }

  /**
   * 指针 x 处的落点：{ gap, indicatorX }。gap 为数组间隙序号（moveElement 语义，含被拖元素）。
   * 固定宽度下元素按「元素对齐」分三条通道：左/中通道的数组序 = 视觉序（自左向右），
   * 贴右通道的数组序与视觉序相反（数组靠前者贴右缘）。
   * 因此按被拖元素自身通道计算通道内间隙，再映射回数组间隙与指示线位置：
   * - 左/中：通道内间隙 = 中点在指针左侧的元素数，指示线在该元素左缘
   * - 贴右：通道内间隙 = 中点在指针右侧的元素数，指示线在该元素右缘
   * draggedWidth（可选）：拖入空通道时用于给出指示线的实际落点（居中通道需按宽度居中）。
   */
  function dropTargetAt(rowIndex, x, align, draggedWidth) {
    var rowLayout = App.layout.rows[rowIndex];
    var slots = rowLayout.elements;
    var row = App.state.rows[rowIndex];
    if (row.elements.some(element => element.props.positionOffset?.anchor)) {
      var next = slots.findIndex(slot => x <= slot.box.x + slot.box.width / 2);
      var last = slots[slots.length - 1].box;
      return next < 0 ? { gap: slots.length, indicatorX: last.x + last.width }
        : { gap: next, indicatorX: slots[next].box.x };
    }
    var fixed = App.state.widthMode === 'fixed';
    var lane = fixed && align === 'right' ? 'right'
      : (fixed && align === 'center' ? 'center' : 'left');
    var laneIdx = [];
    for (var i = 0; i < slots.length; i++) {
      var el = row && row.elements[i];
      var a = fixed && el && el.props ? el.props.elementAlign : 'left';
      if (a !== 'right' && a !== 'center') a = 'left';
      if (a === lane) laneIdx.push(i);
    }
    if (laneIdx.length === 0) {
      // 通道内暂无元素：左/中落在内容起点（居中按元素宽度落在牌面中央），
      // 贴右落在牌面右缘
      if (lane === 'center') {
        return {
          gap: slots.length,
          indicatorX: Math.max(0, (App.layout.width - (draggedWidth || 0)) / 2),
        };
      }
      return { gap: slots.length, indicatorX: lane === 'right' ? App.layout.width : 0 };
    }
    var j = 0, gap, indicatorX;
    if (lane === 'right') {
      while (j < laneIdx.length && slots[laneIdx[j]].x + slots[laneIdx[j]].width / 2 > x) j++;
      // 数组靠前者贴右缘：指针右侧的通道元素数 = 落点之前的数组位置
      gap = j === 0 ? laneIdx[0] : laneIdx[j - 1] + 1;
      indicatorX = j === 0
        ? slots[laneIdx[0]].x + slots[laneIdx[0]].width
        : (j < laneIdx.length ? slots[laneIdx[j]].x + slots[laneIdx[j]].width
                              : slots[laneIdx[laneIdx.length - 1]].x);
    } else {
      while (j < laneIdx.length && slots[laneIdx[j]].x + slots[laneIdx[j]].width / 2 < x) j++;
      gap = j < laneIdx.length ? laneIdx[j] : laneIdx[laneIdx.length - 1] + 1;
      indicatorX = j < laneIdx.length ? slots[laneIdx[j]].x
        : slots[laneIdx[laneIdx.length - 1]].x + slots[laneIdx[laneIdx.length - 1]].width;
    }
    return { gap: gap, indicatorX: indicatorX };
  }

  /** 指针 x 处的落点数组间隙序号（align 缺省按左通道；兼容旧调用） */
  function gapIndexAt(rowIndex, x, align) {
    return dropTargetAt(rowIndex, x, align).gap;
  }

  // ─── 点击选中 ──────────────────────────────────────────────

  function onPagePointerDown(ev) {
    if (ev.button !== 0 || ev.isPrimary === false) return;
    var target = ev.target;
    pagePointer = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false,
      control: !!(target && target.closest && target.closest(selectionControls)) };
  }

  function onPagePointerMove(ev) {
    if (!pagePointer || pagePointer.id !== ev.pointerId) return;
    pagePointer.moved = pagePointer.moved || Math.hypot(ev.clientX - pagePointer.x, ev.clientY - pagePointer.y) > 5;
  }

  function onPagePointerUp(ev) {
    if (!pagePointer || pagePointer.id !== ev.pointerId) return;
    onPagePointerMove(ev);
    // 拖选跨出输入框时，click落在共同祖先；必须保留按下位置的语义。
    if (pagePointer.control || pagePointer.moved) suppressNextClick();
    pagePointer = null;
  }

  function onPagePointerCancel(ev) {
    if (pagePointer && pagePointer.id === ev.pointerId) pagePointer = null;
  }

  function onPageClick(ev) {
    if (suppressClick) { suppressClick = false; return; }
    var target = ev.target;
    if (!target || !target.closest || ev.defaultPrevented) return;
    if (document.querySelector('.modal-mask, dialog.project-dialog[open]')) return;
    var g = target.closest('g.element');
    if (g && svg.contains(g)) {
      App.select(g.getAttribute('data-element-id'), { toggle: ev.ctrlKey || ev.metaKey, range: ev.shiftKey });
      return;
    }
    if (!App.selection.elementId) return;
    // 页面空白取消选择，编辑控件及其标签/分组仍用于当前元素。
    if (target.closest(selectionControls)) return;
    App.select(null);
  }

  function suppressNextClick() {
    suppressClick = true;
    // pointerup 后紧跟的 click 属于刚结束的拖动；未产生 click 时立即过期。
    setTimeout(function () { suppressClick = false; }, 0);
  }

  // ─── 键盘：撤销/重做与删除（输入控件保留原生文本编辑）──────

  function onKeyDown(ev) {
    if (ev.defaultPrevented || ev.isComposing) return;
    if (App.projects?.busy || document.querySelector('dialog.project-dialog[open]')) return;
    if (ev.key === 'Escape' && rowDrag) { ev.preventDefault(); finishRowDrag(false); return; }
    // 焦点在输入控件内时不拦截（文本编辑优先）
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // 模态对话框打开时不响应
    if (document.querySelector('.modal-mask')) return;
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'a') {
      ev.preventDefault(); App.selectAll(); return;
    }
    if (ev.key === 'Escape' && App.selection.elementId) {
      ev.preventDefault(); cancelElementDrag(); App.select(null); return;
    }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) App.redo();
      else App.undo();
      return;
    }
    if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    if (!App.selection.elementId) return;
    ev.preventDefault();
    App.deleteSelection();
  }

  // ─── 元素指针拖拽（行内排序 / 跨行移动）────────────────────

  var elemDrag = null; // {elementId, rowId, pointerId, active, ghost, dx, dy, startX, startY, target}

  function onElementPointerDown(ev) {
    if (freeMovementEnabled()) return;
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    var g = ev.target.closest ? ev.target.closest('g.element') : null;
    if (!g) return; // 空白处按下 → 冒泡为取消选中（click 处理）

    var elementId = g.getAttribute('data-element-id');
    var rowId = g.getAttribute('data-row-id');
    elemDrag = {
      elementId: elementId,
      ids: App.selectedIds().indexOf(elementId) >= 0 ? App.selectedIds() : [elementId],
      rowId: rowId,
      pointerId: ev.pointerId, // 会话锁定该指针：其他指针（如捏合第二指）的事件一律忽略
      active: false,
      ghost: null,
      startX: ev.clientX,
      startY: ev.clientY,
      dx: 0, dy: 0,
    };
    document.addEventListener('pointermove', onElementDragMove);
    document.addEventListener('pointerup', onElementDragEnd);
    document.addEventListener('pointercancel', onElementDragEnd);
    if (ev.pointerType === 'mouse') ev.preventDefault();
  }

  function activateElementDrag(ev) {
    if (App.selectedIds().indexOf(elemDrag.elementId) < 0) App.select(elemDrag.elementId);
    var g = svg.querySelector('g.element[data-element-id="' + elemDrag.elementId + '"]');
    if (!g) { elemDrag = null; return; }
    var rect = g.getBoundingClientRect();
    // 元素在标识牌坐标系中的尺寸
    var found = State.findElement(App.state, elemDrag.elementId);
    if (!found) { elemDrag = null; return; }
    var layoutRow = App.layout.rows.find(function (r) { return r.id === elemDrag.rowId; });
    var slot = layoutRow && layoutRow.elements.find(function (s) { return s.id === elemDrag.elementId; });
    if (!slot) { elemDrag = null; return; }

    var slots = [];
    App.layout.rows.forEach(function (row) { row.elements.forEach(function (s) {
      if (elemDrag.ids.indexOf(s.id) >= 0) slots.push({ id: s.id, ...s.box });
    }); });
    var left = Math.min.apply(null, slots.map(function (s) { return s.x; }));
    var top = Math.min.apply(null, slots.map(function (s) { return s.y; }));
    var viewBoxW = Math.max.apply(null, slots.map(function (s) { return s.x + s.width; })) - left;
    var viewBoxH = Math.max.apply(null, slots.map(function (s) { return s.y + s.height; })) - top;
    var svgRect = svg.getBoundingClientRect(), scale = svgRect.width / App.layout.width;
    rect = { left: svgRect.left + left * scale, top: svgRect.top + top * scale, width: viewBoxW * scale, height: viewBoxH * scale };

    var ghostSvg = document.createElementNS(Core.SVG_NS, 'svg');
    ghostSvg.setAttribute('viewBox', left + ' ' + top + ' ' + Math.max(1, viewBoxW) + ' ' + viewBoxH);
    ghostSvg.style.width = rect.width + 'px';
    ghostSvg.style.height = rect.height + 'px';
    slots.forEach(function (s) {
      var node = svg.querySelector('g.element[data-element-id="' + s.id + '"]');
      if (!node) return;
      var clone = node.cloneNode(true);
      clone.removeAttribute('class');
      var hit = clone.querySelector('.hitbox'); if (hit) hit.remove();
      ghostSvg.appendChild(clone);
      node.classList.add('dragging');
    });

    var ghost = h('div', { class: 'drag-ghost' });
    ghost.appendChild(ghostSvg);
    document.body.appendChild(ghost);

    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';

    g.classList.add('dragging');
    elemDrag.ghost = ghost;
    elemDrag.dx = ev.clientX - rect.left;
    elemDrag.dy = ev.clientY - rect.top;
    elemDrag.active = true;
    document.body.classList.add('drag-in-progress');
  }

  function onElementDragMove(ev) {
    if (!elemDrag || ev.pointerId !== elemDrag.pointerId) return;
    if (!elemDrag.active) {
      if (Math.abs(ev.clientX - elemDrag.startX) + Math.abs(ev.clientY - elemDrag.startY) < 5) return;
      activateElementDrag(ev);
      if (!elemDrag) return;
    }
    elemDrag.ghost.style.left = (ev.clientX - elemDrag.dx) + 'px';
    elemDrag.ghost.style.top = (ev.clientY - elemDrag.dy) + 'px';

    elemDrag.target = null;
    var pt = toSignPoint(ev);
    clearRowHighlights();
    if (!pt) return;
    var ri = rowIndexAt(pt.y);
    if (ri === -1) { elIndicator.style.display = 'none'; return; }
    var rowId = App.state.rows[ri].id;
    // 不能把元素放进…（任何行都可以，包括源行）
    var dragFound = State.findElement(App.state, elemDrag.elementId);
    var dragAlign = dragFound ? dragFound.element.props.elementAlign : null;
    // 拖入空通道时指示线需按被拖元素宽度定位（居中通道）
    var dragWidth = 0;
    App.layout.rows.forEach(function (r) {
      r.elements.forEach(function (s) {
        if (elemDrag.ids.indexOf(s.id) >= 0) {
          var candidate = State.findElement(App.state, s.id);
          if (App.state.widthMode !== 'fixed' || (candidate && candidate.element.props.elementAlign === dragAlign)) dragWidth += s.width;
        }
      });
    });
    var target = dropTargetAt(ri, pt.x, dragAlign, dragWidth);
    showElementIndicator(ri, target.indicatorX);
    rowBandByIndex(ri).classList.add('drop-ok');
    elemDrag.target = { rowId: rowId, gap: target.gap };
  }

  function showElementIndicator(rowIndex, xUnits) {
    var layout = App.layout;
    var rl = layout.rows[rowIndex];
    elIndicator.style.display = 'block';
    elIndicator.style.left = (xUnits / layout.width * 100) + '%';
    elIndicator.style.top = (rl.y / layout.height * 100) + '%';
    elIndicator.style.height = (rl.height / layout.height * 100) + '%';
  }

  function onElementDragEnd(ev) {
    if (!elemDrag || ev.pointerId !== elemDrag.pointerId) return;
    detachElementDragListeners();
    var session = elemDrag;
    elemDrag = null;
    document.body.classList.remove('drag-in-progress');

    if (session.ghost) session.ghost.remove();
    session.ids.forEach(function (id) {
      var g = svg.querySelector('g.element[data-element-id="' + id + '"]');
      if (g) g.classList.remove('dragging');
    });
    hideIndicators();

    if (!session.active) return; // 未构成拖拽 → 交给 click 处理选中
    suppressNextClick();

    if (session.target && ev.type !== 'pointercancel') {
      App.update(function (st) {
        return State.moveElements(st, session.ids, session.target.rowId, session.target.gap);
      });
    }
  }

  function detachElementDragListeners() {
    document.removeEventListener('pointermove', onElementDragMove);
    document.removeEventListener('pointerup', onElementDragEnd);
    document.removeEventListener('pointercancel', onElementDragEnd);
  }

  function cancelElementDrag() {
    if (!elemDrag) return;
    detachElementDragListeners();
    var session = elemDrag;
    elemDrag = null;
    if (session.ghost) session.ghost.remove();
    session.ids.forEach(function (id) {
      var g = svg.querySelector('g.element[data-element-id="' + id + '"]');
      if (g) g.classList.remove('dragging');
    });
    hideIndicators();
    document.body.classList.remove('drag-in-progress');
  }

  // ─── 行拖拽排序 ────────────────────────────────────────────

  var rowDrag = null;

  function rowGraphics() { return Array.from(svg.querySelectorAll('.sign-row:not(.row-drag-ghost)')); }

  function startRowDrag(ev, fromIndex) {
    if (rowDrag || ev.button !== 0) return;
    var point = toSignPoint(ev);
    if (!point) return;
    rowDrag = { from: fromIndex, to: fromIndex, pointer: ev.pointerId, startY: point.y, clientY: ev.clientY };
    document.addEventListener('pointermove', onRowDragMove);
    document.addEventListener('pointerup', onRowDragEnd);
    document.addEventListener('pointercancel', onRowDragEnd);
  }

  function onRowDragMove(ev) {
    var drag = rowDrag;
    if (!drag || ev.pointerId !== drag.pointer) return;
    var point = toSignPoint(ev);
    if (!point) return;
    var layout = App.layout;
    var row = layout.rows[drag.from];
    if (!drag.ghost) {
      if (Math.abs(ev.clientY - drag.clientY) < 5) return;
      drag.graphics = rowGraphics();
      drag.bands = Array.from(overlay.querySelectorAll('.row-band'));
      drag.ghost = drag.graphics[drag.from].cloneNode(true);
      drag.ghost.classList.add('row-drag-ghost');
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.graphics[drag.from].classList.add('row-drag-source');
      svg.appendChild(drag.ghost);
      overlay.parentElement.dataset.movingElements = 'true';
      overlay.parentElement.dataset.sortingRows = 'true';
    }
    var boundary = layout.rows.filter(function (candidate) { return point.y > candidate.y + candidate.height / 2; }).length;
    drag.to = boundary > drag.from ? boundary - 1 : boundary;
    var distance = Core.clamp(point.y - drag.startY, -row.y, layout.height - row.y - row.height);
    drag.ghost.style.translate = '0 ' + distance + 'px';
    var scale = svg.getBoundingClientRect().height / layout.height;
    drag.graphics.forEach(function (node, index) {
      var offset = index >= drag.to && index < drag.from ? row.height : index > drag.from && index <= drag.to ? -row.height : 0;
      node.style.translate = offset ? '0 ' + offset + 'px' : '';
      drag.bands[index].style.translate = offset ? '0 ' + offset * scale + 'px' : '';
    });
    rowIndicator.style.display = 'block';
    rowIndicator.style.top = layout.rows[drag.to].y / layout.height * 100 + '%';
    rowIndicator.style.height = row.height / layout.height * 100 + '%';
  }

  function onRowDragEnd(ev) {
    if (!rowDrag || ev.pointerId !== rowDrag.pointer) return;
    if (ev.type === 'pointerup' && rowDrag.ghost) onRowDragMove(ev);
    finishRowDrag(ev.type === 'pointerup');
  }

  function finishRowDrag(commit, animate = true) {
    var drag = rowDrag;
    if (!drag) return;
    detachRowDragListeners();
    rowDrag = null;
    if (!drag.ghost) return;
    var previous = new Map();
    if (animate) drag.graphics.forEach(function (node, index) {
      var visible = index === drag.from ? drag.ghost : node;
      previous.set(node.dataset.rowId, visible.querySelector('.row-bg').getBoundingClientRect().top);
    });
    drag.ghost.remove();
    drag.graphics[drag.from].classList.remove('row-drag-source');
    drag.graphics.concat(drag.bands).forEach(function (node) { node.style.translate = ''; });
    delete overlay.parentElement.dataset.movingElements;
    delete overlay.parentElement.dataset.sortingRows;
    rowIndicator.style.display = 'none';
    if (commit && drag.to !== drag.from) App.update(function (state) { return State.moveRow(state, drag.from, drag.to); });
    if (!previous.size) return;
    var bounds = svg.getBoundingClientRect();
    var scale = bounds.height / App.layout.height;
    rowGraphics().forEach(function (node, index) {
      var offset = previous.get(node.dataset.rowId) - (bounds.top + App.layout.rows[index].y * scale);
      if (!scale || Math.abs(offset) < .5) return;
      var shift = function (target, distance) {
        global.EditorMotion.play(target, [{ translate: '0 ' + distance + 'px' }, { translate: '0px 0px' }]);
      };
      shift(node, offset / scale);
      shift(rowBandByIndex(index), offset);
    });
  }

  function detachRowDragListeners() {
    document.removeEventListener('pointermove', onRowDragMove);
    document.removeEventListener('pointerup', onRowDragEnd);
    document.removeEventListener('pointercancel', onRowDragEnd);
  }

  // ─── 左栏卡片 / 预设 拖放接收（HTML5 DnD）─────────────────

  function readDragKind(ev) {
    var types = ev.dataTransfer?.types || [];
    if (Array.prototype.indexOf.call(types, MIME_PRESET) !== -1) return 'preset';
    if (Array.prototype.indexOf.call(types, MIME_NEW) !== -1) return 'new';
    return null;
  }

  function readDragPayload(ev, kind) {
    var mime = kind === 'preset' ? MIME_PRESET : MIME_NEW;
    var raw = ev.dataTransfer.getData(mime) || ev.dataTransfer.getData('text/plain');
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function onPaletteDragOver(ev) {
    if (paletteDragCancelled || App.projects?.busy) return;
    var kind = readDragKind(ev);
    if (!kind) return; // 非本应用拖拽，不拦截
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';

    var pt = toSignPoint(ev);
    clearRowHighlights();
    elIndicator.style.display = 'none';
    if (!pt) { resetPaletteDrop(); return; }
    var ri = rowIndexAt(pt.y);
    if (ri === -1) { resetPaletteDrop(); return; }
    var band = rowBandByIndex(ri);
    var row = App.state.rows[ri];

    if (kind === 'new') {
      band.classList.add('drop-ok');
      // 新元素来自左栏默认属性（elementAlign: left），按左通道计算落点
      var t = dropTargetAt(ri, pt.x, 'left');
      showElementIndicator(ri, t.indicatorX);
      if (paletteDropTarget?.kind === kind && paletteDropTarget.rowId === row.id && paletteDropTarget.gap === t.gap) return;
      var element = paletteDropTarget?.element;
      var payload = element ? null : palettePayload || readDragPayload(ev, kind);
      if (payload?.type) element = State.createElement(payload.type, payload.props);
      paletteDropTarget = { kind: kind, rowId: row.id, gap: t.gap, element: element };
      if (element) showPalettePreview(paletteDropTarget);
    } else {
      // 预设仅可放入空行
      if (row.elements.length === 0) {
        band.classList.add('drop-ok');
        paletteDropTarget = { kind: kind, rowId: row.id };
      } else {
        band.classList.add('drop-invalid');
        paletteDropTarget = null;
      }
    }
  }

  var paletteDropTarget = null, palettePayload = null;

  function showPalettePreview(target) {
    var motion = global.EditorMotion;
    var source = palettePreview.hasAttribute('hidden') ? svg : palettePreview;
    var positions = new Map();
    if (motion.timing(svg).duration) source.querySelectorAll('g.element').forEach(function (node) {
      positions.set(node.getAttribute('data-element-id'), node.getCTM());
    });
    var baseline = Render.anchorExistingPositions(App.state, App.layout);
    var next = State.applyPaddingAuto(State.addElement(baseline, target.rowId, target.element, target.gap));
    var scale = svg.getBoundingClientRect().width / App.layout.width;
    palettePreview.removeAttribute('hidden');
    var layout = Render.renderSignInto(palettePreview, next, App.measure, { selectedElementIds: [target.element.id].concat(App.selectedIds()) });
    palettePreview.style.width = layout.width * scale + 'px';
    if (!scale || !positions.size) return;
    palettePreview.querySelectorAll('g.element').forEach(function (node) {
      var id = node.getAttribute('data-element-id'), from = positions.get(id), to = node.getCTM();
      if (!from || !to || id === target.element.id) return;
      var x = (from.e - to.e) / scale, y = (from.f - to.f) / scale;
      if (Math.hypot(x, y) > .5) motion.play(node, [{ translate: x + 'px ' + y + 'px' }, { translate: '0px 0px' }]);
    });
  }

  function resetPaletteDrop() {
    clearRowHighlights();
    elIndicator.style.display = 'none';
    paletteDropTarget = null;
    palettePreview.setAttribute('hidden', '');
    palettePreview.replaceChildren();
  }

  function onPaletteDragLeave(ev) {
    if (!ev.currentTarget.contains(ev.relatedTarget)) resetPaletteDrop();
  }

  function onPaletteDrop(ev) {
    ev.preventDefault();
    var kind = readDragKind(ev);
    var target = paletteDropTarget;
    resetPaletteDrop();
    if (paletteDragCancelled || !kind || kind !== target?.kind) return;
    var payload = readDragPayload(ev, kind);
    if (!payload) return;

    if (target.kind === 'new' && payload.type) {
      App.update(function (st) {
        return State.addElement(st, target.rowId, target.element || State.createElement(payload.type, payload.props), target.gap);
      });
    } else if (target.kind === 'preset' && payload.id) {
      var row = App.state.rows.find(function (item) { return item.id === target.rowId; });
      if (!row || row.elements.length !== 0) {
        SignUI.toast('预设只能放入空行', 'error');
        return;
      }
      var elements = SignPresets.materialize(payload.id);
      if (!elements || elements.length === 0) {
        SignUI.toast('预设内容为空', 'error');
        return;
      }
      App.update(function (st) {
        var rows = st.rows.map(function (r) {
          return r.id === target.rowId ? Object.assign({}, r, { elements: elements }) : r;
        });
        return Object.assign({}, st, { rows: rows });
      });
      SignUI.toast('已应用预设', 'success');
    }
  }

  // ─── 行管理动作 ────────────────────────────────────────────

  function confirmDeleteRow(index) {
    var rowId = App.state.rows[index].id;
    if (App.state.rows[index].elements.length === 0) {
      // 空行无内容可丢，直接删除免去确认
      App.update(function (st) { return State.deleteRow(st, rowId); });
      SignUI.toast('已删除空行');
      return;
    }
    SignUI.confirmDialog('确定要删除此行吗？行内 ' + App.state.rows[index].elements.length + ' 个元素将一并删除。', '删除行', '删除', 'delete').then(function (ok) {
      if (!ok) return;
      // 确认回调时行序可能已变，按 id 删而非按下标
      App.update(function (st) { return State.deleteRow(st, rowId); });
      SignUI.toast('行已删除');
    });
  }

  function saveRowAsPreset(index) {
    var row = App.state.rows[index];
    if (row.elements.length === 0) {
      SignUI.toast('空行不能保存为预设', 'error');
      return;
    }
    SignUI.promptDialog('为这一行元素起个名字：', '保存为预设', '', '如：站台方向牌').then(function (name) {
      if (name === null) return;
      if (!name) { SignUI.toast('预设名称不能为空', 'error'); return; }
      SignPresets.save(name, row.elements);
      SignUI.toast('预设「' + name + '」已保存', 'success');
    });
  }

  var paletteDragActive = false, paletteDragCancelled = false;
  function resetProject() {
    cancelElementDrag();
    finishRowDrag(false, false);
    positionMovement?.cancel();
    resetPaletteDrop();
    palettePayload = null;
    paletteDragCancelled = paletteDragActive;
    pagePointer = null;
    suppressClick = false;
  }

  global.SignInteract = {
    init: init,
    resetProject: resetProject,
    renderOverlay: renderOverlay,
    toSignPoint: toSignPoint,
    rowIndexAt: rowIndexAt,
    gapIndexAt: gapIndexAt,
    positionElementToolbar: positionElementToolbar,
    MIME_NEW: MIME_NEW,
    MIME_PRESET: MIME_PRESET,
  };
})(typeof window !== 'undefined' ? window : globalThis);
