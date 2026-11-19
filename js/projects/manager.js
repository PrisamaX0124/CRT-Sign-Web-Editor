(function (global) {
  'use strict';

  function createLibrary({ databaseName, legacyKey, legacyName, createDefault, serialize, deserialize, describe }) {
    function conflictError(projectId) {
      const error = new Error('项目已在其他窗口修改，请先导出备份，再重新打开，或另存副本。');
      error.name = 'ProjectConflictError';
      error.projectId = projectId;
      return error;
    }

    function projectName(name) {
      const value = String(name || '').trim().slice(0, 80);
      if (!value) throw new Error('请填写项目名称');
      return value;
    }

    function record(name, state) {
      const data = serialize(state);
      deserialize(data);
      return {
        id: global.SignCore.uuid(), name: projectName(name), createdAt: Date.now(), updatedAt: Date.now(),
        revision: 1, contentRevision: 1, data, ...describe(state),
      };
    }

    function readState(value) {
      if (!value || typeof value.id !== 'string' || typeof value.name !== 'string' || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || typeof value.data !== 'string') {
        throw new Error('项目资料损坏，请先下载原始 JSON 备份。');
      }
      try { return deserialize(value.data); }
      catch { throw new Error('项目内容损坏，请先下载原始 JSON 备份。'); }
    }

    function createManager({ store, getState, applyState, onStatus, onCurrent, onBusy = () => {}, publish = () => {}, delay = 500 }) {
      let current = null, savedContent, dirty = false, conflict = false, timer, queue = Promise.resolve(), busy = false, activation = 0;
      function status(state, message) { onStatus(state, message); }
      function failed(error) {
        if (error.name === 'ProjectConflictError' && (!error.projectId || error.projectId === current?.id)) conflict = true;
        const reason = error.name === 'QuotaExceededError' ? '浏览器存储空间不足' : error.name === 'SecurityError' ? '浏览器不允许保存本地项目' : error.message || '浏览器存储不可用';
        status(conflict ? 'conflict' : 'failed', conflict ? error.message : '保存失败：' + reason + '。请导出 JSON 备份。');
      }
      function enqueue(action, transition = false) {
        const task = queue.catch(() => {}).then(async () => {
          if (transition) { busy = true; onBusy(true); }
          try { return await action(); }
          catch (error) { failed(error); throw error; }
          finally { if (transition) { busy = false; onBusy(false); } }
        });
        queue = task;
        return task;
      }
      function activate(value, state) {
        const changedProject = value.id !== current?.id;
        current = value; savedContent = serialize(state); dirty = conflict = false;
        activation++;
        applyState(state, changedProject); onCurrent(current); status('saved', '已保存');
      }
      async function read(id) {
        const value = await store.read(id);
        if (!value) throw new Error('项目已被删除，请选择其他项目');
        return { value, state: readState(value) };
      }
      async function save() {
        clearTimeout(timer);
        if (conflict) throw conflictError();
        if (current) {
          const stored = await store.read(current.id);
          if (!stored || stored.revision !== current.revision) throw conflictError();
        }
        while (dirty) {
          if (!current) throw new Error('本地项目尚未打开，请先导出当前内容');
          const data = serialize(getState());
          if (data === savedContent) { dirty = false; break; }
          const state = deserialize(data);
          const revision = current.revision + 1;
          const next = { ...current, data, ...describe(state), updatedAt: Math.max(Date.now(), current.updatedAt + 1), revision, contentRevision: revision };
          status('saving', '保存中');
          current = await store.write(next, current.revision);
          savedContent = data;
          dirty = serialize(getState()) !== data;
          onCurrent(current); publish(current);
        }
        status('saved', '已保存');
      }
      async function create(name, state) {
        const value = record(name, state);
        await store.write(value, null, true);
        activate(value, deserialize(value.data)); publish(value);
      }
      return {
        get current() { return current; }, get busy() { return busy; }, get pending() { return dirty || conflict; },
        get activation() { return activation; },
        initialize(source) {
          return enqueue(async () => {
            let legacy = null, damagedLegacy = false;
            if (source && !(await store.hasMigration?.())) {
              try { legacy = record(legacyName, deserialize(source)); }
              catch {
                if (!(await store.list()).length) throw new Error('旧版自动存档损坏，请先从「我的项目」下载旧版自动存档备份。');
                damagedLegacy = true;
              }
            }
            // 原文留在旧存档中，迁移标记与工程必须一起写入，断电后才能安全重试。
            if (legacy) legacy.data = source;
            const value = await store.initialize(legacy);
            activate(value, readState(value));
            if (damagedLegacy) status('failed', '旧版自动存档损坏，已保留原文，请从「我的项目」下载旧版自动存档备份。');
          }, true);
        },
        schedule() {
          dirty = true; clearTimeout(timer);
          if (conflict) return;
          status('saving', '保存中');
          timer = setTimeout(() => { enqueue(save).catch(() => {}); }, delay);
        },
        flush() { return enqueue(save); },
        open(id) {
          return enqueue(async () => {
            await save();
            if (id === current?.id) return;
            const { value, state } = await read(id);
            await store.select(id, value.revision);
            activate(value, state);
          }, true);
        },
        create(name, state = createDefault()) { return enqueue(async () => { await save(); await create(name, state); }, true); },
        duplicate(id, name) {
          return enqueue(async () => {
            if (id === current?.id && conflict) { await create(name, getState()); return; }
            await save();
            const { state } = await read(id);
            await create(name, state);
          }, true);
        },
        rename(id, name) {
          return enqueue(async () => {
            await save();
            const { value } = await read(id);
            const title = projectName(name);
            if (title === value.name) return;
            const next = { ...value, name: title, updatedAt: Math.max(Date.now(), value.updatedAt + 1), revision: value.revision + 1, contentRevision: value.contentRevision ?? value.revision };
            await store.write(next, value.revision);
            if (id === current?.id) { current = next; onCurrent(current); }
            publish(next);
          }, true);
        },
        remove(id) {
          return enqueue(async () => {
            await save();
            const value = await store.read(id);
            if (!value) throw new Error('项目已被删除');
            let replacement, createReplacement = false;
            if (id === current?.id) {
              const list = (await store.list()).filter(item => item.id !== id).sort((a, b) => b.updatedAt - a.updatedAt);
              for (const item of list) {
                const candidate = await store.read(item.id);
                try { replacement = { value: candidate, state: readState(candidate) }; break; }
                catch { /* 损坏项目保留原文供备份，不能自动覆盖。 */ }
              }
              if (!replacement) {
                const initial = record('未命名项目', createDefault());
                createReplacement = true;
                replacement = { value: initial, state: deserialize(initial.data) };
              }
            }
            await store.remove(id, value.revision, replacement?.value, createReplacement);
            if (replacement) activate(replacement.value, replacement.state);
            publish({ id, revision: null });
          }, true);
        },
        check() {
          return enqueue(async () => {
            if (!current || conflict) return;
            const value = await store.read(current.id);
            if (!value || value.revision !== current.revision) throw conflictError();
          });
        },
        reload() {
          return enqueue(async () => {
            const { value, state } = await read(current.id);
            await store.select(value.id, value.revision);
            activate(value, state);
          }, true);
        },
        list: () => store.list(),
        read: id => store.read(id),
      };
    }

    return { createManager, record, readState, projectName, conflictError, databaseName, legacyKey,
      openStore: (factory = global.indexedDB, name = databaseName) => global.SignProjectStore.open(factory, name, conflictError, () => record('未命名项目', createDefault())),
    };
  }

  global.SignProjects = { createLibrary };
})(typeof window !== 'undefined' ? window : globalThis);
