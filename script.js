// IronGate GitHub-safe localStorage rebuild
// Simple browser-safe JavaScript. No modules. No crypto. No :has() dependency.

var STORAGE_KEY = "irongateInspections_v1";
var currentInspectionId = null;
var inspectionStarted = false;
var currentTab = "home";
var fenceCounter = 0;
var climbabilityCounter = 0;

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return Array.prototype.slice.call(document.querySelectorAll(selector));
}

function getTodayDateString() {
  var now = new Date();
  var yyyy = now.getFullYear();
  var mm = String(now.getMonth() + 1).padStart(2, "0");
  var dd = String(now.getDate()).padStart(2, "0");
  return yyyy + "-" + mm + "-" + dd;
}

function getInspections() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (error) {
    return [];
  }
}

function setInspections(inspections) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(inspections));
}

function generateId() {
  return "inspection-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
}

function generateInspectionNumber() {
  var year = new Date().getFullYear();
  var prefix = "IG-" + year + "-";
  var inspections = getInspections();
  var highest = 0;

  inspections.forEach(function (inspection) {
    var number = inspection.inspectionNumber || "";
    if (number.indexOf(prefix) === 0) {
      var end = parseInt(number.replace(prefix, ""), 10);
      if (!isNaN(end) && end > highest) {
        highest = end;
      }
    }
  });

  return prefix + String(highest + 1).padStart(4, "0");
}

function getTabName(tab) {
  return tab.getAttribute("data-tab") || "";
}

function showTab(tabName) {
  currentTab = tabName;

  qsa(".page").forEach(function (page) {
    page.classList.toggle("active-page", page.id === tabName);
  });

  qsa(".tab").forEach(function (tab) {
    tab.classList.toggle("active", getTabName(tab) === tabName);
  });

  updateNavLock();
  window.scrollTo(0, 0);
}

function updateNavLock() {
  qsa(".tab").forEach(function (tab) {
    var tabName = getTabName(tab);
    var locked = !inspectionStarted && tabName !== "home";
    tab.classList.toggle("locked", locked);
    tab.disabled = locked;
  });
}

function clearFormForNewInspection() {
  qsa("[data-save]").forEach(function (el) {
    if (el.type === "checkbox") {
      el.checked = false;
    } else if (el.tagName === "SELECT") {
      el.selectedIndex = 0;
    } else {
      el.value = "";
    }
  });

  qs("#fenceSections").innerHTML = "";
  qs("#climbabilitySections").innerHTML = "";

  qsa(".photo-grid").forEach(function (grid) {
    grid.innerHTML = "";
  });

  fenceCounter = 0;
  climbabilityCounter = 0;
}

function startNewInspection() {
  clearFormForNewInspection();

  currentInspectionId = generateId();
  inspectionStarted = true;

  qs("#inspectionNumber").value = generateInspectionNumber();
  qs("#inspectionDate").value = getTodayDateString();

  addFenceSection();
  addClimbabilitySection();

  saveCurrentInspection(false);
  renderInspectionList();
  showTab("details");
}

function getFieldValue(name) {
  var el = qs('[name="' + name + '"]');
  if (!el) return "";
  return el.type === "checkbox" ? el.checked : el.value;
}

function getBasicSummary(data) {
  var fields = data.fields || {};
  return {
    number: fields.inspectionNumber || data.inspectionNumber || "Unnamed",
    owner: fields.ownerName || "No client entered",
    address: fields.propertyAddress || "No address entered",
    date: fields.inspectionDate || "",
    updatedAt: data.updatedAt || ""
  };
}

function gatherNormalFields() {
  var fields = {};
  qsa("[data-save]").forEach(function (el) {
    if (el.closest(".fence-card") || el.closest(".climbability-card")) return;
    fields[el.name] = el.type === "checkbox" ? el.checked : el.value;
  });
  return fields;
}

function gatherFenceSections() {
  return qsa(".fence-card:not(.climbability-card)").map(function (card) {
    var fields = {};
    card.querySelectorAll("[data-save]").forEach(function (el) {
      fields[el.name] = el.type === "checkbox" ? el.checked : el.value;
    });
    var photos = [];
    card.querySelectorAll(".photo-box img").forEach(function (img) {
      photos.push(img.src);
    });
    return { fields: fields, photos: photos };
  });
}

function gatherClimbabilitySections() {
  return qsa(".climbability-card").map(function (card) {
    var fields = {};
    card.querySelectorAll("[data-save]").forEach(function (el) {
      fields[el.name] = el.type === "checkbox" ? el.checked : el.value;
    });
    var photos = [];
    card.querySelectorAll(".photo-box img").forEach(function (img) {
      photos.push(img.src);
    });
    return { fields: fields, photos: photos };
  });
}

function gatherSectionPhotos() {
  var photos = {};
  qsa(".section-card > .photo-widget").forEach(function (widget) {
    var area = widget.getAttribute("data-photo-area");
    photos[area] = [];
    widget.querySelectorAll(".photo-box img").forEach(function (img) {
      photos[area].push(img.src);
    });
  });
  return photos;
}

function gatherInspectionData() {
  var fields = gatherNormalFields();
  return {
    id: currentInspectionId || generateId(),
    inspectionNumber: fields.inspectionNumber || generateInspectionNumber(),
    fields: fields,
    photos: gatherSectionPhotos(),
    fenceSections: gatherFenceSections(),
    climbabilitySections: gatherClimbabilitySections(),
    inspectionStarted: inspectionStarted,
    updatedAt: new Date().toISOString()
  };
}

function saveCurrentInspection(showAlert) {
  if (!inspectionStarted) return;

  var data = gatherInspectionData();
  currentInspectionId = data.id;

  var inspections = getInspections();
  var index = inspections.findIndex(function (item) {
    return item.id === data.id;
  });

  if (index >= 0) {
    inspections[index] = data;
  } else {
    inspections.push(data);
  }

  setInspections(inspections);
  renderInspectionList();
  refreshSummary();

  if (showAlert) {
    alert("Inspection saved on this device.");
  }
}

function restoreFields(fields) {
  qsa("[data-save]").forEach(function (el) {
    if (el.closest(".fence-card") || el.closest(".climbability-card")) return;
    if (!fields || fields[el.name] === undefined) return;

    if (el.type === "checkbox") {
      el.checked = !!fields[el.name];
    } else {
      el.value = fields[el.name];
    }
  });
}

function restoreCardFields(card, fields) {
  card.querySelectorAll("[data-save]").forEach(function (el) {
    if (!fields || fields[el.name] === undefined) return;

    if (el.type === "checkbox") {
      el.checked = !!fields[el.name];
    } else {
      el.value = fields[el.name];
    }
  });
}

function restorePhotosToGrid(grid, photos) {
  if (!grid || !photos) return;
  photos.forEach(function (src) {
    addPhotoToGrid(grid, src);
  });
}

function openInspection(id) {
  var inspections = getInspections();
  var data = inspections.find(function (item) {
    return item.id === id;
  });

  if (!data) return;

  clearFormForNewInspection();

  currentInspectionId = data.id;
  inspectionStarted = true;

  restoreFields(data.fields || {});

  if (data.fenceSections && data.fenceSections.length) {
    data.fenceSections.forEach(function (section) {
      addFenceSection(section);
    });
  } else {
    addFenceSection();
  }

  if (data.climbabilitySections && data.climbabilitySections.length) {
    data.climbabilitySections.forEach(function (section) {
      addClimbabilitySection(section);
    });
  } else {
    addClimbabilitySection();
  }

  var photos = data.photos || {};
  Object.keys(photos).forEach(function (areaName) {
    var widget = qs('.section-card > .photo-widget[data-photo-area="' + areaName + '"]');
    var grid = widget ? widget.querySelector(".photo-grid") : null;
    restorePhotosToGrid(grid, photos[areaName]);
  });

  refreshSummary();
  showTab("details");
}

function deleteInspection(id) {
  if (!confirm("Delete this inspection from this device?")) return;

  var inspections = getInspections().filter(function (item) {
    return item.id !== id;
  });

  setInspections(inspections);

  if (currentInspectionId === id) {
    currentInspectionId = null;
    inspectionStarted = false;
    clearFormForNewInspection();
    showTab("home");
  }

  renderInspectionList();
}

function deleteCurrentInspection() {
  if (!currentInspectionId) return;
  deleteInspection(currentInspectionId);
}

function renderInspectionList() {
  var list = qs("#inspectionList");
  var empty = qs("#emptyState");
  if (!list) return;

  var inspections = getInspections();

  inspections.sort(function (a, b) {
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  list.innerHTML = "";

  if (empty) {
    empty.style.display = inspections.length ? "none" : "block";
  }

  inspections.forEach(function (inspection) {
    var s = getBasicSummary(inspection);
    var card = document.createElement("button");
    card.type = "button";
    card.className = "saved-inspection-card";

    card.innerHTML =
      '<div>' +
        '<strong>' + escapeHtml(s.number) + '</strong>' +
        '<div class="meta">' +
          escapeHtml(s.owner) + '<br>' +
          escapeHtml(s.address) + '<br>' +
          escapeHtml(formatDate(s.date)) +
        '</div>' +
      '</div>' +
      '<span class="status">Open</span>';

    card.addEventListener("click", function () {
      openInspection(inspection.id);
    });

    list.appendChild(card);
  });
}

function formatDate(value) {
  if (!value) return "No date entered";
  var parts = value.split("-");
  if (parts.length !== 3) return value;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fenceTemplate(number) {
  return '' +
    '<div class="fence-card-head">' +
      '<h3>Fence Section ' + number + '</h3>' +
      '<button class="remove-section-btn" type="button">Remove</button>' +
    '</div>' +
    '<label class="check-field defect-toggle">' +
      '<input data-save name="fenceNonCompliant" type="checkbox" />' +
      '<span>Non-compliant</span>' +
    '</label>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="fenceLocation" type="text" placeholder="e.g. North side fence" /></label>' +
      '<label class="field"><span>Fence Type</span><select data-save name="fenceType"><option value="">Select type</option><option>Aluminium</option><option>Glass</option><option>Timber</option><option>Chainwire / mesh</option><option>Masonry</option><option>Other</option></select></label>' +
      '<label class="field"><span>Height (mm)</span><input data-save name="fenceHeight" type="number" placeholder="1200" /></label>' +
      '<label class="field"><span>Ground Clearance (mm)</span><input data-save name="fenceGroundClearance" type="number" placeholder="100" /></label>' +
      '<label class="field"><span>Openings / Gaps Compliant</span><select data-save name="fenceGaps"><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="fenceComments" placeholder="Notes, non-compliance details or recommendation..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="fence-' + number + '">' +
      '<button class="camera-btn" type="button">+ Evidence Photo</button>' +
      '<input type="file" accept="image/*" capture="environment" multiple hidden />' +
      '<div class="photo-grid"></div>' +
    '</div>';
}

function addFenceSection(data) {
  var list = qs("#fenceSections");
  if (!list) return;

  fenceCounter += 1;

  var card = document.createElement("article");
  card.className = "fence-card";
  card.setAttribute("data-section", "fence");
  card.innerHTML = fenceTemplate(fenceCounter);

  card.querySelector(".remove-section-btn").addEventListener("click", function () {
    card.remove();
    renumberFenceSections();
    saveCurrentInspection(false);
    refreshSummary();
  });

  bindSaveEvents(card);
  bindPhotoWidget(card.querySelector(".photo-widget"));
  list.appendChild(card);

  if (data) {
    restoreCardFields(card, data.fields || {});
    restorePhotosToGrid(card.querySelector(".photo-grid"), data.photos || []);
  }

  refreshSummary();
}

function renumberFenceSections() {
  qsa(".fence-card:not(.climbability-card)").forEach(function (card, index) {
    var h3 = card.querySelector("h3");
    if (h3) h3.textContent = "Fence Section " + (index + 1);
  });
}

function climbabilityTemplate(number) {
  return '' +
    '<div class="fence-card-head">' +
      '<h3>Climbability Check ' + number + '</h3>' +
      '<button class="remove-section-btn" type="button">Remove</button>' +
    '</div>' +
    '<label class="check-field defect-toggle">' +
      '<input data-save name="climbabilityNonCompliant" type="checkbox" />' +
      '<span>Non-compliant</span>' +
    '</label>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="nczLocation" type="text" placeholder="e.g. Near pump equipment" /></label>' +
      '<label class="field"><span>Object Type</span><select data-save name="nczObjectType"><option>None observed</option><option>Tree / vegetation</option><option>Pot plant</option><option>Furniture</option><option>Pool equipment</option><option>Retaining wall</option><option>Tap / power outlet</option><option>Other</option></select></label>' +
      '<label class="field"><span>Distance From Barrier (mm)</span><input data-save name="nczDistance" type="number" placeholder="900" /></label>' +
      '<label class="field"><span>NCZ Compliant</span><select data-save name="nczCompliant"><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="nczComments" placeholder="Notes, non-compliance details or recommendation..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="climbability-' + number + '">' +
      '<button class="camera-btn" type="button">+ Evidence Photo</button>' +
      '<input type="file" accept="image/*" capture="environment" multiple hidden />' +
      '<div class="photo-grid"></div>' +
    '</div>';
}

function addClimbabilitySection(data) {
  var list = qs("#climbabilitySections");
  if (!list) return;

  climbabilityCounter += 1;

  var card = document.createElement("article");
  card.className = "fence-card climbability-card";
  card.setAttribute("data-section", "climbabilityItem");
  card.innerHTML = climbabilityTemplate(climbabilityCounter);

  card.querySelector(".remove-section-btn").addEventListener("click", function () {
    card.remove();
    renumberClimbabilitySections();
    saveCurrentInspection(false);
    refreshSummary();
  });

  bindSaveEvents(card);
  bindPhotoWidget(card.querySelector(".photo-widget"));
  list.appendChild(card);

  if (data) {
    restoreCardFields(card, data.fields || {});
    restorePhotosToGrid(card.querySelector(".photo-grid"), data.photos || []);
  }

  refreshSummary();
}

function renumberClimbabilitySections() {
  qsa(".climbability-card").forEach(function (card, index) {
    var h3 = card.querySelector("h3");
    if (h3) h3.textContent = "Climbability Check " + (index + 1);
  });
}

function bindPhotoWidget(widget) {
  if (!widget || widget.getAttribute("data-bound") === "true") return;

  widget.setAttribute("data-bound", "true");

  var btn = widget.querySelector(".camera-btn");
  var input = widget.querySelector('input[type="file"]');
  var grid = widget.querySelector(".photo-grid");

  if (!btn || !input || !grid) return;

  btn.addEventListener("click", function () {
    input.click();
  });

  input.addEventListener("change", function () {
    var files = Array.prototype.slice.call(input.files || []);
    files.forEach(function (file) {
      var reader = new FileReader();

      reader.onload = function (event) {
        addPhotoToGrid(grid, event.target.result);
        saveCurrentInspection(false);
      };

      reader.readAsDataURL(file);
    });

    input.value = "";
  });
}

function addPhotoToGrid(grid, src) {
  if (!grid || !src) return;

  var box = document.createElement("div");
  box.className = "photo-box";

  box.innerHTML =
    '<img src="' + src + '" alt="inspection photo">' +
    '<button class="remove-photo" type="button" aria-label="Remove photo">×</button>' +
    '<div class="timestamp">' + new Date().toLocaleString() + '<br>IronGate Pool Inspections</div>';

  box.querySelector(".remove-photo").addEventListener("click", function () {
    box.remove();
    saveCurrentInspection(false);
  });

  grid.appendChild(box);
}

function getFieldLabel(el) {
  var label = el.closest("label");
  var span = label ? label.querySelector("span") : null;
  return span ? span.textContent.trim() : el.name;
}

function markFailures() {
  qsa(".section-card[data-section], .fence-card").forEach(function (card) {
    var nonCompliant = false;
    var defectInput = card.querySelector(".defect-toggle input");
    if (defectInput && defectInput.checked) nonCompliant = true;

    var failedSelect = false;
    card.querySelectorAll("select").forEach(function (select) {
      if (select.value === "Fail") failedSelect = true;
    });

    card.classList.toggle("defect-active", nonCompliant);
    card.classList.toggle("fail-highlight", failedSelect);
  });
}

function refreshSummary() {
  markFailures();

  var summary = qs("#failureSummary");
  if (!summary) return;

  summary.innerHTML = "";

  qsa(".fence-card:not(.climbability-card)").forEach(function (card) {
    addCardToSummary(card, "Fence Section", 'input[name="fenceLocation"]');
  });

  qsa(".climbability-card").forEach(function (card) {
    addCardToSummary(card, "Climbability Check", 'input[name="nczLocation"]');
  });

  qsa(".section-card[data-section]").forEach(function (card) {
    var section = card.getAttribute("data-section");
    if (section === "details" || section === "barrier" || section === "climbability") return;
    addCardToSummary(card, card.querySelector("h2") ? card.querySelector("h2").textContent : section, 'input[name$="Location"]');
  });

  if (!summary.children.length) {
    var li = document.createElement("li");
    li.textContent = "No non-compliant checklist items recorded yet.";
    summary.appendChild(li);
  }
}

function addCardToSummary(card, fallbackTitle, locationSelector) {
  var summary = qs("#failureSummary");
  if (!summary) return;

  var titleEl = card.querySelector("h3") || card.querySelector("h2");
  var title = titleEl ? titleEl.textContent : fallbackTitle;

  var locationEl = card.querySelector(locationSelector) || card.querySelector('input[name="safetyLocation"]');
  var location = locationEl && locationEl.value ? locationEl.value : "location not entered";

  var defectInput = card.querySelector(".defect-toggle input");
  var nonCompliant = defectInput && defectInput.checked;

  var failed = [];
  card.querySelectorAll("select").forEach(function (select) {
    if (select.value === "Fail") failed.push(select);
  });

  var comments = [];
  card.querySelectorAll("textarea").forEach(function (textarea) {
    if (textarea.value.trim()) comments.push(textarea.value.trim());
  });

  if (nonCompliant || failed.length) {
    var li = document.createElement("li");
    var failText = failed.length ? failed.map(getFieldLabel).join(", ") : "Non-compliant";
    li.textContent = title + " - " + location + ": " + failText + "." + (comments.length ? " " + comments.join(" ") : "");
    summary.appendChild(li);
  }
}

function bindSaveEvents(root) {
  var scope = root || document;
  scope.querySelectorAll("[data-save]").forEach(function (el) {
    el.addEventListener("input", function () {
      if (currentTab !== "home") inspectionStarted = true;
      saveCurrentInspection(false);
    });

    el.addEventListener("change", function () {
      if (currentTab !== "home") inspectionStarted = true;
      saveCurrentInspection(false);
    });
  });
}

function init() {
  qs("#newInspectionBtn").onclick = startNewInspection;
  qs("#refreshListBtn").onclick = renderInspectionList;
  qs("#saveBtn").onclick = function () { saveCurrentInspection(true); };
  qs("#backHomeBtn").onclick = function () { showTab("home"); };
  qs("#deleteCurrentBtn").onclick = deleteCurrentInspection;
  qs("#addFenceSectionBtn").onclick = function () {
    if (!inspectionStarted) return;
    addFenceSection();
    saveCurrentInspection(false);
  };
  qs("#addClimbabilitySectionBtn").onclick = function () {
    if (!inspectionStarted) return;
    addClimbabilitySection();
    saveCurrentInspection(false);
  };

  qsa(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var requestedTab = getTabName(tab);
      if (!inspectionStarted && requestedTab !== "home") return;
      showTab(requestedTab);
    });
  });

  bindSaveEvents(document);
  qsa(".photo-widget").forEach(bindPhotoWidget);

  renderInspectionList();
  showTab("home");
  refreshSummary();
}

document.addEventListener("DOMContentLoaded", init);
