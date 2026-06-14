// IronGate GitHub-safe localStorage rebuild
// Simple browser-safe JavaScript. No modules. No crypto. No :has() dependency.

var STORAGE_KEY = "irongateInspections_v1";
var currentInspectionId = null;
var inspectionStarted = false;
var currentTab = "home";
var fenceCounter = 0;
var climbabilityCounter = 0;
var downloadDetailsState = [];
var downloadTextareaState = [];
var downloadModeActive = false;


var FIREBASE_CONFIG = {
  apiKey: "AIzaSyCAf5QQvK5VrGkveCj8I3pVvctB3383-Nw",
  authDomain: "irongate-pool-inspections.firebaseapp.com",
  projectId: "irongate-pool-inspections",
  storageBucket: "irongate-pool-inspections.firebasestorage.app",
  messagingSenderId: "700392380285",
  appId: "1:700392380285:web:99a855fd6bcc70fd22de14",
  measurementId: "G-X9KMFVCKP6"
};

var firebaseApp = null;
var firebaseAuth = null;
var firebaseDb = null;
var firebaseUser = null;
var firebaseEnabled = false;
var firebaseDataLoaded = false;
var firebaseApprovalChecked = false;
var firebaseApproved = false;
var firebaseLoadError = "";
var cloudInspections = [];
var cloudUnsubscribe = null;
var cloudSaveTimer = null;
var cloudSavePendingData = null;
var authUiReady = false;

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

function getLocalInspections() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch (error) {
    return [];
  }
}

function setLocalInspections(inspections) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(inspections));
}

function getInspections() {
  // Secure Firebase build: inspection records are loaded from Firestore only after sign-in.
  return firebaseUser && firebaseApproved ? cloudInspections.slice() : [];
}

function setInspections(inspections) {
  if (firebaseUser && firebaseApproved) {
    cloudInspections = inspections.slice();
  }
}

function canUseApp() {
  return !!firebaseUser && firebaseApproved && firebaseDataLoaded;
}

function redirectToLogin(reason) {
  var target = "login.html" + (reason ? "?" + reason : "");
  if (window.location.pathname.indexOf("login.html") === -1) {
    window.location.replace(target);
  }
}

function sanitizeInspectionForCloud(data) {
  var clean = JSON.parse(JSON.stringify(data || {}));

  // Photos are intentionally kept out of Firestore for this first Firebase build.
  // Firestore is for the form/checklist data. Photo cloud upload should use Firebase Storage later.
  clean.photos = {};
  (clean.fenceSections || []).forEach(function (section) { section.photos = []; });
  (clean.climbabilitySections || []).forEach(function (section) { section.photos = []; });
  clean.photoStorageMode = "local-only";

  var status = getInspectionStatus(clean);
  clean.status = status.status;
  clean.completedSections = status.completedSections;
  clean.totalSections = status.totalSections;
  clean.progressText = status.completedSections + "/" + status.totalSections + " sections complete";

  return clean;
}

function saveInspectionToCloudNow(data, showAlert) {
  if (!firebaseEnabled || !firebaseUser || !firebaseApproved || !firebaseDb || !data || !data.id) return;

  var clean = sanitizeInspectionForCloud(data);

  firebaseDb
    .collection("users")
    .doc(firebaseUser.uid)
    .collection("inspections")
    .doc(clean.id)
    .set(clean, { merge: true })
    .then(function () {
      setFirebaseStatus("Saved online", false);
      if (showAlert) alert("Inspection saved online.");
    })
    .catch(function (error) {
      console.error(error);
      setFirebaseStatus("Could not save online. Check Firestore rules.", true);
      if (showAlert) alert("Could not save online: " + error.message);
    });
}

function queueCloudSave(data, showAlert) {
  if (!firebaseEnabled || !firebaseUser || !firebaseApproved || !firebaseDb || !data || !data.id) return;

  cloudSavePendingData = data;
  clearTimeout(cloudSaveTimer);

  if (showAlert) {
    saveInspectionToCloudNow(cloudSavePendingData, true);
    cloudSavePendingData = null;
    return;
  }

  cloudSaveTimer = setTimeout(function () {
    saveInspectionToCloudNow(cloudSavePendingData, false);
    cloudSavePendingData = null;
  }, 800);
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

function prepareBlankDropdowns(root) {
  var scope = root || document;
  scope.querySelectorAll("select[data-save]").forEach(function (select) {
    var first = select.options[0];
    if (!first || first.value !== "") {
      var blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "";
      select.insertBefore(blank, first || null);
    } else {
      first.textContent = "";
    }
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
  if (!canUseApp()) {
    alert("Please sign in first so the inspection can be saved online.");
    return;
  }

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
  qsa(".section-card .photo-widget").forEach(function (widget) {
    if (widget.closest(".fence-card")) return;

    var area = widget.getAttribute("data-photo-area");
    if (!area) return;

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
  if (!canUseApp()) {
    if (showAlert) alert("Please sign in before saving inspections online.");
    return;
  }

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
  queueCloudSave(data, showAlert);
  renderInspectionList();
  refreshSummary();

  if (showAlert && !firebaseEnabled) {
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

function getInspectionById(id) {
  return getInspections().find(function (item) {
    return item.id === id;
  });
}

function loadInspectionIntoForm(data) {
  if (!data) return false;

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
    var widget = qs('.photo-widget[data-photo-area="' + areaName + '"]');
    var grid = widget ? widget.querySelector(".photo-grid") : null;
    restorePhotosToGrid(grid, photos[areaName]);
  });

  refreshSummary();
  updateNavLock();
  return true;
}

function openInspection(id) {
  var data = getInspectionById(id);
  if (!loadInspectionIntoForm(data)) return;
  showTab("details");
}

function deleteInspection(id) {
  if (!confirm("Delete this inspection?")) return;

  var inspections = getInspections().filter(function (item) {
    return item.id !== id;
  });

  setInspections(inspections);
  setLocalInspections(getLocalInspections().filter(function (item) { return item.id !== id; }));

  if (firebaseEnabled && firebaseUser && firebaseDb) {
    firebaseDb
      .collection("users")
      .doc(firebaseUser.uid)
      .collection("inspections")
      .doc(id)
      .delete()
      .catch(function (error) {
        console.error(error);
        alert("Could not delete online: " + error.message);
      });
  }

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

  if (!inspections.length) return;

  var inProgress = [];
  var completed = [];

  inspections.forEach(function (inspection) {
    var status = getInspectionStatus(inspection);
    if (status.status === "Ready") {
      completed.push({ inspection: inspection, status: status });
    } else {
      inProgress.push({ inspection: inspection, status: status });
    }
  });

  appendInspectionGroup(list, "In Progress Inspections", inProgress, false);
  appendInspectionGroup(list, "Completed Inspections", completed, true);
}

function appendInspectionGroup(parent, title, items, allowDownload) {
  var section = document.createElement("section");
  section.className = "inspection-list-section";

  var heading = document.createElement("h3");
  heading.className = "inspection-list-title";
  heading.textContent = title;
  section.appendChild(heading);

  if (!items.length) {
    var empty = document.createElement("p");
    empty.className = "inspection-list-empty";
    empty.textContent = allowDownload ? "No completed inspections yet." : "No in-progress inspections.";
    section.appendChild(empty);
    parent.appendChild(section);
    return;
  }

  items.forEach(function (item) {
    section.appendChild(createInspectionCard(item.inspection, item.status, allowDownload));
  });

  parent.appendChild(section);
}

function createInspectionCard(inspection, status, allowDownload) {
  var s = getBasicSummary(inspection);
  var card = document.createElement("article");
  card.className = "saved-inspection-card";

  var downloadButton = allowDownload
    ? '<button class="saved-inspection-btn download" type="button">Download <span aria-hidden="true">🡇</span></button>'
    : "";

  card.innerHTML =
    '<div class="saved-inspection-main">' +
      '<strong>' + escapeHtml(s.number) + '</strong>' +
      '<div class="meta">' +
        escapeHtml(s.owner) + '<br>' +
        escapeHtml(s.address) + '<br>' +
        'Last updated: ' + escapeHtml(formatDateTime(s.updatedAt || s.date)) +
      '</div>' +
      '<div class="saved-inspection-status ' + escapeHtml(status.statusClass) + '">Status: ' + escapeHtml(status.status) + '</div>' +
      '<div class="saved-inspection-progress">Progress: ' + status.completedSections + '/' + status.totalSections + ' sections complete</div>' +
    '</div>' +
    '<div class="saved-inspection-actions">' +
      '<button class="saved-inspection-btn open" type="button">Open</button>' +
      downloadButton +
    '</div>';

  card.querySelector(".saved-inspection-main").addEventListener("click", function () {
    openInspection(inspection.id);
  });

  card.querySelector(".saved-inspection-btn.open").addEventListener("click", function () {
    openInspection(inspection.id);
  });

  var download = card.querySelector(".saved-inspection-btn.download");
  if (download) {
    download.addEventListener("click", function () {
      startDownloadInspection(inspection.id);
    });
  }

  return card;
}

function getInspectionStatus(data) {
  var sections = getSectionCompletion(data);
  var keys = Object.keys(sections);
  var completed = keys.filter(function (key) { return sections[key].complete; }).length;
  var hasAttention = inspectionNeedsAttention(data);
  var hasData = inspectionHasMeaningfulData(data);
  var status = "In progress";

  if (!hasData && completed === 0) {
    status = "Not started";
  } else if (hasAttention) {
    status = "Needs attention";
  } else if (completed === keys.length) {
    status = "Ready";
  }

  return {
    status: status,
    statusClass: status.toLowerCase().replace(/\s+/g, "-"),
    completedSections: completed,
    totalSections: keys.length,
    sections: sections
  };
}

function getSectionCompletion(data) {
  return {
    details: { complete: detailsComplete(data) },
    barrier: { complete: barrierComplete(data) },
    climbability: { complete: climbabilityComplete(data) },
    gate: { complete: gateComplete(data) },
    safety: { complete: safetyComplete(data) }
  };
}

function detailsComplete(data) {
  var f = data.fields || {};
  return fieldsFilled(f, [
    "inspectionDate",
    "inspectorName",
    "ownerName",
    "propertyAddress",
    "inspectionType",
    "inspectionPurpose",
    "poolType",
    "sharedPool",
    "holds300mmWater",
    "regulatedPool",
    "regulatedLand",
    "multiplePools",
    "sharedStatusConfirmed",
    "poolTypeConfirmed",
    "weatherVisibility",
    "siteAccessCondition"
  ]);
}

function barrierComplete(data) {
  var f = data.fields || {};
  var staticComplete = fieldsFilled(f, [
    "barrierLocation",
    "barrierSurroundsPool",
    "buildingAccessControlled",
    "neighbourAccessControlled",
    "poolAreaFreeOfUnrelatedStructures",
    "specialPoolFeatureLocation",
    "specialPoolFeatureType",
    "poolWallUsedAsBarrier",
    "poolWallHeightCompliant",
    "ladderAccessSecured",
    "pumpFilterClimbableAccess",
    "holdingTank300mmOrDeeper"
  ]);

  var fenceSections = data.fenceSections || [];
  var fenceComplete = fenceSections.length > 0 && fenceSections.every(function (section) {
    return fieldsFilled(section.fields || {}, ["fenceLocation", "fenceType", "fenceHeight", "fenceGaps"]);
  });

  return staticComplete && fenceComplete;
}

function climbabilityComplete(data) {
  var f = data.fields || {};
  var staticComplete = fieldsFilled(f, [
    "nczOverallLocation",
    "nczSideOfBarrier",
    "ncz900Provided",
    "nczCorrectSide",
    "nczNoHandholdsFootholds",
    "nczProjectionsIndentationsCompliant",
    "nczVegetationNonClimbable",
    "nczObjectsRemoved",
    "additionalClearAreaLocation",
    "additionalClearAreaRequired",
    "additionalClearAreaMaintained",
    "effectiveBarrierHeightMaintained",
    "stepsLedgesRaisedAreasClear",
    "tapsPowerOutletsAssessed",
    "raisedGardenBedsAssessed"
  ]);

  var climbabilitySections = data.climbabilitySections || [];
  var itemComplete = climbabilitySections.length > 0 && climbabilitySections.every(function (section) {
    return fieldsFilled(section.fields || {}, ["nczLocation", "nczObjectType", "nczCompliant"]);
  });

  return staticComplete && itemComplete;
}

function gateComplete(data) {
  var f = data.fields || {};
  return fieldsFilled(f, [
    "gateLocation",
    "gateType",
    "gateSwingsAway",
    "gateSelfClosing",
    "gateSelfLatching",
    "gateClosesFromAnyPosition",
    "gateLatchPreventsReopening",
    "gateFullArc",
    "gateCannotBeProppedOpen",
    "gateGapUnderCompliant",
    "gateLatchHeightCompliant",
    "gateLatchShielded",
    "gateLatchReachThroughGaps",
    "gateHingesSafe",
    "gateHardwareSecure"
  ]);
}

function safetyComplete(data) {
  var f = data.fields || {};
  return fieldsFilled(f, [
    "cprSignPresentSafety",
    "cprSignVisible",
    "cprSignWeatherproof",
    "cprSignMinimumSize",
    "cprSignContentCompliant",
    "buildingAccessType",
    "buildingAccessLocation",
    "directBuildingAccessControlled",
    "windowOpeningRestricted",
    "screenBarsMeshFixed",
    "fixingsRequireTools",
    "doorAccessCompliant",
    "fireExitNotCompromised",
    "sharpEdgesAbsent",
    "sharpProjectionsAbsent",
    "entrapmentSpacesAbsent",
    "looseBrokenComponentsAbsent",
    "rustedWeakenedComponentsAbsent",
    "siteHazardsNoted",
    "temporaryFencingPresent",
    "temporaryFenceSecure",
    "buildingWorkAffectingBarrier",
    "barrierNotAlteredUnsafely",
    "minorRepairsMaintenanceNoted",
    "poolClaimedDecommissioned",
    "cannotHold300mmWater",
    "convertedPoolUse",
    "registerUpdateRequired",
    "electricalIssueObserved",
    "bondingConcernNoted",
    "possibleAsbestosObserved",
    "fireSafetyIssueObserved",
    "referralRecommended",
    "overallInspectionResult",
    "certificateReadyToIssue",
    "nonconformityNoticeRequired",
    "reinspectionRequired",
    "ownerAdvisedActions"
  ]);
}

function fieldsFilled(fields, names) {
  return names.every(function (name) {
    return fieldFilled(fields[name]);
  });
}

function fieldFilled(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  return String(value).trim() !== "";
}

function inspectionNeedsAttention(data) {
  var hasAttention = false;

  function checkFields(fields) {
    Object.keys(fields || {}).forEach(function (name) {
      var value = fields[name];
      if (value === "Fail") hasAttention = true;
      if (value === true && /defect|noncompliant|nonCompliant/i.test(name)) hasAttention = true;
    });
  }

  checkFields(data.fields || {});
  (data.fenceSections || []).forEach(function (section) { checkFields(section.fields || {}); });
  (data.climbabilitySections || []).forEach(function (section) { checkFields(section.fields || {}); });

  return hasAttention;
}

function inspectionHasMeaningfulData(data) {
  var ignored = {
    inspectionNumber: true,
    inspectionDate: true
  };
  var hasData = false;

  function checkFields(fields) {
    Object.keys(fields || {}).forEach(function (name) {
      if (ignored[name]) return;
      if (fieldFilled(fields[name])) hasData = true;
    });
  }

  checkFields(data.fields || {});
  (data.fenceSections || []).forEach(function (section) { checkFields(section.fields || {}); });
  (data.climbabilitySections || []).forEach(function (section) { checkFields(section.fields || {}); });

  return hasData;
}

function startDownloadInspection(id) {
  if (inspectionStarted) {
    saveCurrentInspection(false);
  }

  var data = getInspectionById(id);
  if (!data) {
    alert("This saved inspection could not be found.");
    renderInspectionList();
    showTab("home");
    return;
  }

  if (!loadInspectionIntoForm(data)) return;

  showTab("home");
  enterDownloadMode();
}

function enterDownloadMode() {
  downloadModeActive = true;
  downloadDetailsState = [];

  qsa("details").forEach(function (detailsEl) {
    downloadDetailsState.push({ element: detailsEl, open: detailsEl.open });
    detailsEl.open = true;
  });

  expandTextareasForDownload();

  document.body.classList.add("download-mode");
  ensureDownloadCloseButton();

  var closeBtn = qs("#downloadCloseBtn");
  if (closeBtn) closeBtn.hidden = false;

  window.scrollTo(0, 0);
  window.print();
}

function expandTextareasForDownload() {
  downloadTextareaState = [];

  qsa("textarea").forEach(function (textarea) {
    downloadTextareaState.push({ element: textarea, height: textarea.style.height });
    textarea.style.height = "auto";
    textarea.style.height = (textarea.scrollHeight + 2) + "px";
  });
}

function restoreTextareasAfterDownload() {
  downloadTextareaState.forEach(function (state) {
    if (state.element) state.element.style.height = state.height;
  });
  downloadTextareaState = [];
}

function ensureDownloadCloseButton() {
  if (qs("#downloadCloseBtn")) return;

  var btn = document.createElement("button");
  btn.id = "downloadCloseBtn";
  btn.className = "download-close-btn";
  btn.type = "button";
  btn.hidden = true;
  btn.innerHTML = '<span aria-hidden="true">🗙</span> Close';
  btn.addEventListener("click", closeDownloadMode);

  document.body.appendChild(btn);
}

function closeDownloadMode() {
  downloadModeActive = false;
  document.body.classList.remove("download-mode");

  downloadDetailsState.forEach(function (state) {
    if (state.element) state.element.open = state.open;
  });
  downloadDetailsState = [];
  restoreTextareasAfterDownload();

  var closeBtn = qs("#downloadCloseBtn");
  if (closeBtn) closeBtn.hidden = true;

  currentInspectionId = null;
  inspectionStarted = false;
  clearFormForNewInspection();
  renderInspectionList();
  showTab("home");
  updateNavLock();
}

function formatDateTime(value) {
  if (!value) return "No date entered";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return formatDate(value);
  var date = new Date(value);
  if (isNaN(date.getTime())) return formatDate(value);
  return String(date.getDate()).padStart(2, "0") + "/" +
    String(date.getMonth() + 1).padStart(2, "0") + "/" +
    date.getFullYear();
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
  prepareBlankDropdowns(card);
  if (!data) {
    card.querySelectorAll("select[data-save]").forEach(function (select) {
      select.selectedIndex = 0;
    });
  }

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
  prepareBlankDropdowns(card);
  if (!data) {
    card.querySelectorAll("select[data-save]").forEach(function (select) {
      select.selectedIndex = 0;
    });
  }

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


function getCurrentUserProfileRef() {
  if (!firebaseDb || !firebaseUser) return null;
  return firebaseDb.collection("users").doc(firebaseUser.uid);
}

function createPendingProfileForCurrentUser() {
  var ref = getCurrentUserProfileRef();
  if (!ref || !firebaseUser) return Promise.reject(new Error("No signed-in user."));

  var providerIds = (firebaseUser.providerData || []).map(function (provider) {
    return provider.providerId;
  });

  return ref.set({
    email: firebaseUser.email || "",
    displayName: firebaseUser.displayName || "",
    approved: false,
    role: "pending",
    providerIds: providerIds,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function ensureCurrentUserProfile() {
  var ref = getCurrentUserProfileRef();
  if (!ref) return Promise.reject(new Error("No user profile path."));

  return ref.get().then(function (doc) {
    if (doc.exists) {
      return doc.data() || {};
    }

    return createPendingProfileForCurrentUser().then(function () {
      return {
        email: firebaseUser.email || "",
        displayName: firebaseUser.displayName || "",
        approved: false,
        role: "pending"
      };
    });
  });
}

function ensureAuthUI() {
  if (authUiReady) return;
  var appShell = qs(".app-shell");
  if (!appShell) return;

  var authPanel = document.createElement("section");
  authPanel.id = "authPanel";
  authPanel.className = "auth-panel app-auth-panel";
  authPanel.innerHTML =
    '<div class="auth-copy">' +
      '<strong>IronGate cloud account</strong>' +
      '<span id="firebaseStatus">Checking access...</span>' +
    '</div>' +
    '<div id="signedInPanel" class="signed-in-panel" hidden>' +
      '<span id="signedInEmail"></span>' +
      '<button id="signOutBtn" type="button">Sign out</button>' +
    '</div>';

  appShell.insertBefore(authPanel, appShell.firstChild);

  qs("#signOutBtn").addEventListener("click", function () {
    if (!firebaseAuth) return;
    firebaseAuth.signOut().then(function () {
      window.location.replace("login.html");
    });
  });

  authUiReady = true;
}

function setFirebaseStatus(message, isError) {
  var status = qs("#firebaseStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", !!isError);
}

function updateAuthUI() {
  ensureAuthUI();

  var signedInPanel = qs("#signedInPanel");
  var signedInEmail = qs("#signedInEmail");
  var newBtn = qs("#newInspectionBtn");

  if (firebaseEnabled && firebaseUser && firebaseApproved) {
    if (signedInPanel) signedInPanel.hidden = false;
    if (signedInEmail) signedInEmail.textContent = firebaseUser.email || "Signed in";
    setFirebaseStatus(firebaseDataLoaded ? "Signed in and saving online" : "Approved. Loading inspections...", false);
    document.body.classList.remove("firebase-signed-out");
    document.body.classList.remove("auth-checking");
    if (newBtn) newBtn.disabled = !firebaseDataLoaded;
  } else if (firebaseEnabled && firebaseUser && firebaseApprovalChecked && !firebaseApproved) {
    if (signedInPanel) signedInPanel.hidden = false;
    if (signedInEmail) signedInEmail.textContent = firebaseUser.email || "Signed in";
    setFirebaseStatus("Account pending approval. Redirecting to login page...", true);
    if (newBtn) newBtn.disabled = true;
    redirectToLogin("pending=1");
  } else if (firebaseEnabled && firebaseUser) {
    if (signedInPanel) signedInPanel.hidden = false;
    if (signedInEmail) signedInEmail.textContent = firebaseUser.email || "Signed in";
    setFirebaseStatus("Checking account approval...", false);
    if (newBtn) newBtn.disabled = true;
  } else if (firebaseEnabled) {
    if (signedInPanel) signedInPanel.hidden = true;
    setFirebaseStatus("Not signed in. Redirecting...", false);
    if (newBtn) newBtn.disabled = true;
    redirectToLogin();
  } else {
    if (signedInPanel) signedInPanel.hidden = true;
    setFirebaseStatus(firebaseLoadError || "Firebase could not load.", true);
    if (newBtn) newBtn.disabled = true;
  }
}

function initFirebase() {
  ensureAuthUI();

  if (!window.firebase || !window.firebase.initializeApp) {
    firebaseEnabled = false;
    firebaseLoadError = "Firebase scripts could not load. Open login.html from a local server or hosted site.";
    updateAuthUI();
    alert(firebaseLoadError);
    return;
  }

  try {
    firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    firebaseDb = firebase.firestore();
    firebaseEnabled = true;

    firebaseAuth.onAuthStateChanged(function (user) {
      firebaseUser = user || null;
      firebaseDataLoaded = false;
      firebaseApprovalChecked = false;
      firebaseApproved = false;
      cloudInspections = [];

      if (cloudUnsubscribe) {
        cloudUnsubscribe();
        cloudUnsubscribe = null;
      }

      if (!firebaseUser) {
        currentInspectionId = null;
        inspectionStarted = false;
        updateAuthUI();
        return;
      }

      updateAuthUI();

      ensureCurrentUserProfile()
        .then(function (profile) {
          firebaseApprovalChecked = true;
          firebaseApproved = !!(profile && profile.approved === true);

          if (!firebaseApproved) {
            firebaseDataLoaded = true;
            updateAuthUI();
            return;
          }

          updateAuthUI();
          listenToCloudInspections();
        })
        .catch(function (error) {
          console.error(error);
          firebaseApprovalChecked = true;
          firebaseApproved = false;
          firebaseDataLoaded = true;
          firebaseLoadError = "Could not check account approval. Check Firestore rules.";
          setFirebaseStatus(firebaseLoadError, true);
          alert(firebaseLoadError + "\n" + error.message);
          updateAuthUI();
        });
    });
  } catch (error) {
    console.error(error);
    firebaseEnabled = false;
    firebaseLoadError = "Firebase setup failed: " + error.message;
    updateAuthUI();
    alert(firebaseLoadError);
  }
}

function listenToCloudInspections() {
  if (!firebaseUser || !firebaseApproved || !firebaseDb) return;

  setFirebaseStatus("Loading inspections...", false);

  cloudUnsubscribe = firebaseDb
    .collection("users")
    .doc(firebaseUser.uid)
    .collection("inspections")
    .orderBy("updatedAt", "desc")
    .onSnapshot(function (snapshot) {
      cloudInspections = snapshot.docs.map(function (doc) {
        var data = doc.data() || {};
        data.id = data.id || doc.id;
        data.photos = data.photos || {};
        return data;
      });
      firebaseDataLoaded = true;
      updateAuthUI();
      renderInspectionList();
    }, function (error) {
      console.error(error);
      firebaseDataLoaded = true;
      setFirebaseStatus("Could not load online inspections. Check Firestore rules.", true);
      alert("Could not load online inspections: " + error.message);
      updateAuthUI();
      renderInspectionList();
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

  prepareBlankDropdowns(document);
  bindSaveEvents(document);
  qsa(".photo-widget").forEach(bindPhotoWidget);
  initFirebase();

  renderInspectionList();
  showTab("home");
  refreshSummary();
}

document.addEventListener("DOMContentLoaded", init);
