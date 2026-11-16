(function (global) {
  'use strict';
  var signCore = global.SignCore;
  var designs = global.PlatformPatternDesigns;
  var maximumImageLength = 350000;
  var maximumImageSide = 512;
  var defaultSize = 100;
  var defaultOpacity = 85;
  var credits = '纹样改编自 Hachi《重庆轨道交通全线路底纹》1.0，署名—非商业性使用 4.0 国际。按示例的间距、角度和色差铺在当前线路颜色上。';

  function imageSize(data) {
    if (typeof data !== 'string' || data.length > maximumImageLength ||
        !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/.test(data) ||
        (data.length - 22) % 4 !== 0) return null;
    var header = global.atob(data.slice(22, 54));
    if (header.slice(12, 16) !== 'IHDR') return null;
    function dimension(start) {
      return header.charCodeAt(start) * 16777216 + header.charCodeAt(start + 1) * 65536 +
        header.charCodeAt(start + 2) * 256 + header.charCodeAt(start + 3);
    }
    var width = dimension(16), height = dimension(20);
    return width > 0 && width <= maximumImageSide && height > 0 && height <= maximumImageSide
      ? { width: width, height: height } : null;
  }

  function limit(value, minimum, maximum, fallback) {
    return Number.isFinite(value) ? Math.round(signCore.clamp(value, minimum, maximum)) : fallback;
  }

  function settings(value) {
    value = value || {};
    var source = value.source === 'line-1-alternate' ? 'line-1' : value.source;
    var image = imageSize(value.image) ? value.image : null;
    var validSource = source === 'automatic' || (source === 'custom' && image !== null) ||
      (typeof source === 'string' && Object.hasOwn(designs, source));
    return { enabled: validSource && (value.enabled === true || value.enabled === undefined),
      source: validSource ? source : 'automatic', size: limit(value.size, 50, 200, defaultSize),
      opacity: limit(value.opacity, 0, 100, defaultOpacity), image: image };
  }

  function chooseDesign(state, source) {
    if (source === 'automatic') {
      if (state.city !== 'chongqing') return undefined;
      var line = state.line.normalize('NFKC').trim();
      var number = /^([0-9]+)(?:号线)?$/.exec(line);
      if (line !== '环线' && !number) return undefined;
      source = 'line-' + (line === '环线' ? '0' : number[1]);
    }
    return Object.hasOwn(designs, source) ? designs[source] : undefined;
  }

  function inkColor(background, whiteShare) {
    var channels = background.slice(1).match(/../g).map(function (channel) {
      var value = parseInt(channel, 16);
      return Math.round(value + (255 - value) * whiteShare).toString(16).padStart(2, '0');
    });
    return '#' + channels.join('');
  }

  function metrics(state, scene) {
    var pattern = state.linePattern;
    if (!pattern || !pattern.enabled || !pattern.opacity) return undefined;
    var horizontalBand = scene.nodes.find(function (node) { return node.attrs['data-role'] === 'passed-line'; });
    var verticalBand = scene.nodes.find(function (node) { return node.attrs['data-role'] === 'vertical-bar'; });
    var thicknesses = {};
    scene.nodes.forEach(function (node, index) {
      var role = node.attrs['data-role'];
      var thickness;
      if (role === 'active-line-core' || (role === 'active-line' && node.tag === 'polygon')) {
        thickness = horizontalBand.attrs.height;
      } else if (role === 'vertical-current-band') {
        thickness = node.attrs.height;
      } else if (role === 'vertical-active-bar' || role === 'vertical-tail') {
        thickness = verticalBand.attrs.width;
      }
      if (thickness) thicknesses[index] = thickness;
    });
    return bandMetrics(state, pattern, thicknesses, scene.frame.scale);
  }

  function bandMetrics(line, pattern, thicknesses, scale) {
    if (!pattern || !pattern.enabled || !pattern.opacity) return undefined;
    var design = chooseDesign(line, pattern.source);
    var image = pattern.source === 'custom' ? pattern.image : null;
    if (!design && !image) return undefined;
    var sizes = {};
    Object.entries(thicknesses).forEach(function (entry) {
      var index = entry[0], thickness = entry[1];
      var repeatHeight = design ? thickness * design.repeat : Math.max(thickness * 0.85, 9 / scale);
      sizes[index] = repeatHeight * pattern.size / 100;
    });
    if (!Object.keys(sizes).length) return undefined;
    var opacity = pattern.opacity / 100;
    // 多数参考图的纹线约加三成白，85% 深浅时沿用这一色差。
    var color = design ? inkColor(line.color, opacity * (design.contrast || 0.35)) : null;
    return { sizes: sizes, design: design, image: image, color: line.color, opacity: opacity,
      inkColor: color, scale: scale };
  }

  function shape(name, attributes) {
    var element = document.createElementNS(signCore.SVG_NS, name);
    Object.entries(attributes).forEach(function (pair) { element.setAttribute(pair[0], pair[1]); });
    return element;
  }

  function draw(vectorImage, patterns) {
    var definitions = vectorImage.querySelector('defs') || shape('defs', {});
    var names = new Map();
    var fills = {};
    var design = patterns.design;
    var bounds = design || imageSize(patterns.image);
    if (design && !vectorImage.querySelector('desc')) {
      var description = shape('desc', {});
      description.textContent = credits + ' https://hachiiiiiiii.co/ https://creativecommons.org/licenses/by-nc/4.0/';
      vectorImage.appendChild(description);
    }
    if (!definitions.parentNode) vectorImage.appendChild(definitions);
    Object.entries(patterns.sizes).forEach(function (entry) {
      var index = entry[0], height = entry[1];
      if (!names.has(height)) {
        // 预设缩略图与预览共用页面，重复的名称会让底纹引用到别的标识牌。
        var name = 'line-pattern-' + signCore.uuid();
        var pattern = shape('pattern', { id: name, patternUnits: 'userSpaceOnUse',
          width: height * bounds.width / bounds.height, height: height,
          viewBox: [bounds.left || 0, bounds.top || 0, bounds.width, bounds.height].join(' ') });
        var artwork = shape('g', { opacity: design ? 1 : patterns.opacity, fill: 'none', color: patterns.color });
        if (design) {
          if (design.transform) pattern.setAttribute('patternTransform', design.transform);
          artwork.innerHTML = design.shapes.replaceAll('"white"', '"' + patterns.inkColor + '"');
          // 细线在窄色带上容易消失，加宽纹线比放大间距更接近参考图。
          var minimumWidth = design.minimumStroke * bounds.height / (height * patterns.scale);
          artwork.querySelectorAll('[stroke-width]').forEach(function (line) {
            line.setAttribute('stroke-width', Math.max(Number(line.getAttribute('stroke-width')), minimumWidth));
          });
        } else {
          artwork.appendChild(shape('image', { href: patterns.image, width: bounds.width, height: bounds.height }));
        }
        pattern.appendChild(artwork);
        definitions.appendChild(pattern);
        names.set(height, 'url(#' + name + ')');
      }
      fills[index] = names.get(height);
    });
    return fills;
  }

  async function readImage(file) {
    var format = (/\.(png|svg)$/i.exec(file.name) || [])[1];
    if (!format) throw new Error('请选择透明图片或矢量图（.png 或 .svg）');
    if (file.size > 10 * 1024 * 1024) throw new Error('图片须小于或等于 10 兆字节');
    var type = format.toLowerCase() === 'png' ? 'image/png' : 'image/svg+xml';
    var url = URL.createObjectURL(file.slice(0, file.size, type));
    try {
      // 以图片读取矢量图，避免项目存档和导出携带脚本或外部地址。
      var picture = new Image();
      picture.src = url;
      await picture.decode();
      var width = picture.naturalWidth, height = picture.naturalHeight;
      if (!width || !height || Math.max(width, height) > 8192) throw new Error('图片宽高须为 1 至 8192 像素');
      var canvas = document.createElement('canvas'), context = canvas.getContext('2d');
      for (var side = maximumImageSide; side >= 128; side /= 2) {
        var scale = Math.min(1, side / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        context.drawImage(picture, 0, 0, canvas.width, canvas.height);
        var data = canvas.toDataURL('image/png');
        if (imageSize(data)) return data;
      }
      throw new Error('图片过于复杂，无法保存为底纹');
    } catch (error) {
      if (error.name === 'EncodingError') throw new Error('无法读取图片，请检查文件是否损坏');
      throw error;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function init(root, controls) {
    root.innerHTML = `
    <div class="line-pattern-heading">
      <h2 class="section-title">线路底纹</h2>
      <button type="button" id="line-pattern-enabled" class="platform-switch" role="switch" aria-label="启用线路底纹" aria-checked="false" aria-controls="line-pattern-controls"><span aria-hidden="true"></span></button>
    </div>
    <div id="line-pattern-controls" class="collapsible-panel" hidden inert>
      <div class="collapsible-content">
        <div class="field">
          <label for="line-pattern-source">纹样来源</label>
          <select id="line-pattern-source" aria-describedby="line-pattern-status">
            <option value="automatic">按重庆线路匹配</option>
            <optgroup label="内置纹样" id="line-pattern-built-in"></optgroup>
            <option value="custom" id="line-pattern-custom" disabled>自定义图片</option>
          </select>
          <small id="line-pattern-status" role="status"></small>
        </div>
        <div id="line-pattern-values" hidden>
          <div class="field">
            <label for="line-pattern-size">大小 <output id="line-pattern-size-value" for="line-pattern-size"></output></label>
            <div class="line-pattern-adjustment">
              <input id="line-pattern-size" type="range" min="50" max="200">
              <button type="button" class="icon-btn" id="line-pattern-reset-size" aria-label="重置底纹大小" title="重置底纹大小"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6M4 10a8 8 0 1 1-1 6"/></svg></button>
            </div>
          </div>
          <div class="field">
            <label for="line-pattern-opacity">深浅 <output id="line-pattern-opacity-value" for="line-pattern-opacity"></output></label>
            <div class="line-pattern-adjustment">
              <input id="line-pattern-opacity" type="range" min="0" max="100">
              <button type="button" class="icon-btn" id="line-pattern-reset-opacity" aria-label="重置底纹深浅" title="重置底纹深浅"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6M4 10a8 8 0 1 1-1 6"/></svg></button>
            </div>
          </div>
        </div>
        <div class="field-pair">
          <button type="button" class="btn" id="line-pattern-import" aria-describedby="line-pattern-file-help">上传图片</button>
          <button type="button" class="btn" id="line-pattern-clear" data-control-icon="delete" hidden>移除图片</button>
        </div>
        <input id="line-pattern-file" type="file" accept=".png,.svg,image/png,image/svg+xml" hidden>
        <p class="field-help" id="line-pattern-file-help">支持 .png 和 .svg 图片。透明处显示线路底色。</p>
        <p class="field-help" id="line-pattern-credit" hidden>内置纹样改编自 <a href="https://hachiiiiiiii.co/" target="_blank" rel="noopener">Hachi</a>，按<a href="https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans" target="_blank" rel="noopener">署名与非商业性使用许可</a>提供。</p>
      </div>
    </div>`;
    function field(name) { return root.querySelector('#line-pattern-' + name); }
    var source = field('source');
    var builtIn = field('built-in');
    var options = field('controls');
    Object.entries(designs).forEach(function (entry) { builtIn.appendChild(new Option(entry[1].name, entry[0])); });
    var update = controls.update;
    var toggle = field('enabled');
    toggle.addEventListener('click', function () {
      var target = controls.read();
      if (target) update({ enabled: !target.linePattern.enabled });
    });
    source.addEventListener('change', function () { update({ source: source.value }); });
    [['size', defaultSize], ['opacity', defaultOpacity]].forEach(function (setting) {
      var name = setting[0], initialValue = setting[1];
      var control = field(name);
      control.addEventListener('input', function () { update({ [name]: control.valueAsNumber }, control.id); });
      field('reset-' + name).addEventListener('click', function () {
        update({ [name]: initialValue });
      });
    });
    var upload = field('file');
    field('import').addEventListener('click', function () { upload.click(); });
    field('clear').addEventListener('click', function () {
      var target = controls.read();
      if (!target) return;
      if (target.linePattern.source === 'custom') {
        update({ image: null, source: 'automatic', enabled: false });
        toggle.focus();
      } else {
        update({ image: null });
        field('import').focus();
      }
    });
    var latestUpload;
    upload.addEventListener('change', async function () {
      var file = upload.files[0];
      upload.value = '';
      var startingState = controls.read();
      if (!file || !startingState) return;
      latestUpload = file;
      try {
        var image = await readImage(file);
        if (latestUpload !== file) return;
        if (controls.read() !== startingState) {
          controls.notice('标识牌已更改，请重新选择底纹图片');
          return;
        }
        update({ enabled: true, source: 'custom', image: image });
        controls.notice('已应用自定义底纹');
      } catch (error) {
        if (latestUpload === file) controls.notice('底纹导入失败：' + error.message);
      }
    });
    return function sync(line) {
      var pattern = line.linePattern;
      var design = chooseDesign(line, pattern.source);
      toggle.setAttribute('aria-checked', String(pattern.enabled));
      toggle.setAttribute('aria-label', pattern.enabled ? '关闭线路底纹' : '启用线路底纹');
      if (!pattern.enabled && options.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      options.hidden = options.inert = !pattern.enabled;
      source.value = pattern.source;
      field('size').value = pattern.size;
      field('opacity').value = pattern.opacity;
      field('size-value').textContent = pattern.size + '%';
      field('opacity-value').textContent = pattern.opacity + '%';
      field('values').hidden = !design && pattern.source !== 'custom';
      field('import').textContent = pattern.image ? '更换图片' : '上传图片';
      field('clear').hidden = !pattern.image;
      field('credit').hidden = !design;
      field('status').textContent = pattern.source === 'automatic'
        ? (design ? '已匹配' + design.name : '当前线路没有可自动匹配的底纹')
        : (pattern.source === 'custom' ? '正在使用自定义图片' : '');
      field('custom').disabled = !pattern.image;
    };
  }

  global.PlatformPatterns = { settings: settings, metrics: metrics, bandMetrics: bandMetrics, draw: draw, init: init };
})(typeof window !== 'undefined' ? window : globalThis);
