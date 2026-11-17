(function(global) {
  'use strict';
  var Core=global.SignCore,serial=0;
  function h(tag,attrs,children) {
    var el=document.createElement(tag);
    Object.keys(attrs||{}).forEach(function(key){if(key==='text')el.textContent=attrs[key];else if(attrs[key]!==undefined)el.setAttribute(key,attrs[key]);});
    (children||[]).forEach(function(child){if(child)el.appendChild(child);});return el;
  }
  function create(opts) {
    var value = opts.value || null, city = opts.getCity(), scope = opts.scope || '颜色';
    var colorButtons = [], revision = -1;
    var paletteId = 'color-options-' + (++serial);
    var sample = h('span', { class: 'current-color', 'aria-hidden': 'true' });
    var current = h('button', { type: 'button', class: 'cp-current', 'aria-controls': paletteId }, [sample]);
    var hex = h('input', { id: opts.hexId, class: 'hex-input', type: 'text', spellcheck: 'false',
      placeholder: '#RRGGBB', maxlength: '7', 'aria-label': scope + '十六进制值' });
    var nativeColor = h('input', { id: opts.nativeId, class: 'cp-native', type: 'color',
      title: '自定义' + scope, 'aria-label': '自定义' + scope });
    var customColor = h('label', { class: 'custom-color', title: '自定义' + scope }, [
      h('span', { text: '+', 'aria-hidden': 'true' }), nativeColor,
    ]);
    var clear = opts.nullable ? h('button', { type: 'button', class: 'cp-null-btn', text: '透明',
      'aria-label': scope + '设为透明' }) : null;
    var citySelect = h('select', { class: 'cp-city-select', 'aria-label': scope + '色板城市' });
    var manage = h('button', { type: 'button', class: 'cp-manage', text: '管理', title: '管理自定义色板',
      'aria-label': '管理自定义色板' });
    var swatches = h('div', { id: opts.swatchesId, class: 'cp-swatches', role: 'group',
      'aria-label': scope + '色板' });
    var palette = h('div', { class: 'cp-options collapsible-panel', id: paletteId, hidden: '' }, [
      h('div', { class: 'collapsible-content' }, [
        h('div', { class: 'color-palette-settings' }, [citySelect, manage]), swatches,
      ]),
    ]);
    var row = h('div', { class: 'cp-row' }, [current, hex, clear]);
    var root = h('div', { class: 'color-picker' + (opts.mini ? ' mini' : ''), 'data-scope': scope }, [row, palette]);

    function paint() {
      var mixed = !!(opts.isMixed && opts.isMixed());
      sample.classList.toggle('nullable-null', value === null && !mixed);
      sample.classList.toggle('mixed-color', mixed);
      sample.style.background = value || '';
      hex.placeholder = mixed ? '不同' : '#RRGGBB';
      if (document.activeElement !== hex) {
        hex.value = value || '';
        hex.classList.remove('invalid');
      }
      if (value) nativeColor.value = value;
      if (clear) {
        clear.classList.toggle('active', value === null && !mixed);
        clear.setAttribute('aria-pressed', String(value === null && !mixed));
      }
      colorButtons.forEach(function (button) {
        var active = !mixed && button.dataset.color === value;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    }
    function commit(color) {
      value = color;
      paint();
      if (opts.onChange) opts.onChange(color);
    }
    hex.addEventListener('input', function () {
      var raw = hex.value.trim();
      var color = Core.normalizeHex(raw && raw.charAt(0) !== '#' ? '#' + raw : raw);
      hex.classList.toggle('invalid', !!raw && !color);
      if (color) commit(color);
    });
    hex.addEventListener('blur', paint);
    nativeColor.addEventListener('input', function () { commit(Core.normalizeHex(nativeColor.value)); });
    if (clear) clear.addEventListener('click', function () { commit(null); });
    citySelect.addEventListener('change', function () { opts.onCityChange(citySelect.value); });
    manage.addEventListener('click', function () {
      global.SignPaletteManager.open({ getCity: opts.getCity, onSelect: opts.onCityChange });
    });
    function renderSwatches() {
      syncPaletteSelect(citySelect, city);
      revision = global.SignPalettes ? global.SignPalettes.revision() : 0;
      colorButtons = Core.citySwatches(city).map(function (color) {
        var button = h('button', { type: 'button', class: 'cp-swatch', title: color.name,
          'aria-label': color.name, 'data-color': color.bg, style: 'background:' + color.bg });
        button.addEventListener('click', function () { commit(color.bg); });
        return button;
      });
      swatches.replaceChildren(...colorButtons, customColor);
      paint();
    }
    function setPaletteOpen(open) {
      if (!open && palette.contains(document.activeElement)) current.focus({ preventScroll: true });
      palette.hidden = !open;
      palette.inert = !open;
      current.title = scope + (open ? '：收起色板' : '：展开色板');
      current.setAttribute('aria-label', current.title);
      current.setAttribute('aria-expanded', String(open));
    }
    current.addEventListener('click', function () { setPaletteOpen(palette.hidden); });
    root.sync = function () {
      var nextCity = opts.getCity(), nextRevision = global.SignPalettes ? global.SignPalettes.revision() : 0;
      if (opts.getValue) value = opts.getValue() || null;
      if (nextCity !== city || revision !== nextRevision) {
        city = nextCity;
        renderSwatches();
      } else paint();
    };
    renderSwatches();
    setPaletteOpen(false);
    return root;
  }
  function syncPaletteSelect(select,selected){
    select.replaceChildren();
    var builtin=h('optgroup',{label:'预设线路配色'}),custom=h('optgroup',{label:'我的色板'});
    Core.paletteOptions().forEach(function(p){(p.custom?custom:builtin).appendChild(h('option',{value:p.id,text:p.name}));});
    if (selected && !Core.isPalette(selected)) custom.appendChild(h('option', { value: selected, text: '原色板未安装' }));
    select.appendChild(builtin);if(custom.children.length)select.appendChild(custom);select.value=selected;
  }
  if(global.addEventListener)global.addEventListener('sign-palettes-change',function(){document.querySelectorAll('.color-picker').forEach(function(root){if(root.sync)root.sync();});});
  global.SignColorPicker={create:create,syncPaletteSelect:syncPaletteSelect};
})(typeof window!=='undefined'?window:globalThis);
