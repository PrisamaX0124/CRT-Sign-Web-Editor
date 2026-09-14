/**
 * panel.js — 左栏元素选择区 + 右栏属性/设置面板 + 颜色选择器
 *
 * 右栏三种模式：元素属性（选中元素时）/ 预设预览 / 标识牌设置（默认）。
 * syncRightPanel() 采用签名机制：结构变化才重建 DOM，
 * 否则只做值同步（跳过焦点元素），保证输入过程不掉焦点。
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var State = global.SignState;
  var Render = global.SignRender;
  var Presets = global.SignPresets;
  var UI = global.SignUI;
  var App = global.App;
  var h = UI.h;

  var TYPE_NAMES = {
    'arrow': '箭头',
    'bilingual-text': '双语文本',
    'big-number': '大文本',
    'number-line': '数字线路',
    'text-line': '文本线路',
    'entrance': '出入口',
    'exit': '出口',
    'space': '空白占位',
    'icon': '图标',
  };

  // ─── 左栏：元素选择区 ──────────────────────────────────────

  // 方向指示 = js/icons.js 的 12 种方向图标（替代旧几何箭头元素）；
  // items 项为类型名（字符串）或 { type, icon, name }（预设属性的图标项）。
  var DIRECTION_ICONS = [
    { type: 'icon', icon: 'arrow_up', name: '向上' },
    { type: 'icon', icon: 'arrow_down', name: '向下' },
    { type: 'icon', icon: 'arrow_left', name: '向左' },
    { type: 'icon', icon: 'arrow_right', name: '向右' },
    { type: 'icon', icon: 'arrow_left_up', name: '左上' },
    { type: 'icon', icon: 'arrow_right_up', name: '右上' },
    { type: 'icon', icon: 'arrow_right_down', name: '右下' },
    { type: 'icon', icon: 'arrow_left_down', name: '左下' },
    { type: 'icon', icon: 'arrow_ahead_left', name: '前方向左' },
    { type: 'icon', icon: 'arrow_ahead_right', name: '前方向右' },
    { type: 'icon', icon: 'arrow_back_left', name: '左行向后' },
    { type: 'icon', icon: 'arrow_back_right', name: '右行向后' },
  ];

  var CATEGORIES = [
    { name: '方向指示', items: DIRECTION_ICONS },
    { name: '线路标识', items: ['number-line', 'text-line', 'big-number'] },
    { name: '位置标识', items: ['entrance', 'exit'] },
    { name: '文本', items: ['bilingual-text'] },
    { name: '服务图标', items: [{ type: 'icon', icon: 'elevator', name: '图标' }] },
    { name: '辅助', items: ['space'] },
  ];

  function itemTypeOf(item) {
    return typeof item === 'string' ? item : item.type;
  }

  /** 创建选择区条目对应的元素（图标项带 icon 属性） */
  function createElementForItem(item) {
    return State.createElement(itemTypeOf(item),
      typeof item === 'string' ? undefined : { icon: item.icon });
  }

  function itemDisplayName(item) {
    return typeof item === 'string' ? TYPE_NAMES[item] : item.name;
  }

  /** 卡片图标用的示例元素（比默认值更有代表性） */
  function sampleElement(type) {
    switch (type) {
      case 'arrow': return State.createElement('arrow', { direction: 'right', padding: { top: 0.12, right: 0.12, bottom: 0.12, left: 0.12 } });
      case 'number-line': return State.createElement('number-line', { lines: [{ number: '3', color: '#FCD600' }] });
      case 'text-line': return State.createElement('text-line', { text: '环' });
      case 'big-number': return State.createElement('big-number', { text: '4' });
      case 'entrance': return State.createElement('entrance', { code: 'C' });
      case 'exit': return State.createElement('exit', { code: '1' });
      case 'bilingual-text': return State.createElement('bilingual-text', { textZh: '站名', textEn: 'Station' });
      default: return State.createElement(type);
    }
  }

  function spaceIcon() {
    var svg = document.createElementNS(Core.SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('height', '36');
    var rect = document.createElementNS(Core.SVG_NS, 'rect');
    rect.setAttribute('x', '4'); rect.setAttribute('y', '4');
    rect.setAttribute('width', '32'); rect.setAttribute('height', '32');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#9aa3af');
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('stroke-dasharray', '5 4');
    svg.appendChild(rect);
    return svg;
  }

  /** 拖拽负载：左栏卡片 → 编辑区（HTML5 DnD），MIME 与 interact.js 约定一致 */
  function setDragPayload(ev, payload) {
    var mime = payload.kind === 'preset' ? SignInteract.MIME_PRESET : SignInteract.MIME_NEW;
    var json = JSON.stringify(payload);
    try {
      ev.dataTransfer.setData(mime, json);
      ev.dataTransfer.setData('text/plain', json);
    } catch (e) { /* 部分浏览器仅支持标准 MIME */ }
    ev.dataTransfer.effectAllowed = 'copy';
  }

  /** 移动端禁用卡片 HTML5 拖拽：触屏长按会唤起原生拖拽会话（卡片置灰、页面卡住收不了场） */
  function cardDraggableAttr() {
    return App.isMobileView && App.isMobileView() ? 'false' : 'true';
  }

  function wireCardDrag(card, payload) {
    card.addEventListener('dragstart', function (ev) {
      if (App.isMobileView && App.isMobileView()) {
        ev.preventDefault(); // 添加只走点击；桌面保持拖入编辑区
        return;
      }
      setDragPayload(ev, payload);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
  }

  function buildPalette() {
    var root = document.getElementById('palette');
    // chip 行滑动位置跨结构重建保留（预设增删、断点跨越）：整树重建会把
    // scrollLeft 归零，用户滑到右侧后 chip 行弹回最左、刚点中的分类飞出视口。
    var prevChips = root.querySelector('.palette-chips');
    var chipsScroll = prevChips ? prevChips.scrollLeft : 0;
    root.innerHTML = '';
    if (App.isMobileView && App.isMobileView()) {
      buildPaletteMobile(root);
      var chips = root.querySelector('.palette-chips');
      if (chips && chipsScroll > 0) chips.scrollLeft = chipsScroll;
      return;
    }
    CATEGORIES.forEach(function (cat) {
      root.appendChild(buildDesktopCategory(cat));
    });
    buildPresetCategory(root);
  }

  /** 移动端当前分类（chip 态，跨 palette 重建保留）；-1 = 预设 */
  var activeCategory = 0;

  /** chip 下标 → 分类下标（末位 chip 为预设，故映射为 -1） */
  function chipCategoryIndex(chipIndex) {
    return chipIndex < CATEGORIES.length ? chipIndex : -1;
  }

  /** 当前分类的卡片节点（预设分类出预设卡，其余出元素卡） */
  function buildActiveCards() {
    if (activeCategory === -1) return buildPresetCards();
    return CATEGORIES[activeCategory].items.map(function (item) { return buildItemCard(item); });
  }

  /** 当前分类的横向卡片条 */
  function buildCardStrip() {
    var strip = h('div', { class: 'palette-strip' });
    buildActiveCards().forEach(function (n) { strip.appendChild(n); });
    return strip;
  }

  /** ≤768px：顶部 chip 行（6 分类 + 预设）+ 当前分类横向卡片条 */
  function buildPaletteMobile(root) {
    var chips = h('div', { class: 'palette-chips' });
    function chip(label, idx) {
      return h('button', {
        class: 'palette-chip' + (activeCategory === idx ? ' active' : ''),
        text: label,
      });
    }
    CATEGORIES.forEach(function (cat, i) {
      var c = chip(cat.name, i);
      c.addEventListener('click', function () { selectPaletteCategory(i); });
      chips.appendChild(c);
    });
    var presetChip = chip('预设', -1);
    presetChip.addEventListener('click', function () { selectPaletteCategory(-1); });
    chips.appendChild(presetChip);
    root.appendChild(chips);
    root.appendChild(buildCardStrip());
  }

  /**
   * 切换当前分类：chip 行的结构不随分类变化，故只翻转 active 态、就地替换
   * 下方卡片条，不整树重建——重建会归零 chip 行的 scrollLeft（chip 行滑到
   * 右侧点选分类后弹回最左、刚点中的分类飞出视口），也会打断滑动惯性。
   */
  function selectPaletteCategory(idx) {
    if (activeCategory === idx) return;
    activeCategory = idx;
    var root = document.getElementById('palette');
    var chips = root.querySelectorAll('.palette-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('active', chipCategoryIndex(i) === idx);
    }
    var strip = root.querySelector('.palette-strip');
    if (strip) strip.parentNode.replaceChild(buildCardStrip(), strip);
  }

  function buildDesktopCategory(cat) {
    var grid = h('div', { class: 'palette-grid' });
    cat.items.forEach(function (item) { grid.appendChild(buildItemCard(item)); });
    return h('div', { class: 'palette-category' }, [
      h('div', { class: 'palette-category-title', text: cat.name }),
      grid,
    ]);
  }

  /**
   * 元素卡片：两端点击即添加（桌面不选中，移动端添加后自动选中）；
   * 桌面另支持 HTML5 拖入编辑区。
   */
  function buildItemCard(item) {
    var sample = createElementForItem(item);
    // 空白占位无可见内容，用虚线框示意
    var preview = itemTypeOf(item) === 'space'
      ? spaceIcon()
      : Render.renderElementStandalone(sample, 36, App.measure).node;
    var card = h('div', {
      class: 'palette-card',
      draggable: cardDraggableAttr(),
      title: '点击添加到当前行，或拖入编辑区',
    }, [
      h('div', { class: 'card-icon' }, [preview]),
      h('div', { class: 'card-name', text: itemDisplayName(item) }),
    ]);
    wireCardDrag(card, {
      kind: 'new',
      type: itemTypeOf(item),
      props: typeof item === 'string' ? undefined : { icon: item.icon },
    });
    card.addEventListener('click', function () {
      // 先创建再入状态：id 可捕获，供移动端添加后选中
      var created = createElementForItem(item);
      App.update(function (s) {
        return State.addElement(s, targetRowId(s), created);
      });
      if (App.isMobileView && App.isMobileView()) App.select(created.id);
      SignUI.toast('已添加「' + itemDisplayName(item) + '」', 'success');
    });
    return card;
  }

  /** 元素点击添加时的目标行：选中元素所在行，否则最后一行 */
  function targetRowId(s) {
    if (App.selection.elementId) {
      var found = State.findElement(s, App.selection.elementId);
      if (found) return found.rowId;
    }
    return s.rows[s.rows.length - 1].id;
  }

  // ─── 预设分类卡片 ──────────────────────────────────────────

  function renderRowThumb(elements, height) {
    var x = 0;
    var slots = elements.map(function (el) {
      var w = Render.computeElementWidth(el, height, App.measure);
      var slot = { el: el, x: x, w: w };
      x += w;
      return slot;
    });
    var svg = document.createElementNS(Core.SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + Math.max(x, 1) + ' ' + height);
    svg.setAttribute('xmlns', Core.SVG_NS);
    var bg = document.createElementNS(Core.SVG_NS, 'rect');
    bg.setAttribute('width', Math.max(x, 1));
    bg.setAttribute('height', height);
    bg.setAttribute('fill', '#FFFFFF');
    svg.appendChild(bg);
    slots.forEach(function (slot) {
      var node = Render.renderElement(slot.el, height, App.measure, { clean: true }).node;
      node.setAttribute('transform', 'translate(' + slot.x + ',0)');
      svg.appendChild(node);
    });
    return svg;
  }

  /** 预设卡片节点列表（空时为提示节点）；桌面入分类容器，移动端入横向卡片条 */
  function buildPresetCards() {
    var nodes = [];
    var items = Presets.list();
    if (items.length === 0) {
      nodes.push(h('div', { class: 'palette-empty', text: '悬停行右上角「存为预设」可保存当前行' }));
      return nodes;
    }
    items.forEach(function (p) {
      var del = h('button', {
        class: 'preset-delete', title: '删除预设', text: '✕',
      });
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        SignUI.confirmDialog('确定要删除预设「' + p.name + '」吗？', '删除预设').then(function (ok) {
          if (!ok) return;
          Presets.remove(p.id);
          if (App.presetPreviewId === p.id) App.previewPreset(null);
          SignUI.toast('预设已删除');
        });
      });
      var card = h('div', {
        class: 'preset-card',
        draggable: cardDraggableAttr(),
        title: '拖入空行使用；点击预览',
      }, [
        h('div', { class: 'preset-thumb' }, [renderRowThumb(p.elements, 48)]),
        h('div', { class: 'preset-name', text: p.name }),
        del,
      ]);
      wireCardDrag(card, { kind: 'preset', id: p.id });
      card.addEventListener('click', function () {
        App.previewPreset(p.id);
      });
      nodes.push(card);
    });
    return nodes;
  }

  function buildPresetCategory(root) {
    var cat = h('div', { class: 'palette-category' }, [
      h('div', { class: 'palette-category-title', text: '预设' }),
    ]);
    buildPresetCards().forEach(function (n) { cat.appendChild(n); });
    root.appendChild(cat);
  }

  Presets.onChange(function () {
    if (App.measure) buildPalette();
  });

  // ─── 颜色选择器组件 ────────────────────────────────────────

  // 选色板城市切换联动：一处切换，所有打开中的选择器同步重建色板。
  // 观察者在 rebuildRightPanel 时随 syncFns 一起清空，避免引用过期 DOM。
  var paletteCityFns = [];

  /** 编辑器偏好：选色板城市（写入 localStorage 并通知全部选择器） */
  function setPaletteCity(city) {
    if (App.prefs.paletteCity === city) return;
    App.prefs.paletteCity = city;
    if (global.SignStorage) SignStorage.savePrefs(App.prefs);
    paletteCityFns.forEach(function (fn) { fn(); });
  }

  /** 编辑器偏好：输入线路号自动匹配线路色 */
  function setAutoLineColor(v) {
    App.prefs.autoLineColor = !!v;
    if (global.SignStorage) SignStorage.savePrefs(App.prefs);
  }

  /**
   * buildColorPicker({ value, getValue, nullable, onChange(v), mini })
   * value 为 null 时显示"透明"态（仅 nullable 时允许）。
   * 可选 getValue：注册到 syncFns，外部（如线路号自动配色）改色后同步显示。
   */
  function buildColorPicker(opts) {
    var value = opts.value || null;
    var nullable = !!opts.nullable;
    var onChange = opts.onChange || function () {};

    if (opts.getValue) {
      var readValue = opts.getValue;
      syncFns.push(function () {
        var v = readValue() || null;
        if (v !== value) {
          value = v;
          paint();
        }
      });
    }

    var current = h('button', { class: 'cp-current', title: '当前颜色' });
    var hex = h('input', {
      class: 'hex-input', type: 'text', spellcheck: 'false',
      placeholder: '#RRGGBB', maxlength: '7',
    });
    var native = h('input', { class: 'cp-native', type: 'color', title: '自定义颜色' });
    var nullBtn = nullable ? h('button', { class: 'cp-null-btn', text: '透明', title: '清除颜色（透明）' }) : null;

    function paint() {
      // hex 输入框聚焦中（用户正在打字）时不得改写其文本，否则输入被规整化
      // 改写、光标跳末尾，与用户的编辑互相打架（删除 '#'/退格均被顶回）。
      var hexIdle = document.activeElement !== hex;
      if (value === null) {
        current.classList.add('nullable-null');
        current.removeAttribute('style');
        if (hexIdle) hex.value = '';
        if (nullBtn) nullBtn.classList.add('active');
      } else {
        current.classList.remove('nullable-null');
        current.style.background = value;
        if (hexIdle) hex.value = value;
        native.value = value;
        if (nullBtn) nullBtn.classList.remove('active');
      }
      swatchBtns.forEach(function (b) {
        b.classList.toggle('active', b.dataset.color === value);
      });
    }

    function commit(v) {
      value = v;
      paint();
      onChange(v);
    }

    hex.addEventListener('input', function () {
      var raw = hex.value.trim();
      // 无 # 前缀的 6 位写法（如 7378be）也接受：只规整提交值，不改写输入框文本
      var v = raw && raw.charAt(0) !== '#' ? '#' + raw : raw;
      if (Core.isHexColor(v)) {
        hex.classList.remove('invalid');
        commit(Core.normalizeHex(v));
      } else {
        hex.classList.toggle('invalid', raw.length > 0);
      }
    });
    hex.addEventListener('blur', function () { paint(); });
    native.addEventListener('input', function () {
      commit(Core.normalizeHex(native.value));
    });
    if (nullBtn) {
      nullBtn.addEventListener('click', function () { commit(null); });
    }

    // 城市快捷切换：按城市调整选色板线路配色（下拉菜单，新增城市自动带出）
    var citySelect = h('select', { class: 'cp-city-select', title: '按城市调整选色板线路配色' });
    Core.PALETTE_CITY_ORDER.forEach(function (city) {
      citySelect.appendChild(h('option', {
        value: city, text: Core.CITY_PALETTES[city].name + '线路配色',
      }));
    });
    citySelect.addEventListener('change', function () { setPaletteCity(citySelect.value); });
    function paintCities() {
      citySelect.value = App.prefs.paletteCity;
    }
    paintCities(); // 构建时立即回显

    var swatchBtns = [];
    var swatches = h('div', { class: 'cp-swatches' });
    function renderSwatches() {
      swatchBtns = [];
      while (swatches.firstChild) swatches.removeChild(swatches.firstChild);
      Core.citySwatches(App.prefs.paletteCity).forEach(function (c) {
        var b = h('button', {
          class: 'cp-swatch', title: c.name, 'data-color': c.bg,
          style: 'background:' + c.bg,
        });
        b.addEventListener('click', function () { commit(c.bg); });
        swatchBtns.push(b);
        swatches.appendChild(b);
      });
      paint();
    }
    renderSwatches();

    var row = h('div', { class: 'cp-row' }, [current, hex, native]);
    if (nullBtn) row.appendChild(nullBtn);
    var root = h('div', { class: 'color-picker' + (opts.mini ? ' mini' : '') }, [row, citySelect, swatches]);
    paletteCityFns.push(function () {
      if (!root.isConnected) return; // 选择器已随面板重建移除
      renderSwatches();
      paintCities();
    });
    paint();
    return root;
  }

  // ─── 右栏：模式管理与签名同步 ──────────────────────────────

  var lastSignature = null;
  var syncFns = [];

  function panelMode() {
    if (App.selection.elementId) return 'element';
    if (App.presetPreviewId) return 'preset';
    return 'settings';
  }

  /** 结构签名：变化才重建面板；纯值变化走 syncFns。
   *  注意设置面板的签名不含任何值——宽度模式等值变化由 syncFns 回显，
   *  否则每次切换都会整面板重建，重建出的控件不带任何选中态。 */
  function panelSignature() {
    var mode = panelMode();
    if (mode === 'element') {
      var found = App.state && State.findElement(App.state, App.selection.elementId);
      if (!found) return 'element:none';
      var extra = found.element.type === 'number-line'
        ? ':n' + (found.element.props.lines || []).length : '';
      return 'element:' + found.element.id + ':' + found.element.type + extra;
    }
    if (mode === 'preset') return 'preset:' + App.presetPreviewId + ':' + Presets.list().length;
    return 'settings';
  }

  function syncRightPanel() {
    if (!App.state || !App.measure) return;
    var sig = panelSignature();
    if (sig !== lastSignature) {
      rebuildRightPanel();
      lastSignature = sig;
    } else {
      syncFns.forEach(function (fn) { fn(); });
    }
    // 标题与关闭按钮
    var mode = panelMode();
    document.getElementById('right-panel-title').textContent =
      mode === 'element' ? '元素属性'
        : mode === 'preset' ? '预设预览' : '标识牌设置';
    document.getElementById('close-element-btn').hidden = mode === 'settings';
    document.getElementById('close-element-btn').title =
      mode === 'preset' ? '关闭预览' : '关闭元素属性';
    // 移动端：选中元素/进预览时底部属性带自动展开（折叠只由用户手动控制）
    if (mode !== 'settings' && App.isMobileView && App.isMobileView()) {
      var band = document.getElementById('right-panel');
      if (band.classList.contains('band-collapsed')) {
        band.classList.remove('band-collapsed');
        if (App.syncMobileChrome) App.syncMobileChrome();
      }
    }
  }

  function rebuildRightPanel() {
    syncFns = [];
    paletteCityFns = [];
    var body = document.getElementById('right-panel-body');
    body.innerHTML = '';
    var mode = panelMode();
    if (mode === 'element') body.appendChild(buildElementPanel());
    else if (mode === 'preset') body.appendChild(buildPresetPreviewPanel());
    else body.appendChild(buildSettingsPanel());
  }

  // ─── 表单控件工厂 ──────────────────────────────────────────

  function field(labelText, control, hint) {
    var children = [h('label', { text: labelText }), control];
    if (hint) children.push(h('div', { class: 'hint-text', text: hint }));
    return h('div', { class: 'field' }, children);
  }

  function numberInput(attrs, onCommit) {
    var input = h('input', Object.assign({ type: 'number' }, attrs));
    input.addEventListener('change', function () {
      var v = parseFloat(input.value);
      if (isFinite(v)) onCommit(v);
      else syncNow();
    });
    return input;
  }

  function textInput(attrs, onInput) {
    var input = h('input', Object.assign({ type: 'text' }, attrs));
    input.addEventListener('input', function () { onInput(input.value); });
    return input;
  }

  function segGroup(options, getValue, onPick) {
    var group = h('div', { class: 'seg-group' });
    var buttons = options.map(function (opt) {
      var b = h('button', { text: opt.label, title: opt.title || '', 'data-value': opt.value });
      b.addEventListener('click', function () { onPick(opt.value); });
      group.appendChild(b);
      return b;
    });
    function paint() {
      var cur = getValue();
      buttons.forEach(function (b) {
        b.classList.toggle('active', b.dataset.value === String(cur));
      });
    }
    syncFns.push(paint);
    paint(); // 构建时立即回显（重建出的面板不含任何值状态）
    return group;
  }

  function checkbox(labelText, getValue, onChange) {
    var input = h('input', { type: 'checkbox' });
    input.addEventListener('change', function () { onChange(input.checked); });
    input.checked = !!getValue(); // 构建时立即回显
    syncFns.push(function () {
      if (document.activeElement !== input) input.checked = !!getValue();
    });
    return h('div', { class: 'field field-inline' }, [
      h('label', { text: labelText }), input,
    ]);
  }

  /** 同步输入框显示值（跳过焦点元素） */
  function bindSync(el2, getValue, format) {
    syncFns.push(function () {
      if (document.activeElement === el2) return;
      var v = getValue();
      el2.value = format ? format(v) : v;
    });
  }

  function syncNow() { syncFns.forEach(function (fn) { fn(); }); }

  // ─── 标识牌设置面板 ────────────────────────────────────────

  function buildSettingsPanel() {
    var s = App.state;
    var root = h('div');

    var rowHeightInput = numberInput({ min: '32', max: '2048', step: '4' }, function (v) {
      App.update(function (st) {
        return State.updateSignSettings(st, { rowHeight: Math.round(Core.clamp(v, 32, 2048)) });
      });
    });
    rowHeightInput.value = s.rowHeight;
    bindSync(rowHeightInput, function () { return App.state.rowHeight; });
    root.appendChild(field('行高（px）', rowHeightInput, '元素与内边距按行高等比适配'));

    var rowCount = h('input', { type: 'number', value: s.rows.length, disabled: 'disabled' });
    bindSync(rowCount, function () { return App.state.rows.length; });
    root.appendChild(field('行数（由添加/删除行控制）', rowCount));

    root.appendChild(field('宽度模式', segGroup([
      { value: 'fixed', label: '固定' },
      { value: 'dynamic', label: '动态' },
    ], function () { return App.state.widthMode; }, function (v) {
      App.update(function (st) { return State.updateSignSettings(st, { widthMode: v }); });
    })));

    var widthInput = numberInput({ min: '64', max: '32768', step: '16' }, function (v) {
      App.update(function (st) {
        return State.updateSignSettings(st, { width: Math.round(Core.clamp(v, 64, 32768)) });
      });
    });
    widthInput.value = s.width;
    bindSync(widthInput, function () { return App.state.width; });
    var widthField = field('固定宽度（px）', widthInput);
    syncFns.push(function () {
      widthField.style.display = App.state.widthMode === 'fixed' ? '' : 'none';
    });
    widthField.style.display = s.widthMode === 'fixed' ? '' : 'none';
    root.appendChild(widthField);

    var dynamicHint = h('div', { class: 'hint-text', text: '' });
    syncFns.push(function () {
      dynamicHint.style.display = App.state.widthMode === 'dynamic' ? '' : 'none';
      dynamicHint.textContent = '当前动态宽度：' + (App.layout ? App.layout.width : '–') + ' px（由最宽行决定）';
    });
    dynamicHint.style.display = s.widthMode === 'dynamic' ? '' : 'none';
    root.appendChild(dynamicHint);

    root.appendChild(checkbox('锁定宽高比', function () { return App.state.aspectLocked; }, function (v) {
      App.update(function (st) { return State.updateSignSettings(st, { aspectLocked: v }); });
    }));

    var bgColor = buildColorPicker({
      value: s.backgroundColor,
      onChange: function (v) {
        App.update(function (st) {
          return State.updateSignSettings(st, { backgroundColor: v || '#FFFFFF' });
        });
      },
    });
    root.appendChild(field('标识牌背景色', bgColor));

    var frameWidthInput = numberInput({ class: 'frame-width-input', min: '0', max: '512', step: '1' }, function (v) {
      App.update(function (st) {
        return State.updateSignSettings(st, { frameWidth: Math.round(Core.clamp(v, 0, 512)) });
      });
    });
    frameWidthInput.value = s.frameWidth;
    bindSync(frameWidthInput, function () { return App.state.frameWidth; });
    root.appendChild(field('灰框宽度（px）', frameWidthInput,
      '每行牌面从边缘向内延伸的直角灰框，模拟真实标识牌边框；0 为不显示'));

    root.appendChild(h('div', { class: 'divider' }));
    root.appendChild(h('div', { class: 'section-title', text: '编辑器' }));
    root.appendChild(checkbox('输入线路号自动匹配线路色', function () { return App.prefs.autoLineColor; }, function (v) {
      setAutoLineColor(v);
    }));
    root.appendChild(h('div', {
      class: 'hint-text',
      text: '开启后在线路列表输入线路号时自动填充当前城市的线路色；城市可在任意颜色选择器顶部的下拉菜单切换。',
    }));

    root.appendChild(h('button', {
      class: 'btn btn-danger', text: '🗑 清空标识牌',
      style: 'margin-top:6px',
    })).addEventListener('click', function () {
      SignUI.confirmDialog('确定要清空所有行和元素吗？', '清空标识牌', '清空').then(function (ok) {
        if (!ok) return;
        App.update(State.clearSign);
        App.select(null);
        SignUI.toast('标识牌已清空');
      });
    });

    root.appendChild(h('div', { class: 'divider' }));
    root.appendChild(h('div', { class: 'section-title', text: '导出' }));
    // 导出前可能要加载内嵌字体（fonts-data.js 约 7 MB），加载期间按钮保持忙碌态，
    // 避免慢网络下「点了没反应」；失败由导出函数 toast 错误。
    function exportButton(text, run) {
      var btn = h('button', { class: 'btn btn-primary', text: text });
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var original = btn.textContent;
        btn.disabled = true;
        btn.textContent = '⏳ 正在准备字体…';
        function done() { btn.disabled = false; btn.textContent = original; }
        run().then(done, done);
      });
      return btn;
    }
    root.appendChild(exportButton('⬇ 导出 SVG', function () {
      return SignExporters.exportSVGFile(App.state, App.measure);
    }));
    root.appendChild(exportButton('⬇ 导出 PNG', function () {
      return SignExporters.exportPNGFile(App.state, App.measure);
    }));

    root.appendChild(h('div', { class: 'divider' }));
    root.appendChild(h('div', { class: 'section-title', text: '项目' }));
    root.appendChild(h('button', { class: 'btn', text: '📤 导出项目（JSON）' })).addEventListener('click', function () {
      SignStorage.exportProject(App.state);
    });
    root.appendChild(h('button', { class: 'btn', text: '📥 导入项目（JSON）' })).addEventListener('click', function () {
      SignStorage.pickImportFile().then(function (file) {
        if (!file) return;
        SignStorage.importProject(file).then(function (sign) {
          App.update(function () { return sign; });
          App.select(null);
          SignUI.toast('项目导入成功', 'success');
        }, function (err) {
          SignUI.toast(err.message, 'error');
        });
      });
    });

    return root;
  }

  // ─── 元素属性面板 ──────────────────────────────────────────

  function patchProps(elementId, patch) {
    App.update(function (st) { return State.updateElementProps(st, elementId, patch); });
  }

  function buildElementPanel() {
    var found = State.findElement(App.state, App.selection.elementId);
    if (!found) return h('div', { class: 'hint-text', text: '元素不存在' });
    var el = found.element;

    // 状态是不可变更新：每次 patch 后 el 都会变成过期快照。
    // 回调与值同步必须经 live() 重查当前元素，否则编辑会互相回滚。
    var live = function () {
      var cur = State.findElement(App.state, el.id);
      return cur ? cur.element : el;
    };

    var root = h('div');
    root.appendChild(h('div', { class: 'section-title', text: TYPE_NAMES[el.type] }));

    switch (el.type) {
      case 'arrow': buildArrowFields(root, el, live); break;
      case 'bilingual-text': buildBilingualFields(root, el, live); break;
      case 'big-number': buildBigNumberFields(root, el, live); break;
      case 'number-line': buildNumberLineFields(root, el, live); break;
      case 'text-line': buildTextLineFields(root, el, live); break;
      case 'entrance':
      case 'exit': buildCodeFields(root, el, live); break;
      case 'space': buildSpaceFields(root, el, live); break;
      case 'icon': buildIconFields(root, el, live); break;
    }

    // 元素对齐：仅固定宽度模式支持（动态宽度整体左起排列）。
    // 编辑过程中宽度模式不会变化（它在设置面板里，与本面板互斥），构建时判断即可。
    if (App.state.widthMode === 'fixed') {
      root.appendChild(field('元素对齐', segGroup([
        { value: 'left', label: '贴左' },
        { value: 'center', label: '居中' },
        { value: 'right', label: '贴右' },
      ], function () { return live().props.elementAlign; }, function (v) {
        patchProps(el.id, { elementAlign: v });
      })));
    }

    if (el.type !== 'exit') {
      root.appendChild(h('div', { class: 'divider' }));
      root.appendChild(buildBackgroundPicker(el));
    }
    if (el.type !== 'space') {
      root.appendChild(buildPaddingEditor(el, live));
    }

    root.appendChild(h('div', { class: 'divider' }));
    var del = h('button', { class: 'btn btn-danger', text: '🗑 删除元素' });
    del.addEventListener('click', function () {
      App.update(function (st) { return State.deleteElement(st, el.id); });
      App.select(null);
      SignUI.toast('元素已删除');
    });
    root.appendChild(del);
    return root;
  }

  function buildArrowFields(root, el, live) {
    root.appendChild(field('方向', segGroup([
      { value: 'left', label: '←', title: '向左' },
      { value: 'left-up', label: '↖', title: '向左上' },
      { value: 'up', label: '↑', title: '向上' },
      { value: 'right-up', label: '↗', title: '向右上' },
      { value: 'right', label: '→', title: '向右' },
      { value: 'right-down', label: '↘', title: '向右下' },
      { value: 'down', label: '↓', title: '向下' },
      { value: 'left-down', label: '↙', title: '向左下' },
    ], function () { return live().props.direction; }, function (v) {
      patchProps(el.id, { direction: v });
    })));

    var range = h('input', { type: 'range', min: '0.1', max: '0.5', step: '0.05' });
    var pct = h('span', { class: 'hint-text' });
    range.value = el.props.thicknessRatio;
    range.addEventListener('input', function () {
      pct.textContent = Math.round(range.value * 100) + '%';
      patchProps(el.id, { thicknessRatio: parseFloat(range.value) });
    });
    pct.textContent = Math.round(el.props.thicknessRatio * 100) + '%';
    root.appendChild(field('粗细比例', h('div', {}, [range, pct])));

    root.appendChild(field('颜色', buildColorPicker({
      value: el.props.color,
      onChange: function (v) { patchProps(el.id, { color: v }); },
    })));
  }

  function buildBilingualFields(root, el, live) {
    var zh = textInput({ value: el.props.textZh, placeholder: '中文文本' }, function (v) {
      patchProps(el.id, { textZh: v });
    });
    bindSync(zh, function () { return live().props.textZh; });
    root.appendChild(field('中文文本', zh));

    var en = textInput({ value: el.props.textEn, placeholder: 'English text' }, function (v) {
      patchProps(el.id, { textEn: v });
    });
    bindSync(en, function () { return live().props.textEn; });
    root.appendChild(field('英文文本', en));

    root.appendChild(field('对齐', segGroup([
      { value: 'left', label: '左对齐' },
      { value: 'center', label: '居中' },
      { value: 'right', label: '右对齐' },
    ], function () { return live().props.align; }, function (v) {
      patchProps(el.id, { align: v });
    })));

    root.appendChild(checkbox('加粗', function () { return live().props.bold; }, function (v) {
      patchProps(el.id, { bold: v });
    }));

    root.appendChild(field('颜色', buildColorPicker({
      value: el.props.color,
      onChange: function (v) { patchProps(el.id, { color: v }); },
    })));
  }

  function buildBigNumberFields(root, el, live) {
    var t = textInput({ value: el.props.text, placeholder: '文本，如 16 / 1/2/3/4 / 16号线' }, function (v) {
      patchProps(el.id, { text: v });
    });
    bindSync(t, function () { return live().props.text; });
    root.appendChild(field('内容', t));
    root.appendChild(field('颜色', buildColorPicker({
      value: el.props.color,
      onChange: function (v) { patchProps(el.id, { color: v }); },
    })));
  }

  /** 内容对齐分段按钮（数字线路/文字线路/出口）：元素内部左/右镜像排版，与元素对齐无关 */
  function contentAlignGroup(el, live) {
    return field('内容对齐', segGroup([
      { value: 'left', label: '左对齐' },
      { value: 'right', label: '右对齐' },
    ], function () { return live().props.align; }, function (v) {
      patchProps(el.id, { align: v });
    }));
  }

  function buildNumberLineFields(root, el, live) {
    var editor = h('div', { class: 'lines-editor' });

    /** 始终读当前状态的 lines（el 是建面板时的过期快照） */
    function lines() { return live().props.lines; }

    function updateLine(index, patch) {
      var next = lines().map(function (l, i) {
        return i === index ? Object.assign({}, l, patch) : l;
      });
      patchProps(el.id, { lines: next });
    }

    function rebuildEntries() {
      editor.innerHTML = '';
      lines().forEach(function (line, idx) {
        var numInput = textInput({ value: line.number, maxlength: '2', class: 'le-number', placeholder: '号' }, function (v) {
          var digits = v.replace(/\D/g, '').slice(0, 2);
          var patch = { number: digits };
          // 开关开启且命中当前城市线路表时预填线路色（仍可手动改）
          var hit = App.prefs.autoLineColor && digits && Core.lineColorFor(digits, App.prefs.paletteCity);
          if (hit) patch.color = hit.bg;
          updateLine(idx, patch);
        });
        // 失焦时回显规范化后的数字（过滤非法字符后）
        numInput.addEventListener('blur', function () {
          var cur = lines()[idx];
          numInput.value = cur ? cur.number : '';
        });
        var removeBtn = h('button', { class: 'le-remove', text: '✕', title: '移除此线路' });
        removeBtn.addEventListener('click', function () {
          patchProps(el.id, {
            lines: lines().filter(function (_, i) { return i !== idx; }),
          });
        });
        editor.appendChild(h('div', { class: 'line-entry' }, [
          numInput,
          buildColorPicker({
            value: line.color,
            mini: true,
            getValue: function () { var cur = lines()[idx]; return cur ? cur.color : null; },
            onChange: function (v) { updateLine(idx, { color: v }); },
          }),
          removeBtn,
        ]));
      });
      var add = h('button', { class: 'le-add', text: '＋ 添加线路' });
      add.addEventListener('click', function () {
        patchProps(el.id, {
          lines: lines().concat([{ number: '', color: '#424A52' }]),
        });
      });
      editor.appendChild(add);
    }
    rebuildEntries();

    root.appendChild(field('线路列表（1–2 位数字）', editor));
    root.appendChild(contentAlignGroup(el, live));
    // 右对齐仅渲染第 1 条线路：禁用「添加线路」，多余线路保留（切回左对齐恢复显示）
    var rightOnlyHint = h('div', { class: 'hint-text', text: '右对齐仅渲染第 1 条线路；多余线路会保留，切回左对齐后恢复显示。' });
    syncFns.push(function () {
      var right = live().props.align === 'right';
      var add = editor.querySelector('.le-add');
      if (add) add.disabled = right;
      rightOnlyHint.style.display = right ? '' : 'none';
    });
    rightOnlyHint.style.display = live().props.align === 'right' ? '' : 'none'; // 构建时立即回显
    root.appendChild(rightOnlyHint);
    root.appendChild(field('文字颜色', buildColorPicker({
      value: el.props.textColor,
      onChange: function (v) { patchProps(el.id, { textColor: v }); },
    })));
  }

  function buildTextLineFields(root, el, live) {
    root.appendChild(checkbox('线路名下沉', function () { return live().props.nameSink; }, function (v) {
      patchProps(el.id, { nameSink: v });
    }));

    var t = textInput({ value: el.props.text, placeholder: '如：环 / 机场联络线' }, function (v) {
      patchProps(el.id, { text: v });
    });
    bindSync(t, function () { return live().props.text; });
    root.appendChild(field('中文线路名', t));

    var en = textInput({ value: el.props.textEn, placeholder: '如：Loop Line' }, function (v) {
      patchProps(el.id, { textEn: v });
    });
    bindSync(en, function () { return live().props.textEn; });
    root.appendChild(field('英文名称', en));

    root.appendChild(contentAlignGroup(el, live));

    root.appendChild(field('色块颜色', buildColorPicker({
      value: el.props.blockColor,
      onChange: function (v) { patchProps(el.id, { blockColor: v }); },
    })));
    root.appendChild(field('文字颜色', buildColorPicker({
      value: el.props.textColor,
      onChange: function (v) { patchProps(el.id, { textColor: v }); },
    })));
  }

  function buildCodeFields(root, el, live) {
    var c = textInput({ value: el.props.code, placeholder: '编号，如 1 / C / 1,5-22' }, function (v) {
      patchProps(el.id, { code: v });
    });
    bindSync(c, function () { return live().props.code; });
    root.appendChild(field('编号', c));
    if (el.type === 'exit') {
      root.appendChild(contentAlignGroup(el, live)); // 仅出口支持内容对齐（编号移至「出口」右侧）
    }
    root.appendChild(field('颜色', buildColorPicker({
      value: el.props.color,
      onChange: function (v) { patchProps(el.id, { color: v }); },
    })));
    if (el.type === 'exit') {
      root.appendChild(h('div', { class: 'hint-text', text: '出口背景色固定为出口黄 #F7D917' }));
    }
  }

  function buildSpaceFields(root, el, live) {
    var w = numberInput({ min: '0.1', max: '8', step: '0.1' }, function (v) {
      patchProps(el.id, { widthRatio: Core.clamp(v, 0.1, 8) });
    });
    w.value = el.props.widthRatio;
    bindSync(w, function () { return live().props.widthRatio; });
    root.appendChild(field('宽度（× 行高的倍数）', w));
    // 背景色由通用分发器统一追加（buildElementPanel 末尾）
  }

  /**
   * 图标选择器：按当前元素图标的分类展示缩略图网格
   * （方向图标元素显示 12 向箭头，服务图标元素显示服务设施）+ 颜色。
   */
  function buildIconFields(root, el, live) {
    var lib = global.SignIcons;
    var curCat = lib.get(live().props.icon).cat;
    var grid = h('div', { class: 'icon-grid' });
    var btns = [];
    Object.keys(lib.ALL).forEach(function (id) {
      var icon = lib.ALL[id];
      if (icon.cat !== curCat) return;
      var svg = document.createElementNS(Core.SVG_NS, 'svg');
      svg.setAttribute('viewBox', icon.vb);
      svg.innerHTML = icon.body;
      var b = h('button', { class: 'icon-pick', title: icon.name }, [
        h('div', { class: 'icon-thumb' }, [svg]),
      ]);
      b.addEventListener('click', function () { patchProps(el.id, { icon: id }); });
      btns.push({ b: b, id: id });
      grid.appendChild(b);
    });
    function paint() {
      var cur = live().props.icon;
      btns.forEach(function (x) { x.b.classList.toggle('active', x.id === cur); });
    }
    syncFns.push(paint);
    paint();
    root.appendChild(grid);
    root.appendChild(field('颜色', buildColorPicker({
      value: el.props.color,
      onChange: function (v) { patchProps(el.id, { color: v }); },
    })));
    // 元素背景色由通用分发器统一追加（buildFields 末尾，space/exit 除外）
  }

  function buildBackgroundPicker(el) {
    var wrap = h('div');
    var picker = buildColorPicker({
      value: el.props.backgroundColor,
      nullable: true,
      onChange: function (v) { patchProps(el.id, { backgroundColor: v }); },
    });
    wrap.appendChild(picker);
    return field('元素背景色', wrap);
  }

  function buildPaddingEditor(el, live) {
    // 上下左右挤一行时输入框过窄（"0.25" 显示成 "0.2"）：
    // 左右一行、上下一行，两行各两框
    var wrap = h('div');
    wrap.appendChild(checkbox('左右内边距随相邻自动缩放', function () {
      return live().props.paddingAuto;
    }, function (v) {
      patchProps(el.id, { paddingAuto: v }); // v=true 时管线立即按相邻关系重算
    }));
    wrap.appendChild(h('div', {
      class: 'hint-text',
      text: '勾选时左右内边距在相邻元素一侧自动减半（0.2 ↔ 0.1）；手动修改任一侧即固定。',
    }));
    var grid = h('div', { style: 'display:grid;grid-template-columns:repeat(2,1fr);gap:6px' });
    var keys = [
      { k: 'left', label: '左', max: 8 },
      { k: 'right', label: '右', max: 8 },
      { k: 'top', label: '上', max: 1 },
      { k: 'bottom', label: '下', max: 1 },
    ];
    keys.forEach(function (item) {
      var input = numberInput({ min: '0', max: String(item.max), step: '0.05', title: item.label + '内边距' }, function (v) {
        var padding = {};
        padding[item.k] = Core.clamp(v, 0, item.max);
        var patch = { padding: padding };
        // 手动修改左右任一侧 → 退出自动（钉住）
        if (item.k === 'left' || item.k === 'right') patch.paddingAuto = false;
        patchProps(el.id, patch);
      });
      input.value = el.props.padding[item.k];
      bindSync(input, function () { return live().props.padding[item.k]; });
      grid.appendChild(h('div', {}, [
        h('div', { class: 'hint-text', text: item.label, style: 'text-align:center;margin-bottom:2px' }),
        input,
      ]));
    });
    wrap.appendChild(field('内边距（相对行高比例）', grid, '左右内边距可大于 1（元素更宽）'));
    return wrap;
  }

  // ─── 预设预览面板 ──────────────────────────────────────────

  function buildPresetPreviewPanel() {
    var p = Presets.get(App.presetPreviewId);
    if (!p) return h('div', { class: 'hint-text', text: '预设不存在或已删除' });
    var root = h('div');
    root.appendChild(h('div', { class: 'section-title', text: p.name }));
    root.appendChild(h('div', { class: 'field' }, [
      h('div', { style: 'border:1px solid #edf0f3;border-radius:6px;padding:6px;background:#fff' }, [
        renderRowThumb(p.elements, 56),
      ]),
    ]));
    var list = h('div', { class: 'field' });
    p.elements.forEach(function (el, i) {
      var desc = describeElement(el);
      list.appendChild(h('div', {
        class: 'hint-text',
        text: (i + 1) + '. ' + TYPE_NAMES[el.type] + (desc ? ' — ' + desc : ''),
      }));
    });
    root.appendChild(list);
    root.appendChild(h('div', { class: 'hint-text', text: '将此预设卡片拖入编辑区的空行即可使用；预设只能放入空行。' }));
    root.appendChild(h('div', { class: 'divider' }));
    var del = h('button', { class: 'btn btn-danger', text: '🗑 删除此预设' });
    del.addEventListener('click', function () {
      SignUI.confirmDialog('确定要删除预设「' + p.name + '」吗？', '删除预设').then(function (ok) {
        if (!ok) return;
        Presets.remove(p.id);
        App.previewPreset(null);
      });
    });
    root.appendChild(del);
    return root;
  }

  function describeElement(el) {
    var p = el.props;
    switch (el.type) {
      case 'arrow': return p.direction;
      case 'bilingual-text': return (p.textZh || '') + (p.textEn ? ' / ' + p.textEn : '');
      case 'big-number': return p.text;
      case 'number-line': return (p.lines || []).map(function (l) { return l.number; }).join('、') + ' 号线';
      case 'text-line': return (p.text || '') + (p.textEn ? ' / ' + p.textEn : '');
      case 'entrance': return '出入口 ' + p.code;
      case 'exit': return '出口 ' + p.code;
      case 'space': return '空白 ' + p.widthRatio + '×行高';
      case 'icon': {
        var lib = global.SignIcons;
        return lib ? (lib.get(p.icon) || {}).name || p.icon : p.icon;
      }
      default: return '';
    }
  }

  global.SignPanel = {
    TYPE_NAMES: TYPE_NAMES,
    buildPalette: buildPalette,
    buildColorPicker: buildColorPicker,
    syncRightPanel: syncRightPanel,
    sampleElement: sampleElement,
    renderRowThumb: renderRowThumb,
  };
})(typeof window !== 'undefined' ? window : globalThis);
