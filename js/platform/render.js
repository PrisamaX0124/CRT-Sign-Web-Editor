/** Pure metrics produce a scene; draw only consumes that scene, including text baselines. */
(function (global) {
  'use strict';
  var Core = global.SignCore;
  function metrics(state, measure) {
    var scene = state.mode === 'vertical' ? global.PlatformVertical.metrics(state, measure) : global.PlatformHanging.metrics(state, measure);
    var patterns = global.PlatformPatterns && global.PlatformPatterns.metrics(state, scene);
    if (patterns) scene.patterns = patterns;
    return scene;
  }
  function draw(svg, scene, options) {
    svg.replaceChildren();
    svg.setAttribute('viewBox', '0 0 ' + scene.output.width + ' ' + scene.output.height);
    svg.setAttribute('width', scene.output.width); svg.setAttribute('height', scene.output.height);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    var background = document.createElementNS(Core.SVG_NS, 'rect');
    background.setAttribute('width', scene.output.width); background.setAttribute('height', scene.output.height); background.setAttribute('fill', scene.background);
    svg.appendChild(background);
    var patternFills = scene.patterns && global.PlatformPatterns.draw(svg, scene.patterns);
    var group = document.createElementNS(Core.SVG_NS, 'g');
    group.setAttribute('transform', 'translate(' + scene.frame.x + ' ' + scene.frame.y + ') scale(' + scene.frame.scale + ')');
    group.setAttribute('class', 'platform-art');
    svg.appendChild(group);
    scene.nodes.forEach(function (n, index) {
      var el = document.createElementNS(Core.SVG_NS, n.tag);
      Object.keys(n.attrs).forEach(function (key) { el.setAttribute(key, n.attrs[key]); });
      if (n.text !== undefined) el.textContent = n.text;
      group.appendChild(el);
      if (patternFills && patternFills[index]) {
        // 整条底色先铺实，重复的小块之间才不会露出牌面背景。
        var overlay = el.cloneNode(false);
        ['data-role', 'data-element-key', 'data-station-id'].forEach(function (key) { overlay.removeAttribute(key); });
        overlay.setAttribute('fill', patternFills[index]);
        overlay.setAttribute('pointer-events', 'none');
        group.appendChild(overlay);
      }
    });
    // Rotated labels and transfer branches can make adjacent group boxes overlap.
    // Shapes receive their own pointer events; only text needs a full ink hit area.
    if (!(options && options.clean)) scene.nodes.filter(function (n) { return n.bounds && n.attrs['data-element-key']; }).forEach(function (n) {
      var hit = document.createElementNS(Core.SVG_NS, 'rect'), box = n.bounds;
      hit.setAttribute('x', box.x); hit.setAttribute('y', box.y); hit.setAttribute('width', box.width); hit.setAttribute('height', box.height);
      hit.setAttribute('fill', 'transparent'); hit.setAttribute('class', 'platform-hitbox'); hit.setAttribute('data-element-key', n.attrs['data-element-key']);
      if (n.attrs.transform) hit.setAttribute('transform', n.attrs.transform);
      if (n.attrs['data-station-id']) hit.setAttribute('data-station-id', n.attrs['data-station-id']);
      group.appendChild(hit);
    });
    return scene;
  }
  global.PlatformRender = { metrics: metrics, draw: draw };
})(typeof window !== 'undefined' ? window : globalThis);
