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
    const directions = directionChoice === 'both' ? [project.direction, -project.direction] :
      [directionChoice === 'reverse' ? -project.direction : project.direction];
    const results = [];
    for (const station of project.stations) {
      if (!selected.has(station.id)) continue;
      const code = filenamePart(station.code, '无编号', 32);
      const name = filenamePart(stationName(station), '未命名站点', 112);
      for (const direction of directions) {
        const base = [line, code, name, layout, directionName(direction)].join('_');
        let filename = base;
        let suffix = 2;
        while (filenames.has(filename.toLowerCase())) filename = base + '_' + suffix++;
        filenames.add(filename.toLowerCase());
        results.push({ station, direction, filename });
      }
    }
    return { project, mode, layout, results, filename: line + '_' + layout + '_批量导出.zip' };
  }

  function stateForResult(plan, result) {
    return { ...plan.project, mode: plan.mode, currentId: result.station.id, direction: result.direction };
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

  global.PlatformBatch = { createPlan, stateForResult, buildArchive, stationName, directionName, allowBrowserUpdate };
})(typeof window !== 'undefined' ? window : globalThis);
