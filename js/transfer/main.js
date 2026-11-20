(function (global) {
  'use strict';

  const workspace = document.getElementById('transfer-editor');
  if (workspace.hidden) return;

  const state = global.TransferState;
  const drawing = global.TransferRender;
  const patterns = global.PlatformPatterns;
  const palettePicker = global.SignColorPicker;
  const createElement = global.SignUI.h;
  const storageKey = 'public-transfer-sign-project-v1';
  const presetKey = 'public-transfer-sign-presets-v1';
  const element = identifier => document.getElementById(identifier);
  const vector = element('transfer-sign');
  const preview = element('transfer-preview');
  const previewScroll = element('transfer-preview-scroll');
  const toolbar = element('transfer-element-toolbar');
  const turnButtons = toolbar.querySelectorAll('[data-turn-step]');
  const propertyScroll = element('transfer-property-scroll');
  const propertyTabs = global.PropertyTabs.create(propertyScroll);
  const heading = element('transfer-heading');
  const settingsPanel = element('transfer-settings');
  const groupPlacement = element('transfer-group-placement');
  const backButton = element('transfer-return');
  const modeButtons = Array.from(document.querySelectorAll('[data-transfer-mode]'));
  const arrangementPicker = element('transfer-arrangements');
  const groupList = element('transfer-groups');
  const labelLines = element('transfer-label-lines');
  const directionPicker = element('transfer-directions');
  const lineName = element('transfer-line-name');
  const lineEnglishName = element('transfer-line-english-name');
  const lineLargeName = element('transfer-line-large-name');
  const palette = element('transfer-palette');
  const width = element('transfer-width');
  const frameWidth = element('transfer-frame-width');
  const undoButton = element('transfer-undo');
  const redoButton = element('transfer-redo');
  const exportImage = element('transfer-export-image');
  const exportVector = element('transfer-export-vector');
  const pngScale = element('transfer-png-scale');
  const projectFile = element('transfer-project-file');
  const presetList = element('transfer-preset-list');
  const libraryButtons = workspace.querySelectorAll('[data-transfer-library]');
  const status = element('transfer-status');
  const panels = {
    line: element('transfer-line-properties'),
    arrow: element('transfer-arrow-properties'),
    label: element('transfer-label-properties'),
  };
  const descriptions = { guidance: '贴柱式换乘引导标识', separate: '贴柱式换乘标识' };
  const history = { undo: [], redo: [] };
  const historyLimit = 20;
  let previousGroup;
  let groupTime = 0;
  let paletteRevision = -1;
  let shownPalette;
  let shownMode;
  let shownArrangement;
  let shownLabelGroup;
  let scene;
  let currentGroups;
  let drawnGraphics;
  let drawnMode;
  let drawnArrangement;
  let toolbarFrame;
  let selected;
  let previousPanelSelection;

  function notice(message) {
    if (status.textContent !== message) {
      status.textContent = message;
      global.EditorMotion.reveal(status);
    }
  }

  function loadProject() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return state.deserialize(saved);
    } catch {
      notice('未能恢复本地项目，已打开默认标识牌');
    }
  }

  function readPresets() {
    try {
      const records = JSON.parse(localStorage.getItem(presetKey) || '[]');
      if (!Array.isArray(records)) throw new Error();
      return records.filter(record => typeof record?.id === 'string' && typeof record.name === 'string' && typeof record.project === 'string');
    } catch {
      notice('无法读取本机换乘预设');
      return null;
    }
  }

  function writePresets(records) {
    try {
      localStorage.setItem(presetKey, JSON.stringify(records));
      return true;
    } catch {
      notice('无法保存换乘预设，请检查浏览器存储空间');
      return false;
    }
  }

  function renderPresets() {
    const cards = (readPresets() || []).map(record => {
      let project;
      try { project = state.deserialize(record.project); }
      catch { /* 保留删除入口，便于清理无法载入的旧预设。 */ }
      const load = createElement('button', { type: 'button', class: 'preset-load', 'aria-label': '载入预设 ' + record.name });
      if (project) {
        const thumbnail = document.createElementNS(global.SignCore.SVG_NS, 'svg');
        drawing.draw(thumbnail, drawing.layout(project, App.measure), true);
        thumbnail.removeAttribute('width');
        thumbnail.removeAttribute('height');
        thumbnail.setAttribute('aria-hidden', 'true');
        load.append(thumbnail);
      }
      load.append(createElement('strong', { text: record.name }));
      load.addEventListener('click', () => {
        if (!project) { notice('无法载入此换乘预设'); return; }
        App.update(() => project, null, { replaceProject: true });
        propertyTabs.show('edit');
        notice('已载入预设「' + record.name + '」');
      });
      const remove = createElement('button', { type: 'button', class: 'preset-remove', 'data-control-icon': 'delete', 'aria-label': '删除预设 ' + record.name });
      remove.addEventListener('click', async () => {
        if (!await global.SignUI.confirmDialog('确定要删除预设「' + record.name + '」吗？', '删除预设', '删除', 'delete')) return;
        const records = readPresets();
        if (records && writePresets(records.filter(item => item.id !== record.id))) {
          renderPresets();
          workspace.querySelector('[data-transfer-library="presets"]').focus();
        }
      });
      return createElement('div', { class: 'platform-preset' }, [load, remove]);
    });
    presetList.replaceChildren(...(cards.length ? cards : [createElement('p', { class: 'preset-empty', text: '在「项目」中保存当前标识牌。' })]));
  }

  function selectLibrary(name) {
    const showPresets = name === 'presets';
    const changed = presetList.hidden === showPresets;
    const elements = element('transfer-element-library');
    elements.hidden = showPresets;
    presetList.hidden = !showPresets;
    for (const button of libraryButtons) button.setAttribute('aria-pressed', String(button.dataset.transferLibrary === name));
    if (showPresets) renderPresets();
    if (changed) global.EditorMotion.reveal(showPresets ? presetList : elements, showPresets ? 1 : -1);
  }

  async function savePreset() {
    const project = state.serialize(App.state);
    const name = await global.SignUI.promptDialog('为这个换乘标识预设起个名字：', '保存为预设', '', '如：贴柱式换乘牌');
    if (name === null) return;
    const records = readPresets();
    if (records && writePresets(records.concat({ id: global.SignCore.uuid(), name: name.slice(0, 80), project }))) {
      selectLibrary('presets');
      notice('预设「' + name.slice(0, 80) + '」已保存');
    }
  }

  const restoredProject = loadProject();
  const App = global.App = {
    state: restoredProject || state.create(),
    measure: global.SignCore.createCanvasMeasurer(),
    update(change, group, options) {
      const next = change(App.state);
      const saved = state.serialize(next);
      if (saved === state.serialize(App.state)) return;
      if (options?.replaceProject) {
        pushChange(history.undo, projectSnapshot());
        history.redo.length = 0;
      } else if (next.mode === App.state.mode) {
        const now = Date.now();
        if (!group || group !== previousGroup || now - groupTime >= 800) {
          pushChange(history.undo, boardSnapshot());
        }
        previousGroup = group;
        groupTime = now;
        const boundary = history.redo.findLastIndex(entry => entry.project);
        history.redo = history.redo.slice(boundary + 1).filter(entry => entry.mode !== next.mode);
      }
      if (options?.replaceProject || next.mode !== App.state.mode) {
        previousGroup = undefined;
        selected = undefined;
        propertyScroll.scrollTop = 0;
      }
      commit(next, saved);
    },
  };

  const autosave = global.SignStorage.createAutosave({
    storageKey,
    indicator: element('transfer-save'),
    serializeProject: () => state.serialize(App.state),
    exportProject,
    restored: Boolean(restoredProject),
  });
  const previewZoom = global.PreviewZoom.create({
    viewport: previewScroll,
    stage: previewScroll.firstElementChild,
    paper: vector.parentElement,
    graphic: vector,
    controls: element('transfer-zoom'),
    onChange: positionToolbar,
  });

  function projectSnapshot() {
    return { project: App.state, selection: selected?.key ?? null };
  }

  function boardSnapshot(mode = App.state.mode) {
    return { mode, board: App.state.boards[mode] };
  }

  function pushChange(entries, change) {
    entries.push(change);
    if (entries.filter(entry => entry.mode === change.mode).length <= historyLimit) return;
    const oldest = entries.findIndex(entry => entry.mode === change.mode);
    if (entries[oldest].project) entries.splice(0, oldest + 1);
    else entries.splice(oldest, 1);
  }

  function latestChange(entries) {
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      // 跳过另一版式的后续修改会让修改记录留在错误的项目里。
      if (entry.project) return entries.length - 1;
      if (entry.mode === App.state.mode) return index;
    }
    return -1;
  }

  function selectedEditableGroup() {
    if (selected?.kind !== 'arrow' && selected?.kind !== 'label') return undefined;
    return currentGroups.find(group => group.identifier === selected.identifier && group.alignment);
  }

  const alignmentOptions = Object.entries(state.alignmentNames).map(([value, label]) => ({ value, label }));
  const alignmentControls = ['transfer-tool-alignment', 'transfer-group-alignment'].map(identifier => {
    const host = element(identifier);
    const control = global.SignUI.alignmentControl(alignmentOptions, () => selectedEditableGroup()?.alignment, alignment => {
      const group = selectedEditableGroup();
      if (group) App.update(project => state.changeAlignment(project, group.identifier, alignment));
    }, '本组对齐', 'transfer-group');
    host.append(control.node);
    return { host, control };
  });

  const arrowPositionControls = ['transfer-tool-arrow-position', 'transfer-group-arrow-position'].map(identifier => {
    const host = element(identifier);
    const select = createElement('select', { class: 'transfer-arrow-position', 'aria-label': '箭头位置' },
      Object.entries(state.arrowPositionNames).map(([value, name]) => createElement('option', { value, text: name })),
    );
    select.addEventListener('change', () => {
      const group = selectedEditableGroup();
      if (group) App.update(project => state.changeArrowPosition(project, group.identifier, select.value));
    });
    host.append(select);
    return { host, select };
  });

  function commit(next, saved = state.serialize(next), selection = selected?.key) {
    App.state = next;
    autosave.schedule(saved);
    render(selection);
  }

  function restore(fromName, toName) {
    previousGroup = undefined;
    const from = history[fromName];
    const index = latestChange(from);
    if (index < 0) return;
    const [entry] = from.splice(index, 1);
    if (entry.project) {
      pushChange(history[toName], projectSnapshot());
      propertyScroll.scrollTop = 0;
      commit(entry.project, undefined, entry.selection);
    } else {
      const switchesBoard = entry.mode !== App.state.mode;
      if (switchesBoard) propertyScroll.scrollTop = 0;
      pushChange(history[toName], boardSnapshot(entry.mode));
      const project = state.settings(App.state, { mode: entry.mode });
      commit(state.replaceBoard(project, entry.board), undefined, switchesBoard ? null : selected?.key);
    }
  }

  function changeSettings(changes) {
    App.update(current => state.settings(current, changes));
  }

  function findLine(project, identifier) {
    return state.board(project).lines.find(line => line.identifier === identifier);
  }

  function selectedLine() {
    return selected?.kind === 'line' ? findLine(App.state, selected.identifier) : undefined;
  }

  function changeLine(changes, group) {
    const line = selectedLine();
    if (line) App.update(current => state.changeLine(current, line.identifier, changes), group);
  }

  function changePattern(changes, group) {
    const line = selectedLine();
    if (!line) return;
    App.update(current => {
      const previous = findLine(current, line.identifier);
      return state.changeLine(current, line.identifier, { linePattern: { ...previous.linePattern, ...changes } });
    }, group);
  }

  const syncPattern = patterns.init(element('line-pattern-section'), {
    read: selectedLine, update: changePattern, notice,
  });

  const colorPicker = palettePicker.create({
    scope: '线路色',
    value: state.board(App.state).lines[0].color,
    hexId: 'transfer-line-color-value',
    nativeId: 'transfer-line-color',
    getValue: () => selectedLine()?.color || state.board(App.state).lines[0].color,
    getCity: () => state.board(App.state).city,
    onCityChange: city => changeSettings({ city }),
    onChange: color => changeLine({ color }, 'line-color'),
  });
  element('transfer-line-color-picker').append(colorPicker);

  let framePalette;
  const frameColorPicker = palettePicker.create({
    scope: '灰框颜色',
    value: state.board(App.state).frameColor,
    hexId: 'transfer-frame-color-value',
    getValue: () => state.board(App.state).frameColor,
    getCity: () => framePalette ?? state.board(App.state).city,
    onCityChange: city => {
      framePalette = city;
      frameColorPicker.sync();
    },
    onChange: color => App.update(project => state.settings(project, { frameColor: color }), 'frame-color'),
  });
  element('transfer-frame-color-picker').append(frameColorPicker);

  function arrowIcon(direction) {
    const icon = global.SignDirections.icon(direction);
    const image = document.createElementNS(global.SignCore.SVG_NS, 'svg');
    image.setAttribute('viewBox', icon.vb);
    image.setAttribute('aria-hidden', 'true');
    image.innerHTML = icon.body.replaceAll('fill="black"', 'fill="currentColor"');
    return image;
  }

  for (const { direction, name: title } of global.SignDirections.items) {
    directionPicker.append(createElement('button', {
      type: 'button', class: 'palette-card direction-card', 'data-transfer-direction': direction,
      'aria-label': title, 'aria-pressed': 'false', title,
    }, [createElement('span', { class: 'card-icon' }, [arrowIcon(direction)])]));
  }

  function groupTitle(identifier) {
    if (currentGroups.length === 1) return '换乘方向';
    return identifier === 'upper' ? '上方一组' : '下方一组';
  }

  function lineTitle(line) {
    return line.number ? line.number + '号线' : line.line || line.englishName || '未填写线路';
  }

  function targetTitle(target) {
    if (target.kind === 'line') return lineTitle(state.displayLine(App.state, findLine(App.state, target.identifier)));
    if (currentGroups.length === 1) return target.kind === 'arrow' ? '箭头方向' : '换乘文字';
    return (target.identifier === 'upper' ? '上方' : '下方') + (target.kind === 'arrow' ? '箭头' : '换乘文字');
  }

  function lineButton(line) {
    return createElement('button', {
      type: 'button', class: 'transfer-line-button', 'data-select-transfer': 'line:' + line.identifier,
      'data-select-line': line.identifier,
    }, [
      createElement('span', { class: 'transfer-line-swatch', 'aria-hidden': 'true' }),
      createElement('span', { class: 'transfer-line-title' }),
      createElement('span', { class: 'transfer-line-more', 'aria-hidden': 'true', text: '›' }),
    ]);
  }

  function syncGroupList(mode, arrangement) {
    if (mode !== shownMode) {
      const names = mode === 'separate'
        ? { '1': '单线路', '1+1': '1 + 1', '1+2': '1 + 2', '2+1': '2 + 1' }
        : { '1': '一条线路', '2': '两条线路' };
      arrangementPicker.replaceChildren(...Object.entries(names).map(([value, name]) =>
        createElement('button', { type: 'button', 'data-transfer-arrangement': value, text: name }),
      ));
    }
    if (mode !== shownMode || arrangement !== shownArrangement) {
      groupList.replaceChildren(...currentGroups.map(group =>
        createElement('div', { class: 'transfer-group' }, [
          createElement('div', { class: 'transfer-group-heading' }, [
            createElement('strong', { text: groupTitle(group.identifier) }),
            createElement('button', {
              type: 'button', class: 'transfer-group-arrow', 'data-select-transfer': 'arrow:' + group.identifier,
            }),
          ]),
          ...group.lines.map(lineButton),
        ]),
      ));
      shownMode = mode;
      shownArrangement = arrangement;
      shownLabelGroup = undefined;
      labelLines.replaceChildren();
    }

    for (const button of arrangementPicker.children) {
      button.setAttribute('aria-pressed', String(button.dataset.transferArrangement === arrangement));
    }
    for (const group of currentGroups) {
      const button = groupList.querySelector('[data-select-transfer="arrow:' + group.identifier + '"]');
      if (button.dataset.direction !== group.direction) {
        button.dataset.direction = group.direction;
        button.replaceChildren(arrowIcon(group.direction), createElement('span', { text: state.directions[group.direction] }));
        button.setAttribute('aria-label', targetTitle({ kind: 'arrow', identifier: group.identifier }) + '，' + state.directions[group.direction]);
      }
    }
  }

  function positionToolbar() {
    const target = vector.querySelector('[aria-pressed="true"]');
    const bounds = target?.getBoundingClientRect();
    const frame = preview.getBoundingClientRect();
    const canvas = previewScroll.getBoundingClientRect();
    const right = canvas.left + previewScroll.clientWidth;
    const bottom = canvas.top + previewScroll.clientHeight;
    const visible = !!bounds && bounds.bottom > canvas.top && bounds.top < bottom && bounds.right > canvas.left && bounds.left < right;
    global.EditorMotion.setToolbarVisible(toolbar, visible);
    if (!visible) return;
    const toolbarWidth = toolbar.offsetWidth;
    const toolbarHeight = toolbar.offsetHeight;
    const centered = bounds.left - frame.left + (bounds.width - toolbarWidth) / 2;
    const above = bounds.top - frame.top - toolbarHeight - 8;
    const left = Math.max(8, Math.min(centered, right - frame.left - toolbarWidth - 8));
    const top = above >= canvas.top - frame.top ? above : bounds.bottom - frame.top + 8;
    const controlsSpace = parseFloat(getComputedStyle(previewScroll).paddingBottom);
    const boundedTop = Math.max(canvas.top - frame.top + 4, Math.min(top, bottom - controlsSpace - frame.top - toolbarHeight - 4));
    global.EditorMotion.placeToolbar(toolbar, left, boundedTop, selected.key);
  }

  function syncSelection() {
    settingsPanel.hidden = !!selected;
    backButton.hidden = !selected;
    for (const [kind, panel] of Object.entries(panels)) panel.hidden = selected?.kind !== kind;
    const title = selected ? targetTitle(selected) : '标识牌设置';
    if (heading.textContent !== title) {
      heading.textContent = title;
      heading.title = title;
    }
    for (const target of vector.querySelectorAll('[data-transfer-element]')) {
      target.setAttribute('aria-pressed', String(target.dataset.transferElement === selected?.key));
    }
    const group = selectedEditableGroup();
    groupPlacement.hidden = !group;
    for (const { host, control } of alignmentControls) {
      host.hidden = !group;
      if (group) control.sync();
    }
    for (const { host, select } of arrowPositionControls) {
      host.hidden = !group;
      if (group) select.value = group.arrowPosition;
    }
    propertyTabs.sync(selected?.kind || 'settings');
    const panelSelection = selected?.key || '';
    if (previousPanelSelection !== undefined && panelSelection !== previousPanelSelection) {
      const direction = !selected ? -1 : previousPanelSelection ? 0 : 1;
      global.EditorMotion.reveal(selected ? panels[selected.kind] : settingsPanel, direction);
      if (group) global.EditorMotion.reveal(groupPlacement, direction);
    }
    previousPanelSelection = panelSelection;
    if (!selected) {
      global.EditorMotion.setToolbarVisible(toolbar, false);
      syncLineButtons();
      return;
    }

    const edit = element('transfer-tool-edit');
    const pattern = element('transfer-tool-pattern');
    const direction = selected.kind === 'arrow' ? state.board(App.state).directions[selected.identifier] : undefined;
    element('transfer-toolbar-title').textContent = title;
    pattern.hidden = selected.kind !== 'line';
    for (const button of turnButtons) button.hidden = !global.SignDirections.canTurn(direction);
    edit.textContent = selected.kind === 'arrow' ? '选方向' : '编辑线路';
    if (selected.kind === 'line') {
      const line = selectedLine();
      const display = state.displayLine(App.state, line);
      if (lineName.value !== line.name) lineName.value = line.name;
      if (lineEnglishName.value !== line.englishName) lineEnglishName.value = line.englishName;
      lineEnglishName.parentElement.hidden = !!display.number;
      lineLargeName.parentElement.hidden = !!display.number || !display.line;
      lineLargeName.setAttribute('aria-checked', String(line.largeName));
      colorPicker.sync();
      syncPattern(display);
      pattern.textContent = line.linePattern.enabled ? '关闭底纹' : '启用底纹';
      pattern.setAttribute('aria-pressed', String(line.linePattern.enabled));
    } else if (selected.kind === 'arrow') {
      for (const button of directionPicker.children) {
        button.setAttribute('aria-pressed', String(button.dataset.transferDirection === direction));
      }
    } else if (selected.identifier !== shownLabelGroup) {
      const group = currentGroups.find(group => group.identifier === selected.identifier);
      labelLines.replaceChildren(...group.lines.map(lineButton));
      shownLabelGroup = selected.identifier;
    }
    syncLineButtons();
    positionToolbar();
  }

  function syncLineButtons() {
    for (const button of workspace.querySelectorAll('[data-select-line]')) {
      const line = state.displayLine(App.state, findLine(App.state, button.dataset.selectLine));
      button.querySelector('.transfer-line-swatch').style.backgroundColor = line.color;
      button.querySelector('.transfer-line-title').textContent = lineTitle(line);
    }
  }

  function select(key) {
    const next = scene.elements.find(target => target.key === key);
    if (next?.key === selected?.key) return;
    selected = next;
    previousGroup = undefined;
    propertyScroll.scrollTop = 0;
    syncSelection();
  }

  function readGraphicPositions() {
    const positions = new Map();
    for (const [key, graphic] of drawnGraphics) {
      const { bounds, node } = graphic;
      const style = getComputedStyle(node);
      const [x = 0, y = 0] = style.translate.split(' ').map(value => parseFloat(value) || 0);
      const [, scaleY = 1] = style.scale.split(' ').map(value => parseFloat(value) || 1);
      positions.set(key, { left: bounds.left + x, top: bounds.top + y, height: bounds.height * scaleY, content: graphic.content, opacity: Number(style.opacity) });
    }
    return positions;
  }

  function moveGraphics(positions, rearranged) {
    const moving = [];
    for (const [key, graphic] of drawnGraphics) {
      const { node, bounds, content, kind } = graphic;
      const previous = positions.get(key);
      if (!previous || previous.content !== content) {
        if (rearranged) global.EditorMotion.fadeIn(node);
        continue;
      }
      const x = previous.left - bounds.left;
      const y = previous.top - bounds.top;
      const scale = kind === 'line' ? previous.height / bounds.height : 1;
      if (Math.hypot(x, y) < .1 && Math.abs(scale - 1) < .001 && previous.opacity === 1) continue;
      if (kind === 'line') {
        node.style.transformBox = 'fill-box';
        node.style.transformOrigin = 'left top';
      }
      const animation = global.EditorMotion.play(node, [
        { translate: x + 'px ' + y + 'px', scale: '1 ' + scale, opacity: previous.opacity },
        { translate: '0px 0px', scale: '1 1', opacity: 1 },
      ], 'reveal');
      if (animation) moving.push(animation);
    }
    if (!moving.length) return;
    function followSelection() {
      positionToolbar();
      if (moving.some(animation => animation.pending || animation.playState === 'running')) toolbarFrame = requestAnimationFrame(followSelection);
    }
    toolbarFrame = requestAnimationFrame(followSelection);
  }

  function render(selection = selected?.key) {
    const project = App.state;
    const board = state.board(project);
    const groups = state.groups(project);
    const switched = drawnMode && drawnMode !== project.mode;
    const rearranged = drawnMode === project.mode && drawnArrangement !== board.arrangement;
    const placementChanged = drawnMode === project.mode && groups.some((group, index) => {
      const previous = currentGroups[index];
      return previous && (group.alignment !== previous.alignment || group.arrowPosition !== previous.arrowPosition);
    });
    const positions = (rearranged || placementChanged) && global.EditorMotion.timing(vector).duration ? readGraphicPositions() : null;
    const previous = scene;
    const finishCrossfade = switched ? global.EditorMotion.prepareGraphicCrossfade(vector, old => drawing.draw(old, previous, true)) : null;
    cancelAnimationFrame(toolbarFrame);
    drawnMode = project.mode;
    drawnArrangement = board.arrangement;
    currentGroups = groups;
    scene = drawing.layout(project, App.measure);
    const focused = document.activeElement?.dataset.transferElement;
    drawnGraphics = drawing.draw(vector, scene);
    if (positions) moveGraphics(positions, rearranged);
    selected = scene.elements.find(target => target.key === selection);
    for (const target of scene.elements) {
      const control = vector.querySelector('[data-transfer-element="' + target.key + '"]');
      control.setAttribute('aria-label', targetTitle(target));
      if (focused === target.key) control.focus({ preventScroll: true });
    }
    element('transfer-preview-title').textContent = state.modeNames[project.mode];
    element('transfer-dimensions').textContent = scene.width + ' × ' + scene.height + ' 像素';
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.transferMode === project.mode));
    width.value = board.width;
    if (document.activeElement !== frameWidth) frameWidth.value = board.frameWidth;
    frameColorPicker.sync();
    const revision = global.SignPalettes.revision();
    if (revision !== paletteRevision || shownPalette !== board.city) {
      palettePicker.syncPaletteSelect(palette, board.city);
      paletteRevision = revision;
      shownPalette = board.city;
    }
    palette.value = board.city;
    syncGroupList(project.mode, board.arrangement);
    syncSelection();
    previewZoom.refresh(scene.width, scene.height);
    finishCrossfade?.();
    undoButton.disabled = latestChange(history.undo) < 0;
    redoButton.disabled = latestChange(history.redo) < 0;
  }

  function exportProject() {
    const storage = global.SignStorage;
    storage.exportProject(() => state.serialize(App.state), '换乘标识项目-' + storage.timestamp() + '.json', notice);
  }

  async function readProject(source) {
    const project = state.deserializeProject(source);
    const images = new Set(Object.values(project.boards).flatMap(board => board.lines.map(line => line.linePattern.image)));
    await Promise.all(Array.from(images, patterns.validateImage));
    return project;
  }

  async function prepareExport(project) {
    await App.ready;
    const layout = drawing.layout(project, App.measure);
    const fonts = await global.SignExporters.ensureUsedFontData(layout.usedFonts);
    return { layout, source: drawing.exportVector(layout, fonts) };
  }

  async function exportSign(format) {
    const project = App.state;
    const scale = Number(pngScale.value);
    exportImage.disabled = exportVector.disabled = true;
    notice('正在导出…');
    try {
      const { layout, source } = await prepareExport(project);
      const file = format === 'svg'
        ? new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
        : await global.SignExporters.rasterizePNG(source, layout, scale);
      const storage = global.SignStorage;
      storage.download(file, descriptions[project.mode] + '-' + storage.timestamp() + '.' + format);
      notice('已导出 ' + format.toUpperCase());
    } catch (error) {
      notice('导出失败。' + error.message);
    } finally {
      exportImage.disabled = exportVector.disabled = false;
    }
  }

  function setDirection(direction) {
    if (selected?.kind === 'arrow') App.update(project => state.changeDirection(project, selected.identifier, direction));
  }

  for (const button of modeButtons) {
    const mode = button.dataset.transferMode;
    button.textContent = state.modeNames[mode];
    button.addEventListener('click', () => changeSettings({ mode }));
  }
  workspace.addEventListener('click', event => {
    const target = event.target.closest('[data-transfer-element], [data-select-transfer]');
    if (target) select(target.dataset.transferElement || target.dataset.selectTransfer);
    else if (previewScroll.contains(event.target)) select();
  });
  arrangementPicker.addEventListener('click', event => {
    const button = event.target.closest('[data-transfer-arrangement]');
    if (button) changeSettings({ arrangement: button.dataset.transferArrangement });
  });
  directionPicker.addEventListener('click', event => {
    const button = event.target.closest('[data-transfer-direction]');
    if (button) setDirection(button.dataset.transferDirection);
  });
  vector.addEventListener('keydown', event => {
    if (!event.target.dataset.transferElement || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    select(event.target.dataset.transferElement);
  });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.key !== 'Escape' || document.querySelector('dialog[open], .modal-mask')) return;
    if (selected) select();
  });
  backButton.addEventListener('click', () => { select(); heading.focus(); });
  element('transfer-tool-edit').addEventListener('click', () => {
    propertyTabs.show('edit');
    const target = selected.kind === 'line' ? lineName : selected.kind === 'arrow'
      ? directionPicker.querySelector('[aria-pressed="true"]') : labelLines.firstElementChild;
    target.focus();
  });
  element('transfer-tool-pattern').addEventListener('click', () => {
    const line = selectedLine();
    if (!line) return;
    changePattern({ enabled: !line.linePattern.enabled });
    if (!line.linePattern.enabled) propertyTabs.show('appearance');
  });
  for (const button of turnButtons) {
    button.addEventListener('click', () => {
      if (selected?.kind !== 'arrow') return;
      const direction = state.board(App.state).directions[selected.identifier];
      const nextDirection = global.SignDirections.turn(direction, Number(button.dataset.turnStep));
      if (nextDirection) setDirection(nextDirection);
    });
  }
  lineName.addEventListener('input', () => changeLine({ name: lineName.value }, 'line-name'));
  lineEnglishName.addEventListener('input', () => changeLine({ englishName: lineEnglishName.value }, 'line-english-name'));
  lineLargeName.addEventListener('click', () => changeLine({ largeName: !selectedLine()?.largeName }));
  propertyScroll.addEventListener('focusout', () => { previousGroup = undefined; });
  palette.addEventListener('change', () => changeSettings({ city: palette.value }));
  width.min = state.minimumWidth;
  width.max = state.maximumWidth;
  width.addEventListener('change', () => {
    const current = state.board(App.state);
    changeSettings({ width: Number.isFinite(width.valueAsNumber) ? width.valueAsNumber : current.width });
    width.value = state.board(App.state).width;
  });
  frameWidth.max = state.maximumFrameWidth;
  frameWidth.addEventListener('change', () => {
    if (Number.isFinite(frameWidth.valueAsNumber)) changeSettings({ frameWidth: frameWidth.valueAsNumber });
    frameWidth.value = state.board(App.state).frameWidth;
  });
  undoButton.addEventListener('click', () => restore('undo', 'redo'));
  redoButton.addEventListener('click', () => restore('redo', 'undo'));
  exportImage.addEventListener('click', () => exportSign('png'));
  global.ImageUploadDialog.addButton(exportVector, async () => {
    const { layout, source } = await prepareExport(App.state);
    return global.SignExporters.rasterizePNG(source, layout);
  });
  exportVector.addEventListener('click', () => exportSign('svg'));
  element('transfer-export-project').addEventListener('click', exportProject);
  element('transfer-import-project').addEventListener('click', () => projectFile.click());
  element('transfer-preset-actions').append(global.SignUI.presetSaveButton(savePreset, {
    id: 'transfer-save-preset', class: 'btn', title: '将两种版式保存为预设',
  }));
  for (const button of libraryButtons) button.addEventListener('click', () => selectLibrary(button.dataset.transferLibrary));
  global.addEventListener('storage', event => { if (event.key === presetKey && !presetList.hidden) renderPresets(); });
  global.SignStorage.bindProjectImport({
    input: projectFile,
    deserialize: readProject,
    applyProject: project => App.update(() => project, null, { replaceProject: true }),
    notice,
  });
  global.addEventListener('sign-palettes-change', () => render());
  previewScroll.addEventListener('scroll', positionToolbar);

  render();
  App.ready = Promise.all([
    document.fonts.load('400 20px MiSans', '换乘 号线 Transfer Line'),
    document.fonts.load('400 20px Frutiger', '0123456789/'),
  ]).then(() => {
    App.measure = global.SignCore.createCanvasMeasurer();
    render();
  }).catch(() => notice('字体加载失败，预览使用备用字体'));
})(window);
