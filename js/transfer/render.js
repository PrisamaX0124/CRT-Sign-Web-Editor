(function (global) {
  'use strict';

  const core = global.SignCore;
  const patterns = global.PlatformPatterns;
  const designWidth = 768;
  const designHeight = 1024;
  const inkColor = '#161616';

  function box(text, role, family, weight, size, measure) {
    const ink = measure.ink(text, family, weight, size);
    const ascent = measure.ascent(text, family, weight, size);
    const descent = measure.descent(text, family, weight, size);
    return {
      text, role, family, weight, size, ascent, descent, leftBearing: ink.abl,
      width: Math.max(0, ink.abl + ink.abr), height: ascent + descent,
    };
  }

  function label(lines, measure, scale) {
    const allNumbers = lines.every(line => /^[0-9]+$/.test(line.line));
    const names = allNumbers
      ? lines.map(line => line.line).join('/')
      : lines.map(line => /^[0-9]+$/.test(line.line) ? line.line + '号线' : line.line).filter(Boolean).join(' / ');
    const captions = allNumbers ? [['换乘', 'Transfer'], ['号线', 'Line']] : [['换乘', 'Transfer']];
    const pairs = captions.map(([chinese, english]) => ({
      chinese: box(chinese, 'label-chinese', core.FONT_ZH, 400, 51 * scale, measure),
      english: box(english, 'label-english', core.FONT_EN, 400, 29 * scale, measure),
    }));
    const name = !names ? null : allNumbers
      ? box(names, 'line-number', core.FONT_NUM, 400, 116 * scale, measure)
      : box(names, 'line-name', core.FONT_ZH, 400, 57 * scale, measure);
    const chineseHeight = Math.max(...pairs.map(pair => pair.chinese.height));
    const englishAscent = Math.max(...pairs.map(pair => pair.english.ascent));
    const englishDescent = Math.max(...pairs.map(pair => pair.english.descent));
    const englishBaseline = Math.max(chineseHeight + 10 * scale + englishAscent, (name?.height || 0) - englishDescent);
    const columns = pairs.map(({ chinese, english }) => ({
      width: Math.max(chinese.width, english.width),
      text: [{ ...chinese, top: 0 }, { ...english, top: englishBaseline - english.ascent }],
    }));
    if (name) columns.splice(1, 0, { width: name.width, text: [{ ...name, top: 0 }] });
    return { columns, height: englishBaseline + englishDescent };
  }

  function makeArrow(group, left, top, size) {
    const direction = group.direction;
    const icon = global.SignDirections.icon(direction);
    return {
      tag: 'svg',
      attributes: {
        x: left, y: top, width: size, height: size, viewBox: icon.vb,
        'data-role': 'direction-arrow', 'data-direction': direction,
      },
      markup: icon.body.replaceAll('fill="black"', 'fill="' + inkColor + '"'),
      bounds: { left, top, width: size, height: size },
      element: { key: 'arrow:' + group.identifier, kind: 'arrow', identifier: group.identifier },
    };
  }

  function measureLabel(group, measure, scale, arrowBesideText) {
    const { columns, height: textHeight } = label(group.lines, measure, scale);
    const gap = 8 * scale;
    const width = columns.reduce((total, column) => total + column.width, 0) + gap * (columns.length - 1);
    const arrowSize = arrowBesideText ? 78 * scale : 0;
    const arrowGap = arrowBesideText ? 14 * scale : 0;
    return { columns, gap, width, textHeight, arrowSize, arrowGap };
  }

  function fitLabel(group, measure, height, arrowBesideText) {
    const { width, textHeight, arrowSize, arrowGap } = measureLabel(group, measure, 1, arrowBesideText);
    const maximumWidth = arrowBesideText ? 600 : 696;
    return Math.min(height / Math.max(textHeight, arrowSize), maximumWidth / (width + arrowSize + arrowGap));
  }

  function addLabel(nodes, group, measure, center, scale, arrowBesideText = false) {
    const { columns, gap, width, textHeight, arrowSize, arrowGap } = measureLabel(group, measure, scale, arrowBesideText);
    const arrowSpace = arrowSize + arrowGap;
    const arrowFirst = group.arrowPosition === 'left';
    const totalWidth = width + arrowSpace;
    const sideMargin = 52;
    const left = group.alignment === 'left' ? sideMargin : group.alignment === 'right' ? designWidth - sideMargin - totalWidth
      : (designWidth - totalWidth) / 2;
    let columnLeft = left + (arrowFirst ? arrowSpace : 0);
    const element = { key: 'label:' + group.identifier, kind: 'label', identifier: group.identifier };
    for (const column of columns) {
      for (const item of column.text) {
        const textTop = center - textHeight / 2 + item.top;
        const textLeft = group.alignment === 'right' ? columnLeft + column.width - item.width : columnLeft;
        nodes.push({
          tag: 'text',
          text: item.text,
          attributes: {
            x: textLeft + item.leftBearing, y: textTop + item.ascent,
            'font-family': item.family, 'font-weight': item.weight, 'font-size': item.size,
            fill: inkColor, 'data-role': item.role,
          },
          bounds: { left: textLeft, top: textTop, width: item.width, height: item.height },
          element,
        });
      }
      columnLeft += column.width + gap;
    }
    if (arrowSize) {
      const arrowLeft = arrowFirst ? left : left + width + arrowGap;
      nodes.push(makeArrow(group, arrowLeft, center - arrowSize / 2, arrowSize));
    }
  }

  function layout(project, measure) {
    const state = global.TransferState;
    const groups = state.groups(project);
    const separate = project.mode === 'separate';
    const lineCount = groups.reduce((total, group) => total + group.lines.length, 0);
    const sharedBands = !separate && lineCount === 2;
    const threeLines = lineCount === 3;
    const firstBandTop = threeLines ? 100 : sharedBands ? 336 : 400;
    const bandHeight = threeLines ? 110 : sharedBands ? 112 : 104;
    const lineGap = threeLines ? 26 : 32;
    const width = state.board(project).width;
    const height = Math.round(width * designHeight / designWidth);
    const nodes = [{ tag: 'rect', attributes: { x: 0, y: 0, width: designWidth, height: designHeight, fill: '#FFFFFF' } }];
    const linePatterns = [];
    const groupEnds = [];
    let bandTop = firstBandTop;
    for (const group of groups) {
      if (threeLines && group.identifier === 'lower') bandTop = 636 - (group.lines.length - 1) * (bandHeight + lineGap);
      for (const line of group.lines) {
        const attributes = {
          x: 0, y: bandTop, width: designWidth, height: bandHeight,
          fill: line.color, 'data-role': 'line-band', 'data-line': line.identifier, 'data-group': group.identifier,
        };
        const pattern = patterns.bandMetrics(line, line.linePattern, { [nodes.length]: bandHeight }, width / designWidth);
        if (pattern) linePatterns.push(pattern);
        nodes.push({ tag: 'rect', attributes, bounds: { left: 0, top: bandTop, width: designWidth, height: bandHeight },
          element: { key: 'line:' + line.identifier, kind: 'line', identifier: line.identifier } });
        bandTop += bandHeight + lineGap;
      }
      groupEnds.push(bandTop - lineGap);
    }
    if (separate) {
      const scales = groups.map(group => fitLabel(group, measure, 128, true));
      const ordinaryNumbers = groups.every(group => group.lines.every(line => /^[0-9]{1,3}$/.test(line.line)));
      const commonScale = ordinaryNumbers ? Math.min(...scales) : Infinity;
      groups.forEach((group, index) => {
        const upper = group.identifier === 'upper';
        const center = !threeLines && upper ? firstBandTop - 96 : groupEnds[index] + (threeLines ? 90 : 96);
        addLabel(nodes, group, measure, center, Math.min(scales[index], commonScale), true);
      });
    } else {
      const group = groups[0];
      const arrowSize = 232;
      nodes.push(makeArrow(group, (designWidth - arrowSize) / 2, 180 - arrowSize / 2, arrowSize));
      const captionHeight = sharedBands ? 144 : 176;
      addLabel(nodes, group, measure, sharedBands ? 704 : 620, fitLabel(group, measure, captionHeight));
    }
    const usedFonts = { zh400: true, num400: nodes.some(node => node.attributes['data-role'] === 'line-number') };
    return { width, height, nodes, elements: selectionBounds(nodes), patterns: linePatterns, usedFonts };
  }

  function selectionBounds(nodes) {
    const elements = new Map();
    for (const { element, bounds } of nodes) {
      if (!element) continue;
      const previous = elements.get(element.key);
      if (!previous) {
        elements.set(element.key, { ...element, bounds });
        continue;
      }
      const left = Math.min(previous.bounds.left, bounds.left);
      const top = Math.min(previous.bounds.top, bounds.top);
      const right = Math.max(previous.bounds.left + previous.bounds.width, bounds.left + bounds.width);
      const bottom = Math.max(previous.bounds.top + previous.bounds.height, bounds.top + bounds.height);
      previous.bounds = { left, top, width: right - left, height: bottom - top };
    }
    return Array.from(elements.values());
  }

  function shape(tag, attributes) {
    const element = document.createElementNS(core.SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  }

  function draw(vector, scene, clean = false) {
    vector.replaceChildren();
    vector.setAttribute('width', scene.width);
    vector.setAttribute('height', scene.height);
    vector.setAttribute('viewBox', '0 0 ' + designWidth + ' ' + designHeight);
    const fills = Object.assign({}, ...scene.patterns.map(pattern => patterns.draw(vector, pattern)));
    scene.nodes.forEach(({ tag, attributes, text, markup }, index) => {
      const exportAttributes = { ...attributes };
      if (clean) {
        delete exportAttributes['data-role'];
        delete exportAttributes['data-line'];
        delete exportAttributes['data-group'];
        delete exportAttributes['data-direction'];
      }
      const element = shape(tag, exportAttributes);
      if (text) element.textContent = text;
      if (markup) element.innerHTML = markup;
      vector.append(element);
      if (fills[index]) {
        const pattern = element.cloneNode();
        pattern.setAttribute('fill', fills[index]);
        if (!clean) pattern.setAttribute('data-role', 'line-pattern');
        vector.append(pattern);
      }
    });
    if (clean) return;
    for (const element of scene.elements) {
      const { left, top, width, height } = element.bounds;
      const padding = element.kind === 'line' ? 0 : 5;
      vector.append(shape('rect', {
        x: left - padding, y: top - padding, width: width + 2 * padding, height: height + 2 * padding,
        class: 'transfer-hit-target', 'vector-effect': 'non-scaling-stroke',
        'data-transfer-element': element.key, tabindex: 0, role: 'button', 'aria-pressed': false,
      }));
    }
  }

  function exportVector(scene, fontData) {
    const vector = shape('svg', {});
    draw(vector, scene, true);
    const style = shape('style', {});
    style.textContent = global.SignExporters.buildFontCSS(scene.usedFonts, fontData);
    vector.prepend(style);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(vector);
  }

  global.TransferRender = { layout, draw, exportVector };
})(typeof window !== 'undefined' ? window : globalThis);
