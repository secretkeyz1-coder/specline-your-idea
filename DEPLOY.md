# Panduan Deploy VPS — Agentic SDD Control Plane

Deploy berbasis **Docker Compose**: 4 kontainer (PostgreSQL 16, API, Web, Caddy
sebagai reverse proxy + TLS otomatis). Panduan ini untuk VPS Linux bersih dengan
Docker terpasang.

> Konfigurasi dicocokkan pada 2026-10-03; bukan hasil deploy/test baru. [Navigasi](docs/README.md).

## 0. Prasyarat di VPS

```bash
# Docker Engine + plugin compose (jika belum ada):
curl -fsSL https://get.docker.com | sh

# Firewall: untuk sekarang HANYA SSH. Port web baru dibuka di langkah 6,
# setelah akun operator dibuat (lihat alasannya di langkah 5).
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw enable
# Batasi 80/443 di firewall provider/security group sampai bootstrap selesai.
# UFW saja tidak menahan published port Docker.
```

> Docker menulis aturan iptables sendiri dan bisa melewati ufw untuk port yang
> dipublikasikan. Di stack ini hanya Caddy (80/443) yang dipublikasikan —
> PostgreSQL, API dan Web hanya ada di jaringan internal Docker. Jangan
> menambahkan `ports:` ke service lain.

## 1. Ambil source

Di VPS yang memiliki Git, ambil repository dan pilih revisi yang sudah ditinjau:

```bash
git clone https://github.com/secretkeyz1-coder/specline-your-idea.git sdd
cd sdd
```

Repository harus memuat seluruh source, migration, dan aset yang diperlukan Dockerfile, termasuk `Referensi UI/`. Build lokal dari working tree bukan bukti seluruh file sudah tersedia melalui clone. Jika memakai arsip source sebagai alternatif, buat arsip dari revisi yang sama; panduan ini tidak mengasumsikan ada paket release ZIP siap unduh.

## 2. Isi konfigurasi

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Wajib diisi:
- `POSTGRES_PASSWORD` — acak dan aman untuk URL, mis. `openssl rand -hex 24`;
  Compose memasukkannya langsung ke DATABASE_URL.
- `SDD_MASTER_KEY` — `openssl rand -base64 32` (SIMPAN di tempat aman; kredensial
  AI provider dienkripsi dengan kunci ini — hilang = tidak bisa didekripsi)
- `SDD_SESSION_SECRET` — `openssl rand -base64 32`
- `SITE_ADDRESS` — `:80` untuk tes via IP; setelah DNS diarahkan ke VPS ganti
  menjadi `https://domainmu.com` (Caddy otomatis mengurus sertifikat TLS) dan
  samakan `PUBLIC_WEB_URL=https://domainmu.com`. `PUBLIC_WEB_URL` harus sama dengan origin browser (skema, host, port).
  Untuk SITE_ADDRESS=:80 via IP, set PUBLIC_WEB_URL=http://VPS_IP; :80 sendiri
  bukan origin browser. Compose meneruskannya ke API_PUBLIC_URL/WEB_PUBLIC_URL
  API dan ORIGIN Web; API_PUBLIC_URL Web tetap http://api:4000 (internal).

Pendaftaran akun:
- `ALLOW_SELF_REGISTRATION=false` (default) — orang asing tidak bisa membuat
  akun di servermu.
- `REGISTRATION_ALLOWLIST` — email/domain tim yang boleh mendaftar sendiri,
  dipisah koma: `ani@kantor.com,@kantor.com`.

Simpan salinan `SDD_MASTER_KEY` di luar VPS (password manager). Tanpa kunci
ini, semua API key AI yang tersimpan tidak bisa dibuka lagi — backup database
saja tidak cukup.

## 3. Build & jalankan

```bash
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env build api web
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env up -d postgres
```

## 4. Migrasi database (sekali setiap kali update)

```bash
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env run --rm migrate
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env up -d api web
```

## 5. Buat akun operator pertama — dari dalam VPS

**Akun pertama otomatis menjadi operator.** Selama belum ada akun, siapa pun
yang membuka situs lebih dulu bisa mengambil peran itu — karena itu buat dari
dalam VPS, sebelum port web dibuka ke internet:

```bash
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env exec -T api   bun -e 'const r = await fetch("http://127.0.0.1:4000/api/v1/auth/bootstrap", {method:"POST", headers:{"content-type":"application/json"}, body:await Bun.stdin.text()}); console.log(r.status, await r.text()); if (!r.ok) process.exit(1)' <<'JSON'
{"email":"kamu@domainmu.com","password":"GANTI-password-kuat-min-12","display_name":"Admin"}
JSON
```

Caddy belum dijalankan; perintah memakai API internal kontainer. Jangan simpan
password asli dalam history; gunakan stdin/file sementara terlindungi.
Balasan 201 berisi `user` berarti berhasil. Setelah itu endpoint ini menolak
permintaan berikutnya.

## 6. Buka ke internet & verifikasi

```bash
docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env up -d caddy
# Baru buka firewall provider/security group, lalu aturan host:
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

curl -fsS https://domainmu.com/healthz   # status: ok
curl -fsS https://domainmu.com/readyz    # status: ready, database: ok, schema: ok
# Bila SITE_ADDRESS=:80, pakai http://localhost sebagai pengganti HTTPS.
```

Lalu login di `https://domainmu.com`, buat project, dan pastikan halaman Tasks
tampil. Agent di laptop disambungkan dengan
`sddctl login --server https://domainmu.com`. CLI-nya dipasang dari server ini
sendiri (perlu Node.js 18+ atau Bun):
`curl -fsSL https://domainmu.com/api/v1/cli/install.sh | sh`, atau di PowerShell
`irm https://domainmu.com/api/v1/cli/install.ps1 | iex`. Image API sudah membawa
bundle `sddctl` (dibangun oleh `bun run build`).

## Checklist keamanan sebelum dipakai

- [ ] `NODE_ENV=production` (sudah diset di compose) — cookie `Secure`, CORS
      hanya dari domainmu, secret contoh ditolak saat start.
- [ ] `SITE_ADDRESS` dan `PUBLIC_WEB_URL` memakai `https://domainmu.com`.
- [ ] `POSTGRES_PASSWORD` dibuat baru dengan `openssl rand -hex 24`; `SDD_MASTER_KEY`
      dan `SDD_SESSION_SECRET` masing-masing dengan `openssl rand -base64 32` — tidak disalin dari lokal.
- [ ] Akun operator dibuat lewat langkah 5 dengan password kuat.
- [ ] Firewall: hanya 22, 80, 443 yang terbuka (`sudo ufw status`).
- [ ] `ALLOW_SELF_REGISTRATION=false`; tim masuk lewat `REGISTRATION_ALLOWLIST`.
- [ ] `SDD_MASTER_KEY` tersimpan di luar VPS; backup database terjadwal
      (lihat `deploy/OPERATIONS.md`).
- [ ] `deploy/.env` tidak pernah di-commit atau dibagikan.
- [ ] SSH: login dengan key, bukan password (`PasswordAuthentication no`).

## 7. Update versi berikutnya

1. Backup: `docker exec "$(docker compose -f deploy/docker-compose.production.yml ps -q postgres)" pg_dump -U sdd -Fc sdd > backup-$(date +%F).dump`
2. Perbarui source tanpa menimpa deploy/.env. Dalam maintenance window:
   ```bash
   docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env stop caddy web api
   docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env build api web
   docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env run --rm migrate
   docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env up -d
   ```

## Model AI: API key atau CLI lokal (Claude Code / Codex)

Di **Settings → AI providers → Add connection** ada dua jenis sumber model:

- **API** (OpenAI-compatible, OpenAI, Anthropic, Gemini, Custom HTTP): base URL + API key.
- **Local CLI (Claude Code / Codex)**: memakai CLI yang sudah login (langganan atau
  key milik CLI itu sendiri) — tidak ada key yang disimpan di aplikasi. Dua tempat jalan:
  - **Di laptopmu lewat sdd-agent** — cocok untuk VPS. Di laptop: `sddctl login
    --server https://domainmu.com`, lalu `sdd-agent connect` dan biarkan berjalan.
    Laptop hanya membuka koneksi keluar; generate hanya jalan selama agent aktif.
    Hanya pemilik mesin yang bisa memakainya untuk koneksi provider.
  - **Di server itu sendiri** — hanya untuk instalasi lokal/pribadi. Set
    `SDD_ENABLE_LOCAL_CLI=true`, pasang CLI-nya dan login sebagai user OS yang
    menjalankan API. Compose tidak meneruskan variabel ini dan image standar
    tidak memasang/login CLI; perlu environment dan image khusus, bukan hanya
    nilai di deploy/.env. **Jangan** dinyalakan di server bersama: CLI berjalan dengan
    login server tersebut.

  Keduanya menjalankan CLI tanpa tool, di folder sementara, prompt lewat stdin, dan
  environment yang disaring (rahasia server tidak ikut). Pilih model di profile
  (`sonnet`, `opus`, `haiku`, atau `default`).

## Troubleshooting

- **Log**: `docker compose -f deploy/docker-compose.production.yml logs -f api web`
- **429 saat login**: rate limit auth 20 req/menit — tunggu 1 menit.
- **403 saat login / submit form**: `PUBLIC_WEB_URL` tidak sama persis dengan
  alamat di browser (http vs https, www, port).
- **"Sign-up is closed" (REGISTRATION_CLOSED)**: tambahkan email orang itu ke
  `REGISTRATION_ALLOWLIST`, lalu `up -d` ulang service `api`.
- **Ganti port HTTP**: ubah mapping port service `caddy` di
  `deploy/docker-compose.production.yml` (mis. `"8080:80"`).
- **Agent lokal (sdd-agent / sddctl) di laptop** terhubung ke API ini lewat
  `SDD_API_URL`/pairing — bukan bagian dari stack VPS ini; jalankan terpisah di
  laptopmu (lihat README.md).

Rincian operasional lanjutan (backup rutin, restore, runbook migrasi):
`deploy/OPERATIONS.md`.
