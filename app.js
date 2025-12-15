// app.js

// ===== 工具：切換 Step1 / Step2 畫面 =====
function showStep(step) {
  document.getElementById("step1-view").style.display =
    step === 1 ? "block" : "none";
  document.getElementById("step2-view").style.display =
    step === 2 ? "block" : "none";
}

// ===== Demo 用：假 AI 推論 =====
// 將來你可以把這裡改成 fetch() 呼叫院內的 AI API
async function runDemoAI(payload, binaryResource) {
  // 這裡的數值是示意用，純 demo，不具醫療意義
  return {
    model: payload.model,
    parameters: {
      "Glottic gap area (demo)": 12.3,
      "Symmetry index (demo)": 0.91,
      "Vocal fold length (demo)": 1.8
    }
  };
}

// ===== 把 AI 結果包成 FHIR Observation（示意）=====
function buildObservation(payload, aiResult, binaryId) {
  // 注意：
  // 這裡假設 payload.patientId 剛好等於 FHIR 的 Patient.id
  // 如果實際上你輸入的是院內病歷號，就需要額外 mapping。
  return {
    resourceType: "Observation",
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "imaging",
            display: "Imaging"
          }
        ]
      }
    ],
    code: {
      text: "AI-assisted laryngeal image parameter analysis"
    },
    subject: {
      reference: "Patient/" + payload.patientId
    },
    effectiveDateTime: payload.examDate, // yyyy-mm-dd
    derivedFrom: [
      {
        reference: "Binary/" + binaryId
      }
    ],
    component: Object.entries(aiResult.parameters).map(([name, value]) => ({
      code: { text: name },
      valueQuantity: {
        value: value,
        unit: "demo-unit"
      }
    }))
  };
}

// ===== 主流程：等待 SMART client 準備好 =====
FHIR.oauth2
  .ready()
  .then(function (client) {
    // 把 client 存起來，有需要你也可以在 console 用 window.smartClient 測試
    window.smartClient = client;

    const form = document.getElementById("metaForm");
    const debugEl = document.getElementById("debug");
    const backBtn = document.getElementById("backBtn");
    const saveObsBtn = document.getElementById("saveObsBtn");

    let lastPayload = null;
    let lastBinaryId = null;
    let lastAiResult = null;

    // 預設顯示 Step1
    showStep(1);

    // Step1 Submit：進入 Step2
    form.addEventListener("submit", async function (e) {
      e.preventDefault();

      const payload = {
        patientId: document.getElementById("patientId").value.trim(),
        patientName: document.getElementById("patientName").value.trim(),
        patientSex: document.getElementById("patientSex").value,
        patientAge: document.getElementById("patientAge").value,
        examDate: document.getElementById("examDate").value, // yyyy-mm-dd
        model: document.getElementById("modelSelect").value,
        imageBinaryId: document.getElementById("imageSelect").value
      };

      lastPayload = payload;
      lastBinaryId = payload.imageBinaryId;

      // 在畫面底下顯示收集到的表單資料（debug 用）
      debugEl.textContent =
        "Collected form data:\n" + JSON.stringify(payload, null, 2);

      // 切到 Step2，先給一個 loading 訊息
      showStep(2);
      document.getElementById("infoPanel").textContent = "Loading image...";
      document.getElementById("aiResultPanel").textContent = "Running AI (demo)...";

      try {
        // 1) 從 FHIR 抓 Binary
        const binary = await client.request(
          "Binary/" + payload.imageBinaryId + "?_format=json",
          { headers: { Accept: "application/fhir+json" } }
        );

        // 2) 顯示影像
        if (!binary.data) {
          document.getElementById("infoPanel").textContent =
            "Binary resource has no data field.";
          document.getElementById("aiResultPanel").textContent = "";
          return;
        }

        const contentType = binary.contentType || "image/bmp";
        const base64Data = binary.data;
        const imgUrl = `data:${contentType};base64,${base64Data}`;

        const img = document.getElementById("previewImage");
        img.src = imgUrl;

        // 3) 顯示病人與檢查資訊
        const info = {
          patientId: payload.patientId,
          patientName: payload.patientName,
          patientSex: payload.patientSex,
          patientAge: payload.patientAge,
          examDate: payload.examDate,
          model: payload.model,
          imageBinaryId: payload.imageBinaryId
        };
        document.getElementById("infoPanel").textContent = JSON.stringify(
          info,
          null,
          2
        );

        // 4) Demo：跑假 AI
        const aiResult = await runDemoAI(payload, binary);
        lastAiResult = aiResult;
        document.getElementById("aiResultPanel").textContent = JSON.stringify(
          aiResult,
          null,
          2
        );
      } catch (err) {
        console.error(err);
        document.getElementById("infoPanel").textContent =
          "Error loading image or running AI. See console.";
        document.getElementById("aiResultPanel").textContent = "";
      }
    });

    // Back 按鈕：回到 Step1
    backBtn.addEventListener("click", function () {
      showStep(1);
    });

    // Save as FHIR Observation
    saveObsBtn.addEventListener("click", async function () {
      if (!lastPayload || !lastAiResult || !lastBinaryId) {
        alert("沒有可儲存的結果。請先完成 Submit。");
        return;
      }

      const obs = buildObservation(lastPayload, lastAiResult, lastBinaryId);

      try {
        const created = await client.request("Observation", {
          method: "POST",
          headers: { "Content-Type": "application/fhir+json" },
          body: JSON.stringify(obs)
        });

        alert("Observation created: " + created.id);
      } catch (err) {
        console.error(err);
        alert("Failed to save Observation. See console.");
      }
    });
  })
  .catch(function (error) {
    console.error(error);
    alert("SMART 授權發生錯誤，請查看開發者主控台。");
  });
