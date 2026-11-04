# BLACKMAMERSTUDIO — Roblox Audio Workspace

Website premium dark/red/silver yang sudah diubah langsung dari proyek ZIP yang kamu kirim. Logo utama menggunakan gambar yang kamu kirim. Landing page **Indonesia + Inggris**, dashboard, checkout, halaman legal, dan backend Node.js ada dalam satu folder.

## Jalankan di Windows

1. Install **Node.js LTS** (minimal Node 18), FFmpeg + ffprobe, dan yt-dlp jika ingin konversi link YouTube/SoundCloud.
2. Ekstrak ZIP dan klik **`start.bat`**. Script akan membuat `.env` dari `.env.example` dan menjalankan `npm install` pertama kali (butuh internet).
3. Buka **http://localhost:3000**.
4. Untuk preview lokal tanpa Discord OAuth, klik Login yang menuju `/dev-login` saat `DISCORD_CLIENT_ID` belum dikonfigurasi. Test login hanya tersedia di localhost secara default.
5. Untuk produksi, atur `.env` dengan `BASE_URL`, `SESSION_SECRET`, `KEY_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, dan `DISCORD_REDIRECT_URI`, lalu **`ALLOW_DEV_LOGIN=0`**. Jangan masukkan `.env`/API key ke repository publik.

Di terminal bisa juga jalankan `npm install` lalu `npm start`.

## Fitur yang dipertahankan

- Discord OAuth dengan credential aplikasi **milikmu sendiri**; login preview untuk localhost.
- Upload file audio atau konversi dari URL memakai pipeline FFmpeg/yt-dlp, speed preset, split per bagian.
- Roblox Open Cloud API key link, asset upload, library, moderation, plan/billing, statistik dari data aplikasi.
- Dashboard menggunakan data API asli — angka tidak dibuat-buat.

Koneksi Discord/Roblox, pembayaran Midtrans, kemampuan konversi URL, dan library dalam game **memerlukan** konfigurasi serta dependensi/service eksternal sesuai fiturnya. Jangan menganggap fitur jaringan sudah terhubung hanya karena tampilannya tersedia. Push ke dalam game memerlukan sistem audio sisi Roblox yang kompatibel.

## Desain & performa

- Aset: `public/assets/logo.webp`, `logo.png`, `blackmamer-hero.webp`, `icon.png`, `favicon.ico`.
- Theme: `public/assets/premium.css` di-load **setelah** `core.css`/`app.css`. Semua fitur UI asli tetap dipakai.
- Animasi CSS ringan (transform/opacity), reduced-motion support, tanpa video, canvas berat, atau framework frontend baru.
- `npm run build:pages` mengecek aset HTML yang sudah ada; tidak mengunduh halaman pihak ketiga.

## Checklist sebelum go-live

- Gunakan domain resmi sendiri; set `BASE_URL` dan pasang HTTPS.
- Buat aplikasi Discord OAuth dan akun payment gateway sendiri.
- Review seluruh teks pricing, privacy, terms, legalitas aset dan lisensi konten sebelum dipublikasikan.
- Uji ulang proses upload dan moderasi ke akun Roblox sesungguhnya serta siapkan kapasitas server untuk ffmpeg.
- Simpan rahasia API di server; hindari aktifkan login lokal pada server publik.

Kode backend dan fungsionalitas yang disertakan berasal dari proyek yang kamu unggah; perubahan ini memodifikasi tampilan dan branding, bukan jaminan integrasi pihak ketiga tanpa kredensial.

## Deploy ke Vercel
Env vars: `BASE_URL`, `SESSION_SECRET`, `KEY_SECRET`, `ADMIN_PASSWORD`, `ADMIN_USERNAME` (default `blackmamer`), `ALLOW_DEV_LOGIN=0`. Buka **`/admin`** untuk halaman login admin; setelah login masuk ke `/dashboard#/admin`. Atur `ADMIN_PASSWORD` di Vercel agar login admin berfungsi.
Catatan: storage Vercel sementara (/tmp) dan body request maks 4.5MB — untuk konversi file besar pakai Render/VPS.

## Login sendiri (tanpa Discord)
- `/login` dan `/register`: username + password (scrypt). Akun terkunci ke device pertama (device ID di browser). `BIND_IP=1` untuk kunci IP juga.
- Admin reset kunci: `POST /api/admin/reset-device {"username":"..."}`.
- Persistensi di Vercel: isi `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (atau Vercel KV: `KV_REST_API_URL`/`KV_REST_API_TOKEN`). Tanpa itu, akun hilang saat instance restart.

## Perbaikan alur login dan bahasa (4 November 2026)
- `/` mengarah ke `/id` secara default, kecuali pengunjung sudah memilih EN sebelumnya.
- Semua tombol masuk / Mulai Sekarang / harga pada landing page mengarah ke `/login` (akun username/password).
- `/admin` menampilkan login administrator jika belum login; admin yang sudah masuk diarahkan ke `/dashboard#/admin`.
- `/dashboard` yang belum login diarahkan ke `/login?next=%2Fdashboard`, bukan `/en`.
- `/admin-login` tetap bisa dibuka langsung; tanpa `ADMIN_PASSWORD`, form tetap terbuka namun login akan memberi pesan konfigurasi yang jelas.
- Deployment ke Vercel membutuhkan `ADMIN_PASSWORD`, `ADMIN_USERNAME` (default `blackmamer`), `SESSION_SECRET` (acak & kuat), `BASE_URL` dengan URL Vercel, serta `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` untuk menyimpan akun antar-instance.
- Setelah ganti environment variables, **redeploy**. Edit ZIP lokal tidak otomatis mengubah situs yang sudah online.

## Bulk audio conversion (5 November 2026)
- In Dashboard → Convert → **Drop file**, choose or drag up to **50 audio files** at a time. Supported types include MP3, WAV, FLAC, M4A, OGG, AAC, OPUS, WMA, AIFF, MP4 and WEBM.
- Files are processed **sequentially** using the existing `/api/convert-upload` + FFmpeg pipeline. The queue shows file-level progress, lets you stop after the current file, and continues past errors. Existing daily quotas and per-file size limits still apply.
- Download each converted audio part, or **Download all as ZIP** (browser-side, no external library; up to 180 MB combined). Larger batches can use the individual download links.
- A browser refresh interrupts the queue. On **Vercel**, body limits (about 4.5 MB) and ephemeral filesystem/serverless jobs also constrain the original audio converter. Reliable larger uploads and long-running jobs require persistent hosting such as a VPS or appropriately configured worker/storage.
