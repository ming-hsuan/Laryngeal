// app.js

// 與 Python 一致的系統常數
const CATEGORY_SYSTEM = "https://cch.org.tw/fhir/CodeSystem/larynx-demo-category";
const CATEGORY_CODE = "larynx-ai-report";

const MODEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/model";
const IMAGE_LABEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/image-label";
const RAW_BINARY_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/raw-binary-id";

// ------------------------------------------------------------
// UI helpers
// ------------------------------------------------------------
function showStep(step) {
  const step1View = document.getElementById("step1-view");
  const step2View = document.getElementById("step2-view");
  const step1Indicator = document.getElementById("step1-indicator");
  const step2Indicator = document.getElementById("step2-indicator");

  if (step1View && step2View) {
    step1View.style.display = step === 1 ? "block" : "none";
    step2View.style.display = step === 2 ? "block" : "none";
  }
  if (step1Indicator && step2Indicator) {
    if (step === 1) {
      step1Indicator.classList.add("active");
      step2Indicator.classList.remove("active");
    } else {
      step1Indicator.classList.remove("active");
      step2Indicator.classList.add("active");
    }
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value == null ? "" : String(value);
}

function clearImage(imgId, placeholderId) {
  const img = document.getElementById(imgId);
  const ph = document.getElementById(placeholderId);
  if (img) {
    img.removeAttribute("src");   // ✅ 不用 src=""，避免破圖 X
    img.style.display = "none";
  }
  if (ph) ph.style.display = "block";
}

function setImage(imgId, placeholderId, dataUrl) {
  const img = document.getElementById(imgId);
  const ph = document.getElementById(placeholderId);
  if (ph) ph.style.display = "none";
  if (img && dataUrl) {
    img.src = dataUrl;
    img.style.display = "block";
  }
}

function clearFrame(frameId, placeholderId) {
  const fr = document.getElementById(frameId);
  const ph = document.getElementById(placeholderId);
  if (fr) {
    fr.removeAttribute("src");
    fr.style.display = "none";
  }
  if (ph) ph.style.display = "block";
}

function setFrame(frameId, placeholderId, dataUrl) {
  const fr = document.getElementById(frameId);
  const ph = document.getElementById(placeholderId);
  if (ph) ph.style.display = "none";
  if (fr && dataUrl) {
    fr.src = dataUrl;
    fr.style.display = "block";
  }
}

// ------------------------------------------------------------
// FHIR helpers
// ------------------------------------------------------------
function getIdentifierValue(resource, system) {
  const ids = resource.identifier || [];
  const found = ids.find((id) => id.system === system);
  return found ? found.value : null;
}

function extractBinaryIdFromUrl(url) {
  if (!url) return null;
  const parts = url.split("/");
  return parts[parts.length - 1];
}

async function fetchBinaryAsDataUrl(client, binaryId) {
  const binary = await client.request("Binary/" + binaryId + "?_format=json", {
    headers: { Accept: "application/fhir+json" }
  });
  if (!binary || !binary.data) {
    console.warn("Binary/" + binaryId + " has no data");
    return null;
  }
  const ct = binary.contentType || "application/octet-stream";
  return `data:${ct};base64,${binary.data}`;
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
FHIR.oauth2
  .ready()
  .then(async function (client) {
    window.smartClient = client;

    const loadStatus = document.getElementById("loadStatus");
    const modelSelect = document.getElementById("modelSelect");
    const imageSelect = document.getElementById("imageSelect");
    const submitBtn = document.getElementById("submitBtn");
    const form = document.getElementById("metaForm");
    const debugEl = document.getElementById("debug");
    const backBtn = document.getElementById("backBtn");
    const pdfLink = document.getElementById("aiPdfDownload");

    // Debug toggle
    const debugToggle = document.getElementById("debugToggle");
    if (debugToggle && debugEl) {
      debugToggle.addEventListener("click", () => {
        const show = debugEl.style.display === "none" || debugEl.style.display === "";
        debugEl.style.display = show ? "block" : "none";
        debugToggle.textContent = show ? "Hide" : "Show";
      });
      // 預設收起
      debugEl.style.display = "none";
    }

    showStep(1);

    if (loadStatus) loadStatus.textContent = "Loading demo AI reports from THAS...";

    let docIndex = {}; // docIndex[model][imageLabel] = { rawBinaryId, pngBinaryId, pdfBinaryId }
    let models = new Set();

    // === 1) Search DocumentReference ===
    try {
      const searchParam = encodeURIComponent(CATEGORY_SYSTEM + "|" + CATEGORY_CODE);
      const url = "DocumentReference?category=" + searchParam + "&_count=50";

      const bundle = await client.request(url, {
        headers: { Accept: "application/fhir+json" }
      });

      const entries = bundle.entry || [];
      if (entries.length === 0) {
        if (loadStatus) {
          loadStatus.className = "alert alert-warning py-2 mb-3";
          loadStatus.textContent = "No demo AI reports found in THAS (DocumentReference).";
        }
      } else {
        entries.forEach((e) => {
          const doc = e.resource;
          if (!doc || doc.resourceType !== "DocumentReference") return;

          const model = getIdentifierValue(doc, MODEL_SYSTEM);
          const imageLabel = getIdentifierValue(doc, IMAGE_LABEL_SYSTEM);
          const rawBinaryId = getIdentifierValue(doc, RAW_BINARY_SYSTEM);
          if (!model || !imageLabel) return;

          const contents = doc.content || [];
          let pngBinaryId = null;
          let pdfBinaryId = null;

          contents.forEach((c) => {
            const att = c.attachment || c;
            if (!att || !att.url) return;
            if ((att.contentType || "").includes("png")) {
              pngBinaryId = extractBinaryIdFromUrl(att.url);
            } else if ((att.contentType || "").includes("pdf")) {
              pdfBinaryId = extractBinaryIdFromUrl(att.url);
            }
          });

          if (!docIndex[model]) docIndex[model] = {};
          // 同 key 不覆蓋（避免被後面的資料蓋掉）
          if (!docIndex[model][imageLabel]) {
            docIndex[model][imageLabel] = { model, imageLabel, rawBinaryId, pngBinaryId, pdfBinaryId };
          }
          models.add(model);
        });

        if (models.size === 0) {
          if (loadStatus) {
            loadStatus.className = "alert alert-warning py-2 mb-3";
            loadStatus.textContent = "Demo DocumentReference found, but missing identifiers.";
          }
        } else {
          if (loadStatus) {
            loadStatus.className = "alert alert-success py-2 mb-3";
            loadStatus.textContent = "Demo AI reports loaded. Please select model and test image.";
          }

          if (modelSelect) {
            modelSelect.innerHTML = '<option value="">Pick a model</option>';
            Array.from(models).sort().forEach((m) => {
              const opt = document.createElement("option");
              opt.value = m;
              opt.textContent = m;
              modelSelect.appendChild(opt);
            });
            modelSelect.disabled = false;
          }
        }
      }
    } catch (err) {
      console.error(err);
      if (loadStatus) {
        loadStatus.className = "alert alert-danger py-2 mb-3";
        loadStatus.textContent = "Failed to load demo AI reports from THAS. See console.";
      }
    }

    // === 2) Model change -> update image list ===
    if (modelSelect) {
      modelSelect.addEventListener("change", function () {
        const model = modelSelect.value;
        if (imageSelect) imageSelect.innerHTML = "";

        if (!model || !docIndex[model]) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "Select a model first";
          if (imageSelect) imageSelect.appendChild(opt);
          if (imageSelect) imageSelect.disabled = true;
          if (submitBtn) submitBtn.disabled = true;
          return;
        }

        const images = Object.keys(docIndex[model]).sort();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Pick a test image";
        if (imageSelect) imageSelect.appendChild(placeholder);

        images.forEach((label) => {
          const opt = document.createElement("option");
          opt.value = label;
          opt.textContent = label;
          if (imageSelect) imageSelect.appendChild(opt);
        });

        if (imageSelect) imageSelect.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
      });
    }

    // === 3) Submit -> load BMP/PNG/PDF ===
    if (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();

        const model = modelSelect ? modelSelect.value : "";
        const imageLabel = imageSelect ? imageSelect.value : "";

        if (!model || !imageLabel || !docIndex[model] || !docIndex[model][imageLabel]) {
          alert("Selected combination has no demo report. Please re-select.");
          return;
        }

        const mapping = docIndex[model][imageLabel];

        const payload = {
          patientId: (document.getElementById("patientId")?.value || "").trim(),
          patientName: (document.getElementById("patientName")?.value || "").trim(),
          patientSex: document.getElementById("patientSex")?.value || "",
          patientAge: document.getElementById("patientAge")?.value || "",
          examDate: document.getElementById("examDate")?.value || "",
          model,
          imageLabel
        };

        if (debugEl) {
          debugEl.textContent = "Collected form data:\n" + JSON.stringify(payload, null, 2);
        }

        showStep(2);

        setText("infoName", payload.patientName);
        setText("infoSexAge", payload.patientSex + " / " + payload.patientAge);
        setText("infoExamDate", payload.examDate);
        setText("infoModel", payload.model);
        setText("infoImage", payload.imageLabel);

        // ✅ 清空：不再造成破圖 X
        clearImage("previewImage", "rawPlaceholder");
        clearImage("aiSummaryImage", "pngPlaceholder");
        clearFrame("aiPdfFrame", "pdfPlaceholder");

        if (pdfLink) {
          pdfLink.style.display = "none";
          pdfLink.href = "#";
        }

        try {
          // 1) 原始 BMP
          if (mapping.rawBinaryId) {
            const rawUrl = await fetchBinaryAsDataUrl(client, mapping.rawBinaryId);
            if (rawUrl) setImage("previewImage", "rawPlaceholder", rawUrl);
          }

          // 2) AI summary PNG
          if (mapping.pngBinaryId) {
            const pngUrl = await fetchBinaryAsDataUrl(client, mapping.pngBinaryId);
            if (pngUrl) setImage("aiSummaryImage", "pngPlaceholder", pngUrl);
          }

          // 3) AI report PDF
          if (mapping.pdfBinaryId) {
            const pdfUrl = await fetchBinaryAsDataUrl(client, mapping.pdfBinaryId);
            if (pdfUrl) {
              setFrame("aiPdfFrame", "pdfPlaceholder", pdfUrl);
              if (pdfLink) {
                pdfLink.href = pdfUrl;
                pdfLink.style.display = "inline-flex";
              }
            }
          }
        } catch (err) {
          console.error(err);
          alert("Error loading images/reports from THAS. See console.");
        }
      });
    }

    // Back -> Step 1
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        showStep(1);
      });
    }
  })
  .catch(function (error) {
    console.error(error);
    alert("SMART authorization failed. See console.");
  });

