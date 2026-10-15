# Ngebypass Safelinku

Resolver untuk memeriksa pengalihan HTTP dan mengekstrak URL tujuan yang tersedia secara literal. Resolver **tidak** menjalankan JavaScript halaman pihak ketiga, menyelesaikan CAPTCHA, menunggu timer, atau mengambil token sesi.

## Menjalankan lokal

Membutuhkan Node.js 20 atau lebih baru.

```bash
npm install
npm run dev
```

Buka alamat lokal yang ditampilkan Vercel CLI.

Untuk menjalankan Express secara langsung:

```bash
npm start
```

## Deploy ke Vercel

1. Unggah folder proyek ini ke repositori GitHub.
2. Di Vercel, pilih **Add New → Project** dan impor repositori.
3. Biarkan Vercel mendeteksi konfigurasi `vercel.json`.
4. Deploy. Tidak perlu menambahkan environment variable.
5. Buka URL deployment dan uji endpoint melalui antarmuka.

## API

`POST /api/resolve`

```json
{ "url": "https://sfl.gl/example" }
```

Berhasil:

```json
{
  "ok": true,
  "destination": "https://example.com/file",
  "method": "http_redirect",
  "redirects": 1,
  "durationMs": 432
}
```

Gagal:

```json
{
  "ok": false,
  "error": "URL tujuan belum ditemukan.",
  "durationMs": 432
}
```

Contoh di atas menjelaskan bentuk respons, bukan hasil nyata untuk tautan tertentu.

## Batasan dan keamanan

- Resolver mengikuti redirect HTTP dan memeriksa URL tujuan yang dapat dibuktikan dari parameter atau teks halaman.
- Halaman yang memerlukan JavaScript, timer, token khusus, atau CAPTCHA mungkin tidak dapat di-resolve.
- Jangan menambahkan browser headless untuk menjalankan halaman pihak ketiga tanpa audit keamanan.
- Perlindungan SSRF memeriksa alamat host sebelum permintaan. Untuk penggunaan publik skala besar, tambahkan egress firewall/proxy yang memvalidasi alamat IP tujuan pada koneksi aktual untuk mengurangi risiko DNS rebinding.
- Jangan menganggap tautan hasil aman hanya karena berhasil ditemukan.
