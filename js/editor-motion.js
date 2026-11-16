(function (global) {
  'use strict';

  const sectionAnimations = new WeakMap();
  const toolbarPositions = new WeakMap();

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

  global.EditorMotion = { reveal, setToolbarVisible, placeToolbar, afterMotion };
})(typeof window !== 'undefined' ? window : globalThis);
