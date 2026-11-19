(function (global) {
  'use strict';

  const maximumThumbnails = 64;
  const maximumThumbnailBytes = 96 * 1024;

  function metadata(value) {
    const { data, ...details } = value;
    return details;
  }

  function open(factory, name, conflictError, createDefaultRecord) {
    return new Promise((resolve, reject) => {
      if (!factory) { reject(new Error('浏览器未开放本地项目存储，请导出 JSON 备份。')); return; }
      const request = factory.open(name, 3);
      let settled = false;
      request.onupgradeneeded = event => {
        const database = request.result;
        if (event.oldVersion < 3) {
          const thumbnails = database.createObjectStore('project-thumbnails', { keyPath: 'id' });
          thumbnails.createIndex('generatedAt', 'generatedAt');
        }
        if (event.oldVersion >= 2) return;
        const details = database.createObjectStore('project-details', { keyPath: 'id' });
        if (!event.oldVersion) {
          database.createObjectStore('projects', { keyPath: 'id' });
          database.createObjectStore('settings', { keyPath: 'key' });
          return;
        }
        const projects = request.transaction.objectStore('projects');
        projects.openCursor().onsuccess = event => {
          const cursor = event.target.result;
          if (!cursor) return;
          details.put(metadata(cursor.value));
          cursor.continue();
        };
      };
      request.onerror = () => { settled = true; reject(request.error); };
      request.onblocked = () => { settled = true; reject(new Error('其他窗口正在使用旧版项目存储，请关闭后重试。')); };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        database.onversionchange = () => database.close();

        function transact(names, write, action) {
          return new Promise((finish, fail) => {
            const operation = database.transaction(names, write ? 'readwrite' : 'readonly');
            let result, reason;
            const abort = error => { reason = error; try { operation.abort(); } catch { /* 已中断的事务仍由 onabort 返回失败。 */ } };
            operation.oncomplete = () => finish(result);
            operation.onabort = () => fail(reason || operation.error || new Error('项目写入中断，请重试并导出备份。'));
            operation.onerror = () => {};
            try { action(operation, value => { result = value; }, abort); }
            catch (error) { abort(error); }
          });
        }

        function transaction(write, action) {
          return transact(['projects', 'settings', 'project-details'], write, (operation, result, abort) => {
            action(operation.objectStore('projects'), operation.objectStore('settings'), result, abort, operation.objectStore('project-details'));
          });
        }

        function check(projects, id, revision, next, abort) {
          projects.get(id).onsuccess = event => {
            const previous = event.target.result;
            if ((previous?.revision ?? null) !== revision) { abort(conflictError(id)); return; }
            try { next(previous); } catch (error) { abort(error); }
          };
        }
        function listen(request, next, abort) {
          request.onsuccess = event => { try { next(event.target.result); } catch (error) { abort(error); } };
        }

        function readThumbnail(id) {
          return transact(['project-details', 'project-thumbnails'], false, (operation, result, abort) => {
            const thumbnails = operation.objectStore('project-thumbnails');
            listen(operation.objectStore('project-details').get(id), value => {
              if (!value) return;
              listen(thumbnails.get(id), thumbnail => {
                if (thumbnail?.contentRevision === (value.contentRevision ?? value.revision)) result(thumbnail);
              }, abort);
            }, abort);
          });
        }

        function writeThumbnail(thumbnail) {
          return transact(['project-details', 'project-thumbnails'], true, (operation, result, abort) => {
            const thumbnails = operation.objectStore('project-thumbnails');
            listen(operation.objectStore('project-details').get(thumbnail.id), value => {
              if (!value || thumbnail.contentRevision !== (value.contentRevision ?? value.revision)) { result(false); return; }
              result(true);
              if (thumbnail.image.size > maximumThumbnailBytes) return;
              thumbnails.put(thumbnail);
              listen(thumbnails.count(), count => {
                let excess = count - maximumThumbnails;
                if (excess <= 0) return;
                listen(thumbnails.index('generatedAt').openKeyCursor(), cursor => {
                  if (!cursor || excess <= 0) return;
                  thumbnails.delete(cursor.primaryKey);
                  excess--;
                  cursor.continue();
                }, abort);
              }, abort);
            }, abort);
          });
        }

        resolve({
          close: () => database.close(),
          readThumbnail,
          writeThumbnail,
          initialize(legacy) {
            return transaction(true, (projects, settings, result, abort, details) => {
              listen(settings.get('legacy-v1'), migrated => {
                if (legacy && !migrated) {
                  projects.add(legacy);
                  details.add(metadata(legacy));
                  settings.put({ key: 'legacy-v1', value: legacy.id });
                }
                listen(details.getAll(), list => {
                  if (!list.length) {
                    const initial = createDefaultRecord();
                    projects.add(initial);
                    details.add(metadata(initial));
                    list.push(metadata(initial));
                  }
                  listen(settings.get('current'), selected => {
                    const current = list.find(item => item.id === selected?.value) || list.sort((a, b) => b.updatedAt - a.updatedAt)[0];
                    settings.put({ key: 'current', value: current.id });
                    listen(projects.get(current.id), result, abort);
                  }, abort);
                }, abort);
              }, abort);
            });
          },
          hasMigration() { return transaction(false, (projects, settings, result) => { settings.get('legacy-v1').onsuccess = event => result(Boolean(event.target.result)); }); },
          list() { return transaction(false, (projects, settings, result, abort, details) => { details.getAll().onsuccess = event => result(event.target.result); }); },
          read(id) { return transaction(false, (projects, settings, result) => { projects.get(id).onsuccess = event => result(event.target.result); }); },
          write(value, revision, select = false) {
            return transaction(true, (projects, settings, result, abort, details) => {
              check(projects, value.id, revision, () => {
                projects.put(value);
                details.put(metadata(value));
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
            const deletion = transaction(true, (projects, settings, result, abort, details) => {
              check(projects, id, revision, () => {
                projects.delete(id);
                details.delete(id);
                if (replacement) {
                  if (createReplacement) {
                    projects.add(replacement);
                    details.add(metadata(replacement));
                    settings.put({ key: 'current', value: replacement.id });
                  }
                  else check(projects, replacement.id, replacement.revision, () => settings.put({ key: 'current', value: replacement.id }), abort);
                }
              }, abort);
            });
            // 清理失败时仍要保留已完成的删除，过期图片由缓存上限清理。
            deletion.then(() => transact(['project-thumbnails'], true, operation => {
              operation.objectStore('project-thumbnails').delete(id);
            })).catch(() => {});
            return deletion;
          },
        });
      };
    });
  }

  global.SignProjectStore = { open };
})(typeof window !== 'undefined' ? window : globalThis);
