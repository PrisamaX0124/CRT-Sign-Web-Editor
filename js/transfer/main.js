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
  const element = identifier => document.getElementById(identifier);
  const vector = element('transfer-sign');
  const preview = element('transfer-preview');
  const previewScroll = element('transfer-preview-scroll');
  const toolbar = element('transfer-element-toolbar');
  const turnButtons = toolbar.querySelectorAll('[data-turn-step]');
  const propertyScroll = element('transfer-property-scroll');
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
  const undoButton = element('transfer-undo');
  const redoButton = element('transfer-redo');
  const exportImage = element('transfer-export-image');
  const exportVector = element('transfer-export-vector');
  const status = element('transfer-status');
  const panels = {
    line: element('transfer-line-properties'),
    arrow: element('transfer-arrow-properties'),
    label: element('transfer-label-properties'),
  };
  const descriptions = { guidance: '贴柱式换乘引导标识', separate: '贴柱式换乘标识' };
  const history = {
    guidance: { undo: [], redo: [] },
    separate: { undo: [], redo: [] },
  };
  let previousGroup;
  let groupTime = 0;
  let paletteRevision = -1;
  let shownMode;
  let shownArrangement;
  let shownLabelGroup;
  let scene;
  let currentGroups;
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
      return saved ? state.deserialize(saved) : state.create();
    } catch {
      notice('未能恢复本地项目，已打开默认标识牌');
      return state.create();
    }
  }

  const App = global.App = {
    state: loadProject(),
    measure: global.SignCore.createCanvasMeasurer(),
    update(change, group) {
      const next = change(App.state);
      const saved = state.serialize(next);
      if (saved === state.serialize(App.state)) return;
      if (next.mode === App.state.mode) {
        const { undo, redo } = history[next.mode];
        const now = Date.now();
        if (!group || group !== previousGroup || now - groupTime >= 800) {
          undo.push(state.board(App.state));
          if (undo.length > 20) undo.shift();
        }
        previousGroup = group;
        groupTime = now;
        redo.length = 0;
      } else {
        previousGroup = undefined;
        selected = undefined;
        propertyScroll.scrollTop = 0;
      }
      commit(next, saved);
    },
  };

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

  function commit(next, saved = state.serialize(next)) {
    App.state = next;
    render();
    try {
      localStorage.setItem(storageKey, saved);
      notice('已保存到本机');
    } catch {
      notice('未能保存到本机');
    }
  }

  function restore(fromName, toName) {
    previousGroup = undefined;
    const currentHistory = history[App.state.mode];
    const from = currentHistory[fromName];
    if (!from.length) return;
    currentHistory[toName].push(state.board(App.state));
    commit(state.replaceBoard(App.state, from.pop()));
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
    if (toolbar.hidden) return;
    const target = vector.querySelector('[aria-pressed="true"]');
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    const frame = preview.getBoundingClientRect();
    const canvas = previewScroll.getBoundingClientRect();
    const toolbarWidth = toolbar.offsetWidth;
    const toolbarHeight = toolbar.offsetHeight;
    const centered = bounds.left - frame.left + (bounds.width - toolbarWidth) / 2;
    const above = bounds.top - frame.top - toolbarHeight - 8;
    const left = Math.max(8, Math.min(centered, frame.width - toolbarWidth - 8));
    const top = above >= canvas.top - frame.top ? above : bounds.bottom - frame.top + 8;
    global.EditorMotion.placeToolbar(toolbar, left, top, selected.key);
  }

  function syncSelection() {
    settingsPanel.hidden = !!selected;
    backButton.hidden = !selected;
    for (const [kind, panel] of Object.entries(panels)) panel.hidden = selected?.kind !== kind;
    const title = selected ? targetTitle(selected) : '标识牌设置';
    if (heading.textContent !== title) heading.textContent = title;
    for (const target of vector.querySelectorAll('[data-transfer-element]')) {
      target.setAttribute('aria-pressed', String(target.dataset.transferElement === selected?.key));
    }
    global.EditorMotion.setToolbarVisible(toolbar, !!selected);
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
    const panelSelection = selected?.key || '';
    if (previousPanelSelection !== undefined && panelSelection !== previousPanelSelection) {
      const direction = !selected ? -1 : previousPanelSelection ? 0 : 1;
      global.EditorMotion.reveal(selected ? panels[selected.kind] : settingsPanel, direction);
      if (group) global.EditorMotion.reveal(groupPlacement, direction);
    }
    previousPanelSelection = panelSelection;
    if (!selected) {
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

  function render() {
    const project = App.state;
    const board = state.board(project);
    currentGroups = state.groups(project);
    scene = drawing.layout(project, App.measure);
    const focused = document.activeElement?.dataset.transferElement;
    drawing.draw(vector, scene);
    if (selected && !scene.elements.some(target => target.key === selected.key)) selected = undefined;
    for (const target of scene.elements) {
      const control = vector.querySelector('[data-transfer-element="' + target.key + '"]');
      control.setAttribute('aria-label', targetTitle(target));
      if (focused === target.key) control.focus({ preventScroll: true });
    }
    element('transfer-preview-title').textContent = state.modeNames[project.mode];
    element('transfer-dimensions').textContent = scene.width + ' × ' + scene.height + ' 像素';
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.transferMode === project.mode));
    width.value = board.width;
    const revision = global.SignPalettes.revision();
    if (revision !== paletteRevision) {
      palettePicker.syncPaletteSelect(palette, board.city);
      paletteRevision = revision;
    }
    palette.value = board.city;
    syncGroupList(project.mode, board.arrangement);
    syncSelection();
    undoButton.disabled = !history[project.mode].undo.length;
    redoButton.disabled = !history[project.mode].redo.length;
  }

  async function exportSign(format) {
    const project = App.state;
    exportImage.disabled = exportVector.disabled = true;
    notice('正在导出…');
    try {
      await App.ready;
      const layout = drawing.layout(project, App.measure);
      const fonts = await global.SignExporters.ensureUsedFontData(layout.usedFonts);
      const source = drawing.exportVector(layout, fonts);
      const file = format === 'svg'
        ? new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
        : await global.SignExporters.rasterizePNG(source, layout);
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
    const target = selected.kind === 'line' ? lineName : selected.kind === 'arrow'
      ? directionPicker.querySelector('[aria-pressed="true"]') : labelLines.firstElementChild;
    target.focus();
  });
  element('transfer-tool-pattern').addEventListener('click', () => {
    const line = selectedLine();
    if (line) changePattern({ enabled: !line.linePattern.enabled });
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
  undoButton.addEventListener('click', () => restore('undo', 'redo'));
  redoButton.addEventListener('click', () => restore('redo', 'undo'));
  exportImage.addEventListener('click', () => exportSign('png'));
  exportVector.addEventListener('click', () => exportSign('svg'));
  global.addEventListener('sign-palettes-change', () => {
    if (global.SignCore.isPalette(state.board(App.state).city)) render();
    else changeSettings({ city: 'chongqing' });
  });
  new ResizeObserver(positionToolbar).observe(previewScroll);

  render();
  App.ready = Promise.all([
    document.fonts.load('400 20px MiSans', '换乘 号线 Transfer Line'),
    document.fonts.load('400 20px Frutiger', '0123456789/'),
  ]).then(() => {
    App.measure = global.SignCore.createCanvasMeasurer();
    render();
  }).catch(() => notice('字体加载失败，预览使用备用字体'));
})(window);
