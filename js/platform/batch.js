(function (global) {
  'use strict';

  const layoutNames = { route: '全线吊板', station: '本站吊板', vertical: '纵向线路图' };
  const encoder = new TextEncoder();

  function stationName(station) {
    return station.zh.trim() || (station.en || '').trim() || '未命名站点';
  }

  function directionName(direction) {
    return direction === 1 ? '正向' : '反向';
  }

  function verticalName(variant) {
    return { left: '单列左版', right: '单列右版', double: '双列' }[variant];
  }

  function terminalName(project, direction) {
    return stationName(project.stations[direction === 1 ? project.stations.length - 1 : 0]);
  }

  function orientation(project, mode, direction, verticalSwapped) {
    const name = directionName(direction);
    if (mode !== 'vertical') return { filename: name, label: name + ' · 前往' + terminalName(project, direction) };
    const variant = verticalName(project.verticalVariant);
    if (project.verticalVariant !== 'double') {
      return { filename: variant + '_' + name, label: variant + ' · ' + name + (direction === 1 ? ' ↑ ' : ' ↓ ') + '前往' + terminalName(project, direction) };
    }
    const columns = global.PlatformState.verticalColumnDirections({ ...project, direction, verticalSwapped });
    const side = column => column.side === 'left' ? '左' : '右';
    const positions = columns.map(column => side(column) + '往' + (column.direction === 1 ? '末站' : '首站'));
    const labels = columns.map(column => side(column) + '往' + terminalName(project, column.direction));
    return { filename: [variant, ...positions].join('_'), label: [variant, ...labels].join(' · ') };
  }

  function filenamePart(value, fallback, limit) {
    const cleaned = value.normalize('NFC')
      .replace(/[\u0000-\u001f\u007f\ud800-\udfff<>:"/\\|?*]/gu, '_')
      .replace(/^[.\s]+|[.\s]+$/g, '');
    const portable = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(cleaned) ? '_' + cleaned : cleaned;
    let name = '';
    let length = 0;
    for (const character of portable) {
      length += encoder.encode(character).length;
      if (length > limit) break;
      name += character;
    }
    return name.trimEnd().replace(/\.+$/, '') || fallback;
  }

  function createPlan(state, stationIds, mode, directionChoice) {
    const project = structuredClone(state);
    const lineName = project.line.trim() || project.lineName.trim();
    const line = filenamePart(/^\d+$/.test(lineName) ? lineName + '号线' : lineName, '未命名线路', 64);
    const layout = layoutNames[mode];
    const selected = new Set(stationIds);
    const filenames = new Set();
    const double = mode === 'vertical' && project.verticalVariant === 'double';
    const both = !double && directionChoice === 'both';
    const direction = !double && directionChoice === 'reverse' ? -project.direction : project.direction;
    const results = [];
    const opposites = new Map();
    for (const station of project.stations) {
      if (!selected.has(station.id)) continue;
      const code = filenamePart(station.code, '无编号', 32);
      const name = filenamePart(stationName(station), '未命名站点', double ? 96 : 112);
      function resultFor(direction, verticalSwapped) {
        const details = orientation(project, mode, direction, verticalSwapped);
        const base = [line, code, name, layout, details.filename].join('_');
        let filename = base;
        let suffix = 2;
        while (filenames.has(filename.toLowerCase())) filename = base + '_' + suffix++;
        filenames.add(filename.toLowerCase());
        return { station, direction, verticalSwapped, filename, description: layout + ' · ' + details.label };
      }
      const first = resultFor(direction, project.verticalSwapped);
      const second = double ? resultFor(direction, !project.verticalSwapped) : resultFor(-direction, project.verticalSwapped);
      results.push(first);
      if (both) results.push(second);
      else opposites.set(first, second);
    }
    return { project, mode, layout, results, opposites, double, filename: line + '_' + layout + '_批量导出.zip' };
  }

  function oppositeResult(plan, result) {
    return plan.opposites.get(result);
  }

  function stateForResult(plan, result) {
    return { ...plan.project, mode: plan.mode, currentId: result.station.id, direction: result.direction, verticalSwapped: result.verticalSwapped };
  }

  function allowBrowserUpdate() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  async function buildArchive(plan, results, formats, signal, report) {
    const output = new global.zip.BlobWriter('application/zip');
    const archive = new global.zip.ZipWriter(output, { signal });
    const total = results.length * (Number(Boolean(formats.svg)) + Number(Boolean(formats.png)));
    let done = 0;
    const exporter = global.PlatformExport;

    async function addFile(filename, file, options) {
      signal.throwIfAborted();
      await archive.add(filename, new global.zip.BlobReader(file), options);
      signal.throwIfAborted();
      report(++done, total);
    }

    try {
      report(done, total);
      for (const result of results) {
        await allowBrowserUpdate();
        signal.throwIfAborted();
        const prepared = await exporter.prepare(stateForResult(plan, result), signal);
        signal.throwIfAborted();
        if (formats.svg) {
          const file = new Blob([prepared.source], { type: 'image/svg+xml;charset=utf-8' });
          await addFile(result.filename + '.svg', file);
        }
        if (formats.png) {
          const file = await exporter.pngBlob(prepared.drawing, prepared.size, formats.scale, signal);
          // PNG 已经压缩，再压缩一次通常只会增加等待时间。
          await addFile(result.filename + '.png', file, { level: 0 });
        }
      }
      const file = await archive.close();
      signal.throwIfAborted();
      return file;
    } catch (error) {
      await output.writable.abort(error).catch(() => {});
      throw error;
    }
  }

  global.PlatformBatch = { createPlan, oppositeResult, stateForResult, buildArchive, stationName, directionName, verticalName, terminalName, allowBrowserUpdate };
})(typeof window !== 'undefined' ? window : globalThis);
