// IronGate Firebase cloud rebuild
// Simple browser-safe JavaScript. No modules. No crypto. No :has() dependency.
// Firestore stores inspection data. Firebase Storage stores evidence photos.
var currentInspectionId = null;
var inspectionStarted = false;
var currentTab = "home";
var fenceCounter = 0;
var climbabilityCounter = 0;
var balconyCounter = 0;
var retainingWallCounter = 0;
var boundaryCounter = 0;
var gateCounter = 0;
var specialPoolFeatureCounter = 0;
var waterBarrierCounter = 0;
var barrierWindowCounter = 0;
var barrierDoorCounter = 0;
var temporaryFenceCounter = 0;
var decommissionedPoolCounter = 0;
var referralCounter = 0;
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
var firebaseStorage = null;
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

  clean.photos = normalizePhotoCollections(clean.photos || {});

  [
    "fenceSections",
    "climbabilitySections",
    "balconySections",
    "retainingWallSections",
    "boundarySections",
    "specialPoolFeatureSections",
    "waterBarrierSections",
    "barrierWindowSections",
    "barrierDoorSections",
    "gateSections",
    "temporaryFenceSections",
    "decommissionedPoolSections",
    "referralSections"
  ].forEach(function (sectionKey) {
    (clean[sectionKey] || []).forEach(function (section) {
      section.photos = normalizePhotoArray(section.photos || []);
    });
  });

  clean.photoStorageMode = "firebase-storage";

  var status = getInspectionStatus(clean);
  clean.status = status.status;
  clean.completedSections = status.completedSections;
  clean.totalSections = status.totalSections;
  clean.progressText = status.completedSections + "/" + status.totalSections + " sections complete";

  if (!clean.createdAt) clean.createdAt = new Date().toISOString();
  clean.updatedAt = new Date().toISOString();

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

    // Home is always available.
    // All other tabs are locked while sitting on Home,
    // or if no inspection has been started/opened.
    var locked = tabName !== "home" && (currentTab === "home" || !inspectionStarted);

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

  [
    "#fenceSections",
    "#climbabilitySections",
    "#balconySections",
    "#retainingWallSections",
    "#boundarySections",
    "#specialPoolFeatureSections",
    "#waterBarrierSections",
    "#barrierWindowSections",
    "#barrierDoorSections",
    "#temporaryFenceSections",
    "#decommissionedPoolSections",
    "#referralSections"
  ].forEach(function (selector) {
    var el = qs(selector);
    if (el) el.innerHTML = "";
  });

  qsa("#gateSectionGroups .gate-card").forEach(function (card) {
    card.remove();
  });

  qsa(".photo-grid").forEach(function (grid) {
    grid.innerHTML = "";
  });

  fenceCounter = 0;
  climbabilityCounter = 0;
  balconyCounter = 0;
  retainingWallCounter = 0;
  boundaryCounter = 0;
  gateCounter = 0;
  specialPoolFeatureCounter = 0;
  waterBarrierCounter = 0;
  barrierWindowCounter = 0;
  barrierDoorCounter = 0;
  temporaryFenceCounter = 0;
  decommissionedPoolCounter = 0;
  referralCounter = 0;
  updateRequiredFieldMarkers();
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
  return gatherDynamicSections('.fence-card[data-section="fence"]');
}


function gatherClimbabilitySections() {
  return gatherDynamicSections('.climbability-card[data-section="climbabilityItem"]');
}


function gatherSectionPhotos() {
  var photos = {};
  qsa(".section-card .photo-widget").forEach(function (widget) {
    if (widget.closest(".fence-card")) return;

    var area = widget.getAttribute("data-photo-area");
    if (!area) return;

    var grid = widget.querySelector(".photo-grid");
    photos[area] = grid ? gatherPhotosFromGrid(grid) : [];
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
    balconySections: gatherDynamicSections('.balcony-card'),
    retainingWallSections: gatherDynamicSections('.retaining-wall-card'),
    boundarySections: gatherDynamicSections('.boundary-card'),
    specialPoolFeatureSections: gatherDynamicSections('.special-pool-feature-card'),
    waterBarrierSections: gatherDynamicSections('.water-barrier-card'),
    barrierWindowSections: gatherDynamicSections('.barrier-window-card'),
    barrierDoorSections: gatherDynamicSections('.barrier-door-card'),
    gateSections: gatherDynamicSections('.gate-card'),
    temporaryFenceSections: gatherDynamicSections('.temporary-fence-card'),
    decommissionedPoolSections: gatherDynamicSections('.decommissioned-pool-card'),
    referralSections: gatherDynamicSections('.referral-card'),
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
  normalizePhotoArray(photos).forEach(function (photo) {
    addPhotoToGrid(grid, photo);
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

  (data.balconySections || []).forEach(function (section) {
    addBalconySection(section);
  });

  (data.retainingWallSections || []).forEach(function (section) {
    addRetainingWallSection(section);
  });

  (data.boundarySections || []).forEach(function (section) {
    addBoundarySection(section);
  });

  (data.specialPoolFeatureSections || []).forEach(function (section) {
    addSpecialPoolFeatureSection(section);
  });

  (data.waterBarrierSections || []).forEach(function (section) {
    addWaterBarrierSection(section);
  });

  (data.barrierWindowSections || []).forEach(function (section) {
    addBarrierWindowSection(section);
  });

  (data.barrierDoorSections || []).forEach(function (section) {
    addBarrierDoorSection(section);
  });

  (data.gateSections || []).forEach(function (section) {
    addGateSection(section);
  });

  (data.temporaryFenceSections || []).forEach(function (section) {
    addTemporaryFenceSection(section);
  });

  (data.decommissionedPoolSections || []).forEach(function (section) {
    addDecommissionedPoolSection(section);
  });

  (data.referralSections || []).forEach(function (section) {
    addReferralSection(section);
  });

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
  if (!confirm("Are you sure you want to delete this inspection? This cannot be undone.")) return;

  var inspectionToDelete = getInspectionById(id);
  var inspections = getInspections().filter(function (item) {
    return item.id !== id;
  });

  setInspections(inspections);

  deleteInspectionPhotosFromStorage(inspectionToDelete);

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
    var isFullyCompleted = status.completedSections === status.totalSections;

	if (isFullyCompleted) {
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
    '<button class="saved-inspection-delete" type="button" aria-label="Delete inspection" title="Delete inspection">×</button>' +
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

  card.querySelector(".saved-inspection-delete").addEventListener("click", function (event) {
    event.stopPropagation();
    deleteInspection(inspection.id);
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
  var hasData = inspectionHasMeaningfulData(data);
  var status = "In progress";

  // A failed item is still a completed inspection result.
  // Only missing required fields keep the inspection out of Completed.
  if (completed === keys.length) {
    status = "Ready";
  } else if (!hasData && completed === 0) {
    status = "Not started";
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
    "poolAreaFreeOfUnrelatedStructures"
  ]);

  var fenceSections = data.fenceSections || [];
  var fenceComplete = fenceSections.length > 0 && fenceSections.every(function (section) {
    return fieldsFilled(section.fields || {}, ["fenceLocation", "fenceType", "fenceHeight", "fenceGroundClearance", "fenceGaps", "fenceStrengthRigid"]);
  });

  var optionalDynamicComplete = dynamicSectionsComplete(data.balconySections, ["balconyLocation", "balconyBarrierCompliant"]) &&
    dynamicSectionsComplete(data.retainingWallSections, ["retainingWallLocation", "retainingWallCompliant"]) &&
    dynamicSectionsComplete(data.boundarySections, ["boundaryLocation", "boundaryCompliant"]) &&
    dynamicSectionsComplete(data.specialPoolFeatureSections, ["specialPoolFeatureLocation", "specialPoolFeatureType", "poolWallUsedAsBarrier", "poolWallHeightCompliant", "ladderAccessSecured"]) &&
    dynamicSectionsComplete(data.waterBarrierSections, ["waterBarrierLocation", "waterBarrierType", "waterBarrierDepth", "waterBarrierCompliant"]) &&
    dynamicSectionsComplete(data.barrierWindowSections, ["barrierWindowLocation", "barrierWindowOpeningRestricted", "barrierWindowFixingsRequireTools", "barrierWindowCompliant"]) &&
    dynamicSectionsComplete(data.barrierDoorSections, ["barrierDoorLocation", "barrierDoorType", "barrierDoorSelfClosing", "barrierDoorSelfLatching", "barrierDoorCompliant"]);

  return staticComplete && fenceComplete && optionalDynamicComplete;
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
  var gateSections = data.gateSections || [];
  return gateSections.length > 0 && gateSections.every(function (section) {
    return fieldsFilled(section.fields || {}, [
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
  });
}


function safetyComplete(data) {
  var f = data.fields || {};
  var staticComplete = fieldsFilled(f, [
    "cprSignPresentSafety",
    "cprSignVisible",
    "cprSignWeatherproof",
    "cprSignMinimumSize",
    "cprSignContentCompliant",
    "sharpEdgesAbsent",
    "sharpProjectionsAbsent",
    "entrapmentSpacesAbsent",
    "looseBrokenComponentsAbsent",
    "rustedWeakenedComponentsAbsent",
    "siteHazardsNoted",
    "overallInspectionResult",
    "certificateReadyToIssue",
    "nonconformityNoticeRequired",
    "reinspectionRequired",
    "ownerAdvisedActions"
  ]);

  var optionalDynamicComplete = dynamicSectionsComplete(data.temporaryFenceSections, ["temporaryFencingPresent", "temporaryFenceSecure", "buildingWorkAffectingBarrier", "barrierNotAlteredUnsafely"]) &&
    dynamicSectionsComplete(data.decommissionedPoolSections, ["poolClaimedDecommissioned", "cannotHold300mmWater", "convertedPoolUse", "registerUpdateRequired"]) &&
    dynamicSectionsComplete(data.referralSections, ["referralType", "referralRecommended", "referralActionNoted"]);

  return staticComplete && optionalDynamicComplete;
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


function dynamicSectionsComplete(sections, requiredFields) {
  if (!sections || !sections.length) return true;
  return sections.every(function (section) {
    return fieldsFilled(section.fields || {}, requiredFields);
  });
}

function getAllDynamicSections(data) {
  return []
    .concat(data.fenceSections || [])
    .concat(data.climbabilitySections || [])
    .concat(data.balconySections || [])
    .concat(data.retainingWallSections || [])
    .concat(data.boundarySections || [])
    .concat(data.specialPoolFeatureSections || [])
    .concat(data.waterBarrierSections || [])
    .concat(data.barrierWindowSections || [])
    .concat(data.barrierDoorSections || [])
    .concat(data.gateSections || [])
    .concat(data.temporaryFenceSections || [])
    .concat(data.decommissionedPoolSections || [])
    .concat(data.referralSections || []);
}

function inspectionNeedsAttention(data) {
  // Fail/non-compliant results are valid completed inspection outcomes.
  // Missing required fields are handled by the section completion checks instead.
  return false;
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
  getAllDynamicSections(data).forEach(function (section) {
    checkFields(section.fields || {});
  });

  return hasData;
}

var REQUIRED_STATIC_FIELDS = [
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
  "siteAccessCondition",
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
  "holdingTank300mmOrDeeper",
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
  "raisedGardenBedsAssessed",
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
  "gateHardwareSecure",
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
];



REQUIRED_STATIC_FIELDS = REQUIRED_STATIC_FIELDS.filter(function (name) {
  return [
    "specialPoolFeatureLocation",
    "specialPoolFeatureType",
    "poolWallUsedAsBarrier",
    "poolWallHeightCompliant",
    "ladderAccessSecured",
    "pumpFilterClimbableAccess",
    "holdingTank300mmOrDeeper",
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
    "gateHardwareSecure",
    "buildingAccessType",
    "buildingAccessLocation",
    "directBuildingAccessControlled",
    "windowOpeningRestricted",
    "screenBarsMeshFixed",
    "fixingsRequireTools",
    "doorAccessCompliant",
    "fireExitNotCompromised",
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
    "referralRecommended"
  ].indexOf(name) === -1;
});

var REQUIRED_DYNAMIC_GROUPS = [
  { selector: '.fence-card[data-section="fence"]', fields: ["fenceLocation", "fenceType", "fenceHeight", "fenceGroundClearance", "fenceGaps", "fenceStrengthRigid"] },
  { selector: '.climbability-card[data-section="climbabilityItem"]', fields: ["nczLocation", "nczObjectType", "nczCompliant"] },
  { selector: ".balcony-card", fields: ["balconyLocation", "balconyBarrierCompliant"] },
  { selector: ".retaining-wall-card", fields: ["retainingWallLocation", "retainingWallCompliant"] },
  { selector: ".boundary-card", fields: ["boundaryLocation", "boundaryCompliant"] },
  { selector: ".special-pool-feature-card", fields: ["specialPoolFeatureLocation", "specialPoolFeatureType", "poolWallUsedAsBarrier", "poolWallHeightCompliant", "ladderAccessSecured"] },
  { selector: ".water-barrier-card", fields: ["waterBarrierLocation", "waterBarrierType", "waterBarrierDepth", "waterBarrierCompliant"] },
  { selector: ".barrier-window-card", fields: ["barrierWindowLocation", "barrierWindowOpeningRestricted", "barrierWindowFixingsRequireTools", "barrierWindowCompliant"] },
  { selector: ".barrier-door-card", fields: ["barrierDoorLocation", "barrierDoorType", "barrierDoorSelfClosing", "barrierDoorSelfLatching", "barrierDoorCompliant"] },
  { selector: ".gate-card", fields: ["gateLocation", "gateType", "gateSwingsAway", "gateSelfClosing", "gateSelfLatching", "gateClosesFromAnyPosition", "gateLatchPreventsReopening", "gateFullArc", "gateCannotBeProppedOpen", "gateGapUnderCompliant", "gateLatchHeightCompliant", "gateLatchShielded", "gateLatchReachThroughGaps", "gateHingesSafe", "gateHardwareSecure"] },
  { selector: ".temporary-fence-card", fields: ["temporaryFencingPresent", "temporaryFenceSecure", "buildingWorkAffectingBarrier", "barrierNotAlteredUnsafely"] },
  { selector: ".decommissioned-pool-card", fields: ["poolClaimedDecommissioned", "cannotHold300mmWater", "convertedPoolUse", "registerUpdateRequired"] },
  { selector: ".referral-card", fields: ["referralType", "referralRecommended", "referralActionNoted"] }
];

function getFieldElementValue(el) {
  if (!el) return "";
  return el.type === "checkbox" ? el.checked : el.value;
}

function getRequiredFieldContainer(el) {
  if (!el) return null;
  return el.closest(".field, .check-field, .toggle-field");
}

function markRequiredElement(el) {
  var container = getRequiredFieldContainer(el);
  if (!container) return;

  var missing = inspectionStarted && !fieldFilled(getFieldElementValue(el));
  container.classList.add("required-field");
  container.classList.toggle("required-missing", missing);
}

function markRequiredFieldByName(scope, name) {
  if (!scope || !name) return;
  scope.querySelectorAll('[data-save][name="' + name + '"]').forEach(function (el) {
    markRequiredElement(el);
  });
}

function updateRequiredFieldMarkers() {
  qsa(".required-field, .required-missing").forEach(function (el) {
    el.classList.remove("required-field");
    el.classList.remove("required-missing");
  });

  if (!inspectionStarted) return;

  REQUIRED_STATIC_FIELDS.forEach(function (name) {
    markRequiredFieldByName(document, name);
  });

  REQUIRED_DYNAMIC_GROUPS.forEach(function (group) {
    qsa(group.selector).forEach(function (card) {
      group.fields.forEach(function (name) {
        markRequiredFieldByName(card, name);
      });
    });
  });
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
    '<div class="details-group numbered-group">' +
      '<div class="group-title-row"><span class="group-number">A</span><h3>Identity / Location</h3></div>' +
      '<div class="form-grid">' +
        '<label class="field full"><span>Location</span><input data-save name="fenceLocation" type="text" placeholder="e.g. North side fence" /></label>' +
        '<label class="field"><span>Fence Type</span><select data-save name="fenceType"><option value="">Select type</option><option>Aluminium</option><option>Glass</option><option>Timber</option><option>Chainwire / mesh</option><option>Masonry</option><option>Other</option></select></label>' +
        '<label class="field"><span>Fence material / finish safe</span><select data-save name="fenceMaterialFinishSafe"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '</div>' +
    '</div>' +
    '<div class="details-group numbered-group">' +
      '<div class="group-title-row"><span class="group-number">B</span><h3>Measurements</h3></div>' +
      '<div class="form-grid">' +
        '<label class="field"><span>Effective height (mm)</span><input data-save name="fenceHeight" type="number" placeholder="1200" /></label>' +
        '<label class="field"><span>Ground clearance (mm)</span><input data-save name="fenceGroundClearance" type="number" placeholder="100" /></label>' +
        '<label class="field"><span>Openings / gaps compliant</span><select data-save name="fenceGaps"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Mesh / perforated aperture size (mm)</span><input data-save name="fenceApertureSize" type="number" placeholder="If applicable" /></label>' +
      '</div>' +
    '</div>' +
    '<div class="details-group numbered-group">' +
      '<div class="group-title-row"><span class="group-number">C</span><h3>NCZ / Strength / Condition</h3></div>' +
      '<div class="form-grid">' +
        '<label class="field"><span>NCZ clear for this fence run</span><select data-save name="fenceNCZClear"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Projections / indentations compliant</span><select data-save name="fenceProjectionsCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Strength / rigidity acceptable</span><select data-save name="fenceStrengthRigid"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Posts / footings / fixings secure</span><select data-save name="fenceFixingsSecure"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="fenceComments" placeholder="Notes, measurements, non-compliance details or recommendation..."></textarea></label>' +
      '</div>' +
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
    var paths = collectPhotoPaths({ photos: {}, tempSections: [{ photos: gatherPhotosFromGrid(card.querySelector(".photo-grid")) }] });
    deletePhotoPathsFromStorage(paths);
    card.remove();
    renumberFenceSections();
    updateRequiredFieldMarkers();
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

  updateRequiredFieldMarkers();
  refreshSummary();
}

function renumberFenceSections() {
  qsa('.fence-card[data-section="fence"]').forEach(function (card, index) {
    var h3 = card.querySelector("h3");
    if (h3) h3.textContent = "Fence Section " + (index + 1);
  });
}


function climbabilityTemplate(number) {
  return '' +
    '<div class="fence-card-head">' +
      '<h3>NCZ / Climbable Object ' + number + '</h3>' +
      '<button class="remove-section-btn" type="button">Remove</button>' +
    '</div>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="nczLocation" type="text" placeholder="e.g. Near pump equipment" /></label>' +
      '<label class="field"><span>Object Type</span><select data-save name="nczObjectType"><option value=""></option><option>Tree / vegetation</option><option>Pot plant</option><option>Furniture</option><option>Pool equipment</option><option>Retaining wall</option><option>Tap / power outlet</option><option>Step / ledge</option><option>Other</option></select></label>' +
      '<label class="field"><span>Distance From Barrier (mm)</span><input data-save name="nczDistance" type="number" placeholder="900" /></label>' +
      '<label class="field"><span>Horizontal surface over 10mm?</span><select data-save name="nczHorizontalSurface"><option value=""></option><option>Yes</option><option>No</option><option>N/A</option></select></label>' +
      '<label class="field"><span>NCZ Compliant</span><select data-save name="nczCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
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

  updateRequiredFieldMarkers();
  refreshSummary();
}

function renumberClimbabilitySections() {
  qsa(".climbability-card").forEach(function (card, index) {
    var h3 = card.querySelector("h3");
    if (h3) h3.textContent = "Climbability Check " + (index + 1);
  });
}

function gatherPhotosFromGrid(grid) {
  if (!grid) return [];
  return qsaFrom(grid, ".photo-box").map(function (box) {
    return getPhotoRecordFromBox(box);
  }).filter(function (photo) {
    return !!(photo && (photo.url || photo.path));
  });
}

function qsaFrom(root, selector) {
  return Array.prototype.slice.call(root.querySelectorAll(selector));
}

function gatherDynamicSections(selector) {
  return qsa(selector).map(function (card) {
    var fields = {};
    card.querySelectorAll("[data-save]").forEach(function (el) {
      fields[el.name] = el.type === "checkbox" ? el.checked : el.value;
    });
    return {
      fields: fields,
      photos: gatherPhotosFromGrid(card.querySelector(".photo-grid"))
    };
  });
}

function addDynamicSection(options, data) {
  var list = qs(options.listSelector);
  if (!list) return;

  options.counter += 1;
  var number = options.counter;

  var card = document.createElement(options.tagName || "article");
  card.className = options.className;
  card.setAttribute("data-section", options.sectionName);
  card.innerHTML = options.template(number);
  prepareBlankDropdowns(card);

  if (!data) {
    card.querySelectorAll("select[data-save]").forEach(function (select) {
      select.selectedIndex = 0;
    });
  }

  card.querySelector(".remove-section-btn").addEventListener("click", function () {
    var paths = collectPhotoPaths({ photos: {}, tempSections: [{ photos: gatherPhotosFromGrid(card.querySelector(".photo-grid")) }] });
    deletePhotoPathsFromStorage(paths);
    card.remove();
    options.renumber();
    updateRequiredFieldMarkers();
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

  updateRequiredFieldMarkers();
  refreshSummary();
}

function balconyTemplate(number) {
  return '' +
    '<div class="fence-card-head">' +
      '<h3>Balcony Check ' + number + '</h3>' +
      '<button class="remove-section-btn" type="button">Remove</button>' +
    '</div>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="balconyLocation" type="text" placeholder="e.g. Balcony overlooking pool area" /></label>' +
      '<label class="field"><span>Balcony / Deck Type</span><select data-save name="balconyType"><option value=""></option><option>Balcony</option><option>Deck</option><option>Raised platform</option><option>Stairs / landing</option><option>Other</option></select></label>' +
      '<label class="field"><span>Height / drop assessed</span><select data-save name="balconyHeightAssessed"><option value=""></option><option>Yes</option><option>No</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Access to pool controlled</span><select data-save name="balconyAccessControlled"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Barrier compliant</span><select data-save name="balconyBarrierCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="balconyComments" placeholder="Notes about balcony, deck, raised platform or access issue..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="balcony-' + number + '">' +
      '<button class="camera-btn" type="button">+ Evidence Photo</button>' +
      '<input type="file" accept="image/*" capture="environment" multiple hidden />' +
      '<div class="photo-grid"></div>' +
    '</div>';
}

function addBalconySection(data) {
  addDynamicSection({
    listSelector: "#balconySections",
    className: "fence-card balcony-card",
    sectionName: "balcony",
    counter: balconyCounter,
    template: balconyTemplate,
    renumber: renumberBalconySections
  }, data);
  balconyCounter = qsa(".balcony-card").length;
}

function renumberBalconySections() {
  qsa(".balcony-card").forEach(function (card, index) {
    var h3 = card.querySelector("h3");
    if (h3) h3.textContent = "Balcony Check " + (index + 1);
  });
  balconyCounter = qsa(".balcony-card").length;
}

function retainingWallTemplate(number) {
  return '' +
    '<div class="fence-card-head">' +
      '<h3>Retaining Wall / Level Change ' + number + '</h3>' +
      '<button class="remove-section-btn" type="button">Remove</button>' +
    '</div>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="retainingWallLocation" type="text" placeholder="e.g. Rear retaining wall" /></label>' +
      '<label class="field"><span>Type</span><select data-save name="retainingWallType"><option value=""></option><option>Retaining wall</option><option>Level change</option><option>Steps</option><option>Raised garden bed</option><option>Sloping ground</option><option>Other</option></select></label>' +
      '<label class="field"><span>Height / level change (mm)</span><input data-save name="retainingWallHeight" type="number" placeholder="500" /></label>' +
      '<label class="field"><span>Distance from barrier (mm)</span><input data-save name="retainingWallDistance" type="number" placeholder="900" /></label>' +
      '<label class="field"><span>Compliant</span><select data-save name="retainingWallCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="retainingWallComments" placeholder="Notes about retaining wall, level change, step, raised bed or sloping ground..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="retaining-wall-' + number + '">' +
      '<button class="camera-btn" type="button">+ Evidence Photo</button>' +
      '<input type="file" accept="image/*" capture="environment" multiple hidden />' +
      '<div class="photo-grid"></div>' +
    '</div>';
}

function addRetainingWallSection(data) {
  addDynamicSection({
    listSelector: "#retainingWallSections",
    className: "fence-card retaining-wall-card",
    sectionName: "retainingWall",
    counter: retainingWallCounter,
    template: retainingWallTemplate,
    renumber: renumberRetainingWallSections
  }, data);
  retainingWallCounter = qsa(".retaining-wall-card").length;
}

function renumberRetainingWallSections() {
  qsa(".retaining-wall-card").forEach(function (card, index) {
    var h3 = card.querySelector("h3");
    if (h3) h3.textContent = "Retaining Wall / Level Change " + (index + 1);
  });
  retainingWallCounter = qsa(".retaining-wall-card").length;
}

function boundaryTemplate(number) {
  return '' +
    '<div class="fence-card-head">' +
      '<h3>Boundary Section ' + number + '</h3>' +
      '<button class="remove-section-btn" type="button">Remove</button>' +
    '</div>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="boundaryLocation" type="text" placeholder="e.g. Left boundary fence" /></label>' +
      '<label class="field"><span>Boundary Side</span><select data-save name="boundarySide"><option value=""></option><option>Front boundary</option><option>Rear boundary</option><option>Left boundary</option><option>Right boundary</option><option>Neighbour side</option><option>Other</option></select></label>' +
      '<label class="field"><span>Fence Type</span><select data-save name="boundaryFenceType"><option value=""></option><option>Timber</option><option>Colorbond / metal</option><option>Masonry</option><option>Glass</option><option>Aluminium</option><option>Other</option></select></label>' +
      '<label class="field"><span>Height (mm)</span><input data-save name="boundaryFenceHeight" type="number" placeholder="1800" /></label>' +
      '<label class="field"><span>Neighbour-side issues assessed</span><select data-save name="boundaryNeighbourSideClear"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Compliant</span><select data-save name="boundaryCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="boundaryComments" placeholder="Notes about boundary fence or neighbour-side issue..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="boundary-' + number + '">' +
      '<button class="camera-btn" type="button">+ Evidence Photo</button>' +
      '<input type="file" accept="image/*" capture="environment" multiple hidden />' +
      '<div class="photo-grid"></div>' +
    '</div>';
}

function addBoundarySection(data) {
  addDynamicSection({
    listSelector: "#boundarySections",
    className: "fence-card boundary-card",
    sectionName: "boundary",
    counter: boundaryCounter,
    template: boundaryTemplate,
    renumber: renumberBoundarySections
  }, data);
  boundaryCounter = qsa(".boundary-card").length;
}

function renumberBoundarySections() {
  qsa(".boundary-card").forEach(function (card, index) {
    var h3 = card.querySelector("h3");
    if (h3) h3.textContent = "Boundary Section " + (index + 1);
  });
  boundaryCounter = qsa(".boundary-card").length;
}


function specialPoolFeatureTemplate(number) {
  return '' +
    '<div class="fence-card-head"><h3>Special Pool Feature Check ' + number + '</h3><button class="remove-section-btn" type="button">Remove</button></div>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="specialPoolFeatureLocation" type="text" placeholder="e.g. Above-ground pool wall / wet-edge side" /></label>' +
      '<label class="field"><span>Feature Type</span><select data-save name="specialPoolFeatureType"><option value=""></option><option>Above-ground pool</option><option>Inflatable pool</option><option>Wet-edge pool</option><option>Infinity edge</option><option>Spa wall</option><option>Other</option></select></label>' +
      '<label class="field"><span>Pool wall used as barrier</span><select data-save name="poolWallUsedAsBarrier"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Pool wall height compliant</span><select data-save name="poolWallHeightCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Ladder / access point secured</span><select data-save name="ladderAccessSecured"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Pump/filter creates climbable access</span><select data-save name="pumpFilterClimbableAccess"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Holding tank 300mm or deeper</span><select data-save name="holdingTank300mmOrDeeper"><option value=""></option><option>Yes</option><option>No</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="specialPoolFeatureComments" placeholder="Notes about above-ground, inflatable, wet-edge, infinity or other special feature..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="special-pool-feature-' + number + '"><button class="camera-btn" type="button">+ Evidence Photo</button><input type="file" accept="image/*" capture="environment" multiple hidden /><div class="photo-grid"></div></div>';
}

function addSpecialPoolFeatureSection(data) {
  addDynamicSection({ listSelector: "#specialPoolFeatureSections", className: "fence-card special-pool-feature-card", sectionName: "specialPoolFeature", counter: specialPoolFeatureCounter, template: specialPoolFeatureTemplate, renumber: renumberSpecialPoolFeatureSections }, data);
  specialPoolFeatureCounter = qsa(".special-pool-feature-card").length;
}

function renumberSpecialPoolFeatureSections() {
  qsa(".special-pool-feature-card").forEach(function (card, index) { var h3 = card.querySelector("h3"); if (h3) h3.textContent = "Special Pool Feature Check " + (index + 1); });
  specialPoolFeatureCounter = qsa(".special-pool-feature-card").length;
}

function waterBarrierTemplate(number) {
  return '' +
    '<div class="fence-card-head"><h3>Permanent Body of Water Check ' + number + '</h3><button class="remove-section-btn" type="button">Remove</button></div>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="waterBarrierLocation" type="text" placeholder="e.g. Canal edge / lake side" /></label>' +
      '<label class="field"><span>Water body type</span><select data-save name="waterBarrierType"><option value=""></option><option>Canal</option><option>Lake</option><option>River</option><option>Permanent pond</option><option>Other</option></select></label>' +
      '<label class="field"><span>Depth at pool-area edge (mm)</span><input data-save name="waterBarrierDepth" type="number" placeholder="300" /></label>' +
      '<label class="field"><span>Compliant as barrier</span><select data-save name="waterBarrierCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="waterBarrierComments" placeholder="Notes about permanent water body, access risks or recommendation..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="water-barrier-' + number + '"><button class="camera-btn" type="button">+ Evidence Photo</button><input type="file" accept="image/*" capture="environment" multiple hidden /><div class="photo-grid"></div></div>';
}

function addWaterBarrierSection(data) {
  addDynamicSection({ listSelector: "#waterBarrierSections", className: "fence-card water-barrier-card", sectionName: "waterBarrier", counter: waterBarrierCounter, template: waterBarrierTemplate, renumber: renumberWaterBarrierSections }, data);
  waterBarrierCounter = qsa(".water-barrier-card").length;
}

function renumberWaterBarrierSections() {
  qsa(".water-barrier-card").forEach(function (card, index) { var h3 = card.querySelector("h3"); if (h3) h3.textContent = "Permanent Body of Water Check " + (index + 1); });
  waterBarrierCounter = qsa(".water-barrier-card").length;
}

function barrierWindowTemplate(number) {
  return '' +
    '<div class="fence-card-head"><h3>Window Check ' + number + '</h3><button class="remove-section-btn" type="button">Remove</button></div>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Window Location</span><input data-save name="barrierWindowLocation" type="text" placeholder="e.g. Bedroom window facing pool area" /></label>' +
      '<label class="field"><span>Opening restricted where required</span><select data-save name="barrierWindowOpeningRestricted"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Screen / bars / mesh fixed correctly</span><select data-save name="barrierWindowScreenBarsMeshFixed"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Fixings require tools to remove</span><select data-save name="barrierWindowFixingsRequireTools"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Compliant</span><select data-save name="barrierWindowCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="barrierWindowComments" placeholder="Notes about window opening, restrictor, bars, mesh, fixings or recommendation..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="barrier-window-' + number + '"><button class="camera-btn" type="button">+ Evidence Photo</button><input type="file" accept="image/*" capture="environment" multiple hidden /><div class="photo-grid"></div></div>';
}

function addBarrierWindowSection(data) {
  addDynamicSection({ listSelector: "#barrierWindowSections", className: "fence-card barrier-window-card", sectionName: "barrierWindow", counter: barrierWindowCounter, template: barrierWindowTemplate, renumber: renumberBarrierWindowSections }, data);
  barrierWindowCounter = qsa(".barrier-window-card").length;
}

function renumberBarrierWindowSections() {
  qsa(".barrier-window-card").forEach(function (card, index) { var h3 = card.querySelector("h3"); if (h3) h3.textContent = "Window Check " + (index + 1); });
  barrierWindowCounter = qsa(".barrier-window-card").length;
}

function barrierDoorTemplate(number) {
  return '' +
    '<div class="fence-card-head"><h3>Door / Building Access Check ' + number + '</h3><button class="remove-section-btn" type="button">Remove</button></div>' +
    '<div class="form-grid">' +
      '<label class="field full"><span>Location</span><input data-save name="barrierDoorLocation" type="text" placeholder="e.g. Patio sliding door" /></label>' +
      '<label class="field"><span>Access Type</span><select data-save name="barrierDoorType"><option value=""></option><option>Door</option><option>Sliding door</option><option>Pet door</option><option>Building wall</option><option>Other</option></select></label>' +
      '<label class="field"><span>Self-closing</span><select data-save name="barrierDoorSelfClosing"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Self-latching</span><select data-save name="barrierDoorSelfLatching"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Direct access controlled</span><select data-save name="barrierDoorCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Fire exit not compromised</span><select data-save name="barrierDoorFireExitSafe"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="barrierDoorComments" placeholder="Notes about door/building access, latch, fire exit or recommendation..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="barrier-door-' + number + '"><button class="camera-btn" type="button">+ Evidence Photo</button><input type="file" accept="image/*" capture="environment" multiple hidden /><div class="photo-grid"></div></div>';
}

function addBarrierDoorSection(data) {
  addDynamicSection({ listSelector: "#barrierDoorSections", className: "fence-card barrier-door-card", sectionName: "barrierDoor", counter: barrierDoorCounter, template: barrierDoorTemplate, renumber: renumberBarrierDoorSections }, data);
  barrierDoorCounter = qsa(".barrier-door-card").length;
}

function renumberBarrierDoorSections() {
  qsa(".barrier-door-card").forEach(function (card, index) { var h3 = card.querySelector("h3"); if (h3) h3.textContent = "Door / Building Access Check " + (index + 1); });
  barrierDoorCounter = qsa(".barrier-door-card").length;
}

function temporaryFenceTemplate(number) {
  return '' +
    '<div class="fence-card-head"><h3>Temporary Fencing Check ' + number + '</h3><button class="remove-section-btn" type="button">Remove</button></div>' +
    '<div class="form-grid">' +
      '<label class="field"><span>Temporary fencing present if required</span><select data-save name="temporaryFencingPresent"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Temporary fence appears secure</span><select data-save name="temporaryFenceSecure"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Building work affecting barrier noted</span><select data-save name="buildingWorkAffectingBarrier"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Barrier not removed or altered unsafely</span><select data-save name="barrierNotAlteredUnsafely"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Minor repairs / maintenance noted</span><select data-save name="minorRepairsMaintenanceNoted"><option value=""></option><option>Yes</option><option>No</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="temporaryFencingComments" placeholder="Notes about temporary fencing, building work, repairs or maintenance..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="temporary-fencing-' + number + '"><button class="camera-btn" type="button">+ Evidence Photo</button><input type="file" accept="image/*" capture="environment" multiple hidden /><div class="photo-grid"></div></div>';
}

function addTemporaryFenceSection(data) { addDynamicSection({ listSelector: "#temporaryFenceSections", className: "fence-card temporary-fence-card", sectionName: "temporaryFence", counter: temporaryFenceCounter, template: temporaryFenceTemplate, renumber: renumberTemporaryFenceSections }, data); temporaryFenceCounter = qsa(".temporary-fence-card").length; }
function renumberTemporaryFenceSections() { qsa(".temporary-fence-card").forEach(function (card, index) { var h3 = card.querySelector("h3"); if (h3) h3.textContent = "Temporary Fencing Check " + (index + 1); }); temporaryFenceCounter = qsa(".temporary-fence-card").length; }

function decommissionedPoolTemplate(number) {
  return '' +
    '<div class="fence-card-head"><h3>Decommissioned / Converted Pool Check ' + number + '</h3><button class="remove-section-btn" type="button">Remove</button></div>' +
    '<div class="form-grid">' +
      '<label class="field"><span>Pool claimed decommissioned</span><select data-save name="poolClaimedDecommissioned"><option value=""></option><option>Yes</option><option>No</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Cannot hold 300mm or more of water</span><select data-save name="cannotHold300mmWater"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Converted to fishpond / other use</span><select data-save name="convertedPoolUse"><option value=""></option><option>Yes</option><option>No</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Register update required</span><select data-save name="registerUpdateRequired"><option value=""></option><option>Yes</option><option>No</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="decommissionedPoolComments" placeholder="Notes about decommissioning, destruction, conversion or register update..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="decommissioned-pool-' + number + '"><button class="camera-btn" type="button">+ Evidence Photo</button><input type="file" accept="image/*" capture="environment" multiple hidden /><div class="photo-grid"></div></div>';
}

function addDecommissionedPoolSection(data) { addDynamicSection({ listSelector: "#decommissionedPoolSections", className: "fence-card decommissioned-pool-card", sectionName: "decommissionedPool", counter: decommissionedPoolCounter, template: decommissionedPoolTemplate, renumber: renumberDecommissionedPoolSections }, data); decommissionedPoolCounter = qsa(".decommissioned-pool-card").length; }
function renumberDecommissionedPoolSections() { qsa(".decommissioned-pool-card").forEach(function (card, index) { var h3 = card.querySelector("h3"); if (h3) h3.textContent = "Decommissioned / Converted Pool Check " + (index + 1); }); decommissionedPoolCounter = qsa(".decommissioned-pool-card").length; }

function referralTemplate(number) {
  return '' +
    '<div class="fence-card-head"><h3>Electrical / Asbestos / Fire Referral ' + number + '</h3><button class="remove-section-btn" type="button">Remove</button></div>' +
    '<div class="form-grid">' +
      '<label class="field"><span>Referral Type</span><select data-save name="referralType"><option value=""></option><option>Electrical safety</option><option>Bonding / conductive fencing</option><option>Possible asbestos</option><option>Fire safety</option><option>Other specialist referral</option></select></label>' +
      '<label class="field"><span>Referral recommended</span><select data-save name="referralRecommended"><option value=""></option><option>Yes</option><option>No</option><option>N/A</option></select></label>' +
      '<label class="field"><span>Action noted for owner</span><select data-save name="referralActionNoted"><option value=""></option><option>Yes</option><option>No</option><option>N/A</option></select></label>' +
      '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="referralComments" placeholder="Notes about electrical, asbestos, fire or other referral..."></textarea></label>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="referral-' + number + '"><button class="camera-btn" type="button">+ Evidence Photo</button><input type="file" accept="image/*" capture="environment" multiple hidden /><div class="photo-grid"></div></div>';
}

function addReferralSection(data) { addDynamicSection({ listSelector: "#referralSections", className: "fence-card referral-card", sectionName: "referral", counter: referralCounter, template: referralTemplate, renumber: renumberReferralSections }, data); referralCounter = qsa(".referral-card").length; }
function renumberReferralSections() { qsa(".referral-card").forEach(function (card, index) { var h3 = card.querySelector("h3"); if (h3) h3.textContent = "Electrical / Asbestos / Fire Referral " + (index + 1); }); referralCounter = qsa(".referral-card").length; }

function gateTemplate(number) {
  return '' +
    '<div class="fence-card-head">' +
      '<h3>Gate ' + number + '</h3>' +
      '<button class="remove-section-btn" type="button">Remove</button>' +
    '</div>' +
    '<div class="details-group numbered-group">' +
      '<div class="group-title-row"><span class="group-number">A</span><h3>Gate identity / location</h3></div>' +
      '<div class="form-grid">' +
        '<label class="field full"><span>Gate Location</span><input data-save name="gateLocation" type="text" placeholder="e.g. Side gate" /></label>' +
        '<label class="field"><span>Gate Type</span><select data-save name="gateType"><option value=""></option><option>Single leaf gate</option><option>Double leaf gate</option><option>Glass gate</option><option>Aluminium gate</option><option>Timber gate</option><option>Mesh / chainwire gate</option><option>Other</option></select></label>' +
      '</div>' +
    '</div>' +
    '<div class="details-group numbered-group">' +
      '<div class="group-title-row"><span class="group-number">B</span><h3>Operation / latching</h3></div>' +
      '<div class="form-grid">' +
        '<label class="field"><span>Opens away from pool</span><select data-save name="gateSwingsAway"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Self-closes</span><select data-save name="gateSelfClosing"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Self-latches</span><select data-save name="gateSelfLatching"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Closes from any open position</span><select data-save name="gateClosesFromAnyPosition"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Latch prevents reopening</span><select data-save name="gateLatchPreventsReopening"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Gate swings freely through full arc</span><select data-save name="gateFullArc"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Gate cannot be propped open</span><select data-save name="gateCannotBeProppedOpen"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
      '</div>' +
    '</div>' +
    '<div class="details-group numbered-group">' +
      '<div class="group-title-row"><span class="group-number">C</span><h3>Gaps / latch / hardware</h3></div>' +
      '<div class="form-grid">' +
        '<label class="field"><span>Gap under gate (mm)</span><input data-save name="gateGapUnder" type="number" placeholder="100" /></label>' +
        '<label class="field"><span>Gap under gate compliant</span><select data-save name="gateGapUnderCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Latch height (mm)</span><input data-save name="gateLatchHeight" type="number" placeholder="1500" /></label>' +
        '<label class="field"><span>Latch height compliant</span><select data-save name="gateLatchHeightCompliant"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Latch shielded if required</span><select data-save name="gateLatchShielded"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Latch cannot be reached through gaps</span><select data-save name="gateLatchReachThroughGaps"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Hinges safe / not climbable</span><select data-save name="gateHingesSafe"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field"><span>Gate hardware secure and functional</span><select data-save name="gateHardwareSecure"><option value=""></option><option>Pass</option><option>Fail</option><option>N/A</option></select></label>' +
        '<label class="field full"><span>Comments / Recommendation</span><textarea data-save name="gateComments" placeholder="Notes about gate operation, latch, hinges, hardware, gaps or recommendation..."></textarea></label>' +
      '</div>' +
    '</div>' +
    '<div class="photo-widget" data-photo-area="gate-' + number + '">' +
      '<button class="camera-btn" type="button">+ Evidence Photo</button>' +
      '<input type="file" accept="image/*" capture="environment" multiple hidden />' +
      '<div class="photo-grid"></div>' +
    '</div>';
}

function addGateSection(data) {
  addDynamicSection({
    listSelector: "#gateSectionGroups",
    className: "fence-card gate-card",
    sectionName: "gateItem",
    counter: gateCounter,
    template: gateTemplate,
    renumber: renumberGateSections
  }, data);
  gateCounter = qsa(".gate-card").length;
}

function renumberGateSections() {
  qsa(".gate-card").forEach(function (card, index) {
    var h3 = card.querySelector("h3");
    if (h3) h3.textContent = "Gate " + (index + 1);
  });
  gateCounter = qsa(".gate-card").length;
}


function normalizePhotoArray(items) {
  return (items || []).map(function (item) {
    return normalizePhotoRecord(item);
  }).filter(function (item) {
    return !!(item && (item.url || item.path));
  });
}

function normalizePhotoCollections(collections) {
  var result = {};
  Object.keys(collections || {}).forEach(function (area) {
    result[area] = normalizePhotoArray(collections[area]);
  });
  return result;
}

function normalizePhotoRecord(input) {
  if (!input) return null;
  if (typeof input === "string") {
    return { url: input, path: "", uploadedAt: "" };
  }
  return {
    url: input.url || input.src || "",
    path: input.path || "",
    area: input.area || "",
    name: input.name || "",
    uploadedAt: input.uploadedAt || input.createdAt || "",
    size: input.size || 0
  };
}

function getPhotoRecordFromBox(box) {
  if (!box) return null;
  if (box.dataset && box.dataset.photo) {
    try {
      return normalizePhotoRecord(JSON.parse(box.dataset.photo));
    } catch (error) {
      console.warn("Could not read photo metadata", error);
    }
  }
  var img = box.querySelector("img");
  return img ? normalizePhotoRecord(img.src) : null;
}

function safeStorageName(value) {
  return String(value || "photo")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "photo";
}

function getPhotoAreaLabel(area) {
  return String(area || "general")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, function (match) { return match.toUpperCase(); });
}

function getCurrentInspectionNumberForStamp() {
  var el = qs("#inspectionNumber");
  return el && el.value ? el.value : (currentInspectionId || "Inspection");
}

function buildPhotoStampLines(area, uploadedAt) {
  return [
    formatDateTime(uploadedAt),
    getCurrentInspectionNumberForStamp(),
    getPhotoAreaLabel(area),
    "IronGate Pool Inspections"
  ];
}

function drawPhotoStamp(ctx, width, height, lines) {
  lines = (lines || []).filter(function (line) { return !!String(line || "").trim(); });
  if (!lines.length) return;

  var scale = Math.max(1, Math.min(width, height) / 900);
  var fontSize = Math.max(18, Math.round(24 * scale));
  var padding = Math.round(18 * scale);
  var lineHeight = Math.round(fontSize * 1.35);
  var boxHeight = padding * 2 + lineHeight * lines.length;
  var y = Math.max(0, height - boxHeight);

  ctx.save();
  ctx.fillStyle = "rgba(3, 40, 106, 0.78)";
  ctx.fillRect(0, y, width, boxHeight);
  ctx.font = "700 " + fontSize + "px Arial, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";

  lines.forEach(function (line, index) {
    ctx.fillText(String(line), padding, y + padding + index * lineHeight, width - padding * 2);
  });

  ctx.restore();
}

function compressImageFile(file, stampLines) {
  return new Promise(function (resolve, reject) {
    if (!file || !file.type || file.type.indexOf("image/") !== 0) {
      reject(new Error("Please choose an image file."));
      return;
    }

    var reader = new FileReader();
    reader.onload = function (event) {
      var img = new Image();
      img.onload = function () {
        var maxSide = 1600;
        var width = img.width;
        var height = img.height;

        if (width > maxSide || height > maxSide) {
          if (width > height) {
            height = Math.round(height * (maxSide / width));
            width = maxSide;
          } else {
            width = Math.round(width * (maxSide / height));
            height = maxSide;
          }
        }

        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        drawPhotoStamp(ctx, width, height, stampLines || []);

        canvas.toBlob(function (blob) {
          if (!blob) {
            reject(new Error("Could not compress image."));
            return;
          }
          resolve(blob);
        }, "image/jpeg", 0.82);
      };
      img.onerror = function () {
        reject(new Error("Could not read image."));
      };
      img.src = event.target.result;
    };
    reader.onerror = function () {
      reject(new Error("Could not read image file."));
    };
    reader.readAsDataURL(file);
  });
}

function uploadPhotoFile(file, widget, grid) {
  if (!canUseApp() || !firebaseStorage || !currentInspectionId) {
    alert("Please open or start an inspection before adding photos.");
    return Promise.resolve();
  }

  var area = widget.getAttribute("data-photo-area") || "general";
  var button = widget.querySelector(".camera-btn");
  var originalText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Uploading...";
  }

  var compressedBlob = null;
  var uploadedAt = new Date().toISOString();
  var stampLines = buildPhotoStampLines(area, uploadedAt);

  return compressImageFile(file, stampLines)
    .then(function (blob) {
      compressedBlob = blob;
      var fileName = Date.now() + "-" + Math.floor(Math.random() * 100000) + "-" + safeStorageName(file.name || "photo") + ".jpg";
      var path = "users/" + firebaseUser.uid + "/inspections/" + currentInspectionId + "/" + safeStorageName(area) + "/" + fileName;
      var ref = firebaseStorage.ref().child(path);
      return ref.put(compressedBlob, {
        contentType: "image/jpeg",
        customMetadata: {
          originalName: file.name || "",
          area: area,
          stampedAt: uploadedAt,
          stampText: stampLines.join(" | ")
        }
      }).then(function (snapshot) {
        return snapshot.ref.getDownloadURL().then(function (url) {
          return {
            url: url,
            path: path,
            area: area,
            name: file.name || fileName,
            size: compressedBlob ? compressedBlob.size : 0,
            uploadedAt: uploadedAt,
            stamped: true
          };
        });
      });
    })
    .then(function (photo) {
      addPhotoToGrid(grid, photo);
      saveCurrentInspection(false);
    })
    .catch(function (error) {
      console.error(error);
      alert("Could not upload photo: " + error.message);
    })
    .then(function () {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
}

function deletePhotoFromStorage(photo) {
  photo = normalizePhotoRecord(photo);
  if (!photo || !photo.path || !firebaseStorage) return Promise.resolve();

  return firebaseStorage.ref().child(photo.path).delete().catch(function (error) {
    console.warn("Could not delete photo from Storage", error);
  });
}

function collectPhotoPaths(data) {
  var paths = [];

  function addPhoto(photo) {
    photo = normalizePhotoRecord(photo);
    if (photo && photo.path) paths.push(photo.path);
  }

  Object.keys(data && data.photos || {}).forEach(function (area) {
    normalizePhotoArray(data.photos[area]).forEach(addPhoto);
  });

  [
    "fenceSections",
    "climbabilitySections",
    "balconySections",
    "retainingWallSections",
    "boundarySections",
    "specialPoolFeatureSections",
    "waterBarrierSections",
    "barrierWindowSections",
    "barrierDoorSections",
    "gateSections",
    "temporaryFenceSections",
    "decommissionedPoolSections",
    "referralSections",
    "tempSections"
  ].forEach(function (sectionKey) {
    (data && data[sectionKey] || []).forEach(function (section) {
      normalizePhotoArray(section.photos || []).forEach(addPhoto);
    });
  });

  return paths.filter(function (path, index, arr) {
    return path && arr.indexOf(path) === index;
  });
}

function deletePhotoPathsFromStorage(paths) {
  (paths || []).forEach(function (path) {
    deletePhotoFromStorage({ path: path });
  });
}

function deleteInspectionPhotosFromStorage(data) {
  deletePhotoPathsFromStorage(collectPhotoPaths(data || {}));
}

function bindPhotoWidget(widget) {
  if (!widget || widget.getAttribute("data-bound") === "true") return;

  widget.setAttribute("data-bound", "true");

  var btn = widget.querySelector(".camera-btn");
  var input = widget.querySelector('input[type="file"]');
  var grid = widget.querySelector(".photo-grid");

  if (!btn || !input || !grid) return;

  btn.addEventListener("click", function () {
    if (!canUseApp() || !currentInspectionId) {
      alert("Please start or open an inspection before adding photos.");
      return;
    }
    input.click();
  });

  input.addEventListener("change", function () {
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;

    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        return uploadPhotoFile(file, widget, grid);
      });
    });

    chain.then(function () {
      input.value = "";
    });
  });
}


function addPhotoToGrid(grid, photoInput) {
  if (!grid || !photoInput) return;

  var photo = normalizePhotoRecord(photoInput);
  if (!photo || !photo.url) return;

  var box = document.createElement("div");
  box.className = "photo-box";
  box.dataset.photo = JSON.stringify(photo);

  var img = document.createElement("img");
  img.src = photo.url;
  img.alt = "inspection photo";

  var remove = document.createElement("button");
  remove.className = "remove-photo";
  remove.type = "button";
  remove.setAttribute("aria-label", "Remove photo");
  remove.textContent = "×";

  var stamp = document.createElement("div");
  stamp.className = "timestamp";
  stamp.innerHTML = escapeHtml(formatDateTime(photo.uploadedAt || new Date().toISOString())) + "<br>IronGate Pool Inspections";

  remove.addEventListener("click", function () {
    if (!confirm("Remove this photo?")) return;
    box.remove();
    saveCurrentInspection(false);
    deletePhotoFromStorage(photo);
  });

  box.appendChild(img);
  box.appendChild(remove);
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
  updateRequiredFieldMarkers();

  var summary = qs("#failureSummary");
  if (!summary) return;

  summary.innerHTML = "";

  qsa('.fence-card[data-section="fence"]').forEach(function (card) {
    addCardToSummary(card, "Fence Section", 'input[name="fenceLocation"]');
  });

  qsa(".balcony-card").forEach(function (card) {
    addCardToSummary(card, "Balcony Check", 'input[name="balconyLocation"]');
  });

  qsa(".retaining-wall-card").forEach(function (card) {
    addCardToSummary(card, "Retaining Wall / Level Change", 'input[name="retainingWallLocation"]');
  });

  qsa(".boundary-card").forEach(function (card) {
    addCardToSummary(card, "Boundary Section", 'input[name="boundaryLocation"]');
  });

  qsa(".gate-card").forEach(function (card) {
    addCardToSummary(card, "Gate Check", 'input[name="gateSectionLocation"]');
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
      updateRequiredFieldMarkers();
      saveCurrentInspection(false);
    });

    el.addEventListener("change", function () {
      if (currentTab !== "home") inspectionStarted = true;
      updateRequiredFieldMarkers();
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
    firebaseStorage = firebase.storage ? firebase.storage() : null;
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
  var newInspectionBtn = qs("#newInspectionBtn");
  if (newInspectionBtn) newInspectionBtn.onclick = startNewInspection;

  var refreshListBtn = qs("#refreshListBtn");
  if (refreshListBtn) refreshListBtn.onclick = renderInspectionList;

  // These buttons used to exist at the bottom of the Details tab.
  // They are now optional because the app autosaves and uses the top Home tab.
  var saveBtn = qs("#saveBtn");
  if (saveBtn) saveBtn.onclick = function () { saveCurrentInspection(true); };

  var backHomeBtn = qs("#backHomeBtn");
  if (backHomeBtn) backHomeBtn.onclick = function () { showTab("home"); };

  var deleteCurrentBtn = qs("#deleteCurrentBtn");
  if (deleteCurrentBtn) deleteCurrentBtn.onclick = deleteCurrentInspection;

  var addFenceBtn = qs("#addFenceSectionBtn");
  if (addFenceBtn) addFenceBtn.onclick = function () {
    if (!inspectionStarted) return;
    addFenceSection();
    saveCurrentInspection(false);
  };

  var addClimbabilityBtn = qs("#addClimbabilitySectionBtn");
  if (addClimbabilityBtn) addClimbabilityBtn.onclick = function () {
    if (!inspectionStarted) return;
    addClimbabilitySection();
    saveCurrentInspection(false);
  };

  var addBalconyBtn = qs("#addBalconySectionBtn");
  if (addBalconyBtn) addBalconyBtn.onclick = function () {
    if (!inspectionStarted) return;
    addBalconySection();
    saveCurrentInspection(false);
  };

  var addRetainingWallBtn = qs("#addRetainingWallSectionBtn");
  if (addRetainingWallBtn) addRetainingWallBtn.onclick = function () {
    if (!inspectionStarted) return;
    addRetainingWallSection();
    saveCurrentInspection(false);
  };

  var addBoundaryBtn = qs("#addBoundarySectionBtn");
  if (addBoundaryBtn) addBoundaryBtn.onclick = function () {
    if (!inspectionStarted) return;
    addBoundarySection();
    saveCurrentInspection(false);
  };

  var addGateBtn = qs("#addGateSectionBtn");
  if (addGateBtn) addGateBtn.onclick = function () {
    if (!inspectionStarted) return;
    addGateSection();
    saveCurrentInspection(false);
  };


  var addSpecialPoolFeatureBtn = qs("#addSpecialPoolFeatureSectionBtn");
  if (addSpecialPoolFeatureBtn) addSpecialPoolFeatureBtn.onclick = function () {
    if (!inspectionStarted) return;
    addSpecialPoolFeatureSection();
    saveCurrentInspection(false);
  };

  var addWaterBarrierBtn = qs("#addWaterBarrierSectionBtn");
  if (addWaterBarrierBtn) addWaterBarrierBtn.onclick = function () {
    if (!inspectionStarted) return;
    addWaterBarrierSection();
    saveCurrentInspection(false);
  };

  var addBarrierWindowBtn = qs("#addBarrierWindowSectionBtn");
  if (addBarrierWindowBtn) addBarrierWindowBtn.onclick = function () {
    if (!inspectionStarted) return;
    addBarrierWindowSection();
    saveCurrentInspection(false);
  };

  var addBarrierDoorBtn = qs("#addBarrierDoorSectionBtn");
  if (addBarrierDoorBtn) addBarrierDoorBtn.onclick = function () {
    if (!inspectionStarted) return;
    addBarrierDoorSection();
    saveCurrentInspection(false);
  };

  var addTemporaryFenceBtn = qs("#addTemporaryFenceSectionBtn");
  if (addTemporaryFenceBtn) addTemporaryFenceBtn.onclick = function () {
    if (!inspectionStarted) return;
    addTemporaryFenceSection();
    saveCurrentInspection(false);
  };

  var addDecommissionedPoolBtn = qs("#addDecommissionedPoolSectionBtn");
  if (addDecommissionedPoolBtn) addDecommissionedPoolBtn.onclick = function () {
    if (!inspectionStarted) return;
    addDecommissionedPoolSection();
    saveCurrentInspection(false);
  };

  var addReferralBtn = qs("#addReferralSectionBtn");
  if (addReferralBtn) addReferralBtn.onclick = function () {
    if (!inspectionStarted) return;
    addReferralSection();
    saveCurrentInspection(false);
  };


  qsa(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var requestedTab = getTabName(tab);

      if (requestedTab !== "home" && (currentTab === "home" || !inspectionStarted)) {
        return;
      }

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
