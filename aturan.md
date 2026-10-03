# Aturan design system, UI reference, dan isi screen

**Status: target revisi 2026-10-01; label dokumentasi ditinjau 2026-10-03.**
Sebagian jalur kode telah berubah. Ini bukan klaim bahwa seluruh revisi sudah
atau belum diimplementasikan; periksa tiap aturan terhadap kode dan bukti
bertanggal. Review pipeline 2026-10-01 bersifat historis.
Dokumen ini menetapkan perilaku yang dituju. Label **(baru)** dan **(berubah)**
di bagian lama adalah penanda historis, bukan bukti implementasi revisi ini.
§8 memetakan pekerjaan dan verifikasinya; catatan pipeline historis (diarsipkan lokal) mencatat
implementasi yang diperiksa pada 1 Oktober 2026. Katalog temuan ada di
`apps/api/src/modules/ux/ux-rules.ts`, pemeriksaan
approve di `ux/ux-approval.ts`, dan STALE berbasis isi di `artifact/service.ts`
(`contentFingerprint`).

Sumber utama: `packages/ai/src/prompts/ux.ts`, `apps/api/src/modules/ux/*.ts`,
`apps/api/src/modules/design-system/*`, `packages/contracts/src/ai.ts` dan `design-system.ts`.

**Tujuan:** UI reference harus memenuhi kebutuhan pengguna, tetap konsisten, dan tidak
dipaksa menjadi template yang sama. Karena itu setiap aturan termasuk salah satu dari
tiga jenis:

| Jenis | Sifat | Contoh |
|---|---|---|
| **Batas keras** | Selalu ditegakkan platform, tidak bisa disimpangi | Sanitasi, maksimal 12 screen, batas schema |
| **Syarat approve** | Temuannya memblokir approve | Requirement P0 tidak terlayani, overlay wajib hilang, input tanpa label, warna di luar token, angka tanpa sumber |
| **Panduan** | Pilihan dinilai berdasarkan konteks; masalah konkret menjadi masukan review | Hierarki, kepadatan, pengelompokan konten |

**Prinsip revisi:** kebutuhan pengguna menentukan komposisi; design system menjaga
konsistensi. Kit menyediakan komponen, bukan satu template halaman untuk semua produk.
Keamanan, aksesibilitas, ketertelusuran requirement, dan integritas data tetap wajib.
Perbedaan visual harus membantu penggunaan; dekorasi dan layout yang aneh bukan tujuan.

---

## 1. Urutan, syarat, dan STALE

```
requirements (approved) → stack (locked) → technical design (approved)
                              ↓
                     design system (opsional)
                              ↓
                     UI reference (opsional) → tasks
```

| Artifact | Syarat sebelum bisa dibuat |
|---|---|
| Design system | Stack sudah dikunci, karena component library bergantung pada stack |
| UI reference neutral | Requirements, stack, dan technical design sudah approved |
| UI reference styled | Syarat di atas, ditambah design system yang approved |

Design system dan UI reference bersifat opsional. Di journey keduanya dianggap
"skipped" kalau tasks sudah dibuat tanpa keduanya.

### 1.1 Kapan turunan menjadi STALE (berubah)

- **Yang menentukan adalah perubahan isi, bukan tindakan approve.** Turunan menjadi
  STALE hanya kalau upstream punya revisi approved yang isinya berbeda dari versi yang
  dipakai turunan itu. Approve ulang tanpa perubahan isi tidak membatalkan apa pun.
- **Setiap turunan mencatat versi upstream yang benar-benar dipakainya (baru):**
  artifact, revisi, dan hash isinya. STALE dihitung dari catatan ini, jadi hanya
  turunan yang memakai versi lama yang ditandai.
- **Artefak lama tetap tersimpan.** STALE hanya menandai perlunya pemeriksaan dampak;
  tidak ada yang dihapus atau ditimpa.

| Yang isinya berubah | Turunan yang diperiksa |
|---|---|
| requirements | stack, design, task plan, UI reference |
| stack | design, design system, task plan, UI reference |
| design | task plan, UI reference |
| design system | UI reference `styled`; task plan yang memuat design system **(baru)** |
| UI reference | task plan yang memuat UI reference **(baru)** |

Eksekusi yang sedang berjalan tidak dibatalkan. Konteks eksekusi mencatat versi
design system dan UI reference yang dipakai, sehingga dampak perubahan bisa ditelusuri.

---

## 2. Design system

Design system **tidak dibuat oleh AI**. Isinya dipilih manual dari preset lalu
disesuaikan, jadi tidak ada panggilan AI.

### 2.1 Preset

Ada 14 preset generik (`presets.ts`, diadaptasi dari open-design, Apache-2.0):

minimal · modern-saas · editorial · brutalist · playful · material · enterprise ·
mission-control · warm-friendly · elegant · calm-nature · retro-paper · vibrant · terminal

### 2.2 Isi spec (`DesignSystemSpecSchema`)

| Field | Aturan |
|---|---|
| `preset_id` | Preset asal, atau `custom` |
| `name`, `summary` | Nama dibatasi schema dan di-escape lagi di setiap export |
| `light`, `dark` | Palet warna hex untuk setiap token warna |
| `fonts.display`, `fonts.body` | Hanya daftar font-family CSS (tanpa `; { } < > / \`) |
| `radius` | 0–24 px untuk kontrol; card 1.5×; pill penuh |
| `density` | `compact` / `comfortable` / `spacious` |
| `depth` | `flat` / `hairline` / `soft` / `hard` |
| `border_width` | 1–3 px |
| `component_library` | Salah satu library di katalog |
| `guidance` | Karakter, do, avoid (markdown, maks 6000 karakter) |

### 2.3 Kontras palet wajib lolos (`checkPalette`)

Ada 12 pasangan warna yang dicek di mode **light dan dark**. Rasionya dibandingkan
**persis**, tanpa pembulatan. Satu saja yang gagal membuat save ditolak, dan pesan
galatnya menyebut pasangan yang gagal.

| Pasangan | Minimum |
|---|---|
| Teks utama di halaman (`fg` / `bg`) | 4.5 |
| Teks utama di card (`fg` / `surface`) | 4.5 |
| Teks sekunder di halaman (`fgMuted` / `bg`) | 4.5 |
| Teks sekunder di card (`fgMuted` / `surface`) | 4.5 |
| Teks sekunder di fill halus (`fgMuted` / `surface2`) | 4.5 |
| Teks di tombol accent (`accentFg` / `accent`) | 4.5 |
| Link accent di halaman (`accent` / `bg`) | 4.5 |
| Tepi form control (`borderStrong` / `surface`) | 3 |
| Teks error (`danger` / `bg`) | 4.5 |
| Indikator success (`success` / `bg`) | 3 |
| Indikator warning (`warn` / `bg`) | 3 |
| Indikator info (`info` / `bg`) | 3 |

Palet yang lolos belum menjamin setiap screen lolos, karena warna bisa dipasangkan
di luar 12 pasangan ini. Kombinasi yang benar-benar dirender dicek lagi oleh render
check (§6.3).

### 2.4 Component library dan pemilik perilaku

`shadcn`, `daisyui`, `bootstrap`, `material`, `antd`, `flowbite`, `pico`, `none`.

- Saran library dihitung dari stack secara deterministik (`suggestLibraries`), tanpa AI.
- Setiap library memetakan **role UI → class mockup `ds-*` → komponen library**.
  Tampilan kit mockup mengikuti skin library itu (`mockupCss`).
- **Kit menjamin perilaku komponen; screen menentukan konten dan alurnya (baru).**
  Rinciannya ada di §6.1.

### 2.5 Setelah approved

- **Export ke `docs/design-system/`:** DESIGN.md, `tokens.css`, token DTCG JSON,
  Tailwind theme, file theme library, dan preview. DESIGN.md memuat bagian
  **Perilaku komponen** (baru) dari §6.1. `sddctl ui pull` menulis folder ini ke repo agent.
- **Brief ke AI** (`designSystemBrief`): nama, ringkasan, library, font,
  radius/density/depth/border, peta role → class → komponen, dan guidance.
- **Konteks agent:** task generation dan execution prompt ikut memuat design system,
  dan mencatat versinya (§1.1).

---

## 3. UI reference: aturan umum

- **Fidelity:**
  - `neutral`: wireframe abu-abu (`NEUTRAL_SPEC`);
  - `styled`: memakai design system yang approved.
  - Keduanya memakai komponen dasar dan pemeriksaan fungsi yang sama. Shell,
    komposisi, tipografi, dan media mengikuti brief produk; struktur tidak wajib identik.
  - Gunakan `styled` sebagai pilihan awal untuk draft baru jika design system sudah
    approved; pilihan eksplisit user selalu didahulukan. Draft lama tidak diubah otomatis.
  - Neutral dipakai untuk menilai alur dan hierarki. Jangan menilainya sebagai desain final.
- **Alur:** AI membuat plan → setiap screen digambar dengan satu panggilan AI → approve.
- **Jumlah screen:** batas keras **12** (`MAX_UX_SCREENS`). Jumlah yang diminta user
  dipenuhi selama cakupan wajib tetap terlayani; kalau tidak mungkin, konfliknya
  ditampilkan (§4.2). Screen terakhir tidak bisa dihapus.
- **Tambah/hapus screen** hanya bisa di draft. Navigasi shell semua screen ikut diperbarui.
- **Approve (berubah):** semua screen sudah digambar adalah syarat **perlu, tetapi
  belum cukup**. Syarat lengkapnya ada di §5.4.

---

## 4. Cara isi screen ditentukan

Ada lima lapis. Setiap lapis mempersempit apa yang muncul di screen, tetapi aturan
layout di lapis 2 dan 3 adalah default yang bisa disesuaikan dengan kebutuhan pengguna.

### Lapis 1: konteks yang dikirim ke AI (`planningContext`)

- Nama project dan ide awal
- Stack yang di-approve (kategori: teknologi)
- **Semua requirement**: key, prioritas, judul, statement, dan setiap acceptance criteria
- Overview technical design dan daftar komponennya (nama: tanggung jawab)
- Jumlah screen yang diminta (atau "tentukan sendiri") dan arahan dari user

**Brief visual produk, dibawa ke plan, generate, redraw, dan AI edit:**

| Bagian | Isi yang diperlukan |
|---|---|
| Pengguna dan konteks | Siapa yang memakai, pekerjaan inti, frekuensi, dan lingkungan penggunaan |
| Perangkat utama | Perangkat yang diprioritaskan serta ukuran lain yang tetap harus didukung |
| Arah visual | Karakter yang konkret beserta konsekuensinya: misalnya kasir cepat → target sentuh lapang, menu mudah dipindai, pesanan selalu terlihat |
| Hierarki dan konten | Informasi atau aksi yang dominan; peran foto, ilustrasi, angka, tabel, atau editor |
| Acuan dan batas | Referensi dari user bila tersedia, aspek yang diambil, aset yang tersedia, serta preferensi yang harus dihindari |

Kalau brief belum lengkap, AI menyusun asumsi singkat dari requirements dan mencatatnya
untuk ditinjau. Jangan menambah fitur demi gaya. Referensi tidak wajib untuk memulai;
jangan mengaku telah melihat gambar jika yang diterima hanya deskripsi atau HTML.
Gunakan guidance design system dan `layout_note` yang sudah ada selama cukup;
penyimpanan terstruktur baru hanya ditambah jika benar-benar dibutuhkan lintas tahap.

### Lapis 2: plan (`UX_PLAN_SYSTEM_PROMPT`)

**Punya UI atau tidak? (berubah)** `applicable` ditentukan oleh **cakupan kebutuhan
antarmuka visual di requirements**, bukan oleh kategori teknologi. Project API yang
punya requirement konsol admin tetap `applicable=true`. CLI, library, atau background
service tanpa requirement antarmuka visual menghasilkan `applicable=false`, tanpa screen.

**Satu screen = satu pekerjaan pengguna beserta konteksnya (berubah).**
- Kelompokkan requirement yang mendukung pekerjaan dan konteks yang sama. Daftar
  dengan search, filter, sort, dan pagination tetap satu screen. Detail boleh berada
  di screen itu bila pekerjaan membutuhkan konteks daftar; detail yang kompleks atau
  menjadi tujuan navigasi mandiri boleh menjadi screen terpisah.
- Pisahkan pekerjaan yang butuh layout atau konteks berbeda (list, editor/tree,
  analytics), atau yang dikerjakan role berbeda pada waktu berbeda.
- Jumlah requirement atau elemen per screen **bukan alasan untuk memecah screen**.
  Angka itu hanya sinyal review; yang diperiksa adalah hierarki dan hubungan antarelemen.
- Yang dibuat adalah screen aplikasi untuk kerja harian, bukan halaman marketing.

**Isi setiap screen di plan:**

| Field | Aturan |
|---|---|
| `key` | kebab-case, contoh `create-poll` |
| `name` | 2–3 kata; menjadi label navigasi |
| `purpose` | Satu kalimat: siapa melakukan apa |
| `requirement_keys` | Requirement yang dilayani; minimal 1 (batas schema 10) |
| `key_elements` | Rekomendasi **≤ 5** (batas schema 12). Harus terlihat dan bisa dicek (tabel dan kolomnya, filter bar, stat card, chart, panel detail). Semua wajib muncul di screen |
| `overlays` | Maksimal **3** (batas schema): `dialog`, `sheet`, atau `confirm`; pemilihannya mengikuti tabel penempatan form di bawah |
| `screen_type` | `dashboard` · `list` · `detail` · `form` · `settings` · `board` · `analytics` |
| `states` **(baru)** | State yang relevan untuk screen ini beserta responsnya, misalnya empty, loading, gagal menyimpan, izin ditolak (§6.2) |
| `layout_note` | Rencana komposisi singkat: fokus utama, susunan area, kepadatan, peran media, dan adaptasi perangkat. Alasan mengikuti pekerjaan pengguna, bukan pembelaan karena berbeda dari template |

Setiap overlay dan aksi primary membawa `result` **(baru)**: satu kalimat tentang apa
yang terjadi setelah aksi berhasil atau gagal (toast, redirect, baris diperbarui).

**Penempatan form (berubah).** Form tidak lagi selalu menjadi overlay:

| Keadaan | Tempat |
|---|---|
| Form singkat, satu record | `dialog` |
| Edit atau lihat detail sambil daftar tetap terlihat | `sheet` |
| Form panjang, multi-step, atau perlu disimpan sebagai draft | Halaman tersendiri (`screen_type: form`) |
| Aksi destruktif | `confirm` |
| Settings dan form satu record | Diedit langsung di halaman |

**Jumlah screen:**
- **Tidak ditentukan user:** satu screen per pekerjaan inti; biasanya 4–8 untuk MVP,
  2–3 untuk tool sederhana. Alasannya ditulis di `count_rationale`.
- **Ditentukan user (berubah):** plan memakai jumlah itu persis selama semua
  requirement P0 yang terlihat user tetap terlayani tanpa memaksa pekerjaan berbeda
  masuk ke satu screen. Kalau tidak mungkin, plan tetap memakai jumlah itu dan mengisi
  `count_conflict` **(baru)**: requirement wajib yang tertinggal dan jumlah minimum
  yang disarankan. Konflik ini ditampilkan sebelum screen digambar, lalu user memilih
  menaikkan jumlah atau menerima cakupan yang tertinggal.

**Cakupan dan ketertelusuran (berubah):**
- Setiap requirement **P0** yang terlihat user dilayani minimal satu screen.
- Setiap screen tertelusur ke minimal satu requirement, termasuk kebutuhan pendukung
  yang eksplisit (misalnya screen sign-in karena requirement meminta kontrol akses).
- Screen tanpa jejak **tidak dibuang diam-diam**. Screen itu ditandai `untraced-screen`
  dan user memutuskan menghapusnya atau menghubungkannya ke requirement.
- Kalau kebutuhan melampaui batas 12 screen, plan menyebut cakupan yang belum
  tertangani di `uncovered_scope` **(baru)**. Cakupan ini harus dikonfirmasi user
  sebelum approve.
- State empty, error, dan loading masuk ke screennya sendiri, bukan jadi screen terpisah.

**Shell yang dibutuhkan (baru).** Plan menentukan utilitas shell berdasarkan
requirements: `shell.search` (search lintas data), `shell.notifications`, dan
`shell.account` (user menu, sign-out). Setiap utilitas yang aktif menyebut requirement
yang memerlukannya. Tanpa requirement, utilitas itu tidak digambar.

**Bentuk shell mengikuti pekerjaan produk.** Plan memilih navigasi samping untuk
banyak area kerja, navigasi atas untuk sedikit tujuan utama, atau shell minimal untuk
pekerjaan terfokus. Ini pilihan berdasarkan kebutuhan, bukan pemetaan wajib per industri.
Shell tetap dirender platform agar konsisten antar-screen. Jangan meminta AI menggambar
shell kedua di dalam `<main>`. Varian baru memerlukan dukungan renderer sebelum dipakai;
kalau belum didukung, tampilkan batas kemampuan itu dan jangan diam-diam menggantinya.

**`sample_data`: data contoh yang dipakai semua screen:**
- `records`: 3–8 record inti dengan fakta kunci yang angkanya saling cocok
- `people`: 1–2 orang per role di requirements
- `notes`: tanggal "hari ini", periode laporan, satuan, mata uang
- `statuses`: setiap label status beserta warnanya
  (`success` / `warn` / `danger` / `info` / `accent` / `neutral`)
- `aggregates` **(baru)**: total atau KPI yang tidak bisa dihitung dari `records`
  saja, masing-masing dengan label, nilai, dan dasar perhitungannya (§6.4)

Kalau plan tidak menyertakan `sample_data`, platform membuatnya dengan satu
panggilan AI saat screen pertama digambar (`ensureSampleData`).

**Plan lint (`lintUxPlan`) (berubah):**

| Aturan | Kategori | Tindakan | Target repair |
|---|---|---|---|
| `uncovered-requirements` (P0 terlihat user) | Kelengkapan fungsi | **Blokir approve**, kecuali tercatat di `count_conflict`/`uncovered_scope` dan sudah dikonfirmasi user | Ya |
| `uncovered-requirements` (P1/P2) | Panduan | Peringatan | Tidak |
| `wrong-count` tanpa `count_conflict` | Instruksi user | Peringatan dengan konteks | Ya |
| `busy-screen`: key elements > 5 atau banyak requirement | Panduan | Peringatan: periksa hierarki dan hubungan elemen | Tidak |
| `untraced-screen` **(baru)** | Panduan | Peringatan; user memutuskan | Tidak |

Repair plan mengikuti aturan repair di §5.3.

### Lapis 3: prompt per screen (`generateUxScreen` + `UX_SCREEN_RULES`)

**Isi request:**
1. Konteks lapis 1
2. Brief visual produk; ditambah brief design system untuk styled
3. Daftar screen lain beserta purpose-nya, supaya nama dan data konsisten
4. `sample_data`
5. Data screen ini: nama, tipe, purpose, requirement, **key elements (semua wajib
   muncul)**, overlays beserta `result`, `states`, dan `layout_note`
6. Untuk redraw: isi screen saat ini dan perubahan yang diminta

**Yang dikembalikan AI hanya:**

```html
<!-- PLAN: pekerjaan pengguna, fokus utama, susunan area, adaptasi perangkat,
     satu aksi primary per area, overlays -->
<main class="ds-main">
  …halaman…
  <section class="ds-overlays">…overlay dan state…</section>
</main>
```

- Setiap key element ditandai pada elemen pembungkusnya dengan
  `data-key-element="<nomor urut di plan>"` **(baru)**, supaya kelengkapannya bisa dicek.
- Sidebar, top nav, logo, brand, search global, notifikasi, dan user menu **dibuat
  oleh platform**. AI dilarang menggambarnya.
- Tidak boleh ada `<html>`, `<head>`, `<body>`, atau `<script>`.

**Komposisi berdasarkan tugas, bukan resep wajib.** `screen_type` adalah kategori
fungsi. Pilih susunan dari konten dan pekerjaan pengguna, lalu catat di `layout_note`.
Sediakan satu judul utama yang jelas; `ds-page-header`, deskripsi di bawah judul,
dan aksi di kanan tidak wajib. Deskripsi hanya ditulis jika menambah informasi.

| Tipe | Dasar memilih komposisi |
|---|---|
| dashboard | Dahulukan keputusan atau pekerjaan berikutnya. Antrean, jadwal, atau masalah yang perlu ditangani boleh menjadi fokus. KPI hanya jika berguna dan tersedia datanya; tidak ada kuota stat card |
| list | Tabel untuk membandingkan atribut; daftar untuk memindai; galeri untuk pengenalan visual. Filter dan pagination hanya sesuai kebutuhan data |
| detail | Dominankan objek yang sedang diperiksa: dokumen, media, fakta, atau riwayat. Panel samping dan tabs hanya jika hubungan konten membutuhkannya |
| form | Kelompokkan field menurut urutan kerja. Gunakan section tanpa card bila sudah jelas; langkah terpisah hanya untuk proses yang memang bertahap |
| settings | Kelompokkan menurut keputusan pengguna. Pilih simpan per section atau bersama berdasarkan hubungan perubahan |
| board | Kolom mewakili tahap atau kategori yang nyata. Prioritaskan informasi yang diperlukan untuk memindahkan atau menangani item |
| analytics | Mulai dari pertanyaan yang dijawab, pilih visualisasi dan pembanding yang sesuai. Stat dan tabel pendamping hanya jika membantu penafsiran |

Contoh pembeda: kasir restoran dapat mengutamakan katalog menu dan pesanan aktif;
aplikasi dokumen mengutamakan bacaan atau editor; operasi gudang mengutamakan antrean
dan pengecualian. Contoh ini bukan template baru dan tidak menambah cakupan requirement.
Komponen, jarak, dan istilah tetap konsisten dalam satu produk meskipun komposisinya berbeda.

**Perangkat utama menentukan prioritas, bukan menghapus responsivitas.** Tetap gunakan
satu HTML responsif jika cukup. Tentukan perubahan urutan, navigasi, dan detail pada
ukuran kecil; jangan sekadar mengecilkan desktop. Konten dan aksi wajib tetap terjangkau.

**Tabel di HP (berubah).** Perlakuan dipilih berdasarkan tugas lewat atribut
`data-phone` pada `<table>` **(baru)**:

| Nilai | Kapan dipakai | Hasil di HP |
|---|---|---|
| `priority` | Memindai daftar | Hanya kolom `<th data-priority>` yang tampil |
| `expand` | Perlu sesekali melihat detail baris | Baris bisa dibuka untuk melihat kolom lain |
| `card` | Record dengan sedikit fakta | Setiap baris menjadi card (maks ~4 fakta) |
| `scroll` | Membandingkan angka antarkolom | Tabel tetap tabel, scroll horizontal di `ds-table-wrap`, kolom pertama tetap terlihat |

Tanpa atribut, platform memakai default lama: tabel dengan lebih dari 4 kolom menjadi
card. Scroll di dalam `ds-table-wrap` tidak dihitung sebagai overflow.

**Batas keras vs rekomendasi (berubah).** `UX_BUDGETS` dipisah menjadi dua kelompok.

*Batas keras*, ditegakkan schema atau platform:

| Batas | Nilai |
|---|---|
| Screen per UI reference | 12 |
| `requirement_keys` per screen | 10 |
| `key_elements` per screen | 12 |
| Overlay per screen | 3 |
| State frame yang digambar | 2 (hanya jumlah gambar; state lain tetap dijelaskan, §6.2) |
| Lebar tetap di composition CSS | < 320 px (sisanya dibuang) |
| History versi per screen | 5 |

*Rekomendasi desain*, hanya menjadi sinyal review:

| Rekomendasi | Nilai |
|---|---|
| Key elements per screen | 5 |
| Stat card di dashboard | Sesuai keputusan pengguna dan data; boleh 0 |
| Blok utama | Sekitar 5 sebagai sinyal review, bukan target pengisian |
| Kolom tabel (tanpa kolom checkbox) | 7 |
| Tabel selebar halaman kalau kolomnya lebih dari | 5 |
| Fakta per card di HP | 4 |
| Aksi di page header | 3 |
| Tombol primary per area | 1 |
| Panjang halaman di HP | 4 layar |

Batas "requirement per screen = 3" dihapus. Pengelompokan requirement mengikuti
pekerjaan pengguna.

**Overlay:**
- Main view hanya menampilkan tombol atau aksi yang **membuka** overlay.
- Setiap overlay digambar di `ds-overlays` sebagai `figure.ds-frame` dengan
  figcaption, misalnya "Dialog: Create project".
- Setiap overlay punya heading dan footer. Tombol utamanya menyebut aksinya
  ("Create project"), bukan "OK" atau "Submit".
- Setelah overlay boleh ada maksimal 2 state frame. Main view sendiri menampilkan
  **satu state yang terisi dan valid**.

**Konten:**
- Data realistis dengan istilah dari requirements, sama dengan screen lain.
- Label tombol berbentuk kata kerja + objek. Aksi yang sama memakai nama yang
  sama di tombol, judul dialog, dan toast.
- Setiap input punya `<label>` yang terlihat; placeholder hanya contoh.
- Pesan error menyebut masalahnya dan cara memperbaikinya. Empty state
  menyebut apa yang akan muncul dan menawarkan satu aksi.

**Batas tegas (tetap):**
- Tanpa `<html>`, `<head>`, `<body>`, `<script>`, atau markup tidak aman lainnya (§Lapis 4).
- Warna, font, radius, dan shadow hanya lewat token `--ds-*`; tidak ada nilai literal.
- Angka berasal dari `sample_data` (record atau `aggregates`); **dilarang mengarang**
  KPI, growth %, atau klaim yang tidak ada di requirements.

**Panduan visual berdasarkan hasil:**
- Bedakan informasi utama, pendukung, dan metadata melalui ukuran, bobot, jarak,
  serta posisi. Tidak semua area harus berbentuk card atau berbobot sama.
- Gunakan card untuk pengelompokan yang nyata. Section, divider, daftar, dan ruang
  kosong cukup bila hubungan kontennya sudah jelas.
- Foto atau ilustrasi dipakai jika membantu mengenali objek atau memahami konten.
  Placeholder harus menyebut subjek dan rasio; jangan menganggapnya bukti kualitas foto final.
- Heading besar, aksen, gradient berbasis token, dan label kategori boleh jika sesuai
  brief serta bisa diperiksa aksesibilitasnya. Kehadirannya sendiri bukan kesalahan desain.
- Hindari filler copy, statistik tanpa kegunaan, ikon berulang tanpa arti, dan dekorasi
  yang mengalihkan perhatian dari pekerjaan utama.

**Ikon:** `<i data-icon="nama-lucide">`. Pakai saat membantu pengenalan aksi, objek,
atau status. Tombol dengan label yang sudah jelas dan stat tidak wajib memiliki ikon.
Tombol ikon tetap wajib punya nama aksesibel (`aria-label`).

**Composition CSS (opsional):**
- Satu `<style>` sebagai anak pertama `<main>`, hanya untuk layout yang tidak
  bisa dibuat dengan kit.
- Boleh mengatur layout dan spacing. Warna, tipografi, border, radius, dan shadow
  memakai token atau varian kit yang disetujui. Class wajib berawalan `x-`.
- Kit menyediakan skala tipografi per peran: display, judul, body, label, dan angka.
  Display dipakai sesuai brief; ukuran responsif menjaga teks tetap terbaca.
- Font disediakan platform dari aset berizin, dengan fallback eksplisit. Preview
  menyatakan jika font pengganti dipakai; nama font di spec saja belum cukup.
- Media berasal dari aset terkelola yang divalidasi platform, lalu disematkan sesuai
  CSP. AI tidak boleh menambahkan fetch URL bebas atau melonggarkan sanitizer.
- Gradient token hanya diaktifkan setelah pemeriksaan latarnya tersedia. Bagian
  yang tidak dapat diukur ditandai perlu review, bukan dianggap lolos kontras.
- Script, event handler, URL eksternal bebas, selector `html`/`body`/shell, dan CSS
  di luar allowlist tetap ditolak. Mockup statis tidak memerlukan animasi.

**Transisi implementasi:** tipografi per peran, aset, dan gradient di atas memerlukan
dukungan kit/sanitizer. Prompt hanya boleh menawarkan kemampuan yang sudah tersedia;
batas CSS lama tetap berlaku sampai dukungan penggantinya lolos pemeriksaan.

**Khusus styled:** terapkan guidance pada komposisi, tipografi, kepadatan, media,
dan warna. Ambil arahan yang relevan dengan screen; jangan menambahkan halaman
marketing yang tidak diminta. Accent membantu fokus dan identitas secara terukur;
warna success/warn/danger/info tetap memiliki makna status yang konsisten.

### Lapis 4: pemrosesan hasil oleh platform

1. **Sanitasi** (`ux-sanitize.ts`, parser allowlist): membuang script, event
   handler, embed, `base`/`link`/`meta`, form action, dan SVG animate/use/foreignObject.
   Link hanya boleh ke `#…` atau `./<screen>.html`. Sanitasi dijalankan lagi saat
   screen dibaca, di-undo, atau di-restore, dan hasilnya tetap divalidasi oleh lint.
2. **Lint HTML** (`ux-lint.ts`) dan **render check** Chromium di 390×844 dan
   1440×900 (`ux-render.ts`). Temuan dikelompokkan menurut §5.
3. **Satu kali repair otomatis** kalau ada temuan yang menjadi target repair (§5.3).
4. **Warna status diseragamkan** (`applyStatusTones`): satu status selalu satu
   warna di semua screen. Sumbernya daftar `sample_data.statuses`; kalau tidak
   ada, dipakai warna mayoritas ≥ 70% (hampir seri dibiarkan).
5. **Shell ditambahkan** (`assembleScreen`): bentuk navigasi mengikuti pilihan plan
   dan platform perangkat. Brand, navigasi, dan utilitas konsisten antar-screen.
   Settings hanya ditampilkan kalau ada screen settings.
   Search, bell, dan user menu/footer hanya kalau `shell.search`,
   `shell.notifications`, atau `shell.account` aktif di plan. Ikon diubah menjadi SVG
   inline, tabel dibungkus `ds-table-wrap` dan diberi perlakuan HP sesuai `data-phone`,
   dan chart dibungkus.
6. **`ensureNodeIds`**: setiap elemen diberi `data-nid` supaya bisa dipilih,
   dikomentari, dan diedit.

### Lapis 5: edit setelah screen jadi

| Cara | Keterangan |
|---|---|
| Redraw dengan instruksi | Isi screen saat ini dikirim bersama perubahan yang diminta |
| AI edit per elemen | Hanya elemen terpilih (`nid`) yang diganti |
| Edit manual di canvas | Teks dan konten, lewat op `content` |
| Undo / History | Maksimal 5 versi; restore berdasarkan versi (`at`) |

- Semua edit melewati sanitasi dan lint yang sama; perannya per aksi ada di §5.5.
- Save, undo, dan restore membawa penanda versi (`base`). Kalau screen sudah
  berubah di tempat lain, hasilnya **409 UX_SCREEN_CHANGED** dan canvas dimuat ulang.
- Komentar ditempel ulang ke elemennya berdasarkan teks anchor setelah edit.
- AI edit menerima brief visual, requirement yang dilayani screen, `key_elements`,
  overlay, dan konteks data. Edit lokal mempertahankan komposisi lain kecuali diminta.
  Temuan boleh tersimpan dalam draft; pemeriksaan approve tetap berlaku.

---

## 5. Temuan, repair, dan approve (berubah)

Tingkat dampak dipisahkan dari tindakan sistem. Temuan estetika boleh diperbaiki
otomatis tanpa harus diberi label P0, dan temuan yang memblokir approve tidak selalu
berasal dari estetika.

### 5.1 Kategori

| Kategori | Contoh | Tindakan |
|---|---|---|
| Keamanan | Markup atau tautan tidak aman | Sanitasi wajib dan selalu jalan; hasilnya tetap divalidasi |
| Kelengkapan fungsi | Requirement P0, key element, atau overlay wajib hilang | **Blokir approve** |
| Hambatan penggunaan | Input tanpa label; aksi atau konten penting terpotong dan tidak terjangkau; teks di bawah kontras minimum | **Blokir approve** |
| Integritas token dan data | Warna literal di luar token; angka/KPI tanpa sumber di `sample_data` | **Blokir approve** |
| Panduan desain | Terlalu banyak blok, nested card, dua primary di area berbeda | Peringatan dengan konteks |

### 5.2 Aturan lint screen

| Aturan | Kategori | Tindakan | Target repair |
|---|---|---|---|
| `missing-overlay`: overlay di plan tidak digambar | Kelengkapan | Blokir | Ya |
| `missing-key-element` **(baru)**: ada `data-key-element` yang hilang | Kelengkapan | Blokir | Ya |
| `unlabelled-field` | Hambatan | Blokir | Ya |
| `phone-overflow` / `desktop-overflow`: elemen interaktif atau konten penting keluar layar dan tidak terjangkau scroll | Hambatan | Blokir | Ya |
| `phone-overflow` / `desktop-overflow` lainnya | Panduan | Peringatan | Ya |
| `low-contrast` **(baru)**: teks yang dirender di bawah 4.5 (teks besar 3) | Hambatan | Blokir | Ya |
| `low-contrast-control` **(baru)**: indikator status (badge, trend, titik timeline) di bawah 3 | Panduan | Peringatan | Ya |
| `raw-colour`: warna literal | Integritas | Blokir | Ya |
| `unsourced-metric` **(baru)**: angka di stat/KPI tidak ada di record atau `aggregates` | Integritas | Blokir | Ya |
| `drew-shell`: menggambar sidebar/nav sendiri | Panduan | Peringatan | Ya |
| `filler-copy`, `emoji-icon` yang menggantikan ikon aksi tanpa makna jelas | Panduan | Peringatan dengan konteks | Ya |
| Gradient token | Visual | Tidak menjadi temuan hanya karena ada gradient; dukungan renderer dan pemeriksaan kontras wajib tersedia | Tidak |
| `fixed-width`: ≥ 320px | Panduan (efeknya dinilai oleh cek overflow) | Peringatan | Ya |
| `competing-primaries`: lebih dari satu primary di area yang sama | Panduan | Peringatan | Ya |
| `two-primaries`: primary di area berbeda | Panduan | Peringatan dengan konteks | Tidak |
| `nested-card`, `left-accent-card` | Panduan | Review jika pengelompokan atau arti status tidak jelas; jangan menghapus berdasarkan bentuk saja | Tidak |
| `overlay-no-heading` | Panduan | Peringatan | Ya |
| `table-columns`: lebih dari 7 kolom | Panduan | Peringatan (tabel perbandingan sah) | Tidak |
| `inline-form`: lebih dari 3 field inline di list/dashboard/board/analytics | Panduan | Peringatan | Tidak |
| `too-many-blocks`, `page-actions-overuse` | Panduan | Peringatan | Tidak |
| `missing-h1` / `multiple-h1` | Panduan | Peringatan | Ya |
| `missing-page-header` | Komposisi | Bukan temuan jika judul utama dan konteks halaman sudah jelas | Tidak |
| `off-sheet-data`: tidak memakai record `sample_data` | Panduan | Peringatan | Tidak |
| `unknown-icon`, `style-dropped` | Panduan | Peringatan | Tidak |
| `phone-too-long`, `small-target`, `squeezed-text`, `tiny-text` | Panduan | Peringatan | Tidak |

`layout_note` membantu menilai pilihan komposisi; ia tidak membatalkan temuan keamanan,
aksesibilitas, atau kelengkapan. Preferensi estetika tidak menjadi target repair otomatis
hanya karena berbeda dari contoh. Tabel ini adalah target revisi katalog lint.

### 5.3 Aturan repair (berubah)

- Tetap **maksimal satu kali** repair otomatis per generate atau redraw.
- Hasil repair **diterima** hanya kalau ketiganya terpenuhi:
  1. temuan yang menjadi sasaran repair berkurang;
  2. tidak ada temuan "blokir approve" baru;
  3. tidak ada konten wajib yang hilang: semua `data-key-element`, overlay di plan,
     dan record `sample_data` yang tadinya muncul tetap ada. Untuk repair plan:
     cakupan requirement P0 tidak berkurang.
- Kalau hasil repair ditolak, versi sebelum repair yang dipakai.
- Kalau setelah itu masih ada temuan yang memblokir, screen **tetap disimpan sebagai
  draft** dengan temuan yang jelas: aturan, elemen, dan cara memperbaikinya.

### 5.4 Syarat approve

1. Hanya draft terbaru yang bisa di-approve.
2. Semua screen di plan sudah digambar.
3. Tidak ada temuan "blokir approve" di plan maupun di screen mana pun. Temuan
   HTML **dihitung ulang saat approve** dari HTML tersimpan. Hasil render hanya
   boleh dipakai kembali jika sesuai HTML final, token, shell, dan ukuran yang dinilai;
   perubahan pada salah satunya memerlukan render ulang. Render yang dilewati atau
   tidak dapat diukur harus terlihat sebagai belum diperiksa, bukan hasil lulus.
4. `count_conflict` dan `uncovered_scope`, kalau ada, sudah dikonfirmasi user.
5. Peringatan tidak memblokir, tetapi ringkasannya ditampilkan di dialog approve.

**UI reference tidak bisa di-approve hanya karena semua screen sudah digambar.**

### 5.5 Peran setiap aksi

| Aksi | Sanitasi | Lint | Render check | Repair otomatis | Blokir |
|---|---|---|---|---|---|
| Generate | Ya | Ya | Ya | Maks 1 | Tidak; disimpan sebagai draft dengan temuan |
| Redraw | Ya | Ya | Ya | Maks 1 | Tidak |
| AI edit per elemen | Ya | Ya | Ya | Tidak | Tidak |
| Edit manual | Ya | Ya | Ya | Tidak | Tidak |
| Undo / restore | Ya | Ya, dihitung ulang | Ya | Tidak | Tidak |
| Approve | Ya | Ya, dihitung ulang | Ulang jika hasil tidak sesuai HTML final, token, shell, atau ukuran (§5.4) | Tidak | **Ya** |

### 5.6 Review visual dari hasil render

Lolos lint berarti memenuhi pemeriksaan teknis yang tersedia. Kualitas visual dinilai
dari screenshot hasil akhir setelah sanitasi, token, font, media, dan shell diterapkan.
Untuk tahap awal cukup review manusia; model vision adalah opsi setelah manfaatnya terukur.

| Aspek | Pertanyaan review |
|---|---|
| Fokus | Apakah pekerjaan utama dan aksi berikutnya langsung terlihat? |
| Komposisi | Apakah susunan area mengikuti hubungan konten, bukan sekadar mengisi card? |
| Hierarki | Apakah informasi utama, pendukung, dan metadata mudah dibedakan? |
| Kesesuaian produk | Apakah istilah, kepadatan, media, dan navigasi sesuai pengguna serta brief? |
| Perangkat dan konsistensi | Apakah konten tetap terjangkau pada ukuran pendukung dan screen lain terasa satu produk? |

Catat hasil setiap aspek sebagai **sesuai**, **perlu revisi**, atau **belum diperiksa**,
dengan elemen yang bermasalah dan perubahan konkret. Jangan membuat skor otomatis
seolah-olah ukuran objektif keindahan. Review estetika menjadi masukan untuk keputusan
user; tidak menambah blocker otomatis yang subjektif.

Jika perbaikan visual dicoba, gunakan screenshot sebelum/sesudah pada kondisi yang sama.
Terima hanya jika masalah yang dituju membaik, tidak ada blocker baru, dan requirement,
key element, overlay, serta data wajib tetap utuh. Jika tidak, pertahankan versi sebelumnya.
Satu percobaan cukup sebelum meminta arahan yang lebih spesifik. Loop vision terpisah
yang mengkritik lalu menggambar ulang membutuhkan hingga dua panggilan tambahan;
biaya dan waktunya harus dihitung, bukan dianggap satu panggilan.

### 5.7 Anggaran generasi dan contoh referensi

- Catat model/profil, batas output efektif jika tersedia, penggunaan token, truncation,
  waktu, dan kebutuhan repair pada sampel representatif sebelum mengubah anggaran.
- Jika output terpotong, uji kenaikan lewat pengaturan profil yang sudah tersedia
  dalam batas kemampuan model. Jangan menetapkan 16k untuk semua provider tanpa pemeriksaan.
- Main view, overlay, dan state tetap dapat dibuat bersama. Pisahkan panggilan hanya
  jika pengukuran membuktikan perlu; assembly, data bersama, retry, dan pemeriksaan
  kelengkapan harus tetap bekerja sebelum perubahan itu diaktifkan.
- Pilih satu atau dua contoh yang relevan dengan tugas dan perangkat, bila tersedia.
  Sebut aspek yang dipelajari, bukan menyalin seluruh shell dan susunannya.
- Susun prompt dengan tujuan pengguna, brief, rencana komposisi, contoh, lalu kontrak
  output dan batas wajib. Hindari pengulangan larangan estetika; instruksi format dan
  keamanan yang diperlukan model tetap disertakan.

---

## 6. State, aksesibilitas, dan data contoh (baru)

### 6.1 Pemilik perilaku

| Pemilik | Tanggung jawab |
|---|---|
| **Kit** (`ds-*` + component library) | Dialog/sheet: focus masuk, trap, Esc menutup, focus kembali ke pemicu. Tabs, menu, dan select bisa dipakai dengan keyboard. Focus ring terlihat. Label terhubung ke input. Pola tampilan error validasi (pesan di bawah field, ringkasan di atas form). Toast untuk respons aksi |
| **Screen** | Field apa saja, aturan validasi dan pesannya, urutan langkah, dan respons setelah aksi (`result` di plan) |

Pembagian ini ditulis di DESIGN.md (bagian **Perilaku komponen**) dan ikut dikirim
ke task generation.

### 6.2 Kebutuhan state terpisah dari jumlah frame

- Batas 2 state frame **hanya membatasi jumlah gambar contoh**.
- Setiap state yang relevan, misalnya gagal menyimpan atau izin ditolak, tetap
  dijelaskan di `states` plan: kapan terjadi dan apa responsnya.
- UI reference menampilkan state yang tidak digambar sebagai catatan di preview,
  di luar konten screen.

### 6.3 Warna diperiksa sesuai penggunaan

- `checkPalette` (§2.3) tetap berjalan saat design system disimpan.
- Render check juga mengukur kombinasi yang benar-benar dirender: setiap teks di
  atas latar hasil komposisinya (teks biasa 4.5, teks besar 3), serta indikator status
  (badge, trend, titik timeline) dengan minimum 3. Elemen disabled, skeleton, dan
  placeholder dikecualikan. Hasilnya menjadi `low-contrast` dan `low-contrast-control` (§5.2).
- Tepi field dan focus ring adalah milik kit (skin library), bukan screen. Keduanya
  tidak dinilai per screen, karena AI screen tidak bisa memperbaikinya; tanggung
  jawabnya ada di design system (§2.3, pasangan `borderStrong`).

### 6.4 Data sintetis

- Data contoh boleh dibuat, tetapi harus konsisten di semua screen.
- Total dan KPI harus bisa dihitung dari `records`, atau berasal dari `aggregates`
  yang menyatakan dasar perhitungannya, misalnya "1.240 pesanan bulan ini: agregat
  contoh untuk periode di `notes`".
- Tanggal mengikuti "hari ini" di `notes`.
- Growth %, peringkat, atau klaim yang tidak ada di requirements tetap dilarang.

### 6.5 Bukti visual berbeda dari bukti interaktif

- Preview statis membuktikan **tampilan**: layout, konten, kontras, dan overflow.
- Preview statis tidak membuktikan **perilaku**: focus, keyboard, validasi, submit,
  serta buka/tutup overlay. **Dialog yang sudah digambar belum tentu sudah berfungsi.**
- Setiap overlay, state, dan `result` di UI reference menjadi pemeriksaan perilaku
  di acceptance task, lalu diuji saat implementasi.

---

## 7. Ringkasnya

| Pertanyaan | Ditentukan oleh |
|---|---|
| Screen apa saja yang ada | Pekerjaan pengguna di requirements (terutama P0) + plan AI + jumlah dan arahan dari user |
| Apa yang wajib ada di screen | `key_elements` + `overlays` dari plan, ditandai dan dicek lint |
| State apa yang harus dijelaskan | `states` di plan (tidak dibatasi jumlah frame) |
| Data apa yang tampil | `sample_data` + `aggregates` (sama di semua screen) |
| Susunan layout | Pekerjaan pengguna, brief visual, dan hubungan konten; keputusan dicatat di `layout_note` |
| Bentuk dan isi shell | Konteks penggunaan + pilihan navigasi plan + utilitas yang didukung requirements |
| Tampilan (warna, font, radius, media) | Brief produk + design system (styled) atau wireframe (neutral), sesuai kemampuan renderer |
| Penegakan aturan | Sanitasi → lint + render check → maks satu repair → syarat approve |
| Kapan turunan STALE | Perubahan isi upstream terhadap versi yang tercatat dipakai |

**Fungsi dan data tetap konsisten; komposisi dapat menyesuaikan fidelity dan brief.
Keberhasilan desain dinilai dari hasil render, bukan hanya kepatuhan kelas CSS.**

---

## 8. Penerapan revisi 2026-10-01

Bagian ini menggantikan urutan pengerjaan revisi sebelumnya. Mengubah dokumen belum
mengubah prompt, schema, renderer, atau lint. Jangan menyebut hasil revisi sudah aktif
sebelum jalur tersebut diperiksa bersama.

### 8.1 Urutan pekerjaan

| Tahap | Perubahan | Bukti selesai |
|---|---|---|
| 1. Baseline dan brief | Pilih tiga screen dengan tugas berbeda dari proyek yang tersedia; simpan input, profil, ukuran, screenshot, dan temuan review §5.6. Tulis brief produk memakai konteks yang sudah ada | Ada pembanding yang bisa diulang dan sasaran perbaikan konkret |
| 2. Komposisi dan prompt | Ubah `UX_PLAN_SYSTEM_PROMPT`, `UX_SCREEN_RULES`, dan prompt edit: hapus kuota stat, header wajib, ikon wajib, dan resep tabel universal. Bawa brief serta `layout_note`; selaraskan lint/repair | Generate, redraw, dan edit tidak mengembalikan komposisi yang sah ke template lama |
| 3. Shell sesuai pekerjaan | Tambah varian shell yang diperlukan hasil baseline di plan, kontrak, dan `assembleScreen`; draft lama tetap memakai fallback yang terdokumentasi | Navigasi sesuai tugas, konsisten antar-screen, dan tidak digambar dua kali |
| 4. Tipografi dan media | Tambah hanya peran tipografi, font, serta jalur aset yang dibutuhkan brief. Selaraskan kit, sanitizer, CSP, dan pemeriksaan render | Font aktual dan aset tampil; fallback terlihat; tidak ada jalur URL bebas atau kontras yang diam-diam dilewati |
| 5. Evaluasi | Bandingkan screenshot dengan input dan profil yang sama. Periksa cakupan, blocker, kualitas visual, waktu, dan token | Masalah yang dituju membaik tanpa menghilangkan fungsi; optimasi token atau vision hanya ditambah jika masih diperlukan |

Tahap 2 dapat memakai shell yang ada untuk menguji komposisi isi halaman. Hasilnya
belum membuktikan masalah shell selesai. Tahap 3–4 dipilih berdasarkan kebutuhan
baseline, bukan kewajiban membangun seluruh variasi sekaligus.

### 8.2 Hal yang tidak perlu ditambah sejak awal

Role model baru, temperature lebih tinggi, generator per perangkat, panggilan terpisah
untuk setiap overlay, dan loop vision bukan syarat awal. Gunakan konfigurasi dan jalur
bersama yang sudah ada sampai evaluasi menunjukkan batasnya. Warna status di neutral
juga bukan pengganti perbaikan komposisi; label status tetap harus jelas tanpa warna.

### 8.3 Skenario verifikasi

| Skenario | Hasil yang diharapkan |
|---|---|
| Kasir restoran, jika sesuai requirements | Menu dan pesanan aktif dominan; tidak muncul empat KPI hanya karena tipe dashboard |
| Daftar dokumen dibanding katalog visual | Bentuk mengikuti cara mengenali atau membandingkan objek; tidak semuanya dipaksa menjadi tabel |
| Header menyatu dengan konten | Judul utama tetap jelas tanpa keharusan deskripsi dan aksi di kanan; tidak diperbaiki menjadi header seragam |
| Redraw dan AI edit | Brief dan konteks requirement tetap dibawa; kelengkapan dan hasil render diperiksa |
| Repair, perubahan font/shell, atau aset gagal | Konten wajib tidak hilang; pemeriksaan sesuai hasil final; fallback atau bagian yang belum diperiksa dinyatakan |

**Pemeriksaan regresi tetap berlaku:** sanitasi, label dan aksesibilitas, status/data
konsisten, cakupan P0, overlay wajib, konflik versi edit, undo/restore, dan STALE tidak
boleh melemah karena penambahan kebebasan visual.
