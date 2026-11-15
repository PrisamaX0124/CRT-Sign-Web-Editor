(function (global) {
  'use strict';

  const core = global.SignCore;
  const patterns = global.PlatformPatterns;
  const directions = global.SignDirections.names;
  const modeNames = Object.freeze({
    guidance: '版式 A',
    separate: '版式 B',
  });
  const arrangements = {
    guidance: { '1': [1], '2': [2] },
    separate: { '1': [1], '1+1': [1, 1], '1+2': [1, 2], '2+1': [2, 1] },
  };
  const defaultArrangements = { guidance: '2', separate: '1+1' };
  const defaultDirections = { guidance: { upper: 'up' }, separate: { upper: 'left', lower: 'right' } };
  const alignmentNames = Object.freeze({ left: '左对齐', center: '居中', right: '右对齐' });
  const arrowPositionNames = Object.freeze({ left: '箭头在左', right: '箭头在右' });
  const defaultAlignments = {
    '1+1': { upper: 'center', lower: 'center' },
    '1+2': { upper: 'left', lower: 'right' },
    '2+1': { upper: 'left', lower: 'right' },
  };
  const defaultArrowPositions = { upper: 'left', lower: 'right' };
  const minimumWidth = 192;
  const maximumWidth = 6144;
  const defaultLines = [
    { identifier: 'first', name: '1' },
    { identifier: 'second', name: '10' },
    { identifier: 'third', name: '6' },
  ];

  function lineName(name) {
    return name.normalize('NFKC').trim().replace(/^([0-9]+)\s*号线$/, '$1');
  }

  function choice(value, options, fallback) {
    return typeof value === 'string' && Object.hasOwn(options, value) ? value : fallback;
  }

  function cleanLine(value, fallback, city) {
    const saved = value || {};
    const name = typeof saved.name === 'string'
      ? Array.from(saved.name.replace(/[\u0000-\u001f]/g, '')).slice(0, 40).join('')
      : fallback.name;
    return {
      identifier: fallback.identifier,
      name,
      color: core.normalizeHex(saved.color) || core.lineColorFor(lineName(name), city)?.bg || '#424A52',
      linePattern: patterns.settings(saved.linePattern),
    };
  }

  function cleanGroupSettings(saved, defaults, options) {
    return Object.fromEntries(Object.entries(defaults).map(([arrangement, groups]) => [
      arrangement, Object.fromEntries(Object.entries(groups).map(([group, fallback]) => [
        group, choice(saved?.[arrangement]?.[group], options, fallback),
      ])),
    ]));
  }

  function defaultArrowPosition(direction, group) {
    if (direction.includes('left')) return 'left';
    if (direction.includes('right')) return 'right';
    return defaultArrowPositions[group];
  }

  function cleanBoard(mode, value = {}) {
    const city = core.isPalette(value.city) ? value.city : 'chongqing';
    const groupDirections = Object.fromEntries(Object.entries(defaultDirections[mode]).map(([group, direction]) =>
      [group, choice(value.directions?.[group], directions, direction)],
    ));
    const current = {
      arrangement: choice(value.arrangement, arrangements[mode], defaultArrangements[mode]),
      width: Number.isFinite(value.width) ? Math.round(core.clamp(value.width, minimumWidth, maximumWidth)) : 768,
      city,
      directions: groupDirections,
      lines: defaultLines.slice(0, mode === 'guidance' ? 2 : 3)
        .map((line, index) => cleanLine(value.lines?.[index], line, city)),
    };
    if (mode === 'separate') {
      current.alignments = cleanGroupSettings(value.alignments, defaultAlignments, alignmentNames);
      current.arrowPositions = cleanGroupSettings(value.arrowPositions, {
        '1+1': {
          upper: defaultArrowPosition(groupDirections.upper, 'upper'),
          lower: defaultArrowPosition(groupDirections.lower, 'lower'),
        },
        '1+2': defaultArrowPositions,
        '2+1': defaultArrowPositions,
      }, arrowPositionNames);
    }
    return current;
  }

  function create() {
    return cleanProject({});
  }

  function board(project) {
    return project.boards[project.mode];
  }

  function replaceBoard(project, current) {
    return { ...project, boards: { ...project.boards, [project.mode]: current } };
  }

  function cleanProject(value) {
    return {
      kind: 'transfer-sign',
      version: 2,
      mode: choice(value.mode, modeNames, 'guidance'),
      boards: {
        guidance: cleanBoard('guidance', value.boards?.guidance || {}),
        separate: cleanBoard('separate', value.boards?.separate || {}),
      },
    };
  }

  function settings(project, changes) {
    const { mode, ...boardChanges } = changes;
    const selected = choice(mode, modeNames, project.mode);
    const nextProject = selected === project.mode ? project : { ...project, mode: selected };
    if (!Object.keys(boardChanges).length) return nextProject;
    const previous = board(nextProject);
    const next = cleanBoard(selected, { ...previous, ...boardChanges });
    next.lines = next.city === previous.city ? previous.lines : previous.lines.map(line => ({
        ...line, color: core.lineColorFor(lineName(line.name), next.city)?.bg || line.color,
    }));
    return replaceBoard(nextProject, next);
  }

  function changeLine(project, identifier, changes) {
    const current = board(project);
    const index = current.lines.findIndex(line => line.identifier === identifier);
    if (index < 0) return project;
    const previous = current.lines[index];
    const line = cleanLine({ ...previous, ...changes }, defaultLines[index], current.city);
    if (lineName(previous.name) !== lineName(line.name) && !Object.hasOwn(changes, 'color')) {
      line.color = core.lineColorFor(lineName(line.name), current.city)?.bg || line.color;
    }
    const lines = current.lines.slice();
    lines[index] = line;
    return replaceBoard(project, { ...current, lines });
  }

  function changeDirection(project, group, direction) {
    const current = board(project);
    if (!choice(group, current.directions, null) || !choice(direction, directions, null)) return project;
    return replaceBoard(project, { ...current, directions: { ...current.directions, [group]: direction } });
  }

  function changeGroupSetting(project, field, group, value, options) {
    const current = board(project);
    const arrangement = current.arrangement;
    const settings = current[field];
    const previous = settings?.[arrangement];
    if (!previous || !choice(group, previous, null) || !choice(value, options, null) || previous[group] === value) return project;
    return replaceBoard(project, {
      ...current, [field]: { ...settings, [arrangement]: { ...previous, [group]: value } },
    });
  }

  function changeAlignment(project, group, alignment) {
    return changeGroupSetting(project, 'alignments', group, alignment, alignmentNames);
  }

  function changeArrowPosition(project, group, position) {
    return changeGroupSetting(project, 'arrowPositions', group, position, arrowPositionNames);
  }

  function displayLine(project, line) {
    return { ...line, line: lineName(line.name), city: board(project).city };
  }

  function groups(project) {
    const current = board(project);
    let start = 0;
    return arrangements[project.mode][current.arrangement].map((count, index) => {
      const identifier = index === 0 ? 'upper' : 'lower';
      const lines = current.lines.slice(start, start + count).map(line => displayLine(project, line));
      start += count;
      const direction = current.directions[identifier];
      return { identifier, direction, alignment: current.alignments?.[current.arrangement]?.[identifier],
        arrowPosition: current.arrowPositions?.[current.arrangement]?.[identifier] ?? defaultArrowPosition(direction, identifier),
        lines };
    });
  }

  function deserialize(source) {
    const value = JSON.parse(source);
    if (value?.kind !== 'transfer-sign' || ![1, 2].includes(value.version)) {
      throw new Error('无法读取换乘标识项目');
    }
    if (value.version === 2) return cleanProject(value);
    const lines = [0, 1].map(index => ({ ...value.lines?.[index], linePattern: value.linePattern }));
    return cleanProject({
      mode: value.mode,
      boards: {
        guidance: { ...value, lines, arrangement: value.lineCount === 1 ? '1' : '2', directions: { upper: value.direction } },
        separate: { ...value, lines, arrangement: value.lineCount === 1 ? '1' : '1+1',
          directions: { upper: value.lines?.[0]?.direction, lower: value.lines?.[1]?.direction } },
      },
    });
  }

  global.TransferState = {
    create, board, replaceBoard, settings, changeLine, changeDirection, changeAlignment, changeArrowPosition,
    displayLine, groups, deserialize, serialize: JSON.stringify,
    arrangements, directions, alignmentNames, arrowPositionNames, modeNames, minimumWidth, maximumWidth,
  };
})(typeof window !== 'undefined' ? window : globalThis);
