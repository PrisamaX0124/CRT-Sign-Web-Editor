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
    let loadingPreviews = false;
    let page = 0;
    let stationInputs = [];
    const selectedResults = new Set();
    const reversedResults = new Set();
    const failedResults = new Set();

    function stationLabel(station) {
      return (station.code.trim() || '无编号') + ' ' + batch.stationName(station);
    }

    function formats() {
      return { png: control('png').checked, svg: control('svg').checked, scale: Number(control('scale').value) };
    }

    function syncLayout() {
      const vertical = control('layout').value === 'vertical';
      const double = vertical && project.verticalVariant === 'double';
      const direction = control('direction');
      direction.closest('.field').hidden = double;
      function directionHint(value) {
        const arrow = vertical ? (value === 1 ? ' ↑' : ' ↓') : '';
        return '（' + batch.directionName(value) + '，前往' + batch.terminalName(project, value) + arrow + '）';
      }
      direction.options[0].textContent = '当前行车方向' + directionHint(project.direction);
      direction.options[1].textContent = '反向行车方向' + directionHint(-project.direction);
      const help = control('layout-help');
      help.hidden = !vertical;
      if (!vertical) return;
      if (double) {
        const columns = global.PlatformState.verticalColumnDirections(project);
        help.textContent = '双列每站生成一张。当前左列前往' + batch.terminalName(project, columns[0].direction) +
          '，右列前往' + batch.terminalName(project, columns[1].direction) + '。可在预览中为个别站点交换左右列。';
      } else {
        help.textContent = '沿用整牌设置的「' + batch.verticalName(project.verticalVariant) + '」。可在预览中为个别站点反向。';
      }
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
      control('cancel').hidden = !task;
      control('settings').hidden = Boolean(plan);
      control('results').hidden = !plan;
      control('back').hidden = !plan || Boolean(task);
      control('download').hidden = !plan;
      control('download').disabled = Boolean(task) || !selectedResults.size ||
        [...failedResults].some(result => selectedResults.has(result));
      previews.inert = Boolean(task) && !loadingPreviews;
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
      loadingPreviews = false;
      plan = null;
      page = 0;
      previews.replaceChildren();
      selectedResults.clear();
      reversedResults.clear();
      failedResults.clear();
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
      syncLayout();
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

    function chosenResult(result) {
      return reversedResults.has(result) ? batch.oppositeResult(plan, result) : result;
    }

    function previewCard(result) {
      const card = document.createElement('article');
      card.className = 'batch-generation-card';
      const title = stationLabel(result.station);
      const picture = document.createElement('button');
      picture.type = 'button';
      picture.className = 'batch-generation-picture';
      picture.disabled = true;
      let scene;
      picture.addEventListener('click', () => {
        // 大图和缩略图在同一个页面，底纹需要各自的名称。
        const description = chosenResult(result).description;
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
      input.addEventListener('change', () => {
        if (input.checked) selectedResults.add(result); else selectedResults.delete(result);
        syncControls();
      });
      const summary = document.createElement('div');
      summary.className = 'batch-generation-card-summary';
      const caption = document.createElement('p');
      summary.append(caption);
      card.append(summary);
      const errorMessage = document.createElement('p');
      errorMessage.setAttribute('role', 'alert');
      errorMessage.hidden = true;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn';
      retry.dataset.retryBatchPreview = '';
      retry.textContent = '重试这张预览';
      retry.hidden = true;
      retry.addEventListener('click', show);
      card.append(errorMessage, retry);
      const alternate = batch.oppositeResult(plan, result);
      let reverse;
      if (alternate) {
        reverse = document.createElement('button');
        reverse.className = 'btn batch-generation-reverse';
        reverse.type = 'button';
        reverse.disabled = true;
        reverse.addEventListener('click', () => {
          if (reversedResults.has(result)) reversedResults.delete(result); else reversedResults.add(result);
          show();
        });
        summary.append(reverse);
      }
      function syncDescription() {
        const description = chosenResult(result).description;
        caption.textContent = description;
        picture.setAttribute('aria-label', '查看大图 · ' + title + ' · ' + description);
        input.setAttribute('aria-label', '导出 ' + title + ' · ' + description);
        if (!reverse) return;
        const action = reversedResults.has(result) ? (plan.double ? '恢复列序' : '恢复方向') : (plan.double ? '交换左右列' : '反向');
        reverse.textContent = action;
        reverse.setAttribute('aria-label', action + ' · ' + title);
      }
      function show() {
        syncDescription();
        try {
          const active = chosenResult(result);
          scene = global.PlatformRender.metrics(batch.stateForResult(plan, active), app.measure);
          const drawing = global.PlatformExport.drawSVG(scene);
          drawing.setAttribute('aria-hidden', 'true');
          picture.replaceChildren(drawing);
          picture.disabled = false;
          if (reverse) reverse.disabled = false;
          errorMessage.hidden = retry.hidden = true;
          failedResults.delete(result);
          syncControls();
          global.EditorMotion.fadeIn(drawing);
        } catch (error) { fail(error); }
      }
      function fail(error) {
        failedResults.add(result);
        picture.replaceChildren();
        picture.disabled = true;
        if (reverse) reverse.disabled = false;
        errorMessage.textContent = '这张预览生成失败。' + (error.message || '请重试。');
        errorMessage.hidden = retry.hidden = false;
        syncControls();
      }
      syncDescription();
      return { card, show, fail };
    }

    async function showPage(number) {
      const controller = task = new AbortController();
      loadingPreviews = true;
      page = number;
      const results = plan.results.slice(page * pageSize, (page + 1) * pageSize);
      const cards = results.map(previewCard);
      previews.replaceChildren(...cards.map(preview => preview.card));
      previews.scrollTop = 0;
      syncControls();
      control('results-title').focus({ preventScroll: true });
      status.textContent = '正在生成预览 0 / ' + results.length;
      try {
        await app.ready;
        for (const [index, preview] of cards.entries()) {
          await batch.allowBrowserUpdate();
          controller.signal.throwIfAborted();
          preview.show();
          status.textContent = '正在生成预览 ' + (index + 1) + ' / ' + results.length;
        }
        status.textContent = '';
      } catch (error) {
        if (controller.signal.aborted) return;
        for (const preview of cards) preview.fail(error);
        status.textContent = '预览失败，可在对应卡片中重试。';
      } finally {
        if (task === controller) {
          task = null;
          loadingPreviews = false;
          syncControls();
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
      const results = plan.results.filter(result => selectedResults.has(result)).map(chosenResult);
      syncControls();
      try {
        const archive = await batch.buildArchive(plan, results, formats(), controller.signal, (done, total) => {
          status.textContent = '正在处理 ' + done + ' / ' + total + ' 个文件';
        });
        controller.signal.throwIfAborted();
        global.SignStorage.download(archive, filename);
        task = null;
        closeDialog();
        notice('已开始下载 ' + filename, 'success');
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
    control('layout').addEventListener('change', syncLayout);
    control('preview').addEventListener('click', generate);
    control('previous-page').addEventListener('click', () => showPage(page - 1));
    control('next-page').addEventListener('click', () => showPage(page + 1));
    control('back').addEventListener('click', returnToSettings);
    control('cancel').addEventListener('click', returnToSettings);
    control('download').addEventListener('click', download);
  }

  global.PlatformBatchDialog = { init };
})(window);
