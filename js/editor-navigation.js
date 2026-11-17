(function (global) {
  'use strict';

  const document = global.document;
  const navigation = document.querySelector('.editor-navigation');
  const toggle = navigation.querySelector('.editor-switch');
  const choices = navigation.querySelector('.editor-choices');
  const links = Array.from(choices.querySelectorAll('a'));
  const current = choices.querySelector('[aria-current="page"]');
  const title = current.textContent.trim() + '编辑器';
  toggle.querySelector('span').textContent = title;
  toggle.setAttribute('aria-label', '切换编辑器，当前为' + title);

  function setOpen(open) {
    choices.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => {
    setOpen(choices.hidden);
    if (!choices.hidden) toggle.focus();
  });

  navigation.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !choices.hidden) {
      // 编辑器里的退出键也会取消牌面选择，打开导航时应优先收起导航。
      event.preventDefault();
      setOpen(false);
      toggle.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const next = event.key === 'ArrowDown';
    const index = links.indexOf(event.target);
    const destination = index < 0 ? (next ? 0 : links.length - 1)
      : (index + (next ? 1 : -1) + links.length) % links.length;
    setOpen(true);
    links[destination].focus();
  });

  current.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    // 重新打开当前页面会清掉本次编辑的撤销记录。
    event.preventDefault();
    setOpen(false);
    toggle.focus();
  });

  navigation.addEventListener('focusout', event => {
    if (!navigation.contains(event.relatedTarget)) setOpen(false);
  });
  document.addEventListener('click', event => {
    if (!navigation.contains(event.target)) setOpen(false);
  });
  global.addEventListener('pageshow', () => setOpen(false));
})(window);
