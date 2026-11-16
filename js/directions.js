(function (global) {
  'use strict';

  const clockwiseDirections = ['up', 'right-up', 'right', 'right-down', 'down', 'left-down', 'left', 'left-up'];
  // 原图的斜向路径偏向一角，右侧和下侧的路径还略微超出原绘制范围。
  const diagonalViewBoxes = {
    arrow_left_up: '-4.33 -4.33 56 56',
    arrow_right_up: '4.67 -4.33 56 56',
    arrow_right_down: '4.67 4.67 56 56',
    arrow_left_down: '-4.33 4.67 56 56',
  };

  function identifier(direction) {
    return 'arrow_' + direction.replaceAll('-', '_');
  }

  function iconForIdentifier(iconIdentifier) {
    const source = global.SignIcons.get(iconIdentifier);
    return Object.hasOwn(diagonalViewBoxes, iconIdentifier)
      ? { ...source, vb: diagonalViewBoxes[iconIdentifier] }
      : source;
  }

  function icon(direction) {
    return iconForIdentifier(identifier(direction));
  }

  function canTurn(direction) {
    return clockwiseDirections.includes(direction);
  }

  function turn(direction, step) {
    const index = clockwiseDirections.indexOf(direction);
    if (index === -1) return undefined;
    return clockwiseDirections[(index + step + clockwiseDirections.length) % clockwiseDirections.length];
  }

  const items = Object.freeze([
    'up', 'down', 'left', 'right',
    'left-up', 'right-up', 'right-down', 'left-down',
    'ahead-left', 'ahead-right', 'back-left', 'back-right',
  ].map(direction => Object.freeze({ type: 'icon', icon: identifier(direction), name: icon(direction).name, direction })));
  const names = Object.freeze(Object.fromEntries(items.map(item => [item.direction, item.name])));

  global.SignDirections = { items, names, identifier, icon, iconForIdentifier, canTurn, turn };
})(typeof window !== 'undefined' ? window : globalThis);
