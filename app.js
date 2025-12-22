// 與 Python 一致的系統常數
const CATEGORY_SYSTEM = "https://cch.org.tw/fhir/CodeSystem/larynx-demo-category";
const CATEGORY_CODE = "larynx-ai-report";

const MODEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/model";
const IMAGE_LABEL_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/image-label";
const RAW_BINARY_SYSTEM = "https://cch.org.tw/fhir/larynx-demo/raw-binary-id";

// ------------------------------------------------------------
// UI helpers
// ------------------------------------------------------------
function showEl(el, yes, displayStyle) {
  if (!el) return;
  const d = displayStyle || "block";
  el.style.display = yes ? d : "none";
}

function setStatusBanner(el, type, msg) {
  if (!el) return;
  if (!msg) {
    el.className = "alert status-banner";
    el.textContent = "";
    showEl(el, false, "block");
    return;
  }
  el.className = "alert status-banner alert-" + type;
  el.textContent = msg;
  showEl(el, true, "block");
}

function setLoading(el, yes) {
  if (!el) return;
  el.style.display = yes ? "flex" : "none";
}

function safeText(el, value) {
  if (!el) return;
  el.textContent = value == null ? "" : String(value);
}

function openLightbox(title, node) {
  const lb = document.getElementById("lightbox");
  const lbTitle = document.getElementById("lightboxTitle");
  const lbContent = document.getElementById("lightboxContent");
  if (!lb || !lbTitle || !lbContent) return;

  lbTitle.textContent = title || "Preview";
  lbContent.innerHTML = "";
  if (node) lbContent.appendChild(node);

  lb.setAttribute("aria-hidden", "false");
  lb.style.display = "block";
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  const lbContent = document.getElementById("lightboxContent");
  if (!lb || !lbContent) return;
  lbContent.innerHTML = "";
  lb.setAttribute("aria-hidden", "true");
  lb.style.display = "none";
  document.body.style.overflow = "";
}

// ------------------------------------------------------------
// 切換 Step 1 / Step 2 畫面，同步更新步驟條
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

    // Step2 controls
    const step2Status = document.getElementById("step2Status");
    const rawLoading = document.getElementById("rawLoading");
    const pngLoading = document.getElementById("pngLoading");
    const pdfLoading = document.getElementById("pdfLoading");
    const openRawBtn = document.getElementById("openRawBtn");
    const openPngBtn = document.getElementById("openPngBtn");
    const aiPdfOpenBtn = document.getElementById("aiPdfOpenBtn");
    const pdfLink = document.getElementById("aiPdfDownload");

    // Debug toggle
    const debugToggle = document.getElementById("debugToggle");
    const debugBody = document.getElementById("debugBody");
    if (debugToggle && debugBody) {
      debugToggle.addEventListener("click", () => {
        const show = debugBody.style.display === "none";
        debugBody.style.display = show ? "block" : "none";
        debugToggle.textContent = show ? "Hide" : "Show";
      });
    }

    // Lightbox close
    const lbClose = document.getElementById("lightboxClose");
    const lb = document.getElementById("lightbox");
    if (lbClose) lbClose.addEventListener("click", closeLightbox);
    if (lb) {
      lb.addEventListener("click", (e) => {
        if (e.target === lb) closeLightbox();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeLightbox();
      });
    }

    showStep(1);
    setStatusBanner(step2Status, "info", "");

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

          if (!docIndex[model]) docIndex[model] = {};

          // 同一個 key 已存在就不覆蓋（避免不小心被後面的資料蓋掉）
          if (!docIndex[model][imageLabel]) {
            docIndex[model][imageLabel] = {
              model,
              imageLabel,
              rawBinaryId,
              pngBinaryId,
              pdfBinaryId
            };
          }
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
          if (submitBtn) submitBtn.disabled = true;
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
        if (submitBtn) submitBtn.disabled = false;
      });
    }

    // === 3. Submit：載入 BMP / PNG / PDF ===
    if (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();

        setStatusBanner(step2Status, "info", ""); // 清空 banner

        const model = modelSelect.value;
        const imageLabel = imageSelect.value;

        if (!model || !imageLabel || !docIndex[model] || !docIndex[model][imageLabel]) {
          setStatusBanner(step2Status, "warning", "Selected combination has no demo report. Please re-select.");
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

        safeText(document.getElementById("infoName"), payload.patientName);
        safeText(document.getElementById("infoSexAge"), payload.patientSex + " / " + payload.patientAge);
        safeText(document.getElementById("infoExamDate"), payload.examDate);
        safeText(document.getElementById("infoModel"), payload.model);
        safeText(document.getElementById("infoImage"), payload.imageLabel);

        const previewImage = document.getElementById("previewImage");
        const aiSummaryImage = document.getElementById("aiSummaryImage");
        const aiPdfFrame = document.getElementById("aiPdfFrame");

        if (previewImage) previewImage.src = "";
        if (aiSummaryImage) aiSummaryImage.src = "";
        if (aiPdfFrame) aiPdfFrame.src = "";

        if (pdfLink) {
          pdfLink.style.display = "none";
          pdfLink.href = "#";
        }
        if (aiPdfOpenBtn) aiPdfOpenBtn.disabled = true;
        if (openRawBtn) openRawBtn.disabled = true;
        if (openPngBtn) openPngBtn.disabled = true;

        // show loading overlays
        setLoading(rawLoading, true);
        setLoading(pngLoading, true);
        setLoading(pdfLoading, true);

        let rawUrl = null;
        let pngUrl = null;
        let pdfUrl = null;

        try {
          // 1) 原始 BMP
          if (mapping.rawBinaryId) {
            rawUrl = await fetchBinaryAsDataUrl(client, mapping.rawBinaryId);
            if (rawUrl && previewImage) {
              previewImage.src = rawUrl;
              if (openRawBtn) openRawBtn.disabled = false;
            }
          } else {
            setStatusBanner(step2Status, "warning", "This demo record has no RAW binary id (BMP).");
          }
        } catch (err) {
          console.error(err);
          setStatusBanner(step2Status, "danger", "Error loading RAW image (BMP). See console.");
        } finally {
          setLoading(rawLoading, false);
        }

        try {
          // 2) AI summary PNG
          if (mapping.pngBinaryId) {
            pngUrl = await fetchBinaryAsDataUrl(client, mapping.pngBinaryId);
            if (pngUrl && aiSummaryImage) {
              aiSummaryImage.src = pngUrl;
              if (openPngBtn) openPngBtn.disabled = false;
            }
          } else {
            setStatusBanner(step2Status, "warning", "This demo record has no AI summary PNG.");
          }
        } catch (err) {
          console.error(err);
          setStatusBanner(step2Status, "danger", "Error loading AI summary image (PNG). See console.");
        } finally {
          setLoading(pngLoading, false);
        }

        try {
          // 3) AI report PDF
          if (mapping.pdfBinaryId) {
            pdfUrl = await fetchBinaryAsDataUrl(client, mapping.pdfBinaryId);
            if (pdfUrl && aiPdfFrame) {
              aiPdfFrame.src = pdfUrl;

              if (pdfLink) {
                pdfLink.href = pdfUrl;
                pdfLink.style.display = "inline-flex";
              }
              if (aiPdfOpenBtn) {
                aiPdfOpenBtn.disabled = false;
              }
            }
          } else {
            setStatusBanner(step2Status, "warning", "This demo record has no AI report PDF.");
          }
        } catch (err) {
          console.error(err);
          setStatusBanner(step2Status, "danger", "Error loading AI report (PDF). See console.");
        } finally {
          setLoading(pdfLoading, false);
        }

        // bind view buttons (lightbox)
        if (openRawBtn) {
          openRawBtn.onclick = () => {
            if (!rawUrl) return;
            const img = document.createElement("img");
            img.src = rawUrl;
            img.alt = "Original Laryngeal Image";
            openLightbox("Original Laryngeal Image", img);
          };
        }
        if (openPngBtn) {
          openPngBtn.onclick = () => {
            if (!pngUrl) return;
            const img = document.createElement("img");
            img.src = pngUrl;
            img.alt = "AI Summary Image";
            openLightbox("AI Summary Image", img);
          };
        }
        if (aiPdfOpenBtn) {
          aiPdfOpenBtn.onclick = () => {
            if (!pdfUrl) return;
            const iframe = document.createElement("iframe");
            iframe.src = pdfUrl;
            iframe.title = "AI Report (PDF)";
            openLightbox("AI Report (PDF)", iframe);
          };
        }
      });
    }

    // Back：回到 Step1
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        showStep(1);
        setStatusBanner(step2Status, "info", "");
      });
    }
  })
  .catch(function (error) {
    console.error(error);
    alert("SMART authorization failed. See console.");
  });
