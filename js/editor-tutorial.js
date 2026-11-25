(function (window) {
  'use strict';

  const document = window.document;
  const preferences = window.EditorPreferences;
  const editor = document.body.dataset.editor;
  const tutorials = {
    guidance: {
      name: '导向标识',
      steps: [
        ['#left-panel .panel-header', '从元素库添加内容', '点击箭头、文字或线路编号来添加，也可以把它们拖到牌面的指定行。'],
        ['#guidance-zoom', '在画布上调整排版', '点选并拖动牌面元素可改变位置。在右下角或滚动鼠标滚轮可调整画布大小。'],
        ['#right-panel .property-heading-row', '在右侧修改属性', '选中元素后可修改文字、颜色和对齐方式。取消选择后可设置整块标识牌。'],
        ['#right-panel .image-export', '导出标识牌', '请选择图片格式和尺寸。要在另一台设备继续编辑，可以从「项目」导出项目文件。'],
      ],
    },
    transfer: {
      name: '换乘标识',
      steps: [
        ['#transfer-modes', '选择版式', '版式 A 的线路共用一组箭头和文字。版式 B 可以分组设置。'],
        ['#transfer-content .panel-header', '添加线路并选择元素', '在左侧添加或点选线路。也可以直接点牌面上的色带、箭头或文字。'],
        ['#transfer-properties .property-heading-row', '调整线路和文字', '在右侧修改所选线路的名称、颜色和底纹，或调整箭头、文字的排版。'],
        ['#transfer-properties .image-export', '导出标识牌', '可导出原尺寸或放大的图片。在「项目」导出的项目文件会同时保存两种版式。'],
      ],
    },
    platform: {
      name: '站台标识',
      steps: [
        ['#platform-content .panel-header', '添加和排列站点', '从左侧添加站点并拖动排序。点击站点可修改站名，点定位图标可设为本站。'],
        ['.editor-header .mode-tabs', '在三种版式间切换', '可以用同一条线路制作全线吊板、本站吊板和纵向线路图。'],
        ['#platform-properties .property-heading-row', '编辑线路和站点', '在右侧设置线路、行车方向或外观。选中站点后可编辑站名和换乘信息。'],
        ['#platform-properties .image-export', '导出单张或批量生成', '可直接导出当前牌面，也可以批量预览、选择站点和版式，再打包下载。'],
      ],
    },
  };

  const tutorial = tutorials[editor];
  const trigger = document.querySelector('[data-open-tutorial]');
  const header = trigger.closest('.editor-header');
  const preview = document.querySelector('.editor-choices [aria-current] img');
  const welcome = document.createElement('dialog');
  welcome.className = 'tutorial-welcome';
  welcome.setAttribute('aria-labelledby', 'tutorial-title');
  welcome.innerHTML = `
    <div class="tutorial-art"><img alt=""></div>
    <div class="tutorial-intro">
      <h2 id="tutorial-title"></h2>
      <p>从添加内容到导出标识牌，四步认识常用功能。</p>
      <div class="tutorial-actions">
        <button type="button" class="btn" data-tutorial-skip>暂不查看</button>
        <button type="button" class="btn btn-primary" data-tutorial-start autofocus>开始教程</button>
      </div>
    </div>`;
  welcome.querySelector('img').src = preview.src;
  welcome.querySelector('h2').textContent = tutorial.name + '入门';

  const bubble = document.createElement('div');
  bubble.className = 'tutorial-bubble';
  bubble.setAttribute('popover', 'manual');
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-labelledby', 'tutorial-step-title');
  bubble.setAttribute('aria-describedby', 'tutorial-step-description');
  bubble.innerHTML = `
    <div class="tutorial-bubble-heading">
      <span class="tutorial-progress"></span>
      <button type="button" class="icon-btn tutorial-close" aria-label="结束教程" title="结束教程">×</button>
    </div>
    <h2 id="tutorial-step-title" tabindex="-1"></h2>
    <p id="tutorial-step-description"></p>
    <div class="tutorial-actions">
      <button type="button" class="btn" data-tutorial-back>上一步</button>
      <button type="button" class="btn btn-primary" data-tutorial-next>下一步</button>
    </div>`;
  document.body.append(welcome, bubble);

  const progress = bubble.querySelector('.tutorial-progress');
  const stepTitle = bubble.querySelector('h2');
  const description = bubble.querySelector('p');
  const back = bubble.querySelector('[data-tutorial-back]');
  const next = bubble.querySelector('[data-tutorial-next]');
  let step = 0;
  let target;
  let guideOpen = false;
  const observer = new ResizeObserver(placeBubble);

  function placeBubble() {
    if (!guideOpen) return;
    const bounds = target.getBoundingClientRect();
    const frame = document.documentElement;
    const margin = 12;
    const gap = 10;
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const below = bounds.bottom + gap;
    const above = bounds.top - gap - height;
    const placeBelow = below + height <= frame.clientHeight - margin || above < margin;
    const centerLeft = bounds.left + bounds.width / 2;
    const centerTop = bounds.top + bounds.height / 2;
    const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum));
    let side = placeBelow ? 'below' : 'above';
    let left = clamp(centerLeft - width / 2, margin, frame.clientWidth - width - margin);
    let top = clamp(placeBelow ? below : above, margin, frame.clientHeight - height - margin);
    let pointer = clamp(centerLeft - left, 20, width - 20);
    if (target.closest('.editor-left') && bounds.right + gap + width <= frame.clientWidth - margin) {
      side = 'right';
      left = bounds.right + gap;
    } else if (target.closest('.editor-right') && bounds.left - gap - width >= margin) {
      side = 'left';
      left = bounds.left - gap - width;
    }
    if (side === 'right' || side === 'left') {
      top = clamp(centerTop - height / 2, margin, frame.clientHeight - height - margin);
      pointer = clamp(centerTop - top, 20, height - 20);
    }
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
    bubble.style.setProperty('--tutorial-pointer', pointer + 'px');
    bubble.dataset.side = side;
  }

  function clearTarget() {
    observer.disconnect();
    target?.removeAttribute('data-tutorial-target');
  }

  function showStep(index) {
    clearTarget();
    step = index;
    const [selector, heading, text] = tutorial.steps[step];
    target = document.querySelector(selector);
    const panel = target.closest('.editor-left, .editor-right');
    if (panel) window.EditorPanels.expand(panel.id);
    target.setAttribute('data-tutorial-target', '');
    progress.textContent = '第 ' + (step + 1) + ' 步，共 ' + tutorial.steps.length + ' 步';
    stepTitle.textContent = heading;
    description.textContent = text;
    back.hidden = step === 0;
    next.textContent = step === tutorial.steps.length - 1 ? '完成' : '下一步';
    placeBubble();
    observer.observe(target);
    observer.observe(header);
    if (panel) observer.observe(panel);
    stepTitle.focus({ preventScroll: true });
  }

  function openWelcome() {
    if (welcome.open || guideOpen || document.querySelector('dialog:modal, .modal-mask')) return;
    welcome.showModal();
  }

  function closeWelcome() {
    preferences.markTutorialSeen(editor);
    welcome.close();
  }

  function dismissWelcome() {
    closeWelcome();
    trigger.focus({ preventScroll: true });
  }

  function endGuide() {
    guideOpen = false;
    clearTarget();
    bubble.hidePopover();
    trigger.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', () => guideOpen ? endGuide() : openWelcome());
  welcome.querySelector('[data-tutorial-skip]').addEventListener('click', dismissWelcome);
  welcome.addEventListener('cancel', event => { event.preventDefault(); dismissWelcome(); });
  welcome.querySelector('[data-tutorial-start]').addEventListener('click', () => {
    closeWelcome();
    guideOpen = true;
    bubble.showPopover();
    showStep(0);
  });
  bubble.querySelector('.tutorial-close').addEventListener('click', endGuide);
  back.addEventListener('click', () => showStep(step - 1));
  next.addEventListener('click', () => step === tutorial.steps.length - 1 ? endGuide() : showStep(step + 1));
  // 气泡中的复制、按键和点击应交给浏览器处理，以免改动选中的标识牌内容。
  for (const type of ['click', 'keydown', 'copy', 'cut', 'paste']) {
    bubble.addEventListener(type, event => event.stopPropagation());
  }
  window.addEventListener('resize', placeBubble);
  document.addEventListener('scroll', placeBubble, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !guideOpen || document.querySelector('dialog:modal, .modal-mask')) return;
    event.preventDefault();
    endGuide();
  }, true);

  document.addEventListener('DOMContentLoaded', async () => {
    if (window.top !== window) return;
    try { await window.App.ready; }
    catch { return; }
    if (preferences.read().showTutorial && !preferences.tutorialSeen(editor)) openWelcome();
  });
})(window);
