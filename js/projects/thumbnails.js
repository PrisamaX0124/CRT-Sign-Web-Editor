(function (global) {
  'use strict';

  const thumbnailVersion = 1;
  const maximumWidth = 384;
  const maximumHeight = 176;
  const fontStyles = new Map();

  function thumbnailSize({ width, height }, cropVertical) {
    const visibleHeight = cropVertical ? Math.min(height, width * 2) : height;
    const scale = Math.min(maximumWidth / width, maximumHeight / visibleHeight, 1);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(visibleHeight * scale)),
      viewBox: '0 0 ' + width + ' ' + visibleHeight,
      cropped: visibleHeight < height,
    };
  }

  async function thumbnailFonts(usedFonts, fontOptions) {
    const exporter = global.SignExporters;
    const fonts = await exporter.ensureUsedFontData(usedFonts, fontOptions).catch(() => ({}));
    return Object.entries(fonts).map(([file, data]) => {
      const cacheKey = Array.isArray(data)
        ? file + ':' + data.map(item => item.url || item.unicodeRange || '').join('|')
        : file + ':' + (typeof data === 'string' ? data.length : '');
      if (!fontStyles.has(cacheKey)) {
        const rules = exporter.buildFontCSS(usedFonts, { [file]: data });
        fontStyles.set(cacheKey, new Blob([rules]));
      }
      return fontStyles.get(cacheKey);
    });
  }

  async function rasterize({ drawing, size, usedFonts, fontOptions, cropVertical }, signal) {
    const thumbnail = thumbnailSize(size, cropVertical);
    const rules = await thumbnailFonts(usedFonts, fontOptions);
    signal.throwIfAborted();
    drawing.setAttribute('viewBox', thumbnail.viewBox);
    drawing.setAttribute('width', thumbnail.width);
    drawing.setAttribute('height', thumbnail.height);
    const source = new XMLSerializer().serializeToString(drawing);
    const rootEnd = source.indexOf('>') + 1;
    // 字体占用远大于图形，复用字体块可以避免每张图重新拼接完整字体文本。
    const vector = new Blob([
      source.slice(0, rootEnd), '<style>', ...rules, '</style>', source.slice(rootEnd),
    ], { type: 'image/svg+xml;charset=utf-8' });
    const address = URL.createObjectURL(vector), image = new Image();
    const cancel = () => image.removeAttribute('src');
    signal.addEventListener('abort', cancel, { once: true });
    try {
      image.src = address;
      await image.decode();
      signal.throwIfAborted();
      const canvas = document.createElement('canvas');
      canvas.width = thumbnail.width;
      canvas.height = thumbnail.height;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .86));
      signal.throwIfAborted();
      if (!blob) throw new Error('无法生成缩略图');
      return { image: blob, cropped: thumbnail.cropped };
    } finally {
      cancel();
      signal.removeEventListener('abort', cancel);
      URL.revokeObjectURL(address);
    }
  }

  function create({ dialog, getStore, readState, draw }) {
    const entries = new Map();
    const failed = new Map();
    let running, pause, idle;
    const observer = typeof global.IntersectionObserver === 'function' ? new global.IntersectionObserver(changes => {
      for (const change of changes) {
        const entry = entries.get(change.target);
        if (entry) entry.visible = change.isIntersecting;
      }
      schedule();
    }, { root: dialog }) : null;

    function nextEntry() {
      if (!dialog.open) return;
      return [...entries.values()].find(entry => entry.visible && !entry.address && failed.get(entry.id) !== entry.contentRevision);
    }
    function stopWaiting() {
      clearTimeout(pause);
      if (idle !== undefined) global.cancelIdleCallback(idle);
      pause = idle = undefined;
    }
    function schedule() {
      if (running || pause !== undefined || idle !== undefined || !nextEntry()) return;
      pause = setTimeout(() => {
        pause = undefined;
        if (global.requestIdleCallback) idle = global.requestIdleCallback(start, { timeout: 500 });
        else start();
      }, 160);
    }
    function setImage(entry, thumbnail) {
      const picture = document.createElement('img');
      picture.alt = '';
      picture.decoding = 'async';
      entry.address = URL.createObjectURL(thumbnail.image);
      picture.addEventListener('load', () => {
        if (entries.get(entry.frame) !== entry) return;
        entry.frame.dataset.cropped = String(thumbnail.cropped);
        entry.frame.dataset.thumbnailState = 'ready';
        if (dialog.open) global.EditorMotion.fadeIn(picture, 'reveal');
      }, { once: true });
      picture.addEventListener('error', () => {
        if (entries.get(entry.frame) !== entry) return;
        URL.revokeObjectURL(entry.address);
        entry.address = undefined;
        picture.remove();
        failed.set(entry.id, entry.contentRevision);
        entry.frame.dataset.thumbnailState = 'unavailable';
      }, { once: true });
      picture.src = entry.address;
      entry.frame.append(picture);
    }
    async function start() {
      idle = undefined;
      const entry = nextEntry(), store = getStore();
      if (!entry || !store) return;
      const { id, contentRevision } = entry;
      const controller = new AbortController(), signal = controller.signal;
      running = { entry, controller };
      try {
        let thumbnail = await store.readThumbnail(id).catch(() => undefined);
        signal.throwIfAborted();
        if (thumbnail?.version !== thumbnailVersion || thumbnail.contentRevision !== contentRevision) {
          const record = await store.read(id);
          signal.throwIfAborted();
          if (!record || (record.contentRevision ?? record.revision) !== contentRevision) return;
          const drawing = await draw(readState(record), signal);
          signal.throwIfAborted();
          const picture = await rasterize(drawing, signal);
          if (!dialog.open) return;
          thumbnail = { id, contentRevision, version: thumbnailVersion, generatedAt: Date.now(), ...picture };
          const saved = await store.writeThumbnail(thumbnail).catch(() => true);
          if (!saved) return;
        }
        if (!signal.aborted && dialog.open) setImage(entry, thumbnail);
      } catch {
        if (!signal.aborted) {
          failed.set(id, contentRevision);
          entry.frame.dataset.thumbnailState = 'unavailable';
        }
      } finally {
        // 即使磁盘上已有新版，列表刷新前也只处理当前这份资料一次。
        if (dialog.open && !signal.aborted && !entry.address && failed.get(id) !== contentRevision) failed.set(id, contentRevision);
        running = undefined;
        schedule();
      }
    }
    function synchronize(shown, existingIds) {
      for (const [frame, entry] of entries) {
        if (shown.has(frame)) continue;
        observer?.unobserve(frame);
        if (running?.entry === entry) running.controller.abort();
        if (entry.address) URL.revokeObjectURL(entry.address);
        frame.querySelector('img')?.remove();
        delete frame.dataset.cropped;
        delete frame.dataset.thumbnailState;
        entries.delete(frame);
      }
      if (existingIds) {
        for (const id of failed.keys()) if (!existingIds.has(id)) failed.delete(id);
      }
      for (const [frame, value] of shown) {
        if (entries.has(frame)) continue;
        const contentRevision = value.contentRevision ?? value.revision;
        entries.set(frame, { frame, id: value.id, contentRevision, visible: !observer });
        if (failed.get(value.id) === contentRevision) frame.dataset.thumbnailState = 'unavailable';
        observer?.observe(frame);
      }
      if (!entries.size) stopWaiting();
      schedule();
    }
    function stop() {
      stopWaiting();
      running?.controller.abort();
    }
    return { synchronize, stop };
  }

  global.SignProjectThumbnails = { create, thumbnailSize };
})(typeof window !== 'undefined' ? window : globalThis);
