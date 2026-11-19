(function (global) {
  'use strict';

  function init(app, { notice, exportProject }) {
    const Projects = global.PlatformProjects;
    const control = name => document.getElementById('platform-project-' + name);
    const dialog = control('dialog'), list = control('list'), nameDialog = control('name-dialog'), deleteDialog = control('delete-dialog');
    const indicator = document.getElementById('platform-save'), backup = indicator.querySelector('button');
    const workspace = document.querySelector('.platform-workspace');
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
      document.querySelector('.mode-tabs').inert = value;
      for (const element of [dialog, nameDialog, deleteDialog]) element.setAttribute('aria-busy', String(value));
    }
    function updateCurrent(value) {
      control('current').textContent = control('current').title = value.name;
      if (dialog.open) refresh().catch(report);
    }
    function report(error) { control('error').textContent = error.message; notice(error.message); }
    async function run(action) {
      try { await action(); await refresh(); return true; }
      catch (error) { report(error); return false; }
    }
    function button(text, action, label) {
      const element = document.createElement('button');
      element.type = 'button'; element.className = 'btn'; element.textContent = text;
      if (label) element.setAttribute('aria-label', label);
      element.addEventListener('click', action);
      return element;
    }
    function download(value) {
      app.download(new Blob([value.data], { type: 'application/json' }), (value.name || '站台项目').replace(/[<>:"/\\|?*]/g, '_') + '.json');
    }
    function askName(title, value, action) {
      control('name-title').textContent = title;
      control('name').value = value; control('name-error').textContent = ''; nameAction = action;
      nameDialog.showModal(); control('name').select();
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
        const card = document.createElement('article'); card.className = 'platform-project-card'; card.dataset.projectId = value.id;
        const active = value.id === manager.current?.id;
        if (active) card.setAttribute('aria-current', 'true');
        let valid = true;
        try { Projects.readState(value); } catch { valid = false; }
        const heading = document.createElement('h3'); heading.textContent = value.name || '未命名项目';
        const line = document.createElement('p'); line.className = 'platform-project-line';
        const color = document.createElement('span'); color.className = 'platform-project-color';
        color.style.backgroundColor = global.SignCore.normalizeHex(value.color) || '#888888';
        line.append(color, (value.lineName || '未命名线路') + ' · ' + (value.stationCount || 0) + ' 站');
        const time = document.createElement('p'); time.className = 'field-help';
        const date = new Date(value.updatedAt);
        time.textContent = valid ? '最近修改：' + (Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN')) : '项目内容损坏，请先下载原始 JSON 备份';
        const actions = document.createElement('div'); actions.className = 'platform-project-actions';
        const open = button(active ? '当前项目' : '打开项目', () => run(async () => { await manager.open(value.id); dialog.close(); }), '打开 ' + value.name);
        open.disabled = active || !valid; open.classList.toggle('btn-primary', active); actions.append(open);
        if (valid) {
          actions.append(button('重命名', () => askName('重命名项目', value.name, name => manager.rename(value.id, name)), '重命名 ' + value.name));
          actions.append(button('复制', () => askName('复制项目', value.name.slice(0, 77) + ' 副本', name => manager.duplicate(value.id, name)), '复制 ' + value.name));
        }
        actions.append(button('JSON 备份', () => run(async () => { if (active) exportProject(); else download(await manager.read(value.id)); }), '备份 ' + value.name));
        actions.append(button('删除', () => {
          deleteTarget = value; control('delete-message').textContent = '确定删除「' + value.name + '」？删除后无法恢复，建议先下载 JSON 备份。'; deleteDialog.showModal();
        }, '删除 ' + value.name));
        card.append(heading, line, time, actions); list.append(card);
      }
      control('empty').hidden = shown.length > 0;
      control('new').disabled = !manager;
    }
    async function start() {
      setBusy(true);
      try {
        store ||= await Projects.openStore();
        let source, legacyUnavailable = false;
        // 旧存储被禁用时不写迁移标记，恢复权限后还要继续迁移。
        try { if (!(await store.hasMigration())) source = global.localStorage.getItem(Projects.legacyKey); }
        catch { legacyUnavailable = true; }
        if (!manager) {
          manager = Projects.createManager({ store, getState: () => app.state,
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
            channel = new BroadcastChannel('public-platform-projects');
            channel.onmessage = () => { manager.check().catch(() => {}); if (dialog.open) refresh().catch(report); };
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
      try { const data = global.localStorage.getItem(Projects.legacyKey); if (data) download({ name: '原有站台自动存档', data }); else notice('没有旧版自动存档'); }
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
    control('import').addEventListener('click', () => document.getElementById('project-file').click());
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
      element.addEventListener('cancel', event => { if (manager?.busy) event.preventDefault(); });
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
  global.PlatformProjectDialog = { init };
})(window);
