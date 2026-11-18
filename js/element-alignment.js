(function (global) {
  'use strict';

  const snapDistance = 6;

  function selectionBounds(boxes) {
    const left = Math.min(...boxes.map(box => box.x));
    const right = Math.max(...boxes.map(box => box.x + box.width));
    return { x: left, width: right - left };
  }

  function limitsWithinCanvas(boxes, canvasWidth) {
    let left = -Infinity;
    let right = Infinity;
    for (const box of boxes) {
      const start = -box.x;
      const end = canvasWidth - box.x - box.width;
      // 超宽元素需要保留尽可能多的可见部分，方便再次选中。
      left = Math.max(left, Math.min(start, end));
      right = Math.min(right, Math.max(start, end));
    }
    return left <= right ? { left, right } : { left: 0, right: 0 };
  }

  function alignMovement(moving, others, canvasWidth, movement, scale, limits, enabled) {
    const bounded = Math.max(limits.left, Math.min(limits.right, movement));
    let guide = null;
    let closest = snapDistance / scale;
    let alignedMovement = bounded;
    if (!enabled) return { distance: bounded, guide };

    function consider(start, target) {
      const aligned = target - start;
      const distance = Math.abs(aligned - bounded);
      // 拖回起点时，靠近参考线也应回到原位。
      if (movement === 0 && distance > 0) return;
      if (aligned < limits.left || aligned > limits.right || distance > closest || (guide !== null && distance === closest)) return;
      alignedMovement = aligned;
      closest = distance;
      guide = target;
    }

    const start = moving.x, end = start + moving.width, center = start + moving.width / 2;
    consider(center, canvasWidth / 2);
    consider(start, 0);
    consider(end, canvasWidth);
    for (const other of others) {
      const otherStart = other.x, otherEnd = otherStart + other.width;
      consider(center, otherStart + other.width / 2);
      consider(start, otherStart);
      consider(end, otherEnd);
      consider(start, otherEnd);
      consider(end, otherStart);
    }
    return { distance: alignedMovement, guide };
  }

  function create(options) {
    const { paper, graphic, toggle } = options;
    const preview = document.createElementNS(graphic.namespaceURI, 'svg');
    preview.classList.add('position-preview');
    preview.setAttribute('aria-hidden', 'true');
    preview.setAttribute('hidden', '');
    const guides = document.createElement('div');
    guides.className = 'alignment-guides';
    guides.setAttribute('aria-hidden', 'true');
    const guide = document.createElement('div');
    guide.className = 'alignment-guide-vertical';
    guide.hidden = true;
    guides.append(guide);
    paper.append(preview, guides);

    let session = null;
    let frame = null;
    let enabled = toggle.getAttribute('aria-pressed') === 'true';
    let guidePosition = null;
    let guideAnimation;

    function showGuide(position, width) {
      if (position === guidePosition) return;
      guidePosition = position;
      const previous = guideAnimation;
      const opacity = guide.hidden ? 0 : Number(global.getComputedStyle(guide).opacity);
      previous?.cancel();
      if (position === null) {
        const fade = guideAnimation = global.EditorMotion.play(guide, [{ opacity }, { opacity: 0 }], 'dismiss');
        if (!fade) { guide.hidden = true; return; }
        fade.finished.then(() => { if (guideAnimation === fade) guide.hidden = true; }, () => {});
      } else {
        guide.hidden = false;
        guide.style.left = position / width * 100 + '%';
        guideAnimation = global.EditorMotion.play(guide, [
          { opacity: .6, boxShadow: '0 0 0 2px #fff' }, { opacity: 1, boxShadow: '0 0 0 1px #fff' },
        ]);
      }
    }

    function cancel() {
      if (!session) return;
      const { pointer, selection } = session;
      session = null;
      if (paper.hasPointerCapture(pointer)) paper.releasePointerCapture(pointer);
      if (!selection) return;
      if (frame !== null) global.cancelAnimationFrame(frame);
      frame = null;
      showGuide(null);
      preview.setAttribute('hidden', '');
      preview.replaceChildren();
      delete paper.dataset.movingElements;
    }

    function start(event) {
      if (session || event.button !== 0 || event.isPrimary === false || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const identifier = options.identifierAt(event.target);
      if (!identifier) return;
      if (guidePosition === null && !guide.hidden) {
        guideAnimation?.cancel();
        guide.hidden = true;
      }
      const bounds = graphic.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      session = {
        identifier, pointer: event.pointerId, pointerType: event.pointerType, startBounds: bounds,
        startX: event.clientX, startY: event.clientY,
      };
      if (event.pointerType === 'mouse') event.preventDefault();
    }

    function movementAt(point) {
      const { canvasWidth, moving, others, limits } = session.selection;
      const bounds = graphic.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return null;
      const scale = bounds.width / canvasWidth;
      const initial = session.startBounds;
      const anchorX = bounds.left + (session.startX - initial.left) * (bounds.width / initial.width);
      const rowDistance = options.rowDistance(session.selection, (point.clientY - bounds.top) / scale);
      return { ...alignMovement(moving, others, canvasWidth, (point.clientX - anchorX) / scale, scale, limits, enabled), rowDistance };
    }

    function draw() {
      frame = null;
      const movement = movementAt(session.point);
      if (!movement) { cancel(); return; }
      if (movement.distance !== session.previousDistance || movement.rowDistance !== session.previousRowDistance) {
        preview.removeAttribute('hidden');
        paper.dataset.movingElements = 'true';
        session.guideFits = options.preview(preview, session.selection, movement.distance, movement.rowDistance) !== false;
      }
      session.previousDistance = movement.distance;
      session.previousRowDistance = movement.rowDistance;
      showGuide(session.guideFits ? movement.guide : null, session.selection.canvasWidth);
    }

    function queueDraw() {
      if (frame === null) frame = global.requestAnimationFrame(draw);
    }

    function move(event) {
      if (session?.pointer !== event.pointerId) return;
      if (!session.selection) {
        if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) <= 5) return;
        session.selection = options.select(session.identifier);
        if (!session.selection) { cancel(); return; }
        if (event.isTrusted) paper.setPointerCapture(event.pointerId);
      }
      session.point = event;
      queueDraw();
    }

    function finish(event) {
      if (session?.pointer !== event.pointerId) return;
      const { selection } = session;
      const movement = selection && event.type === 'pointerup' && movementAt(event);
      cancel();
      if (movement && (movement.distance || movement.rowDistance)) options.commit(selection, movement.distance, movement.rowDistance);
    }

    toggle.addEventListener('click', () => {
      enabled = !enabled;
      toggle.setAttribute('aria-pressed', String(enabled));
      if (session?.selection) queueDraw();
    });
    graphic.addEventListener('pointerdown', start);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
    document.addEventListener('touchstart', event => {
      if (session?.pointerType === 'touch' && event.touches.length > 1) cancel();
    }, true);
    // 部分浏览器仍会在图形上开始滚动，导致正在移动的元素收到取消事件。
    document.addEventListener('touchmove', event => {
      if (session?.pointerType === 'touch' && event.touches.length === 1 && event.cancelable) event.preventDefault();
    }, { capture: true, passive: false });
    // 触摸开始时由图形接收指针，控制交给牌面后，图形也会发出失去控制的事件。
    paper.addEventListener('lostpointercapture', event => {
      if (event.target === paper) finish(event);
    });
    global.addEventListener('blur', cancel);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !session?.selection) return;
      event.preventDefault();
      cancel();
    }, true);
    return {
      cancel,
      cancelActive() { if (session?.selection) cancel(); },
    };
  }

  global.ElementAlignment = { selectionBounds, limitsWithinCanvas, alignMovement, create };
})(typeof window !== 'undefined' ? window : globalThis);
