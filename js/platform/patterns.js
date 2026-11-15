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
    var source = value.source;
    var image = imageSize(value.image) ? value.image : null;
    var validSource = source === 'automatic' || (source === 'custom' && image !== null) ||
      (typeof source === 'string' && Object.hasOwn(designs, source));
    return { enabled: validSource && (value.enabled === true || value.enabled === undefined),
      source: validSource ? source : 'automatic', size: limit(value.size, 50, 200, defaultSize),
      opacity: limit(value.opacity, 0, 100, defaultOpacity), image: image };
  }

  function chooseDesign(state) {
    var source = state.linePattern.source;
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
    var design = chooseDesign(state);
    var image = pattern.source === 'custom' ? pattern.image : null;
    if (!design && !image) return undefined;
    var horizontalBand = scene.nodes.find(function (node) { return node.attrs['data-role'] === 'passed-line'; });
    var verticalBand = scene.nodes.find(function (node) { return node.attrs['data-role'] === 'vertical-bar'; });
    var sizes = {};
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
      if (thickness) {
        var repeatHeight = design ? thickness * design.repeat : Math.max(thickness * 0.85, 9 / scene.frame.scale);
        sizes[index] = repeatHeight * pattern.size / 100;
      }
    });
    if (!Object.keys(sizes).length) return undefined;
    var opacity = pattern.opacity / 100;
    // 多数参考图的纹线约加三成白，85% 深浅时沿用这一色差。
    var color = design ? inkColor(state.color, opacity * (design.contrast || 0.35)) : null;
    return { sizes: sizes, design: design, image: image, color: state.color, opacity: opacity,
      inkColor: color, scale: scene.frame.scale };
  }

  function shape(name, attributes) {
    var element = document.createElementNS(signCore.SVG_NS, name);
    Object.entries(attributes).forEach(function (pair) { element.setAttribute(pair[0], pair[1]); });
    return element;
  }

  function draw(vectorImage, patterns) {
    var definitions = shape('defs', {});
    var names = new Map();
    var fills = {};
    var design = patterns.design;
    var bounds = design || imageSize(patterns.image);
    if (design) {
      var description = shape('desc', {});
      description.textContent = credits + ' https://hachiiiiiiii.co/ https://creativecommons.org/licenses/by-nc/4.0/';
      vectorImage.appendChild(description);
    }
    vectorImage.appendChild(definitions);
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

  function sync(state) {
    var pattern = state.linePattern;
    var design = chooseDesign(state);
    document.getElementById('line-pattern-enabled').setAttribute('aria-checked', String(pattern.enabled));
    document.getElementById('line-pattern-controls').hidden = !pattern.enabled;
    document.getElementById('line-pattern-source').value = pattern.source;
    document.getElementById('line-pattern-size').value = pattern.size;
    document.getElementById('line-pattern-opacity').value = pattern.opacity;
    document.getElementById('line-pattern-size-value').textContent = pattern.size + '%';
    document.getElementById('line-pattern-opacity-value').textContent = pattern.opacity + '%';
    document.getElementById('line-pattern-values').hidden = !design && pattern.source !== 'custom';
    document.getElementById('line-pattern-import').textContent = pattern.image ? '更换图片' : '上传图片';
    document.getElementById('line-pattern-clear').hidden = !pattern.image;
    document.getElementById('line-pattern-credit').hidden = !design;
    document.getElementById('line-pattern-status').textContent = pattern.source === 'automatic'
      ? (design ? '已匹配' + design.name : '当前线路没有可自动匹配的底纹')
      : (pattern.source === 'custom' ? '正在使用自定义图片' : '');
    document.getElementById('line-pattern-custom').disabled = !pattern.image;
  }

  function init(editor, notice) {
    var source = document.getElementById('line-pattern-source');
    var builtIn = document.getElementById('line-pattern-built-in');
    Object.entries(designs).forEach(function (entry) { builtIn.appendChild(new Option(entry[1].name, entry[0])); });
    function update(changes, group) {
      editor.update(function (state) {
        return global.PlatformState.settings(state, { linePattern: Object.assign({}, state.linePattern, changes) });
      }, group);
    }
    var toggle = document.getElementById('line-pattern-enabled');
    toggle.addEventListener('click', function () { update({ enabled: !editor.state.linePattern.enabled }); });
    source.addEventListener('change', function () { update({ source: source.value }); });
    [['size', defaultSize], ['opacity', defaultOpacity]].forEach(function (setting) {
      var name = setting[0], initialValue = setting[1];
      var control = document.getElementById('line-pattern-' + name);
      control.addEventListener('input', function () { update({ [name]: control.valueAsNumber }, control.id); });
      document.getElementById('line-pattern-reset-' + name).addEventListener('click', function () {
        update({ [name]: initialValue });
      });
    });
    var upload = document.getElementById('line-pattern-file');
    document.getElementById('line-pattern-import').addEventListener('click', function () { upload.click(); });
    document.getElementById('line-pattern-clear').addEventListener('click', function () {
      if (editor.state.linePattern.source === 'custom') {
        update({ image: null, source: 'automatic', enabled: false });
        toggle.focus();
      } else {
        update({ image: null });
        document.getElementById('line-pattern-import').focus();
      }
    });
    var latestUpload;
    upload.addEventListener('change', async function () {
      var file = upload.files[0];
      upload.value = '';
      if (!file) return;
      latestUpload = file;
      var startingState = editor.state;
      try {
        var image = await readImage(file);
        if (latestUpload !== file) return;
        if (editor.state !== startingState) {
          notice('标识牌已更改，请重新选择底纹图片');
          return;
        }
        update({ enabled: true, source: 'custom', image: image });
        notice('已应用自定义底纹');
      } catch (error) {
        if (latestUpload === file) notice('底纹导入失败：' + error.message);
      }
    });
  }

  global.PlatformPatterns = { settings: settings, metrics: metrics, draw: draw, sync: sync, init: init };
})(typeof window !== 'undefined' ? window : globalThis);
