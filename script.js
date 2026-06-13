(function () {
  "use strict";

  var inspectionsKey = "irongateInspections";
  var currentInspectionId = null;
  var currentTab = "home";
  var inspectionStarted = false;
  var fenceCounter = 0;
  var climbabilityCounter = 0;

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function getAllInspections() {
    try {
      var raw = window.localStorage.getItem(inspectionsKey);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }

  function saveAllInspections(items) {
    try {
      window.localStorage.setItem(inspectionsKey, JSON.stringify(items));
      return true;
    } catch (error) {
      alert("Could not save on this browser. Try clearing old inspections or use fewer photos.");
      return false;
    }
  }

  function makeId() {
    return "inspection-" + Date.now() + "-" + Math.floor(Math.random() * 1000000);
  }

  function todayInputValue() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function displayDate(value) {
    if (!value) return "No date";
    var parts = value.split("-");
    if (parts.length !== 3) return value;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function getSavedField(item, name) {
    if (!item || !item.fields) return "";
    for (var i = 0; i < item.fields.length; i++) {
      if (item.fields[i].name === name) return item.fields[i].value || "";
    }
    return "";
  }

  function generateInspectionNumber() {
    var year = new Date().getFullYear();
    var prefix = "IG-" + year + "-";
    var inspections = getAllInspections();
    var highest = 0;

    for (var i = 0; i < inspections.length; i++) {
      var num = inspections[i].inspectionNumber || getSavedField(inspections[i], "inspectionNumber");
      if (num && num.indexOf(prefix) === 0) {
        var last = parseInt(num.split("-").pop(), 10);
        if (!isNaN(last) && last > highest) highest = last;
      }
    }

    return prefix + String(highest + 1).padStart(4, "0");
  }

  function getTabName(tab) {
    return tab.getAttribute("data-tab") || (tab.getAttribute("href") || "").replace("#", "");
  }

  function setNavLock() {
    var locked = !inspectionStarted;
    qsa(".tab").forEach(function (tab) {
      var name = getTabName(tab);
      var shouldLock = locked && name !== "home";
      if (shouldLock) tab.classList.add("locked");
      else tab.classList.remove("locked");
      tab.setAttribute("aria-disabled", shouldLock ? "true" : "false");
    });
  }

  function showTab(tabName) {
    currentTab = tabName;

    qsa(".page").forEach(function (page) {
      if (page.id === tabName) page.classList.add("active-page");
      else page.classList.remove("active-page");
    });

    qsa(".tab").forEach(function (tab) {
      if (getTabName(tab) === tabName) tab.classList.add("active");
      else tab.classList.remove("active");
    });

    setNavLock();

    try {
      history.replaceState(null, "", "#" + tabName);
    } catch (error) {}

    window.scrollTo(0, 0);
  }

  function resetScreenForNewInspection() {
    qsa("[data-save]").forEach(function (el) {
      if (el.type === "checkbox") el.checked = false;
      else if (el.tagName === "SELECT") el.selectedIndex = 0;
      else el.value = "";
    });

    qsa(".photo-grid").forEach(function (grid) {
      grid.innerHTML = "";
    });

    qsa(".fence-card").forEach(function (card) {
      card.parentNode.removeChild(card);
    });

    fenceCounter = 0;
    climbabilityCounter = 0;
    refreshSummary();
  }

  function startNewInspection() {
    resetScreenForNewInspection();

    currentInspectionId = makeId();
    inspectionStarted = true;

    var numberField = qs('[name="inspectionNumber"]');
    if (numberField) numberField.value = generateInspectionNumber();

    var dateField = qs('#inspectionDate');
    if (dateField) dateField.value = todayInputValue();

    addFenceSection(null);
    addClimbabilitySection(null);
    saveInspection(false);
    renderInspectionList();
    showTab("details");
  }

  function mountPhotoWidget(target) {
    if (!target || qs(".photo-widget", target)) return;

    var tpl = qs("#photoTemplate");
    if (!tpl) return;

    var node = document.importNode(tpl.content, true);
    var input = qs('input[type="file"]', node);
    var btn = qs(".camera-btn", node);
    var grid = qs(".photo-grid", node);

    if (btn && input) {
      btn.onclick = function () { input.click(); };
    }

    if (input) {
      input.onchange = function () {
        var files = input.files || [];
        for (var i = 0; i < files.length; i++) {
          addPhotoFromFile(grid, files[i]);
        }
        input.value = "";
      };
    }

    target.appendChild(node);
  }

  function addPhotoFromFile(grid, file) {
    var reader = new FileReader();
    reader.onload = function (event) {
      addPhoto(grid, event.target.result);
      // Photos display on screen, but are not saved to localStorage in this reliable version.
    };
    reader.readAsDataURL(file);
  }

  function addPhoto(grid, src) {
    if (!grid) return;
    var box = document.createElement("div");
    box.className = "photo-box";
    box.innerHTML = '<img src="' + src + '" alt="inspection photo">' +
      '<button class="remove-photo" type="button" aria-label="Remove photo">×</button>' +
      '<div class="timestamp">' + new Date().toLocaleString() + '<br>IronGate Pool Inspections</div>';

    var remove = qs(".remove-photo", box);
    if (remove) {
      remove.onclick = function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      };
    }
    grid.appendChild(box);
  }

  function fenceTemplate(number) {
    return '' +
      '<div class="fence-card-head"><h3>Fence Section ' + number + '</h3><button class="remove-section-btn" type="button">Remove</button></div>' +
      '<label class="check-field defect-toggle"><input data-save name="fenceNonCompliant" type="checkbox" /><span>Non-compliant</span></label>' +
      '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="fenceLocation" type="text" placeholder="e.g. North side fence" /></label>' +
      '<label class="field"><span>Fence Type</span><select data-save name="fenceType"><option value="">Select type</option><option>Aluminium</option><option>Glass</option><option>Timber</option><option>Chainwire / mesh</option><option>Masonry</option><option>Other</option></select></label>' +
      '<label class="field"><span>Height (mm)</span><input data-save name="fenceHeight" type="number" placeholder="1200" /></label>' +
      '<label class="field"><span>Ground Clearance (mm)</span><input data-save name="fenceGroundClearance" type="number" placeholder="100" /></label>' +
      '<label class="field"><span>Openings / Gaps Compliant</span><select data-save name="fenceGaps"><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="fenceComments" placeholder="Notes, non-compliance details or recommendation..."></textarea></label>' +
      '</div><div class="photo-area fence-photo-area"></div>';
  }

  function climbabilityTemplate(number) {
    return '' +
      '<div class="fence-card-head"><h3>Climbability Check ' + number + '</h3><button class="remove-section-btn" type="button">Remove</button></div>' +
      '<label class="check-field defect-toggle"><input data-save name="climbabilityNonCompliant" type="checkbox" /><span>Non-compliant</span></label>' +
      '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="nczLocation" type="text" placeholder="e.g. Near pump equipment" /></label>' +
      '<label class="field"><span>Object Type</span><select data-save name="nczObjectType"><option>None observed</option><option>Tree / vegetation</option><option>Pot plant</option><option>Furniture</option><option>Pool equipment</option><option>Retaining wall</option><option>Tap / power outlet</option><option>Other</option></select></label>' +
      '<label class="field"><span>Distance From Barrier (mm)</span><input data-save name="nczDistance" type="number" placeholder="900" /></label>' +
      '<label class="field"><span>NCZ Compliant</span><select data-save name="nczCompliant"><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="nczComments" placeholder="Notes, non-compliance details or recommendation..."></textarea></label>' +
      '</div><div class="photo-area climbability-photo-area"></div>';
  }

  function wireDynamicCard(card) {
    var remove = qs(".remove-section-btn", card);
    if (remove) {
      remove.onclick = function () {
        if (card.parentNode) card.parentNode.removeChild(card);
        renumberCards();
        refreshSummary();
        saveInspection(false);
      };
    }

    qsa("[data-save]", card).forEach(function (el) {
      el.onchange = function () {
        inspectionStarted = true;
        refreshSummary();
        saveInspection(false);
      };
      el.oninput = function () {
        inspectionStarted = true;
        saveInspection(false);
      };
    });

    mountPhotoWidget(qs(".photo-area", card));
  }

  function addFenceSection(data) {
    var list = qs("#fenceSections");
    if (!list) return;
    fenceCounter += 1;
    var card = document.createElement("article");
    card.className = "fence-card";
    card.setAttribute("data-section", "fence");
    card.innerHTML = fenceTemplate(fenceCounter);
    list.appendChild(card);
    wireDynamicCard(card);
    if (data) restoreCardValues(card, data.values);
    refreshSummary();
  }

  function addClimbabilitySection(data) {
    var list = qs("#climbabilitySections");
    if (!list) return;
    climbabilityCounter += 1;
    var card = document.createElement("article");
    card.className = "fence-card climbability-card";
    card.setAttribute("data-section", "climbabilityItem");
    card.innerHTML = climbabilityTemplate(climbabilityCounter);
    list.appendChild(card);
    wireDynamicCard(card);
    if (data) restoreCardValues(card, data.values);
    refreshSummary();
  }

  function renumberCards() {
    qsa(".fence-card:not(.climbability-card)").forEach(function (card, index) {
      var h = qs("h3", card);
      if (h) h.textContent = "Fence Section " + (index + 1);
    });
    qsa(".climbability-card").forEach(function (card, index) {
      var h = qs("h3", card);
      if (h) h.textContent = "Climbability Check " + (index + 1);
    });
  }

  function gatherCardValues(card) {
    return qsa("[data-save]", card).map(function (el) {
      return { name: el.name, value: el.type === "checkbox" ? el.checked : el.value };
    });
  }

  function gatherData() {
    var fields = qsa("[data-save]").filter(function (el) {
      return !el.closest(".fence-card") && !el.closest(".climbability-card");
    }).map(function (el) {
      return { name: el.name, value: el.type === "checkbox" ? el.checked : el.value };
    });

    var inspectionNumber = qs('[name="inspectionNumber"]') ? qs('[name="inspectionNumber"]').value : "";

    return {
      id: currentInspectionId,
      inspectionNumber: inspectionNumber,
      inspectionStarted: inspectionStarted,
      updatedAt: new Date().toISOString(),
      fields: fields,
      fenceSections: qsa(".fence-card:not(.climbability-card)").map(function (card) {
        return { values: gatherCardValues(card) };
      }),
      climbabilitySections: qsa(".climbability-card").map(function (card) {
        return { values: gatherCardValues(card) };
      })
    };
  }

  function saveInspection(showAlert) {
    if (!currentInspectionId) return;
    var items = getAllInspections();
    var data = gatherData();
    var found = false;

    for (var i = 0; i < items.length; i++) {
      if (items[i].id === currentInspectionId) {
        items[i] = data;
        found = true;
        break;
      }
    }
    if (!found) items.push(data);

    if (saveAllInspections(items)) {
      renderInspectionList();
      if (showAlert) alert("Inspection saved.");
    }
  }

  function restoreCardValues(card, values) {
    values = values || [];
    for (var i = 0; i < values.length; i++) {
      var el = qs('[name="' + values[i].name + '"]', card);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = !!values[i].value;
      else el.value = values[i].value;
    }
  }

  function restoreInspectionData(data) {
    resetScreenForNewInspection();
    currentInspectionId = data.id;
    inspectionStarted = true;

    restoreCardValues(document, data.fields || []);

    if (data.fenceSections && data.fenceSections.length) {
      for (var i = 0; i < data.fenceSections.length; i++) addFenceSection(data.fenceSections[i]);
    } else {
      addFenceSection(null);
    }

    if (data.climbabilitySections && data.climbabilitySections.length) {
      for (var j = 0; j < data.climbabilitySections.length; j++) addClimbabilitySection(data.climbabilitySections[j]);
    } else {
      addClimbabilitySection(null);
    }

    refreshSummary();
    setNavLock();
  }

  function renderInspectionList() {
    var list = qs("#inspectionList");
    var empty = qs("#emptyState");
    if (!list) return;

    var items = getAllInspections();
    items.sort(function (a, b) {
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });

    list.innerHTML = "";
    if (empty) empty.style.display = items.length ? "none" : "block";

    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var owner = getSavedField(item, "ownerName") || "Unnamed client";
        var address = getSavedField(item, "propertyAddress") || "No address entered";
        var date = getSavedField(item, "inspectionDate") || "";
        var number = item.inspectionNumber || getSavedField(item, "inspectionNumber") || "No number";

        var row = document.createElement("div");
        row.className = "saved-inspection-card";
        row.innerHTML = '<button class="saved-open" type="button">' +
          '<strong>' + escapeHtml(number) + '</strong>' +
          '<span>' + escapeHtml(owner) + '</span>' +
          '<small>' + escapeHtml(address) + '</small>' +
          '<em>' + escapeHtml(displayDate(date)) + '</em>' +
          '</button>' +
          '<button class="saved-delete" type="button" aria-label="Delete inspection">Delete</button>';

        qs(".saved-open", row).onclick = function () {
          restoreInspectionData(item);
          showTab("details");
        };

        qs(".saved-delete", row).onclick = function () {
          if (!confirm("Delete " + number + "?")) return;
          var all = getAllInspections().filter(function (x) { return x.id !== item.id; });
          saveAllInspections(all);
          if (currentInspectionId === item.id) {
            currentInspectionId = null;
            inspectionStarted = false;
            resetScreenForNewInspection();
            showTab("home");
          }
          renderInspectionList();
        };

        list.appendChild(row);
      })(items[i]);
    }
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  function getFieldLabel(el) {
    var label = el.closest("label");
    var span = label ? qs("span", label) : null;
    return span ? span.textContent.trim() : el.name;
  }

  function refreshSummary() {
    qsa(".section-card[data-section], .fence-card").forEach(function (card) {
      var defect = qs(".defect-toggle input", card);
      var nonCompliant = defect ? defect.checked : false;
      var failed = qsa("select", card).some(function (select) { return select.value === "Fail"; });
      if (nonCompliant) card.classList.add("defect-active"); else card.classList.remove("defect-active");
      if (failed) card.classList.add("fail-highlight"); else card.classList.remove("fail-highlight");
    });

    var summary = qs("#failureSummary");
    if (!summary) return;
    summary.innerHTML = "";

    qsa(".fence-card:not(.climbability-card)").forEach(function (card) {
      addCardToSummary(card, 'input[name="fenceLocation"]');
    });
    qsa(".climbability-card").forEach(function (card) {
      addCardToSummary(card, 'input[name="nczLocation"]');
    });
    qsa(".section-card[data-section]").forEach(function (card) {
      var section = card.getAttribute("data-section");
      if (section === "details" || section === "barrier" || section === "climbability") return;
      addCardToSummary(card, 'input[name$="Location"]');
    });

    if (!summary.children.length) {
      var li = document.createElement("li");
      li.textContent = "No non-compliant checklist items recorded yet.";
      summary.appendChild(li);
    }
  }

  function addCardToSummary(card, locationSelector) {
    var summary = qs("#failureSummary");
    if (!summary) return;

    var defect = qs(".defect-toggle input", card);
    var nonCompliant = defect ? defect.checked : false;
    var failed = qsa("select", card).filter(function (select) { return select.value === "Fail"; });
    if (!nonCompliant && !failed.length) return;

    var titleEl = qs("h3", card) || qs("h2", card);
    var locationEl = qs(locationSelector, card) || qs('input[name="safetyLocation"]', card);
    var comments = qsa("textarea", card).map(function (t) { return t.value.trim(); }).filter(Boolean).join(" ");
    var failText = failed.length ? failed.map(getFieldLabel).join(", ") : "Non-compliant";

    var li = document.createElement("li");
    li.textContent = (titleEl ? titleEl.textContent : "Item") + " - " + (locationEl && locationEl.value ? locationEl.value : "location not entered") + ": " + failText + "." + (comments ? " " + comments : "");
    summary.appendChild(li);
  }

  function clearCurrentInspection() {
    if (!currentInspectionId) {
      resetScreenForNewInspection();
      inspectionStarted = false;
      showTab("home");
      return;
    }
    if (!confirm("Clear this inspection from the screen? It will remain in the saved list unless you delete it from Home.")) return;
    currentInspectionId = null;
    inspectionStarted = false;
    resetScreenForNewInspection();
    showTab("home");
  }

  function init() {
    qsa(".tab").forEach(function (tab) {
      tab.onclick = function (event) {
        event.preventDefault();
        var requested = getTabName(tab);
        if (!inspectionStarted && requested !== "home") return false;
        showTab(requested);
        return false;
      };
    });

    var newBtn = qs("#newInspectionBtn");
    if (newBtn) {
      newBtn.onclick = function (event) {
        event.preventDefault();
        startNewInspection();
        return false;
      };
    }

    var addFence = qs("#addFenceSectionBtn");
    if (addFence) addFence.onclick = function () { inspectionStarted = true; addFenceSection(null); saveInspection(false); };

    var addClimb = qs("#addClimbabilitySectionBtn");
    if (addClimb) addClimb.onclick = function () { inspectionStarted = true; addClimbabilitySection(null); saveInspection(false); };

    var saveBtn = qs("#saveBtn");
    if (saveBtn) saveBtn.onclick = function () { saveInspection(true); };

    var loadBtn = qs("#loadBtn");
    if (loadBtn) loadBtn.onclick = function () { renderInspectionList(); alert("Use the Home list to open a saved inspection."); showTab("home"); };

    var clearBtn = qs("#clearBtn");
    if (clearBtn) clearBtn.onclick = clearCurrentInspection;

    qsa(".photo-area").forEach(mountPhotoWidget);

    qsa("[data-save]").forEach(function (el) {
      if (el.closest(".fence-card") || el.closest(".climbability-card")) return;
      el.onchange = function () { inspectionStarted = true; refreshSummary(); saveInspection(false); };
      el.oninput = function () { if (currentInspectionId) saveInspection(false); };
    });

    renderInspectionList();
    inspectionStarted = false;
    showTab("home");
    refreshSummary();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
