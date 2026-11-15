(function (global) {
  'use strict';

  function identifier(direction) {
    return 'arrow_' + direction.replaceAll('-', '_');
  }

  function icon(direction) {
    return global.SignIcons.get(identifier(direction));
  }

  const items = Object.freeze([
    'up', 'down', 'left', 'right',
    'left-up', 'right-up', 'right-down', 'left-down',
    'ahead-left', 'ahead-right', 'back-left', 'back-right',
  ].map(direction => Object.freeze({ type: 'icon', icon: identifier(direction), name: icon(direction).name, direction })));
  const names = Object.freeze(Object.fromEntries(items.map(item => [item.direction, item.name])));

  global.SignDirections = { items, names, icon };
})(typeof window !== 'undefined' ? window : globalThis);
