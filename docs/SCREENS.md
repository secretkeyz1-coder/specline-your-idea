# SDD Control Plane — Screen & UI Specification Catalog

> **Katalog 18 screen; jumlah `+page.svelte` diperiksa 2026-10-03.**
> Detail layout/komponen di bawah mencakup rekaman lama, bukan seluruhnya kode terkini. Gunakan [DESIGN.md](../DESIGN.md), AppSidebar dan route files untuk tampilan aktual; bukan sertifikat test baru.
> Dokumen ini membedah arsitektur antarmuka, route, data loader, form action, state machine, dan aturan konstitusi bisnis untuk setiap layar di `apps/web`. Agen perancang UI dapat menggunakan dokumen ini sebagai acuan tunggal (*single source of truth*) tanpa perlu membongkar seluruh backend.

---

## 1. Peta Navigasi & Information Architecture

Aplikasi ini dibagi menjadi **4 Zona Fungsional** dengan total **18 Screen Unik (`+page.svelte`)**:

```text
                                [ User / Operator ]
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
          [ Belum Sign In ]                           [ Sudah Sign In ]
                   │                                           │
          ┌────────┴────────┐                         ┌────────┴────────┐
          ▼                 ▼                         ▼                 ▼
     1. /login      2. /cli/authorize            3. / (Start)     Global Header
                                                      │     (Cmd+K Palette, tema terang/gelap)
                                                      ▼                 │
                                            4. /new/discovery/[id]      │
                                                      │                 │
                         ┌────────────────────────────┴─────────────────┤
                         ▼                                              ▼
              [ Project Workbench ]                            [ System & Fleet ]
              5. /projects/[id]/stack (Tech Stack)             13. /settings/ai
              6. /projects/[id] (Plan + Journey)               14. /machines
              7. /projects/[id]/docs (Specifications)
              8. /projects/[id]/tasks (Atomic Tasks Table)
              9. /projects/[id]/tasks/[taskId] (Work Order)
             10. /projects/[id]/board (Execution Kanban)
             11. /projects/[id]/bugs (Defect Tracker)
             12. /projects/[id]/convergence (Release check / Gate C18)
             15. /projects/[id]/design-system (Design System Editor, opsional)
             16. /projects/[id]/ux (UI Reference, opsional)
             17. /projects/[id]/docs/requirements/edit (Editor Requirements manual)
             18. /projects/[id]/docs/design/edit (Editor Technical Design manual)
```

Urutan journey (9 langkah, `apps/web/src/lib/journey.ts`): Discovery → Requirements → Stack → Technical design → **Design system (opsional)** → **UI reference (opsional)** → Tasks → Build → Release. Langkah opsional berlabel "optional", atau "skipped" bila task sudah dibuat tanpanya.

---

## 2. Global Shell & Komponen Persisten

Komponen-komponen ini membungkus dan melayani navigasi di seluruh layar:

### 2.1. Root Layout (`apps/web/src/routes/+layout.svelte` & `+layout.server.ts`)
* **Tanggung Jawab:** Memuat sesi operator (`user`), status bootstrap, daftar project aktif untuk command bar switcher, dan mengikat global keyboard listener (`Cmd+K` / `Ctrl+K`).
* **Data Load:**
  * `GET /api/v1/auth/status` ──► `{ authenticated: boolean, user: { id, email, display_name } | null }`
  * `GET /api/v1/projects?limit=50` ──► `{ projects: Array<{ id, key, name, lifecycleStatus }> }`
* **Elemen Render:** `<AppHeader />`, `<slot />` / `{@render children()}`, `<CommandPalette />`.

### 2.2. App Header (`apps/web/src/lib/components/AppHeader.svelte`)
* **Tinggi:** `44px` (sticky top, backdrop blur).
* **Fitur Utama:**
  * **Brand Mark:** Logo SDD Control Plane link ke `/`.
  * **Dynamic Breadcrumbs:**
    * Di Root: `SDD › Control Plane`
    * Di Project: `SDD › [PROJECT_KEY: Project Name] › [Active Section]`
    * Di Settings: `SDD › Settings › AI Routing`
    * Di Fleet: `SDD › System › Connected Machines`
  * **Command Search Trigger:** Tombol search bar (`Search or jump to... ⌘K`) membuka Command Palette.
  * **Operator Session Pill:** Indikator dot hijau (live), nama display operator, dan tombol Sign Out (`POST /logout`).
  * **Theme Toggle:** custom `forest` (dark, default) / `forest-light`, bukan mengikuti sistem. Sidebar menyimpan `sdd-theme`; `app.html` memetakan nama legacy sebelum first paint.

### 2.3. Project Navigation Bar (`apps/web/src/lib/components/ProjectNav.svelte`)
* **Tinggi:** `42px` (sticky di bawah AppHeader saat berada di rute `/projects/[projectId]/*`).
* **Navigasi 6 Tab:**
  1. `Plan` (`/projects/[projectId]`)
  2. `Docs` (`/projects/[projectId]/docs`)
  3. `Tasks` (`/projects/[projectId]/tasks`)
  4. `Board` (`/projects/[projectId]/board`)
  5. `Bugs` (`/projects/[projectId]/bugs`)
  6. `Convergence` (`/projects/[projectId]/convergence`)
* **Aturan UX:** Di mobile, bilah tab mendukung horizontal swipe/scroll mulus (`overflow-x-auto`) tanpa scrollbar yang merusak layout. Tab aktif memiliki underline accent indicator.
* Halaman Stack, Design system, UI reference, dan editor manual dihitung sebagai tab `Docs`.

### 2.3a. Next Step Bar (`apps/web/src/lib/components/NextStepBar.svelte`)
* Tampil di bawah tab project pada **setiap** halaman project: tepat **satu** langkah berikutnya (`Step n of 9`, judul, satu kalimat, satu tombol aksi, opsional satu aksi sekunder seperti "Skip — generate tasks" atau "Choose a design system first (optional)").
* Diturunkan dari state project yang nyata (bukan flag "seen"), sehingga tidak hilang saat reload. Jika user sudah berada di halaman tujuan, bar menyebut posisi saat ini alih-alih mengarahkan ke halaman yang sama.
* Langkah Release diturunkan dari verdict release check: gaps to fix / run the check / mark N complete.
* Di halaman Plan, komponen yang sama tampil sebagai panel penuh dengan `JourneyRail` (daisyUI `steps`).

### 2.4. Global Command Palette (`apps/web/src/lib/components/CommandPalette.svelte`)
* **Pemicu:** Shortcut keyboard `Cmd+K` (Mac) / `Ctrl+K` (Win/Linux) atau klik tombol search di header.
* **Fitur:**
  * Modal terpusat dengan backdrop blur (`bg-black/65 backdrop-blur-sm`).
  * Autocomplete pencarian instan dengan navigasi keyboard (`↑`, `↓`, `↵`, `Esc`).
  * Grouping hasil pencarian:
    * *Current Project Sections* (shortcut 1-huruf: `P` Plan, `D` Docs, `T` Tasks, `B` Board, `U` Bugs, `C` Convergence).
    * *Quick Actions* (New Project / Start Inception).
    * *System Navigation* (AI Routing, Connected Machines).
    * *Switch Project* (daftar lompat cepat ke semua project yang ada).
    * *Isi project aktif:* task, requirement, bug, dan screen UI reference (indeks ringkas dari `GET /api/palette/[projectId]`; satu sumber gagal tidak mengosongkan palette).

---

## 3. Katalog Detail 18 Screen

---

### SCREEN 01: Operator Login
* **Route:** `/login`
* **File Svelte:** `apps/web/src/routes/login/+page.svelte`
* **File Server:** `apps/web/src/routes/login/+page.server.ts`
* **Job to be Done:** Operator memasukkan kredensial untuk memperoleh session cookie HTTP-only (`sdd_session`), atau mendaftarkan akun operator pertama saat database kosong (*first-run bootstrap*).
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/auth/status`
  * Output ke UI: `{ needsBootstrap: boolean, authenticated: boolean }`
* **Form Action & Mutasi:**
  * Jika `needsBootstrap === true`:
    * Action: `POST ?/bootstrap`
    * Payload: `{ email, password, workspace }`
    * Endpoint API: `POST /api/v1/auth/bootstrap`
  * Jika akun sudah ada:
    * Action: `POST ?/login`
    * Payload: `{ email, password }`
    * Endpoint API: `POST /api/v1/auth/login`
* **Struktur Tampilan:**
  * Logo mark terpusat.
  * Kartu form login (Email address, Password, Workspace name opsional saat bootstrap).
  * Tombol submit utama `Sign In to Control Plane`.
  * Footer keterangan privasi (*Self-hosted instance — credentials stay local*).
* **Aturan Bisnis & Guardrails:**
  * Password wajib minimal 10 karakter dengan kombinasi angka dan huruf.
  * Jika sudah terautentikasi, otomatis redirect `303` ke `/`.

---

### SCREEN 02: CLI Device Authorization
* **Route:** `/cli/authorize` (URL parameter: `?code=XXXX-XXXX`)
* **File Svelte:** `apps/web/src/routes/cli/authorize/+page.svelte`
* **File Server:** `apps/web/src/routes/cli/authorize/+page.server.ts`
* **Job to be Done:** Developer menjalankan `sddctl login` di terminal lokal; browser membuka halaman ini untuk meminta user mengonfirmasi kode 8-karakter dan mengizinkan token akses CLI.
* **Data Load (`PageServerLoad`):**
  * Membaca query param `code`.
  * Memeriksa session: `{ code: string, authenticated: boolean }`.
* **Form Action & Mutasi:**
  * Action: `POST ?/approve`
    * Payload: `{ code }`
    * Endpoint API: `POST /api/v1/auth/cli/device/approve` ──► menerbitkan scoped PAT ke terminal.
  * Action: `POST ?/deny`
    * Payload: `{ code }`
    * Endpoint API: `POST /api/v1/auth/cli/device/deny` ──► menolak otorisasi.
* **Struktur Tampilan:**
  * Kartu dialog otorisasi perangkat.
  * Teks penjelasan scope token yang diminta (`project:read · task:read · task:execute · run:write · run:submit · bug:write`).
  * Display kode terminal besar dengan font monospace tracking lebar.
  * Dua tombol: `Authorize` (primary) dan `Deny` (ghost).
* **Aturan Bisnis:**
  * Jika user belum login, tampilkan instruksi *"Sign in first, then re-open link"* dengan tombol arahkan ke `/login`.

---

### SCREEN 03: Home & Inception Composer
* **Route:** `/`
* **File Svelte:** `apps/web/src/routes/+page.svelte`
* **File Server:** `apps/web/src/routes/+page.server.ts`
* **Job to be Done:** Halaman awal bagi user untuk mengetik ide software mentah dalam satu paragraf, memilih preset awal, dan memulai siklus *Specification-Driven Development*.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/projects` ──► `{ projects: Array<{ id, key, name, lifecycleStatus, updatedAt, progress: { tasks_total, tasks_done, tasks_started, features_total, features_complete } }> }`.
  * Label tahap di daftar project diturunkan dari hitungan nyata (`Building · x/y tasks`, `Release check · x/y verified`, `Complete`), bukan hanya dari lifecycle.
* **Form Action & Mutasi:**
  * Action: `POST ?/create`
  * Payload: `{ name: string, idea: string, constraints?: string }`
  * Endpoint API:
    1. `POST /api/v1/projects` ──► membuat project baru.
    2. `POST /api/v1/projects/:projectId/discovery-sessions` ──► memulai discovery session otomatis.
    3. Redirect `303` langsung ke `/new/discovery/:projectId`.
* **Struktur Tampilan:**
  * **Kolom Kiri (Hero & Philosophy):**
    * Badge `Specification-Driven Development`.
    * Headline value proposition.
    * 3 Kartu Tahapan: `01 Discover & Clarify`, `02 Define & Lock Baseline`, `03 Decompose & Execute`.
  * **Kolom Kanan (Inception Workbench):**
    * Kartu formulir `New Project Baseline`.
    * Tombol Quick Presets (`Field Ops Mobile`, `Event Streaming`, `Developer CLI`).
    * Input `Project name`, Textarea `High-level idea`, Textarea `Engineering constraints`.
    * Tombol Submit: `Create Baseline & Start Discovery`.
    * Kartu riwayat `Recent Projects` dengan status badge lifecycle.

---

### SCREEN 04: Adaptive Discovery Engine
* **Route:** `/projects/[projectId]/discovery`
* **File Svelte:** `apps/web/src/routes/new/discovery/[projectId]/+page.svelte`
* **File Server:** `apps/web/src/routes/new/discovery/[projectId]/+page.server.ts`
* **Job to be Done:** Engine mengajukan pertanyaan batch adaptif (5 per batch) untuk menggali batasan arsitektur, peran user, NFR, dan asumsi sebelum requirements disintesis.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/projects/:id`
  * `GET /api/v1/projects/:id/discovery` ──► `{ session, question, facts, assumptions, readiness, coverage, answered }`
* **Form Action & Mutasi:**
  * `POST ?/start` ──► Memulai sesi jika belum ada.
  * `POST ?/answerBatch` ──► Payload: `{ qid, answer, selected_options }` (menyimpan jawaban).
  * `POST ?/defer` ──► Payload: `{ qid, recommendation }` (skip atau gunakan asumsi default yang direkomendasikan sistem).
  * `POST ?/next` ──► Meminta batch 5 pertanyaan berikutnya.
  * `POST ?/acceptAssumptions` ──► Menyetujui semua asumsi `PROPOSED` menjadi `ACCEPTED`.
  * `POST ?/complete` ──► Menyelesaikan fase discovery dan redirect ke `/projects/:projectId/docs?tab=requirements&from=discovery`.
  * `POST ?/deepen` ──► Meminta pendalaman ekstra 5 pertanyaan.
* **Struktur Tampilan:**
  * **Header:** Progress Segment (`Discover` aktif), Nama Project, Ringkasan pemahaman saat ini (`session.understanding`).
  * **Kolom Kiri (Question Stage):**
    * Stepper indikator: `Question X · Y queued · answered Z`.
    * Kartu Pertanyaan Fokus: Topic chip, critical blocker badge, teks pertanyaan, alasan pertanyaan diajukan.
    * Input respons teks + Quick option suggestions.
    * Tombol fallback: `I don't know — recommend` dan `Skip / use assumption`.
    * Tombol Submit Answer + tombol `Enough questions — proceed` saat ≥5 pertanyaan terjawab.
    * Riwayat jawaban sebelumnya (*Prior Answers History*).
  * **Kolom Kanan (Copilot Rail):**
    * Kartu `Understood Facts` (fakta yang berhasil diekstrak dengan indikator user-stated vs AI-derived).
    * Kartu `Architecture Coverage` (10 topik: problem, users, workflows, roles, platform, data, integrations, NFR, deployment).
    * Kartu `Working Assumptions` (daftar asumsi terbuka dan dampaknya).

---

### SCREEN 05: Tech Stack Decision Baseline
* **Route:** `/projects/[projectId]/stack`
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/stack/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/stack/+page.server.ts`
* **Job to be Done:** Mengunci baseline teknologi resmi proyek (Frontend, Backend, ORM, Database, Deployment) secara eksplisit sebelum masuk ke desain teknis. Mengubah stack menandai design, tasks, UI reference, dan design system sebagai stale.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/projects/:id`, `GET /api/v1/projects/:id/requirements`, `GET /api/v1/projects/:id/discovery`, `GET /api/v1/projects/:id/ai-role-bindings`, `GET /api/v1/projects/:id/artifacts/stack`.
* **Form Action & Mutasi:**
  * `POST ?/recommend` ──► Memicu AI Architecture role untuk menyintesis opsi kandidat stack berdasarkan requirements yang telah disetujui.
  * `POST ?/approve` ──► Payload: `{ components: JSON.stringify(...) }`. Mengunci stack menjadi artefak revisi (*immutable baseline*).
* **Struktur Tampilan:**
  * Header fase: `Define` aktif.
  * **Segmented Mode Selector:** `AI Recommendation` vs `Custom / Manual`.
  * **Mode Rekomendasi:** Kartu sintesis arsitektur dengan kandidat pilihan, keunggulan, dan trade-off analisa.
  * **Mode Manual:** Tabel baris per-layer (Frontend, Backend, Database, dll) dengan opsi checkbox `lock` dan tombol 1-layer AI assist.
  * **Warning Box:** Peringatan kompatibilitas jika terdeteksi konflik stack.
  * Tombol `Approve & Lock Stack` (menghasilkan baseline v1 resmi).

---

### SCREEN 06: Project Plan Map & Scope Intent
* **Route:** `/projects/[projectId]`
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/+page.server.ts`
* **Job to be Done:** Tampilan beranda sebuah project untuk melihat ikhtisar cakupan fitur (*Traceable Plan Map*), status siklus hidup, dan petunjuk langkah selanjutnya.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/projects/:id`
  * `GET /api/v1/projects/:id/requirements`
  * `GET /api/v1/projects/:id/features/release-status` (verdict release check per fitur dalam satu panggilan)
  * `GET /api/v1/projects/:id/tasks?limit=200`
* **Form Action & Mutasi:**
  * `POST ?/generateDesign` ──► `POST /api/v1/projects/:id/design/generate`.
  * `POST ?/generateTasks` ──► `POST /api/v1/projects/:id/tasks/generate`.
* **Struktur Tampilan:**
  * **Project Intent Card:** Judul proyek, deskripsi ruang lingkup, tags batasan teknis, tombol pintas ke `Specs & Docs` dan `Tasks (N)`.
  * **Journey Panel:** `NextStepBar` varian panel + `JourneyRail` 9 langkah (lihat §2.3a); aksi generate design/tasks dijalankan langsung dari panel dengan `AiProgress`.
  * **Traceable Plan Map:** Grid visual yang memetakan *Requirements* di sisi kiri ke seluruh *Feature Capabilities* di sisi kanan lengkap dengan counter penyelesaian (`done / total`).

---

### SCREEN 07: Specifications & Document Workspace
* **Route:** `/projects/[projectId]/docs` (URL parameter: `?tab=requirements|stack|design|system|ux`)
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/docs/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/docs/+page.server.ts`
* **Job to be Done:** Membaca naskah spesifikasi lengkap (Requirements PRD, Stack Baseline, Technical Architecture Design, Design system, UI reference), melakukan perbaikan prompt AI (*Refine*), dan memberikan persetujuan formal (*Approve Baseline*).
* **Data Load (`PageServerLoad`):**
  * Memuat tab aktif via query string. 5 tab berbasis link (URL = state): `Requirements` · `Tech stack` · `Technical design` · `Design system` · `UI reference`.
  * Mengambil data revisi dan acceptance criteria terkait (`/requirements`, `/artifacts/stack`, `/artifacts/design`, `/ux`, `/design-system`).
  * Tab Design system merender preview via `POST /api/v1/design-systems/preview` (mode light).
  * `GET /api/v1/projects/:id/ai-role-bindings` (status model AI yang terikat).
  * Tanpa model AI, tab Requirements dan Technical design mengarahkan ke editor manual (Screen 17 dan 18).
* **Form Action & Mutasi:**
  * `POST ?/generateRequirements` ──► Menghasilkan draf spesifikasi kebutuhan pertama dari fakta discovery.
  * `POST ?/refineRequirements` ──► Payload: `{ instructions }` (instruksi perbaikan ke AI untuk membuat revisi baru).
  * `POST ?/approveRevision` ──► Payload: `{ revisionId }` (menyetujui revisi menjadi baseline permanen).
* **Struktur Tampilan:**
  * **Document Switcher:** Tab berversi (`Requirements v1`, `Tech Stack v2`, `Technical Design v1`).
  * **Action Bar:** Status baseline badge (`✓ Approved Baseline v1`), form input inline AI Refine, tombol Approve.
  * **Layout Artikel Notion/Linear:** Konten markdown diparsing elegan di panel tengah.
  * **Sticky Criteria Index Rail (Khusus Requirements):** Panel samping berisi daftar seluruh Acceptance Criteria lengkap dengan fitur filter/search cepat.
  * **Revision History:** Garis waktu riwayat versi terdahulu dengan status dan tanggal persetujuan.
  * **Footer:** Status AI Role Routing efektif.

---

### SCREEN 08: Atomic Tasks Planning Table
* **Route:** `/projects/[projectId]/tasks`
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/tasks/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/tasks/+page.server.ts`
* **Job to be Done:** Mengelola daftar seluruh task atomik: memeriksa kesehatan grafik ketergantungan (DAG acyclic), memfilter task, meninjau pemblokir dependensi, mengedit draf, memecah task (*split*), dan menyetujui draf task menjadi `READY`.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/projects/:id/tasks?limit=200`
  * `GET /api/v1/projects/:id/task-graph/validate` ──► `{ acyclic: boolean, cycle?: string[] }`
* **Form Action & Mutasi:**
  * `POST ?/generate` ──► Memecah dokumen technical design menjadi task-task atomik.
  * `POST ?/regenerate` ──► Men-generate ulang seluruh rencana task.
  * `POST ?/ready` ──► Payload: `{ taskId }` (memicu pemeriksaan kesiapan C9 dan mengubah `DRAFT` ──► `READY`).
  * `POST ?/edit` ──► Payload: `{ taskId, title, objective }` (mengubah draf task).
  * `POST ?/split` ──► Payload: `{ taskId, part_title, part_objective, part_ac }` (memecah satu task besar menjadi 2-3 task kecil).
* **Struktur Tampilan:**
  * **Command Bar:** Counter status (`X draft · Y active · Z completed`), tombol `Graph Health`, `Decompose Tasks`, dan `Regenerate`.
  * **Toolbar Filter Cepat:**
    * Kolom pencarian instan (title, key, type, priority).
    * Filter chips status: `all`, `draft`, `ready`, `running`, `needs review`, `done`.
    * Dropdown tipe task & toggle sortir `Asc`/`Desc`.
  * **High-Density Table:**
    * Kolom: `Key | Task Title & Blockers | Status | Hardness | Action`.
    * **Inline Blocker Badge:** Task yang belum bisa di-ready karena dependensinya belum selesai langsung menampilkan tag peringatan kuning (mis. `Waiting on TASK-001 (READY)`).
    * Laci inline untuk aksi *Edit* dan *Split*.
  * **Banner Graph Cycle:** Peringatan merah jika terdeteksi circular dependency antar task.

---

### SCREEN 09: Agent Work Order Workbench
* **Route:** `/projects/[projectId]/tasks/[taskId]`
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/tasks/[taskId]/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/tasks/[taskId]/+page.server.ts`
* **Job to be Done:** **Layar paling kritikal dalam siklus eksekusi agen.** Tempat manusia memeriksa kontrak task yang tidak dapat diubah (*immutable contract*), menyalin prompt instruksi agen, melihat bukti eksekusi dan log tes otomatis, serta memberikan keputusan review.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/tasks/:taskId` ──► task detail, dependencies, dependents, traceability.
  * `GET /api/v1/tasks/:taskId/runs` ──► riwayat eksekusi, attempt, status run, commit SHA, dan hasil tes.
  * `GET /api/v1/tasks/:taskId/events` ──► timeline log aktivitas task.
  * `GET /api/v1/tasks/:taskId/reviews` ──► keputusan review sebelumnya.
* **Form Action & Mutasi:**
  * `POST ?/prompt` ──► Payload: `{ taskId, mode: 'STANDALONE' | 'CONNECTED_CLI' | 'CONNECTED_MCP' }` (menghasilkan prompt prompt khusus agen).
  * `POST ?/manualRun` ──► Payload: `{ taskId, summary, commit }` (mencatat hasil kerja jika dikerjakan manual/eksternal).
  * `POST ?/review` ──► Payload: `{ taskId, decision: 'APPROVED' | 'CHANGES_REQUESTED', findings }` (memberikan keputusan review manusia).
  * `POST ?/requeue` ──► Payload: `{ taskId }` (mengembalikan task ke status `READY` setelah perbaikan diminta).
  * `POST ?/createBug` ──► Payload: `{ taskId, title, severity, current, expected, unchanged, reproduction }` (mencatat defect langsung terkait task ini).
* **Struktur Tampilan (2-Pane Workbench):**
  * **Header:** Tombol kembali `< All Tasks`, Key badge, Status badge, Hardness, dan Tipe task. Judul besar & deskripsi objektif yang mengikat batasan hasil kerja.
  * **Pane Kiri (60% — Kontrak Spesifikasi):**
    * *Acceptance Criteria:* Butir-butir syarat keberhasilan.
    * *Scope Boundaries:* Box kontras tinggi memisahkan *Expected Paths* (hijau) vs *Forbidden Paths* (merah).
    * *Required Verification:* Terminal code boxes perintah pengujian otomatis (mis. `$ bun test ...`).
    * *Stop Conditions:* Daftar kondisi di mana agen diwajibkan berhenti dan melapor blocker.
  * **Pane Kanan (40% — Drawer Eksekusi & Stasiun Review):**
    * *Stasiun Review Gate (muncul mencolok jika status `NEEDS_REVIEW`):* Tombol hijau *Approve — Task Complete* atau formulir merah *Request Changes* dengan rincian temuan defect.
    * *Tabbed Drawer:*
      * **Tab 1: Prompt Dispatch:** 3 Tombol salin prompt (`Standalone`, `Connected CLI`, `MCP Agent`) + form manual run.
      * **Tab 2: Runs & Evidence:** Riwayat attempt agen, commit SHA, summary, dan status setiap perintah tes (`PASSED` / `FAILED`).
      * **Tab 3: Traceability:** Kaitan ke Requirement induk, kriteria penerimaan, dan dependensi hulu/hilir.

---

### SCREEN 10: Execution Kanban Board
* **Route:** `/projects/[projectId]/board`
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/board/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/board/+page.server.ts`
* **Job to be Done:** Memantau pergerakan eksekusi agen secara visual di sepanjang mesin status resmi: `Ready ──► Claimed ──► Running ──► Testing ──► Review ──► Done`.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/projects/:id/tasks?limit=200`
  * Berlangganan SSE real-time: `EventSource('/api/events/:projectId')` untuk invalidasi otomatis saat ada event eksekusi agen.
* **Struktur Tampilan:**
  * **Header:** Judul board, counter task aktif, input filter pencarian kartu, filter dropdown tipe task, dan indikator koneksi real-time `Live Sync Active` (pulse hijau).
  * **Kanban Columns (Kolom Horizontal):**
    * Kolom: `Ready`, `Claimed`, `Running`, `Testing`, `Review`, `Done`.
    * Setiap kolom memiliki header status badge dan penghitung jumlah task.
    * Kartu task berisi: Key tebal, badge prioritas (P0 merah), judul task 2-baris, modul/tipe, dan meteran hardness 5-titik.
    * Klik kartu langsung menuju ke Work Order workbench task tersebut.

---

### SCREEN 11: Bug & Defect Tracker
* **Route:** `/projects/[projectId]/bugs`
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/bugs/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/bugs/+page.server.ts`
* **Job to be Done:** Mencatat defect sebagai entitas independen (bukan sekadar status task) dengan format terstruktur **Behavior Triplet** dan men-generate task perbaikan otomatis (*fix task*).
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/projects/:id/bugs` ──► `{ bugs: Array<BugRow> }`
* **Form Action & Mutasi:**
  * `POST ?/create` ──► Payload: `{ title, severity, current, expected, unchanged, reproduction }` (mencatat bug baru).
  * `POST ?/confirm` ──► Payload: `{ bugId }` (mengonfirmasi validitas bug).
  * `POST ?/generateFixTask` ──► Payload: `{ bugId }` (memicu pembuatan task baru berlabel perbaikan bug).
* **Struktur Tampilan:**
  * **Header:** Judul, counter total bug, dan badge jumlah bug yang memblokir rilis C18 (*X blocking release*).
  * **Tombol Aksi:** `+ Report Defect` (membuka modal slide-over pelaporan terpusat).
  * **Filter Status Bar:** `all`, `open`, `reported`, `confirmed`, `planned`, `resolved`.
  * **Daftar Bug Padat:**
    * Tiap baris menampilkan: Key bug, Status pill, Severity badge (BLOCKER merah, MAJOR kuning), link fix task jika sudah dibuat, dan tombol aksi langsung (*Confirm* atau *Generate Fix Task*).
    * Tombol *Details* untuk ekspansi akordeon melihat isi *Behavior Triplet* (Current, Expected, Unchanged, Reproduction).
  * **Modal Pelaporan Defect:** Modal pop-up berlatar blur dengan formulir Behavior Triplet lengkap dan validasi field.

---

### SCREEN 12: Feature Convergence Gate (C18)
* **Route:** `/projects/[projectId]/convergence`
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/convergence/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/convergence/+page.server.ts`
* **Job to be Done:** **Gerbang Konstitusi C18.** Memverifikasi rekonsiliasi antara implementasi aktual yang telah diserahkan agen dengan spesifikasi yang telah disetujui, serta mengunci fitur menjadi `COMPLETE`.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/projects/:id/features`
  * Untuk tiap fitur:
    * `GET /api/v1/features/:id/convergence-runs` (riwayat audit).
    * `GET /api/v1/features/:id/completion-gate` ──► `{ canComplete: boolean, blockers: { open_blocking_findings, blocking_bugs, incomplete_tasks, convergence_recommended } }`
* **Form Action & Mutasi:**
  * `POST ?/run` ──► Payload: `{ featureId }` (memicu AI Convergence Analyser mengaudit kode/bukti terhadap requirement).
  * `POST ?/complete` ──► Payload: `{ featureId }` (mengubah status fitur menjadi `COMPLETE` jika gerbang C18 lolos).
  * `POST ?/generateTask` ──► Payload: `{ findingId }` (membuat task perbaikan otomatis dari temuan discrepancy).
* **Urutan Fitur:** Pekerjaan lebih dulu — *Gaps to fix*, lalu *Ready to complete*, lalu *not checked yet*. Fitur yang sudah `COMPLETE` dilipat menjadi satu baris (kecuali yang baru diselesaikan pada kunjungan ini). Setiap fitur dinilai terhadap requirement yang tertaut padanya sendiri.
* **Struktur Tampilan:**
  * **Top Convergence HUD:** Indikator penyelesaian fitur global (`X/Y Complete`) dan jumlah total blocker gerbang (`X Gate Blockers`).
  * **Kartu Audit per Fitur:**
    * Header fitur dengan status lifecycle dan tombol aksi (*Complete Feature* hijau jika lolos, atau *Run Convergence Audit* jika belum).
    * **3 Pilar Blocker Gerbang C18:**
      1. *Blocking Findings:* Temuan spesifikasi AI yang belum beres.
      2. *Blocking Bugs:* Bug aktif berkategori BLOCKER.
      3. *Incomplete Tasks:* Task fitur yang belum mencapai status `DONE`.
    * **Daftar Temuan Audit:** Hasil audit AI berlabel `MISSING` atau `PARTIAL` dengan referensi requirement dan tombol 1-klik *Generate Fix Task*.

---

### SCREEN 13: AI Provider & Model Routing
* **Route:** `/settings/ai`
* **File Svelte:** `apps/web/src/routes/settings/ai/+page.svelte`
* **File Server:** `apps/web/src/routes/settings/ai/+page.server.ts`
* **Job to be Done:** Mengelola kredensial provider AI (BYO API Key), membuat profil model (mis. Claude 3.7 untuk Planning, GLM untuk Fast Tasks), dan memetakan model ke 6 role arsitektur sistem.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/workspaces/:id/ai/providers` ──► daftar koneksi tersimpan (kredensial di-redact).
  * `GET /api/v1/workspaces/:id/ai/profiles` ──► profil konfigurasi model.
  * `GET /api/v1/workspaces/:id/ai-role-bindings` ──► pemetaan role aktif.
  * `GET /api/v1/ai/cli` ──► di mana CLI lokal bisa berjalan (server bila diaktifkan + mesin milik user dengan status online dan CLI yang dilaporkan).
* **Form Action & Mutasi:**
  * `POST ?/createProvider` ──► Payload: `{ name, provider_type, base_url, credential }` (disimpan terenkripsi AES-256-GCM). Untuk `LOCAL_CLI`, `base_url` = `cli://server/<claude|codex>` atau `cli://machine/<id>/<claude|codex>` dan tidak ada kredensial.
  * `POST ?/fetchModels` / `POST ?/previewModels` ──► daftar model (untuk `LOCAL_CLI`: alias `default`, dan `sonnet`/`opus`/`haiku` untuk Claude Code).
  * `POST ?/testProvider` ──► Payload: `{ providerId, model_id }` (menguji koneksi dan latensi endpoint).
  * `POST ?/createProfile` ──► Payload: `{ name, provider_connection_id, model_id }`.
  * `POST ?/bindRole` ──► Payload: `{ role, ai_profile_id }` (mengikat role ke profil tertentu).
* **Struktur Tampilan:**
  * **Diagram Alur 3-Langkah:** `1. Connections ──► 2. Profiles ──► 3. Role Bindings`.
  * **Seksi 1 (Provider Connections):** Daftar koneksi tersimpan dengan field uji probe instan (`Test Probe`) + formulir penambahan koneksi (OpenAI, Anthropic, Gemini, OpenAI-compatible, Custom HTTP, **Local CLI (Claude Code / Codex)**).
    * Opsi *Local CLI*: pilih CLI dan tempat berjalannya — *This server* (nonaktif dengan penjelasan bila operator belum men-set `SDD_ENABLE_LOCAL_CLI=true`) atau salah satu mesin milik user, lengkap dengan status online / terpasang / sudah sign-in. Tidak ada key yang disimpan; CLI memakai login-nya sendiri. Hanya pemilik mesin yang boleh membuat koneksi ke mesinnya. Timeout default 15 menit (maks 30 menit).
  * **Seksi 2 (AI Profiles):** Daftar profil model yang sudah dibuat + formulir pembuatan profil.
  * **Seksi 3 (Role Routing):** Tabel pemetaan 6 peran arsitektur:
    1. *Discovery* (formulasi pertanyaan adaptif)
    2. *Specification* (penyusunan PRD & kriteria penerimaan)
    3. *Architecture* (evaluasi teknologi & desain sistem)
    4. *Task Decomposition* (pemecahan task atomik)
    5. *Review* (pemeriksaan hasil kerja & defect)
    6. *Convergence* (rekonsiliasi spesifikasi gerbang C18)
  * Keterangan jaminan C21: Sistem tetap dapat berjalan tanpa konfigurasi AI berkat fallback deterministik.

---

### SCREEN 14: Connected Machine Fleet Monitor
* **Route:** `/machines`
* **File Svelte:** `apps/web/src/routes/machines/+page.svelte`
* **File Server:** `apps/web/src/routes/machines/+page.server.ts`
* **Job to be Done:** Memantau armada agen/daemon lokal (`sddctl` atau `sdd-agent`) yang terhubung via WebSocket keluar (*outbound-only*), serta menyediakan panduan perintah instalasi terminal lokal.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/machines` ──► `{ machines: Array<MachineRow> }`.
* **Struktur Tampilan:**
  * **Header:** Judul armada, badge counter `X online / Y total`, dan status live radar (`Fleet Reachable` / `No Active Nodes`).
  * **Tabel Pemantauan Mesin:**
    * Kolom: `Machine Name` (dengan icon laptop/server), `Platform` (OS target), `Status` (badge live dot hijau `ONLINE` atau abu `OFFLINE`), dan `Last Ping`.
  * **Local Machine Onboarding Guide:**
    * 4 Kartu langkah terminal lengkap dengan tombol satu-klik salin (*Copy*):
      1. `$ bun run --filter @sdd/cli build` (Install CLI)
      2. `$ sddctl login` (Otorisasi sesi)
      3. `$ sddctl project link <key>` (Tautkan direktori kerja)
      4. `$ sdd-agent connect` (Hubungkan daemon otomatis)

---

### SCREEN 15: Design System Editor (opsional)
* **Route:** `/projects/[projectId]/design-system`
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/design-system/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/design-system/+page.server.ts`
* **Job to be Done:** Menentukan tampilan aplikasi yang akan dibangun (token warna semantik light + dark, font, radius, density, depth, border width) dan component library-nya, setelah stack dikunci. Tanpa panggilan AI.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/design-systems/catalog` ──► `{ presets, libraries }` (14 preset generik, semuanya lolos WCAG AA di light dan dark).
  * `GET /api/v1/projects/:id/design-system` ──► `{ stack_approved, suggestions, approved, draft, stale }`.
* **Form Action & Mutasi:**
  * Preview langsung (tanpa menyimpan): `POST /api/v1/design-systems/preview` ──► `{ html, contrast }` setiap kali nilai berubah.
  * `POST ?/save` ──► `POST /api/v1/projects/:id/design-system` `{ spec }` (draft; ditolak bila ada pasangan kontras yang gagal).
  * `POST ?/approve` ──► `POST /api/v1/artifact-revisions/:revisionId/approve`.
* **Struktur Tampilan:**
  * `1. Starting style` — galeri preset.
  * `2. Component library` — pemilih library (shadcn/ui, daisyUI, Bootstrap 5.3, Material UI/Material 3, Ant Design, Flowbite, Pico CSS, tanpa library) dengan badge *Recommended for your stack*.
  * `3. Adjust` — brand colour, pasangan font, radius, density (segmented `join`), depth, border width.
  * Panel preview (toggle Light/Dark dan lebar) + laporan kontras (12 pasangan per mode).
  * Panel *What the coding agent gets* (file `docs/design-system/` dari `sddctl ui pull`).
  * Tombol `Save draft` lalu `Approve design system`.
* **Aturan Bisnis:** Membutuhkan stack yang sudah disetujui (`STACK_NOT_APPROVED`). Perubahan stack menandai design system stale; perubahan design system hanya menandai stale UI reference yang digambar *styled*.

---

### SCREEN 16: UI Reference (opsional)
* **Route:** `/projects/[projectId]/ux`
* **File Svelte:** `apps/web/src/routes/projects/[projectId]/ux/+page.svelte`
* **File Server:** `apps/web/src/routes/projects/[projectId]/ux/+page.server.ts`
* **Job to be Done:** Membuat mockup HTML untuk screen-screen kunci produk (satu panggilan AI per screen) sebagai acuan layout untuk task dan agen.
* **Data Load (`PageServerLoad`):**
  * `GET /api/v1/projects/:id`, `GET /api/v1/projects/:id/ux`, `GET /api/v1/projects/:id/ai-role-bindings`, `GET /api/v1/projects/:id/design-system`.
* **Form Action & Mutasi:**
  * `POST ?/plan` ──► `POST /api/v1/projects/:id/ux/plan` `{ mode, screen_count?, guidance?, fidelity? }`.
  * `POST ?/addScreen` ──► `POST /api/v1/projects/:id/ux/screens` `{ name, purpose, key_elements, requirement_keys }`.
  * `POST ?/removeScreen` ──► `DELETE /api/v1/projects/:id/ux/screens/:key` (screen terakhir tidak bisa dihapus).
  * Menggambar / menggambar ulang screen ──► `POST /api/v1/projects/:id/ux/screens/:key/generate` `{ instruction? }`.
  * `POST ?/approve` ──► `POST /api/v1/artifact-revisions/:revisionId/approve`.
* **Struktur Tampilan:**
  * *How should the screens look?* — `Neutral mid-fidelity` (abu-abu, fokus pada layout dan alur) atau `With the design system` (warna, tipe, dan komponen nyata; nonaktif sampai design system disetujui, terpilih otomatis bila sudah ada).
  * *How many screens?* — `Let the AI recommend` (AI menyebut jumlah dan alasannya) atau `Set the number myself` (1–12, tidak pernah dilampaui).
  * Textarea guidance opsional (maks 1.000 karakter).
  * Daftar screen draft: status *Not drawn yet / Drawing… / Drawn / Failed*, `Draw all screens`, `Add screen`, `Remove screen` (dengan konfirmasi), instruksi perubahan per screen.
  * Badge fidelity (`Neutral` atau `Design system vN`), jumlah yang diminta/direkomendasikan beserta alasannya, dan guidance user.

---

### SCREEN 17: Editor Requirements Manual
* **Route:** `/projects/[projectId]/docs/requirements/edit`
* **File Svelte / Server:** `apps/web/src/routes/projects/[projectId]/docs/requirements/edit/+page.svelte` / `+page.server.ts`
* **Job to be Done:** Menulis requirements tanpa model AI; hasilnya draft revisi yang direview dan di-approve persis seperti hasil generate.
* **Form Action:** `POST ?/save` ──► `POST /api/v1/projects/:id/artifacts/requirements/edit` `{ structured }`, lalu redirect ke `docs?tab=requirements&saved=1`.
* **Struktur Tampilan:** Summary, *Who uses it* (actors), *Functional requirements* (tiap requirement dengan acceptance criteria), *Quality needs* (NFR), workflows, *Scope notes*; tombol `Save draft` tetap terjangkau pada form panjang.

---

### SCREEN 18: Editor Technical Design Manual
* **Route:** `/projects/[projectId]/docs/design/edit`
* **File Svelte / Server:** `apps/web/src/routes/projects/[projectId]/docs/design/edit/+page.svelte` / `+page.server.ts`
* **Job to be Done:** Menulis technical design tanpa model AI (atau lewat aksi sekunder *Write it yourself*).
* **Form Action:** `POST ?/save` ──► `POST /api/v1/projects/:id/design/edit` `{ structured }`, lalu redirect ke `docs?tab=design&saved=1`. Requirement coverage diperiksa saat menyimpan.
* **Struktur Tampilan:** Overview, Architecture, Components (nama + tanggung jawab), seksi desain lainnya (sebagian opsional), *Open decisions* (opsional); tombol `Save draft`.

---

## 4. Panduan Aturan Desain & Konstitusi untuk Redesign Agent

Jika agen lain melakukan redesign total terhadap antarmuka ini, agen tersebut **WAJIB** mematuhi batasan konstitusi berikut:

1. **No Upsell / Monetization Controls (C23):** Aplikasi ini adalah open-source developer tool murni. Jangan pernah menambahkan badge "Pro", tombol "Upgrade Plan", banner harga, atau kuota token berbayar di layar mana pun.
2. **Implementer Cannot Self-Approve (C15):** Di layar Work Order (`/tasks/[taskId]`), agen eksekutor tidak boleh menyetujui pekerjaannya sendiri secara sepihak. Review selalu membutuhkan persetujuan manusia (siapa pun anggota workspace, termasuk yang menjalankan task — tanpa role reviewer) atau kebijakan verifikasi server.
3. **Traceability Upward & Downward (C1/C2):** Setiap task harus menautkan requirement induk, dan setiap pengajuan review membutuhkan bukti eksekusi perintah tes (`evidence: test_result`). Jangan hilangkan seksi Acceptance Criteria atau Verification Command.
4. **Bugs are Entities, Not Statuses (C4):** Defect tidak boleh disederhanakan menjadi sekadar label status "Bug" pada task. Defect adalah entitas independen yang memiliki *Behavior Triplet* (Current, Expected, Unchanged) dan menghasilkan task perbaikan baru.
5. **Convergence Gate (C18):** Fitur tidak boleh di-mark `COMPLETE` secara manual jika masih ada blocking finding, blocking bug, atau incomplete task.
6. **One Decision at a Time (UX Spec):** Pada fase Discovery, pertahankan pola interaksi 1 pertanyaan per layar agar user tidak kewalahan dengan kuesioner panjang sekaligus.
7. **Accessibility & WCAG AA:** Seluruh kombinasi warna teks dan surface wajib mempertahankan kontras rasio minimal **4.5:1** (AA standard). Jangan gunakan warna saja untuk menyampaikan status sistem (selalu sertakan label teks atau icon deskriptif).

---

## 5. Ringkasan Token Desain Aktif (`apps/web/src/app.css` — daisyUI 5, light + dark)

UI terkini memakai daisyUI 5 dengan custom `forest` (dark, default) dan
`forest-light`; built-in themes dinonaktifkan. `line` / `line-control` untuk
border, primary hijau dengan teks hitam, `primary-ink` untuk teks hijau.
Komponen memakai daisyUI, native dialog/popover API dan native select,
bukan helper panel / bits-ui lama. Rekaman aktual: [DESIGN.md](../DESIGN.md);
token authority: `apps/web/src/app.css`. Bagian shell lama di atas bersifat
historis: navigasi sekarang AppSidebar dan journey sembilan chapter.

Nilai di bawah ini adalah **palet awal (light monochrome) sebelum migrasi ke daisyUI** dan hanya dipertahankan sebagai referensi historis; nilai aktual berasal dari tema daisyUI:

```css
/* Ground & Surfaces (Light Monochrome Stack) */
--color-ground: #f9fafb;          /* Latar belakang kanvas (gray-50) */
--color-surface: #ffffff;         /* Kartu utama / panel (white) */
--color-surface-2: #f9fafb;       /* Kontainer tombol, header tabel */
--color-surface-3: #f3f4f6;       /* Area input teks, terminal code box (gray-100) */
--color-surface-hover: #f3f4f6;   /* Hover state elemen interaktif */
--color-surface-selected: #e5e7eb;/* Elemen aktif terpilih (gray-200) */
--color-line: #e5e7eb;            /* Border hairline tipis (gray-200) */
--color-line-strong: #d1d5db;     /* Border aksen tegas (gray-300) */

/* Typography (Geist & Fira Code) */
--color-text-primary: #111827;    /* Teks judul & label utama (17.7:1 AA) */
--color-text-muted: #4b5563;      /* Deskripsi & paragraf (7.5:1 AA) */
--color-text-faint: #6b7280;      /* Metrik sekunder & footnote (4.8:1 AA) */
--font-sans: "Geist Variable", Geist, sans-serif;
--font-mono: "Fira Code Variable", "Fira Code", monospace;

/* Interactive Monochrome Accent */
--color-primary: #000000;         /* Aksen teks & ikon (21:1 AA) */
--color-primary-base: #000000;    /* Warna solid tombol submit (21:1 AA dengan teks putih) */
--color-primary-hover: #1f2937;
--color-primary-soft: rgba(0, 0, 0, 0.05);

/* Semantic Status (WCAG AA Compliant) */
--color-mint: #15803d;            /* Ready, Done, Passed (green-700, 5.02:1 AA) */
--color-mint-soft: #f0fdf4;       /* Background badge hijau lembut */
--color-warn: #b45309;            /* Blocked, Warning, Needs Review (amber-700, 5.02:1 AA) */
--color-warn-soft: #fffbeb;       /* Background badge amber lembut */
--color-danger: #dc2626;          /* Error, Blocker, Failed (red-600, 4.83:1 AA) */
--color-danger-soft: #fef2f2;     /* Background badge merah lembut */
--color-info: #2563eb;            /* Parallel safe, Informational (blue-600, 5.17:1 AA) */
--color-info-soft: #eff6ff;       /* Background badge biru lembut */
--color-violet: #7c3aed;          /* Tags fitur, AI Profiles (violet-600, 5.70:1 AA) */
--color-violet-soft: #f5f3ff;     /* Background badge violet lembut */
```
