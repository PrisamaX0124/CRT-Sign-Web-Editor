(function (global) {
  'use strict';

  function open(factory, name, conflictError, createDefaultRecord) {
    return new Promise((resolve, reject) => {
      if (!factory) { reject(new Error('浏览器未开放本地项目存储，请导出 JSON 备份。')); return; }
      const request = factory.open(name, 1);
      let settled = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('projects', { keyPath: 'id' });
        database.createObjectStore('settings', { keyPath: 'key' });
      };
      request.onerror = () => { settled = true; reject(request.error); };
      request.onblocked = () => { settled = true; reject(new Error('其他窗口正在使用旧版项目存储，请关闭后重试。')); };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        database.onversionchange = () => database.close();

        function transaction(write, action) {
          return new Promise((finish, fail) => {
            const operation = database.transaction(['projects', 'settings'], write ? 'readwrite' : 'readonly');
            const projects = operation.objectStore('projects'), settings = operation.objectStore('settings');
            let result, reason;
            const abort = error => { reason = error; try { operation.abort(); } catch { /* 已中断的事务仍由 onabort 返回失败。 */ } };
            operation.oncomplete = () => finish(result);
            operation.onabort = () => fail(reason || operation.error || new Error('项目写入中断，请重试并导出备份。'));
            operation.onerror = () => {};
            try { action(projects, settings, value => { result = value; }, abort); }
            catch (error) { abort(error); }
          });
        }

        function check(projects, id, revision, next, abort) {
          projects.get(id).onsuccess = event => {
            const previous = event.target.result;
            if ((previous?.revision ?? null) !== revision) { abort(conflictError()); return; }
            try { next(previous); } catch (error) { abort(error); }
          };
        }
        function listen(request, next, abort) {
          request.onsuccess = event => { try { next(event.target.result); } catch (error) { abort(error); } };
        }

        resolve({
          close: () => database.close(),
          initialize(legacy) {
            return transaction(true, (projects, settings, result, abort) => {
              listen(settings.get('legacy-v1'), migrated => {
                if (legacy && !migrated) {
                  projects.add(legacy);
                  settings.put({ key: 'legacy-v1', value: legacy.id });
                }
                listen(projects.getAll(), list => {
                  if (!list.length) { const initial = createDefaultRecord(); projects.add(initial); list.push(initial); }
                  listen(settings.get('current'), selected => {
                    const current = list.find(item => item.id === selected?.value) || list.sort((a, b) => b.updatedAt - a.updatedAt)[0];
                    settings.put({ key: 'current', value: current.id });
                    result(current);
                  }, abort);
                }, abort);
              }, abort);
            });
          },
          hasMigration() { return transaction(false, (projects, settings, result) => { settings.get('legacy-v1').onsuccess = event => result(Boolean(event.target.result)); }); },
          list() { return transaction(false, (projects, settings, result) => { projects.getAll().onsuccess = event => result(event.target.result); }); },
          read(id) { return transaction(false, (projects, settings, result) => { projects.get(id).onsuccess = event => result(event.target.result); }); },
          write(value, revision, select = false) {
            return transaction(true, (projects, settings, result, abort) => {
              check(projects, value.id, revision, () => {
                projects.put(value);
                if (select) settings.put({ key: 'current', value: value.id });
                result(value);
              }, abort);
            });
          },
          select(id, revision) {
            return transaction(true, (projects, settings, result, abort) => {
              check(projects, id, revision, () => settings.put({ key: 'current', value: id }), abort);
            });
          },
          remove(id, revision, replacement, createReplacement = false) {
            return transaction(true, (projects, settings, result, abort) => {
              check(projects, id, revision, () => {
                projects.delete(id);
                if (replacement) {
                  if (createReplacement) { projects.add(replacement); settings.put({ key: 'current', value: replacement.id }); }
                  else check(projects, replacement.id, replacement.revision, () => settings.put({ key: 'current', value: replacement.id }), abort);
                }
              }, abort);
            });
          },
        });
      };
    });
  }

  global.SignProjectStore = { open };
})(typeof window !== 'undefined' ? window : globalThis);
