(function (global) {
  'use strict';

  const sectionAnimations = new WeakMap();
  const toolbarPositions = new WeakMap();
  const graphicTransitions = new WeakMap();

  function timing(element, durationName = 'control') {
    const style = global.getComputedStyle(element);
    return {
      duration: parseFloat(style.getPropertyValue('--motion-' + durationName + '-duration')) || 0,
      easing: style.getPropertyValue('--motion-enter').trim(),
    };
  }

  function play(element, frames, durationName) {
    const options = timing(element, durationName);
    if (options.duration > 0) return element.animate?.(frames, options);
  }

  function fadeIn(element, durationName) {
    return play(element, [{ opacity: 0 }, { opacity: 1 }], durationName);
  }

  function stopGraphicTransition(graphic) {
    graphicTransitions.get(graphic)?.();
  }

  function revealGraphic(graphic) {
    stopGraphicTransition(graphic);
    const animation = play(graphic, [{ opacity: .52 }, { opacity: 1 }], 'reveal');
    if (!animation) return;
    function clear() {
      if (graphicTransitions.get(graphic) === clear) graphicTransitions.delete(graphic);
      animation.cancel();
    }
    graphicTransitions.set(graphic, clear);
    animation.finished.then(clear, clear);
  }

  function prepareGraphicCrossfade(graphic, drawPrevious) {
    stopGraphicTransition(graphic);
    if (!timing(graphic, 'reveal').duration) return;
    const before = graphic.getBoundingClientRect();
    if (!before.width || !before.height) return;
    const viewport = graphic.closest('.preview-zoom-viewport')?.getBoundingClientRect();
    const old = document.createElementNS(graphic.namespaceURI, 'svg');
    old.classList.add('outgoing-sign-preview');
    old.setAttribute('aria-hidden', 'true');
    drawPrevious(old);
    return () => {
      const after = graphic.getBoundingClientRect();
      old.style.left = before.left + 'px';
      old.style.top = before.top + 'px';
      old.style.width = before.width + 'px';
      old.style.height = before.height + 'px';
      if (viewport) {
        const clipped = [viewport.top - before.top, before.right - viewport.right, before.bottom - viewport.bottom, viewport.left - before.left];
        old.style.clipPath = 'inset(' + clipped.map(edge => Math.max(0, edge) + 'px').join(' ') + ')';
      }
      graphic.after(old);
      const outgoing = play(old, [{ opacity: 1 }, { opacity: 0 }], 'reveal');
      if (!outgoing) { old.remove(); return; }
      const resized = Math.abs(before.width - after.width) > 1 || Math.abs(before.height - after.height) > 1;
      const incoming = resized ? fadeIn(graphic, 'reveal') : undefined;
      function clear() {
        outgoing.cancel();
        incoming?.cancel();
        old.remove();
        if (graphicTransitions.get(graphic) === clear) graphicTransitions.delete(graphic);
      }
      graphicTransitions.set(graphic, clear);
      outgoing.finished.then(clear, clear);
    };
  }

  function reveal(section, direction = 0) {
    const style = global.getComputedStyle(section);
    const duration = parseFloat(style.getPropertyValue('--motion-panel-duration'));
    const previous = sectionAnimations.get(section);
    const start = previous?.playState === 'running'
      ? { opacity: style.opacity, transform: style.transform }
      : { opacity: .46, transform: direction ? 'translateX(' + direction * 12 + 'px)' : 'translateY(5px)' };
    previous?.cancel();
    if (duration > 0 && typeof section.animate === 'function') {
      const animation = section.animate([start, { opacity: 1, transform: 'none' }], {
        duration, easing: style.getPropertyValue('--motion-enter').trim(),
      });
      sectionAnimations.set(section, animation);
    }
  }

  function setToolbarVisible(toolbar, visible) {
    toolbar.hidden = toolbar.inert = !visible;
    if (!visible) {
      toolbarPositions.get(toolbar)?.animation?.cancel();
      toolbarPositions.delete(toolbar);
    }
  }

  function placeToolbar(toolbar, left, top, selection) {
    const previous = toolbarPositions.get(toolbar);
    if (previous?.left === left && previous.top === top && previous.selection === selection) return;
    const movedToAnotherSelection = previous && previous.selection !== selection;
    const style = movedToAnotherSelection ? global.getComputedStyle(toolbar) : null;
    const duration = style ? parseFloat(style.getPropertyValue('--motion-reveal-duration')) : 0;
    const start = duration > 0 ? toolbar.getBoundingClientRect() : null;
    const frame = start && toolbar.offsetParent?.getBoundingClientRect();
    const startFits = !frame || (start.left >= frame.left && start.right <= frame.right && start.top >= frame.top && start.bottom <= frame.bottom);
    previous?.animation?.cancel();
    toolbar.style.left = left + 'px';
    toolbar.style.top = top + 'px';
    let animation;
    if (start && startFits && typeof toolbar.animate === 'function') {
      const end = toolbar.getBoundingClientRect();
      if (Math.hypot(start.left - end.left, start.top - end.top) > 1) {
        animation = toolbar.animate([
          { translate: (start.left - end.left) + 'px ' + (start.top - end.top) + 'px' },
          { translate: '0px 0px' },
        ], { duration, easing: style.getPropertyValue('--motion-enter').trim() });
      }
    }
    toolbarPositions.set(toolbar, { left, top, selection, animation });
  }

  function afterMotion(element, callback) {
    element.getBoundingClientRect();
    const animations = element.getAnimations?.({ subtree: true }) || [];
    if (animations.length) Promise.allSettled(animations.map(animation => animation.finished)).then(callback);
    else callback();
  }

  global.EditorMotion = { timing, play, fadeIn, stopGraphicTransition, revealGraphic, prepareGraphicCrossfade, reveal, setToolbarVisible, placeToolbar, afterMotion };
})(typeof window !== 'undefined' ? window : globalThis);
