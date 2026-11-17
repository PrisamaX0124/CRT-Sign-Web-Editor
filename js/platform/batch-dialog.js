(function (global) {
  'use strict';

  function init(app, notice) {
    const batch = global.PlatformBatch;
    const pageSize = 12;
    const control = name => document.getElementById('batch-generation-' + name);
    const dialog = control('dialog');
    const detail = control('detail');
    const stations = control('stations');
    const previews = control('previews');
    const largePreview = control('large-preview');
    const status = control('status');
    let project, plan, task;
    let page = 0;
    let stationInputs = [];
    const selectedResults = new Set();

    function stationLabel(station) {
      return (station.code.trim() || '无编号') + ' ' + batch.stationName(station);
    }

    function formats() {
      return { png: control('png').checked, svg: control('svg').checked, scale: Number(control('scale').value) };
    }

    function syncControls() {
      const selectedStations = stationInputs.filter(input => input.checked).length;
      control('station-count').textContent = '已选 ' + selectedStations + ' / ' + stationInputs.length + ' 个站点';
      control('select-all').disabled = selectedStations === stationInputs.length;
      control('select-none').disabled = selectedStations === 0;
      const { png, svg } = formats();
      control('scale').disabled = !png;
      control('preview').disabled = !selectedStations || (!png && !svg);
      control('preview').hidden = Boolean(plan);
      control('cancel').textContent = task ? '取消处理' : '关闭';
      control('settings').hidden = Boolean(plan);
      control('results').hidden = !plan;
      control('back').hidden = !plan || Boolean(task);
      control('download').hidden = !plan;
      control('download').disabled = Boolean(task) || !selectedResults.size;
      previews.inert = Boolean(task);
      if (plan) {
        const pages = Math.ceil(plan.results.length / pageSize);
        control('result-count').textContent = '已选 ' + selectedResults.size + ' / ' + plan.results.length + ' 张';
        control('page').textContent = '第 ' + (page + 1) + ' / ' + pages + ' 页';
        control('previous-page').disabled = Boolean(task) || page === 0;
        control('next-page').disabled = Boolean(task) || page + 1 === pages;
      }
    }

    function checkbox(parent, text) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      label.append(input, text);
      parent.append(label);
      return input;
    }

    function clearPlan() {
      task?.abort();
      task = null;
      plan = null;
      page = 0;
      previews.replaceChildren();
      selectedResults.clear();
      status.textContent = '';
    }

    function closeDetail() {
      if (detail.open) detail.close();
      largePreview.replaceChildren();
      control('detail-title').textContent = '';
    }

    function clearDialog() {
      clearPlan();
      closeDetail();
      stations.replaceChildren();
      stationInputs = [];
      project = null;
    }

    function closeDialog() {
      dialog.close();
      clearDialog();
    }

    function open() {
      project = app.state;
      control('layout').value = project.mode;
      control('direction').value = 'current';
      const directionHint = direction => {
        const terminal = project.stations[direction === 1 ? project.stations.length - 1 : 0];
        return '（' + batch.directionName(direction) + '，前往' + batch.stationName(terminal) + '）';
      };
      control('direction').options[0].textContent = '当前行车方向' + directionHint(project.direction);
      control('direction').options[1].textContent = '反向行车方向' + directionHint(-project.direction);
      control('png').checked = true;
      control('svg').checked = false;
      control('scale').value = document.getElementById('png-scale').value;
      stationInputs = project.stations.map(station => {
        const input = checkbox(stations, stationLabel(station));
        input.value = station.id;
        return input;
      });
      syncControls();
      dialog.showModal();
    }

    function previewCard(result) {
      const card = document.createElement('article');
      card.className = 'batch-generation-card';
      const title = stationLabel(result.station);
      const description = plan.layout + ' · ' + batch.directionName(result.direction);
      const scene = global.PlatformRender.metrics(batch.stateForResult(plan, result), app.measure);
      const drawing = global.PlatformExport.drawSVG(scene);
      drawing.setAttribute('aria-hidden', 'true');
      const picture = document.createElement('button');
      picture.type = 'button';
      picture.className = 'batch-generation-picture';
      picture.setAttribute('aria-label', '查看大图 · ' + title + ' · ' + description);
      picture.append(drawing);
      picture.addEventListener('click', () => {
        // 大图和缩略图在同一个页面，底纹需要各自的名称。
        const largeDrawing = global.PlatformExport.drawSVG(scene);
        largeDrawing.setAttribute('role', 'img');
        largeDrawing.setAttribute('aria-label', title + ' · ' + description);
        largePreview.replaceChildren(largeDrawing);
        control('detail-title').textContent = title + ' · ' + description;
        detail.showModal();
      });
      card.append(picture);
      const input = checkbox(card, title);
      input.checked = selectedResults.has(result);
      input.setAttribute('aria-label', '导出 ' + title + ' · ' + description);
      input.addEventListener('change', () => {
        if (input.checked) selectedResults.add(result); else selectedResults.delete(result);
        syncControls();
      });
      const caption = document.createElement('p');
      caption.textContent = description;
      card.append(caption);
      return card;
    }

    async function showPage(number) {
      const controller = task = new AbortController();
      page = number;
      const results = plan.results.slice(page * pageSize, (page + 1) * pageSize);
      previews.replaceChildren();
      previews.scrollTop = 0;
      syncControls();
      status.textContent = '正在生成预览 0 / ' + results.length;
      try {
        await app.ready;
        for (const [index, result] of results.entries()) {
          await batch.allowBrowserUpdate();
          controller.signal.throwIfAborted();
          previews.append(previewCard(result));
          status.textContent = '正在生成预览 ' + (index + 1) + ' / ' + results.length;
        }
        status.textContent = '';
      } catch (error) {
        if (controller.signal.aborted) return;
        clearPlan();
        status.textContent = '预览失败。' + error.message;
        syncControls();
      } finally {
        if (task === controller) {
          task = null;
          syncControls();
          control('results-title').focus({ preventScroll: true });
        }
      }
    }

    function generate() {
      const selected = stationInputs.filter(input => input.checked).map(input => input.value);
      plan = batch.createPlan(project, selected, control('layout').value, control('direction').value);
      for (const result of plan.results) selectedResults.add(result);
      showPage(0);
    }

    function returnToSettings() {
      clearPlan();
      syncControls();
      control('preview').focus();
    }

    async function download() {
      const controller = task = new AbortController();
      const filename = plan.filename;
      const results = plan.results.filter(result => selectedResults.has(result));
      syncControls();
      try {
        const archive = await batch.buildArchive(plan, results, formats(), controller.signal, (done, total) => {
          status.textContent = '正在处理 ' + done + ' / ' + total + ' 个文件';
        });
        controller.signal.throwIfAborted();
        global.SignStorage.download(archive, filename);
        task = null;
        closeDialog();
        notice('已开始下载 ' + filename);
      } catch (error) {
        if (!controller.signal.aborted) status.textContent = '打包失败。' + error.message;
      } finally {
        if (task === controller) {
          task = null;
          syncControls();
          control('download').focus();
        }
      }
    }

    document.getElementById('open-batch-generation').addEventListener('click', open);
    document.getElementById('close-batch-generation').addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('close', () => { if (!dialog.open) clearDialog(); });
    detail.addEventListener('close', () => { if (!detail.open) closeDetail(); });
    stations.addEventListener('change', syncControls);
    for (const [name, checked] of [['select-all', true], ['select-none', false]]) {
      control(name).addEventListener('click', () => {
        for (const input of stationInputs) input.checked = checked;
        syncControls();
      });
    }
    control('png').addEventListener('change', syncControls);
    control('svg').addEventListener('change', syncControls);
    control('preview').addEventListener('click', generate);
    control('previous-page').addEventListener('click', () => showPage(page - 1));
    control('next-page').addEventListener('click', () => showPage(page + 1));
    control('back').addEventListener('click', returnToSettings);
    control('cancel').addEventListener('click', () => {
      if (task) returnToSettings(); else closeDialog();
    });
    control('download').addEventListener('click', download);
  }

  global.PlatformBatchDialog = { init };
})(window);
