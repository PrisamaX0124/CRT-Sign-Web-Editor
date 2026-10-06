/** Hanging signs use the requested pixel rectangle directly. All text uses measured ink. */
(function (global) {
  'use strict';
  var Core = global.SignCore, State = global.PlatformState;
  function metrics(state, measure) {
    if (state.mode === 'route') return global.PlatformRoute.metrics(state, measure);
    var size = state.sizes[state.mode], W = size.width, H = size.height, nodes = [], elements = [], context = null;
    var color = state.color, background = state.background, muted = state.muted, pad = H * .04;
    function ink(value, family, weight, fontSize) {
      var m = measure.ink(value, family, weight, fontSize), ascent = measure.ascent(value, family, weight, fontSize), descent = measure.descent(value, family, weight, fontSize);
      return { abl: m.abl, width: m.abl + m.abr, ascent: ascent, height: ascent + descent, size: fontSize };
    }
    function push(tag, attrs, value, bounds) {
      if (context) { attrs['data-element-key'] = context.key; if (context.stationId) attrs['data-station-id'] = context.stationId; }
      var n = { tag: tag, attrs: attrs };
      if (value !== undefined) { n.text = value; n.bounds = bounds; }
      nodes.push(n); return n;
    }
    function rect(x, y, width, height, fill, role) { push('rect', { x: x, y: y, width: width, height: height, fill: fill, 'data-role': role || 'shape' }); }
    function circle(x, y, radius, fill, stroke, sw, role) { push('circle', { cx: x, cy: y, r: radius, fill: fill, stroke: stroke || 'none', 'stroke-width': sw || 0, 'data-role': role || 'shape' }); }
    function line(x1, y1, x2, y2, fill, sw, role) { push('line', { x1: x1, y1: y1, x2: x2, y2: y2, stroke: fill, 'stroke-width': sw, 'data-role': role || 'shape' }); }
    function polygon(points, fill, role, opacity) { push('polygon', { points: points.map(function (p) { return p.join(','); }).join(' '), fill: fill, opacity: opacity === undefined ? 1 : opacity, 'data-role': role || 'shape' }); }
    function fitText(value, fontSize, maxWidth, maxHeight, family, weight) {
      var m;
      for (var i = 0; i < 8; i++) {
        m = ink(value, family, weight, fontSize);
        var factor = Math.min(1, maxWidth / Math.max(.001, m.width), maxHeight / Math.max(.001, m.height));
        if (factor >= .9999) break;
        fontSize *= factor * .995;
      }
      return ink(value, family, weight, fontSize);
    }
    function text(value, left, top, m, fill, family, weight, maxWidth, transform, role) {
      if (!value) return;
      var attrs = { x: left + m.abl, y: top + m.ascent, fill: fill, 'font-size': m.size, 'font-family': family, 'font-weight': weight, 'data-role': role || 'text' };
      if (transform) attrs.transform = transform;
      push('text', attrs, value, { x: left, y: top, width: m.width, height: m.height, maxWidth: maxWidth });
    }
    function centered(value, x, y, fontSize, maxWidth, maxHeight, fill, role) {
      if (!value) return;
      var family=/^\d+$/.test(value)?Core.FONT_NUM:Core.FONT_ZH;
      var m = fitText(value, fontSize, maxWidth, maxHeight, family, 400);
      text(value, x - m.width / 2, y - m.height / 2, m, fill, family, 400, maxWidth, null, role);
    }
    function bilingualMetrics(s, unit, spec, maxWidth, maxHeight) {
      // Reference ink heights and bilingual gaps come from 吊板_本站左行.svg.
      // spec: Chinese/English sizes, their ink height limits, then bilingual gap.
      // Fit each language independently; a long English name must not shrink Chinese.
      var z = s.zh ? fitText(s.zh,spec[0]*unit*state.fontScale,maxWidth,spec[2]*unit*state.fontScale,Core.FONT_ZH,400) : null;
      var e = s.en ? fitText(s.en,spec[1]*unit*state.fontScale,maxWidth,spec[3]*unit*state.fontScale,Core.FONT_EN,400) : null;
      var gap = z && e ? spec[4]*unit : 0;
      for (var i = 0; i < 5; i++) {
        var lines = (z ? z.height : 0)+(e ? e.height : 0), factor = Math.min(1,(maxHeight-gap)/Math.max(.001,lines));
        if (factor >= .9999) break;
        if (z) z=ink(s.zh,Core.FONT_ZH,400,z.size*factor*.999);
        if (e) e=ink(s.en,Core.FONT_EN,400,e.size*factor*.999);
      }
      return { zh:z,en:e,gap:gap,width:Math.max(z?z.width:0,e?e.width:0),height:(z?z.height:0)+gap+(e?e.height:0),maxWidth:maxWidth,weight:400 };
    }
    function bilingual(s, x, top, m, fill, anchor, transform) {
      function left(line) { return x - (anchor === 'center' ? line.width / 2 : anchor === 'right' ? line.width : 0); }
      if (m.zh) text(s.zh, left(m.zh), top, m.zh, fill, Core.FONT_ZH, m.weight, m.maxWidth, transform, 'name-zh');
      if (m.en) text(s.en, left(m.en), top + (m.zh ? m.zh.height + m.gap : 0), m.en, fill, Core.FONT_EN, 400, m.maxWidth, transform, 'name-en');
    }
    function boundsOf(n) {
      var a = n.attrs, b;
      if (n.bounds) b = n.bounds;
      else if (n.tag === 'circle') b = { x: a.cx - a.r - a['stroke-width'] / 2, y: a.cy - a.r - a['stroke-width'] / 2, width: 2 * a.r + a['stroke-width'], height: 2 * a.r + a['stroke-width'] };
      else if (n.tag === 'rect') b = a;
      else {
        var points = n.tag === 'line' ? [[a.x1, a.y1], [a.x2, a.y2]] : a.points.split(' ').map(function (p) { return p.split(',').map(Number); });
        var xs = points.map(function (p) { return p[0]; }), ys = points.map(function (p) { return p[1]; }), sw = (a['stroke-width'] || 0) / 2;
        b = { x: Math.min.apply(null, xs) - sw, y: Math.min.apply(null, ys) - sw, width: Math.max.apply(null, xs) - Math.min.apply(null, xs) + sw * 2, height: Math.max.apply(null, ys) - Math.min.apply(null, ys) + sw * 2 };
      }
      if (!a.transform) return b;
      var match = a.transform.match(/rotate\((-?[\d.]+) ([\d.-]+) ([\d.-]+)\)/);
      if (!match) return b;
      var angle = Number(match[1]) * Math.PI / 180, cx = Number(match[2]), cy = Number(match[3]), cos = Math.cos(angle), sin = Math.sin(angle);
      var corners = [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(function (p) { return [cx+(p[0]-cx)*cos-(p[1]-cy)*sin, cy+(p[0]-cx)*sin+(p[1]-cy)*cos]; });
      var xx = corners.map(function (p) { return p[0]; }), yy = corners.map(function (p) { return p[1]; });
      return { x: Math.min.apply(null,xx), y: Math.min.apply(null,yy), width: Math.max.apply(null,xx)-Math.min.apply(null,xx), height: Math.max.apply(null,yy)-Math.min.apply(null,yy) };
    }
    function begin(key, stationId, label, kind) { context = { key: key, stationId: stationId, label: label, kind: kind, start: nodes.length }; }
    function end() {
      var offset = state.adjustments[context.key] || { x: 0, y: 0 }, boxes = nodes.slice(context.start).map(boundsOf);
      if (boxes.length) {
        var x = Math.min.apply(null, boxes.map(function (b) { return b.x; })), y = Math.min.apply(null, boxes.map(function (b) { return b.y; }));
        var right = Math.max.apply(null, boxes.map(function (b) { return b.x + b.width; })), bottom = Math.max.apply(null, boxes.map(function (b) { return b.y + b.height; }));
        nodes.slice(context.start).forEach(function (n) { if (offset.x || offset.y) n.attrs.transform = 'translate(' + offset.x + ' ' + offset.y + ') ' + (n.attrs.transform || ''); });
        elements.push({ key: context.key, stationId: context.stationId, label: context.label, kind: context.kind, box: { x: x + offset.x, y: y + offset.y, width: right-x, height: bottom-y } });
      }
      context = null;
    }
    function badge(s, x, y, r) {
      var fg = Core.contrastTextColor(color);
      circle(x, y, r, color, background, H * .009, 'current-badge');
      line(x-r*.8, y, x+r*.8, y, fg, H*.003, 'badge-divider');
      if(/^\d+$/.test(state.line))centered(state.line, x, y-r*.45, r*1.02, r*1.6, r*.78, fg, 'badge-line');
      else {var bm=Core.badgeTextMetrics(state.line,measure,x,y,r);text(state.line,bm.x,bm.y,bm,fg,Core.FONT_ZH,400,bm.width,null,'badge-line');}
      centered(s.code, x, y+r*.45, r*.88, r*1.6, r*.78, fg, 'badge-code');
    }
    function lineBar(y, h, x, direction) {
      var left = H*.12, right = W-H*.06;
      rect(direction === -1 ? x : left,y,direction === -1 ? right-x : x-left,h,muted,'passed-line');
      if (direction === -1) polygon([[left,y+h],[left+h,y],[x,y],[x,y+h]],color,'active-line');
      else polygon([[x,y],[right-h,y],[right,y+h],[x,y+h]],color,'active-line');
    }
    rect(0,0,W,H,background,'background');
    var stationIds;
    {
      var routeSize=state.sizes.route, shared=global.PlatformRoute.layout(state,{width:routeSize.width*H/routeSize.height,height:H});
      var u=H/384;
      var near = State.neighbors(state), mid = W/2, radius = H*.128, y = shared.y+shared.barH/2;
      stationIds = [near.current.id];
      var title = bilingualMetrics(near.current,u,[64,36,59.6407,32.3824,16.3437],W-pad*4,108.3668*u);
      begin('station:title',near.current.id,'本站站名','station-name');
      bilingual(near.current,mid,22.2812*u,title,'#000000','center'); end();
      lineBar(shared.y,shared.barH,mid,state.direction);
      begin('station:badge',near.current.id,'线路号 / 本站编号','station-badge'); badge(near.current,mid,y,radius); end();
      // Keep the hint in the central column, with the reference's bottom margin.
      // Reserve that column even when hidden so toggling never moves other elements.
      var hintUnit=Math.min(u,W*.4/376.367),label={zh:'列车行驶方向',en:'Next Stations'};
      var labelMetrics=bilingualMetrics(label,hintUnit,[32,24,29.953,18.984,10.814],186.179*hintUnit,84*hintUnit);
      var arrowW=174.105*hintUnit,arrowH=46.281*hintUnit,gap=16.083*hintUnit,total=arrowW+gap+labelMetrics.width,x0=(W-total)/2;
      var hintHeight=Math.max(labelMetrics.height,arrowH+4.476*hintUnit),hintTop=H-22.897*u-hintHeight;
      var arrowX=state.direction===-1?x0:x0+labelMetrics.width+gap,labelX=state.direction===-1?x0+arrowW+gap:x0;
      var arrowTop=hintTop+(hintHeight-arrowH)/2+2.238*hintUnit;
      var left = state.direction === -1 ? near.next : near.previous, right = state.direction === 1 ? near.next : near.previous;
      var neighborTop=shared.y+shared.barH+17.055*u;
      [['left',left,W*166.1623/1024,state.direction === -1],['right',right,W*883.9865/1024,state.direction === 1]].forEach(function (item) {
        var s = item[1] || { zh:item[3] ? '终点站' : '始发站', en:item[3] ? 'Terminus' : 'First Station' };
        var available=item[0]==='left'?Math.min(item[2]-pad,x0-H*.025-item[2]):Math.min(W-pad-item[2],item[2]-x0-total-H*.025);
        var m = bilingualMetrics(s,u,[48,28,44.355,27.646,10.72],Math.max(1,2*available),H-22.897*u-neighborTop);
        begin('station:'+item[0],item[1] ? item[1].id : null,item[3] ? '下一站' : '上一站','neighbor');
        bilingual(s,item[2],neighborTop,m,item[3] ? color : muted,'center'); end();
      });
      if (state.showStationDirection !== false) {
        begin('station:direction',null,'列车行驶方向','direction');
        // Bold, closely nested chevrons with clear channels between the filled arms.
        // Keep a strong leading cluster and a shorter fade for a sense of forward motion.
        // Preserve the hint's envelope so neighboring labels and hit bounds stay aligned.
        var chevronW=44.105,chevronH=46.281,stroke=18,pitch=26,opacities=[1,.98,.86,.64,.38,.16];
        var chevron=[[chevronW,0],[chevronW-stroke,0],[0,chevronH/2],[chevronW-stroke,chevronH],[chevronW,chevronH],[stroke,chevronH/2]];
        opacities.forEach(function(opacity,j){polygon(chevron.map(function(p){var x=p[0]+j*pitch;return [arrowX+(state.direction===-1?x*hintUnit:arrowW-x*hintUnit),arrowTop+p[1]*hintUnit];}),color,'travel-chevron',opacity);});
        bilingual(label,labelX+(state.direction===1?labelMetrics.width:0),hintTop,labelMetrics,'#111111',state.direction===1?'right':'left'); end();
      }
    }
    var usedFonts = {};
    nodes.forEach(function (n) { if (n.tag !== 'text') return; if (n.attrs['font-family'] === Core.FONT_NUM) { usedFonts.num400 = true; if (/[^\x00-\x7F]/.test(n.text)) usedFonts.zh400 = true; } else usedFonts['zh'+n.attrs['font-weight']] = true; });
    return { width:W,height:H,output:size,background:background,frame:{scale:1,x:0,y:0},nodes:nodes,elements:elements,stationIds:stationIds,usedFonts:usedFonts };
  }
  global.PlatformHanging = { metrics:metrics };
})(typeof window !== 'undefined' ? window : globalThis);
