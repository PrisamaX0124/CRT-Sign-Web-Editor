/* Modified by PrisamaX0124, 2026-10-05: guidance sign and platform editor enhancements; see docs/fork-changes.md. */
/**
 * exporters.js — SVG / PNG 导出（issue 06）
 *
 * 导出的文件内嵌 @font-face（HTTP按需读取fonts；本地文件加载生成的字体数据脚本），
 * 保证导出产物在任意环境（Illustrator / 其他浏览器 / 图片查看器）视觉一致。
 * PNG 通过 SVG → Image → Canvas 光栅化为标识牌实际像素尺寸。
 */
(function (global) {
  'use strict';

  var Core = global.SignCore;
  var Render = global.SignRender;
  var Storage = global.SignStorage;

  var FONT_FILES = {
    zh400: 'MiSans-Regular.ttf',
    zh600: 'MiSans-Semibold.ttf',
    zh700: 'MiSans-Bold.ttf',
    en400: 'MiSans-Regular.ttf',
    en700: 'MiSans-Bold.ttf',
    num400: 'Frutiger-Regular.ttf',
    num700: 'Frutiger-Bold.ttf',
    cond400: 'FrutigerCondensed-Regular.ttf',
    cond700: 'FrutigerCondensed-Bold.ttf',
  };

  // ─── 字体内嵌数据（懒加载）─────────────────────────────────

  var fontDataPromises = {};

  // file://不能fetch本地字体，但可以加载同目录的经典脚本。
  // 数据由gen-export-fonts.mjs从原始TTF生成，不替换为旧字体或系统字体。
  function loadFontScript(file) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'fonts-export/' + file + '.js';
      function finish(failed) {
        var data = global.SignExportFontData && global.SignExportFontData[file];
        if (global.SignExportFontData) delete global.SignExportFontData[file];
        script.onload = script.onerror = null;
        script.remove();
        if (failed || typeof data !== 'string' || data.indexOf('data:font/ttf;base64,') !== 0) {
          reject(new Error('字体加载失败：' + file + '（请检查fonts-export目录是否完整）'));
        } else resolve(data);
      }
      script.onload = function () { finish(false); };
      script.onerror = function () { finish(true); };
      document.head.appendChild(script);
    });
  }

  function fetchFontData(file) {
    return fetch('fonts/' + file).then(function (response) {
      if (!response.ok) throw new Error('字体加载失败：' + file);
      return response.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('字体读取失败：' + file)); };
        // 静态服务器可能将TTF标成font/sfnt或application/octet-stream。
        reader.readAsDataURL(blob.slice(0, blob.size, 'font/ttf'));
      });
    });
  }

  function loadFontData(file) {
    if (fontDataPromises[file]) return fontDataPromises[file];
    fontDataPromises[file] = Promise.resolve().then(function () {
      if (global.location && global.location.protocol === 'file:') return loadFontScript(file);
      return fetchFontData(file).catch(function (err) {
        // HTTP字体请求被浏览器/网络拦截时，也可尝试同源的字体数据脚本。
        if (global.document && err.name === 'TypeError') return loadFontScript(file);
        throw err;
      });
    }).catch(function (err) {
      delete fontDataPromises[file]; // 失败后可重试，已成功的文件仍保留缓存。
      throw err;
    });
    return fontDataPromises[file];
  }

  function ensureFontData(sign) {
    var used = sign ? collectUsedFonts(sign) : { zh400: true, zh600: true, zh700: true, num400: true };
    return ensureUsedFontData(used);
  }

  /** Shared by independent SVG editors that already collect font keys from their metrics. */
  function ensureUsedFontData(used) {
    var files = [];
    Object.keys(used).forEach(function (key) {
      var file = FONT_FILES[key];
      if (used[key] && file && files.indexOf(file) === -1) files.push(file);
    });
    return Promise.all(files.map(loadFontData)).then(function (values) {
      var data = {};
      files.forEach(function (file, i) { data[file] = values[i]; });
      return data;
    });
  }

  /** 扫描标识牌，确定需要内嵌的字体面 */
  function collectUsedFonts(sign) {
    var used = {};
    function anyZh(weight) { used['zh' + (weight || 400)] = true; }
    function anyEn(weight) { used['en' + (weight || 400)] = true; }
    function anyNum() { used.num400 = true; }
    sign.rows.forEach(function (row) {
      row.elements.forEach(function (el) {
        var p = el.props;
        switch (el.type) {
          case 'bilingual-text':
          case 'small-bilingual-text':
            if (p.textZh) anyZh(p.bold ? 700 : 400);
            if (p.textEn) anyEn(p.bold ? 700 : 400);
            break;
          case 'big-number':
            if (p.text) {
              anyNum();
              // Frutiger 缺字时由 MiSans 回退，导出保持中文等混排可见。
              if (/[^\x00-\x7F]/.test(p.text)) anyZh();
            }
            break;
          case 'number-line':
            anyZh(); anyEn(); anyNum();
            break;
          case 'text-line':
            anyZh();                      // 大字 + 「线」标签恒用中文
            if (p.textEn) anyEn();
            break;
          case 'entrance':
          case 'exit':
            if (p.code) anyNum();
            anyZh(); anyEn();
            break;
        }
      });
    });
    return used;
  }

  function buildFontCSS(used, embedData) {
    var rules = [];
    var faces = {
      zh400: ["'MiSans'", 400, 'truetype'],
      zh600: ["'MiSans'", 600, 'truetype'],
      zh700: ["'MiSans'", 700, 'truetype'],
      en400: ["'MiSans'", 400, 'truetype'],
      en700: ["'MiSans'", 700, 'truetype'],
      num400: ["Frutiger", 400, 'truetype'],
      num700: ["Frutiger", 700, 'truetype'],
      cond400: ["'Frutiger Condensed'", 400, 'truetype'],
      cond700: ["'Frutiger Condensed'", 700, 'truetype'],
    };
    var emitted = {};
    Object.keys(used).forEach(function (key) {
      if (!used[key]) return;
      var file = FONT_FILES[key];
      var data = embedData[file];
      if (!data || emitted[file]) return;
      emitted[file] = true;
      var face = faces[key];
      rules.push(
        "@font-face{font-family:" + face[0] + ";src:url(" + data + ") format('" +
        face[2] + "');font-weight:" + face[1] + ";font-style:normal}"
      );
    });
    return rules.join('\n');
  }

  // ─── 导出 SVG ──────────────────────────────────────────────

  /** 生成自包含 SVG 字符串（内嵌字体） */
  function buildExportSVGString(sign, measure, embedData) {
    var layout = Render.layoutSign(sign, measure);
    var svg = document.createElementNS(Core.SVG_NS, 'svg');
    Render.renderSignInto(svg, sign, measure, { clean: true });
    svg.setAttribute('width', layout.width);
    svg.setAttribute('height', layout.height);
    var css = buildFontCSS(collectUsedFonts(sign), embedData);
    if (css) {
      var style = document.createElementNS(Core.SVG_NS, 'style');
      style.textContent = css;
      svg.insertBefore(style, svg.firstChild);
    }
    var xml = new XMLSerializer().serializeToString(svg);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  }

  function exportSVGFile(sign, measure) {
    return ensureFontData(sign).then(function (embedData) {
      var str = buildExportSVGString(sign, measure, embedData);
      var blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
      Storage.download(blob, 'sign-' + Storage.timestamp() + '.svg');
      SignUI.toast('SVG 已导出（内嵌字体）', 'success');
    }, function (err) {
      SignUI.toast(err.message || '导出失败', 'error');
    });
  }

  // ─── 导出 PNG ──────────────────────────────────────────────

  /** Rasterize vectors at the sampling size, never upscale an already decoded bitmap. */
  function rasterizePNG(svgText, size, scale) {
    return new Promise(function (resolve, reject) {
      scale = scale === undefined ? 1 : scale;
      var width = Math.round(size.width * scale), height = Math.round(size.height * scale);
      if ([1, 2, 4].indexOf(scale) < 0 || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 32768 || height > 32768 || width * height > 67108864) {
        reject(new Error('PNG 尺寸超出支持范围，请降低导出倍率或标识牌尺寸')); return;
      }
      // Small signs get 4x supersampling. Bound the temporary surface for large exports.
      var sampling = Math.max(1, Math.min(4, Math.floor(32768 / width), Math.floor(32768 / height), Math.floor(Math.sqrt(16777216 / (width * height)))));
      var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml'), svg = doc.documentElement;
      if (svg.localName !== 'svg' || doc.querySelector('parsererror')) { reject(new Error('SVG 光栅化失败')); return; }
      // viewBox keeps the original layout while width/height select actual raster resolution.
      if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 ' + size.width + ' ' + size.height);
      svg.setAttribute('width', width * sampling); svg.setAttribute('height', height * sampling);
      var str = new XMLSerializer().serializeToString(svg);
      var url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' })), img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          var ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法创建 PNG');
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (blob) resolve(blob); else reject(new Error('PNG 编码失败'));
          }, 'image/png');
        } catch (err) { URL.revokeObjectURL(url); reject(err); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('SVG 光栅化失败')); };
      img.src = url;
    });
  }

  function exportPNGFile(sign, measure) {
    return ensureFontData(sign).then(function (embedData) {
      var layout = Render.layoutSign(sign, measure);
      var str = buildExportSVGString(sign, measure, embedData);
      return rasterizePNG(str, layout).then(function (blob) {
        Storage.download(blob, 'sign-' + Storage.timestamp() + '.png');
        return Math.round(layout.width) + '×' + Math.round(layout.height);
      });
    }).then(function (dims) {
      SignUI.toast('PNG 已导出（' + dims + ' px）', 'success');
    }, function (err) {
      SignUI.toast(err.message || '导出失败', 'error');
    });
  }

  global.SignExporters = {
    ensureFontData: ensureFontData,
    ensureUsedFontData: ensureUsedFontData,
    collectUsedFonts: collectUsedFonts,
    buildFontCSS: buildFontCSS,
    buildExportSVGString: buildExportSVGString,
    rasterizePNG: rasterizePNG,
    exportSVGFile: exportSVGFile,
    exportPNGFile: exportPNGFile,
  };
})(typeof window !== 'undefined' ? window : globalThis);
