// app.js

// 你剛剛上傳成功的 BMP 對應的 Binary id
const BINARY_ID = "347907";

function setStatus(msg) {
  document.getElementById("status").innerText = msg;
}

// 等 SMART 授權流程完成，取得 client
FHIR.oauth2
  .ready()
  .then(function (client) {
    setStatus(`已取得 SMART client，準備讀取 Binary/${BINARY_ID} ...`);

    // 要求回傳 FHIR JSON 版本的 Binary（不要直接拿 raw image）
    const url = `Binary/${BINARY_ID}?_format=json`;

    return client.request(url, {
      headers: {
        "Accept": "application/fhir+json"
      }
    });
  })
  .then(function (binary) {
    console.log("Binary resource:", binary);

    if (!binary.data) {
      setStatus("Binary 資源裡沒有 data 欄位，無法顯示影像。");
      return;
    }

    const contentType = binary.contentType || "image/bmp";
    const base64Data = binary.data;

    // 組出 data URL → 瀏覽器就會把它當成圖片來畫
    const imgUrl = `data:${contentType};base64,${base64Data}`;

    const imgEl = document.getElementById("larynxImage");
    imgEl.src = imgUrl;
    imgEl.style.display = "block";

    setStatus(
      `已載入 Binary/${binary.id}（${contentType}，base64 長度 ${base64Data.length}）`
    );
  })
  .catch(function (err) {
    console.error(err);
    setStatus("讀取 Binary 發生錯誤：" + (err.message || err));
  });
