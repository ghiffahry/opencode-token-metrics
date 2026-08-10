<div align="center">

# Token Metrics

**Dashboard realtime monitoring token API opencode, dari database lokal menjadi metrik model yang divisualisasikan.**

![Python](https://img.shields.io/badge/python-%3E%3D3.8-brightgreen)
![UI](https://img.shields.io/badge/ui-pywebview%20%7C%20Edge%20WebView2-blue)
![Status](https://img.shields.io/badge/status-active--development-orange)
![Data](https://img.shields.io/badge/data-opencode.db%20read--only-purple)

</div>

---

## Tentang Proyek Ini

Pengguna opencode terkadadng bebas memakai token API sampai batas kuota free tier, tapi berapa sisa kuota, berapa context window yang terpakai, dan sesi mana yang paling boros biasanya baru terasa saat sudah kena limit. Token Metrics menjawab tiga pertanyaan itu secara langsung dari database opencode yang asli. Cara kerjanya sederhana dimana server membaca database lokal, menghitung agregat per rentang waktu, lalu menyajikannya sebagai dashboard desktop atau halaman pengembangan. Tidak ada data sintetis, tidak ada database palsu, dan tidak ada server yang terbuka ke publik. Angka yang tidak bisa dihitung dari database ditandai jelas sebagai estimasi, bukan disamarkan menjadi angka pasti. Pembeda proyek ini dari sekadar "membuka database" adalah lapisan keamanan data. Database dibuka read-only dengan mode WAL-safe, tidak pernah ditulis, dan setiap asumsi perhitungan didokumentasikan di dalam respons API itu sendiri.

---

## Arsitektur

```text
app/                     Desktop app (pywebview + server loopback tertanam)
  desktop.py             Entry desktop: server tertanam + jendela native
  desktop.pyw            Launcher tanpa console window (double-click)
  config.json            Konfigurasi desktop (dbPath, ukuran window, port), auto-dibuat
  config.example.json    Template konfigurasi desktop (contoh yang ter-commit)
server_app/              Package backend: config, db, ranges, estimates, context, routes, httpd
  overview/              Penghitung agregat per rentang (models, sessions, requests, realtime, _empty)
web/                     Frontend, halaman dan aset statis
  index.html             Markup dashboard (memuat js/main.js sebagai ES module)
  static/                css/, vendor/, dan js/ (core, data, render, live, app, ui)
tools/                   Script pendukung (start, stop, db_stats, git_commit, build_desktop, ...)
tests/                   Unit test (pytest)
opencode/                Plugin opencode (npm package opencode-token-metrics)
runtime/                 Hasil runtime (log, export, build, dist), di-ignore Git
graphify-out/            Knowledge graph codebase (graph.json + views), di-ignore Git
```

---

## Alur Kerja

1. Desktop app atau dev server menjalankan server HTTP loopback di `127.0.0.1`.
2. Server membuka `opencode.db` asli dengan koneksi read-only yang aman untuk WAL.
3. Agregator menghitung metrik per rentang: `today`, `7d`, `30d`, `90d`, `24h`, dan `custom`.
4. Frontend ES module merender panel: KPI, grafik, tabel model, request, sesi, dan context usage.
5. Polling realtime memperbarui sesi aktif dan penghitung token sekitar tiap 4 detik selama tab terlihat.
6. Plugin `opencode-token-metrics` menangkap event pemakaian saat terjadi dan menulis `state.json`.
7. Dashboard membaca `state.json` tersebut lewat `/api/plugin_state` dan menampilkannya di status strip.
8. Bila server tidak terjangkau, dashboard menampilkan banner peringatan, bukan data palsu.

---

## Instalasi

Prasyarat: Python 3.8 ke atas, Microsoft Edge WebView2 runtime (sudah terpasang pada kebanyakan Windows 10/11), dan database opencode di lokasi bawaan (`~/.local/share/opencode/opencode.db`).

```bash
py -m pip install -e ".[desktop]"
```

Setelah itu jalankan salah satu dari dua jalur berikut.

```bash
# Desktop app (jalur utama)
py app\desktop.py

# Dev server (pengembangan)
py -m server_app.httpd
```

Desktop app membuka jendela native yang hanya bisa dijangkau oleh window itu sendiri, tanpa port tetap dan tanpa tab browser lain. Dev server melayani dashboard dan API yang sama di `http://127.0.0.1:8124/`. Jalankan `py -m server_app.httpd --port 9000 --db <path>` bila perlu menyesuaikan port atau lokasi database. Shortcut `Token Metrics.cmd` di root repo membuka desktop app.

---

## Konfigurasi

Tidak ada file `.env`. Konfigurasi lewat dua tempat: `app/config.json` untuk desktop, dan environment variable untuk server.

**Desktop (`app/config.json`)** dibuat otomatis pada run pertama:

```json
{
  "dbPath": "",        // "" -> ~/.local/share/opencode/opencode.db
  "host": "127.0.0.1",
  "port": 0,           // 0 -> OS memilih port bebas
  "width": 1440,
  "height": 900
}
```

**Environment variable** (dibaca server saat start):

| Variable | Default | Fungsi |
| --- | --- | --- |
| `TOKENMETRICS_TZ` | zona lokal sistem | Batas kalender harian; set IANA zone untuk pin, mis. `Asia/Jakarta` |
| `TOKENMETRICS_RPM` / `TOKENMETRICS_TPM` | `60` / `250000` (estimasi) | Kuota requests per menit dan tokens per menit terverifikasi |
| `TOKENMETRICS_RPD` / `TOKENMETRICS_DTP` | `200` / `2500000` (estimasi) | Kuota per jendela reset free tier |
| `TOKENMETRICS_QUOTA_TOKENS` | `2500000` | Token per jendela quota; UI menampilkan label `configured` bila di-set |
| `TOKENMETRICS_QUOTA_WINDOW_HOURS` | `14` | Panjang jendela reset estimasi |
| `QUOTA_ANCHOR_HOUR` | `4` | Jam lokal awal jendela 14 jam, mengatur jatuhnya waktu reset |
| `TOKENMETRICS_REQUEST_QUOTA` | `200` | Estimasi budget request per jendela quota |
| `TOKENMETRICS_AUTH_TOKEN` | kosong | Token wajib untuk `/api/*` (lihat "Mengekspos server" di SECURITY.md) |
| `TOKENMETRICS_RETENTION_DAYS` | `30` | Plugin: sesi tanpa pesan dihapus setelah N hari sejak `updated` |

Nilai tanpa environment variable memakai estimasi komunitas dan diberi label `default` atau `estimated` di UI. Kapan pun angka berasal dari sumber pasti, label berubah menjadi `configured`.

---

## Penggunaan

```bash
py app\desktop.py                 # Jalankan desktop app
py -m server_app.httpd            # Jalankan dev server di 127.0.0.1:8124
py tools/start.py                 # Start server terpisah (detached), tulis logs/server.pid
py tools/stop.py                  # Stop server yang berjalan
py tools/db_stats.py       # Ringkasan database opencode (jumlah, ukuran, rentang)
py tools/export_csv.py     # Ekspor request/model per rentang ke exports/
py tools/build_desktop.py --build   # Bangun exe desktop (PyInstaller)
pytest tests               # unit test Python: ranges, estimates, plugin_state
npm --prefix opencode test  # unit test plugin Node: window bounds, dedup, persistence
```

Rentang yang didukung: `today`, `7d`, `30d`, `90d`, `24h`, dan `custom` (`from=YYYY-MM-DD&to=YYYY-MM-DD`, inklusif dan dibatasi sampai hari ini). Sebagian endpoint menerima filter `?project=<directory>` untuk membatasi hasil ke satu project.

---

## Struktur Dashboard

Etiket di bawah adalah bagian yang dimuat frontend dari payload `/api/overview` dan `/api/context_usage`.

```text
Overview             KPI (requests, token, latency, error rate) + perbandingan window sebelumnya
Charts               Bucket harian, stages, perbandingan model
Tables               Model, requests, sessions, rate limits
Context Window       Utilisasi request terbaru vs limit, komposisi estimasi, peak
Conversation Growth  Grafik pertumbuhan context per sesi
Token Quota          Jendela quota estimasi: burn rate, proyeksi reset, riwayat 14 hari
Realtime             Sesi aktif + R/TPM menit terakhir, diperbarui tiap ~4 detik
Knowledge Graph      Visualisasi codebase via graphify (lihat bagian Ekstensi)
```

Bila database tidak ditemukan, server tetap merespons dengan payload kosong berisi nol, dan UI menampilkan state kosong. Tidak ada data karangan.

---

## Kualitas & Konsistensi Data

Setiap agregat dinilai konsistensinya lewat satu prinsip: semua angka berasal dari database yang sama, dan semua asumsi ditulis di atas kertas.

- Database dibuka read-only dan WAL-safe, tidak pernah ditulis.
- Metrik `requests` = pesan `assistant` yang membawa `modelID` (satu panggilan API per pesan).
- `latency` dihitung dari durasi `completed - created` sebuah pesan, bukan dari log server.
- `errors` = tool call gagal (`part.state.status = 'error'`) ditambah part bertipe `error`.
- Komposisi context adalah heuristic estimasi eksplisit: hanya memecah total input nyata, tidak pernah mengarang token.
- Setiap respons `/api/overview` membawa objek `notes` yang mendokumentasikan asumsi tersebut.
- Cache server bersifat pendek (overview 3 s, models 5 s, realtime 1.5 s), sehingga data cepat segar.

Skor kelulusan proyek ini adalah jujur tentang ketidakpastian: angka estimasi ditandai, angka aktual tidak dicampurkan, dan jendela quota tidak pernah diklaim sebagai waktu reset resmi penyedia.

---

## Sumber Data: Database vs Event Langsung

| Sumber | Kapan dipakai | Catatan |
| --- | --- | --- |
| `opencode.db` | Selalu; polling dan agregat | Histori lengkap, read-only, cocok untuk rentang panjang dan tabel |
| Plugin `opencode-token-metrics` | Saat plugin aktif menulis `state.json` | Event realtime dari sesi opencode, status kuota per jendela |

Plugin menangkap event pemakaian sesaat terjadi dan menyimpan `state.json` (default `~/.local/share/token-metrics/state.json`). Dashboard membacanya lewat `GET /api/plugin_state` dan menampilkan ringkasan di status strip; item tetap tersembunyi sampai plugin menulis file pertama. Detail instalasi dan environment variable plugin ada di `opencode/README.md`.

### Batas validitas data

Agar angka tidak dibaca keliru, tiga jenis angka sengaja tidak dicampur:

- **Database = aktual historis.** Angka dari `opencode.db` mencerminkan pesan yang benar-benar tercatat, apa pun kondisi plugin.
- **Jendela quota = estimasi.** Penyedia tidak mempublikasikan waktu reset; dashboard memodelkannya (default 14 jam, anchor 04:00 lokal) dan menandainya `estimated`. Bukan fakta penyedia.
- **Plugin = event yang tertangkap.** Angka plugin hanya mencakup event sejak plugin aktif; sesi sebelum plugin dipasang tidak dihitung. Berbeda dengan database yang mencakup seluruh histori.

Dashboard menandai sumbernya di UI (`default`/`configured` untuk kuota, status strip untuk plugin); jangan memperlakukan estimasi sebagai tagihan resmi.

---

## API Ringkas

Base URL: `http://127.0.0.1:8124` (desktop app memakai port acak, frontend menurunkannya dari `window.location`).

| Endpoint | Deskripsi |
| --- | --- |
| `GET /api/health` | Kesehatan server dan database (`dbExists`, `dbSize`) |
| `GET /api/overview?range=7d` | Agregat utama: requests, token, latency, stages, buckets harian, rate limits |
| `GET /api/models?range=7d` | Agregat per model, termasuk `contextLimit` dan `contextUsed` |
| `GET /api/context_usage?range=7d` | Context window: request terbaru, peak, agregat per model/sesi/agent, komposisi estimasi |
| `GET /api/budget` | Token Quota: jendela estimasi, burn rate, proyeksi reset, riwayat 14 hari |
| `GET /api/sessions?limit=50` | Daftar sesi (id, title, model, token, status, latency) |
| `GET /api/requests?limit=60` | Request terbaru (model, agent, token, latency, status) |
| `GET /api/realtime` | Watermark, sesi aktif, R/TPM menit terakhir, kuota jendela |
| `GET /api/plugin_state` | State.json plugin bila ada (`exists: false` bila belum ditulis) |
| `GET /api/graph` | Knowledge graph dari `graphify-out/graph.json` |

Server hanya mengizinkan bind non-loopback bila diberi token (`--auth-token` atau
`TOKENMETRICS_AUTH_TOKEN`); jika tidak, token di-generate acak dan dicetak di
console saat start. Semua `/api/*` kemudian menuntut token via `?token=`,
`Authorization: Bearer`, atau cookie `tm_auth`. Lihat `SECURITY.md`.

---

## Ekstensi: Knowledge Graph

Folder `obsidian/` pada proyek AJA adalah tempat catatan pengetahuan; pada proyek ini perannya dipegang oleh knowledge graph. Repo terhubung dengan [graphify](https://github.com/Graphify-Labs/graphify): `graphify-out/graph.json` memetakan codebase sebagai graf interaktif, dan dashboard menyajikannya dalam empat tampilan (graph, folder, file tree, call flow).

```bash
py tools/skill_install.py      # Install CLI + skill graphify (idempotent)
graphify update .              # Refresh inkremental setelah edit
py tools/graph_views.py        # Regenerate tampilan HTML (tree / callflow)
```

Graph hanya menampilkan node project yang relevan dengan filter aktif; project lain mengembalikan 0 node, bukan graf yang melenceng.

---

## Troubleshooting

| Gejala | Perbaikan |
| --- | --- |
| Jendela terbuka tapi API error | Cek database ada dan terbaca; set `dbPath` di `app/config.json` bila lokasi berbeda |
| Error WebView2 | Install Microsoft Edge WebView2 runtime |
| `pywebview` import error | `py -m pip install pywebview` |
| Banner "Server unreachable" | Server tertanam/dev mati; restart app, atau `py -m server_app.httpd` |
| Context limit model salah | Tambah id model ke `MODEL_CONTEXT_OVERRIDES` di `server_app/config.py` |
| Angka kecil atau nol | Pengguna opencode saat ini sedikit pesan `assistant`; coba rentang `90d` |
| Port 8124 dipakai | Pilih port lain dengan `--port` |
| Section Graph kosong | Jalankan `graphify update .` lalu tekan Refresh di dashboard |
| Bind remote menuntut token | `py -m server_app.httpd --host 0.0.0.0 --auth-token <token>`; tanpa token, server auto-generate dan mencetaknya di console |
| Plugin tidak mencatat sesi lama | Plugin hanya menangkap event sejak aktif; histori penuh ada di database (`90d`) |

---

## Lisensi

MIT. Lihat file `LICENSE`.
