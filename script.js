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
const statusBox = document.getElementById("statusBox");
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
function showStatus(msg, kind = "info") {
  if (!statusBox) return;
  statusBox.classList.remove("hidden");
  statusBox.textContent = msg;
  statusBox.dataset.type = kind;
}
function hideStatus() {
  if (!statusBox) return;
  statusBox.classList.add("hidden");
  statusBox.textContent = "";
}
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
  // normalize wrapper
  if (payload && payload.ok && payload.result) payload = payload.result;

  // judul & thumbnail
  const title = payload.title || payload.name || payload.desc || (payload.data && payload.data.title) || "";
  const thumbnail = pickThumbnail(payload);

  // kumpulkan download links
  const downloads = [];
  if (Array.isArray(payload.downloads) && payload.downloads.length) {
    payload.downloads.forEach(d => {
      downloads.push({
        label: d.label || d.quality || d.name || "Video",
        url: d.url || d.link || d.src || d,
        size: d.size || d.filesize || "",
      });
    });
  }

  // tikwm-like fields
  if (!downloads.length) {
    if (payload.play) downloads.push({ label: "Tanpa Watermark", url: payload.play });
    if (payload.wmplay) downloads.push({ label: "Dengan Watermark", url: payload.wmplay });
  }

  // fallback collect
  if (!downloads.length) {
    const urls = Array.from(collectUrls(payload));
    const preferred = urls.filter(u => /\.mp4(\?|$)/i.test(u) || /video|play/i.test(u));
    const uniq = Array.from(new Set(preferred.length ? preferred : urls));
    uniq.forEach((u, i) => downloads.push({ label: `Video ${i+1}`, url: u }));
  }

  resultList.innerHTML = "";

  // TAMPILKAN VIDEO PREVIEW
  if (downloads.length && previewVideo && playerBox) {
    const vid = downloads[0].url;
    previewVideo.src = vid;
    previewVideo.load();
    playerBox.classList.remove("hidden");
  }

  // TAMPILKAN THUMBNAIL
  if (thumbnail) {
    if (thumbBox && thumbImg) {
      thumbImg.src = thumbnail;
      thumbBox.classList.remove("hidden");
    }
  }

  // JUDUL
  if (title) {
    const h = document.createElement("div");
    h.style.fontWeight = "700";
    h.style.margin = "10px 0";
    h.textContent = title;
    resultList.appendChild(h);
  }

  // -------------------------------------------
  // BAGIAN TOMBOL UTAMA
  // -------------------------------------------

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.flexDirection = "column";
  btnRow.style.gap = "12px";
  btnRow.style.marginTop = "18px";

  // --- 1) DOWNLOAD VIDEO (utama)
  if (downloads.length) {
    const btnVid = document.createElement("a");
    btnVid.href = downloads[0].url;
    btnVid.download = "";
    btnVid.className = "download-btn";
    btnVid.textContent = "Download Video";
    btnRow.appendChild(btnVid);
  }

  // --- 2) DOWNLOAD FOTO (thumbnail)
  if (thumbnail) {
    const btnFoto = document.createElement("a");
    btnFoto.href = thumbnail;
    btnFoto.download = "";
    btnFoto.className = "download-btn";
    btnFoto.textContent = "Download Foto";
    btnRow.appendChild(btnFoto);
  }

  // --- 3) DOWNLOAD AUDIO
  const urls = Array.from(collectUrls(payload));
  const audio = urls.find(u => /\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(u) || /audio/i.test(u));
  if (audio) {
    const btnAudio = document.createElement("a");
    btnAudio.href = audio;
    btnAudio.download = "";
    btnAudio.className = "download-btn";
    btnAudio.textContent = "Download Audio";
    btnRow.appendChild(btnAudio);
  }

  // masukin ke list
  resultList.appendChild(btnRow);

  resultBox.classList.remove("hidden");
}
}

// ------------------------------------------------------
// Main flow: called when user clicks Gas
// ------------------------------------------------------
async function processUrl(videoUrl) {
  clearResults();
  showStatus("Menghubungi API...", "info");
  gasBtn.disabled = true;
  gasBtn.textContent = "Proses...";

  try {
    const json = await callApi(videoUrl);

    showStatus("Sukses menerima respons. Rendering...", "success");
    renderResult(json);
  } catch (err) {
    console.error("API error:", err);
    let msg = err.message || "Gagal memanggil API";
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
    showStatus("Masukkan URL video dulu.", "error");
    return;
  }
  try { new URL(u); } catch { showStatus("Format URL tidak valid.", "error"); return; }
  processUrl(u);
});

clearBtn.addEventListener("click", () => {
  urlInput.value = "";
  clearResults();
});

// Event delegation: tangani klik tombol download yang dibuat dinamis
if (resultList) {
  resultList.addEventListener("click", async (e) => {
    const dl = e.target.closest(".btn-download");
    if (!dl) return;
    const url = dl.dataset.url;
    const fn = dl.dataset.fn || "video.mp4";
    if (!url) {
      showStatus("URL download tidak tersedia.", "error");
      return;
    }

    try {
      await downloadBlob(url, fn);
    } catch (err) {
      // error sudah ditangani di downloadBlob
    }
  });
}

// init
clearResults();
hideStatus();

/* NOTES:
 - Ganti API_BASE ke endpoint yang sesuai. Jika endpoint butuh POST / body JSON, ubah callApi() agar melakukan POST.
 - Jangan taruh API_KEY di client untuk production; buat server proxy dan simpan key di ENV.
 - Jika butuh, gue bisa siapkan contoh server-proxy (server.js + package.json) yang memanggil TikHub/TikWM dan meneruskan respons ke client tanpa CORS.
*/
