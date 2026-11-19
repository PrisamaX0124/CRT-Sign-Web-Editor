(function (global) {
  'use strict';

  function addDialogs(prefix) {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="${prefix}dialog" class="project-dialog" aria-labelledby="${prefix}title">
        <header class="project-dialog-heading">
          <div><h2 id="${prefix}title">我的项目</h2><p class="project-dialog-intro">项目保存在当前浏览器。长久保存或换设备时，可下载 JSON 备份。</p></div>
          <button type="button" id="${prefix}close" class="dialog-close" data-control-icon="close" aria-label="关闭我的项目"></button>
        </header>
        <div class="project-dialog-controls">
          <div class="project-search"><span data-control-icon="project-search" aria-hidden="true"></span><input type="search" id="${prefix}search" aria-label="搜索项目" placeholder="搜索项目" autofocus><button type="button" id="${prefix}clear-search" data-control-icon="close" aria-label="清空搜索" title="清空搜索" hidden></button></div>
          <select id="${prefix}sort" aria-label="项目排序"><option value="newest">最近编辑在前</option><option value="oldest">最早编辑在前</option></select>
          <div class="project-view-buttons" role="group" aria-label="项目视图">
            <button type="button" data-project-view="cards" data-control-icon="project-grid" aria-label="卡片视图" title="卡片视图" aria-pressed="true"></button>
            <button type="button" data-project-view="list" data-control-icon="project-list" aria-label="列表视图" title="列表视图" aria-pressed="false"></button>
          </div>
          <button type="button" class="btn" id="${prefix}import" data-control-icon="upload" title="导入 JSON 为新项目" aria-label="导入 JSON 为新项目"></button>
          <button type="button" class="btn btn-primary" id="${prefix}new" data-control-icon="project-add" disabled>新建项目</button>
        </div>
        <p id="${prefix}error" class="project-error" role="alert"></p>
        <div id="${prefix}list" class="project-list" data-view="cards"></div><p id="${prefix}empty" class="project-empty" role="status" hidden></p>
        <details id="${prefix}tools" class="project-tools">
          <summary>备份与恢复</summary>
          <div>
            <button type="button" class="btn" id="${prefix}backup" data-control-icon="project-download">备份当前工程 JSON</button>
            <button type="button" class="btn" id="${prefix}legacy-backup" data-control-icon="history">备份旧版自动存档</button>
            <button type="button" class="btn" id="${prefix}retry-dialog" data-control-icon="turn-clockwise">重试保存或读取</button>
          </div>
        </details>
      </dialog>
      <dialog id="${prefix}name-dialog" class="project-dialog project-dialog-small" aria-labelledby="${prefix}name-title"><form>
        <header class="project-dialog-heading"><h2 id="${prefix}name-title">项目名称</h2><button id="${prefix}name-cancel" type="button" class="dialog-close" data-control-icon="close" aria-label="取消填写名称"></button></header>
        <label class="project-name-field">项目名称<input type="text" id="${prefix}name" maxlength="80" aria-describedby="${prefix}name-error" required autofocus></label>
        <p id="${prefix}name-error" class="project-error" role="alert"></p>
        <div class="project-confirm-actions"><button type="submit" class="btn btn-primary">保存</button></div>
      </form></dialog>
      <dialog id="${prefix}delete-dialog" class="project-dialog project-dialog-small" aria-labelledby="${prefix}delete-title">
        <h2 id="${prefix}delete-title">删除项目</h2><p id="${prefix}delete-message"></p>
        <p id="${prefix}delete-error" class="project-error" role="alert"></p>
        <div class="project-confirm-actions"><button id="${prefix}delete-cancel" type="button" class="btn" autofocus>取消</button><button type="button" class="btn" id="${prefix}delete-confirm" data-control-icon="delete">确定删除</button></div>
      </dialog>`);
  }

  function init(app, { library, editor, graphic, fileInput, notice, exportProject, deserialize, limitSize, formatDetails, drawThumbnail }) {
    const prefix = editor + '-project-';
    const control = name => document.getElementById(prefix + name);
    const indicator = document.getElementById(editor + '-save');
    const backup = indicator.querySelector('button');
    const workspace = indicator.closest('.editor-workspace');
    const modeTabs = document.querySelector('.mode-tabs:not([hidden])');
    addDialogs(prefix);
    indicator.insertAdjacentHTML('beforeend', `
      <button type="button" id="${prefix}retry" hidden>重试保存</button>
      <button type="button" id="${prefix}reload" hidden>重新打开</button>
      <button type="button" id="${prefix}copy-conflict" hidden>另存副本</button>`);
    const dialog = control('dialog'), list = control('list'), nameDialog = control('name-dialog'), deleteDialog = control('delete-dialog');
    const titleButton = control('current'), searchInput = control('search');
    const viewKey = prefix + 'view';
    const cards = new Map();
    const motions = new WeakMap();
    let manager, channel, store, temporaryChanges = false, nameAction, deleteTarget, refreshNumber = 0, starting;
    let records = [], dialogSession = 0, enteredFromDialog = false, importNumber = 0;
    let displayedProject, highlightedProject, submittingName = false, deletingProject = false;
    const thumbnails = global.SignProjectThumbnails.create({ dialog, getStore: () => store, readState: library.readState, draw: drawThumbnail });

    function showDialog(element) {
      element.inert = false;
      element.showModal();
    }
    function closeDialog(element) {
      element.close();
      // 结束动画期间弹窗仍可见，所以关闭时也要立即退出键盘和辅助技术的操作范围。
      element.inert = true;
    }

    function playMotion(element, frames, duration) {
      motions.get(element)?.cancel();
      motions.set(element, global.EditorMotion.play(element, frames, duration));
    }

    function controlsBusy() { return manager?.busy || submittingName || deletingProject; }

    function showStatus(state, message) {
      indicator.dataset.saveState = state;
      indicator.querySelector('[role="status"]').textContent = message;
      const failed = state === 'failed' || state === 'conflict';
      backup.hidden = control('retry').hidden = !failed;
      control('reload').hidden = control('copy-conflict').hidden = state !== 'conflict';
      control('error').textContent = failed ? message : '';
    }
    function setBusy(value) {
      workspace.inert = value;
      if (modeTabs) modeTabs.inert = value;
      for (const element of [dialog, nameDialog, deleteDialog]) element.setAttribute('aria-busy', String(value));
    }
    function updateCurrent(value) {
      if (titleButton.disabled || titleButton.textContent !== value.name) {
        const renamed = displayedProject === value.id;
        titleButton.disabled = false;
        titleButton.textContent = value.name;
        titleButton.title = value.name + '（点击重命名）';
        titleButton.setAttribute('aria-label', '重命名项目「' + value.name + '」');
        if (renamed) playMotion(titleButton, [{ opacity: .65 }, { opacity: 1 }], 'control');
        else motions.get(titleButton)?.cancel();
      }
      displayedProject = value.id;
      if (dialog.open) refresh().catch(report);
    }
    function errorMessage(error) {
      if (error.name === 'QuotaExceededError') return '浏览器存储空间不足，请清理空间后重试。';
      if (error.name === 'SecurityError') return '浏览器禁止访问本地项目，请检查存储权限后重试。';
      return error.message || '无法访问本地项目，请重试。';
    }
    function report(error) {
      const message = errorMessage(error);
      control('error').textContent = message;
      notice(message, 'error');
    }
    async function run(action) {
      try { await action(); }
      catch (error) { report(error); }
    }
    function button(text, action, label, icon) {
      const element = document.createElement('button');
      element.type = 'button'; element.className = 'btn'; element.textContent = text;
      if (label) element.setAttribute('aria-label', label);
      if (icon) element.dataset.controlIcon = icon;
      element.addEventListener('click', () => { if (!controlsBusy()) action(); });
      return element;
    }
    function download(value) {
      const saveFile = app.download || global.SignStorage.download;
      saveFile(new Blob([value.data], { type: 'application/json' }), (value.name || '标识项目').replace(/[<>:"/\\|?*]/g, '_') + '.json');
    }
    function askName(title, value, action, { trigger, projectId, success, entersProject } = {}) {
      if (controlsBusy()) return;
      control('name-title').textContent = title;
      control('name').value = value;
      control('name-error').textContent = '';
      nameAction = { action, trigger, projectId, success, entersProject };
      showDialog(nameDialog);
      control('name').select();
    }
    function setView(view) {
      list.dataset.view = view;
      for (const button of dialog.querySelectorAll('[data-project-view]')) {
        button.setAttribute('aria-pressed', String(button.dataset.projectView === view));
      }
      if (dialog.open) {
        renderList();
        playMotion(list, [{ opacity: .72, translate: '0 3px' }, { opacity: 1, translate: 'none' }], 'control');
      }
    }
    try { if (global.localStorage.getItem(viewKey) === 'list') setView('list'); }
    catch { /* 不能写入浏览器偏好时，本页仍能记住视图。 */ }

    function focusInList(projectId, fallback = searchInput) {
      const target = cards.get(projectId)?.card;
      (target?.isConnected ? target.querySelector('summary') : fallback).focus({ preventScroll: true });
    }
    function closeName() {
      closeDialog(nameDialog);
      if (dialog.open) focusInList(nameAction.projectId, nameAction.trigger || searchInput);
      else (nameAction.trigger?.matches(':enabled') ? nameAction.trigger : titleButton).focus({ preventScroll: true });
    }
    function enterProject(message) {
      if (dialog.open) {
        enteredFromDialog = true;
        closeDialog(dialog);
      }
      titleButton.focus({ preventScroll: true });
      if (message) {
        highlightedProject = manager.current.id;
        notice(message, 'success');
      }
    }

    async function refresh(animateList = false) {
      const number = ++refreshNumber;
      const saved = manager ? await manager.list() : [];
      if (number !== refreshNumber) return;
      records = saved;
      if (!dialog.open) return;
      renderList();
      if (animateList && list.firstElementChild) playMotion(list, [{ opacity: .58 }, { opacity: 1 }], 'reveal');
    }
    function renderList() {
      const search = searchInput.value.trim().toLocaleLowerCase();
      const order = control('sort').value === 'oldest' ? 1 : -1;
      const shown = records.filter(value => (value.name + ' ' + (value.lineName || '')).toLocaleLowerCase().includes(search))
        .sort((first, second) => order * (first.updatedAt - second.updatedAt) || first.id.localeCompare(second.id));
      const shownIds = new Set(shown.map(value => value.id));
      const retained = new Set(records.map(value => value.id));
      const previews = new Map();
      const focused = document.activeElement?.closest('.project-card');
      for (const [id, entry] of cards) {
        if (!shownIds.has(id)) entry.card.remove();
        if (!retained.has(id)) cards.delete(id);
      }
      let position = list.firstElementChild;
      for (const value of shown) {
        const active = value.id === manager?.current?.id;
        const previous = cards.get(value.id);
        const contentRevision = value.contentRevision ?? value.revision;
        let card = previous?.card;
        if (!previous || previous.revision !== value.revision || previous.active !== active) {
          const preview = previous && previous.contentRevision === contentRevision ? previous.card.firstElementChild : undefined;
          card = createCard(value, active, preview);
          if (position === previous?.card) position = previous.card.nextElementSibling;
          previous?.card.remove();
          cards.set(value.id, { card, revision: value.revision, contentRevision, active, name: value.name });
        }
        if (card === position) position = position.nextElementSibling;
        else list.insertBefore(card, position);
        if (dialog.open && list.dataset.view === 'cards') previews.set(card.firstElementChild, value);
        if (dialog.open && previous && previous.name !== value.name) {
          playMotion(card.querySelector('.project-card-open'), [{ opacity: .65 }, { opacity: 1 }], 'control');
        }
        if (dialog.open && highlightedProject === value.id) {
          highlightedProject = undefined;
          playMotion(card, [{ boxShadow: 'inset 0 0 0 2px var(--accent)' }, { boxShadow: 'inset 0 0 0 2px transparent' }], 'reveal');
        }
      }
      thumbnails.synchronize(previews, retained);
      if (focused && !list.contains(document.activeElement)) focusInList(focused.dataset.projectId);
      control('clear-search').hidden = !searchInput.value;
      const empty = control('empty');
      empty.hidden = shown.length > 0;
      empty.textContent = search ? '没有找到匹配的项目。' : '还没有项目。可以新建项目或导入文件。';
      control('new').disabled = !manager;
    }
    function createCard(value, active, existingPreview) {
      const card = document.createElement('article');
      card.className = 'project-card';
      card.dataset.projectId = value.id;
      if (active) card.setAttribute('aria-current', 'true');
      const name = value.name || '未命名项目';
      const open = button(name, () => run(async () => { await manager.open(value.id); enterProject(); }), '打开 ' + name);
      open.className = 'project-card-open';
      open.disabled = active;
      open.title = name;
      const preview = existingPreview || document.createElement('div');
      if (!existingPreview) {
        preview.className = 'project-card-preview';
        preview.setAttribute('aria-hidden', 'true');
        const placeholder = document.createElement('span');
        placeholder.dataset.controlIcon = 'property-project';
        const cropped = document.createElement('span');
        cropped.className = 'project-card-crop-label';
        cropped.textContent = '上部局部';
        preview.append(placeholder, cropped);
      }
      preview.onclick = () => open.click();
      const details = document.createElement('p');
      details.className = 'project-card-details';
      if (value.color) {
        const color = document.createElement('span');
        color.className = 'project-card-color';
        color.style.backgroundColor = global.SignCore.normalizeHex(value.color) || '#888888';
        details.append(color);
      }
      details.append(formatDetails(value));
      const time = document.createElement('p');
      time.className = 'project-card-time';
      const date = new Date(value.updatedAt);
      time.textContent = '最近修改 · ' + (Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN'));
      const actions = document.createElement('details');
      actions.className = 'project-card-menu';
      actions.name = prefix + 'actions';
      const summary = document.createElement('summary');
      summary.dataset.controlIcon = 'project-more';
      summary.setAttribute('aria-label', name + '的项目操作');
      summary.title = '项目操作';
      const choices = document.createElement('div');
      choices.append(button('重命名', () => askName('重命名项目', name, title => manager.rename(value.id, title), {
        projectId: value.id, success: '项目已重命名',
      }), '重命名 ' + name, 'property-edit'));
      choices.append(button('复制', () => askName('复制项目', name.slice(0, 77) + ' 副本', title => manager.duplicate(value.id, title), {
        projectId: value.id, success: '副本已创建并打开', entersProject: true,
      }), '复制 ' + name, 'copy'));
      choices.append(button('JSON 备份', () => run(async () => { if (active) exportProject(); else download(await manager.read(value.id)); }), '备份 ' + name, 'project-download'));
      choices.append(button('删除', () => {
        deleteTarget = value;
        control('delete-message').textContent = '确定删除「' + name + '」？删除后无法恢复，建议先下载 JSON 备份。';
        control('delete-error').textContent = '';
        showDialog(deleteDialog);
      }, '删除 ' + name, 'delete'));
      actions.append(summary, choices);
      const heading = document.createElement('div');
      heading.className = 'project-card-heading';
      heading.append(open);
      if (active) {
        const current = document.createElement('span');
        current.className = 'project-current-label';
        current.textContent = '正在编辑';
        heading.append(current);
      }
      card.append(preview, heading, details, time, actions);
      return card;
    }
    async function start() {
      setBusy(true);
      try {
        store ||= await library.openStore();
        let source, legacyUnavailable = false;
        // 旧存储被禁用时不写迁移标记，恢复权限后还要继续迁移。
        try { if (!(await store.hasMigration())) source = global.localStorage.getItem(library.legacyKey); }
        catch { legacyUnavailable = true; }
        if (!manager) {
          manager = library.createManager({ store, getState: () => app.state,
            applyState: (state, changedProject) => {
              global.EditorMotion.stopGraphicTransition(graphic);
              app.update(() => state, null, { activateProject: true, changedProject });
              if (changedProject && manager.activation > 1) global.EditorMotion.revealGraphic(graphic);
            },
            onStatus: showStatus, onCurrent: updateCurrent, onBusy: setBusy,
            publish: value => channel?.postMessage({ id: value.id, revision: value.revision }),
          });
          app.projects = manager;
        }
        if (temporaryChanges) throw new Error('页面中有尚未保存的修改，请先导出 JSON，再刷新页面恢复存储。');
        await manager.initialize(source);
        if (legacyUnavailable) notice('未能读取旧版自动存档，原数据未改动。本地项目可以继续保存；恢复浏览器存储权限后请刷新页面。');
        if (!channel && global.BroadcastChannel) {
          try {
            channel = new BroadcastChannel(library.databaseName);
            channel.onmessage = event => {
              if (event.data?.id === manager.current?.id) manager.check().catch(() => {});
              if (dialog.open) refresh().catch(report);
            };
          } catch { /* 无法即时通知时，聚焦检查和写入前的版本检查仍能阻止覆盖。 */ }
        }
      } catch (error) { showStatus('failed', '本地项目未能打开：' + error.message + '。请导出 JSON 备份后重试。'); }
      finally { setBusy(false); control('new').disabled = !manager; }
    }
    function check() { manager?.check().catch(() => {}); }
    function flush() { return manager ? manager.flush() : Promise.reject(new Error('本地项目存储不可用，请导出 JSON 备份')); }
    backup.addEventListener('click', exportProject);
    control('backup').addEventListener('click', exportProject);
    control('legacy-backup').addEventListener('click', () => {
      try { const data = global.localStorage.getItem(library.legacyKey); if (data) download({ name: '原有自动存档', data }); else notice('没有旧版自动存档'); }
      catch (error) { report(error); }
    });
    control('retry').addEventListener('click', () => { if (manager?.current) flush().catch(report); else starting = start(); });
    control('retry-dialog').addEventListener('click', () => { if (manager?.current) run(flush); else starting = start().then(refresh); });
    control('reload').addEventListener('click', () => {
      if (global.confirm('重新打开会放弃本页尚未保存的修改。请先导出 JSON 备份。确定重新打开？')) run(() => manager.reload());
    });
    control('copy-conflict').addEventListener('click', () => askName('把本页修改另存副本', manager.current.name.slice(0, 77) + ' 副本', name => manager.duplicate(manager.current.id, name), {
      trigger: control('copy-conflict'), success: '副本已创建并打开', entersProject: true,
    }));
    titleButton.addEventListener('click', () => {
      const current = manager?.current;
      if (!current) return;
      askName('重命名项目', current.name, name => manager.rename(current.id, name), {
        trigger: titleButton, success: '项目已重命名',
      });
    });
    control('open').addEventListener('click', async () => {
      if (controlsBusy()) return;
      dialogSession++;
      enteredFromDialog = false;
      showDialog(dialog);
      await starting;
      refresh(true).catch(report);
    });
    control('close').addEventListener('click', () => { if (!controlsBusy()) closeDialog(dialog); });
    control('new').addEventListener('click', () => askName('新建项目', '未命名项目', name => manager.create(name), {
      trigger: control('new'), success: '项目已创建并打开', entersProject: true,
    }));
    control('import').addEventListener('click', () => { if (!controlsBusy()) fileInput.click(); });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      const selection = ++importNumber;
      const session = dialog.open ? dialogSession : null;
      const activation = manager?.activation;
      const stillCurrent = () => selection === importNumber
        && (session === null || (session === dialogSession && dialog.open))
        && (activation === undefined || activation === manager?.activation);
      try {
        const project = await global.SignStorage.readProjectFile(file, deserialize, limitSize);
        await starting;
        if (!stillCurrent()) return;
        if (!manager) throw new Error('本地项目存储不可用，请先导出备份并重试。');
        const otherDialog = document.querySelector('dialog[open]:not(#' + dialog.id + '), #modal-root .modal-mask');
        if (controlsBusy() || otherDialog) throw new Error('请在当前操作结束后重新导入。');
        await manager.create(file.name.replace(/\.json$/i, '').trim() || '导入项目', project);
        enterProject('项目已导入并打开');
      } catch (error) {
        if (stillCurrent()) report(new Error('导入失败。' + errorMessage(error)));
      }
    });
    for (const button of dialog.querySelectorAll('[data-project-view]')) {
      button.addEventListener('click', () => {
        const view = button.dataset.projectView;
        setView(view);
        try { global.localStorage.setItem(viewKey, view); }
        catch { /* 存储权限不影响本页切换视图。 */ }
      });
    }
    control('name-cancel').addEventListener('click', () => { if (!controlsBusy()) closeName(); });
    control('delete-cancel').addEventListener('click', () => {
      if (controlsBusy()) return;
      closeDialog(deleteDialog);
      focusInList(deleteTarget.id);
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      motions.get(list)?.cancel();
      thumbnails.stop();
      global.EditorMotion.afterMotion(dialog, () => { if (!dialog.open) thumbnails.synchronize(new Map()); });
      control('tools').open = false;
      list.querySelectorAll('details[open]').forEach(menu => { menu.open = false; });
      if (!enteredFromDialog) control('open').focus({ preventScroll: true });
    });
    searchInput.addEventListener('input', renderList);
    control('clear-search').addEventListener('click', () => {
      searchInput.value = '';
      searchInput.focus();
      renderList();
    });
    control('sort').addEventListener('change', renderList);
    nameDialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); if (controlsBusy()) return;
      const { action, entersProject, success } = nameAction;
      const name = control('name');
      submittingName = true;
      try {
        await action(library.projectName(name.value));
        if (entersProject) {
          closeDialog(nameDialog);
          enterProject(success);
        } else {
          if (dialog.open) await refresh().catch(report);
          closeName();
          notice(success, 'success');
        }
      } catch (error) { control('name-error').textContent = errorMessage(error); name.focus(); }
      finally { submittingName = false; }
    });
    control('delete-confirm').addEventListener('click', async () => {
      if (controlsBusy()) return;
      const card = cards.get(deleteTarget.id)?.card;
      const neighbor = (card?.nextElementSibling || card?.previousElementSibling)?.dataset.projectId;
      deletingProject = true;
      try {
        await manager.remove(deleteTarget.id);
        await refresh().catch(report);
        closeDialog(deleteDialog);
        focusInList(neighbor || manager.current?.id);
        playMotion(list, [{ opacity: .76 }, { opacity: 1 }], 'control');
      } catch (error) { control('delete-error').textContent = errorMessage(error); }
      finally { deletingProject = false; }
    });
    for (const element of [dialog, nameDialog, deleteDialog]) {
      element.inert = true;
      element.addEventListener('close', () => { if (!element.open) element.inert = true; });
      element.addEventListener('cancel', event => {
        event.preventDefault();
        if (controlsBusy()) return;
        if (element === nameDialog) { closeName(); return; }
        if (element === deleteDialog) { closeDialog(deleteDialog); focusInList(deleteTarget.id); return; }
        const menu = element === dialog && document.activeElement?.closest('.project-card-menu[open]');
        if (menu) {
          menu.open = false;
          menu.querySelector('summary').focus();
        } else closeDialog(dialog);
      });
    }
    global.addEventListener('focus', check);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush().catch(() => {}); else check(); });
    global.addEventListener('pagehide', () => { flush().catch(() => {}); });
    global.addEventListener('beforeunload', event => {
      if (temporaryChanges || manager?.pending) { flush().catch(() => {}); event.preventDefault(); event.returnValue = ''; }
    });
    starting = start();
    return { get ready() { return starting; }, schedule() {
      manager?.schedule();
      if (!manager?.current) { temporaryChanges = true; showStatus('failed', '修改尚未保存，请导出 JSON 备份。'); }
    } };
  }
  global.SignProjectDialog = { init };
})(window);
