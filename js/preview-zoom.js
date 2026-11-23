(function (global) {
  'use strict';

  const minimumScale = 0.25;
  const maximumScale = 4;
  const zoomStops = [25, 50, 75, 100, 125, 150, 200, 300, 400];
  const wheelStep = 1.2;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function fitScale(width, height, availableWidth, availableHeight) {
    return Math.min(Math.max(availableWidth, 1) / width, Math.max(availableHeight, 1) / height, 1);
  }

  function scaleFromWheel(scale, event, pageHeight) {
    // 同一个滚轮动作可能以像素、行或页报告，按住 Shift 时也可能转成横向滚动量。
    const mode = event.deltaMode;
    const distance = (event.deltaY || event.deltaX) * (mode === 1 ? 32 : mode === 2 ? pageHeight : 1);
    return clamp(scale * wheelStep ** (-clamp(distance, -200, 200) / 100), minimumScale, maximumScale);
  }

  function positionForAnchor(pointer, fraction, displaySize, availableSize) {
    const offset = pointer - fraction * displaySize;
    const space = availableSize - displaySize;
    return {
      margin: clamp(offset, 0, Math.max(space, 0)),
      scroll: clamp(-offset, 0, Math.max(-space, 0)),
    };
  }

  function centeredTop(availableHeight, displayHeight, rowButtonHeight) {
    const spareHeight = Math.max(0, availableHeight - displayHeight);
    // 优先把牌面对准中央。空间不足时，稍向上移以露出添加行按钮。
    return Math.min(spareHeight, (spareHeight + rowButtonHeight) / 2);
  }

  function create({ viewport, stage, paper, graphic, controls, addRow, onChange }) {
    let width = 0;
    let height = 0;
    let scale = 1;
    let fitting = true;
    let left = 0;
    let top = 0;
    let locked = false;
    let lockedScroll = null;
    let drag = null;
    let zoom = null;
    let suppressClick = false;
    let clickTimer;
    const shackleOutline = 'M8 12V7a4 4 0 0 1 8 0v';

    controls.innerHTML = `
      <button type="button" aria-label="锁定画布位置" aria-pressed="false">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="12" width="14" height="9" rx="2"/>
          <path d="${shackleOutline}1"/>
          <line x1="12" y1="16" x2="12" y2="17"/>
        </svg>
      </button>
      <select aria-label="画布缩放比例">
        <option value="fit">适应画布</option>
        <option value="current" disabled hidden></option>
        ${zoomStops.map(percent => '<option value="' + percent + '">' + percent + '%</option>').join('')}
      </select>
    `;
    const lock = controls.querySelector('button');
    const shackle = lock.querySelector('path');
    const zoomMenu = controls.querySelector('select');
    const fittingOption = zoomMenu.querySelector('[value="fit"]');
    const currentOption = zoomMenu.querySelector('[value="current"]');

    function pixels(style, property) {
      return parseFloat(style[property]) || 0;
    }

    function updateControls() {
      const percent = scale < minimumScale ? Number((scale * 100).toPrecision(3)) : Math.round(scale * 100);
      fittingOption.textContent = fitting ? '适应画布（' + percent + '%）' : '适应画布';
      currentOption.textContent = percent + '%';
      const exactStop = zoomStops.includes(percent) && Math.abs(scale - percent / 100) < 1e-8;
      zoomMenu.value = zoom?.value ?? (fitting ? 'fit' : exactStop ? String(percent) : 'current');
      zoomMenu.disabled = locked;
      lock.setAttribute('aria-pressed', String(locked));
      shackle.setAttribute('d', shackleOutline + (locked ? '5' : '1'));
      lock.title = locked ? '已锁定位置和比例。点击解锁' : '已解锁。拖动画布空白处，或按住滚轮拖动。点击锁定';
      viewport.dataset.positionLocked = String(locked);
    }

    function viewportSpacing() {
      const style = global.getComputedStyle(viewport);
      const paddingLeft = pixels(style, 'paddingLeft');
      const paddingTop = pixels(style, 'paddingTop');
      const paddingRight = pixels(style, 'paddingRight');
      const paddingBottom = pixels(style, 'paddingBottom');
      const borderWidth = pixels(style, 'borderLeftWidth') + pixels(style, 'borderRightWidth');
      const borderHeight = pixels(style, 'borderTopWidth') + pixels(style, 'borderBottomWidth');
      const rowButtonHeight = addRow ? addRow.offsetHeight + pixels(global.getComputedStyle(addRow), 'marginTop') : 0;
      return {
        paddingLeft, paddingTop, paddingRight, paddingBottom, borderWidth, borderHeight, rowButtonHeight,
        horizontalSpace: paddingLeft + paddingRight,
        verticalSpace: paddingTop + paddingBottom + rowButtonHeight,
      };
    }

    function placePaper() {
      paper.style.marginLeft = left + 'px';
      paper.style.marginTop = top + 'px';
    }

    function fittedScale(spacing) {
      // 滚动条可能随适应比例消失，不能继续用它占据的空间计算。
      return fitScale(width, height, viewport.offsetWidth - spacing.horizontalSpace - spacing.borderWidth,
        viewport.offsetHeight - spacing.verticalSpace - spacing.borderHeight);
    }

    function apply(nextScale, anchor, resetScroll) {
      const spacing = viewportSpacing();
      if (fitting && !locked) nextScale = fittedScale(spacing);
      scale = nextScale;
      const displayWidth = width * scale;
      const displayHeight = height * scale;
      stage.style.minWidth = paper.style.width = graphic.style.width = displayWidth + 'px';
      paper.style.height = graphic.style.height = displayHeight + 'px';
      paper.style.marginLeft = paper.style.marginTop = '0px';

      const availableWidth = viewport.clientWidth - spacing.horizontalSpace;
      const availableHeight = viewport.clientHeight - spacing.verticalSpace;
      const spareWidth = Math.max(0, availableWidth - displayWidth);
      const spareHeight = Math.max(0, availableHeight - displayHeight);
      if (fitting && !locked) {
        left = spareWidth / 2;
        top = centeredTop(availableHeight, displayHeight, spacing.rowButtonHeight);
      } else if (anchor) {
        const bounds = viewport.getBoundingClientRect();
        const horizontal = positionForAnchor(anchor.x - bounds.left - viewport.clientLeft - spacing.paddingLeft,
          anchor.horizontalFraction, displayWidth, availableWidth);
        const vertical = positionForAnchor(anchor.y - bounds.top - viewport.clientTop - spacing.paddingTop,
          anchor.verticalFraction, displayHeight, availableHeight);
        left = horizontal.margin;
        top = vertical.margin;
        viewport.scrollLeft = horizontal.scroll;
        viewport.scrollTop = vertical.scroll;
      } else {
        left = Math.min(left, spareWidth);
        top = Math.min(top, spareHeight);
      }
      placePaper();
      if (resetScroll) viewport.scrollLeft = viewport.scrollTop = 0;
      updateControls();
      onChange();
    }

    function refresh(nextWidth = width, nextHeight = height) {
      if (!(nextWidth > 0 && nextHeight > 0)) return;
      if (zoom) {
        if (nextWidth === width && nextHeight === height) return;
        stopZoom();
      }
      if (locked && nextWidth === width && nextHeight === height) {
        onChange();
        return;
      }
      width = nextWidth;
      height = nextHeight;
      apply(scale);
    }

    function anchorAt(pointer) {
      const viewportBounds = viewport.getBoundingClientRect();
      const x = pointer?.clientX ?? viewportBounds.left + viewport.clientLeft + viewport.clientWidth / 2;
      const y = pointer?.clientY ?? viewportBounds.top + viewport.clientTop + viewport.clientHeight / 2;
      const bounds = paper.getBoundingClientRect();
      return { x, y, horizontalFraction: (x - bounds.left) / bounds.width, verticalFraction: (y - bounds.top) / bounds.height };
    }

    function stopZoom() {
      if (!zoom) return;
      global.cancelAnimationFrame(zoom.frame);
      zoom.clock.cancel();
      zoom = null;
      delete viewport.dataset.zoomTransition;
      updateControls();
    }

    function chooseZoom(value) {
      stopDrag();
      stopZoom();
      const fit = value === 'fit';
      const nextScale = fit ? fittedScale(viewportSpacing()) : Number(value) / 100;
      const anchor = anchorAt();
      const timing = global.EditorMotion.timing(controls);
      const finish = () => {
        stopZoom();
        fitting = fit;
        apply(nextScale, fit ? null : anchor, fit);
      };
      if (!timing.duration || !global.KeyframeEffect || !global.Animation || (!fit && nextScale === scale)) { finish(); return; }

      const spacing = viewportSpacing();
      const bounds = viewport.getBoundingClientRect();
      const originX = bounds.left + viewport.clientLeft + spacing.paddingLeft;
      const originY = bounds.top + viewport.clientTop + spacing.paddingTop;
      const fromX = left - viewport.scrollLeft;
      const fromY = top - viewport.scrollTop;
      const toX = Math.max(0, viewport.offsetWidth - spacing.horizontalSpace - spacing.borderWidth - width * nextScale) / 2;
      const toY = centeredTop(viewport.offsetHeight - spacing.verticalSpace - spacing.borderHeight,
        height * nextScale, spacing.rowButtonHeight);
      const start = scale;
      const interpolate = (from, to, progress) => from + (to - from) * progress;
      const clock = new global.Animation(new global.KeyframeEffect(null, [], { ...timing, fill: 'both' }), document.timeline);
      zoom = { clock, value };
      viewport.dataset.zoomTransition = 'true';
      fitting = false;
      clock.play();
      updateControls();
      function move() {
        const progress = clock.effect.getComputedTiming().progress ?? 0;
        if (progress >= 1) { finish(); return; }
        const position = fit ? {
          x: originX + interpolate(fromX, toX, progress), y: originY + interpolate(fromY, toY, progress),
          horizontalFraction: 0, verticalFraction: 0,
        } : anchor;
        apply(interpolate(start, nextScale, progress), position);
        zoom.frame = global.requestAnimationFrame(move);
      }
      zoom.frame = global.requestAnimationFrame(move);
    }

    function startDrag(event) {
      stopZoom();
      if (locked || drag || !width || event.isPrimary === false || event.pointerType === 'touch' || (event.button !== 0 && event.button !== 1)) return;
      // 左键仍优先用于编辑元素和操作按钮，按住滚轮可以在元素上平移。
      if (event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey ||
          event.target.closest?.('button, input, select, textarea, .row-handle, .element, [data-element-key], [data-station-id], [data-transfer-element]'))) return;
      event.preventDefault();
      event.stopPropagation();
      viewport.setPointerCapture(event.pointerId);
      const spacing = viewportSpacing();
      drag = {
        pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
        left: left - viewport.scrollLeft, top: top - viewport.scrollTop,
        availableWidth: viewport.clientWidth - spacing.horizontalSpace,
        availableHeight: viewport.clientHeight - spacing.verticalSpace,
      };
    }

    function moveDrag(event) {
      if (drag?.pointer !== event.pointerId) return;
      const horizontalDistance = event.clientX - drag.x;
      const verticalDistance = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(horizontalDistance, verticalDistance) < 5) return;
      drag.moved = true;
      viewport.dataset.dragging = 'true';
      const horizontal = positionForAnchor(drag.left + horizontalDistance, 0, width * scale, drag.availableWidth);
      const vertical = positionForAnchor(drag.top + verticalDistance, 0, height * scale, drag.availableHeight);
      if (fitting) {
        fitting = false;
        updateControls();
      }
      left = horizontal.margin;
      top = vertical.margin;
      placePaper();
      viewport.scrollLeft = horizontal.scroll;
      viewport.scrollTop = vertical.scroll;
      onChange();
    }

    function stopDrag(event) {
      if (!drag || (event && drag.pointer !== event.pointerId)) return;
      const { pointer, moved } = drag;
      drag = null;
      if (viewport.hasPointerCapture(pointer)) viewport.releasePointerCapture(pointer);
      delete viewport.dataset.dragging;
      if (!moved) return;
      // 指针释放后浏览器还会发出单击，避免把一次拖动当作空白处取消选择。
      suppressClick = true;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { suppressClick = false; }, 0);
    }

    function toggleLock() {
      stopZoom();
      stopDrag();
      if (!locked) {
        const spacing = viewportSpacing();
        const scrollbarWidth = viewport.offsetWidth - viewport.clientWidth - spacing.borderWidth;
        const scrollbarHeight = viewport.offsetHeight - viewport.clientHeight - spacing.borderHeight;
        lockedScroll = { left: viewport.scrollLeft, top: viewport.scrollTop };
        // 隐藏滚动条时保留它原先占用的空间，避免视图在锁定瞬间跳动。
        viewport.style.paddingRight = (spacing.paddingRight + scrollbarWidth) + 'px';
        viewport.style.paddingBottom = (spacing.paddingBottom + scrollbarHeight) + 'px';
      } else {
        lockedScroll = null;
        viewport.style.paddingRight = viewport.style.paddingBottom = '';
      }
      locked = !locked;
      updateControls();
      if (locked) onChange();
      else refresh();
    }

    lock.addEventListener('click', toggleLock);
    zoomMenu.addEventListener('change', () => {
      if (locked || !width || !height) return;
      if (zoomMenu.value === 'fit' || zoomStops.includes(Number(zoomMenu.value))) chooseZoom(zoomMenu.value);
    });
    viewport.addEventListener('pointerdown', startDrag, true);
    viewport.addEventListener('pointermove', moveDrag);
    viewport.addEventListener('pointerup', stopDrag);
    viewport.addEventListener('pointercancel', stopDrag);
    viewport.addEventListener('lostpointercapture', stopDrag);
    viewport.addEventListener('scroll', () => {
      if (!lockedScroll) return;
      if (viewport.scrollLeft !== lockedScroll.left) viewport.scrollLeft = lockedScroll.left;
      if (viewport.scrollTop !== lockedScroll.top) viewport.scrollTop = lockedScroll.top;
    });
    viewport.addEventListener('click', event => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    viewport.addEventListener('auxclick', event => {
      if (event.button === 1) event.preventDefault();
    });
    viewport.addEventListener('wheel', event => {
      if (!event.shiftKey || event.ctrlKey || event.metaKey || event.defaultPrevented || !event.cancelable || !width) return;
      if (!event.deltaY && !event.deltaX) return;
      event.preventDefault();
      if (locked || !height) return;
      stopZoom();
      const nextScale = scaleFromWheel(scale, event, viewport.clientHeight);
      if (!fitting && nextScale === scale) return;
      stopDrag();
      fitting = false;
      apply(nextScale, anchorAt(event));
    }, { passive: false });
    if (global.ResizeObserver) new global.ResizeObserver(() => refresh()).observe(viewport);
    else global.addEventListener('resize', () => refresh());

    function resetInteraction() {
      stopZoom();
      stopDrag();
      clearTimeout(clickTimer);
      suppressClick = false;
    }

    function resetForProject() {
      resetInteraction();
      fitting = true;
      locked = false;
      lockedScroll = null;
      viewport.style.paddingRight = viewport.style.paddingBottom = '';
      viewport.scrollLeft = viewport.scrollTop = 0;
      updateControls();
    }

    return { refresh, resetInteraction, resetForProject };
  }

  global.PreviewZoom = { create, fitScale, scaleFromWheel, positionForAnchor };
})(typeof window !== 'undefined' ? window : globalThis);
