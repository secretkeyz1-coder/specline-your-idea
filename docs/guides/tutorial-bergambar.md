# Tutorial SpecLine Your Idea: dari instalasi sampai rencana implementasi

> **Walkthrough bergambar dengan batas verifikasi eksplisit.** Screenshot di bawah adalah render UI nyata yang telah diperiksa secara visual. Login berhasil dan navigasi prototype diuji. Demo memakai artefak tersimpan yang diimpor ke database terisolasi, bukan hasil generation baru dalam walkthrough. Instalasi dan aksi yang belum dijalankan dijelaskan dari source; gambar tidak membuktikan aksi tersebut sukses.

| Bagian | Bukti dan batasnya |
|---|---|
| Login dan halaman Today | Login berhasil; halaman nyata ditampilkan |
| Settings AI dan Add provider | Form kosong ditinjau; connection, profile, binding, probe, dan generation tidak diuji |
| New project | Form dibuka, **tidak disubmit** |
| Discovery, requirements, stack, design | Riwayat demo tersimpan: discovery completed (asumsi belum diterima), requirements approved, stack locked, design approved; bukan approval/generation baru |
| UI reference dan Play | Canvas, desktop/mobile, serta navigasi Queue **View → Ticket Detail** diamati; ada temuan layout mobile |
| Tasks dan work order | **7 Ready, 0 done**; acceptance criteria dan `npm run test:unit` **NOT RUN** |

[README](../../README.md) · [Navigasi dokumentasi](../README.md)

Tutorial ini memisahkan tiga hal: menjalankan **SpecLine** sebagai alat perencanaan, membuat **UI reference/prototype** di dalam SpecLine, dan mengimplementasikan **aplikasi target** di repository tersendiri. Ketiganya bukan hasil yang sama.

## 1. Siapkan instalasi lokal

Gunakan Bun **1.4.0 atau lebih baru**, Docker dengan Compose, Git, dan OpenSSL. Perintah di bawah menggunakan Bash/Git Bash. Jalankan dari root checkout SpecLine. Instalasi lokal tidak memerlukan API key AI, subscription coding agent, Chromium, atau MinIO. Fitur AI yang dibahas kemudian mempunyai prasyarat tersendiri.

Jika belum mempunyai checkout dan memiliki akses ke repository:

```bash
git clone https://github.com/secretkeyz1-coder/specline-your-idea.git specline
cd specline
```

Jika checkout sudah tersedia, gunakan checkout tersebut, bukan membuat salinan di dalam repository aplikasi target.

```bash
bun install --frozen-lockfile
```

Salin konfigurasi **hanya jika `.env` belum ada**:

```bash
cp .env.example .env
```

Untuk PowerShell, perintah penyalinannya adalah `Copy-Item .env.example .env`, dengan syarat yang sama. Jangan menimpa konfigurasi instalasi yang sudah berjalan.

Buat dua secret berbeda:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Masukkan hasil pertama ke `SDD_MASTER_KEY`, hasil kedua ke `SDD_SESSION_SECRET`. Master key harus terdekode menjadi 32 byte. Jangan menyimpan hasil perintah ini dalam dokumentasi, screenshot, atau Git.

## 2. Isi environment dan jalankan database

Edit `.env` menggunakan editor lokal:

| Variabel | Pengaturan lokal |
|---|---|
| `DATABASE_URL` | `postgres://sdd:sdd@localhost:5432/sdd` untuk konfigurasi default |
| `SDD_MASTER_KEY` | Hasil secret pertama; menggantikan nilai `changeme` |
| `SDD_SESSION_SECRET` | Hasil secret kedua yang berbeda |
| `API_PORT` | `4000` |
| `API_PUBLIC_URL` | `http://localhost:4000` |
| `WEB_PUBLIC_URL` | `http://localhost:5173` |
| `BOOTSTRAP_ADMIN_EMAIL` | Email akun awal yang Anda tentukan |
| `BOOTSTRAP_ADMIN_PASSWORD` | Password kuat yang Anda tentukan |
| `BOOTSTRAP_WORKSPACE` | Nama workspace awal; opsional |

Jangan membuat variabel `PUBLIC_API_URL`: kode server web memakai `API_PUBLIC_URL`. `WEB_PUBLIC_URL` adalah URL publik web yang digunakan konfigurasi aplikasi/API; **bukan pengganti `ORIGIN` SvelteKit adapter-node**. Untuk development Vite default gunakan origin `http://localhost:5173`. Jika memakai build adapter-node/production, isi `ORIGIN` dengan origin web sebenarnya (scheme, host, dan port), selaras dengan `WEB_PUBLIC_URL`; Compose production sudah mengisi keduanya dari `PUBLIC_WEB_URL`. Jika port/host berubah, sesuaikan URL dan origin terkait, jangan menonaktifkan pemeriksaan CSRF untuk mengatasi mismatch. Password database contoh hanya sesuai untuk development loopback, bukan deployment publik. Biarkan `API_HOST` kosong, `ALLOW_PRIVATE_AI_EGRESS=false`, dan `SDD_ENABLE_LOCAL_CLI=false` untuk konfigurasi awal. Jika tidak ingin sign-up development, isi `ALLOW_SELF_REGISTRATION=false`.

Jika port 5432 sudah digunakan, isi `SDD_PG_PORT=5433` dan ubah port pada `DATABASE_URL` menjadi `localhost:5433` **sebelum** menjalankan Compose. Tidak perlu menghapus volume database.

```bash
docker compose up -d postgres
docker compose exec postgres pg_isready -U sdd -d sdd
```

Tunggu PostgreSQL siap, kemudian:

```bash
bun --env-file .env run db:migrate
bun --env-file .env run bootstrap
bun --env-file .env run dev
```

Bootstrap CLI membuat operator dan workspace ketika belum ada pengguna. Menjalankannya ulang bukan mekanisme reset password. Jangan mengganti master key instalasi yang sudah menyimpan kredensial provider: kredensial terenkripsi bergantung pada key tersebut.

Biarkan proses development berjalan. Dari terminal lain:

```bash
curl -fsS http://localhost:4000/healthz
curl -fsS http://localhost:4000/readyz
```

`/healthz` memeriksa proses API; `/readyz` juga memeriksa database. Respons kedua endpoint ini **bukan** bukti bahwa login, generation, maupun seluruh alur pengguna sudah berhasil.

## 3. Login ke SpecLine

1. Buka `http://localhost:5173`; route login adalah `/login`.
2. Masuk dengan email dan password bootstrap yang Anda isi, bukan akun atau password contoh dari dokumentasi.
3. Jika bootstrap CLI sudah berhasil, gunakan login biasa. Kode juga menyediakan formulir bootstrap web ketika status API menunjukkan belum ada pengguna; formulir tersebut bukan sesuatu yang harus diulang setiap login.
4. Jika login gagal, periksa API, konfigurasi URL, dan kredensial. Jangan menghapus database atau menimpa secret sebagai langkah pemulihan pertama.

Halaman utama memerlukan session. Pembuatan proyek juga memerlukan login. Lihat [troubleshooting](troubleshooting.md) untuk pemulihan.

![Halaman login SpecLine](../images/onboarding/01-login.png)

*Gambar 1 — Form login nyata; login pada walkthrough berhasil.*

![Halaman Today setelah login](../images/onboarding/02-today.png)

*Gambar 2 — Today setelah login, dengan proyek demo tersimpan. Ini bukan bukti proyek baru telah dibuat.*

## 4. Konfigurasi Settings → AI

Buka **Settings → AI**, route `/settings/ai`. Rantai konfigurasinya adalah:

**Provider connection → AI profile/model → Role routing**.

Menyimpan connection saja belum menghubungkan AI ke pekerjaan perencanaan. Setelah konfigurasi awal, sebagian pengaturan rinci berada di **Advanced**. Screenshot berikut menunjukkan setup awal; profile dan role routing dijelaskan dari source karena belum dikonfigurasi dalam walkthrough.

![Settings AI dalam kondisi setup awal](../images/onboarding/03-ai-setup.png)

*Gambar 3 — Settings AI tanpa konfigurasi provider yang diuji. Langkah profile dan roles berikut adalah instruksi berbasis source.*

### 4.1 Tambahkan provider connection

1. Pilih **Add provider**.
2. Isi **Name** dan **Type**. Pilihan dalam kode adalah OpenAI-compatible, OpenAI, Anthropic, Gemini, Custom HTTP, dan Local CLI.
3. Untuk koneksi HTTP, isi **Base URL** dan **API key** sesuai dokumentasi provider yang benar-benar Anda gunakan. Jangan menyalin endpoint/key dari layanan lain.
4. **Test endpoint** pada dialog meminta katalog model ke endpoint. Ini bukan tes completion model dan bukan tes bahwa provider mampu menghasilkan seluruh rencana.
5. Pilih **Save connection**, lalu baca hasil penyimpanan atau pesan kesalahan. Kredensial tersimpan terenkripsi dan tidak ditampilkan kembali.

Panggilan katalog model, probe connection, dan generation dapat menghubungi provider. Lakukan hanya dengan izin, kuota, dan konfigurasi yang sesuai. Walkthrough ini tidak menjalankan panggilan tersebut.

Untuk provider yang tidak menyediakan katalog model, ID model dapat dimasukkan manual pada profile. Bedakan katalog kosong dari pesan kegagalan autentikasi/endpoint.

![Dialog Add provider kosong](../images/onboarding/04-add-provider.png)

*Gambar 4 — Add provider masih kosong; tidak ada connection yang disimpan atau endpoint yang diuji.*

**Batas Custom HTTP:** pilihan ini ada pada dropdown, tetapi onboarding form saat ini tidak mengirim `custom_http_mapping` yang diwajibkan backend. Karena itu, jangan menganggap Name/Base URL/API key saja cukup untuk menambahkan Custom HTTP. Alur konfigurasi mapping belum lengkap pada form ini dan tidak diuji; gunakan jenis provider yang memang sesuai atau konfigurasi API yang didukung setelah meninjau kontraknya.

### 4.2 Buat AI profile

1. Buka **AI profiles / Profiles**.
2. Isi **Profile name**, pilih provider connection, lalu pilih model atau masukkan **model ID** persis sesuai provider.
3. Simpan profile. Profile menggabungkan connection dan model yang akan dipakai role.
4. Pada workspace baru, UI menyediakan shortcut memakai profile pertama untuk semua role. Jika shortcut dipilih, tetap periksa hasil: kode dapat melaporkan role tertentu gagal di-bind meskipun profile berhasil tersimpan.

Pemilihan connection pada formulir profile dapat otomatis meminta katalog model. Jangan menganggap perubahan dropdown selalu operasi offline.

### 4.3 Hubungkan profile ke role

Di **Role routing / Roles**, pilih profile untuk role yang dibutuhkan dan simpan binding:

| Role internal | Nama/fungsi pada UI |
|---|---|
| `DISCOVERY` | Discovery: pertanyaan dan asumsi |
| `SPECIFICATION` | Requirements: spesifikasi kebutuhan |
| `ARCHITECTURE` | Stack & design: stack, technical design, serta generation UI reference |
| `TASK_DECOMPOSITION` | Tasks: pemecahan rencana menjadi tugas |
| `REVIEW` | Review: bantuan peninjauan pekerjaan dan bug |
| `CONVERGENCE` | Release check: pemeriksaan hasil terhadap kebutuhan |

Periksa juga **project overrides** jika proyek menggunakan model berbeda dari default workspace. Pesan `AI_PROVIDER_NOT_CONFIGURED` perlu ditelusuri sampai role dan profile aktif, bukan hanya keberadaan connection.

Tes connection yang tersimpan menggunakan model ID menjalankan **completion nyata**. Sukses probe bukan jaminan generation panjang akan sukses. Jangan menampilkan key, token, connect code, atau input sensitif pada screenshot.

### 4.4 Local CLI adalah pilihan berbeda

Local CLI memakai login Claude Code/Codex miliknya sendiri, bukan menyimpan model API key di connection. Pada kode dialog saat ini, server-side CLI memerlukan operator dan `SDD_ENABLE_LOCAL_CLI=true`; **Codex hanya dapat dipilih untuk mesin sendiri**, sedangkan target server memakai Claude Code. Machine-side generation membutuhkan mesin yang terhubung dan online serta CLI yang sudah terpasang/login.

Local CLI untuk **planning** tidak sama dengan daemon untuk **implementasi task**. Jangan mengaktifkan akses server atau private AI egress hanya untuk menghilangkan pesan error. Lihat [AI providers](ai-providers.md), [CLI and agents](cli-and-agents.md), dan [security boundaries](../../SECURITY.md).

## 5. Buat proyek kecil

Gunakan contoh ide yang cukup sempit, misalnya: “Tim dapat membuat permintaan pemeliharaan, menetapkan penanggung jawab, dan menandainya selesai.” Contoh ini adalah input tutorial, bukan proyek yang telah berhasil dibuat dalam sesi ini.

1. Dari halaman utama, buka formulir pembuatan proyek.
2. Isi nama proyek, ide, dan constraints yang relevan: pengguna, target platform, batas waktu, penyimpanan data, atau aturan akses.
3. Form server mengharuskan nama tidak kosong dan ide minimal 10 karakter. Constraints dipisahkan per baris dan dibatasi hingga 10 entri.
4. Setelah create berhasil, server mencoba membuat sesi discovery dan mengarahkan ke `/projects/<projectId>/discovery`. Jika sesi belum ada, halaman discovery menyediakan aksi start.
5. Catat **project key** jika nantinya akan menghubungkan repository aplikasi target melalui CLI.

![Form New project](../images/onboarding/05-new-project.png)

*Gambar 5 — Form proyek baru dibuka tetapi tidak disubmit; langkah create di atas belum diuji.*

![Notebook proyek demo](../images/onboarding/06-notebook.png)

*Gambar 6 — Notebook dari proyek demo tersimpan yang diimpor ke database terisolasi, bukan hasil submit form sebelumnya.*

## 6. Discovery: jawab, periksa, lalu selesaikan

**Catatan koreksi panduan lama:** `first-project.md` dan `ai-providers.md` menyebut discovery/question bank tanpa AI. Implementasi discovery saat ini sudah menghentikan bank pertanyaan bawaan dan meminta pertanyaan adaptif dari AI. Karena itu, walkthrough discovery interaktif baru memerlukan routing `DISCOVERY` yang berfungsi; jangan menjanjikan bank offline yang tidak lagi digunakan.

1. Jawab pertanyaan tentang masalah, aktor, alur, scope, constraint, dan asumsi menggunakan kondisi nyata.
2. Halaman discovery aktif dapat otomatis meminta batch pertanyaan ketika tidak ada pertanyaan untuk ditampilkan. Mengirim jawaban batch juga langsung meminta batch berikutnya; proses ini dapat menghubungi provider.
3. Periksa ringkasan pemahaman, jawaban tersimpan, dan asumsi. Ubah jawaban jika ada kesalahan; aksi perubahan jawaban tersendiri tidak memulai generation menurut kode server.
4. Jika generation gagal, jangan menganggap discovery selesai. Baca error, periksa Settings AI, lalu coba lagi bila diizinkan. Jawaban yang sudah tersimpan tidak harus hilang karena batch berikutnya gagal.
5. Gunakan **Finish discovery** ketika kondisi completion/readiness memungkinkan. Aksi server menyelesaikan sesi dan menuju `docs?tab=requirements&from=discovery`.

Readiness dapat berupa `READY_WITH_ASSUMPTIONS`, bukan hanya `READY`. Keberadaan asumsi harus dibaca sebagai keterbatasan yang perlu ditinjau, bukan bukti seluruh masalah sudah terjawab. Editor requirements manual tersedia, tetapi tutorial ini tidak mengklaim bahwa semua gate discovery dapat dilewati tanpa AI.

![Riwayat Discovery completed](../images/onboarding/13-discovery.png)

*Gambar 7 — Discovery completed pada riwayat demo tersimpan. Asumsi belum diterima; tidak ada pertanyaan AI baru atau aksi Finish discovery yang diuji.*

## 7. Requirements: draft bukan approval

Buka bagian requirements, route `/projects/<projectId>/docs?tab=requirements`.

1. Dengan role `SPECIFICATION` terkonfigurasi, gunakan **Generate requirements**. Alternatifnya, gunakan editor manual `/projects/<projectId>/docs/requirements/edit`.
2. Periksa perilaku pengguna, role/izin, failure path, kebutuhan nonfungsional, dan acceptance criteria. Jangan hanya memeriksa judul daftar.
3. Gunakan **Edit draft** untuk koreksi. Refinement AI dapat membuat draft revision baru; jangan menyamakan hasil generate dengan kebutuhan yang telah disetujui.
4. Setelah layak, gunakan **Approve v…** dan periksa hasilnya. Approval mengunci baseline; perubahan selanjutnya menjadi versi baru.

![Requirements approved pada demo](../images/onboarding/07-requirements.png)

*Gambar 8 — Requirements demo sudah approved. Screenshot menunjukkan baseline tersimpan, bukan generation atau approval baru.*

## 8. Stack: pilih sesuai kebutuhan, kemudian lock

Buka `/projects/<projectId>/stack`. Requirements yang telah di-approve merupakan prasyarat; kode mengarahkan pengguna kembali ke discovery/requirements jika baseline tersebut belum ada.

1. Pilih rekomendasi AI atau mode manual. AI recommendation memakai role `ARCHITECTURE`.
2. Untuk manual, isi layer/technology yang diperlukan serta versi/package ketika relevan. Jangan menganggap teknologi yang umum otomatis cocok dengan kebutuhan.
3. Periksa platform, hosting, dependency, rationale, trade-off, dan conflict. Saat lock, API memeriksa kembali package; verifikasi di browser tidak dipercaya begitu saja.
4. Lock/approve stack, lalu periksa bahwa baseline tersimpan. Perubahan setelah lock menjadi versi berikutnya.

Screenshot menunjukkan baseline historis demo yang sudah locked, bukan rekomendasi AI yang baru diperoleh atau lock yang dilakukan dalam walkthrough.

![Stack historis demo yang locked](../images/onboarding/08-stack.png)

*Gambar 9 — Stack demo historis locked; teknologi pada gambar bukan rekomendasi yang diuji untuk proyek Anda.*

## 9. Technical design: tentukan kontrak implementasi

Buka `/projects/<projectId>/docs?tab=design`. Generation design ditawarkan melalui next-step proyek setelah prasyarat terpenuhi; server memanggil endpoint `design/generate`. Editor manual tersedia di `/projects/<projectId>/docs/design/edit` dan menampilkan konteks requirements approved serta stack locked.

1. Generate dengan role `ARCHITECTURE`, atau tulis draft manual.
2. Periksa komponen, data model, API contract, keamanan, penanganan error, dan strategi testing.
3. Isi delivery/acceptance checks yang **bisa dijalankan dalam repository target**. Jangan menebak nama script atau menyatakan test sudah pass.
4. Simpan draft dan review, kemudian **Approve design v…**. UI reference di langkah berikutnya memerlukan approved technical design; route UI reference mengarahkan ke design jika prasyarat tersebut belum terpenuhi.

![Technical design approved](../images/onboarding/14-technical-design.png)

*Gambar 10 — Technical design approved dari artefak demo tersimpan; generation design tidak dijalankan.*

## 10. Design system dan UI reference

Keduanya opsional untuk proyek non-UI. **Technical design** adalah kontrak teknis; **design system** adalah konsistensi visual; **UI reference** adalah referensi layar. Jangan menukarkan ketiganya.

1. Jika menginginkan reference berwarna/komponen, siapkan dan approve design system di `/projects/<projectId>/design-system` terlebih dahulu. Mode **styled** membutuhkan approved design system, atau design system dari referensi adaptasi yang didukung UI.
2. Buka `/projects/<projectId>/ux` setelah technical design approved.
3. Periksa platform dan perangkat: web atau native-mobile Android pada kontrak saat ini. Jangan menganggap preview Android sebagai APK yang sudah dibangun.
4. Pilih fidelity neutral/styled. Untuk jumlah layar, gunakan rekomendasi otomatis atau angka **1–12**.
5. Pilih metode yang tersedia: **Draw sendiri**, **Draw with template**, atau **Draw with your own template**. Label “Draw sendiri” di UI bukan bukti bahwa generation tidak memakai AI.
6. Gunakan **Plan the screens**, periksa nama/purpose layar dan requirement coverage, kemudian **Draw all screens** atau draw per layar. Perencanaan dan drawing adalah langkah terpisah.
7. Tinjau layar, catatan kualitas, scope yang tidak tergambar, dan kesesuaian platform. Temuan blocking, perubahan layout yang belum diterapkan, atau scope yang belum dikonfirmasi dapat menahan approval.
8. Setelah layak, gunakan **Approve v…**. Notice server menyatakan reference approved/locked menjadi acuan task yang di-generate sesudahnya dan work order agent.

Perubahan requirements/design dapat membuat reference lama tidak lagi applicable. Redraw/restyle dapat mempertahankan screen plan, tetapi tetap merupakan generation baru, bukan hasil implementasi aplikasi.

![Canvas UI reference demo](../images/onboarding/09-ui-canvas.png)

*Gambar 11 — Canvas menampilkan UI reference tersimpan. Planning/drawing baru dan setup design system tidak diuji dalam walkthrough.*

## 11. Play: uji alur prototype, bukan aplikasi selesai

Tombol **Play** aktif jika setidaknya satu layar memiliki hasil drawing. Player hanya memasukkan layar dengan HTML; layar yang belum digambar tidak otomatis tersedia.

1. Klik **Play** untuk membuka prototype; player memilih layar awal yang sudah digambar.
2. Untuk web, gunakan pilihan **Desktop** atau **Mobile**. Untuk native-mobile, pilihan perangkat mengikuti platform reference.
3. Klik hotspot/link yang terhubung ke layar lain yang sudah digambar, buka overlay yang direncanakan, dan gunakan **Back** untuk kembali.
4. Tutup prototype setelah meninjau alurnya. Bandingkan visual dengan requirement coverage sebelum menganggap reference siap disetujui.

**Batasan yang terverifikasi dari kode:** iframe memakai `sandbox="allow-same-origin"` tanpa `allow-scripts`. Player menangani klik dari luar mockup, menukar layar, dan membuka/menutup overlay. Form tidak menjalankan transaksi aplikasi. Tombol di overlay dapat hanya menutup overlay. Karena itu, simulasi “Login”, “Save”, atau “Submit” dalam Play tidak membuktikan autentikasi, penyimpanan database, API, maupun implementasi business logic aplikasi target.

![Prototype Queue pada desktop](../images/onboarding/10-prototype-desktop.png)

*Gambar 12 — Play desktop menampilkan Queue; ini reference interaktif, bukan aplikasi target yang diimplementasikan.*

![Prototype mobile dengan temuan header](../images/onboarding/11-prototype-mobile.png)

*Gambar 13 — Play mobile: header Mini Helpdesk membungkus/bertumpuk dengan Queue. Ini temuan layout-review, bukan tampilan mobile yang dinyatakan tanpa cacat.*

**Tindak lanjut mobile:** perbaiki ukuran, wrapping, atau spacing header pada reference dan periksa ulang viewport mobile. Jangan menyatakan responsivitas lulus hanya karena player bisa dibuka.

![Ticket Detail setelah navigasi dari Queue](../images/onboarding/12-prototype-detail.png)

*Gambar 14 — Tombol View pada Queue benar-benar dinavigasikan ke Ticket Detail dalam player. Perpindahan layar disimulasikan; tidak membuktikan fetch ticket atau backend target.*

## 12. Tasks: dari rencana ke pekerjaan implementasi

Buka `/projects/<projectId>/tasks`.

1. Dengan desain yang layak dan routing `TASK_DECOMPOSITION`, generate task plan.
2. Periksa cakupan requirements, dependencies, objective, path/deliverables, acceptance criteria, required checks, serta stop conditions dalam detail task/work order.
3. **Generation dapat otomatis memasukkan task yang lolos gate ke `READY`.** Jangan menulis bahwa setiap task selalu memerlukan approval manual tambahan. Task yang gagal readiness dapat tetap `DRAFT`; hasil action memuat jumlah serta task yang tertinggal.
4. Untuk draft yang belum siap, perbaiki isu yang ditampilkan. UI memiliki edit/split, penambahan render check untuk task layar, serta aksi readiness. Jangan melewati atau mengabaikan gate yang gagal.
5. Mulai dengan satu task. Copy portable prompt/work order ke coding agent, atau gunakan CLI/MCP jika ingin koneksi state. Gunakan repository target yang dapat dipulihkan untuk eksperimen pertama.
6. Jalankan checks nyata, lalu catat command, exit code, dan ringkasan output. “Not run” bukan “passed”, dan `READY` bukan “DONE”.

Execution prompt terhubung dapat membawa connect code sekali pakai; jangan memasukkannya ke screenshot publik. Daemon implementasi berjalan dengan identitas OS dan akses repository Anda; baca batas keamanan sebelum mengaktifkan otomatisasi.

![Daftar tujuh task Ready](../images/onboarding/15-tasks.png)

*Gambar 15 — Demo mempunyai tujuh task Ready dan nol done. Generation maupun implementasi task belum diuji.*

![Work order dan acceptance criteria task](../images/onboarding/16-work-order.png)

*Gambar 16 — Work order menampilkan acceptance criteria dan command npm run test:unit. Keduanya NOT RUN dalam walkthrough; command ini milik kontrak aplikasi target, bukan hasil test atau perintah test root SpecLine.*

## 13. Implementasi aplikasi target adalah tahap terpisah

| Yang tersedia | Artinya | Bukan bukti |
|---|---|---|
| SpecLine lokal dapat dibuka | Alat perencanaan berjalan | Aplikasi target telah dibuat |
| Requirements/design approved | Baseline rencana disetujui | Semua requirement sudah diimplementasikan |
| UI reference + Play | Referensi visual dan alur prototype | Backend, database, login, build, atau deploy aplikasi target bekerja |
| Task `READY` | Kontrak kerja lolos readiness | Agent telah menyelesaikan pekerjaan |
| Output agent dan checks | Evidence untuk scope yang benar-benar diperiksa | Seluruh journey atau produksi otomatis benar |

Implementasikan task di repository aplikasi target, tinjau diff dan evidence, jalankan aplikasinya, uji journey nyata, laporkan bug, lalu lakukan convergence sebelum release approval. Jika menggunakan reference export, `sddctl ui pull` mengambil reference ke repository target yang terhubung; hasilnya tetap referensi, bukan konversi otomatis menjadi aplikasi berfungsi.

## Referensi dan batas verifikasi

- [Getting started](getting-started.md): environment, port, bootstrap, dan readiness.
- [First project](first-project.md): kerangka planning → execution → review; pernyataan bank discovery tanpa AI perlu dibaca bersama koreksi implementasi pada langkah 6.
- [AI providers](ai-providers.md): provider/profile/role, operator settings, dan diagnosis; batas server Codex dan discovery pada kode saat ini lebih spesifik daripada ringkasan panduan.
- [CLI and agents](cli-and-agents.md), [MCP](mcp.md), [Troubleshooting](troubleshooting.md), serta [Security](../../SECURITY.md).

Langkah instalasi dan kontrak aksi diperiksa terhadap source repository publikasi: scripts root dan `.env.example`; route login, dashboard/create, Settings AI, discovery, requirements, stack, design, UI reference, tasks; serta `PrototypePlayer.svelte` dan mesin batch discovery. Bukti runtime terbatas pada hasil walkthrough yang disebutkan di awal, bukan validasi ulang seluruh quickstart atau generation. Semua gambar berasal dari UI nyata dan telah melewati pemeriksaan visual; tidak ada provider key atau connect code yang sengaja dimasukkan. Belum ada eksekusi agent, acceptance test aplikasi target, atau deployment yang dibuktikan oleh tutorial ini.

## Lampiran: verifikasi yang dapat diulang

Instance screenshot benar-benar dibangun dan berjalan, tetapi belum tentu memakai port default resep di atas. Login berhasil dan tampilan diperiksa satu per satu; ini tidak mengklaim quickstart default dijalankan ulang dari nol. Jangan menyalin host/port instance screenshot sebagai konfigurasi universal.

Inventaris berikut memuat tepat 16 gambar sumber; nomor file mengikuti waktu pengambilan, sedangkan urutan gambar di tutorial mengikuti workflow. Seluruh berkas terdekode sebagai PNG 1280 × 720. Verifikasi format, ukuran, dan hash dapat diulang dari root repository dengan `python` dan Pillow (Pillow hanya untuk pemeriksaan gambar dokumentasi, bukan prasyarat menjalankan SpecLine):

```bash
python - <<'PY'
from pathlib import Path
from PIL import Image
import hashlib
files = sorted(Path("docs/images/onboarding").glob("*.png"))
assert len(files) == 16
for path in files:
    with Image.open(path) as image:
        assert image.format == "PNG"
        assert image.size == (1280, 720)
        image.verify()
    print(path.name, hashlib.sha256(path.read_bytes()).hexdigest())
PY
```

| Screenshot | SHA-256 |
|---|---|
| `01-login.png` | `1e7028208d7ec1fa833f09b66a69f42fc771b03cf118d1e0001d1b6b723b0185` |
| `02-today.png` | `70690a1e73b5039a9974abac020737b15fec2ed4b6244cabbecceca43e634d21` |
| `03-ai-setup.png` | `b12128d1ef05e8940a8714c0e95e16c9988763ed689390095bca3d4f4884e138` |
| `04-add-provider.png` | `ab47c460e9ee15f62cf3818cd96f592e4bb7429e83753f4c5cc656ced8bf2627` |
| `05-new-project.png` | `83be5e5e4b85d9c0c782bd81c05d8bccfdcb6d379d98bf1bbeeff8424174db43` |
| `06-notebook.png` | `efb6a4e8e7238781930aa11c8218cee7422056a51104bc19b72ba90aaa6a8dbc` |
| `07-requirements.png` | `1caec4f65f535b782a87d349383744dd767b5aaf55d6995bf0bffb10af2cd2eb` |
| `08-stack.png` | `35a3d256a03155fdd6e8bba464c7b6a8d547e20054a4c3efb9f9c0172250bfe2` |
| `09-ui-canvas.png` | `9e898693b0f678d2541430acf3adafaeafa408ae25f95375957630fb99891284` |
| `10-prototype-desktop.png` | `53d0b7ab62e9b22ae841fb7cb3a8173c03560f0260b21faf9e5806cbf59d7050` |
| `11-prototype-mobile.png` | `7a7cde9f8ad4b844631341d0a5a87c2deb401083d868c0e9b44ed9b18d9719ca` |
| `12-prototype-detail.png` | `f36d8b9b0446511733d46377e6e0899b841eda469d0e45009f199530755cc06d` |
| `13-discovery.png` | `fcf341a5bd3d1aa5b7dd6b2bc28e2b220dfc0389ca5ef9bb6be4b8ad51c4b9c9` |
| `14-technical-design.png` | `adf995a76c04127a648c02c4df0d1511fdb3385e158c77ae996d00b3f5c2b9b5` |
| `15-tasks.png` | `4615a239d0e7b0deb592ea831e6a0a60e00782f14458b49c63b9587be745a2eb` |
| `16-work-order.png` | `fd901e0f9d48f7c5542af0b56781b9559d2c068b756d49e7d60d4bbe2d651915` |

Format/hash membuktikan konsistensi berkas, bukan kebenaran aplikasi. Pemeriksaan visual render nyata dilakukan sebelum publikasi; tidak ada normalisasi format yang diperlukan. Gambar adalah capture viewport desktop, termasuk ketika player memilih Mobile; ukuran berkas bukan ukuran layar ponsel target. Tidak ada pixel yang direka untuk menggambarkan langkah yang belum diuji.

Untuk mengulang pemeriksaan fungsional, gunakan instance terisolasi, login dengan akun Anda, buka artefak demo tersimpan, lalu ulangi Play Desktop/Mobile dan Queue View → Ticket Detail. Catat temuan header mobile, dan pastikan status task/work order tetap dilaporkan apa adanya. Jangan menjalankan provider probe, generation, submit proyek, atau coding agent hanya demi mereproduksi gambar tanpa izin. Jangan publikasikan `.env`, password, provider key, token, atau connect code. Bukti baru harus menyebut command/aksi dan hasil nyata; sampai tersedia, profile/roles, generation, submit proyek, acceptance criteria, `npm run test:unit`, implementasi target, serta deployment tetap **belum diuji** dalam walkthrough ini.
