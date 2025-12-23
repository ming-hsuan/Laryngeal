// app.js

const CATEGORY_SYSTEM = "https://cch.org.tw/fhir/CodeSystem/larynx-demo-category";
const CATEGORY_CODE = "larynx-ai-report";

const MODEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/model";
const IMAGE_LABEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/image-label";
const RAW_BINARY_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/raw-binary-id";

// ------------------------ UI helpers ------------------------
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
    img.removeAttribute("src");  // ✅ 不用 src=""，避免破圖 X
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

function setFrame(frameId, placeholderId, url) {
  const fr = document.getElementById(frameId);
  const ph = document.getElementById(placeholderId);
  if (ph) ph.style.display = "none";
  if (fr && url) {
    fr.src = url;
    fr.style.display = "block";
  }
}

// ------------------------ FHIR helpers ------------------------
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

async function fetchBinaryResource(client, binaryId) {
  return await client.request("Binary/" + binaryId + "?_format=json", {
    headers: { Accept: "application/fhir+json" }
  });
}

function base64ToBlobUrl(b64, contentType) {
  // b64: base64 data WITHOUT prefix (Binary.data)
  const byteChars = atob(b64);
  const sliceSize = 1024;
  const byteArrays = [];
  for (let offset = 0; offset < byteChars.length; offset += sliceSize) {
    const slice = byteChars.slice(offset, offset + sliceSize);
    const byteNums = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNums[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNums));
  }
  const blob = new Blob(byteArrays, { type: contentType || "application/octet-stream" });
  return URL.createObjectURL(blob);
}

// ------------------------ Main ------------------------
FHIR.oauth2
  .ready()
  .then(async function (client) {
    window.smartClient = client;

    const loadStatus = document.getElementById("loadStatus");
    const modelSelect = document.getElementById("modelSelect");
    const imageSelect = document.getElementById("imageSelect");
    const submitBtn = document.getElementById("submitBtn");
    const form = document.getElementById("metaForm");
    const backBtn = document.getElementById("backBtn");

    const pdfOpenBtn = document.getElementById("aiPdfOpen");
    const pdfDownloadBtn = document.getElementById("aiPdfDownload");

    showStep(1);

    if (loadStatus) loadStatus.textContent = "Loading demo AI reports from THAS...";

    let docIndex = {}; // docIndex[model][imageLabel] = { rawBinaryId, pngBinaryId, pdfBinaryId }
    let models = new Set();

    // ✅ 記住上一次的 PDF blob URL，避免記憶體累積
    let currentPdfBlobUrl = null;

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
          patientName: (document.getElementById("patientName")?.value || "").trim(),
          patientSex: document.getElementById("patientSex")?.value || "",
          patientAge: document.getElementById("patientAge")?.value || "",
          examDate: document.getElementById("examDate")?.value || "",
          model,
          imageLabel
        };

        showStep(2);

        setText("infoName", payload.patientName);
        setText("infoSexAge", payload.patientSex + " / " + payload.patientAge);
        setText("infoExamDate", payload.examDate);
        setText("infoModel", payload.model);
        setText("infoImage", payload.imageLabel);

        // 清空畫面（避免破圖 X）
        clearImage("previewImage", "rawPlaceholder");
        clearImage("aiSummaryImage", "pngPlaceholder");
        clearFrame("aiPdfFrame", "pdfPlaceholder");

        // 重置 PDF 按鈕
        if (pdfOpenBtn) { pdfOpenBtn.style.display = "none"; pdfOpenBtn.href = "#"; }
        if (pdfDownloadBtn) { pdfDownloadBtn.style.display = "none"; pdfDownloadBtn.href = "#"; }

        // 釋放舊 blob URL
        if (currentPdfBlobUrl) {
          URL.revokeObjectURL(currentPdfBlobUrl);
          currentPdfBlobUrl = null;
        }

        try {
          // 1) 原始 BMP（用 data URL 顯示）
          if (mapping.rawBinaryId) {
            const rawBin = await fetchBinaryResource(client, mapping.rawBinaryId);
            if (rawBin && rawBin.data) {
              const ct = rawBin.contentType || "application/octet-stream";
              const rawUrl = `data:${ct};base64,${rawBin.data}`;
              setImage("previewImage", "rawPlaceholder", rawUrl);
            }
          }

          // 2) AI summary PNG（用 data URL 顯示）
          if (mapping.pngBinaryId) {
            const pngBin = await fetchBinaryResource(client, mapping.pngBinaryId);
            if (pngBin && pngBin.data) {
              const ct = pngBin.contentType || "image/png";
              const pngUrl = `data:${ct};base64,${pngBin.data}`;
              setImage("aiSummaryImage", "pngPlaceholder", pngUrl);
            }
          }

          // 3) AI report PDF（✅ 用 Blob URL，解決 Download/Open 空白問題）
          if (mapping.pdfBinaryId) {
            const pdfBin = await fetchBinaryResource(client, mapping.pdfBinaryId);
            if (pdfBin && pdfBin.data) {
              const ct = pdfBin.contentType || "application/pdf";
              const blobUrl = base64ToBlobUrl(pdfBin.data, ct);
              currentPdfBlobUrl = blobUrl;

              // 頁面內完整預覽
              setFrame("aiPdfFrame", "pdfPlaceholder", blobUrl);

              // 右上角：Open / Print + Download
              if (pdfOpenBtn) {
                pdfOpenBtn.href = blobUrl;
                pdfOpenBtn.style.display = "inline-flex";
              }
              if (pdfDownloadBtn) {
                pdfDownloadBtn.href = blobUrl;
                pdfDownloadBtn.style.display = "inline-flex";
                // download 檔名已在 HTML 設定
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
