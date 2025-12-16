// app.js

// 與 Python 一致的系統常數
const CATEGORY_SYSTEM = "https://cch.org.tw/fhir/CodeSystem/larynx-demo-category";
const CATEGORY_CODE = "larynx-ai-report";

const MODEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/model";
const IMAGE_LABEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/image-label";
const RAW_BINARY_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/raw-binary-id";

// 切換 Step 1 / Step 2 畫面，同步更新步驟條
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

// 從 identifier 抓值
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

    showStep(1);

    // === 1. 從 THAS 搜出所有 demo 用的 DocumentReference ===
    if (loadStatus) {
      loadStatus.textContent = "Loading demo AI reports from THAS...";
    }

    let docIndex = {}; // docIndex[model][imageLabel] = { rawBinaryId, pngBinaryId, pdfBinaryId }
    let models = new Set();

    try {
      const searchParam = encodeURIComponent(
        CATEGORY_SYSTEM + "|" + CATEGORY_CODE
      );
      const url = "DocumentReference?category=" + searchParam + "&_count=50";

      const bundle = await client.request(url, {
        headers: { Accept: "application/fhir+json" }
      });

      const entries = bundle.entry || [];
      if (entries.length === 0) {
        if (loadStatus) {
          loadStatus.className = "alert alert-warning py-2 mb-3";
          loadStatus.textContent =
            "No demo AI reports found in THAS (DocumentReference).";
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

          if (!docIndex[model]) {
            docIndex[model] = {};
          }
          docIndex[model][imageLabel] = {
            model,
            imageLabel,
            rawBinaryId,
            pngBinaryId,
            pdfBinaryId
          };
          models.add(model);
        });

        if (models.size === 0) {
          if (loadStatus) {
            loadStatus.className = "alert alert-warning py-2 mb-3";
            loadStatus.textContent =
              "Demo DocumentReference found, but missing identifiers.";
          }
        } else {
          if (loadStatus) {
            loadStatus.className = "alert alert-success py-2 mb-3";
            loadStatus.textContent =
              "Demo AI reports loaded. Please select model and test image.";
          }

          if (modelSelect) {
            modelSelect.innerHTML = '<option value="">Pick a model</option>';
            Array.from(models)
              .sort()
              .forEach((m) => {
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
        loadStatus.textContent =
          "Failed to load demo AI reports from THAS. See console.";
      }
    }

    // === 2. 當模型改變時，更新 Image 下拉選單 ===
    if (modelSelect) {
      modelSelect.addEventListener("change", function () {
        const model = modelSelect.value;
        imageSelect.innerHTML = "";

        if (!model || !docIndex[model]) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "Select a model first";
          imageSelect.appendChild(opt);
          imageSelect.disabled = true;
          submitBtn.disabled = true;
          return;
        }

        const images = Object.keys(docIndex[model]).sort();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Pick a test image";
        imageSelect.appendChild(placeholder);

        images.forEach((label) => {
          const opt = document.createElement("option");
          opt.value = label; // 用 label 當 key
          opt.textContent = label;
          imageSelect.appendChild(opt);
        });

        imageSelect.disabled = false;
        submitBtn.disabled = false;
      });
    }

    // === 3. Submit：載入 BMP / PNG / PDF ===
    if (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();

        const model = modelSelect.value;
        const imageLabel = imageSelect.value;

        if (!model || !imageLabel || !docIndex[model] || !docIndex[model][imageLabel]) {
          alert("Selected combination has no demo report. Please re-select.");
          return;
        }

        const mapping = docIndex[model][imageLabel];

        const payload = {
          patientId: document.getElementById("patientId").value.trim(),
          patientName: document.getElementById("patientName").value.trim(),
          patientSex: document.getElementById("patientSex").value,
          patientAge: document.getElementById("patientAge").value,
          examDate: document.getElementById("examDate").value,
          model,
          imageLabel
        };

        if (debugEl) {
          debugEl.textContent =
            "Collected form data:\n" + JSON.stringify(payload, null, 2);
        }

        showStep(2);

        document.getElementById("infoName").innerText = payload.patientName;
        document.getElementById("infoSexAge").innerText =
          payload.patientSex + " / " + payload.patientAge;
        document.getElementById("infoExamDate").innerText = payload.examDate;
        document.getElementById("infoModel").innerText = payload.model;
        document.getElementById("infoImage").innerText = payload.imageLabel;

        document.getElementById("previewImage").src = "";
        document.getElementById("aiSummaryImage").src = "";
        document.getElementById("aiPdfFrame").src = "";
        const pdfLink = document.getElementById("aiPdfDownload");
        if (pdfLink) {
          pdfLink.style.display = "none";
          pdfLink.href = "#";
        }

        try {
          // 1) 原始 BMP
          if (mapping.rawBinaryId) {
            const rawUrl = await fetchBinaryAsDataUrl(client, mapping.rawBinaryId);
            if (rawUrl) {
              document.getElementById("previewImage").src = rawUrl;
            }
          }

          // 2) AI summary PNG
          if (mapping.pngBinaryId) {
            const pngUrl = await fetchBinaryAsDataUrl(client, mapping.pngBinaryId);
            if (pngUrl) {
              document.getElementById("aiSummaryImage").src = pngUrl;
            }
          }

          // 3) AI report PDF
          if (mapping.pdfBinaryId) {
            const pdfUrl = await fetchBinaryAsDataUrl(client, mapping.pdfBinaryId);
            if (pdfUrl) {
              document.getElementById("aiPdfFrame").src = pdfUrl;
              if (pdfLink) {
                pdfLink.href = pdfUrl;
                pdfLink.style.display = "inline";
              }
            }
          }
        } catch (err) {
          console.error(err);
          alert("Error loading images/reports from THAS. See console.");
        }
      });
    }

    // Back：回到 Step1
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

