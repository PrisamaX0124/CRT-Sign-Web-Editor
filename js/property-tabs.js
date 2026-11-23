(function (global) {
  'use strict';

  const tabs = [
    ['edit', '编辑', 'property-edit'],
    ['appearance', '外观', 'property-appearance'],
    ['project', '项目', 'property-project'],
  ];

  function create(body) {
    const tabList = body.previousElementSibling.querySelector('.property-tabs');
    const buttons = tabs.map(([name, label, icon]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = body.id + '-tab-' + name;
      button.dataset.propertyTabButton = name;
      button.dataset.controlIcon = icon;
      button.textContent = label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', body.id);
      button.addEventListener('click', () => show(name));
      tabList.append(button);
      return button;
    });
    body.setAttribute('role', 'tabpanel');
    body.tabIndex = 0;

    let context;
    let active = 'edit';
    let sections = [];
    let available = new Set();

    function show(name, animate = true) {
      if (!available.has(name)) return;
      const previous = active;
      if (previous !== name) body.scrollTop = 0;
      active = name;
      for (const section of sections) {
        section.classList.toggle('property-tab-hidden', section.dataset.propertyTab !== name);
      }
      for (const button of buttons) {
        const selected = button.dataset.propertyTabButton === name;
        if (button.getAttribute('aria-selected') !== String(selected)) {
          button.setAttribute('aria-selected', String(selected));
          button.tabIndex = selected ? 0 : -1;
        }
        if (selected && body.getAttribute('aria-labelledby') !== button.id) {
          body.setAttribute('aria-labelledby', button.id);
        }
      }
      if (animate && previous !== name) {
        const direction = tabs.findIndex(tab => tab[0] === name) > tabs.findIndex(tab => tab[0] === previous) ? 1 : -1;
        for (const section of sections) {
          if (section.dataset.propertyTab === name && !body.contains(section.closest('[hidden]'))) {
            global.EditorMotion.reveal(section, direction);
          }
        }
      }
    }

    function sync(nextContext) {
      sections = Array.from(body.querySelectorAll('[data-property-tab]'));
      available = new Set(sections.filter(section => !body.contains(section.closest('[hidden]')))
        .map(section => section.dataset.propertyTab));
      const focused = buttons.find(button => button === document.activeElement);
      for (const button of buttons) {
        const hidden = !available.has(button.dataset.propertyTabButton);
        if (button.hidden !== hidden) button.hidden = hidden;
      }
      const first = available.has('edit') ? 'edit' : available.values().next().value;
      show(context === nextContext && available.has(active) ? active : first, false);
      context = nextContext;
      if (focused?.hidden) buttons.find(button => button.dataset.propertyTabButton === active).focus({ preventScroll: true });
    }

    tabList.addEventListener('keydown', event => {
      const visible = buttons.filter(button => !button.hidden);
      const index = visible.indexOf(event.target);
      if (index < 0) return;
      const offsets = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: visible.length - 1 };
      if (!Object.hasOwn(offsets, event.key)) return;
      event.preventDefault();
      const next = visible[(offsets[event.key] + visible.length) % visible.length];
      show(next.dataset.propertyTabButton);
      next.focus({ preventScroll: true });
    });

    return { sync, show };
  }

  global.PropertyTabs = { create };
})(window);
