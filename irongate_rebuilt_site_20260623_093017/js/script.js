(() => {
  if (window.__irongatePoolRegisterStreetNumberGuard) return;
  window.__irongatePoolRegisterStreetNumberGuard = true;

  const originalFetch = window.fetch.bind(window);

  function normaliseStreetNumber(value) {
    const cleaned = String(value || "").toUpperCase().replace(/[^A-Z0-9\s/.-]/g, " ").replace(/\s+/g, " ").trim();
    const slashMatch = cleaned.match(/\/(\d+[A-Z]?)/);
    if (slashMatch) return slashMatch[1];
    const match = cleaned.match(/\d+[A-Z]?(?:-\d+[A-Z]?)?/);
    return match ? match[0] : "";
  }

  function recordValue(record, key) {
    return record?.[key] ?? record?.[key.replace(/ /g, " ")] ?? "";
  }

  function selectedStreetNumber() {
    const addressText = document.querySelector("#propertyAddress")?.value || "";
    return normaliseStreetNumber(addressText);
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const rawUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    if (!rawUrl.includes("data.qld.gov.au/api/3/action/datastore_search")) {
      return response;
    }

    const selectedNumber = selectedStreetNumber();
    if (!selectedNumber) return response;

    try {
      const data = await response.clone().json();
      const records = Array.isArray(data?.result?.records) ? data.result.records : [];
      data.result.records = records.filter((record) => {
        return normaliseStreetNumber(recordValue(record, "Street Number")) === selectedNumber;
      });
      data.result.total = data.result.records.length;

      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.warn("Pool register street-number guard could not inspect response", error);
      return response;
    }
  };
})();

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
});