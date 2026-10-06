/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * panel.js — 左栏元素选择区 + 右栏属性/设置面板 + 颜色选择器
 *
 * 右栏：元素属性 / 多选批量属性 / 预设预览 / 标识牌设置（默认）。
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
    'small-bilingual-text': '小号双语文本',
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
    { name: '文本', items: ['bilingual-text', 'small-bilingual-text'] },
    { name: '服务图标', items: [{ type: 'icon', icon: 'elevator', name: '图标' }] },
    { name: '辅助', items: ['space'] },
  ];

  // 桌面不需要为每一种元素单开分组：方向、常用文字标识、辅助元素三组即可。
  var DESKTOP_CATEGORIES = [
    CATEGORIES[0],
    { name: '标识与文字', items: ['number-line', 'text-line', 'big-number', 'entrance', 'exit', 'bilingual-text', 'small-bilingual-text'] },
    { name: '图标与间隔', items: [{ type: 'icon', icon: 'elevator', name: '图标' }, 'space'] },
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
      case 'small-bilingual-text': return State.createElement('small-bilingual-text', { textZh: '站名', textEn: 'Station' });
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

  var activePaletteTab = 'elements';
  var activeCategory = 0;
  var paletteChipsScroll = 0;

  function rememberPaletteScroll(root) {
    var chips = root.querySelector('.palette-chips');
    if (chips) paletteChipsScroll = chips.scrollLeft;
  }

  function buildPaletteTabs() {
    var tabs = h('div', { class: 'palette-tabs', role: 'tablist', 'aria-label': '选择区内容' });
    [['elements', '元素'], ['presets', '预设']].forEach(function (entry) {
      var selected = activePaletteTab === entry[0];
      var tab = h('button', {
        class: 'palette-tab' + (selected ? ' active' : ''),
        type: 'button', role: 'tab', id: 'palette-tab-' + entry[0],
        'data-value': entry[0], 'aria-selected': String(selected),
        'aria-controls': 'palette-content', tabindex: selected ? '0' : '-1', text: entry[1],
      });
      tab.addEventListener('click', function () { selectPaletteTab(entry[0]); });
      tab.addEventListener('keydown', function (ev) {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(ev.key) === -1) return;
        ev.preventDefault();
        var next = ev.key === 'Home' ? 'elements' : ev.key === 'End' ? 'presets' :
          (activePaletteTab === 'elements' ? 'presets' : 'elements');
        selectPaletteTab(next);
        tabs.querySelector('[data-value="' + next + '"]').focus();
      });
      tabs.appendChild(tab);
    });
    return tabs;
  }

  function buildPaletteContent() {
    var content = h('div', {
      class: 'palette-content', id: 'palette-content', role: 'tabpanel',
      'aria-labelledby': 'palette-tab-' + activePaletteTab,
    });
    var mobile = App.isMobileView && App.isMobileView();
    if (activePaletteTab === 'presets') {
      if (mobile) {
        var strip = h('div', { class: 'palette-strip palette-preset-strip' });
        buildPresetCards().forEach(function (card) { strip.appendChild(card); });
        content.appendChild(strip);
      } else {
        var list = h('div', { class: 'palette-presets' });
        buildPresetCards().forEach(function (card) { list.appendChild(card); });
        content.appendChild(list);
      }
    } else if (mobile) {
      buildPaletteMobile(content);
    } else {
      DESKTOP_CATEGORIES.forEach(function (cat) { content.appendChild(buildDesktopCategory(cat)); });
    }
    return content;
  }

  function restorePaletteScroll(root) {
    var chips = root.querySelector('.palette-chips');
    if (chips) chips.scrollLeft = paletteChipsScroll;
  }

  function buildPalette() {
    var root = document.getElementById('palette');
    // chip 行滑动位置跨结构重建保留（预设增删、断点跨越）：整树重建会把
    // scrollLeft 归零，用户滑到右侧后 chip 行弹回最左、刚点中的分类飞出视口。
    rememberPaletteScroll(root);
    root.innerHTML = '';
    root.appendChild(buildPaletteTabs());
    root.appendChild(buildPaletteContent());
    restorePaletteScroll(root);
  }

  /** 选项卡切换只更新活动态与内容，保留选项卡的焦点和 DOM。 */
  function selectPaletteTab(tab) {
    if (activePaletteTab === tab) return;
    var root = document.getElementById('palette');
    rememberPaletteScroll(root);
    activePaletteTab = tab;
    var tabs = root.querySelectorAll('.palette-tab');
    for (var i = 0; i < tabs.length; i++) {
      var selected = tabs[i].getAttribute('data-value') === tab;
      tabs[i].classList.toggle('active', selected);
      tabs[i].setAttribute('aria-selected', String(selected));
      tabs[i].setAttribute('tabindex', selected ? '0' : '-1');
    }
    var content = root.querySelector('.palette-content');
    content.parentNode.replaceChild(buildPaletteContent(), content);
    restorePaletteScroll(root);
  }

  /** 移动端当前元素分类的卡片节点。 */
  function buildActiveCards() {
    return CATEGORIES[activeCategory].items.map(function (item) { return buildItemCard(item); });
  }

  /** 当前分类的横向卡片条 */
  function buildCardStrip() {
    var strip = h('div', { class: 'palette-strip' });
    buildActiveCards().forEach(function (n) { strip.appendChild(n); });
    return strip;
  }

  /** ≤768px：元素页的六个分类 chip + 当前分类横向卡片条。 */
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
      chips[i].classList.toggle('active', i === idx);
    }
    var strip = root.querySelector('.palette-strip');
    if (strip) strip.parentNode.replaceChild(buildCardStrip(), strip);
  }

  function buildDesktopCategory(cat) {
    var grid = h('div', { class: 'palette-grid' + (cat.items === DIRECTION_ICONS ? ' direction-grid' : '') });
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
    var direction = typeof item !== 'string' && item.icon.indexOf('arrow_') === 0;
    var card = h('button', {
      class: 'palette-card' + (direction ? ' direction-card' : ''), type: 'button',
      draggable: cardDraggableAttr(),
      title: itemDisplayName(item) + '：点击添加到当前行，或拖入编辑区',
      'aria-label': '添加' + itemDisplayName(item),
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
      nodes.push(h('div', { class: 'palette-empty', text: '还没有预设。使用行上的「存为预设」保存一行，方便下次使用。' }));
      return nodes;
    }
    items.forEach(function (p) {
      var del = h('button', {
        class: 'preset-delete', type: 'button', title: '删除预设',
        'aria-label': '删除预设：' + p.name, text: '✕',
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
        class: 'preset-card', role: 'button', tabindex: '0',
        'aria-label': '预览预设：' + p.name,
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
      card.addEventListener('keydown', function (ev) {
        if (ev.target !== card || (ev.key !== 'Enter' && ev.key !== ' ')) return;
        ev.preventDefault();
        card.click();
      });
      nodes.push(card);
    });
    return nodes;
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
    var root = global.SignColorPicker.create(Object.assign({}, opts, {
      getCity: function () { return App.prefs.paletteCity; },
      onCityChange: setPaletteCity,
    }));
    if (opts.getValue) syncFns.push(root.sync);
    paletteCityFns.push(function () { if (root.isConnected) root.sync(); });
    return root;
  }

  // ─── 右栏：模式管理与签名同步 ──────────────────────────────

  var lastSignature = null;
  var syncFns = [];
  var rowBackgroundId = null;

  function panelMode() {
    if (App.selectedIds().length > 1) return 'batch';
    if (App.selection.elementId) return 'element';
    if (App.presetPreviewId) return 'preset';
    return 'settings';
  }

  /** 结构签名：变化才重建面板；纯值变化走 syncFns。
   *  注意设置面板的签名不含任何值——宽度模式等值变化由 syncFns 回显，
   *  否则每次切换都会整面板重建，重建出的控件不带任何选中态。 */
  function panelSignature() {
    var mode = panelMode();
    if (mode === 'batch') return 'batch:' + App.selectedIds().slice().sort().map(function (id) {
      return id + ':' + State.findElement(App.state, id).element.type;
    }).join(',');
    if (mode === 'element') {
      var found = App.state && State.findElement(App.state, App.selection.elementId);
      if (!found) return 'element:none';
      var extra = found.element.type === 'number-line'
        ? ':n' + (found.element.props.lines || []).length : '';
      return 'element:' + found.element.id + ':' + found.element.type + extra;
    }
    if (mode === 'preset') return 'preset:' + App.presetPreviewId + ':' + Presets.list().length;
    return 'settings:' + App.state.rows.map(function (row) { return row.id; }).join(',');
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
    // 标题与返回按钮
    var mode = panelMode();
    document.getElementById('right-panel-title').textContent =
      mode === 'batch' ? '批量属性' : mode === 'element' ? '元素属性'
        : mode === 'preset' ? '预设预览' : '标识牌设置';
    document.getElementById('close-element-btn').hidden = mode === 'settings';
    document.getElementById('close-element-btn').title = '返回标识牌设置';
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
    if (mode === 'batch') body.appendChild(buildBatchPanel());
    else if (mode === 'element') body.appendChild(buildElementPanel());
    else if (mode === 'preset') body.appendChild(buildPresetPreviewPanel());
    else body.appendChild(buildSettingsPanel());
  }

  // ─── 表单控件工厂 ──────────────────────────────────────────

  var fieldId = 0;
  function field(labelText, control, hint) {
    var id = 'panel-field-' + (++fieldId);
    var label = h('label', { text: labelText, id: id + '-label' });
    if (/^(INPUT|SELECT)$/.test(control.tagName)) {
      control.id = id;
      label.htmlFor = id;
    } else if (control.tagName !== 'BUTTON') {
      control.setAttribute('aria-labelledby', id + '-label');
      if (control.classList.contains('alignment-control')) {
        control.querySelector('select').id = id;
        label.htmlFor = id;
      }
    }
    var children = [label, control];
    if (hint) children.push(h('div', { class: 'hint-text', text: hint }));
    return h('div', { class: 'field' + (control.classList.contains('color-picker') ? ' color-field' : '') }, children);
  }

  function panelSection(title, key) {
    return h('section', { class: 'panel-section', 'data-section': key }, [h('h3', { class: 'section-title', text: title })]);
  }

  var toolIcon = UI.toolIcon;

  function alignmentDropdown(options, getValue, onPick, label, key) {
    var control = UI.alignmentControl(options, getValue, onPick, label, key);
    syncFns.push(control.sync);
    return control.node;
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
    input.addEventListener('blur', function () { App.breakHistoryGroup(); });
    return input;
  }

  function segGroup(options, getValue, onPick) {
    var group = h('div', { class: 'seg-group' });
    var buttons = options.map(function (opt) {
      var b = h('button', { title: opt.title || opt.label, 'aria-label': opt.title || opt.label, 'data-value': opt.value });
      if (opt.icon) {
        b.appendChild(toolIcon(opt.icon));
        b.appendChild(h('span', { class: 'sr-only', text: opt.label }));
        group.classList.add('icon-seg-group');
      } else b.textContent = opt.label;
      b.addEventListener('click', function () { onPick(opt.value); });
      group.appendChild(b);
      return b;
    });
    function paint() {
      var cur = getValue();
      buttons.forEach(function (b) {
        b.classList.toggle('active', b.dataset.value === String(cur));
        b.setAttribute('aria-pressed', String(b.dataset.value === String(cur)));
      });
    }
    syncFns.push(paint);
    paint(); // 构建时立即回显（重建出的面板不含任何值状态）
    return group;
  }

  function boldButton(getValue, onChange) {
    var b = h('button', { class: 'format-btn', title: '加粗', 'aria-label': '加粗' }, [toolIcon('bold'), h('span', { class: 'sr-only', text: '加粗' })]);
    function paint() {
      b.classList.toggle('active', !!getValue());
      b.setAttribute('aria-pressed', String(!!getValue()));
    }
    b.addEventListener('click', function () { onChange(!getValue()); });
    syncFns.push(paint);
    paint();
    return b;
  }

  function checkbox(labelText, getValue, onChange) {
    var id = 'panel-checkbox-' + (++fieldId);
    var input = h('input', { type: 'checkbox', id: id });
    input.addEventListener('change', function () { onChange(input.checked); });
    input.checked = !!getValue(); // 构建时立即回显
    syncFns.push(function () {
      if (document.activeElement !== input) input.checked = !!getValue();
    });
    return h('div', { class: 'field field-inline' }, [
      h('label', { text: labelText, for: id }), input,
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
    root.appendChild(field('行高（px）', rowHeightInput, '默认 192 px（0.75 格）；元素与内边距按行高适配'));

    var rowCount = h('input', { type: 'number', value: s.rows.length, disabled: 'disabled' });
    bindSync(rowCount, function () { return App.state.rows.length; });
    root.appendChild(field('行数（由添加/删除行控制）', rowCount));

    root.appendChild(field('宽度模式', segGroup([
      { value: 'fixed', label: '固定' },
      { value: 'dynamic', label: '动态' },
    ], function () { return App.state.widthMode; }, function (v) {
      App.update(function (st) { return State.updateSignSettings(st, { widthMode: v }); });
    })));

    var unitsSelect = h('select', { class: 'width-units-select' });
    unitsSelect.appendChild(h('option', { value: 'custom', text: '自定义像素宽度' }));
    for (var unit = 1; unit <= 15; unit++) {
      unitsSelect.appendChild(h('option', { value: String(unit), text: String(unit) }));
    }
    unitsSelect.addEventListener('change', function () {
      if (unitsSelect.value === 'custom') { widthInput.focus(); return; }
      App.update(function (st) { return State.setSignWidthUnits(st, Number(unitsSelect.value)); });
    });
    function paintUnits() {
      unitsSelect.value = String(State.signWidthUnits(App.state) || 'custom');
    }
    paintUnits();
    syncFns.push(paintUnits);
    var unitsField = field('标识牌宽度（1–15 格）', unitsSelect, '每格固定 256 px，例如 8 格 = 2048 px；选择格数后行高独立调整');
    function paintUnitsField() { unitsField.hidden = App.state.widthMode !== 'fixed'; }
    paintUnitsField();
    syncFns.push(paintUnitsField);
    root.appendChild(unitsField);

    var widthInput = numberInput({ class: 'sign-width-input', min: '32', max: '32768', step: '16' }, function (v) {
      App.update(function (st) {
        return State.updateSignSettings(st, { width: Math.round(Core.clamp(v, 32, 32768)) });
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
      scope: '标识牌背景色',
      getValue: function () { return App.state.backgroundColor; },
      onChange: function (v) {
        App.update(function (st) {
          return State.updateSignSettings(st, { backgroundColor: v || '#FFFFFF' });
        });
      },
    });
    root.appendChild(h('div', { class: 'section-title', text: '牌面颜色与灰框' }));
    root.appendChild(field('标识牌背景色', bgColor, '未单独设色的行沿用此颜色；元素背景可覆盖它'));
    root.appendChild(buildRowBackgroundSettings());

    var frameWidthInput = numberInput({ class: 'frame-width-input', min: '0', max: '512', step: '1' }, function (v) {
      App.update(function (st) {
        return State.updateSignSettings(st, { frameWidth: Math.round(Core.clamp(v, 0, 512)) });
      });
    });
    frameWidthInput.value = s.frameWidth;
    bindSync(frameWidthInput, function () { return App.state.frameWidth; });
    root.appendChild(field('灰框宽度（px）', frameWidthInput,
      '外缘与行间分割线使用相同宽度；0 为不显示'));
    root.appendChild(field('灰框颜色', buildColorPicker({
      value: s.frameColor,
      scope: '灰框颜色',
      getValue: function () { return App.state.frameColor; },
      onChange: function (v) {
        App.update(function (st) { return State.updateSignSettings(st, { frameColor: v }); });
      },
    }), '作用于每行灰框，宽度为 0 时隐藏'));

    root.appendChild(h('div', { class: 'divider' }));
    root.appendChild(h('div', { class: 'section-title', text: '编辑器' }));
    root.appendChild(checkbox('输入线路号自动匹配线路色', function () { return App.prefs.autoLineColor; }, function (v) {
      setAutoLineColor(v);
    }));
    root.appendChild(h('div', {
      class: 'hint-text',
      text: '开启后输入线路号会自动填充线路色；展开色板后可切换城市。',
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
    // 导出前按需加载实际使用的内嵌字体，加载期间按钮保持忙碌态，
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
    var keys = Object.keys(patch);
    var key = keys.length === 1 && ['textZh', 'textEn', 'text', 'code'].indexOf(keys[0]) !== -1
      ? elementId + ':' + keys[0] : null;
    App.update(function (st) { return State.updateElementProps(st, elementId, patch); }, key);
  }

  /** 行选择用 id 跟踪；所有回调重新查当前状态，避免不可变更新后的过期快照。 */
  function buildRowBackgroundSettings() {
    if (!App.state.rows.some(function (row) { return row.id === rowBackgroundId; })) {
      rowBackgroundId = App.state.rows[0].id;
    }
    function liveRow() {
      return App.state.rows.filter(function (row) { return row.id === rowBackgroundId; })[0];
    }
    function effectiveColor() {
      return liveRow().backgroundColor || App.state.backgroundColor;
    }
    var root = h('div', { class: 'row-background-settings' });
    var select = h('select', { class: 'row-bg-select' });
    App.state.rows.forEach(function (row, i) {
      select.appendChild(h('option', { value: row.id, text: '第 ' + (i + 1) + ' 行' }));
    });
    select.value = rowBackgroundId;
    select.addEventListener('change', function () {
      rowBackgroundId = select.value;
      syncNow();
    });
    root.appendChild(field('单独设置行背景色', select));
    root.appendChild(field('当前行背景色', buildColorPicker({
      value: effectiveColor(), scope: '当前行背景色', getValue: effectiveColor,
      onChange: function (v) {
        App.update(function (st) { return State.updateRowSettings(st, rowBackgroundId, { backgroundColor: v }); });
      },
    })));
    var status = h('div', { class: 'hint-text' });
    var reset = h('button', { class: 'btn row-bg-reset', text: '恢复标识牌背景色' });
    reset.addEventListener('click', function () {
      App.update(function (st) { return State.updateRowSettings(st, rowBackgroundId, { backgroundColor: null }); });
    });
    root.appendChild(status);
    root.appendChild(reset);
    function paint() {
      var ownColor = !!liveRow().backgroundColor;
      root.hidden = App.state.rows.length === 1 && !ownColor;
      select.value = rowBackgroundId;
      status.textContent = ownColor ? '此行已单独设色；元素背景可覆盖它。' : '此行沿用标识牌背景色。';
      reset.disabled = !ownColor;
    }
    paint();
    syncFns.push(paint);
    return root;
  }

  function buildBatchPanel() {
    var root = h('div', { class: 'batch-properties' });
    root.appendChild(h('div', { class: 'element-type-label', text: '已选择 ' + App.selectedIds().length + ' 个元素' }));
    root.appendChild(h('div', { class: 'hint-text', text: '修改后应用于选中的适用元素；“不同”表示当前值不一致。' }));
    var layout = panelSection('批量排版', 'layout');
    [
      { key: 'elementAlign', label: '元素对齐', values: ['left', 'center', 'right'] },
      { key: 'align', label: '文字对齐', values: ['left', 'center', 'right'] },
      { key: 'contentAlign', label: '内容对齐', values: ['left', 'right'] },
    ].forEach(function (item) {
      var control = UI.alignmentControl(item.values.map(function (value) {
        return { value: value, label: value === 'center' ? '居中' : value === 'left' ? '左对齐' : '右对齐' };
      }), function () { return App.alignmentValue(item.key); }, function (value) { App.setAlignment(item.key, value); }, item.label, item.key);
      var row = field(item.label, control.node);
      function sync() {
        row.hidden = !App.alignmentTargets(item.key).length || (item.key === 'elementAlign' && App.state.widthMode !== 'fixed');
        control.sync();
      }
      sync(); syncFns.push(sync); layout.appendChild(row);
    });
    if (App.paddingIds().length) {
      var grid = h('div', { class: 'batch-padding-grid' });
      ['left', 'right'].forEach(function (side) {
        var label = side === 'left' ? '左' : '右';
        var input = numberInput({ min: '0', max: '8', step: '0.05', placeholder: '不同', 'aria-label': label + '内边距' },
          function (v) { App.setPadding(side, Core.clamp(v, 0, 8)); });
        input.value = App.paddingValue(side) === null ? '' : App.paddingValue(side);
        bindSync(input, function () { var v = App.paddingValue(side); return v === null ? '' : v; });
        var trigger = h('button', { type: 'button', class: 'padding-trigger', 'aria-label': '拖动调整' + label + '内边距',
          title: label + '内边距（左右拖动，每档0.05；点击输入）' }, [UI.paddingIcon(side)]);
        UI.bindPaddingScrub(trigger, side, function () { return App.selection.elementId; });
        trigger.addEventListener('click', function () { input.focus(); input.select(); });
        grid.appendChild(h('div', { 'data-padding': side }, [h('div', { class: 'hint-text', text: label }),
          h('div', { class: 'panel-padding-value' }, [trigger, input])]));
      });
      layout.appendChild(field('左右内边距（行高比例）', grid));
    }
    root.appendChild(layout);
    var del = h('button', { class: 'btn btn-danger', text: '删除选中元素' });
    del.addEventListener('click', App.deleteSelection);
    root.appendChild(del);
    return root;
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

    var root = h('div', { class: 'element-properties' });
    root.appendChild(h('div', { class: 'element-type-label', text: TYPE_NAMES[el.type] }));
    var content = panelSection('内容', 'content');
    var layout = panelSection('排版', 'layout');
    var colors = panelSection('元素颜色', 'colors');
    var fields = h('div');

    switch (el.type) {
      case 'arrow': buildArrowFields(fields, el, live); break;
      case 'bilingual-text': buildBilingualFields(fields, el, live); break;
      case 'small-bilingual-text': buildBilingualFields(fields, el, live); break;
      case 'big-number': buildBigNumberFields(fields, el, live); break;
      case 'number-line': buildNumberLineFields(fields, el, live); break;
      case 'text-line': buildTextLineFields(fields, el, live); break;
      case 'entrance':
      case 'exit': buildCodeFields(fields, el, live); break;
      case 'space': buildSpaceFields(fields, el, live); break;
      case 'icon': buildIconFields(fields, el, live); break;
    }
    Array.prototype.slice.call(fields.children).forEach(function (node) {
      if (node.classList.contains('color-field') || node.classList.contains('fixed-color-hint')) colors.appendChild(node);
      else if (node.querySelector('.seg-group, .format-btn, .alignment-control, input[type="range"]')) layout.appendChild(node);
      else content.appendChild(node);
    });

    // 元素对齐：仅固定宽度模式支持（动态宽度整体左起排列）。
    // 编辑过程中宽度模式不会变化（它在设置面板里，与本面板互斥），构建时判断即可。
    if (App.state.widthMode === 'fixed') {
      layout.appendChild(field('元素对齐', alignmentDropdown([
        { value: 'left', label: '贴左' },
        { value: 'center', label: '居中' },
        { value: 'right', label: '贴右' },
      ], function () { return live().props.elementAlign; }, function (v) {
        patchProps(el.id, { elementAlign: v });
      }, '元素对齐', 'elementAlign')));
    }

    if (el.type !== 'exit') {
      colors.appendChild(buildBackgroundPicker(el, live));
    }
    if (el.type !== 'space') {
      layout.appendChild(buildPaddingEditor(el, live));
    }
    [content, layout, colors].forEach(function (section) {
      if (section.children.length > 1) root.appendChild(section);
    });
    colors.appendChild(h('div', { class: 'hint-text', text: '整块标识牌的背景色在返回后的「标识牌设置」中调整。' }));

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

    root.appendChild(field('箭头颜色', buildColorPicker({
      value: el.props.color,
      scope: '箭头颜色',
      getValue: function () { return live().props.color; },
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

    var alignTools = alignmentDropdown([
      { value: 'left', label: '左对齐' },
      { value: 'center', label: '居中' },
      { value: 'right', label: '右对齐' },
    ], function () { return live().props.align; }, function (v) {
      patchProps(el.id, { align: v });
    }, '文字对齐', 'align');

    var bold = boldButton(function () { return live().props.bold; }, function (v) {
      patchProps(el.id, { bold: v });
    });
    root.appendChild(field('文字样式与对齐', h('div', { class: 'text-formatting' }, [bold, alignTools])));

    root.appendChild(field('文字颜色', buildColorPicker({
      value: el.props.color,
      scope: '文字颜色',
      getValue: function () { return live().props.color; },
      onChange: function (v) { patchProps(el.id, { color: v }); },
    })));
  }

  function buildBigNumberFields(root, el, live) {
    var t = textInput({ value: el.props.text, placeholder: '文本，如 16 / 1/2/3/4 / 16号线' }, function (v) {
      patchProps(el.id, { text: v });
    });
    bindSync(t, function () { return live().props.text; });
    root.appendChild(field('内容', t));
    root.appendChild(field('文字颜色', buildColorPicker({
      value: el.props.color,
      scope: '文字颜色',
      getValue: function () { return live().props.color; },
      onChange: function (v) { patchProps(el.id, { color: v }); },
    })));
  }

  /** 内容对齐下拉框（数字线路/文字线路/出口）：元素内部左/右镜像排版，与元素对齐无关 */
  function contentAlignGroup(el, live) {
    return field('内容对齐', alignmentDropdown([
      { value: 'left', label: '左对齐' },
      { value: 'right', label: '右对齐' },
    ], function () { return live().props.align; }, function (v) {
      patchProps(el.id, { align: v });
    }, '内容对齐', 'align'));
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
        var numberId = 'panel-line-' + (++fieldId);
        numInput.id = numberId;
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
          h('label', { class: 'le-label', for: numberId, text: '第 ' + (idx + 1) + ' 条线路 · 线路号' }),
          numInput, removeBtn,
          field('线路色条颜色', buildColorPicker({
            value: line.color,
            scope: '第' + (idx + 1) + '条线路色条颜色',
            mini: true,
            getValue: function () { var cur = lines()[idx]; return cur ? cur.color : null; },
            onChange: function (v) { updateLine(idx, { color: v }); },
          })),
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
    function paintRightOnly() {
      var right = live().props.align === 'right';
      var add = editor.querySelector('.le-add');
      if (add) add.disabled = right;
      rightOnlyHint.style.display = right ? '' : 'none';
    }
    syncFns.push(paintRightOnly);
    paintRightOnly();
    root.appendChild(rightOnlyHint);
    root.appendChild(field('文字颜色', buildColorPicker({
      value: el.props.textColor,
      scope: '文字颜色',
      getValue: function () { return live().props.textColor; },
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

    root.appendChild(field('线路色条颜色', buildColorPicker({
      value: el.props.blockColor,
      scope: '线路色条颜色',
      getValue: function () { return live().props.blockColor; },
      onChange: function (v) { patchProps(el.id, { blockColor: v }); },
    })));
    root.appendChild(field('文字颜色', buildColorPicker({
      value: el.props.textColor,
      scope: '文字颜色',
      getValue: function () { return live().props.textColor; },
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
    root.appendChild(field('文字颜色', buildColorPicker({
      value: el.props.color,
      scope: '文字颜色',
      getValue: function () { return live().props.color; },
      onChange: function (v) { patchProps(el.id, { color: v }); },
    })));
    if (el.type === 'exit') {
      root.appendChild(h('div', { class: 'hint-text fixed-color-hint', text: '元素背景色固定为出口黄 #F7D917' }));
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
      btns.forEach(function (x) {
        x.b.classList.toggle('active', x.id === cur);
        x.b.setAttribute('aria-pressed', String(x.id === cur));
      });
    }
    syncFns.push(paint);
    paint();
    root.appendChild(grid);
    if (curCat === 'service') {
      root.appendChild(field('旋转', segGroup([
        { value: 0, label: '0°', title: '不旋转' },
        { value: -90, label: '↺ 90°', title: '逆时针 90°' },
        { value: 90, label: '↻ 90°', title: '顺时针 90°' },
        { value: 180, label: '180°', title: '旋转 180°' },
      ], function () { return live().props.rotation; }, function (v) {
        patchProps(el.id, { rotation: Number(v) });
      })));
    }
    root.appendChild(field('图标颜色', buildColorPicker({
      value: el.props.color,
      scope: '图标颜色',
      getValue: function () { return live().props.color; },
      onChange: function (v) { patchProps(el.id, { color: v }); },
    })));
    // 元素背景色由通用分发器统一追加（buildFields 末尾，space/exit 除外）
  }

  function buildBackgroundPicker(el, live) {
    var picker = buildColorPicker({
      value: el.props.backgroundColor,
      scope: '元素背景色',
      getValue: function () { return live().props.backgroundColor; },
      nullable: true,
      onChange: function (v) { patchProps(el.id, { backgroundColor: v }); },
    });
    return field('元素背景色', picker, '仅覆盖当前元素的区域；透明时显示标识牌背景色');
  }

  function buildPaddingEditor(el, live) {
    // 上下左右挤一行时输入框过窄（"0.25" 显示成 "0.2"）：
    // 左右一行、上下一行，两行各两框
    var wrap = h('details', { class: 'padding-editor' }, [h('summary', { text: '内边距' })]);
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
      var title = h('div', { class: 'hint-text', text: item.label, style: 'text-align:center;margin-bottom:2px' });
      var valueControl = input;
      if (item.k === 'left' || item.k === 'right') {
        var trigger = h('button', {
          type: 'button', class: 'padding-trigger', 'aria-label': '拖动调整' + item.label + '内边距',
          title: item.label + '内边距（左右拖动，每档0.05；点击输入）',
        }, [UI.paddingIcon(item.k)]);
        UI.bindPaddingScrub(trigger, item.k, function () { return el.id; });
        trigger.addEventListener('click', function () { input.focus(); input.select(); });
        valueControl = h('div', { class: 'panel-padding-value' }, [trigger, input]);
      }
      grid.appendChild(h('div', { 'data-padding': item.k }, [
        title, valueControl,
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
    root.appendChild(h('div', { class: 'hint-text', text: '可将此预设拖入空行，或直接添加为新行。' }));
    var apply = h('button', { class: 'btn btn-primary preset-apply-new-row', text: '＋ 添加为新行' });
    apply.addEventListener('click', function () {
      var elements = Presets.materialize(p.id);
      if (!elements || !elements.length) { SignUI.toast('预设内容为空', 'error'); return; }
      App.update(function (st) {
        var next = State.addRow(st);
        var rowId = next.rows[next.rows.length - 1].id;
        return elements.reduce(function (sign, el) { return State.addElement(sign, rowId, el); }, next);
      });
      App.previewPreset(null);
      SignUI.toast('已将预设添加为新行', 'success');
    });
    root.appendChild(apply);
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
      case 'small-bilingual-text': return (p.textZh || '') + (p.textEn ? ' / ' + p.textEn : '');
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
