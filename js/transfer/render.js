(function (global) {
  'use strict';

  const core = global.SignCore;
  const patterns = global.PlatformPatterns;
  const designWidth = 768;
  const designHeight = 1024;
  const inkColor = '#161616';
  const chineseCaptionSize = 51;
  const englishCaptionSize = 29;
  const enlargedNameGap = 14;

  function box(text, role, family, size, measure) {
    const weight = 400;
    const ink = measure.ink(text, family, weight, size);
    const ascent = measure.ascent(text, family, weight, size);
    const descent = measure.descent(text, family, weight, size);
    return {
      text, role, family, weight, size, ascent, descent, leftBearing: ink.abl,
      width: Math.max(0, ink.abl + ink.abr), height: ascent + descent,
    };
  }

  function captionColumn(chinese, english, gapBefore, measure, scale) {
    return {
      gapBefore,
      main: box(chinese, 'label-chinese', core.FONT_ZH, chineseCaptionSize * scale, measure),
      english: box(english, 'label-english', core.FONT_EN, englishCaptionSize * scale, measure),
    };
  }

  function numberColumns(number, measure, scale) {
    return [
      { gapBefore: 8 * scale, main: box(number, 'line-number', core.FONT_NUM, 116 * scale, measure) },
      captionColumn('号线', 'Line', (number === '1' ? 12 : 8) * scale, measure, scale),
    ];
  }

  function namedColumns(line, measure, scale) {
    const name = line.line;
    const enlarged = line.largeName && Boolean(name);
    const gapBefore = (enlarged ? enlargedNameGap : 8) * scale;
    const splitSuffix = enlarged && name.length > 1 && name.endsWith('线');
    const english = line.englishName
      ? box(line.englishName, 'line-english-name', core.FONT_EN, englishCaptionSize * scale, measure) : null;
    const main = name
      ? box(splitSuffix ? name.slice(0, -1) : name, 'line-name', core.FONT_ZH, (enlarged ? 116 : chineseCaptionSize) * scale, measure)
      : null;
    if (!splitSuffix) return [{ gapBefore, main, english, enlarged }];
    return [
      { gapBefore, main, enlarged },
      { gapBefore, main: box('线', 'line-name-suffix', core.FONT_ZH, chineseCaptionSize * scale, measure), english },
    ];
  }

  function label(lines, measure, scale) {
    const columns = [captionColumn('换乘', 'Transfer', 0, measure, scale)];
    const visibleLines = lines.filter(line => line.line || line.englishName);
    if (visibleLines.length && visibleLines.every(line => line.number)) {
      columns.push(...numberColumns(visibleLines.map(line => line.number).join('/'), measure, scale));
    } else {
      visibleLines.forEach((line, index) => {
        if (index) {
          const gapBefore = (columns.at(-1).enlarged ? enlargedNameGap : 8) * scale;
          columns.push({ gapBefore, main: box('/', 'line-separator', core.FONT_ZH, chineseCaptionSize * scale, measure) });
        }
        columns.push(...(line.number ? numberColumns(line.number, measure, scale) : namedColumns(line, measure, scale)));
      });
    }

    const pairs = columns.filter(column => column.english && !column.enlarged);
    const pairedHeight = Math.max(...pairs.map(column => column.main?.height || 0));
    const tallestText = Math.max(...columns.map(column => column.main?.height || 0));
    const englishAscent = Math.max(...pairs.map(column => column.english.ascent));
    const englishDescent = Math.max(...pairs.map(column => column.english.descent));
    const rowGap = 10 * scale;
    // 大字可以伸到英文一行的下方，给旁边的小字留出正常行距。
    const captionBaseline = pairedHeight + rowGap + englishAscent;
    const englishBaseline = columns.some(column => column.enlarged)
      ? captionBaseline : Math.max(captionBaseline, tallestText - englishDescent);
    const positionedColumns = columns.map(({ gapBefore, main, english, enlarged }) => {
      const englishTop = enlarged ? main.height + rowGap : englishBaseline - (english?.ascent || 0);
      return {
        gapBefore,
        width: Math.max(main?.width || 0, english?.width || 0),
        text: [main && { ...main, top: 0 }, english && { ...english, top: englishTop }].filter(Boolean),
      };
    });
    const height = Math.max(...positionedColumns.flatMap(column => column.text.map(item => item.top + item.height)));
    return { columns: positionedColumns, height };
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
    const width = columns.reduce((total, column) => total + column.gapBefore + column.width, 0);
    const arrowSize = arrowBesideText ? 78 * scale : 0;
    const arrowGap = arrowBesideText ? 14 * scale : 0;
    return { columns, width, textHeight, arrowSize, arrowGap };
  }

  function fitLabel(group, measure, height, arrowBesideText) {
    const { width, textHeight, arrowSize, arrowGap } = measureLabel(group, measure, 1, arrowBesideText);
    const maximumWidth = arrowBesideText ? 600 : 696;
    return Math.min(height / Math.max(textHeight, arrowSize), maximumWidth / (width + arrowSize + arrowGap));
  }

  function addLabel(nodes, group, measure, center, scale, arrowBesideText = false) {
    const { columns, width, textHeight, arrowSize, arrowGap } = measureLabel(group, measure, scale, arrowBesideText);
    const arrowSpace = arrowSize + arrowGap;
    const arrowFirst = group.arrowPosition === 'left';
    const totalWidth = width + arrowSpace;
    const sideMargin = 52;
    const left = group.alignment === 'left' ? sideMargin : group.alignment === 'right' ? designWidth - sideMargin - totalWidth
      : (designWidth - totalWidth) / 2;
    let columnLeft = left + (arrowFirst ? arrowSpace : 0);
    const element = { key: 'label:' + group.identifier, kind: 'label', identifier: group.identifier };
    for (const column of columns) {
      columnLeft += column.gapBefore;
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
      columnLeft += column.width;
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
    const bandHeight = threeLines ? 110 : sharedBands ? 112 : 104;
    const lineGap = threeLines ? 26 : 32;
    const width = state.board(project).width;
    const height = Math.round(width * designHeight / designWidth);
    const nodes = [{ tag: 'rect', attributes: { x: 0, y: 0, width: designWidth, height: designHeight, fill: '#FFFFFF' } }];
    const linePatterns = [];
    const groupEnds = [];
    let bandTop = groups.length === 2 ? 100 : sharedBands ? 336 : 400;
    for (const group of groups) {
      if (group.identifier === 'lower') bandTop = 636 - (group.lines.length - 1) * (bandHeight + lineGap);
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
      const ordinaryNumbers = groups.every(group => group.lines.every(line => line.number && line.number.length <= 3));
      const commonScale = ordinaryNumbers ? Math.min(...scales) : Infinity;
      const labelOffset = threeLines ? 90 : 96;
      groups.forEach((group, index) => {
        addLabel(nodes, group, measure, groupEnds[index] + labelOffset, Math.min(scales[index], commonScale), true);
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
    const graphics = new Map();
    const counts = new Map();
    function track(node, key, bounds, kind, content) {
      if (clean) return;
      const count = counts.get(key) || 0;
      counts.set(key, count + 1);
      graphics.set(key + ':' + count, { node, bounds, kind, content });
    }
    scene.nodes.forEach(({ tag, attributes, text, markup, element: target, bounds }, index) => {
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
      if (target) track(element, target.key + ':' + attributes['data-role'], bounds, target.kind, text);
      if (fills[index]) {
        const pattern = element.cloneNode();
        pattern.setAttribute('fill', fills[index]);
        if (!clean) pattern.setAttribute('data-role', 'line-pattern');
        vector.append(pattern);
        track(pattern, target.key + ':line-pattern', bounds, target.kind);
      }
    });
    if (clean) return;
    for (const element of scene.elements) {
      const { left, top, width, height } = element.bounds;
      const padding = element.kind === 'line' ? 0 : 5;
      const target = shape('rect', {
        x: left - padding, y: top - padding, width: width + 2 * padding, height: height + 2 * padding,
        class: 'transfer-hit-target', 'vector-effect': 'non-scaling-stroke',
        'data-transfer-element': element.key, tabindex: 0, role: 'button', 'aria-pressed': false,
      });
      vector.append(target);
      track(target, element.key + ':hit-area', { left: left - padding, top: top - padding, width: width + 2 * padding, height: height + 2 * padding }, element.kind);
    }
    return graphics;
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
