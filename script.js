// script.js - frontend client untuk memanggil "public API" (konfigurable)
// ------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------
const API_BASE = "https://www.tikwm.com/api/?url=";
// - Ganti API_BASE sesuai API yang hendak dipakai.
// - Jika pakai TikHub langsung, lihat docs.tikhub.io untuk path endpoint yang benar.
// - Jika API tidak butuh key, kosongkan API_KEY.
const API_KEY = ""; // jika perlu: "Bearer xxxxx" atau "API_KEY_HERE"

// CORS proxy (testing only) - jangan pakai untuk produksi
const USE_CORS_PROXY = false;
const CORS_PROXY = "https://www.tikwm.com/api/?url="; // contoh public proxy (rate-limit & tidak disarankan)

// ------------------------------------------------------
// DOM elements (sesuaikan id di index.html mu)
// ------------------------------------------------------
const urlInput = document.getElementById("urlInput");
const gasBtn = document.getElementById("gasBtn");
const clearBtn = document.getElementById("clearBtn");
const statusBox = document.getElementById("statusBox"); // may be null in your HTML
const resultBox = document.getElementById("resultBox");
const resultList = document.getElementById("resultList");

// optional: player / thumbnail containers (jika ada di HTML)
const playerBox = document.getElementById("playerBox");
const previewVideo = document.getElementById("previewVideo");
const thumbBox = document.getElementById("thumbBox");
const thumbImg = document.getElementById("thumbImg");

// ------------------------------------------------------
// UI helpers
// ------------------------------------------------------
// --- Start: replacement for status-box helpers ---
// Pastikan status box ditempatkan tepat setelah bar tombol (.button-row)
function _ensureStatusBox() {
  // jika sudah ada di DOM, kembalikan
  let box = document.getElementById("statusBox");
  if (box) return box;

  // cari bar tombol (button-row) sebagai anchor
  const anchor = document.querySelector(".button-row") || document.querySelector(".input-row") || null;

  // buat elemen status
  box = document.createElement("div");
  box.id = "statusBox";
  box.dataset.type = "info";
  box.style.display = "none";
  box.style.marginTop = "12px";
  box.style.padding = "10px 12px";
  box.style.borderRadius = "8px";
  box.style.fontWeight = "600";
  box.style.maxWidth = "100%";
  box.style.boxSizing = "border-box";
  // default warna (CSS kamu bisa override jika nanti tambahkan selector #statusBox)
  box.style.background = "rgba(30,60,90,0.9)";
  box.style.color = "#eaf2ff";
  box.style.textAlign = "center";

  if (anchor && anchor.parentNode) {
    // sisipkan setelah anchor (di bawah tombol)
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
  } else {
    // fallback: tempatkan di dalam body sebelum resultBox
    if (typeof resultBox !== "undefined" && resultBox && resultBox.parentNode) {
      resultBox.parentNode.insertBefore(box, resultBox);
    } else {
      document.body.appendChild(box);
    }
  }
  return box;
}

function showStatus(msg, kind = "info") {
  let box = document.getElementById("statusBox") || _ensureStatusBox();
  if (!box) {
    try { alert(msg); } catch (e) {}
    return;
  }
  box.dataset.type = kind;
  box.textContent = msg;
  box.style.display = "block";

  // warna sederhana berdasarkan jenis
  if (kind === "error") {
    box.style.background = "rgba(180,40,60,0.95)";
    box.style.color = "#fff";
  } else if (kind === "success") {
    box.style.background = "rgba(30,120,60,0.95)";
    box.style.color = "#fff";
  } else {
    box.style.background = "rgba(30,60,90,0.95)";
    box.style.color = "#eaf2ff";
  }

  // auto-hide untuk pesan non-info
  clearTimeout(box._hideTimeout);
  if (kind !== "info") {
    box._hideTimeout = setTimeout(() => { hideStatus(); }, 6000);
  }
}

function hideStatus() {
  const box = document.getElementById("statusBox");
  if (!box) return;
  box.style.display = "none";
  box.textContent = "";
  box.dataset.type = "";
  if (box._hideTimeout) { clearTimeout(box._hideTimeout); box._hideTimeout = null; }
}
// --- End: replacement for status-box helpers ---

function clearResults() {
  if (resultList) resultList.innerHTML = "";
  if (resultBox) resultBox.classList.add("hidden");
  if (playerBox) playerBox.classList.add("hidden");
  if (thumbBox) thumbBox.classList.add("hidden");
  hideStatus();
}

// ------------------------------------------------------
// Utility: collect possible URLs from JSON
// ------------------------------------------------------
function collectUrls(obj, out = new Set()) {
  if (!obj) return out;
  if (typeof obj === "string") {
    const s = obj.trim();
    if (/^https?:\/\//i.test(s)) out.add(s);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const it of obj) collectUrls(it, out);
    return out;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) collectUrls(obj[k], out);
  }
  return out;
}

function pickThumbnail(json) {
  if (!json) return null;
  if (json.thumbnail) return json.thumbnail;
  if (json.cover) return json.cover;
  if (json.data && (json.data.cover || json.data.thumbnail)) return json.data.cover || json.data.thumbnail;

  const urls = Array.from(collectUrls(json));
  for (const u of urls) {
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u)) return u;
  }
  return null;
}

// ------------------------------------------------------
// Build request & call API
// ------------------------------------------------------
async function callApi(videoUrl) {
  // build endpoint (simple concat). If API expects POST or other param, modify di sini.
  let endpoint = API_BASE + encodeURIComponent(videoUrl);

  if (USE_CORS_PROXY) {
    endpoint = CORS_PROXY + endpoint;
  }

  const headers = { Accept: "application/json" };
  if (API_KEY && API_KEY.length) {
    headers["Authorization"] = API_KEY;
  }

  const res = await fetch(endpoint, { method: "GET", headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`HTTP ${res.status}`);
    err.raw = text;
    throw err;
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json") || ct.includes("text/json")) {
    return res.json();
  } else {
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch (e) {
      const err = new Error("Upstream returned non-JSON response");
      err.raw = txt;
      throw err;
    }
  }
}

// ------------------------------------------------------
// Download utility: fetch -> blob -> save
// - note: akan gagal jika file server memblok CORS (browser)
// ------------------------------------------------------
async function downloadBlob(url, filename = "video.mp4") {
  try {
    showStatus("Mengunduh file...", "info");

    // if you want to route file download through proxy for CORS testing:
    let fetchUrl = url;
    if (USE_CORS_PROXY) fetchUrl = CORS_PROXY + url;

    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error("Fetch failed: " + res.status);

    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);

    hideStatus();
  } catch (err) {
    console.error("Download error", err);
    let msg = err.message || "Gagal mendownload";
    if (String(msg).toLowerCase().includes("cors")) {
      msg = "Gagal mendownload — kemungkinan diblokir CORS. Gunakan server-proxy untuk mengatasi.";
    }
    showStatus("Error: " + msg, "error");
    throw err;
  }
}

// ------------------------------------------------------
// Render result: map various possible response shapes into UI
// ------------------------------------------------------
function renderResult(payload) {
  // normalize payload if wrapper { ok: true, result: {...} }
  if (payload && payload.ok && payload.result) payload = payload.result;

  // Try detect title/thumbnail/downloads
  const title = payload.title || payload.name || payload.desc || (payload.data && payload.data.title) || "";
  const thumbnail = pickThumbnail(payload);

  // Gather download links
  const downloads = [];

  if (Array.isArray(payload.downloads) && payload.downloads.length) {
    payload.downloads.forEach(d => {
      downloads.push({
        label: d.label || d.quality || d.name || "Video",
        url: d.url || d.link || d.src || d,
        size: d.size || d.filesize || "",
        filename: d.filename || ""
      });
    });
  }

  // common fields (tikwm-like)
  if (!downloads.length) {
    if (payload.play) downloads.push({ label: "Tanpa Watermark", url: payload.play, size: payload.size || "" });
    if (payload.wmplay) downloads.push({ label: "Dengan Watermark", url: payload.wmplay, size: payload.size || "" });
    if (payload.video && payload.video.play_addr) downloads.push({ label: "Play", url: payload.video.play_addr });
  }

  // fallback: extract URLs from object
  if (!downloads.length) {
    const urls = Array.from(collectUrls(payload));
    const preferred = urls.filter(u => /\.mp4(\?|$)/i.test(u) || /\/play\/|\/video\//i.test(u) || /play/i.test(u));
    const uniq = Array.from(new Set(preferred.length ? preferred : urls));
    uniq.forEach((u, i) => downloads.push({ label: `Detected ${i+1}`, url: u, size: "" }));
  }

  // ALSO collect image/audio URLs from payload for separate foto/audio buttons
  const allUrls = Array.from(collectUrls(payload));
  const imageUrls = allUrls.filter(u => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u));
  const audioUrls = allUrls.filter(u => /\.(mp3|m4a|aac|ogg|wav)(\?|$)/i.test(u) || /audio/i.test(u));

  const audioUrl = audioUrls.length ? audioUrls[0] : null;
  // prefer explicit thumbnail if exists
  const photoUrl = thumbnail || (imageUrls.length ? imageUrls[0] : null);

  // UI: clear previous
  resultList.innerHTML = "";

  // --- try to find a playable URL (mp4 / play-like) first ---
  let playableUrl = null;
  for (const d of downloads) {
    if (d.url && ( /\.mp4(\?|$)/i.test(d.url) || /\/play\/|\/video\//i.test(d.url) )) {
      playableUrl = d.url;
      break;
    }
  }
  if (!playableUrl && downloads.length) {
    const firstCandidate = downloads.find(d => typeof d.url === "string" && /^https?:\/\//i.test(d.url));
    if (firstCandidate) playableUrl = firstCandidate.url;
  }

  // If we have a playable url and video player present -> show it
  if (playableUrl && previewVideo && playerBox) {
    try { previewVideo.crossOrigin = "anonymous"; } catch (e) {}
    previewVideo.src = playableUrl;
    if (photoUrl) previewVideo.poster = photoUrl;
    previewVideo.load();
    playerBox.classList.remove("hidden");
    if (thumbBox) thumbBox.classList.add("hidden");
  } else {
    // show thumbnail if present (fallback)
    if (photoUrl) {
      if (thumbBox && thumbImg) {
        thumbImg.src = photoUrl;
        thumbBox.classList.remove("hidden");
      } else {
        const img = document.createElement("img");
        img.src = photoUrl;
        img.alt = title || "thumbnail";
        img.style.maxWidth = "100%";
        img.style.borderRadius = "10px";
        resultList.appendChild(img);
      }
    }
    if (playerBox) playerBox.classList.add("hidden");
  }

  // Title
  if (title) {
    const h = document.createElement("div");
    h.style.fontWeight = "700";
    h.style.margin = "8px 0";
    h.textContent = title;
    resultList.appendChild(h);
  }

  // KEEP ONLY 1 DOWNLOAD (hapus detected lain kecuali index 0)
  if (downloads.length > 1) downloads.splice(1);

  // If there's at least one download, render a single row with direct download button
  if (downloads.length) {
    const d = downloads[0];
    const node = document.createElement("div");
    node.className = "result-item";
    node.innerHTML = `
      <div style="display:flex;flex-direction:column;margin-bottom:8px;">
        <div style="font-weight:600">${d.label}</div>
        <div style="opacity:.75;font-size:13px">${d.size || ""}</div>
      </div>

      <div class="download-actions">
        <!-- Direct-download button: uses href + download attribute and data for JS fallback -->
        <a href="${d.url}" class="btn-download download-btn" data-url="${d.url}"
           data-fn="${(d.filename || "video").replace(/"/g,'')}.mp4" download>
          Download Video
        </a>
      </div>
    `;
    resultList.appendChild(node);
  } else {
    // no downloads found
    const hint = document.createElement("div");
    hint.style.opacity = "0.85";
    hint.style.marginTop = "8px";
    hint.textContent = "Tidak ada link video yang terdeteksi.";
    resultList.appendChild(hint);
  }

  // ===== new: row with Download Foto + Download Audio (single buttons) =====
  if (photoUrl || audioUrl) {
    const box = document.createElement("div");
    box.className = "result-item";
    box.style.display = "flex";
    box.style.justifyContent = "flex-start";
    box.style.gap = "12px";
    box.style.marginTop = "12px";
    box.style.alignItems = "center";

    if (photoUrl) {
  const aPhoto = document.createElement("button");
  aPhoto.className = "download-btn btn-download";
  aPhoto.dataset.url = photoUrl;
  aPhoto.dataset.fn = "photo.jpg";
  aPhoto.textContent = "Download Foto";
  box.appendChild(aPhoto);
}

if (audioUrl) {
  const aAudio = document.createElement("button");
  aAudio.className = "download-btn btn-download";
  aAudio.dataset.url = audioUrl;
  aAudio.dataset.fn = "audio.mp3";
  aAudio.textContent = "Download Audio";
  box.appendChild(aAudio);
}

    resultList.appendChild(box);
  }

  resultBox.classList.remove("hidden");
}
// ------------------------------------------------------
// Main flow: called when user clicks Gas
// ------------------------------------------------------
async function processUrl(videoUrl) {
  clearResults();
  showStatus("Loading...", "info");
  gasBtn.disabled = true;
  gasBtn.textContent = "Proses...";

  try {
    const json = await callApi(videoUrl);

    showStatus("Sukses menerima permintaan...", "success");
    renderResult(json);
  } catch (err) {
    console.error("API error:", err);
    let msg = err.message || "Gagal";
    if ((err.raw && String(err.raw).toLowerCase().includes("cors")) || msg.toLowerCase().includes("cors")) {
      msg = "Request diblokir (CORS). Solusi: gunakan server-proxy atau aktifkan CORS proxy untuk testing.";
    } else if (err.raw) {
      console.log("Upstream raw:", err.raw);
    }
    showStatus("Error: " + msg, "error");
  } finally {
    gasBtn.disabled = false;
    gasBtn.textContent = "Download";
  }
}

// ------------------------------------------------------
// Event listeners
// ------------------------------------------------------
gasBtn.addEventListener("click", () => {
  const u = (urlInput.value || "").trim();
  if (!u) {
    showStatus("Masukkan URL video dulu!", "error");
    return;
  }
  try { new URL(u); } catch { showStatus("Format URL tidak valid.", "error"); return; }
  processUrl(u);
});

clearBtn.addEventListener("click", () => {
  urlInput.value = "";
  clearResults();
});

// pastikan resultList sudah ada (element di DOM)
// Event delegation untuk tombol download (gantikan blok listener lama dengan ini)
if (resultList) {
  // pastikan listener hanya dipasang sekali
  if (!window.__downloadHandlerInstalled) {
    window.__downloadHandlerInstalled = true;

    resultList.addEventListener("click", async (e) => {
      const btn = e.target.closest(".btn-download");
      if (!btn) return; // bukan tombol kita
      e.preventDefault();

      // Validasi: pastikan user sudah input URL di input atas
      if (!urlInput || !urlInput.value.trim()) {
        showStatus("Masukkan URL video dulu.", "error");
        return;
      }

      const url = btn.dataset.url || btn.getAttribute("href");
      const filename = (btn.dataset.fn || "video.mp4").replace(/"/g, "");
      if (!url) {
        showStatus("URL download tidak tersedia.", "error");
        return;
      }

      // Coba fetch -> blob (force download). Jika upstream blokir CORS, fallback ke buka tab.
      showStatus("Mengambil file untuk diunduh...", "info");
      try {
        const fetchUrl = (USE_CORS_PROXY && CORS_PROXY) ? (CORS_PROXY + url) : url;
        const res = await fetch(fetchUrl, { mode: "cors" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();

        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);

        showStatus("Download dimulai.", "success");
        return;
      } catch (err) {
        console.warn("fetch->blob failed:", err);
        // fallback: coba paksa klik anchor (mungkin browser akan membuka/men-download)
        try {
          const a2 = document.createElement("a");
          a2.href = url;
          a2.download = filename;
          a2.target = "_blank";
          document.body.appendChild(a2);
          a2.click();
          a2.remove();
          showStatus("Mengambil gagal via fetch — membuka link di tab baru.", "info");
          return;
        } catch (e2) {
          console.error("anchor fallback failed:", e2);
          showStatus("Gagal memulai download. Coba buka link manual.", "error");
          return;
        }
      }
    });
  }
}
// init
clearResults();
hideStatus();

//INI TAMBAHAN BUAT DIRECT DOWNLOAD//
async function forceDownloadVideo(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "video.mp4";
    document.body.appendChild(a);
    a.click();

    a.remove();
    window.URL.revokeObjectURL(blobUrl);

  } catch(err) {
    alert("Gagal download video: " + err.message);
  }
}
/* NOTES:
 - Ganti API_BASE ke endpoint yang sesuai. Jika endpoint butuh POST / body JSON, ubah callApi() agar melakukan POST.
 - Jangan taruh API_KEY di client untuk production; buat server proxy dan simpan key di ENV.
 - Jika butuh, gue bisa siapkan contoh server-proxy (server.js + package.json) yang memanggil TikHub/TikWM dan meneruskan respons ke client tanpa CORS.
*/
