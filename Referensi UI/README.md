# Referensi UI — Template HTML lengkap (CSS + JS + gambar) untuk UI Reference

> **Katalog aplikasi sekarang dinamis.** Tambahan/perubahan HTML dari scraping dibaca ketika galeri UI Reference dibuka atau **Refresh templates** ditekan. Simpan sumber/aset/notice lisensi per folder; tulis halaman ke file sementara lalu rename ke `.html` setelah selesai. Preview bukan syarat pemilihan. Buat preview yang belum ada dengan `bun apps/web/scripts/ui-template-previews.ts`. Jumlah dan tabel di bawah adalah snapshot koleksi awal, bukan batas katalog saat ini. Panduan: [`docs/32_UI_TEMPLATE_GALLERY.md`](../docs/32_UI_TEMPLATE_GALLERY.md).

Snapshot awal kumpulan **430 halaman HTML** dari **18 sumber template**, disalin
**lengkap dengan asetnya** (CSS, JS, font, gambar). Sebagian besar lisensi template
utama yang tersimpan adalah **MIT**, tetapi **bukan semua material MIT**: Preline
menyertakan syarat tambahan Fair Use, dan aset/vendor dapat memiliki lisensi lain. Tujuannya sebagai bahan **layout
reference** pada fitur UI Reference (`apps/api/src/modules/ux/ux-layout.ts`) — dan bisa
langsung dibuka di browser karena tiap halaman tahu ke mana CSS/JS-nya menunjuk.

> **Koreksi penting:** versi pertama folder ini hanya menyalin file `.html` tanpa
> CSS/JS, sehingga tampilannya rusak. Sekarang setiap sumber disalin sebagai **web root
> mandiri** (HTML + `assets/`, `css/`, `js/`, `vendor/`, `dist/`, `img/`), jadi halaman
> bisa dibuka langsung dari folder ini.

---

## Struktur

```
Referensi UI/
├─ ── MODERN / SaaS ──
├─ tailgrids-play/        TailGrids "Play" — SaaS/startup landing     9 halaman
├─ tailadmin/             TailAdmin free Tailwind dashboard          18 halaman
├─ kwd-dashboard/         KWD Dashboard (gaya shadcn, Vite)          13 halaman
├─ cooladmin/             CoolAdmin (Inter, modern)                  35 halaman
├─ staradmin/             StarAdmin free Bootstrap                   16 halaman
├─ tailwind-landing-page/ Themesberg — SaaS landing page              1 halaman
├─ tailwindcss-templates/ rosstopping — 27 layout/blok Tailwind       27 halaman
├─ ── ADMIN KLASIK ──
├─ adminlte/              ColorlibHQ/AdminLTE (dist)                  61 halaman
├─ coreui/                CoreUI free admin (hasil build)             48 halaman
├─ tabler/                Tabler (13 halaman + dist/preview/static)
├─ material-kit/          Creative Tim Material Kit 3                 26 halaman
├─ sneat/                 ThemeSelection Sneat (BS5)                  42 halaman
├─ materio/               ThemeSelection Materio (BS5)                44 halaman
├─ bulma/                 BulmaTemplates                              36 halaman
├─ startbootstrap/        StartBootstrap: 11 template                 30 halaman
├─ preline/               Preline UI (5 template)                      5 halaman
├─ landwind/              Themesberg Landwind (Tailwind)               1 halaman
├─ tailwindtoolbox/       Admin/Landing/Nordic/Responsive              5 halaman
├─ previews/              Screenshot pratinjau (bukan bagian template)
├─ LICENSES/              Berkas lisensi asli tiap sumber
└─ README.md
```

Titik masuk yang disarankan (buka file-file ini lebih dulu):

| Folder | Halaman contoh |
|---|---|
| `tailgrids-play/` | `index.html`, `pricing.html`, `blog-grids.html`, `signin.html` |
| `tailadmin/` | `index.html`, `basic-tables.html`, `calendar.html`, `alerts.html` |
| `kwd-dashboard/` | `index.html`, `auth/login.html`, `components/tables.html` |
| `cooladmin/` | `index.html`, `index2.html`, `inbox.html`, `kanban.html` |
| `staradmin/` | `src/index.html`, `src/pages/` |
| `tailwindcss-templates/` | `index.html`, `layouts/home-1.html`, `layouts/home-2.html` |
| `tailwind-landing-page/` | `index.html` |
| `adminlte/` | `index.html`, `index2.html`, `index3.html`, `pages/kanban.html`, `pages/chat.html` |
| `coreui/` | `index.html`, `widgets.html`, `authentication/login.html` |
| `tabler/` | `dashboard-crm.html`, `datatables.html`, `kanban.html`, `tasks.html`, `email-inbox.html` |
| `material-kit/` | `index.html`, `pages/sign-in.html` |
| `sneat/` | `html/index.html`, `html/auth-login-basic.html` |
| `materio/` | `html/index.html`, `html/auth-login-basic.html` |
| `bulma/` | `templates/admin.html`, `templates/login.html`, `templates/kanban.html` |
| `startbootstrap/` | `sb-admin-2/index.html`, `agency/index.html`, `clean-blog/index.html` |
| `preline/` | `templates/dashboards/cms-admin/index.html`, `templates/ai/ai-chat-interface/index.html` |
| `landwind/` | `index.html` |
| `tailwindtoolbox/` | `admin/index.html`, `landing/index.html`, `nordic-store/index.html` |

---

## Cara pakai di fitur UI Reference

`ux-layout.ts` membaca halaman HTML seperti ini:

- Batas input **200.000 karakter**; yang dianalisis **40.000 karakter pertama**.
- Dibuang otomatis: `<script>`, `<iframe>`, `<video>`, `<audio>`, `<canvas>`, `<object>`, `<embed>`, `<title>`.
- Semua **teks jadi "…"**; hanya **CSS tata letak** yang dibaca (display, grid, flex, spacing, ukuran, border-radius). **Warna/font tidak** diambil dari sini.
- Atribut `class` **dipertahankan**, jadi pola Tailwind/Bootstrap tetap dikenali.
- Yang disimpan hanya **brief layout** (region, grid, density, pola), bukan halaman aslinya.

**Konsekuensi praktis:**

1. Untuk satu layar, pilih **satu halaman** (mis. `tabler/tasks.html`), bukan seluruh proyek.
2. Karena hanya 40k karakter pertama dibaca, template besar (Tabler 100–500 KB) tetap jalan,
   tapi pastikan konten utama ada di awal `<body>`. Template ringkas (Tailwind Toolbox,
   Preline, StartBootstrap) paling aman.
3. Warna & font berasal dari jalur terpisah: **Import Design System**
   (`apps/api/src/modules/design-system/import.ts`).

---

## Sumber & lisensi

Tabel berikut mencatat lisensi **template utama**, bukan izin menyeluruh untuk
seluruh aset. Salinan notice/lisensi sumber ada di [`LICENSES/`](LICENSES) serta
folder vendor; pertahankan teks, nama penulis, tahun, dan notice asli. Nama file
arsip tidak menggantikan isi lisensinya. Ringkasan atribusi/adaptasi proyek dan
teks lisensi OpenDesign tersedia di
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

**Preline UI — Preline Labs Ltd.** berasal dari
[htmlstreamofficial/preline](https://github.com/htmlstreamofficial/preline).
[`preline/LICENSE`](preline/LICENSE) dan
[`LICENSES/Preline-MIT.txt`](LICENSES/Preline-MIT.txt) memuat MIT **beserta syarat
tambahan Preline UI Fair Use License**. Walaupun upstream menyebutnya “dual
license”, bagian 3 secara eksplisit menambahkan syarat redistribusi: sertakan
kedua teks lisensi, jangan hapus/ubah informasi lisensi, dan beri atribusi jelas
beserta tautan repo asli. Bagian 1–2 juga mengatur produk yang bersaing, misuse,
dan karya turunan komersial. Jangan menafsirkan label itu sebagai pilihan MIT
saja yang telah dikonfirmasi. Koleksi/proses layout lokal ini bukan produk resmi
Preline; sumber asli dan adaptasi lokal harus dibedakan.

**Cakupan paket publik pertama (disetujui 2026-10-03):** kode asli proyek memakai
Apache-2.0. Preline dikecualikan dari paket/katalog; Tabler dan TailAdmin juga dikecualikan
sementara karena review lisensi vendor ApexCharts dan Typed.js belum selesai (TailAdmin memuat ApexCharts v7.3.0 tanpa bukti lisensi penuh yang sesuai).
Seluruh `previews/` dikecualikan. Salinan lokal tetap utuh di path semula;
`.gitignore`, `.dockerignore`, dan katalog aplikasi menerapkan pengecualian tanpa
menghapus sumber/aset/notice. Tabel/snapshot historis di bawah tetap inventaris
koleksi lokal, bukan daftar semua sumber yang dikirimkan publik.

Lisensi utama MIT sumber lain tetap disimpan; ini bukan sertifikasi hukum semua
aset. Perlu inventaris versi/build, notice vendor, gambar/demo, font, ikon, merek,
aset CDN sebelum publikasi. Jangan menerbitkan arsip seluruh working tree lokal
atau memaksa penambahan folder yang dikecualikan. Penyalinan untuk referensi,
keberhasilan render, maupun pemrosesan menjadi brief layout tidak membuktikan
clearance aset. Lihat review scoped dan bukti vendor pada
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Contoh lisensi aset yang berbeda dari template utama:

- [`startbootstrap/sb-admin-2/vendor/fontawesome-free/LICENSE.txt`](startbootstrap/sb-admin-2/vendor/fontawesome-free/LICENSE.txt):
  Font Awesome Free — kode MIT, ikon CC BY 4.0, font SIL OFL 1.1; pertahankan
  komentar atribusi dan notice merek.
- [`staradmin/src/assets/fonts/Roboto/LICENSE.txt`](staradmin/src/assets/fonts/Roboto/LICENSE.txt):
  teks lengkap Apache License 2.0 untuk Roboto sudah disimpan.
- Sneat menyimpan tahun notice yang berbeda di [`sneat/LICENSE.md`](sneat/LICENSE.md)
  (2021) dan [`sneat/LICENSE`](sneat/LICENSE) / arsip pusat (2022), keduanya atas
  nama ThemeSelection. Pertahankan keduanya; provenance versi perlu ditentukan.

Daftar ini contoh berbasis bukti lokal, bukan audit lengkap. Tambahan dinamis
wajib ditinjau dan diberi provenance/notice per sumber; tabel snapshot tidak
otomatis mencakupnya.

**Modern / SaaS**

| Folder | Repo GitHub | ★ | Lisensi |
|---|---|---:|---|
| `tailadmin/` | [TailAdmin/tailadmin-free-tailwind-dashboard-template](https://github.com/TailAdmin/tailadmin-free-tailwind-dashboard-template) | 2.3k | MIT |
| `kwd-dashboard/` | [Kamona-WD/kwd-dashboard](https://github.com/Kamona-WD/kwd-dashboard) | 699 | MIT |
| `tailgrids-play/` | [TailGrids/play-tailwind](https://github.com/TailGrids/play-tailwind) | 1.2k | MIT |
| `cooladmin/` | [puikinsh/CoolAdmin](https://github.com/puikinsh/CoolAdmin) | 1.1k | MIT |
| `staradmin/` | [BootstrapDash/StarAdmin-Free-Bootstrap-Admin-Template](https://github.com/BootstrapDash/StarAdmin-Free-Bootstrap-Admin-Template) | 1.4k | MIT |
| `tailwind-landing-page/` | [themesberg/tailwind-landing-page](https://github.com/themesberg/tailwind-landing-page) | 139 | MIT |
| `tailwindcss-templates/` | [rosstopping/tailwindcss-templates](https://github.com/rosstopping/tailwindcss-templates) | 399 | MIT |

**Admin klasik**

| Folder | Repo GitHub | ★ | Lisensi |
|---|---|---:|---|
| `adminlte/` | [ColorlibHQ/AdminLTE](https://github.com/ColorlibHQ/AdminLTE) | 45.6k | MIT |
| `tabler/` | [tabler/tabler](https://github.com/tabler/tabler) (HTML dari preview.tabler.io, `dist/` dari npm `@tabler/core`) | 41.8k | MIT |
| `coreui/` | [coreui/coreui-free-bootstrap-admin-template](https://github.com/coreui/coreui-free-bootstrap-admin-template) | 12.3k | MIT |
| `startbootstrap/` | [startbootstrap](https://github.com/startbootstrap) (sb-admin-2, agency, creative, clean-blog, dll.) | beragam | MIT |
| `preline/` | [htmlstreamofficial/preline](https://github.com/htmlstreamofficial/preline) | 6.5k | MIT + syarat tambahan Preline UI Fair Use (lihat teks asli) |
| `material-kit/` | [creativetimofficial/material-kit](https://github.com/creativetimofficial/material-kit) | 5.9k | MIT |
| `bulma/` | [BulmaTemplates/bulma-templates](https://github.com/BulmaTemplates/bulma-templates) | 3.3k | MIT |
| `tailwindtoolbox/` | [tailwindtoolbox](https://github.com/tailwindtoolbox) | 1.5k | MIT |
| `sneat/` | [themeselection/sneat-bootstrap-html-admin-template-free](https://github.com/themeselection/sneat-bootstrap-html-admin-template-free) | 1.2k | MIT |
| `landwind/` | [themesberg/landwind](https://github.com/themesberg/landwind) | 1.0k | MIT |
| `materio/` | [themeselection/materio-bootstrap-html-admin-template-free](https://github.com/themeselection/materio-bootstrap-html-admin-template-free) | 113 | MIT |

Catatan teknis:

- **CoreUI**, **TailAdmin**, dan **KWD Dashboard** tidak punya CSS di repo (SCSS/source).
  Folder di sini adalah hasil build (`npm run build`) masing-masing, jadi CSS/JS-nya lengkap.
- **Tabler** repo intinya sekarang berbasis Astro (bukan HTML statis). Halaman HTML-nya
  diambil dari `preview.tabler.io`, sedangkan `dist/css`, `dist/js`, dan `dist/libs`
  diambil dari paket npm `@tabler/core`; gambar contoh dari `preview.tabler.io/static`.
- Beberapa halaman memuat CSS/JS dari **CDN** (Bootstrap, Tailwind CDN, Google Fonts,
  Font Awesome). Dengan koneksi internet tampilannya utuh; tanpa internet tetap terbaca
  struktur dan class-nya.
- Dihapus dari salinan ini: `.git`, `node_modules`, `package-lock.json`, SCSS sumber, dan
  halaman **stub redirect** yang tak punya UI (`sneat/dokumentasi`, `sneat/hire-us`,
  `materio/hire-us`) — isinya hanya `meta refresh` ke situs vendor.

### ⚠️ KWD Dashboard perlu dijalankan lewat server

`kwd-dashboard/` di-build dengan Vite memakai **ES module** (`<script type="module">`).
Browser memblokir module script saat dibuka via `file://`, jadi halaman ini **hanya tampil
benar lewat HTTP server**. Dari folder ini jalankan:

```bash
cd "Referensi UI"
python -m http.server 8899
# lalu buka http://127.0.0.1:8899/kwd-dashboard/index.html
```

Template lain bisa dibuka langsung (klik dua kali file HTML) tanpa server.

---

## Verifikasi (bukan klaim kosong)

**1. Referensi aset lokal** (menghormati `<base href>`): hanya favicon yang tidak ada;
seluruh `css`/`js` yang direferensikan **ada** di disk.

**2. Render Chromium** (Chrome headless, viewport 1440×900, lewat HTTP server) atas
**430 halaman**:

```
html dirender: 430
CSS tidak termuat (font masih default browser, 0 rules): 0
error: 0
```

**3. Bukti stylesheet benar-benar aktif** (jumlah stylesheet + warna body + font terhitung):

```
── modern / SaaS ──
tailgrids-play  sheets=3   bg=rgba(0,0,0,0)     font=Inter        cards=78
tailadmin       sheets=5   bg=rgb(249,250,251)  font=Outfit       cards=112
cooladmin       sheets=7   bg=rgb(244,246,250)  font=Inter        cards=49
staradmin       sheets=9   bg=rgb(255,255,255)  font=roboto       cards=59
kwd-dashboard   sheets=3   bg=(via HTTP)        font=Noto Sans    rules=628
tailwindcss-templates sheets=2 bg=rgb(255,255,255) font=ui-sans-serif
tailwind-landing-page sheets=1 font=ui-sans-serif
── admin klasik ──
adminlte        sheets=5   bg=rgb(248,249,250)   font="Source Sans 3"
coreui          sheets=5   bg=rgb(243,244,247)
tabler          sheets=13  bg=oklch(0.9851 0 0)
sneat           sheets=14  bg=rgb(245,245,249)   font="Public Sans"
materio         sheets=12  bg=rgb(244,245,250)   font=Inter
material-kit    sheets=5   bg=rgb(229,229,229)   font=Inter
bulma           sheets=4   bg=rgb(236,240,243)
startbootstrap  sheets=4   bg=rgb(255,255,255)   font=Nunito
preline         sheets=4   bg=oklch(0.985 0.001 106.423)
tailwindtoolbox sheets=4   bg=rgb(31,41,55)       font=ui-sans-serif
```

Total ukuran folder: **±253 MB**.
