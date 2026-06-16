// BarrierCheck Firebase cloud rebuild
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
var currentUserProfile = {};
var inspectorProfile = null;
var profileCompleted = false;
var settingsOverlayMandatory = false;
var currentInspectorSnapshot = null;
var pendingDeleteInspectionId = null;
var accountDeleteBusy = false;

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
  return !!firebaseUser && firebaseApproved && firebaseDataLoaded && profileCompleted;
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

function sanitizeInspectionPrefix(value) {
  var clean = String(value || "BC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
  return clean || "BC";
}

function getCurrentInspectionPrefix() {
  var profile = getEffectiveInspectorProfile ? getEffectiveInspectorProfile() : {};
  return sanitizeInspectionPrefix(profile.inspectionNumberPrefix || "BC");
}

function generateInspectionNumber() {
  var year = new Date().getFullYear();
  var prefix = getCurrentInspectionPrefix() + "-" + year + "-";
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

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function clonePlainObject(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function userProviderIds() {
  return (firebaseUser && firebaseUser.providerData ? firebaseUser.providerData : []).map(function (provider) {
    return provider.providerId;
  });
}

function getGooglePhotoUrl() {
  if (firebaseUser && firebaseUser.photoURL) return firebaseUser.photoURL;

  var providers = firebaseUser && firebaseUser.providerData ? firebaseUser.providerData : [];
  for (var i = 0; i < providers.length; i += 1) {
    if (providers[i].providerId === "google.com" && providers[i].photoURL) {
      return providers[i].photoURL;
    }
  }

  return "";
}

function getAuthDisplayName() {
  return firebaseUser && firebaseUser.displayName ? firebaseUser.displayName : "";
}

function getAuthEmail() {
  return firebaseUser && firebaseUser.email ? firebaseUser.email : "";
}

function defaultProfileIcon() {
  var googleUrl = getGooglePhotoUrl();
  if (googleUrl) {
    return { type: "google", photoURL: googleUrl, avatarId: "" };
  }
  return { type: "default", photoURL: "", avatarId: "default" };
}

function normalizeProfileIcon(icon) {
  var clean = icon || {};
  var googleUrl = getGooglePhotoUrl();

  if (clean.type === "google" && (clean.photoURL || googleUrl)) {
    return { type: "google", photoURL: clean.photoURL || googleUrl, avatarId: "" };
  }

  if (clean.type === "app" && clean.avatarId) {
    return { type: "app", photoURL: "", avatarId: clean.avatarId };
  }

  if (clean.type === "default" || clean.avatarId === "default") {
    return { type: "default", photoURL: "", avatarId: "default" };
  }

  return defaultProfileIcon();
}

function valueOrDefault(source, key, fallback) {
  if (source && Object.prototype.hasOwnProperty.call(source, key)) {
    return cleanText(source[key]);
  }
  return cleanText(fallback);
}

function normalizeInspectorProfile(profile) {
  var p = profile || {};
  var inspectorEmail = valueOrDefault(p, "inspectorEmail", getAuthEmail());
  var inspectorPhone = valueOrDefault(p, "inspectorPhone", "");
  return {
    inspectorName: valueOrDefault(p, "inspectorName", getAuthDisplayName()),
    licenceNumber: valueOrDefault(p, "licenceNumber", ""),
    inspectorEmail: inspectorEmail,
    inspectorPhone: inspectorPhone,
    businessName: valueOrDefault(p, "businessName", ""),
    businessAddress: valueOrDefault(p, "businessAddress", ""),
    businessAbn: valueOrDefault(p, "businessAbn", ""),
    businessWebsite: valueOrDefault(p, "businessWebsite", ""),
    reportEmail: valueOrDefault(p, "reportEmail", inspectorEmail),
    reportPhone: valueOrDefault(p, "reportPhone", inspectorPhone),
    reportLogoUrl: valueOrDefault(p, "reportLogoUrl", ""),
    reportFooterText: valueOrDefault(p, "reportFooterText", ""),
    inspectionNumberPrefix: sanitizeInspectionPrefix(valueOrDefault(p, "inspectionNumberPrefix", "BC")),
    profileIcon: normalizeProfileIcon(p.profileIcon)
  };
}

function isInspectorProfileComplete(profile) {
  var p = normalizeInspectorProfile(profile);
  return !!(
    p.inspectorName &&
    p.licenceNumber &&
    p.inspectorEmail &&
    p.inspectorPhone &&
    p.businessName &&
    p.profileIcon &&
    p.profileIcon.type
  );
}

function getEffectiveInspectorProfile() {
  return normalizeInspectorProfile(inspectorProfile || (currentUserProfile && currentUserProfile.inspectorProfile) || {});
}

function getProfileIconChoice(profile) {
  var icon = normalizeProfileIcon((profile || getEffectiveInspectorProfile()).profileIcon);
  if (icon.type === "google" && getGooglePhotoUrl()) return "google";
  if (icon.type === "app" && icon.avatarId) return icon.avatarId;
  return "default";
}

function buildProfileIconFromChoice(choice) {
  var googleUrl = getGooglePhotoUrl();
  if (choice === "google" && googleUrl) {
    return { type: "google", photoURL: googleUrl, avatarId: "" };
  }
  if (choice && choice.indexOf("avatar-") === 0) {
    return { type: "app", photoURL: "", avatarId: choice };
  }
  return { type: "default", photoURL: "", avatarId: "default" };
}

function avatarLabelForIcon(icon) {
  var normalized = normalizeProfileIcon(icon);
  if (normalized.type === "app" && normalized.avatarId) {
    return normalized.avatarId.replace("avatar-", "A").toUpperCase();
  }
  return "BC";
}

function renderAvatarElement(el, icon) {
  if (!el) return;
  var normalized = normalizeProfileIcon(icon);
  el.innerHTML = "";
  el.classList.toggle("has-photo", normalized.type === "google" && !!normalized.photoURL);

  if (normalized.type === "google" && normalized.photoURL) {
    var img = document.createElement("img");
    img.src = normalized.photoURL;
    img.alt = "";
    el.appendChild(img);
    return;
  }

  el.textContent = avatarLabelForIcon(normalized);
}

function updateAvatarChoiceUI(choice) {
  qsa('.avatar-choice input[name="profileIconChoice"]').forEach(function (input) {
    input.checked = input.value === choice;
    var label = input.closest(".avatar-choice");
    if (label) label.classList.toggle("selected", input.checked);
  });

  renderAvatarElement(qs("#profileAvatarPreview"), buildProfileIconFromChoice(choice));
}

function updateGoogleAvatarOption() {
  var googleChoice = qs("#googleAvatarChoice");
  var googlePreview = qs("#googleAvatarPreview");
  var googleUrl = getGooglePhotoUrl();

  if (!googleChoice) return;

  googleChoice.hidden = !googleUrl;
  if (googlePreview && googleUrl) {
    googlePreview.innerHTML = "";
    var img = document.createElement("img");
    img.src = googleUrl;
    img.alt = "";
    googlePreview.appendChild(img);
  }
}

function fillProfileForm() {
  var p = getEffectiveInspectorProfile();
  updateGoogleAvatarOption();

  var fields = {
    profileInspectorName: p.inspectorName,
    profileLicenceNumber: p.licenceNumber,
    profileEmail: p.inspectorEmail,
    profilePhone: p.inspectorPhone,
    profileBusinessName: p.businessName,
    profileBusinessAddress: p.businessAddress,
    profileBusinessAbn: p.businessAbn,
    profileBusinessWebsite: p.businessWebsite,
    profileReportEmail: p.reportEmail || p.inspectorEmail,
    profileReportPhone: p.reportPhone || p.inspectorPhone,
    profileReportLogoUrl: p.reportLogoUrl,
    profileReportFooterText: p.reportFooterText,
    profileInspectionPrefix: p.inspectionNumberPrefix || "BC"
  };

  Object.keys(fields).forEach(function (id) {
    var el = qs("#" + id);
    if (el) el.value = fields[id] || "";
  });

  updateAvatarChoiceUI(getProfileIconChoice(p));
  setProfileStatus("", false);
}

function readProfileForm() {
  var choiceInput = qs('input[name="profileIconChoice"]:checked');
  var choice = choiceInput ? choiceInput.value : "default";
  return normalizeInspectorProfile({
    inspectorName: qs("#profileInspectorName") ? qs("#profileInspectorName").value : "",
    licenceNumber: qs("#profileLicenceNumber") ? qs("#profileLicenceNumber").value : "",
    inspectorEmail: qs("#profileEmail") ? qs("#profileEmail").value : "",
    inspectorPhone: qs("#profilePhone") ? qs("#profilePhone").value : "",
    businessName: qs("#profileBusinessName") ? qs("#profileBusinessName").value : "",
    businessAddress: qs("#profileBusinessAddress") ? qs("#profileBusinessAddress").value : "",
    businessAbn: qs("#profileBusinessAbn") ? qs("#profileBusinessAbn").value : "",
    businessWebsite: qs("#profileBusinessWebsite") ? qs("#profileBusinessWebsite").value : "",
    reportEmail: qs("#profileReportEmail") ? qs("#profileReportEmail").value : "",
    reportPhone: qs("#profileReportPhone") ? qs("#profileReportPhone").value : "",
    reportLogoUrl: qs("#profileReportLogoUrl") ? qs("#profileReportLogoUrl").value : "",
    reportFooterText: qs("#profileReportFooterText") ? qs("#profileReportFooterText").value : "",
    inspectionNumberPrefix: qs("#profileInspectionPrefix") ? qs("#profileInspectionPrefix").value : "BC",
    profileIcon: buildProfileIconFromChoice(choice)
  });
}

function setProfileStatus(message, isError) {
  var status = qs("#profileStatus");
  if (!status) return;
  status.textContent = message || "";
  status.classList.toggle("error", !!isError);
}

function showSettingsMainPanel() {
  if (settingsOverlayMandatory && !profileCompleted) {
    showProfilePanel(true);
    return;
  }

  var main = qs("#settingsMainPanel");
  var form = qs("#profileForm");
  if (main) main.hidden = false;
  if (form) form.hidden = true;
  updateSettingsDisplay();
}

function showProfilePanel(mandatory) {
  settingsOverlayMandatory = !!mandatory;
  document.body.classList.toggle("profile-required", settingsOverlayMandatory && !profileCompleted);

  var main = qs("#settingsMainPanel");
  var form = qs("#profileForm");
  var title = qs("#profileTitle");
  var note = qs("#profileSetupNote");

  if (main) main.hidden = true;
  if (form) form.hidden = false;
  if (title) title.textContent = mandatory ? "Complete Inspector Profile" : "Inspector Profile";
  if (note) {
    note.textContent = mandatory
      ? "Your approved account needs these details before inspections can be started. They will prefill inspections and brand completed reports."
      : "Update your company and inspector details. Changes apply to future inspections and reports.";
  }

  fillProfileForm();
}

function openSettingsOverlay(showProfileFirst) {
  var overlay = qs("#settingsOverlay");
  if (!overlay) return;
  overlay.hidden = false;
  settingsOverlayMandatory = !!showProfileFirst && !profileCompleted;
  document.body.classList.toggle("profile-required", settingsOverlayMandatory);

  if (showProfileFirst) {
    showProfilePanel(true);
  } else {
    showSettingsMainPanel();
  }
}

function closeSettingsOverlay() {
  if (settingsOverlayMandatory && !profileCompleted) return;
  var overlay = qs("#settingsOverlay");
  if (overlay) overlay.hidden = true;
  settingsOverlayMandatory = false;
  document.body.classList.remove("profile-required");
}

function requireProfileBeforeAppUse() {
  if (!firebaseUser || !firebaseApproved || profileCompleted) return;
  openSettingsOverlay(true);
}

function saveInspectorProfile(event) {
  if (event && event.preventDefault) event.preventDefault();

  if (!firebaseDb || !firebaseUser) {
    setProfileStatus("You must be signed in before saving your profile.", true);
    return;
  }

  var clean = readProfileForm();
  if (!isInspectorProfileComplete(clean)) {
    setProfileStatus("Fill in the required inspector/company fields and choose a profile icon.", true);
    return;
  }

  var ref = getCurrentUserProfileRef();
  if (!ref) {
    setProfileStatus("Could not find your profile document.", true);
    return;
  }

  var saveBtn = qs("#profileSaveBtn");
  if (saveBtn) saveBtn.disabled = true;
  setProfileStatus("Saving profile...", false);

  ref.set({
    email: getAuthEmail(),
    displayName: getAuthDisplayName(),
    providerIds: userProviderIds(),
    inspectorProfile: clean,
    profileCompleted: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
    .then(function () {
      inspectorProfile = clean;
      currentUserProfile = currentUserProfile || {};
      currentUserProfile.inspectorProfile = clean;
      currentUserProfile.profileCompleted = true;
      profileCompleted = true;
      settingsOverlayMandatory = false;
      document.body.classList.remove("profile-required");
      updateAuthUI();
      setProfileStatus("Profile saved.", false);
      showSettingsMainPanel();
    })
    .catch(function (error) {
      console.error(error);
      setProfileStatus("Could not save profile: " + error.message, true);
    })
    .then(function () {
      if (saveBtn) saveBtn.disabled = false;
    });
}

function updateSettingsDisplay() {
  var email = getAuthEmail();
  var p = getEffectiveInspectorProfile();
  var signedIn = qs("#settingsSignedIn");
  var cloudEmail = qs("#settingsCloudEmail");
  var profileBtn = qs("#profileSettingsBtn small");

  if (signedIn) signedIn.textContent = email ? "Signed in as " + email : "Not signed in";
  if (cloudEmail) cloudEmail.textContent = email || "Not signed in";
  if (profileBtn) {
    profileBtn.textContent = profileCompleted
      ? (p.inspectorName ? p.inspectorName + " · " + p.licenceNumber : "Inspector details saved")
      : "Required before inspections can be started";
  }

  renderAvatarElement(qs("#settingsAvatar"), p.profileIcon);
}

function signOutCurrentUser() {
  if (!firebaseAuth) {
    window.location.replace("login.html");
    return;
  }

  firebaseAuth.signOut().then(function () {
    window.location.replace("login.html");
  });
}

function setNamedFieldValue(name, value) {
  var el = qs('[name="' + name + '"]');
  if (!el) return;
  if (el.type === "checkbox") {
    el.checked = !!value;
  } else {
    el.value = value || "";
  }
}

function prefillInspectionFromProfile() {
  var p = getEffectiveInspectorProfile();
  setNamedFieldValue("inspectorName", p.inspectorName);
  setNamedFieldValue("licenceNumber", p.licenceNumber);
  setNamedFieldValue("inspectorEmail", p.inspectorEmail);
  setNamedFieldValue("inspectorPhone", p.inspectorPhone);
  setNamedFieldValue("businessName", p.businessName);
}

function createInspectorSnapshotFromProfile() {
  var p = getEffectiveInspectorProfile();
  return {
    inspectorName: p.inspectorName,
    licenceNumber: p.licenceNumber,
    inspectorEmail: p.inspectorEmail,
    inspectorPhone: p.inspectorPhone,
    businessName: p.businessName,
    businessAddress: p.businessAddress,
    businessAbn: p.businessAbn,
    businessWebsite: p.businessWebsite,
    reportEmail: p.reportEmail,
    reportPhone: p.reportPhone,
    reportLogoUrl: p.reportLogoUrl,
    reportFooterText: p.reportFooterText,
    inspectionNumberPrefix: p.inspectionNumberPrefix,
    profileIcon: normalizeProfileIcon(p.profileIcon)
  };
}

function normalizeInspectorSnapshot(snapshot, fields) {
  var source = snapshot || {};
  var f = fields || {};
  var base = createInspectorSnapshotFromProfile();

  return {
    inspectorName: cleanText(source.inspectorName || f.inspectorName || base.inspectorName),
    licenceNumber: cleanText(source.licenceNumber || f.licenceNumber || base.licenceNumber),
    inspectorEmail: cleanText(source.inspectorEmail || f.inspectorEmail || base.inspectorEmail),
    inspectorPhone: cleanText(source.inspectorPhone || f.inspectorPhone || base.inspectorPhone),
    businessName: cleanText(source.businessName || f.businessName || base.businessName),
    businessAddress: cleanText(source.businessAddress || base.businessAddress),
    businessAbn: cleanText(source.businessAbn || base.businessAbn),
    businessWebsite: cleanText(source.businessWebsite || base.businessWebsite),
    reportEmail: cleanText(source.reportEmail || base.reportEmail || source.inspectorEmail || f.inspectorEmail || base.inspectorEmail),
    reportPhone: cleanText(source.reportPhone || base.reportPhone || source.inspectorPhone || f.inspectorPhone || base.inspectorPhone),
    reportLogoUrl: cleanText(source.reportLogoUrl || base.reportLogoUrl),
    reportFooterText: cleanText(source.reportFooterText || base.reportFooterText),
    inspectionNumberPrefix: sanitizeInspectionPrefix(source.inspectionNumberPrefix || base.inspectionNumberPrefix || "BC"),
    profileIcon: normalizeProfileIcon(source.profileIcon || base.profileIcon)
  };
}

function getInspectorSnapshotForCurrentInspection(fields) {
  var base = normalizeInspectorSnapshot(currentInspectorSnapshot, fields);
  var f = fields || {};

  if (Object.prototype.hasOwnProperty.call(f, "inspectorName")) base.inspectorName = cleanText(f.inspectorName);
  if (Object.prototype.hasOwnProperty.call(f, "licenceNumber")) base.licenceNumber = cleanText(f.licenceNumber);
  if (Object.prototype.hasOwnProperty.call(f, "inspectorEmail")) base.inspectorEmail = cleanText(f.inspectorEmail);
  if (Object.prototype.hasOwnProperty.call(f, "inspectorPhone")) base.inspectorPhone = cleanText(f.inspectorPhone);
  if (Object.prototype.hasOwnProperty.call(f, "businessName")) base.businessName = cleanText(f.businessName);

  return base;
}

function requestDeleteInspection(id) {
  if (!id) return;
  pendingDeleteInspectionId = id;
  var data = getInspectionById(id);
  var text = qs("#deleteSheetText");
  if (text) {
    var label = data && data.inspectionNumber ? data.inspectionNumber : "this inspection";
    text.textContent = "This will remove " + label + " and any saved evidence photos.";
  }
  var overlay = qs("#deleteConfirmOverlay");
  if (overlay) overlay.hidden = false;
}

function closeDeleteInspectionSheet() {
  pendingDeleteInspectionId = null;
  var overlay = qs("#deleteConfirmOverlay");
  if (overlay) overlay.hidden = true;
}

function confirmPendingDeleteInspection() {
  var id = pendingDeleteInspectionId;
  closeDeleteInspectionSheet();
  if (id) performDeleteInspection(id);
}

function setAccountDeleteStatus(message, isError) {
  var status = qs("#accountDeleteStatus");
  if (!status) return;
  status.textContent = message || "";
  status.classList.toggle("error", !!isError);
}

function openDeleteAccountSheet() {
  if (accountDeleteBusy) return;
  var input = qs("#accountDeleteConfirmInput");
  if (input) input.value = "";
  setAccountDeleteStatus("", false);
  var overlay = qs("#accountDeleteOverlay");
  if (overlay) overlay.hidden = false;
  setTimeout(function () {
    if (input) input.focus();
  }, 50);
}

function closeDeleteAccountSheet() {
  if (accountDeleteBusy) return;
  var overlay = qs("#accountDeleteOverlay");
  if (overlay) overlay.hidden = true;
  setAccountDeleteStatus("", false);
}

function deleteKnownAccountPhotosFromStorage() {
  var paths = [];

  function addPathsFromInspection(inspection) {
    collectPhotoPaths(inspection || {}).forEach(function (path) {
      if (path && paths.indexOf(path) === -1) paths.push(path);
    });
  }

  getInspections().forEach(addPathsFromInspection);
  if (currentInspectionId) addPathsFromInspection(gatherInspectionData());

  return Promise.all(paths.map(function (path) {
    return deletePhotoFromStorage({ path: path });
  }));
}

function deleteStorageFolderRecursively(ref) {
  if (!ref || typeof ref.listAll !== "function") return Promise.resolve();

  return ref.listAll().then(function (result) {
    var fileDeletes = (result.items || []).map(function (itemRef) {
      return itemRef.delete().catch(function (error) {
        console.warn("Could not delete Storage item", error);
      });
    });

    var folderDeletes = (result.prefixes || []).map(function (folderRef) {
      return deleteStorageFolderRecursively(folderRef);
    });

    return Promise.all(fileDeletes.concat(folderDeletes));
  }).catch(function (error) {
    console.warn("Could not list Storage folder for deletion", error);
  });
}

function deleteFirestoreInspectionDocsForCurrentUser() {
  if (!firebaseDb || !firebaseUser) return Promise.resolve();

  var collectionRef = firebaseDb.collection("users").doc(firebaseUser.uid).collection("inspections");

  return collectionRef.get().then(function (snapshot) {
    if (snapshot.empty) return Promise.resolve();

    var batches = [];
    var batch = firebaseDb.batch();
    var count = 0;

    snapshot.forEach(function (doc) {
      batch.delete(doc.ref);
      count += 1;
      if (count >= 450) {
        batches.push(batch.commit());
        batch = firebaseDb.batch();
        count = 0;
      }
    });

    if (count > 0) batches.push(batch.commit());
    return Promise.all(batches);
  });
}

function reauthenticateCurrentUserForDeletion(user) {
  if (!user || typeof user.reauthenticateWithCredential !== "function") return Promise.resolve();

  var providers = user.providerData || [];
  var hasGoogle = providers.some(function (provider) {
    return provider.providerId === "google.com";
  });
  var hasPassword = providers.some(function (provider) {
    return provider.providerId === "password";
  });

  if (hasGoogle && firebase.auth && firebase.auth.GoogleAuthProvider) {
    setAccountDeleteStatus("Confirming your Google sign-in...", false);
    var googleProvider = new firebase.auth.GoogleAuthProvider();
    return user.reauthenticateWithPopup(googleProvider);
  }

  if (hasPassword && firebase.auth && firebase.auth.EmailAuthProvider) {
    var password = window.prompt("For security, enter your current BarrierCheck password to delete your account.");
    if (!password) return Promise.reject(new Error("Account deletion cancelled because password confirmation was not completed."));
    setAccountDeleteStatus("Confirming your password...", false);
    var credential = firebase.auth.EmailAuthProvider.credential(user.email || getAuthEmail(), password);
    return user.reauthenticateWithCredential(credential);
  }

  return Promise.resolve();
}

function performAccountDeletion() {
  if (accountDeleteBusy) return;

  var input = qs("#accountDeleteConfirmInput");
  var confirmText = input ? input.value.trim().toUpperCase() : "";
  if (confirmText !== "DELETE") {
    setAccountDeleteStatus("Type DELETE to confirm account deletion.", true);
    return;
  }

  if (!firebaseEnabled || !firebaseUser || !firebaseDb) {
    setAccountDeleteStatus("You must be signed in before deleting your account.", true);
    return;
  }

  var user = firebaseUser;
  var uid = user.uid;
  var confirmBtn = qs("#accountDeleteConfirmBtn");
  var cancelBtn = qs("#accountDeleteCancelBtn");
  accountDeleteBusy = true;
  if (confirmBtn) confirmBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  setAccountDeleteStatus("Deleting account data...", false);

  if (cloudUnsubscribe) {
    cloudUnsubscribe();
    cloudUnsubscribe = null;
  }

  Promise.resolve()
    .then(function () {
      return reauthenticateCurrentUserForDeletion(user);
    })
    .then(function () {
      setAccountDeleteStatus("Deleting account data...", false);
      return firebaseDb.collection("users").doc(uid).set({
        accountDeletionRequestedAt: firebase.firestore.FieldValue.serverTimestamp(),
        subscriptionCancelRequested: true,
        subscriptionCancelRequestedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(function (error) {
        console.warn("Could not mark account deletion request", error);
      });
    })
    .then(function () {
      setAccountDeleteStatus("Deleting evidence photos...", false);
      return deleteKnownAccountPhotosFromStorage();
    })
    .then(function () {
      if (!firebaseStorage || !firebaseStorage.ref) return Promise.resolve();
      return deleteStorageFolderRecursively(firebaseStorage.ref().child("users/" + uid));
    })
    .then(function () {
      setAccountDeleteStatus("Deleting inspections...", false);
      return deleteFirestoreInspectionDocsForCurrentUser();
    })
    .then(function () {
      setAccountDeleteStatus("Deleting profile...", false);
      return firebaseDb.collection("users").doc(uid).delete();
    })
    .then(function () {
      setAccountDeleteStatus("Deleting sign-in account...", false);
      return user.delete();
    })
    .then(function () {
      currentInspectionId = null;
      inspectionStarted = false;
      cloudInspections = [];
      window.location.replace("login.html?accountDeleted=1");
    })
    .catch(function (error) {
      console.error(error);
      var message = error && error.code === "auth/requires-recent-login"
        ? "For security, sign out and sign back in, then delete your account again. Some app data may already have been removed."
        : "Could not delete account: " + (error && error.message ? error.message : "Unknown error");
      setAccountDeleteStatus(message, true);
      accountDeleteBusy = false;
      if (confirmBtn) confirmBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    });
}

function updateWorkflowBodyClasses(tabName) {
  var onHome = tabName === "home";
  var onSummary = tabName === "summary";

  document.body.classList.toggle("on-home", onHome);
  document.body.classList.toggle("on-summary", onSummary);
  document.body.classList.toggle("inspection-active", !onHome && inspectionStarted);
}

function showTab(tabName) {
  currentTab = tabName;

  qsa(".page").forEach(function (page) {
    page.classList.toggle("active-page", page.id === tabName);
  });

  qsa(".tab").forEach(function (tab) {
    tab.classList.toggle("active", getTabName(tab) === tabName);
  });

  if (tabName === "summary") {
    refreshSummary();
  }

  updateWorkflowBodyClasses(tabName);
  updateNavLock();
  window.scrollTo(0, 0);
}

function updateNavLock() {
  qsa(".tab").forEach(function (tab) {
    var locked = !inspectionStarted || !profileCompleted;
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
  if (!firebaseUser || !firebaseApproved || !firebaseDataLoaded) {
    alert("Please sign in first so the inspection can be saved online.");
    return;
  }

  if (!profileCompleted) {
    requireProfileBeforeAppUse();
    return;
  }

  clearFormForNewInspection();

  currentInspectionId = generateId();
  inspectionStarted = true;
  currentInspectorSnapshot = createInspectorSnapshotFromProfile();

  qs("#inspectionNumber").value = generateInspectionNumber();
  qs("#inspectionDate").value = getTodayDateString();
  prefillInspectionFromProfile();

  addFenceSection();
  addClimbabilitySection();
  addGateSection();

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
    inspectorSnapshot: getInspectorSnapshotForCurrentInspection(fields),
    findings: collectFindings(),
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
  currentInspectorSnapshot = normalizeInspectorSnapshot(data.inspectorSnapshot, data.fields || {});

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

  if (data.gateSections && data.gateSections.length) {
    data.gateSections.forEach(function (section) {
      addGateSection(section);
    });
  } else {
    addGateSection();
  }

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
  if (!profileCompleted) {
    requireProfileBeforeAppUse();
    return;
  }

  var data = getInspectionById(id);
  if (!loadInspectionIntoForm(data)) return;
  showTab("details");
}

function deleteInspection(id) {
  requestDeleteInspection(id);
}

function performDeleteInspection(id) {
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
    currentInspectorSnapshot = null;
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

var COMPLIANCE_RULE_BANK = [
  {
    "id": "fence-effective-height-1200",
    "field": "fenceHeight",
    "type": "number",
    "operator": ">=",
    "threshold": 1200,
    "itemType": "Fence",
    "requirement": "Effective barrier height should be at least 1200mm unless another specific barrier requirement applies.",
    "issueTemplate": "The measured effective barrier height for {item} was {value}mm, which is below the rule-bank threshold of {threshold}mm.",
    "riskTemplate": "A reduced effective barrier height may make it easier for a young child to climb over the barrier and access the pool area.",
    "recommendationTemplate": "Rectify this fence section so the effective barrier height satisfies the applicable pool safety standard before a pool safety certificate is issued.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "fence-ground-clearance-100",
    "field": "fenceGroundClearance",
    "type": "number",
    "operator": "<=",
    "threshold": 100,
    "itemType": "Fence",
    "requirement": "Ground clearance should not exceed 100mm.",
    "issueTemplate": "The recorded ground clearance for {item} was {value}mm, which is above the rule-bank threshold of {threshold}mm.",
    "riskTemplate": "Excessive ground clearance may allow a young child to pass under the barrier.",
    "recommendationTemplate": "Reduce the ground clearance or rectify the fence/ground level so the clearance satisfies the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "fence-aperture-max-100",
    "field": "fenceApertureSize",
    "type": "number_optional",
    "operator": "<=",
    "threshold": 100,
    "itemType": "Fence",
    "requirement": "Perforated or mesh barrier aperture sizes should not exceed 100mm.",
    "issueTemplate": "The recorded mesh/perforated aperture size for {item} was {value}mm, which is above the rule-bank threshold of {threshold}mm.",
    "riskTemplate": "Large apertures may compromise the barrier by allowing climbing, footholds or access through the barrier.",
    "recommendationTemplate": "Replace, modify or rectify the mesh/perforated barrier section so the aperture size satisfies the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "boundary-height-1800",
    "field": "boundaryFenceHeight",
    "type": "number_optional",
    "operator": ">=",
    "threshold": 1800,
    "itemType": "Boundary Fence",
    "requirement": "Boundary fence height should be at least 1800mm where the boundary fence forms part of the pool barrier.",
    "issueTemplate": "The recorded boundary fence height for {item} was {value}mm, which is below the rule-bank threshold of {threshold}mm.",
    "riskTemplate": "A reduced boundary barrier height may allow easier climbing or access from outside the pool area.",
    "recommendationTemplate": "Rectify the boundary fence so its effective height and non-climbable zone satisfy the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-gap-under-100",
    "field": "gateGapUnder",
    "type": "number_optional",
    "operator": "<=",
    "threshold": 100,
    "itemType": "Gate",
    "requirement": "The gap below a gate should not exceed 100mm.",
    "issueTemplate": "The recorded gap under {item} was {value}mm, which is above the rule-bank threshold of {threshold}mm.",
    "riskTemplate": "Excessive clearance below a gate may allow a young child to pass under the gate into the pool area.",
    "recommendationTemplate": "Adjust, repair or replace the gate and/or finished ground level so the gap below the gate satisfies the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-latch-height-1500",
    "field": "gateLatchHeight",
    "type": "number_optional",
    "operator": ">=",
    "threshold": 1500,
    "itemType": "Gate",
    "requirement": "Latch release height should generally be at least 1500mm unless compliant shielding or another permitted arrangement applies.",
    "issueTemplate": "The recorded latch height for {item} was {value}mm, which is below the rule-bank threshold of {threshold}mm.",
    "riskTemplate": "A low latch may be reachable by a young child and may allow unsupervised access to the pool area.",
    "recommendationTemplate": "Raise, shield or otherwise rectify the latch release arrangement so it satisfies the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-object-distance-900",
    "field": "nczDistance",
    "type": "number_optional",
    "operator": ">=",
    "threshold": 900,
    "itemType": "NCZ Object",
    "requirement": "Climbable objects should not be within the 900mm non-climbable zone where they create a foothold/handhold risk.",
    "issueTemplate": "The recorded distance from the barrier for {item} was {value}mm, which is within the rule-bank threshold of {threshold}mm.",
    "riskTemplate": "A climbable object within the non-climbable zone may assist a young child to climb the barrier and access the pool area.",
    "recommendationTemplate": "Remove or permanently relocate the object outside the non-climbable zone, or otherwise rectify the barrier arrangement so it satisfies the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "water-barrier-depth-300",
    "field": "waterBarrierDepth",
    "type": "number_optional",
    "operator": ">=",
    "threshold": 300,
    "itemType": "Permanent Body of Water",
    "requirement": "A permanent body of water used as a barrier should have sufficient depth at the relevant pool-area edge.",
    "issueTemplate": "The recorded water depth for {item} was {value}mm, which is below the rule-bank threshold of {threshold}mm.",
    "riskTemplate": "Insufficient water depth may mean the water body does not provide an effective barrier to young children.",
    "recommendationTemplate": "Review and rectify the barrier arrangement so the permanent body of water and associated barrier layout satisfy the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "barrier-surrounds-pool",
    "field": "barrierSurroundsPool",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Barrier Layout",
    "requirement": "The barrier should restrict access to the pool area.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "An incomplete or ineffective barrier layout may allow unsupervised access to the pool area.",
    "recommendationTemplate": "Rectify the barrier layout so access to the pool area is restricted in accordance with the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "barrier-building-access-controlled",
    "field": "buildingAccessControlled",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Barrier Layout",
    "requirement": "Direct building access to the pool area must be controlled where it forms part of the pool barrier arrangement.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Uncontrolled building access may allow a young child to enter the pool area without passing through a compliant barrier or gate.",
    "recommendationTemplate": "Provide or rectify compliant access control to the pool area before a pool safety certificate is issued.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "barrier-neighbour-access-controlled",
    "field": "neighbourAccessControlled",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Barrier Layout",
    "requirement": "Access from neighbouring/adjoining property should be controlled where relevant to the barrier arrangement.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Uncontrolled access from an adjoining property may compromise the intended pool barrier.",
    "recommendationTemplate": "Rectify the adjoining-property access arrangement so the pool area is appropriately isolated.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "barrier-unrelated-structures",
    "field": "poolAreaFreeOfUnrelatedStructures",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Barrier Layout",
    "requirement": "The pool area should not contain unrelated structures or items that compromise the barrier arrangement.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Unrelated structures or items may create climbability, access, or supervision risks within the pool area.",
    "recommendationTemplate": "Remove, relocate or otherwise rectify unrelated structures/items so the pool barrier arrangement remains compliant.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "fence-gaps",
    "field": "fenceGaps",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Fence",
    "requirement": "Openings / gaps compliant should be assessed as compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Openings or excessive gaps may allow access through the barrier or create footholds.",
    "recommendationTemplate": "Rectify the fence section so openings/gaps satisfy the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "fence-nczclear",
    "field": "fenceNCZClear",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Fence",
    "requirement": "NCZ clear should be assessed as compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Climbable items or footholds in the non-climbable zone may assist a young child to climb the barrier.",
    "recommendationTemplate": "Remove climbable items or rectify the barrier/NCZ arrangement so the required non-climbable zone is maintained.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "fence-projectionscompliant",
    "field": "fenceProjectionsCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Fence",
    "requirement": "Projections / indentations compliant should be assessed as compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Projections or indentations may provide handholds or footholds for climbing.",
    "recommendationTemplate": "Remove, modify or shield projections/indentations so they do not compromise the non-climbable zone.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "fence-strengthrigid",
    "field": "fenceStrengthRigid",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Fence",
    "requirement": "Strength / rigidity checked should be assessed as compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Loose or flexible barrier components may allow gaps to deform or the barrier to be pushed aside.",
    "recommendationTemplate": "Repair, reinforce or replace the fence components/posts/fixings so the barrier is stable, rigid and secure.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "fence-fixingssecure",
    "field": "fenceFixingsSecure",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Fence",
    "requirement": "Fixings secure should be assessed as compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Loose or missing fixings may reduce the strength and reliability of the barrier.",
    "recommendationTemplate": "Repair or replace fixings so all fence components are securely fixed and maintained in good condition.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "fence-materialfinishsafe",
    "field": "fenceMaterialFinishSafe",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Fence",
    "requirement": "Material / finish safe should be assessed as compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Sharp edges, projections, deterioration or unsafe finishes may create hazards and indicate poor barrier condition.",
    "recommendationTemplate": "Repair, replace or make safe the affected components so the barrier is in good condition and free of hazardous features.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "special-pool-wall-used-as-barrier",
    "field": "poolWallUsedAsBarrier",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Special Pool Feature",
    "requirement": "Where a pool wall is relied on as a barrier, the arrangement must satisfy the applicable barrier requirements.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A pool wall that does not operate as an effective barrier may allow access into the pool.",
    "recommendationTemplate": "Provide, modify or supplement the barrier arrangement so the pool wall and associated access points satisfy the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "special-pool-wall-height",
    "field": "poolWallHeightCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Special Pool Feature",
    "requirement": "A pool wall relied on as a barrier must have compliant effective height and climbability controls.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Insufficient effective height or climbability control may allow a young child to climb into the pool.",
    "recommendationTemplate": "Rectify the pool wall/barrier arrangement so effective height and non-climbable-zone requirements are satisfied.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "special-ladder-access",
    "field": "ladderAccessSecured",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Special Pool Feature",
    "requirement": "Ladders or access points associated with above-ground/inflatable pools should be secured or controlled.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "An unsecured ladder or access point may allow unsupervised entry into the pool.",
    "recommendationTemplate": "Remove, lock, isolate or otherwise secure the ladder/access point so it does not provide non-compliant access to the pool.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "special-pump-filter-climbable",
    "field": "pumpFilterClimbableAccess",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Special Pool Feature",
    "requirement": "Pump/filter equipment should not create climbable access to the pool or barrier.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Equipment positioned near the pool or barrier may act as a foothold or climbing aid.",
    "recommendationTemplate": "Relocate, shield or otherwise rectify the equipment so it does not create climbable access or compromise the barrier.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "special-holding-tank-depth",
    "field": "holdingTank300mmOrDeeper",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Special Pool Feature",
    "requirement": "Water-holding structures capable of holding 300mm or more may require further assessment as a swimming pool or hazard.",
    "issueTemplate": "{label} for {item} was recorded as Yes.",
    "riskTemplate": "A water-holding structure 300mm or deeper may create a drowning hazard or may need to be assessed as a regulated pool depending on its use and context.",
    "recommendationTemplate": "Further assess and, if required, fence, modify, decommission or otherwise rectify the structure so it satisfies Queensland pool safety requirements.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "balcony-access-controlled",
    "field": "balconyAccessControlled",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Balcony / Deck",
    "requirement": "Access from a balcony/deck/raised platform to the pool area should be controlled where relevant.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Uncontrolled access from a raised platform may compromise the barrier and allow entry to the pool area.",
    "recommendationTemplate": "Rectify the balcony/deck access arrangement so it does not provide non-compliant access to the pool area.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "balcony-barrier-compliant",
    "field": "balconyBarrierCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Balcony / Deck",
    "requirement": "Balcony/deck barriers forming part of the pool barrier must be compliant.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A non-compliant balcony/deck barrier may allow climbing or access into the pool area.",
    "recommendationTemplate": "Modify, repair or replace the balcony/deck barrier so it satisfies the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "retaining-wall-compliant",
    "field": "retainingWallCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Retaining Wall / Level Change",
    "requirement": "Retaining walls or level changes forming part of the barrier must be compliant.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A retaining wall or level change may reduce effective barrier height or create climbable access.",
    "recommendationTemplate": "Rectify the retaining wall/level-change arrangement so effective barrier height and climbability requirements are satisfied.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "boundary-neighbour-clear",
    "field": "boundaryNeighbourSideClear",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Boundary Fence",
    "requirement": "Neighbour-side issues affecting the boundary barrier should be assessed and controlled where relevant.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Climbable objects or level changes on the boundary side may compromise the effective barrier height or NCZ.",
    "recommendationTemplate": "Rectify the boundary-fence arrangement or address neighbouring-side climbability issues so the boundary barrier satisfies the applicable standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "boundary-compliant",
    "field": "boundaryCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Boundary Fence",
    "requirement": "Boundary fence sections forming part of the pool barrier must be compliant.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A non-compliant boundary fence may allow access over, under or through the barrier.",
    "recommendationTemplate": "Repair, raise, modify or replace the boundary fence section so it satisfies the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "window-opening-restricted",
    "field": "barrierWindowOpeningRestricted",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Window Forming Part of Barrier",
    "requirement": "Openable windows forming part of the barrier should be restricted or protected where required.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "An unrestricted window may provide direct access from a building into the pool area.",
    "recommendationTemplate": "Restrict, secure or protect the window opening so it satisfies the applicable child-resistant window requirements.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "window-screen-bars-fixed",
    "field": "barrierWindowScreenBarsMeshFixed",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Window Forming Part of Barrier",
    "requirement": "Screens, bars or mesh used for a barrier window should be fixed securely.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Loose or removable screens/bars may allow a child to access the pool area through the window opening.",
    "recommendationTemplate": "Secure, repair or replace the screen/bars/mesh so they are fixed and effective for the barrier arrangement.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "window-fixings-tools",
    "field": "barrierWindowFixingsRequireTools",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Window Forming Part of Barrier",
    "requirement": "Barrier window fixings should require tools to remove where required.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Fixings that can be removed without tools may allow the restriction to be bypassed.",
    "recommendationTemplate": "Replace or modify the fixings so the restriction cannot be removed without tools where required.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "window-compliant",
    "field": "barrierWindowCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Window Forming Part of Barrier",
    "requirement": "Windows forming part of the barrier must be compliant.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A non-compliant window may provide direct or climbable access to the pool area.",
    "recommendationTemplate": "Rectify the window arrangement so it satisfies the applicable pool safety standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "door-self-closing",
    "field": "barrierDoorSelfClosing",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Door / Building Access",
    "requirement": "Door/building access forming part of the pool barrier should be self-closing where required.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A door that does not self-close may be left open and allow unsupervised access to the pool area.",
    "recommendationTemplate": "Adjust, repair, replace or otherwise rectify the door/self-closing device so the access point is compliant.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "door-self-latching",
    "field": "barrierDoorSelfLatching",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Door / Building Access",
    "requirement": "Door/building access forming part of the pool barrier should be self-latching where required.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A door that does not self-latch may allow unsupervised access to the pool area.",
    "recommendationTemplate": "Adjust, repair, replace or otherwise rectify the latching arrangement so the access point is compliant.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "door-compliant",
    "field": "barrierDoorCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Door / Building Access",
    "requirement": "Door/building access forming part of the barrier must be compliant.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Non-compliant building access may bypass the pool barrier.",
    "recommendationTemplate": "Rectify the building access arrangement so it does not provide non-compliant access to the pool area.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "door-fire-exit-safe",
    "field": "barrierDoorFireExitSafe",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Door / Building Access",
    "requirement": "Fire exit arrangements should not be compromised by pool barrier rectification.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A rectification that compromises a fire exit may create a separate safety risk.",
    "recommendationTemplate": "Seek appropriate building/fire safety advice and rectify the access arrangement without compromising required fire egress.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-ncz900provided",
    "field": "ncz900Provided",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "900mm NCZ provided should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Insufficient NCZ may allow a young child to climb the barrier.",
    "recommendationTemplate": "Rectify the barrier and surrounding area so the required non-climbable zone is provided.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-nczcorrectside",
    "field": "nczCorrectSide",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "NCZ on correct side of barrier should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "An NCZ on the wrong side may not prevent child access to the pool area.",
    "recommendationTemplate": "Rectify the barrier arrangement so the NCZ is located on the appropriate side for the barrier type.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-ncznohandholdsfootholds",
    "field": "nczNoHandholdsFootholds",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "No handholds or footholds in NCZ should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Handholds or footholds may assist a young child to climb the barrier.",
    "recommendationTemplate": "Remove, shield or modify handholds/footholds so the NCZ remains clear.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-nczprojectionsindentationscompliant",
    "field": "nczProjectionsIndentationsCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "Projections / indentations compliant should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Projections or indentations may act as handholds or footholds.",
    "recommendationTemplate": "Modify, remove or shield non-compliant projections/indentations.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-nczvegetationnonclimbable",
    "field": "nczVegetationNonClimbable",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "Vegetation non-climbable should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Climbable vegetation may provide access over the barrier.",
    "recommendationTemplate": "Trim, remove or permanently maintain vegetation so it does not compromise the NCZ.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-nczobjectsremoved",
    "field": "nczObjectsRemoved",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "Objects removed from NCZ should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Objects within the NCZ may act as climbing aids.",
    "recommendationTemplate": "Remove or permanently relocate objects outside the NCZ.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-nczcompliant",
    "field": "nczCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "NCZ compliant should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A non-compliant NCZ object or condition may assist climbing of the barrier.",
    "recommendationTemplate": "Remove, relocate or rectify the object/condition so the NCZ satisfies the applicable standard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-additionalclearareamaintained",
    "field": "additionalClearAreaMaintained",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "Clear area maintained should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Items or level changes in the additional clear area may compromise effective barrier height or climbability.",
    "recommendationTemplate": "Remove or relocate items and maintain the additional clear area where required.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-effectivebarrierheightmaintained",
    "field": "effectiveBarrierHeightMaintained",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "Effective barrier height maintained should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Changes in ground level or adjacent features may reduce the effective barrier height.",
    "recommendationTemplate": "Rectify ground levels, adjacent features or barrier height so effective barrier height is maintained.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-stepsledgesraisedareasclear",
    "field": "stepsLedgesRaisedAreasClear",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "Steps / ledges / raised areas clear should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Steps, ledges or raised areas may reduce effective height or assist climbing.",
    "recommendationTemplate": "Remove, relocate, shield or otherwise rectify steps/ledges/raised areas that compromise the barrier.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-tapspoweroutletsassessed",
    "field": "tapsPowerOutletsAssessed",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "Taps / power outlets assessed should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Taps, power outlets or similar fixtures may act as climbable features.",
    "recommendationTemplate": "Remove, relocate, shield or otherwise rectify fixtures that compromise the NCZ or additional clear area.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-raisedgardenbedsassessed",
    "field": "raisedGardenBedsAssessed",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Climbability / NCZ",
    "requirement": "Raised garden beds assessed should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Raised garden beds may reduce effective height or create climbable access.",
    "recommendationTemplate": "Modify, remove or otherwise rectify raised garden beds that compromise the barrier.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "ncz-horizontal-surface",
    "field": "nczHorizontalSurface",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "NCZ Object",
    "requirement": "Substantially horizontal surfaces within the NCZ should not create climbable handholds or footholds.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A horizontal surface within the NCZ may assist climbing over the barrier.",
    "recommendationTemplate": "Remove, shield or modify the horizontal surface so it does not create a climbable feature within the NCZ.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-swingsaway",
    "field": "gateSwingsAway",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Gate opens away from pool should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A gate that swings toward the pool may not perform as intended as part of the safety barrier.",
    "recommendationTemplate": "Rehang, repair or replace the gate so it opens away from the pool area where required.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-selfclosing",
    "field": "gateSelfClosing",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Gate self-closes should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A gate that does not self-close may remain open and allow unsupervised access to the pool area.",
    "recommendationTemplate": "Adjust, repair or replace the gate/self-closing device so the gate self-closes from the required open positions.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-selflatching",
    "field": "gateSelfLatching",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Gate self-latches should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A gate that does not self-latch may allow unsupervised access to the pool area.",
    "recommendationTemplate": "Adjust, repair or replace the latch so the gate self-latches when it closes.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-closesfromanyposition",
    "field": "gateClosesFromAnyPosition",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Closes from any open position should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A gate that only closes from some positions may be left partly open.",
    "recommendationTemplate": "Adjust, repair or replace the gate/self-closing device so it closes from all required open positions.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-latchpreventsreopening",
    "field": "gateLatchPreventsReopening",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Latch prevents reopening should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A latch that does not hold securely may allow the gate to reopen after closing.",
    "recommendationTemplate": "Repair, adjust or replace the latch so it securely engages and prevents reopening.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-fullarc",
    "field": "gateFullArc",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Gate swings freely through full arc should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Obstruction or friction through the gate arc may prevent reliable self-closing/latching.",
    "recommendationTemplate": "Remove obstructions and adjust/repair the gate so it swings freely through the required arc.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-cannotbeproppedopen",
    "field": "gateCannotBeProppedOpen",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Gate cannot be propped open should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A gate that can be propped open may leave the pool area unprotected.",
    "recommendationTemplate": "Remove propping devices/conditions and rectify the gate so it cannot be secured open in a non-compliant manner.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-gapundercompliant",
    "field": "gateGapUnderCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Gap under gate compliant should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Excessive clearance below a gate may allow a child to pass underneath.",
    "recommendationTemplate": "Adjust the gate or ground level so the gap below the gate is compliant.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-latchheightcompliant",
    "field": "gateLatchHeightCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Latch height compliant should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A low or accessible latch may be operated by a young child.",
    "recommendationTemplate": "Raise, shield or otherwise modify the latch release arrangement so it is compliant.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-latchshielded",
    "field": "gateLatchShielded",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Latch shielded if required should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "An unshielded latch may be reachable by a young child through or over the gate/barrier.",
    "recommendationTemplate": "Install or rectify latch shielding where required so the latch release cannot be accessed by a young child.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-latchreachthroughgaps",
    "field": "gateLatchReachThroughGaps",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Latch cannot be reached through gaps should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Reach-through gaps may allow a child to operate the latch.",
    "recommendationTemplate": "Reduce, shield or otherwise rectify reach-through gaps near the latch.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-hingessafe",
    "field": "gateHingesSafe",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Hinges safe / not climbable should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Climbable hinges or hardware may assist climbing of the gate/barrier.",
    "recommendationTemplate": "Replace, shield or modify hinges/hardware so they do not create climbable features.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "gate-hardwaresecure",
    "field": "gateHardwareSecure",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Gate",
    "requirement": "Gate hardware secure and functional should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Loose or defective gate hardware may prevent reliable closing, latching or barrier performance.",
    "recommendationTemplate": "Repair, adjust or replace gate hardware so it is secure and functions correctly.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-cprsignpresentsafety",
    "field": "cprSignPresentSafety",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "CPR sign present should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Without a CPR sign, required emergency information may not be readily available at the pool.",
    "recommendationTemplate": "Install a compliant CPR sign in an appropriate visible location.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-cprsignvisible",
    "field": "cprSignVisible",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "CPR sign visible should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A CPR sign that is not visible from the pool area may not be usable in an emergency.",
    "recommendationTemplate": "Relocate or install the CPR sign so it is clearly visible from the pool area.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-cprsignweatherproof",
    "field": "cprSignWeatherproof",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "CPR sign weatherproof should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A damaged or non-weatherproof sign may deteriorate and become unreadable.",
    "recommendationTemplate": "Replace the CPR sign with a durable/weatherproof compliant sign.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-cprsignminimumsize",
    "field": "cprSignMinimumSize",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "CPR sign minimum size should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "An undersized sign may not meet the required display standard.",
    "recommendationTemplate": "Replace the sign with a CPR sign of compliant size and format.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-cprsigncontentcompliant",
    "field": "cprSignContentCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "CPR sign content compliant should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Incomplete or incorrect CPR information may reduce emergency response effectiveness.",
    "recommendationTemplate": "Replace the sign with a current compliant CPR sign containing the required information.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-directbuildingaccesscontrolled",
    "field": "directBuildingAccessControlled",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Direct building access controlled should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Uncontrolled building access may bypass the pool barrier.",
    "recommendationTemplate": "Rectify building access so it does not provide non-compliant direct access to the pool area.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-windowopeningrestricted",
    "field": "windowOpeningRestricted",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Window opening restricted where required should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "An unrestricted opening may allow direct access from the building to the pool area.",
    "recommendationTemplate": "Restrict, secure or otherwise rectify the window opening as required.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-screenbarsmeshfixed",
    "field": "screenBarsMeshFixed",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Screen / bars / mesh fixed correctly should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Loose or removable screens/bars/mesh may be bypassed.",
    "recommendationTemplate": "Secure, repair or replace screens/bars/mesh so they are fixed correctly.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-fixingsrequiretools",
    "field": "fixingsRequireTools",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Fixings require tools to remove should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Fixings removable without tools may allow restrictions to be bypassed.",
    "recommendationTemplate": "Replace or modify fixings so restrictions cannot be removed without tools where required.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-dooraccesscompliant",
    "field": "doorAccessCompliant",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Door does not provide non-compliant access should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A non-compliant door may provide uncontrolled access to the pool area.",
    "recommendationTemplate": "Rectify, restrict or remove the non-compliant door access arrangement.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-fireexitnotcompromised",
    "field": "fireExitNotCompromised",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Fire exit not compromised should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Barrier works that compromise fire egress may create a separate safety risk.",
    "recommendationTemplate": "Seek appropriate building/fire safety advice and rectify the access arrangement without compromising required egress.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-sharpedgesabsent",
    "field": "sharpEdgesAbsent",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Sharp edges absent should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Sharp edges may injure pool users and can indicate barrier deterioration.",
    "recommendationTemplate": "Repair, remove or make safe sharp edges and restore the barrier to good condition.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-sharpprojectionsabsent",
    "field": "sharpProjectionsAbsent",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Sharp projections absent should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Sharp projections may injure users and may act as climbable features.",
    "recommendationTemplate": "Remove, shield or make safe sharp projections.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-entrapmentspacesabsent",
    "field": "entrapmentSpacesAbsent",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Entrapment spaces absent should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Entrapment spaces may create a safety hazard.",
    "recommendationTemplate": "Rectify the affected component or opening so entrapment hazards are removed.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-loosebrokencomponentsabsent",
    "field": "looseBrokenComponentsAbsent",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Loose / broken components absent should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Loose or broken components may reduce the effectiveness of the pool barrier.",
    "recommendationTemplate": "Repair or replace loose/broken components so the barrier is maintained in good condition.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-rustedweakenedcomponentsabsent",
    "field": "rustedWeakenedComponentsAbsent",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Rusted or weakened components absent should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Corrosion or weakening may reduce barrier strength and reliability.",
    "recommendationTemplate": "Repair, reinforce or replace rusted/weakened components.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-temporaryfencesecure",
    "field": "temporaryFenceSecure",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Temporary fence appears secure should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "An insecure temporary fence may fail to restrict access to the pool area.",
    "recommendationTemplate": "Repair, brace, secure or replace the temporary fencing so it provides an effective barrier.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-barriernotalteredunsafely",
    "field": "barrierNotAlteredUnsafely",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Barrier not removed or altered unsafely should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Unsafe alteration/removal may compromise the pool barrier.",
    "recommendationTemplate": "Reinstate or rectify the barrier so it remains compliant during and after works.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-cannothold300mmwater",
    "field": "cannotHold300mmWater",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Cannot hold 300mm or more of water should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A pool claimed to be decommissioned may still be a swimming pool if it can hold 300mm or more water.",
    "recommendationTemplate": "Modify, demolish, drain or otherwise decommission the pool so it cannot hold 300mm or more water, or provide compliant pool barriers.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-certificatereadytoissue",
    "field": "certificateReadyToIssue",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Pool safety certificate ready to issue should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "A certificate should not be issued if unresolved compliance items remain.",
    "recommendationTemplate": "Resolve all outstanding compliance items before issuing a pool safety certificate.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "safety-owneradvisedactions",
    "field": "ownerAdvisedActions",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Safety / Outcome",
    "requirement": "Owner advised of required actions should be compliant or not applicable.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "The owner/occupier should be advised of required rectification actions.",
    "recommendationTemplate": "Provide clear written advice to the owner/occupier about the required actions and reinspection pathway.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "site-hazards-observed",
    "field": "siteHazardsNoted",
    "type": "select_values",
    "triggerValues": [
      "Hazards observed"
    ],
    "passValues": [
      "No hazards observed"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "General Safety",
    "requirement": "Site hazards should be noted and addressed where observed.",
    "issueTemplate": "Site hazards were recorded for {item}.",
    "riskTemplate": "Site hazards may affect safe inspection, access or use of the pool area.",
    "recommendationTemplate": "Record the hazard details and recommend that the owner/occupier remove, repair or otherwise manage the hazard.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "temporary-fencing-present-required",
    "field": "temporaryFencingPresent",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Temporary Fencing",
    "requirement": "Temporary fencing should be present and compliant where required.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "Missing or ineffective temporary fencing may allow access to a pool during construction or barrier works.",
    "recommendationTemplate": "Install or rectify temporary fencing so the pool area is restricted until the permanent barrier is compliant.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "building-work-affecting-barrier",
    "field": "buildingWorkAffectingBarrier",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Temporary Fencing / Building Work",
    "requirement": "Building work should not compromise the pool barrier.",
    "issueTemplate": "Building work affecting the barrier was recorded for {item}.",
    "riskTemplate": "Building work may create gaps, access points or removed sections that compromise the pool barrier.",
    "recommendationTemplate": "Install temporary controls and rectify/reinstate the barrier so access to the pool area remains restricted.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "minor-repairs-maintenance-noted",
    "field": "minorRepairsMaintenanceNoted",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Minor Repairs / Maintenance",
    "requirement": "Minor repairs or maintenance items should be recorded and actioned where relevant.",
    "issueTemplate": "Minor repairs or maintenance were noted for {item}.",
    "riskTemplate": "Minor defects can deteriorate and may compromise barrier performance if not addressed.",
    "recommendationTemplate": "Record the item and arrange repair/maintenance to keep the barrier in good condition.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "register-update-required",
    "field": "registerUpdateRequired",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Decommissioned / Converted Pool",
    "requirement": "Pool register updates should be completed where required.",
    "issueTemplate": "A pool register update was recorded as required for {item}.",
    "riskTemplate": "Incorrect register information may cause administrative non-compliance or confusion about pool status.",
    "recommendationTemplate": "Complete any required pool register update or administrative notification after confirming the pool status.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "observed-electricalissueobserved",
    "field": "electricalIssueObserved",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Referral / Outcome",
    "requirement": "Electrical safety issue observed should be recorded and actioned where relevant.",
    "issueTemplate": "{label} for {item} was recorded as Yes.",
    "riskTemplate": "Electrical hazards may create serious safety risks beyond the pool barrier assessment.",
    "recommendationTemplate": "Advise the owner/occupier to obtain assessment and rectification by a suitably qualified electrical practitioner.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "observed-bondingconcernnoted",
    "field": "bondingConcernNoted",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Referral / Outcome",
    "requirement": "Bonding / conductive fencing concern noted should be recorded and actioned where relevant.",
    "issueTemplate": "{label} for {item} was recorded as Yes.",
    "riskTemplate": "Conductive components or bonding concerns may create an electrical safety risk.",
    "recommendationTemplate": "Advise the owner/occupier to obtain specialist electrical advice about bonding/conductive components.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "observed-possibleasbestosobserved",
    "field": "possibleAsbestosObserved",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Referral / Outcome",
    "requirement": "Possible asbestos material observed should be recorded and actioned where relevant.",
    "issueTemplate": "{label} for {item} was recorded as Yes.",
    "riskTemplate": "Possible asbestos-containing material may create a health risk if disturbed.",
    "recommendationTemplate": "Advise the owner/occupier to obtain asbestos assessment and management advice from a suitably qualified person.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "observed-firesafetyissueobserved",
    "field": "fireSafetyIssueObserved",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Referral / Outcome",
    "requirement": "Fire safety issue observed should be recorded and actioned where relevant.",
    "issueTemplate": "{label} for {item} was recorded as Yes.",
    "riskTemplate": "Fire safety issues may create risks beyond the pool barrier assessment.",
    "recommendationTemplate": "Advise the owner/occupier to obtain appropriate building/fire safety advice.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "observed-referralrecommended",
    "field": "referralRecommended",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Referral / Outcome",
    "requirement": "Referral recommended should be recorded and actioned where relevant.",
    "issueTemplate": "{label} for {item} was recorded as Yes.",
    "riskTemplate": "A specialist referral indicates the issue may be outside the pool safety inspection scope or requires expert assessment.",
    "recommendationTemplate": "Refer the owner/occupier to an appropriately qualified person or authority and record the referral in the inspection notes.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "observed-nonconformitynoticerequired",
    "field": "nonconformityNoticeRequired",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Referral / Outcome",
    "requirement": "Nonconformity notice required should be recorded and actioned where relevant.",
    "issueTemplate": "{label} for {item} was recorded as Yes.",
    "riskTemplate": "A nonconformity notice indicates unresolved items require rectification before certification.",
    "recommendationTemplate": "Issue the required notice and clearly identify the rectification actions and reinspection requirements.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "observed-reinspectionrequired",
    "field": "reinspectionRequired",
    "type": "select_values",
    "triggerValues": [
      "Yes"
    ],
    "passValues": [
      "No"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Referral / Outcome",
    "requirement": "Reinspection required should be recorded and actioned where relevant.",
    "issueTemplate": "{label} for {item} was recorded as Yes.",
    "riskTemplate": "A reinspection is needed to verify rectification before certification.",
    "recommendationTemplate": "Arrange reinspection after the identified items have been rectified.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "certificate-ready-no",
    "field": "certificateReadyToIssue",
    "type": "select_values",
    "triggerValues": [
      "No"
    ],
    "passValues": [
      "Yes"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Inspection Outcome",
    "requirement": "A pool safety certificate should only be issued when the pool barrier is compliant and ready for certification.",
    "issueTemplate": "Pool safety certificate ready to issue was recorded as No.",
    "riskTemplate": "This indicates the inspection has unresolved compliance or administrative items before certification.",
    "recommendationTemplate": "Complete the required rectification, notices and/or reinspection steps before issuing a pool safety certificate.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "owner-advised-actions-no",
    "field": "ownerAdvisedActions",
    "type": "select_values",
    "triggerValues": [
      "No"
    ],
    "passValues": [
      "Yes"
    ],
    "naValues": [
      "N/A"
    ],
    "itemType": "Inspection Outcome",
    "requirement": "The owner/occupier should be advised of required actions where rectification is needed.",
    "issueTemplate": "Owner advised of required actions was recorded as No.",
    "riskTemplate": "The owner/occupier may not understand the required rectification actions or reinspection pathway.",
    "recommendationTemplate": "Provide clear written advice to the owner/occupier about the required actions and record that advice in the inspection notes.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "overall-result-fail",
    "field": "overallInspectionResult",
    "type": "select_values",
    "triggerValues": [
      "Fail"
    ],
    "passValues": [
      "Pass"
    ],
    "naValues": [
      "Pending"
    ],
    "itemType": "Inspection Outcome",
    "requirement": "The final inspection result should reflect whether the pool barrier is ready for certification.",
    "issueTemplate": "The overall inspection result was recorded as Fail.",
    "riskTemplate": "A failed overall result indicates unresolved items remain before a pool safety certificate can be issued.",
    "recommendationTemplate": "Address all listed issues and complete any required reinspection before issuing a pool safety certificate.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  },
  {
    "id": "select-fail-template",
    "field": "*",
    "type": "select_fail",
    "itemType": "Checklist Item",
    "requirement": "The item should be assessed as compliant or not applicable before a pool safety certificate is issued.",
    "issueTemplate": "{label} for {item} was recorded as Fail.",
    "riskTemplate": "This condition may reduce the effectiveness of the pool barrier or indicate an item requiring rectification.",
    "recommendationTemplate": "Rectify this item so it satisfies the applicable pool safety standard before a pool safety certificate is issued.",
    "source": "QDC MP 3.4 / AS 1926.1-2007 / AS 1926.2-2007 / Queensland pool safety inspector guideline 2024"
  }
];

function loadComplianceRuleBankFromFile() {
  if (!window.fetch) return;
  fetch("./rules/qld-pool-safety-2024.json?v=20260615bottomnav2", { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("Rules file could not be loaded");
      return response.json();
    })
    .then(function (data) {
      if (data && Array.isArray(data.rules) && data.rules.length) {
        COMPLIANCE_RULE_BANK = data.rules;
        updateComplianceUI();
        renderFindingsSummary();
      }
    })
    .catch(function (error) {
      console.warn("Using embedded compliance rule bank.", error);
    });
}

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



function getComplianceRuleForField(name) {
  var exact = COMPLIANCE_RULE_BANK.filter(function (rule) { return rule.field === name; })[0];
  if (exact) return exact;
  return COMPLIANCE_RULE_BANK.filter(function (rule) { return rule.field === "*"; })[0] || null;
}

function numberFromValue(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  var n = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? null : n;
}

function compareRuleValue(value, rule) {
  if (rule.operator === ">=") return value >= rule.threshold;
  if (rule.operator === "<=") return value <= rule.threshold;
  if (rule.operator === ">") return value > rule.threshold;
  if (rule.operator === "<") return value < rule.threshold;
  if (rule.operator === "===") return value === rule.threshold;
  return true;
}

function getFieldItemTitle(el) {
  var card = el.closest(".fence-card");
  if (card) {
    var h3 = card.querySelector(".fence-card-head h3") || card.querySelector("h3");
    if (h3) return h3.textContent.trim();
  }
  var details = el.closest("details");
  if (details) {
    var dh = details.querySelector("summary h3");
    if (dh) return dh.textContent.trim();
  }
  var section = el.closest(".section-card");
  if (section) {
    var sh = section.querySelector(".section-heading h2");
    if (sh) return sh.textContent.trim();
  }
  return "Inspection item";
}

function fillRuleTemplate(template, data) {
  return String(template || "")
    .replace(/\{item\}/g, data.item || "this item")
    .replace(/\{label\}/g, data.label || "This field")
    .replace(/\{value\}/g, data.value === undefined ? "" : data.value)
    .replace(/\{threshold\}/g, data.threshold === undefined ? "" : data.threshold)
    .replace(/\{requirement\}/g, data.requirement || "");
}

function evaluateComplianceForElement(el) {
  if (!el || !el.name || !el.hasAttribute("data-save")) return null;
  var value = getFieldElementValue(el);
  var rule = getComplianceRuleForField(el.name);
  if (!rule) return null;
  var label = getFieldLabel(el);
  var item = getFieldItemTitle(el);
  if (rule.type === "number" || rule.type === "number_optional") {
    var numberValue = numberFromValue(value);
    if (numberValue === null) return null;
    var pass = compareRuleValue(numberValue, rule);
    return {
      status: pass ? "pass" : "fail",
      rule: rule,
      item: item,
      label: label,
      value: numberValue,
      threshold: rule.threshold,
      requirement: rule.requirement,
      issue: pass ? "" : fillRuleTemplate(rule.issueTemplate, { item: item, label: label, value: numberValue, threshold: rule.threshold, requirement: rule.requirement }),
      risk: pass ? "" : fillRuleTemplate(rule.riskTemplate, { item: item, label: label, value: numberValue, threshold: rule.threshold, requirement: rule.requirement }),
      recommendation: pass ? "" : fillRuleTemplate(rule.recommendationTemplate, { item: item, label: label, value: numberValue, threshold: rule.threshold, requirement: rule.requirement })
    };
  }
  if (rule.type === "select_values" && el.tagName === "SELECT") {
    var triggerValues = rule.triggerValues || ["Fail"];
    var passValues = rule.passValues || ["Pass"];
    var naValues = rule.naValues || ["N/A"];

    if (triggerValues.indexOf(value) !== -1) {
      return {
        status: "fail",
        rule: rule,
        item: item,
        label: label,
        value: value,
        threshold: rule.threshold || "",
        requirement: rule.requirement,
        issue: fillRuleTemplate(rule.issueTemplate, { item: item, label: label, value: value, threshold: rule.threshold, requirement: rule.requirement }),
        risk: fillRuleTemplate(rule.riskTemplate, { item: item, label: label, value: value, threshold: rule.threshold, requirement: rule.requirement }),
        recommendation: fillRuleTemplate(rule.recommendationTemplate, { item: item, label: label, value: value, threshold: rule.threshold, requirement: rule.requirement })
      };
    }

    if (passValues.indexOf(value) !== -1) return { status: "pass", rule: rule, item: item, label: label, value: value };
    if (naValues.indexOf(value) !== -1) return { status: "na", rule: rule, item: item, label: label, value: value };
  }

  if (rule.type === "select_fail" && el.tagName === "SELECT") {
    if (value === "Fail") {
      return {
        status: "fail",
        rule: rule,
        item: item,
        label: label,
        value: value,
        threshold: "",
        requirement: rule.requirement,
        issue: fillRuleTemplate(rule.issueTemplate, { item: item, label: label, value: value, requirement: rule.requirement }),
        risk: fillRuleTemplate(rule.riskTemplate, { item: item, label: label, value: value, requirement: rule.requirement }),
        recommendation: fillRuleTemplate(rule.recommendationTemplate, { item: item, label: label, value: value, requirement: rule.requirement })
      };
    }
    if (value === "Pass") return { status: "pass", rule: rule, item: item, label: label, value: value };
    if (value === "N/A") return { status: "na", rule: rule, item: item, label: label, value: value };
  }
  return null;
}

function getComplianceContainer(el) {
  return el ? el.closest(".field, .check-field, .toggle-field") : null;
}

function clearComplianceMarkers(root) {
  var scope = root || document;
  scope.querySelectorAll(".compliance-pass, .compliance-fail, .compliance-na").forEach(function (el) {
    el.classList.remove("compliance-pass", "compliance-fail", "compliance-na");
  });
}

function updateComplianceUI(root) {
  var scope = root || document;
  clearComplianceMarkers(scope);
  scope.querySelectorAll("[data-save]").forEach(function (el) {
    var result = evaluateComplianceForElement(el);
    var container = getComplianceContainer(el);
    if (!result || !container) return;
    container.classList.toggle("compliance-pass", result.status === "pass");
    container.classList.toggle("compliance-fail", result.status === "fail");
    container.classList.toggle("compliance-na", result.status === "na");
  });
}

function collectFindings() {
  var findings = [];
  var seen = {};
  qsa("[data-save]").forEach(function (el) {
    var result = evaluateComplianceForElement(el);
    if (!result || result.status !== "fail") return;
    var key = [result.rule.id, result.item, result.label, result.value].join("|");
    if (seen[key]) return;
    seen[key] = true;
    var nearestCard = el.closest(".fence-card") || el.closest(".section-card");
    var comments = [];
    if (nearestCard) {
      nearestCard.querySelectorAll("textarea").forEach(function (textarea) {
        var text = textarea.value.trim();
        if (text) comments.push(text);
      });
    }
    findings.push({
      id: result.rule.id,
      item: result.item,
      field: result.label,
      value: result.value,
      requirement: result.requirement || "",
      issue: result.issue,
      risk: result.risk,
      recommendation: result.recommendation,
      source: result.rule.source || "Rule bank",
      inspectorNotes: comments.join(" ")
    });
  });
  return findings;
}

function renderFindingsSummary() {
  var list = qs("#findingsList");
  var empty = qs("#findingsEmpty");
  if (!list) return;
  var findings = collectFindings();
  list.innerHTML = "";
  if (empty) empty.style.display = findings.length ? "none" : "block";
  if (!findings.length) return;
  findings.forEach(function (finding, index) {
    var article = document.createElement("article");
    article.className = "finding-card";
    article.innerHTML =
      '<div class="finding-number">' + (index + 1) + '</div>' +
      '<div class="finding-content">' +
        '<h3>' + escapeHtml(finding.item) + '</h3>' +
        '<p class="finding-field"><strong>Item:</strong> ' + escapeHtml(finding.field) + '</p>' +
        '<p><strong>Issue:</strong> ' + escapeHtml(finding.issue) + '</p>' +
        '<p><strong>Risk:</strong> ' + escapeHtml(finding.risk) + '</p>' +
        '<p><strong>Recommendation:</strong> ' + escapeHtml(finding.recommendation) + '</p>' +
        (finding.inspectorNotes ? '<p><strong>Inspector notes:</strong> ' + escapeHtml(finding.inspectorNotes) + '</p>' : '') +
        '<p class="finding-source"><strong>Source:</strong> ' + escapeHtml(finding.source) + '</p>' +
      '</div>';
    list.appendChild(article);
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

  refreshSummary();
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
  renumberGateSections();
}

function renumberGateSections() {
  qsa(".gate-card").forEach(function (card, index) {
    var h3 = card.querySelector("h3");
    if (h3) h3.textContent = "Gate " + (index + 1);

    var removeBtn = card.querySelector(".remove-section-btn");
    if (removeBtn) {
      var isDefaultGate = index === 0;
      removeBtn.hidden = isDefaultGate;
      removeBtn.disabled = isDefaultGate;
      removeBtn.setAttribute("aria-hidden", isDefaultGate ? "true" : "false");
    }
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

function getReportCompanyNameForStamp() {
  var profile = getEffectiveInspectorProfile ? getEffectiveInspectorProfile() : {};
  var fieldBusiness = getFieldValue ? getFieldValue("businessName") : "";
  return cleanText(fieldBusiness || profile.businessName || "Pool Safety Inspection");
}

function buildPhotoStampLines(area, uploadedAt) {
  return [
    formatDateTime(uploadedAt),
    getCurrentInspectionNumberForStamp(),
    getPhotoAreaLabel(area),
    getReportCompanyNameForStamp()
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


function setSummaryText(id, value) {
  var el = qs("#" + id);
  if (!el) return;
  el.textContent = value === undefined || value === null || String(value).trim() === "" ? "—" : String(value);
}

function countInspectionPhotos(data) {
  var count = 0;
  function countArray(arr) {
    if (Array.isArray(arr)) count += arr.length;
  }
  function countPhotoObject(obj) {
    Object.keys(obj || {}).forEach(function (key) {
      countArray(obj[key]);
    });
  }

  countPhotoObject((data && data.photos) || {});
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
    ((data && data[sectionKey]) || []).forEach(function (section) {
      countArray(section.photos || []);
    });
  });

  return count;
}

function companyInitials(name) {
  var words = String(name || "BarrierCheck").trim().split(/\s+/).filter(function (word) { return !!word; });
  if (!words.length) return "BC";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

function setReportText(id, value) {
  var el = qs("#" + id);
  if (el) el.textContent = value || "";
}

function updateReportBranding(data, inspectorSnapshot) {
  var f = data && data.fields ? data.fields : {};
  var inspector = normalizeInspectorSnapshot(inspectorSnapshot || (data && data.inspectorSnapshot), f);
  var companyName = cleanText(inspector.businessName || f.businessName || "Pool Safety Inspection");
  var contact = [
    inspector.businessAbn ? "ABN/ACN " + inspector.businessAbn : "",
    inspector.businessAddress,
    inspector.businessWebsite,
    inspector.reportEmail || inspector.inspectorEmail,
    inspector.reportPhone || inspector.inspectorPhone
  ].filter(function (item) { return !!cleanText(item); }).join(" · ");

  var inspectionMeta = [
    (f.inspectionNumber || (data && data.inspectionNumber)) ? "Inspection " + (f.inspectionNumber || data.inspectionNumber) : "",
    f.inspectionDate ? "Date " + f.inspectionDate : "",
    inspector.inspectorName ? "Inspector " + inspector.inspectorName : "",
    inspector.licenceNumber ? "Licence " + inspector.licenceNumber : "",
    f.propertyAddress ? "Property " + f.propertyAddress : ""
  ].filter(function (item) { return !!cleanText(item); }).join(" · ");

  setReportText("reportCompanyName", companyName);
  setReportText("reportBusinessMeta", contact || [inspector.reportEmail || inspector.inspectorEmail, inspector.reportPhone || inspector.inspectorPhone].filter(function (item) { return !!item; }).join(" · "));
  setReportText("reportInspectionMeta", inspectionMeta);
  setReportText("reportFooterText", inspector.reportFooterText || "");

  var logoBox = qs("#reportLogoBox");
  if (logoBox) {
    logoBox.innerHTML = "";
    var logoUrl = cleanText(inspector.reportLogoUrl);
    if (logoUrl) {
      var img = document.createElement("img");
      img.src = logoUrl;
      img.alt = companyName + " logo";
      logoBox.appendChild(img);
      logoBox.classList.add("has-logo");
    } else {
      logoBox.textContent = companyInitials(companyName);
      logoBox.classList.remove("has-logo");
    }
  }
}

function renderSummaryPage() {
  var statusBadge = qs("#summaryStatusBadge");
  if (!statusBadge) return;

  if (!inspectionStarted) {
    statusBadge.textContent = "No inspection open";
    statusBadge.className = "summary-status-pill not-started";
    [
      "summaryInspectionNumber",
      "summaryInspectionDate",
      "summaryInspectorName",
      "summaryLicenceNumber",
      "summaryInspectorContact",
      "summaryBusinessName",
      "summaryOwnerName",
      "summaryPropertyAddress",
      "summaryOverallResult",
      "summaryCertificateReady",
      "summaryNonconformityNotice",
      "summaryReinspectionRequired"
    ].forEach(function (id) { setSummaryText(id, "—"); });
    var emptyCompletion = qs("#summaryCompletionList");
    if (emptyCompletion) emptyCompletion.innerHTML = '<p class="summary-note">Start or open an inspection to view the summary.</p>';
    setSummaryText("summaryPhotoCount", "0");
    setSummaryText("summaryFindingsCount", "0");
    updateReportBranding(null, null);
    return;
  }

  var data = gatherInspectionData();
  var f = data.fields || {};
  var status = getInspectionStatus(data);
  var findings = collectFindings();

  statusBadge.textContent = status.status;
  statusBadge.className = "summary-status-pill " + status.statusClass;

  var inspector = normalizeInspectorSnapshot(data.inspectorSnapshot, f);

  setSummaryText("summaryInspectionNumber", f.inspectionNumber || data.inspectionNumber);
  setSummaryText("summaryInspectionDate", f.inspectionDate);
  setSummaryText("summaryInspectorName", inspector.inspectorName);
  setSummaryText("summaryLicenceNumber", inspector.licenceNumber);
  setSummaryText("summaryInspectorContact", [inspector.inspectorEmail, inspector.inspectorPhone].filter(function (item) { return !!item; }).join(" · "));
  setSummaryText("summaryBusinessName", inspector.businessName);
  setSummaryText("summaryOwnerName", f.ownerName);
  setSummaryText("summaryPropertyAddress", f.propertyAddress);
  setSummaryText("summaryOverallResult", f.overallInspectionResult);
  setSummaryText("summaryCertificateReady", f.certificateReadyToIssue);
  setSummaryText("summaryNonconformityNotice", f.nonconformityNoticeRequired);
  setSummaryText("summaryReinspectionRequired", f.reinspectionRequired);
  setSummaryText("summaryPhotoCount", String(countInspectionPhotos(data)));
  setSummaryText("summaryFindingsCount", String(findings.length));
  updateReportBranding(data, inspector);

  var completion = qs("#summaryCompletionList");
  if (completion) {
    completion.innerHTML = "";
    var labels = {
      details: "Details",
      barrier: "Barrier",
      climbability: "Climbability",
      gate: "Gate",
      safety: "Safety"
    };
    Object.keys(status.sections || {}).forEach(function (key) {
      var row = document.createElement("div");
      row.className = "summary-completion-row " + (status.sections[key].complete ? "complete" : "incomplete");
      row.innerHTML = '<span>' + escapeHtml(labels[key] || key) + '</span><strong>' + (status.sections[key].complete ? "Complete" : "Incomplete") + '</strong>';
      completion.appendChild(row);
    });
  }

  var note = qs("#summaryEvidenceNote");
  if (note) {
    note.textContent = findings.length
      ? "Review the generated findings before downloading the report."
      : "No generated issues are currently recorded for this inspection.";
  }
}

function refreshSummary() {
  markFailures();
  updateRequiredFieldMarkers();
  updateComplianceUI();
  renderFindingsSummary();
  renderSummaryPage();

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
      refreshSummary();
      saveCurrentInspection(false);
    });

    el.addEventListener("change", function () {
      if (currentTab !== "home") inspectionStarted = true;
      refreshSummary();
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
    verificationStatus: "pending",
    verificationMethod: "pool_safety_inspector_register",
    trialStatus: "not_started",
    providerIds: providerIds,
    inspectorProfile: normalizeInspectorProfile({}),
    profileCompleted: false,
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
        role: "pending",
        inspectorProfile: normalizeInspectorProfile({}),
        profileCompleted: false
      };
    });
  });
}

function ensureAuthUI() {
  if (authUiReady) return;

  var settingsBtn = qs("#settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", function () {
      openSettingsOverlay(!!(firebaseUser && firebaseApproved && !profileCompleted));
    });
  }

  var settingsCloseBtn = qs("#settingsCloseBtn");
  if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettingsOverlay);

  var settingsOverlay = qs("#settingsOverlay");
  if (settingsOverlay) {
    settingsOverlay.addEventListener("click", function (event) {
      if (event.target === settingsOverlay) closeSettingsOverlay();
    });
  }

  var profileSettingsBtn = qs("#profileSettingsBtn");
  if (profileSettingsBtn) {
    profileSettingsBtn.addEventListener("click", function () {
      showProfilePanel(false);
    });
  }

  var profileBackBtn = qs("#profileBackBtn");
  if (profileBackBtn) {
    profileBackBtn.addEventListener("click", function () {
      showSettingsMainPanel();
    });
  }

  var settingsSignOutBtn = qs("#settingsSignOutBtn");
  if (settingsSignOutBtn) settingsSignOutBtn.addEventListener("click", signOutCurrentUser);

  var deleteAccountBtn = qs("#deleteAccountBtn");
  if (deleteAccountBtn) deleteAccountBtn.addEventListener("click", openDeleteAccountSheet);

  var accountDeleteCancelBtn = qs("#accountDeleteCancelBtn");
  if (accountDeleteCancelBtn) accountDeleteCancelBtn.addEventListener("click", closeDeleteAccountSheet);

  var accountDeleteConfirmBtn = qs("#accountDeleteConfirmBtn");
  if (accountDeleteConfirmBtn) accountDeleteConfirmBtn.addEventListener("click", performAccountDeletion);

  var accountDeleteOverlay = qs("#accountDeleteOverlay");
  if (accountDeleteOverlay) {
    accountDeleteOverlay.addEventListener("click", function (event) {
      if (event.target === accountDeleteOverlay) closeDeleteAccountSheet();
    });
  }

  var cancelSubscriptionBtn = qs("#cancelSubscriptionBtn");
  if (cancelSubscriptionBtn) {
    cancelSubscriptionBtn.addEventListener("click", function () {
      alert("Stripe billing is not connected yet. When it is connected, this will cancel future billing and keep access until the end of the paid period.");
    });
  }

  var profileForm = qs("#profileForm");
  if (profileForm) profileForm.addEventListener("submit", saveInspectorProfile);

  qsa('.avatar-choice input[name="profileIconChoice"]').forEach(function (input) {
    input.addEventListener("change", function () {
      updateAvatarChoiceUI(input.value);
    });
  });

  var deleteCancel = qs("#deleteSheetCancelBtn");
  if (deleteCancel) deleteCancel.addEventListener("click", closeDeleteInspectionSheet);

  var deleteConfirm = qs("#deleteSheetConfirmBtn");
  if (deleteConfirm) deleteConfirm.addEventListener("click", confirmPendingDeleteInspection);

  var deleteOverlay = qs("#deleteConfirmOverlay");
  if (deleteOverlay) {
    deleteOverlay.addEventListener("click", function (event) {
      if (event.target === deleteOverlay) closeDeleteInspectionSheet();
    });
  }

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

  var newBtn = qs("#newInspectionBtn");
  var hasSignedInApprovedUser = !!(firebaseEnabled && firebaseUser && firebaseApproved);
  var readyForInspections = !!(hasSignedInApprovedUser && firebaseDataLoaded && profileCompleted);

  updateSettingsDisplay();

  if (firebaseEnabled && firebaseUser && firebaseApproved) {
    setFirebaseStatus(firebaseDataLoaded
      ? (profileCompleted ? "Signed in and saving online" : "Profile required before inspections can start")
      : "Approved. Loading inspections...", !profileCompleted && firebaseDataLoaded);
    document.body.classList.remove("firebase-signed-out");
    document.body.classList.remove("auth-checking");
    document.body.classList.toggle("profile-required", firebaseDataLoaded && !profileCompleted);
    if (newBtn) newBtn.disabled = !readyForInspections;
    if (firebaseDataLoaded && !profileCompleted) requireProfileBeforeAppUse();
  } else if (firebaseEnabled && firebaseUser && firebaseApprovalChecked && !firebaseApproved) {
    setFirebaseStatus("Account pending approval. Redirecting to login page...", true);
    document.body.classList.remove("profile-required");
    if (newBtn) newBtn.disabled = true;
    redirectToLogin("pending=1");
  } else if (firebaseEnabled && firebaseUser) {
    setFirebaseStatus("Checking account approval...", false);
    document.body.classList.remove("profile-required");
    if (newBtn) newBtn.disabled = true;
  } else if (firebaseEnabled) {
    setFirebaseStatus("Not signed in. Redirecting...", false);
    document.body.classList.add("firebase-signed-out");
    document.body.classList.remove("profile-required");
    if (newBtn) newBtn.disabled = true;
    redirectToLogin();
  } else {
    setFirebaseStatus(firebaseLoadError || "Firebase could not load.", true);
    document.body.classList.add("firebase-signed-out");
    document.body.classList.remove("profile-required");
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
      currentUserProfile = {};
      inspectorProfile = null;
      profileCompleted = false;
      currentInspectorSnapshot = null;
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
          currentUserProfile = profile || {};
          inspectorProfile = normalizeInspectorProfile(currentUserProfile.inspectorProfile || {});
          profileCompleted = !!(currentUserProfile.profileCompleted === true && isInspectorProfileComplete(inspectorProfile));
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

  var summaryDownloadBtn = qs("#summaryDownloadBtn");
  if (summaryDownloadBtn) summaryDownloadBtn.onclick = function () {
    if (!currentInspectionId) return;
    saveCurrentInspection(false);
    startDownloadInspection(currentInspectionId);
  };

  var summaryHomeBtn = qs("#summaryHomeBtn");
  if (summaryHomeBtn) summaryHomeBtn.onclick = function () {
    saveCurrentInspection(false);
    showTab("home");
  };

  var homeNavBtn = qs("#homeNavBtn");
  if (homeNavBtn) homeNavBtn.onclick = function () {
    saveCurrentInspection(false);
    showTab("home");
  };

  var reviewSummaryBtn = qs("#reviewSummaryBtn");
  if (reviewSummaryBtn) reviewSummaryBtn.onclick = function () {
    if (!inspectionStarted) return;
    saveCurrentInspection(false);
    showTab("summary");
  };

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

      if (!profileCompleted) {
        requireProfileBeforeAppUse();
        return;
      }

      if (!inspectionStarted) {
        return;
      }

      showTab(requestedTab);
    });
  });

  prepareBlankDropdowns(document);
  loadComplianceRuleBankFromFile();
  bindSaveEvents(document);
  qsa(".photo-widget").forEach(bindPhotoWidget);
  initFirebase();

  renderInspectionList();
  showTab("home");
  refreshSummary();
}


document.addEventListener("DOMContentLoaded", init);
