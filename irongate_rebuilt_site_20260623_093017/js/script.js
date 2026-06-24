document.addEventListener('DOMContentLoaded', () => {
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.main-nav');
  const navLinks = document.querySelectorAll('.main-nav a');
  const year = document.querySelector('#year');

  if (year) {
    year.textContent = new Date().getFullYear();
  }

  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
      navToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
    });
  }

  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      if (nav) nav.classList.remove('open');
      if (navToggle) {
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.setAttribute('aria-label', 'Open navigation');
      }
      navLinks.forEach((item) => item.classList.remove('active'));
      link.classList.add('active');
    });
  });

  const sections = [...document.querySelectorAll('main section[id]')];
  if ('IntersectionObserver' in window && sections.length && navLinks.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`);
        });
      });
    }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });

    sections.forEach((section) => observer.observe(section));
  }

  const closeModal = (modal) => {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  };

  const openModal = (modal) => {
    if (!modal) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    const closeButton = modal.querySelector('[data-modal-close]');
    if (closeButton) closeButton.focus();
  };

  document.addEventListener('click', (event) => {
    const openTrigger = event.target.closest('[data-modal-open]');
    if (openTrigger) {
      event.preventDefault();
      const modal = document.getElementById(openTrigger.dataset.modalOpen);
      openModal(modal);
      return;
    }

    const closeTrigger = event.target.closest('[data-modal-close]');
    if (closeTrigger) {
      event.preventDefault();
      closeModal(closeTrigger.closest('.modal-overlay'));
      return;
    }

    if (event.target.classList && event.target.classList.contains('modal-overlay')) {
      closeModal(event.target);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay.is-open').forEach(closeModal);
  });

  const tidyPoolRegisterPanel = () => {
    const panel = document.querySelector('.pool-register-panel');
    if (!panel) return;

    const status = panel.dataset.status || '';
    const title = panel.querySelector('#pool-register-title');
    const text = panel.querySelector('#pool-register-text');
    const details = panel.querySelector('#pool-register-details');
    const looksRightLabel = panel.querySelector('#poolRegisterLooksRight')?.closest('.option-card');
    const overrideLabel = panel.querySelector('#poolRegisterOverride')?.closest('.option-card');
    const actions = panel.querySelector('.pool-register-actions');
    const editAddressButton = panel.querySelector('#pool-register-edit-address');

    if (editAddressButton) {
      editAddressButton.textContent = status === 'not_found' ? 'Try another address' : 'Edit address';
    }

    if (status === 'checking') {
      if (title) title.textContent = 'Checking pool registration';
      if (text) text.textContent = 'Checking the selected address against the pool register. Please wait.';
      if (details) details.hidden = true;
      if (looksRightLabel) looksRightLabel.hidden = true;
      if (overrideLabel) overrideLabel.hidden = true;
      if (actions) actions.hidden = true;
      return;
    }

    if (status === 'registered') {
      if (title) title.textContent = 'Registered pool found';
      if (text) text.textContent = 'A registered pool was found for this address. Does this look right?';
      if (looksRightLabel) {
        looksRightLabel.hidden = false;
        const labelText = looksRightLabel.querySelector('span');
        if (labelText) labelText.textContent = 'Yes, this looks right.';
      }
      if (overrideLabel) overrideLabel.hidden = true;
      if (actions) actions.hidden = false;
      return;
    }

    if (status === 'not_found') {
      if (title) title.textContent = 'No registered pool found';
      if (text) text.textContent = 'We could not find a registered pool for this selected address. Try another address, check/register the pool with QBCC, or use the fail-safe if you know there is a pool at this property.';
      if (looksRightLabel) looksRightLabel.hidden = true;
      if (overrideLabel) {
        overrideLabel.hidden = false;
        const labelText = overrideLabel.querySelector('span');
        if (labelText) {
          labelText.innerHTML = 'There is a pool at this property. Continue anyway.<small>Use this only if the lookup is wrong, unavailable, or the pool is listed under slightly different address details.</small>';
        }
      }
      if (actions) actions.hidden = false;
      return;
    }

    if (status === 'manual_required') {
      if (title) title.textContent = 'Pool register verification unavailable';
      if (text) text.textContent = 'Automatic verification could not be completed. Try another address, check/register the pool with QBCC, or use the fail-safe if you know there is a pool at this property.';
      if (looksRightLabel) looksRightLabel.hidden = true;
      if (overrideLabel) {
        overrideLabel.hidden = false;
        const labelText = overrideLabel.querySelector('span');
        if (labelText) {
          labelText.innerHTML = 'There is a pool at this property. Continue anyway.<small>Use this only if the register check is wrong, unavailable, or the pool is listed under slightly different address details.</small>';
        }
      }
      if (actions) actions.hidden = false;
    }
  };

  const poolRegisterObserver = new MutationObserver(tidyPoolRegisterPanel);
  const watchForPoolRegisterPanel = () => {
    const panel = document.querySelector('.pool-register-panel');
    if (!panel) return;
    tidyPoolRegisterPanel();
    poolRegisterObserver.observe(panel, { attributes: true, childList: true, subtree: true, attributeFilter: ['data-status', 'hidden'] });
  };

  watchForPoolRegisterPanel();
  const bodyObserver = new MutationObserver(() => {
    if (document.querySelector('.pool-register-panel')) {
      watchForPoolRegisterPanel();
      bodyObserver.disconnect();
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
});