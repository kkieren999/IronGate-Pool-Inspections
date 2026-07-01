document.addEventListener("DOMContentLoaded", () => {
  const elements = {
    card: document.getElementById("checkCard"),
    currentCheckTitle: document.getElementById("currentCheckTitle"),
    stepLabel: document.getElementById("stepLabel"),
    answeredLabel: document.getElementById("answeredLabel"),
    progressFill: document.getElementById("progressFill"),
    prevButton: document.querySelector("[data-prev]"),
    resetButton: document.querySelector("[data-reset]"),
    summaryPanel: document.getElementById("result"),
    goodCount: document.getElementById("goodCount"),
    reviewCount: document.getElementById("reviewCount"),
    riskCount: document.getElementById("riskCount"),
    summaryCopy: document.getElementById("summaryCopy"),
    actionList: document.getElementById("actionList"),
    toast: document.getElementById("toast")
  };

  if (!elements.card || !elements.summaryPanel) return;

  const checks = [
    {
      title: "Pool gate closes by itself",
      shortTitle: "Gate self-closing",
      prompt: "Open the gate about halfway, then let it go. Does it close without help?",
      icon: "gate",
      lookFor: ["Gate swings freely", "No dragging or sticking", "No need to push it shut", "Not tied or propped open"],
      reviewText: "The gate may need hinge adjustment, repair or a closer check.",
      riskText: "A gate that does not close by itself is a high-priority inspection issue."
    },
    {
      title: "Pool gate latches every time",
      shortTitle: "Gate latch",
      prompt: "After the gate closes, listen and check that the latch catches properly every time.",
      icon: "latch",
      lookFor: ["Latch clicks shut", "Gate cannot be pushed open", "Latch is secure", "No loose screws or wobble"],
      reviewText: "The latch should be checked before inspection day.",
      riskText: "A gate that closes but does not latch can allow easy access to the pool area."
    },
    {
      title: "Latch is not easy for a child to reach",
      shortTitle: "Latch reach",
      prompt: "Stand outside the pool area. Could a young child reach, climb to, or reach through to open the latch?",
      icon: "hand",
      lookFor: ["Latch is high enough", "No footholds nearby", "No reach-through access", "No climbable rail below latch"],
      reviewText: "Reachable latches are worth reviewing because latch height and shielding can matter.",
      riskText: "If a child can reach or climb to the latch, the barrier may not control access properly."
    },
    {
      title: "Fence has no obvious gaps or damage",
      shortTitle: "Fence condition",
      prompt: "Walk the full barrier and look for gaps, loose panels, missing parts or weak spots.",
      icon: "fence",
      lookFor: ["No big gaps underneath", "No missing palings or rails", "No loose panels", "No rusted or broken hardware"],
      reviewText: "Any visible gap, movement or damage should be checked before an inspection.",
      riskText: "Barrier gaps or broken sections can create direct access into the pool area."
    },
    {
      title: "No climbable objects near the barrier",
      shortTitle: "Climbable objects",
      prompt: "Look around both sides of the fence for objects that could help a child climb.",
      icon: "chair",
      lookFor: ["No chairs, tables or BBQs", "No pot plants or storage boxes", "No taps, pipes or ledges", "No branches or garden beds"],
      reviewText: "Move possible climb aids away from the barrier and check the area again.",
      riskText: "Climbable objects near the pool barrier are common causes of inspection problems."
    },
    {
      title: "House access is controlled",
      shortTitle: "House access",
      prompt: "Check whether doors, windows, garages or pet doors give direct access into the pool area.",
      icon: "house",
      lookFor: ["No direct door access", "Windows do not open into pool area", "No pet door access", "Side paths are controlled"],
      reviewText: "Building access can be tricky, so mark it for inspection if you are unsure.",
      riskText: "Uncontrolled house, window or pet-door access can compromise the pool barrier."
    },
    {
      title: "CPR sign is visible and readable",
      shortTitle: "CPR sign",
      prompt: "Look from the pool area. Can you clearly see and read the CPR sign?",
      icon: "sign",
      lookFor: ["Clearly visible", "Not faded or damaged", "Weatherproof", "Easy to see in an emergency"],
      reviewText: "A faded, missing or hard-to-find CPR sign should be fixed before inspection day.",
      riskText: "A missing or unreadable CPR sign is a simple issue that can still affect readiness."
    }
  ];

  const icons = {
    gate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4h12v17M5 8h12M5 13h12M17 4h2v17M9 17h.01"/></svg>',
    latch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11V8a4 4 0 0 1 8 0v3M6 11h12v9H6zM12 15v2"/></svg>',
    hand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12V7a1.5 1.5 0 0 1 3 0v5M10 11V5.5a1.5 1.5 0 0 1 3 0V12M13 11V7a1.5 1.5 0 0 1 3 0v6M16 12.5V10a1.5 1.5 0 0 1 3 0v5c0 4-2.5 6-6.5 6H11c-2.8 0-4.3-1.4-5.4-3.2L4 15.2a1.7 1.7 0 0 1 2.8-1.9L9 16"/></svg>',
    fence: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5l4-2 4 2 4-2 4 2v16M4 9h16M4 14h16M8 3v18M12 5v16M16 3v18"/></svg>',
    chair: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v9h9a3 3 0 0 1 3 3v1H7M7 12H5a2 2 0 0 0-2 2v2h4M7 16v5M18 16v5"/></svg>',
    house: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8M5 10v11h14V10M10 21v-6h4v6M8 13h2M14 13h2"/></svg>',
    sign: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v14H6zM9 7h6M9 11h6M12 17v4M8 21h8"/></svg>'
  };

  const state = {
    current: 0,
    answers: {},
    autoAdvanceTimer: null
  };

  function render() {
    const check = checks[state.current];
    const selected = state.answers[state.current];
    const answered = Object.keys(state.answers).length;

    elements.currentCheckTitle.textContent = check.title;
    elements.stepLabel.textContent = `Check ${state.current + 1} of ${checks.length}`;
    elements.answeredLabel.textContent = `${answered} answered`;
    elements.progressFill.style.width = `${(answered / checks.length) * 100}%`;
    elements.prevButton.disabled = state.current === 0;

    elements.card.innerHTML = `
      <div class="check-visual">
        <div class="check-icon">${icons[check.icon]}</div>
        <div>
          <h3>${check.title}</h3>
          <p class="prompt">${check.prompt}</p>
        </div>
      </div>
      <div class="look-for">
        <p class="look-for-title">What to look for</p>
        <ul>${check.lookFor.map((item) => `<li>${item}</li>`).join("")}</ul>
      </div>
      <div class="answer-grid" role="group" aria-label="Answer for ${check.title}">
        <button class="answer-card ${selected === "good" ? "is-selected" : ""}" type="button" data-answer="good" aria-pressed="${selected === "good"}">
          <strong>Looks OK</strong>
          <span>I checked this and did not notice an obvious issue.</span>
        </button>
        <button class="answer-card ${selected === "review" ? "is-selected" : ""}" type="button" data-answer="review" aria-pressed="${selected === "review"}">
          <strong>Not sure</strong>
          <span>I want this item reviewed by an inspector.</span>
        </button>
        <button class="answer-card ${selected === "risk" ? "is-selected" : ""}" type="button" data-answer="risk" aria-pressed="${selected === "risk"}">
          <strong>Needs attention</strong>
          <span>I found something that may need fixing.</span>
        </button>
      </div>
      <p class="tap-hint">Tap an answer to save it and move to the next check.</p>
    `;

    renderSummary();
  }

  function getCounts() {
    return Object.values(state.answers).reduce((counts, answer) => {
      counts[answer] += 1;
      return counts;
    }, { good: 0, review: 0, risk: 0 });
  }

  function renderSummary() {
    const counts = getCounts();
    const answered = Object.keys(state.answers).length;
    const isComplete = answered === checks.length;
    const actionItems = Object.entries(state.answers)
      .filter(([, answer]) => answer === "review" || answer === "risk")
      .map(([index, answer]) => ({ check: checks[index], answer }));

    elements.summaryPanel.classList.toggle("has-answers", answered > 0);
    elements.summaryPanel.classList.toggle("is-complete", isComplete);
    elements.goodCount.textContent = counts.good;
    elements.reviewCount.textContent = counts.review;
    elements.riskCount.textContent = counts.risk;

    if (answered === 0) {
      elements.summaryCopy.textContent = "Start the checklist to build a simple action list.";
    } else if (counts.risk > 0) {
      elements.summaryCopy.textContent = "You have flagged one or more items that may need attention before inspection day.";
    } else if (counts.review > 0) {
      elements.summaryCopy.textContent = "You have a few items marked Not sure. These are worth checking with IronGate.";
    } else if (isComplete) {
      elements.summaryCopy.textContent = "No obvious issues were flagged. A licensed inspection is still needed to confirm compliance.";
    } else {
      elements.summaryCopy.textContent = "So far, no obvious issues have been flagged.";
    }

    if (!actionItems.length) {
      elements.actionList.innerHTML = '<p class="empty-state">Items you mark for review will appear here.</p>';
      return;
    }

    elements.actionList.innerHTML = actionItems.map(({ check, answer }) => {
      const isRisk = answer === "risk";
      return `
        <div class="action-item ${isRisk ? "risk" : ""}">
          <strong>${check.shortTitle}</strong>
          <span>${isRisk ? check.riskText : check.reviewText}</span>
        </div>
      `;
    }).join("");
  }

  function moveNext() {
    if (state.current < checks.length - 1) {
      state.current += 1;
      render();
      elements.card.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    elements.summaryPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function movePrev() {
    window.clearTimeout(state.autoAdvanceTimer);
    if (state.current === 0) return;
    state.current -= 1;
    render();
    elements.card.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetChecklist() {
    window.clearTimeout(state.autoAdvanceTimer);
    state.current = 0;
    state.answers = {};
    render();
    showToast("Checklist reset");
  }

  function buildSummaryText() {
    const counts = getCounts();
    const flagged = Object.entries(state.answers)
      .filter(([, answer]) => answer === "review" || answer === "risk")
      .map(([index, answer]) => `- ${checks[index].shortTitle}: ${answer === "risk" ? "Needs attention" : "Not sure"}`);

    return [
      "IronGate homeowner pool safety self-check summary",
      "",
      `Looks OK: ${counts.good}`,
      `Not sure: ${counts.review}`,
      `Needs attention: ${counts.risk}`,
      "",
      flagged.length ? "Items to review:" : "No items were marked for review.",
      ...flagged,
      "",
      "This self-check is general guidance only and does not confirm legal compliance."
    ].join("\n");
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildSummaryText());
      showToast("Summary copied");
    } catch (error) {
      showToast("Copy unavailable");
    }
  }

  function showToast(message) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    window.setTimeout(() => elements.toast.classList.remove("show"), 1800);
  }

  document.addEventListener("click", (event) => {
    const answerButton = event.target.closest("[data-answer]");
    if (answerButton) {
      state.answers[state.current] = answerButton.dataset.answer;
      render();
      elements.card.querySelectorAll(".answer-card").forEach((button) => button.classList.add("is-advancing"));
      window.clearTimeout(state.autoAdvanceTimer);
      state.autoAdvanceTimer = window.setTimeout(moveNext, 420);
      return;
    }

    if (event.target.closest("[data-prev]")) movePrev();
    if (event.target.closest("[data-reset]")) resetChecklist();
    if (event.target.closest("[data-copy]")) copySummary();
    if (event.target.closest("[data-print]")) window.print();
  });

  render();
});
