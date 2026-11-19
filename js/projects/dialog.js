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
          <label class="project-search"><span data-control-icon="project-search" aria-hidden="true"></span><input type="search" id="${prefix}search" aria-label="搜索项目" placeholder="搜索项目" autofocus></label>
          <select id="${prefix}sort" aria-label="项目排序"><option value="newest">最近编辑在前</option><option value="oldest">最早编辑在前</option></select>
          <div class="project-view-buttons" role="group" aria-label="项目视图">
            <button type="button" data-project-view="cards" data-control-icon="project-grid" aria-label="卡片视图" title="卡片视图" aria-pressed="true"></button>
            <button type="button" data-project-view="list" data-control-icon="project-list" aria-label="列表视图" title="列表视图" aria-pressed="false"></button>
          </div>
          <button type="button" class="btn" id="${prefix}import" data-control-icon="upload" title="导入 JSON 为新项目" aria-label="导入 JSON 为新项目"></button>
          <button type="button" class="btn btn-primary" id="${prefix}new" data-control-icon="project-add" disabled>新建项目</button>
        </div>
        <p id="${prefix}error" class="project-error" role="alert"></p>
        <div id="${prefix}list" class="project-list" data-view="cards"></div><p id="${prefix}empty" hidden>没有找到项目。</p>
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
        <label class="project-name-field">项目名称<input type="text" id="${prefix}name" maxlength="80" required autofocus></label>
        <p id="${prefix}name-error" class="project-error" role="alert"></p>
        <div class="project-confirm-actions"><button type="submit" class="btn btn-primary">保存</button></div>
      </form></dialog>
      <dialog id="${prefix}delete-dialog" class="project-dialog project-dialog-small" aria-labelledby="${prefix}delete-title">
        <h2 id="${prefix}delete-title">删除项目</h2><p id="${prefix}delete-message"></p>
        <div class="project-confirm-actions"><button id="${prefix}delete-cancel" type="button" class="btn" autofocus>取消</button><button type="button" class="btn" id="${prefix}delete-confirm" data-control-icon="delete">确定删除</button></div>
      </dialog>`);
  }

  function init(app, { library, editor, fileInput, notice, exportProject, showProject, formatDetails }) {
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
    let manager, channel, store, temporaryChanges = false, nameAction, deleteTarget, refreshNumber = 0, starting;

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
      showProject(value.name);
      if (dialog.open) refresh().catch(report);
    }
    function report(error) { control('error').textContent = error.message; notice(error.message); }
    async function run(action) {
      try { await action(); }
      catch (error) { report(error); return false; }
      refresh().catch(report);
      return true;
    }
    function button(text, action, label, icon) {
      const element = document.createElement('button');
      element.type = 'button'; element.className = 'btn'; element.textContent = text;
      if (label) element.setAttribute('aria-label', label);
      if (icon) element.dataset.controlIcon = icon;
      element.addEventListener('click', () => { if (!manager?.busy) action(); });
      return element;
    }
    function download(value) {
      const saveFile = app.download || global.SignStorage.download;
      saveFile(new Blob([value.data], { type: 'application/json' }), (value.name || '标识项目').replace(/[<>:"/\\|?*]/g, '_') + '.json');
    }
    function askName(title, value, action) {
      control('name-title').textContent = title;
      control('name').value = value; control('name-error').textContent = ''; nameAction = action;
      nameDialog.showModal(); control('name').select();
    }
    function setView(view) {
      list.dataset.view = view;
      for (const button of dialog.querySelectorAll('[data-project-view]')) {
        button.setAttribute('aria-pressed', String(button.dataset.projectView === view));
      }
    }
    async function refresh() {
      const number = ++refreshNumber;
      if (!manager) { list.replaceChildren(); return; }
      const records = await manager.list();
      if (number !== refreshNumber) return;
      const search = control('search').value.trim().toLocaleLowerCase();
      const order = control('sort').value === 'oldest' ? 1 : -1;
      list.replaceChildren();
      const shown = records.filter(value => (value.name + ' ' + value.lineName).toLocaleLowerCase().includes(search)).sort((a, b) => order * (a.updatedAt - b.updatedAt) || a.id.localeCompare(b.id));
      for (const value of shown) {
        const card = document.createElement('article');
        card.className = 'project-card';
        card.dataset.projectId = value.id;
        const active = value.id === manager.current?.id;
        if (active) card.setAttribute('aria-current', 'true');
        let valid = true;
        try { library.readState(value); } catch { valid = false; }
        const name = value.name || '未命名项目';
        const open = button(name, () => run(async () => { await manager.open(value.id); dialog.close(); }), '打开 ' + name, 'property-project');
        open.className = 'project-card-open';
        open.disabled = active || !valid;
        open.title = name;
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
        time.textContent = valid ? '最近修改 · ' + (Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN')) : '工程内容损坏，可下载原始备份';
        const actions = document.createElement('details');
        actions.className = 'project-card-menu';
        actions.name = prefix + 'actions';
        const summary = document.createElement('summary');
        summary.dataset.controlIcon = 'project-more';
        summary.setAttribute('aria-label', name + '的项目操作');
        summary.title = '项目操作';
        const choices = document.createElement('div');
        if (valid) {
          choices.append(button('重命名', () => askName('重命名项目', name, title => manager.rename(value.id, title)), '重命名 ' + name, 'property-edit'));
          choices.append(button('复制', () => askName('复制项目', name.slice(0, 77) + ' 副本', title => manager.duplicate(value.id, title)), '复制 ' + name, 'copy'));
        }
        choices.append(button('JSON 备份', () => run(async () => { if (active) exportProject(); else download(await manager.read(value.id)); }), '备份 ' + name, 'project-download'));
        choices.append(button('删除', () => {
          deleteTarget = value;
          control('delete-message').textContent = '确定删除「' + name + '」？删除后无法恢复，建议先下载 JSON 备份。';
          deleteDialog.showModal();
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
        card.append(heading, details, time, actions);
        list.append(card);
      }
      control('empty').hidden = shown.length > 0;
      control('new').disabled = !manager;
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
            applyState: state => app.update(() => state, null, { activateProject: true }),
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
    control('copy-conflict').addEventListener('click', () => askName('把本页修改另存副本', manager.current.name.slice(0, 77) + ' 副本', name => manager.duplicate(manager.current.id, name)));
    control('open').addEventListener('click', async () => { dialog.showModal(); await starting; refresh().catch(report); });
    control('close').addEventListener('click', () => dialog.close());
    control('new').addEventListener('click', () => askName('新建项目', '未命名项目', name => manager.create(name)));
    control('import').addEventListener('click', () => fileInput.click());
    for (const button of dialog.querySelectorAll('[data-project-view]')) {
      button.addEventListener('click', () => setView(button.dataset.projectView));
    }
    control('name-cancel').addEventListener('click', () => nameDialog.close());
    control('delete-cancel').addEventListener('click', () => deleteDialog.close());
    dialog.addEventListener('close', () => {
      control('tools').open = false;
      list.querySelectorAll('details[open]').forEach(menu => { menu.open = false; });
    });
    control('search').addEventListener('input', () => refresh().catch(report));
    control('sort').addEventListener('change', () => refresh().catch(report));
    nameDialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); if (manager?.busy) return;
      try { await nameAction(control('name').value); nameDialog.close(); await refresh(); }
      catch (error) { control('name-error').textContent = error.message; }
    });
    control('delete-confirm').addEventListener('click', async () => {
      if (manager?.busy) return;
      if (await run(() => manager.remove(deleteTarget.id))) { deleteDialog.close(); control('search').focus(); }
    });
    for (const element of [dialog, nameDialog, deleteDialog]) {
      element.addEventListener('cancel', event => {
        if (manager?.busy) { event.preventDefault(); return; }
        const menu = element === dialog && document.activeElement?.closest('.project-card-menu[open]');
        if (menu) {
          event.preventDefault();
          menu.open = false;
          menu.querySelector('summary').focus();
        }
      });
      element.addEventListener('close', () => { if (element !== dialog && dialog.open) control('search').focus(); else control('open').focus(); });
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
