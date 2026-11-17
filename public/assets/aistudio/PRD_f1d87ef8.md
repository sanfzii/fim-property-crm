# Product Requirements Document (PRD): FIM-Property CRM

## 1. Document Information

| Atribut | Keterangan |
| :--- | :--- |
| **Nama Produk** | FIM-Property CRM |
| **Versi Dokumen** | `1.1` |
| **Status Dokumen** | Final — Siap Acuan Pengembangan & Akademik |
| **Tanggal Dokumen** | 14 November 2026 |
| **Pemilik Produk** | PT FIM-Property *(Internal Single-Company CRM)* |
| **Target Pengguna** | Admin, Supervisor Tim Sales, dan Sales |
| **Dokumen Acuan** | Dokumen Implementasi `01 (v1.1)`, `02 (v1.4)`, `03 (v1.1)`, `04 (v1.3)`, `05 (v1.1)`, `06 (v1.1)`, dan `DESIGN.md (v2.1)` |

---

## 2. Product Overview

### 2.1 Gambaran Umum
**FIM-Property CRM** adalah aplikasi web *Customer Relationship Management* (CRM) dan manajemen transaksi penjualan properti internal yang dirancang khusus untuk **satu perusahaan (PT FIM-Property)**. Sistem ini menyatukan seluruh alur kerja pemasaran dan penjualan properti dalam satu platform terpusat—mulai dari pencatatan calon pembeli (*lead*), kualifikasi dan penilaian prioritas prospek, penjadwalan survei lokasi (*site visit*), pemesanan unit (*booking*), verifikasi pembayaran, pemantauan proses pengajuan Kredit Pemilikan Rumah (KPR) hingga pencairan dana bank, sampai penutupan transaksi (*deal*) dan laporan eksekutif.

### 2.2 Latar Belakang Pengembangan
Dalam operasional penjualan properti, tim pemasaran dan administrasi sering menghadapi proses transaksi bernilai besar yang melibatkan banyak pihak (calon pembeli, tim *Sales*, *Supervisor*, *Admin* keuangan/legal, developer mitra, dan pihak bank). Tanpa sistem terpadu, proses tindak lanjut prospek, ketersediaan unit, verifikasi bukti transfer, serta kelengkapan berkas KPR tersebar di berbagai *spreadsheet* dan percakapan pribadi, sehingga rawan menimbulkan miskomunikasi dan kehilangan peluang penjualan.

### 2.3 Masalah yang Ingin Diselesaikan
1. **Risiko Pemesanan Ganda (*Double Booking*):** Dua *Sales* berpotensi menawarkan dan memesan unit yang sama pada waktu bersamaan jika status inventaris unit tidak diperbarui secara waktu nyata.
2. **Isolasi dan Kehilangan Histori Prospek:** Data calon pembeli sulit dipantau lintas tim tanpa batas akses yang jelas, dan riwayat komunikasi sering hilang saat terjadi pergantian *Sales*.
3. **Prioritas Tindak Lanjut Tidak Terukur:** *Sales* kesulitan menentukan prospek mana yang paling siap membeli karena belum adanya perhitungan skor prospek yang objektif dan transparan.
4. **Keterlambatan Verifikasi Pembayaran dan Penahanan Unit:** Bukti transfer yang mengantre terlalu lama tanpa peringatan SLA (*Service Level Agreement*) dapat menahan status unit secara tidak semestinya atau membuat *Booking* kedaluwarsa tanpa kepastian.
5. **Pemantauan KPR dan Tagihan yang Terpisah:** Pengajuan KPR melewati banyak tahapan (kelengkapan dokumen, pengajuan bank, *appraisal*, SP3K, akad, hingga pencairan bertahap) yang sulit dilacak progresnya secara akurat oleh *Admin*, *Supervisor*, dan *Sales*.
6. **Keamanan Dokumen Sensitif dan Jejak Audit:** Bukti pembayaran, berkas persyaratan KPR, dan kontrak perjanjian memerlukan penyimpanan privat berbatas akses serta pencatatan riwayat transaksi yang tidak dapat dihapus sembarangan.

---

## 3. Product Vision & Objectives

### 3.1 Visi Produk
Menjadi sistem operasional penjualan properti internal yang terstruktur, transparan, dan akurat bagi PT FIM-Property dalam mengelola prospek hingga realisasi penjualan unit secara aman dan akuntabel.

### 3.2 Tujuan Utama dan Hasil yang Diharapkan
| Tujuan Utama | Hasil yang Diharapkan |
| :--- | :--- |
| **Menjaga Akurasi Inventaris Unit** | Setiap perubahan status unit (`AVAILABLE`, `HELD`, `BOOKED`, `SOLD`) berlangsung secara konsisten dan bebas *double booking*. |
| **Meningkatkan Kualitas Tindak Lanjut** | Seluruh *Lead* dinilai secara objektif menggunakan skor deterministik (0–100) serta dipantau melalui tugas tindak lanjut dan jadwal survei lokasi. |
| **Menegakkan Tata Kelola Keuangan & Dokumen** | Pemisahan tugas antara pengunggah bukti (*Sales*) dan verifikator (*Admin*), disertai penyimpanan dokumen privat dan jejak audit permanen. |
| **Memantau Siklus Transaksi Secara Menyeluruh** | Mendukung penuh metode **Cash Keras**, **Cash Bertahap**, dan **KPR** hingga pelunasan atau pencairan dana bank 100%. |
| **Menyediakan Visibilitas Kinerja Real-Time** | *Admin* dan *Supervisor* memperoleh metrik pipeline, arus kas terverifikasi, piutang jatuh tempo, dan progres pencairan KPR yang konsisten. |

---

## 4. Target Users & Roles

Sistem ini hanya melayani **tiga peran pengguna internal** yang seluruh akunnya didaftarkan dan dikelola oleh *Admin* (tidak ada pendaftaran mandiri oleh publik).

| Role | Deskripsi Peran | Tanggung Jawab Utama | Kebutuhan & Batasan Akses |
| :--- | :--- | :--- | :--- |
| **ADMIN** | Pengelola operasional, keuangan, legal, dan administrasi perusahaan. | Mengelola akun staf dan tim penjualan; mengelola katalog developer, proyek, tipe, harga, dan promo; memverifikasi pembayaran dan dokumen KPR; mencatat keputusan bank, jadwal akad, dan pencairan KPR; mengesahkan status kontrak *Deal*; memproses pembatalan dan *refund*; memantau laporan perusahaan dan log audit. | Akses penuh lintas seluruh tim di PT FIM-Property. Satu-satunya role yang berhak memverifikasi pembayaran, mengubah harga/katalog, memajukan tahap/status KPR, membatalkan transaksi, dan melihat log audit. |
| **SUPERVISOR** | Pemimpin tim penjualan (*Supervisor Tim Sales*). | Memantau kinerja *Sales* di dalam tim aktifnya; membuat atau mengalihkan kepemilikan *Lead* antar-*Sales* di tim yang sama; memberikan instruksi tugas tindak lanjut dan survei lokasi; memantau transaksi, pembayaran, KPR, dan laporan tim. | Cakupan data terbatas pada **tim aktifnya sendiri**. Bersifat **baca-saja (*read-only*)** untuk katalog, *Booking*, pembayaran, KPR, dan *Deal* timnya. Tidak dapat memverifikasi pembayaran/dokumen KPR, tidak dapat mengelola akun staf/tim, **tidak boleh menjalankan Sinkronisasi Sistem global atau evaluasi kedaluwarsa *Booking* lintas perusahaan**, dan tidak memiliki akses ke log audit. |
| **SALES** | Tenaga penjual lapangan dan pengelola prospek langsung. | Mencari dan mencatat *Lead* baru; melakukan kualifikasi prospek, komunikasi, tindak lanjut, dan *site visit*; mengajukan *Booking* unit untuk prospeknya; mengunggah bukti pembayaran pelanggan dan bukti perbaikan jika ditolak; mengunggah dokumen persyaratan KPR milik konsumennya; memantau progres transaksi dan KPR pribadinya. | Cakupan data terbatas pada **prospek dan transaksi miliknya sendiri di dalam tim aktifnya**. Dapat melihat katalog unit dan info ringkas pemegang unit (`Nama Depan • Kode Tim`). Tidak dapat memverifikasi bukti bayar/dokumen KPR sendiri, tidak dapat mengubah harga unit, dan tidak dapat mengalihkan *Lead* ke *Sales* lain. |

---

## 5. Product Scope

### 5.1 Fitur yang Termasuk dalam Ruang Lingkup (*In-Scope*)
1. **Autentikasi & Manajemen Pengguna Internal:** Login berbasis email dan kata sandi, proteksi sesi, pengelolaan profil pribadi, serta manajemen akun staf dan status aktif oleh *Admin*.
2. **Manajemen Tim Sales:** Pembentukan tim penjualan internal, penunjukan satu *Supervisor* aktif per tim, penempatan *Sales* pada satu tim aktif, serta riwayat perpindahan tim.
3. **Dashboard & Analitik Terstandarisasi:** Dashboard khusus *Admin*, *Supervisor*, dan *Sales* dengan kamus metrik yang seragam (prospek, kontrak, arus kas, piutang, inventaris unit, dan ringkasan pencairan KPR).
4. **Manajemen Lead, Pipeline & Skoring Deterministik:** Pencatatan prospek, papan *Pipeline* 9 tahap, riwayat aktivitas komunikasi, *Lead Scoring* deterministik 4 indikator (`OQ-04`), dan pengalihan *Lead* (*reassignment*).
5. **Follow-Up Tasks & Site Visits:** Pengelolaan tugas tindak lanjut (termasuk yang tertaut ke jadwal tagihan atau pengajuan KPR) dan penjadwalan serta hasil survei lokasi.
6. **Katalog Properti, Harga & Promo:** Pengelolaan data developer mitra, proyek perumahan, tipe rumah, unit beserta matriks ketersediaannya (`OQ-05`), riwayat perubahan harga, dan program promosi.
7. **Manajemen Booking, Pembayaran & Refund:** Pemesanan unit dengan batas waktu penahanan 72 jam, penguncian harga kesepakatan (*Price Freeze*), perpanjangan masa berlaku oleh *Admin*, jadwal tagihan, verifikasi bukti transfer beserta eskalasi SLA 24/48 jam, pembatalan, dan penyelesaian pengembalian dana (*refund*).
8. **Dukungan Tiga Metode Pembiayaan:** Alur transaksi lengkap untuk **Cash Keras**, **Cash Bertahap** (beserta jadwal termin cicilan kepada perusahaan dan aktivasi kontrak PPJB), serta **KPR**.
9. **Monitoring Proses & Pencairan KPR:** Pemantauan 10 tahap proses KPR, pemisahan status pengajuan vs tahap proses, *checklist* verifikasi berkas persyaratan KPR, pencatatan hasil SP3K dan tagihan *Top-Up DP* otomatis jika plafon turun, penjadwalan akad, pembatalan KPR oleh konsumen, dan pencatatan pencairan dana bank bertahap hingga 100%.
10. **Manajemen Deal & Dokumen Privat:** Pelacakan 3 dimensi penyelesaian transaksi (*Sales Outcome*, *Contract Status*, *Payment Settlement*), unggah kontrak PPJB/Akta, dan akses dokumen aman berbatas waktu (*Signed URL* 5 menit).
11. **Pusat Notifikasi, Pengingat Otomatis & Log Audit:** Mesin pengingat hibrida (otomatis terjadwal, saat akses, dan sinkronisasi manual), kotak masuk notifikasi aplikasi, serta penampil log audit khusus *Admin*.

### 5.2 Fitur yang Secara Eksplisit Tidak Termasuk (*Out-of-Scope*)
1. **Arsitektur Multi-Tenant:** Sistem tidak melayani pendaftaran banyak perusahaan properti, pemisahan *tenant* komersial, atau penagihan langganan SaaS.
2. **Portal Publik & Pendaftaran Mandiri:** Calon pembeli eksternal tidak login ke aplikasi, dan staf baru tidak dapat mendaftar sendiri dari halaman login.
3. **Machine Learning / Fitur AI Prediktif:** Tidak ada model prediksi ML, skor berbasis AI, atau *chatbot* otomatis; penilaian prospek murni berbasis aturan deterministik.
4. **Pemantauan Cicilan Bulanan KPR Nasabah ke Bank:** Setelah dana KPR dicairkan oleh bank (100% *fully disbursed*), sistem **tidak** melacak angsuran bulanan nasabah kepada bank. Jadwal termin cicilan di sistem hanya berlaku untuk metode **Cash Bertahap** kepada PT FIM-Property.
5. **Integrasi Payment Gateway & Blast Eksternal Otomatis:** Pembayaran diverifikasi secara manual dari bukti transfer yang diunggah; notifikasi dikirim melalui kotak masuk internal aplikasi tanpa integrasi *payment gateway*, WhatsApp API, atau *email blast* otomatis.
6. **Penghapusan Data Permanen (*Hard Delete*):** Data staf, prospek, pembayaran yang ditolak, riwayat harga, dan log audit tidak dapat dihapus permanen demi menjaga integritas pelaporan dan kepatuhan audit.

---

## 6. Functional Requirements

### 6.1 Authentication dan Manajemen Pengguna
* Pengguna mengakses aplikasi melalui halaman login menggunakan email kerja dan kata sandi yang dibuat oleh *Admin*.
* Sistem memverifikasi keaktifan akun di setiap permintaan; jika *Admin* menonaktifkan akun staf, sesi aktif staf tersebut harus segera dicabut secara menyeluruh.
* Penonaktifan akun staf wajib ditolak apabila staf tersebut masih memegang *Lead* aktif atau *Booking* yang sedang berjalan, sehingga *Admin* atau *Supervisor* harus mengalihkan (*reassign*) tanggung jawabnya terlebih dahulu.
* *Admin* tidak diizinkan menurunkan perannya sendiri atau menonaktifkan akunnya sendiri.
* Semua pengguna dapat memperbarui data profil dasar miliknya (nama lengkap dan nomor telepon) tanpa bisa mengubah peran, email kerja, maupun status keaktifan.

### 6.2 Dashboard Berdasarkan Role
* **Dashboard Admin:** Menampilkan ringkasan tingkat perusahaan mencakup total nilai kontrak `CLOSED_WON`, arus kas bersih terverifikasi (*gross verified inflow* dikurangi *refund* selesai), total piutang berjalan dan jatuh tempo (*overdue*), jumlah antrean bukti bayar menunggu verifikasi (dengan penanda SLA >24/48 jam), distribusi inventaris unit (`AVAILABLE`, `HELD`, `BOOKED`, `SOLD`), ringkasan pencairan KPR, serta akses cepat antrean tindakan mendesak.
* **Dashboard Supervisor:** Menampilkan ringkasan metrik dan beban kerja khusus **tim aktifnya**, mencakup komposisi prospek tim (`HOT`/`WARM`/`COLD`), capaian closing tim, *Booking* berjalan, tugas jatuh tempo tim, serta daftar peringatan SLA dan progres transaksi tim secara *read-only*.
* **Dashboard Sales:** Menampilkan ringkasan pribadi mencakup prospek aktifnya, prioritas tugas *follow-up* dan survei lokasi hari ini, *Booking* yang mendekati batas waktu 72 jam, dokumen KPR yang memerlukan revisi, serta bukti bayar ditolak yang perlu diunggah ulang.
* Khusus ***Admin*** memiliki tombol **Sinkronisasi Sistem** untuk memicu evaluasi waktu global lintas perusahaan (kedaluwarsa *Booking* massal, tagihan jatuh tempo, eskalasi SLA, dan distribusi notifikasi) secara instan; di luar pemicu manual *Admin*, evaluasi global tersebut dijalankan otomatis oleh proses terjadwal sistem (*cron*). ***Supervisor*** tidak diizinkan menjalankan evaluasi global lintas perusahaan dan hanya memantau indikator pengingat serta SLA pada **tim aktifnya sendiri**.

### 6.3 Manajemen Lead dan Pipeline
* *Sales*, *Supervisor*, dan *Admin* dapat mencatat prospek (*Lead*) baru dengan validasi keunikan nomor telepon agar tidak terjadi duplikasi data prospek.
* Jika *Sales* membuat *Lead*, kepemilikan otomatis ditetapkan ke dirinya sendiri di tim aktifnya. *Supervisor* dapat menugaskan ke *Sales* aktif dalam timnya, sedangkan *Admin* dapat menugaskan ke *Sales* pada tim mana pun.
* *Pipeline* penjualan terdiri dari **9 tahapan berurutan**: *New*, *Contacted*, *Qualified*, *Site Visit*, *Negotiation*, *Booking*, *Payment/KPR Process*, *Closed Won*, dan *Closed Lost*.
* Tahap pra-transaksi (`New` hingga `Negotiation`, serta `Closed Lost`) dapat diperbarui melalui alur CRM, sedangkan tahap transaksi (`Booking`, `Payment/KPR Process`, dan `Closed Won`) **terkunci sistem** dan hanya berpindah otomatis saat peristiwa transaksi resmi disahkan.
* Setiap aktivitas komunikasi (*WhatsApp*, telepon, pertemuan, panggilan video, atau email) beserta respons konsumen dicatat secara permanen (*append-only*) dan tidak dapat dihapus.
* *Admin* (lintas tim/dalam tim) dan *Supervisor* (hanya dalam tim aktifnya) dapat melakukan pengalihan kepemilikan *Lead* (*reassignment*) dengan alasan wajib. Pengalihan ini **hanya memindahkan penanggung jawab operasional berjalan**—yakni kepemilikan aktif *Lead*, tugas tindak lanjut yang masih terbuka/terlambat, jadwal *Site Visit* mendatang, serta penanganan operasional transaksi yang masih aktif berjalan (*Booking*, pengajuan KPR aktif, dan *Deal* terbuka)—kepada *Sales* baru. Sebaliknya, **seluruh histori dan atribusi asal transaksi tetap dipertahankan secara permanen**: identitas *Sales* asal yang menginisiasi *Booking* dan *Deal* sebelumnya tidak berubah, dan catatan aktivitas komunikasi lama, tugas/survei yang sudah selesai, riwayat skor, serta log penugasan ulang sebelumnya tidak pernah dihapus atau diubah.

### 6.4 Lead Scoring Deterministik (`OQ-04`)
* Sistem menghitung skor prospek (`0`–`100`) dan mengklasifikasikan temperatur menjadi **`HOT` (`75–100`)**, **`WARM` (`45–74`)**, atau **`COLD` (`0–44`)** murni menggunakan aturan deterministik (tanpa *Machine Learning*).
* Perhitungan didasarkan pada **4 indikator berbobot transparan**:
  1. **Kesesuaian Budget (Maks. 30 poin):** Perbandingan estimasi anggaran prospek terhadap harga unit `AVAILABLE` termurah sesuai preferensi proyek/tipe unit (`>= 100%` = 30 poin; `85–99,9%` = 20 poin; `70–84,9%` = 10 poin; `< 70%` / belum diisi = 0 poin).
  2. **Target Waktu Pembelian (Maks. 25 poin):** `< 1 bulan` = 25 poin; `1–3 bulan` = 18 poin; `3–6 bulan` = 10 poin; `> 6 bulan` = 5 poin; belum ditentukan = 0 poin.
  3. **Kesiapan Pembayaran & Dokumen (Maks. 20 poin):** Dana *Cash Keras* siap atau DP & berkas KPR lengkap = 20 poin; DP siap sambil melengkapi berkas = 15 poin; masih menabung DP = 8 poin; belum jelas = 0 poin.
  4. **Interaksi & Survei Lokasi (Maks. 25 poin — diambil capaian tertinggi):** *Site Visit* selesai dengan hasil *Positive Interest* = 25 poin; *Site Visit* masih terjadwal atau selesai dengan hasil *Neutral Consideration* = 20 poin; komunikasi dua arah responsif **atau *Site Visit* selesai dengan hasil *Not Suitable*** = 12 poin; komunikasi satu arah awal = 5 poin; belum ada interaksi atau hanya tidak responsif tanpa kunjungan = 0 poin.
* **Perlakuan Khusus Hasil *Site Visit* `Not Suitable`:** Hasil survei *Not Suitable* tetap dinilai secara deterministik sebesar **12 poin** pada indikator Interaksi & Survei Lokasi karena prospek terbukti hadir dan melakukan interaksi dua arah di lokasi, namun tidak memperoleh bonus poin ketertarikan survei (20 atau 25 poin). Ketiga indikator lain (Budget, Target Waktu Pembelian, dan Kesiapan Pembayaran) tetap dihitung normal sesuai rumus `OQ-04` (`0`–`100`) dan status *Lead* tidak otomatis ditutup menjadi `Closed Lost`, sehingga *Sales* tetap dapat menawarkan unit/proyek alternatif atau menutup prospek secara manual apabila tidak ada kecocokan.
* Skor otomatis dihitung ulang setiap kali profil kualifikasi diperbarui, aktivitas komunikasi baru dicatat, status/hasil *Site Visit* diperbarui, atau harga katalog unit acuan berubah. Setiap perubahan skor atau temperatur tercatat dalam riwayat skor.

### 6.5 Katalog Properti, Proyek, Developer, dan Unit
* *Admin* mengelola master data **Developer mitra**, **Proyek Perumahan** (status *Pre-Launch*, *Active Selling*, *Sold Out*, *Closed*), **Tipe Properti** (spesifikasi tipe, luas tanah/bangunan standar, kamar), **Unit Properti** (kode unit, blok, orientasi, posisi *hook*, harga katalog, status), serta **Program Promo** (diskon nominal, diskon persentase, atau manfaat gratis dengan periode berlaku).
* Setiap perubahan harga katalog unit oleh *Admin* wajib disertai alasan dan otomatis tercatat permanen dalam riwayat harga, lalu memicu perhitungan ulang skor *Lead* yang relevan.
* Seluruh staf aktif (*Admin*, *Supervisor*, *Sales*) dapat melihat matriks ketersediaan unit secara *real-time*.
* Sesuai ketentuan **`OQ-05`** dan privasi antarmuka: ketika unit berstatus `HELD`, `BOOKED`, atau `SOLD`, sistem **hanya** menampilkan **Nama Depan Sales** dan **Kode Tim Sales** pemegang unit (contoh: `Fariz • TIM-01`), tanpa menampilkan nama lengkap, email, maupun nomor telepon pribadi staf lain.

### 6.6 Manajemen Booking
* *Sales* (untuk *Lead* miliknya), *Supervisor* (untuk *Lead* timnya), dan *Admin* dapat mengajukan *Booking* atas unit berstatus `AVAILABLE` pada proyek berstatus `ACTIVE_SELLING`.
* Pembuatan *Booking* mengunci unit secara atomik menjadi **`HELD`**, menerbitkan nomor referensi berurutan bulanan (`BK-YYYYMM-XXXX`), menetapkan batas waktu pelunasan *Booking Fee* selama **72 jam**, dan membuat jadwal tagihan *Booking Fee*.
* Sistem menerapkan **Price Freeze**: harga unit, diskon promo yang berlaku, serta rencana pembiayaan disalin sebagai *snapshot* pada saat *Booking* dibuat sehingga perubahan harga katalog di kemudian hari tidak mengubah nilai transaksi yang sudah berjalan.
* *Admin* dapat memperpanjang masa berlaku *Booking* yang masih `PENDING_FEE` dengan alasan wajib yang tercatat di riwayat perpanjangan.
* Apabila batas waktu 72 jam terlewati tanpa bukti bayar terverifikasi dan tidak ada bukti bayar yang masih menunggu verifikasi (`PENDING_VERIFICATION`), sistem otomatis mengubah *Booking* menjadi `EXPIRED`, membatalkan tagihan dan pengingat terkait, serta melepaskan unit kembali menjadi `AVAILABLE`.

### 6.7 Pembayaran dan Verifikasi
* Setiap *Booking* memiliki jadwal tagihan terstruktur (*Booking Fee*, *Down Payment*, termin cicilan *Cash Bertahap*, *KPR Top-Up DP*, atau pelunasan akhir).
* *Sales* dan *Admin* dapat mengunggah bukti pembayaran (foto/PDF maks. 5 MB) atas tagihan yang belum lunas, dengan pembatasan nominal agar total pembayaran menunggu verifikasi ditambah nominal baru tidak melebihi sisa tagihan.
* **Segregation of Duties:** Hanya **`ADMIN`** yang berhak mengesahkan (`VERIFIED`) atau menolak (`REJECTED`) bukti pembayaran.
* Ketika bukti bayar *Booking Fee* dinyatakan lunas terverifikasi, sistem secara atomik mengaktifkan *Booking* (`ACTIVE`), mengubah status unit menjadi **`BOOKED`**, membuat catatan *Deal* (`DL-YYYYMM-XXXX`), menyusun jadwal tagihan lanjutan (DP/Pelunasan), dan—bila metode bayar adalah KPR—otomatis menginisiasi pengajuan KPR (`KPR-YYYYMM-XXXX`) beserta daftar persyaratan dokumen banknya.
* Jika bukti bayar ditolak (`REJECTED`), *Admin* wajib mengisi alasan penolakan. File dan catatan penolakan tetap tersimpan permanen sebagai jejak audit; *Sales* mengunggah bukti perbaikan baru yang tertaut sebagai pengganti bukti yang ditolak.
* **Eskalasi SLA Verifikasi (`PD-01`):** Bukti bayar yang menunggu verifikasi lebih dari **24 jam** memicu notifikasi peringatan kepada *Admin*; jika melebihi **48 jam** atau menahan unit melewati masa kedaluwarsa *Booking*, sistem mengirim eskalasi prioritas tinggi kepada *Admin* dan *Supervisor* tim terkait.
* **Pembatalan & Refund:** Hanya *Admin* yang dapat membatalkan *Booking* atau *Deal* (selama unit belum `SOLD`, belum ada pencairan KPR, dan tidak ada bukti bayar `PENDING_VERIFICATION` yang menggantung), menetapkan kebijakan dana (*Forfeited*, *Full Refund*, atau *Partial Refund*), melepaskan unit menjadi `AVAILABLE`, serta menerbitkan dan menyelesaikan transaksi pengembalian dana (`REF-YYYYMM-XXXX`) beserta unggah bukti transfer *refund*.

### 6.8 Cash Keras dan Cash Bertahap
* **Cash Keras:** Setelah *Booking Fee* lunas, sistem membentuk tagihan pelunasan akhir (`FINAL_SETTLEMENT`). Begitu seluruh kewajiban pembayaran lunas dan terverifikasi oleh *Admin*, *Deal* berpindah menjadi `CLOSED_WON` dengan penyelesaian penuh, *Booking* selesai, dan unit berubah menjadi **`SOLD`**.
* **Cash Bertahap:**
  * Setelah *Booking Fee* lunas, *Admin* menyusun jadwal termin cicilan berkala (*Down Payment* dan sejumlah termin `INSTALLMENT` bulanan kepada PT FIM-Property) dengan total tagihan yang secara matematis tepat sama dengan harga kesepakatan akhir (*Anti-Double Counting Booking Fee*).
  * Sesuai **Kebijakan C2**, ketika seluruh DP telah lunas dan dokumen kontrak PPJB ditandatangani serta diaktifkan oleh *Admin*, *Deal* dicatat sebagai `CLOSED_WON` dan status kontrak menjadi aktif (*Under Contract*), **namun status fisik unit tetap `BOOKED`** selama angsuran cicilan *Cash Bertahap* masih berjalan.
  * Apabila ada termin yang melewati tanggal jatuh tempo, jadwal berubah menjadi `OVERDUE` dan *Deal* ditandai menunggak hingga tunggakan tersebut diverifikasi lunas kembali.
  * Unit baru berubah menjadi **`SOLD`** setelah 100% seluruh termin *Cash Bertahap* lunas dan disahkan oleh *Admin*.

### 6.9 Monitoring Proses KPR
* Sistem memantau proses pengajuan KPR konsumen dari tahap persiapan berkas hingga pencairan dana bank, dan **tidak** mencakup pemantauan cicilan bulanan setelah pencairan.
* Sistem memisahkan secara tegas **10 Tahapan Proses KPR** (*Document Collection*, *Document Verification*, *Submitted*, *Bank Verification*, *Appraisal*, *Additional Requirements*, *Approved*, *Akad Scheduled*, *Akad Completed*, *Disbursement*) dari **Status Lifecycle Pengajuan** (*In Progress*, *Approved*, *Rejected by Bank*, *Cancelled by Customer*, *Booking Cancelled*, *Completed*).
* Untuk menjaga kepatuhan privasi pada tahap pengembangan/demonstrasi, dokumen persyaratan KPR (seperti KTP, KK, NPWP, slip gaji, rekening koran sesuai *template* bank) wajib menggunakan **dokumen fiktif/simulasi**.
* *Sales* mengunggah dokumen persyaratan ke penyimpanan privat; *Admin* melakukan verifikasi (`VERIFIED`) atau meminta perbaikan (`REVISION_REQUIRED`). Dokumen yang sudah terverifikasi terkunci dan tidak dapat ditimpa oleh non-*Admin*. Pengajuan tidak dapat dimajukan oleh *Admin* ke tahap *Submitted* sebelum seluruh dokumen wajib berstatus `VERIFIED`.
* **Keputusan Bank / SP3K:** *Admin* mencatat persetujuan bank (*Approved* beserta nomor SP3K dan plafon kredit disetujui) atau penolakan bank (*Rejected by Bank* beserta alasan; tahap proses terakhir tetap dipertahankan untuk histori). Jika plafon yang disetujui bank lebih kecil dari kebutuhan pembiayaan yang direncanakan, sistem otomatis membuat atau memperbarui tagihan selisih **`KPR_TOPUP_DP`** yang harus dilunasi konsumen sebelum akad/pencairan.
* **Akad & Pembatalan Konsumen:** *Admin* menjadwalkan waktu dan lokasi akad kredit, mencatat penyelesaian akad, serta dapat mencatat pembatalan pengajuan KPR atas inisiatif konsumen (selama belum ada pencairan bank) yang otomatis menutup tugas tindak lanjut KPR yang masih terbuka.

### 6.10 Pencairan KPR
* Hanya *Admin* yang berhak mencatat realisasi pencairan dana KPR dari bank setelah pengajuan berstatus disetujui, tahap berada pada pasca-akad, dan seluruh kewajiban DP serta *Top-Up DP* telah lunas.
* Sistem mendukung pencairan satu kali penuh maupun pencairan bertahap—yakni **Pencairan Utama (`PRIMARY`)** dan **Pencairan Susulan / Retensi (`SUBSEQUENT`)**—dengan validasi nomor referensi pencairan bank yang unik serta unggah bukti pencairan bank.
* Sistem otomatis merekonsiliasi total dana yang sudah dicairkan terhadap plafon kredit disetujui (`NOT_DISBURSED`, `PARTIALLY_DISBURSED`, `FULLY_DISBURSED`).
* Sesuai ketetapan final **`TC-01A`**: selama status pencairan masih `NOT_DISBURSED` atau `PARTIALLY_DISBURSED`, unit tetap berstatus **`BOOKED`**. Hanya ketika total pencairan mencapai **100% (`FULLY_DISBURSED`)**, sistem otomatis menandai pengajuan KPR selesai, *Deal* lunas penuh, *Booking* selesai, dan unit berubah menjadi **`SOLD`**.

### 6.11 Deal dan Dokumen Transaksi
* Setiap transaksi yang telah melunasi *Booking Fee* memiliki entitas *Deal* yang dipantau melalui **3 dimensi status terpisah**: hasil penjualan (*Sales Outcome*), status kontrak (*Contract Status*), dan status penyelesaian pembayaran (*Payment Settlement Status*).
* *Admin* mengesahkan transisi status *Deal* (aktivasi kontrak PPJB *Cash Bertahap*, penyelesaian Akad KPR, dan pengesahan pelunasan akhir) serta mengunggah dokumen kontrak Perjanjian Pengikatan Jual Beli (PPJB) / Akta dalam format **PDF**.
* Seluruh dokumen sensitif transaksi (bukti bayar, berkas KPR, bukti pencairan KPR, bukti *refund*, dan kontrak PPJB/Akta) disimpan pada **penyimpanan privat (*Private Storage*)** dengan ukuran maksimal **5 MB** per file (`JPG`, `PNG`, `WEBP`, `PDF`, dan khusus kontrak wajib `PDF`).
* Tidak ada tautan file yang bersifat publik permanen; pratinjau dan unduhan hanya dilakukan melalui tautan sementara (*Signed URL*) yang berlaku **300 detik (5 menit)** setelah hak akses pengguna atas transaksi tersebut diverifikasi ulang oleh server.

### 6.12 Follow-Up dan Site Visit
* **Follow-Up Tasks:** *Sales* dapat membuat tugas tindak lanjut manual untuk prospeknya; *Supervisor* dapat memberikan tugas instruksi kepada *Sales* di timnya; dan sistem otomatis membuat tugas penagihan saat tagihan pembayaran jatuh tempo atau terlambat.
* Tugas tindak lanjut dapat ditautkan secara opsional ke **Jadwal Pembayaran tertentu** maupun langsung ke **Pengajuan KPR tertentu** (misalnya melengkapi berkas KPR, memantau hasil *appraisal*, atau jadwal akad). Sistem memastikan tautan tersebut valid milik prospek yang sama.
* **Site Visits:** *Sales*, *Supervisor*, dan *Admin* dapat menjadwalkan, menjadwalkan ulang (*reschedule*), membatalkan, dan mencatat hasil evaluasi survei lokasi (*Positive Interest*, *Neutral Consideration*, atau *Not Suitable*). Penyelesaian *Site Visit* otomatis memperbarui skor prospek.

### 6.13 Notifikasi dan Pengingat
* Mesin pengingat (*Hybrid Reminder Engine*) bekerja melalui tiga jalur: pengecekan terjadwal harian (*cron* berotoritas sistem), evaluasi ringan berkala saat pengguna membuka aplikasi (*throttled on-access*), dan **pemicu manual Sinkronisasi Sistem khusus oleh *Admin***. *Supervisor* tidak diperkenankan memicu evaluasi global lintas perusahaan ataupun mengeksekusi kedaluwarsa *Booking* secara massal.
* Sistem menerbitkan notifikasi internal aplikasi secara idempoten (bebas duplikasi) untuk kejadian penting: pengingat *Booking Fee* dan *Booking* kedaluwarsa, hasil verifikasi pembayaran, eskalasi SLA 24/48 jam, tagihan jatuh tempo/terlambat, penugasan ulang *Lead*, pembaruan tahap/dokumen KPR, jadwal akad, perubahan status *Deal*, perubahan harga unit, dan peluncuran promo baru.
* Setiap pengguna hanya dapat melihat kotak masuk notifikasinya sendiri dan menandainya sebagai sudah dibaca.

### 6.14 Laporan dan Analitik
* *Admin* (cakupan seluruh perusahaan) dan *Supervisor* (cakupan tim aktifnya) dapat melihat laporan kinerja penjualan, konversi *Lead* per sumber, ringkasan piutang, arus kas terverifikasi, serta realisasi pencairan KPR berdasarkan kamus metrik standar perusahaan.
* Khusus **`ADMIN`**, tersedia penampil **Audit Log** bersifat *read-only* untuk menelusuri seluruh perubahan data kritikal (siapa pelaku, waktu, entitas, perubahan nilai, dan alasan) yang bersifat permanen.

### 6.15 Manajemen Tim Sales
* *Admin* membuat dan mengelola daftar Tim Sales internal perusahaan serta menugaskan staf ke dalam tim.
* Setiap tim maksimal memiliki **1 Supervisor aktif**, dan setiap *Sales* atau *Supervisor* hanya boleh aktif di **1 tim pada satu waktu**.
* Perpindahan keanggotaan tim tetap menyimpan catatan riwayat tim lama dan secara otomatis mencabut akses *Sales*/*Supervisor* terhadap data prospek dan transaksi milik tim sebelumnya.

---

## 7. Business Workflow

### 7.1 Alur Kerja Sales: Dari Lead hingga Booking
1. *Sales* menerima atau menginput data *Lead* baru (sumber, kontak, proyek/tipe minat, estimasi anggaran).
2. *Sales* menghubungi calon pembeli, mencatat aktivitas komunikasi, serta mengisi target waktu beli dan kesiapan dana sehingga sistem menghitung skor dan temperatur (`COLD`/`WARM`/`HOT`).
3. *Sales* menjadwalkan dan mendampingi **Site Visit**, lalu mencatat hasil ketertarikan prospek (skor diperbarui otomatis).
4. Setelah negosiasi dan pemilihan unit `AVAILABLE` selesai, *Sales* mengajukan **Booking** melalui sistem: unit langsung tertahan `HELD` selama **72 jam**, harga kesepakatan terkunci (*Price Freeze*), dan jadwal tagihan *Booking Fee* terbentuk.
5. *Sales* membantu konsumen melakukan transfer *Booking Fee* dan mengunggah bukti transfer sebelum batas 72 jam berakhir.

### 7.2 Alur Kerja Admin: Mengelola Transaksi dan Pembayaran
1. *Admin* memantau antrean bukti transfer (`PENDING_VERIFICATION`) beserta indikator SLA 24/48 jam.
2. *Admin* membuka pratinjau bukti bayar (*Signed URL* 5 menit), mencocokkan nominal dengan mutasi rekening perusahaan, lalu memilih **Verifikasi** atau **Tolak** (dengan alasan wajib).
3. Saat *Booking Fee* diverifikasi lunas, sistem otomatis mengaktifkan *Booking* & *Deal*, mengubah unit menjadi `BOOKED`, serta membentuk tagihan lanjutan (dan menginisiasi KPR jika metode bayar KPR).
4. *Admin* memverifikasi pembayaran DP, cicilan *Cash Bertahap*, atau *Top-Up DP* berikutnya, mengunggah kontrak PPJB/Akta, memperpanjang *Booking* bila diperlukan, atau memproses pembatalan dan *refund* jika transaksi batal.

### 7.3 Alur Kerja Supervisor: Memantau Tim Sales
1. *Supervisor* memantau KPI timnya di Dashboard (distribusi *Lead*, tugas *overdue*, dan peringatan SLA pembayaran tim).
2. *Supervisor* meninjau beban kerja tiap *Sales* dalam timnya; jika ada *Sales* berhalangan atau perlu pemerataan beban, *Supervisor* melakukan pengalihan (*reassign*) *Lead* ke *Sales* aktif lain di tim yang sama.
3. *Supervisor* membuat tugas tindak lanjut instruksional bagi *Sales* dan memantau progres *Booking*, pembayaran, KPR, serta *Deal* timnya secara *read-only*.

### 7.4 Alur Pembayaran Cash Keras
1. *Booking* dibuat (`HELD`, 72 jam) $\rightarrow$ *Sales* unggah bukti *Booking Fee* $\rightarrow$ *Admin* verifikasi (`BOOKED`, *Deal* terbentuk, jadwal pelunasan akhir dibuat).
2. Konsumen melunasi sisa harga kesepakatan (baik melalui DP + pelunasan maupun langsung pelunasan penuh) $\rightarrow$ *Sales* unggah bukti transfer $\rightarrow$ *Admin* memverifikasi hingga seluruh tagihan berstatus lunas (`PAID`).
3. Sistem secara otomatis mengubah *Deal* menjadi `CLOSED_WON` (lunas penuh), *Booking* selesai, dan status unit menjadi **`SOLD`**.

### 7.5 Alur Pembayaran Cash Bertahap (Kebijakan C2)
1. *Booking Fee* dilunasi dan diverifikasi *Admin* $\rightarrow$ *Booking* aktif (`BOOKED`), *Admin* menyusun jadwal DP dan termin cicilan bulanan (`INSTALLMENT`) kepada PT FIM-Property.
2. Setelah DP lunas dan kontrak PPJB ditandatangani, *Admin* mengunggah kontrak PDF PPJB dan mengaktifkan status kontrak *Deal*: *Deal* tercatat sebagai **`CLOSED_WON`** *(Kebijakan C2)*, namun status unit **tetap `BOOKED`** selama cicilan berjalan.
3. Konsumen membayar tiap termin bulanan sesuai jatuh tempo; sistem memantau tunggakan (*overdue*) dan *Sales* menagih jika ada keterlambatan.
4. Setelah seluruh termin cicilan *Cash Bertahap* lunas 100% dan diverifikasi *Admin*, *Admin* mengesahkan penyelesaian akhir sehingga unit berubah menjadi **`SOLD`**.

### 7.6 Alur KPR: Dari Pengumpulan Dokumen hingga Pencairan Bank (`TC-01A`)
1. *Booking Fee* untuk metode KPR diverifikasi *Admin* $\rightarrow$ unit menjadi `BOOKED`, pengajuan KPR (`KPR-...`) dan *checklist* dokumen persyaratan bank otomatis dibuat.
2. *Sales* mengunggah berkas persyaratan fiktif (`OQ-06`) $\rightarrow$ *Admin* memeriksa dan menandai tiap dokumen `VERIFIED` atau `REVISION_REQUIRED`.
3. Setelah seluruh dokumen wajib `VERIFIED`, *Admin* memajukan pengajuan KPR ke tahap pengajuan bank (*Submitted*), lalu memantau *Bank Verification*, *Appraisal*, dan pemenuhan syarat tambahan.
4. *Admin* mencatat keputusan bank (**SP3K Disetujui** atau **Ditolak Bank**). Jika plafon SP3K turun di bawah rencana, sistem otomatis menerbitkan tagihan selisih **`KPR_TOPUP_DP`** untuk dilunasi konsumen.
5. Setelah DP dan *Top-Up DP* lunas, *Admin* menjadwalkan akad kredit, mencatat penyelesaian akad, lalu mencatat pencairan dana dari bank (**`PRIMARY`** dan, jika bertahap, **`SUBSEQUENT`**):
   * Jika baru cair sebagian (`PARTIALLY_DISBURSED`), unit **tetap `BOOKED`** (`TC-01A`).
   * Saat total pencairan mencapai **100% (`FULLY_DISBURSED`)**, pengajuan KPR selesai, *Booking* & *Deal* lunas penuh, dan unit resmi berubah menjadi **`SOLD`**.

---

## 8. Business Rules & Important Policies

### 8.1 Aturan Bisnis Utama
1. **Sistem Internal Satu Perusahaan & Akun Terkelola:** Tidak ada *multi-tenant* dan tidak ada registrasi publik; seluruh akun dibuat oleh *Admin*.
2. **Imutabilitas Rekam Jejak & Atribusi Histori (`BR-08`, `BR-09`, & `BR-10`):** Tidak ada *hard delete*. Histori aktivitas komunikasi, perubahan harga katalog, riwayat penugasan *Lead*, riwayat tahap KPR, bukti bayar yang ditolak (`REJECTED`), dan *Audit Log* tersimpan permanen. Pada pengalihan *Lead* (*reassignment*), hanya tanggung jawab operasional yang sedang berjalan yang berpindah ke *Sales* baru, sedangkan atribusi *Sales* asal pada *Booking*/*Deal* serta seluruh histori kepemilikan dan aktivitas sebelumnya tetap utuh.
3. **Pemisahan Tugas (*Segregation of Duties*):** *Sales* yang mengajukan *Booking* dan mengunggah bukti pembayaran/dokumen KPR **tidak pernah** dapat memverifikasi bukti atau dokumennya sendiri; verifikasi mutlak dilakukan oleh *Admin*.
4. **Price Freeze (`BR-07`):** Perubahan harga katalog unit oleh *Admin* hanya berlaku untuk *Booking* baru dan **tidak** mengubah harga unit yang sudah dikunci pada *Booking* berjalan.
5. **Anti-Double Counting Booking Fee (`BR-06`):** Jika *Booking Fee* ditetapkan sebagai bagian dari Uang Muka (DP), nilai total kewajiban yang harus dibayar konsumen (Booking Fee + DP + Pelunasan/Plafon/Cicilan) tidak boleh melebihi harga kesepakatan bersih dan total tagihan harus selalu rekonsiliatif 100%.
6. **Penahanan Unit 72 Jam & Perlindungan Bukti Menunggu Verifikasi (`PD-01`):** *Booking* awal menahan unit selama 72 jam. Jika melewati 72 jam tetapi sudah ada bukti bayar berstatus `PENDING_VERIFICATION`, sistem otomatis **menahan** pelepasan unit sampai *Admin* memverifikasi atau menolak bukti tersebut.
7. **Eskalasi SLA Verifikasi (`PD-01`):** Bukti pembayaran menggantung `> 24 jam` dieskalasi ke *Admin*; `> 48 jam` atau melewati batas waktu *Booking* dieskalasi ke *Admin* dan *Supervisor* tim.
8. **Kebijakan Pembatalan & Refund (`PD-04`):** Pembatalan tidak diizinkan jika unit sudah `SOLD`, dana KPR sudah mulai dicairkan, atau masih ada bukti pembayaran `PENDING_VERIFICATION`. Dana yang sudah masuk terverifikasi direkonsiliasi jelas menjadi dana hangus (*forfeited*) dan/atau nominal *refund* yang wajib dibuktikan dengan unggah bukti transfer *refund*.
9. **Kebijakan C2 Cash Bertahap (`PD-03`):** Pengakuan penjualan (`CLOSED_WON`) terjadi saat DP lunas dan kontrak PPJB aktif, namun kepemilikan fisik unit tetap `BOOKED` sampai 100% cicilan lunas.
10. **Privasi Informasi Pemegang Unit (`DESIGN.md v2.1` & `OQ-05`):** Untuk mencegah pengambilan kontak pribadi staf lintas tim sambil tetap menjaga keterbukaan status unit, UI hanya menampilkan **Nama Depan Sales** dan **Kode Tim Sales** (contoh: `Fariz • TIM-01`).

### 8.2 Kebijakan Final `TC-01A`
* **Keputusan Final:** Pada transaksi KPR dengan pencairan dana bank bertahap, status unit berubah menjadi **`SOLD` HANYA ketika pencairan KPR mencapai 100% (`FULLY_DISBURSED`)**.
* Selama pencairan masih `NOT_DISBURSED` atau `PARTIALLY_DISBURSED`, status unit **tetap `BOOKED`**.

### 8.3 Lead Scoring (`OQ-04`) dan Transparansi Ketersediaan Unit (`OQ-05`)
* **OQ-04:** Penilaian prospek menggunakan rumus aturan bisnis deterministik 4 indikator (total 100 poin: Budget 30, Timeline 25, Kesiapan Bayar 20, Interaksi/Site Visit 25) tanpa *Machine Learning*, dengan ambang batas `HOT >= 75`, `WARM >= 45`, `COLD < 45`. Hasil *Site Visit* `Not Suitable` tetap selaras dengan bobot ini (bernilai 12 poin pada indikator 4—setara komunikasi dua arah responsif—tanpa bonus minat survei dan tanpa memaksa skor total ke nol).
* **OQ-05:** Seluruh staf aktif dapat melihat ketersediaan unit seluruh proyek beserta indikator pemegang unit (`Nama Depan • Kode Tim`) tanpa melanggar isolasi data prospek (*Lead Isolation*), karena data pribadi calon pembeli tetap terisolasi per *Sales* dan tim.

### 8.4 Keselarasan Antar-Dokumen Referensi
Selama penyusunan dan audit PRD ini, ditemukan empat perbedaan antar-dokumen referensi, yang ditetapkan konsistensinya sebagai berikut:

| Topik | Perbedaan pada Dokumen Referensi | Ketetapan Final dalam PRD Ini |
| :--- | :--- | :--- |
| **Status Kebijakan `TC-01`** | File `01 (v1.1)` masih mencatat `TC-01` sebagai keputusan tertunda (*pending*) dengan opsi `TC-01A` atau `TC-01B`. | Mengacu pada **File `02 (v1.4)`–`06 (v1.1)`** dan **`DESIGN.md (v2.1)`**, kebijakan telah **final ditetapkan sebagai `TC-01A`** (Unit menjadi `SOLD` hanya saat pencairan mencapai 100%). |
| **Privasi Tampilan Pemegang Unit (`OQ-05`)** | File `03 (v1.1)` menyediakan nama lengkap dan nama tim pada lapisan data katalog unit, sedangkan **`DESIGN.md (v2.1)`** mengetatkan tampilan UI. | Mengikuti ketentuan terbaru **`DESIGN.md (v2.1)`**: UI **hanya** menampilkan **Nama Depan Sales** dan **Kode Tim Sales** (contoh: `Fariz • TIM-01`), melarang penayangan nama lengkap, email, maupun nomor HP staf. |
| **Struktur Tahap & Status KPR serta Tautan Tugas KPR** | File `01 (v1.1)` masih mencantumkan ringkasan lama (penolakan di dalam tahap KPR dan 8 transaksi inti). | Mengikuti **File `02 (v1.4)`, `04 (v1.3)`, `06 (v1.1)`, & `DESIGN.md (v2.1)`**: memisahkan **10 tahapan proses KPR** dari **status lifecycle pengajuan** (termasuk pembatalan KPR oleh konsumen), serta mendukung **tautan tugas follow-up langsung ke pengajuan KPR**. |
| **Otoritas Sinkronisasi Sistem & Kedaluwarsa Booking Massal** | File `06 (v1.1)` dan `DESIGN.md (v2.1)` masih mencantumkan *Supervisor* pada pemicu manual **Sinkronisasi Sistem** yang menjalankan evaluasi global tanpa filter tim, sedangkan File `04 (v1.3)` membatasi eksekusi kedaluwarsa *Booking* massal hanya untuk *Admin* dan proses *Cron* sistem. | Mengikuti pembatasan otorisasi ketat pada **File `04 (v1.3)`** dan batas cakupan tim *Supervisor*: **Sinkronisasi Sistem global** (termasuk evaluasi kedaluwarsa *Booking* massal lintas perusahaan) **hanya boleh dijalankan oleh *Admin* atau proses *Cron* terjadwal sistem**. *Supervisor* dilarang menjalankan evaluasi global lintas perusahaan; setiap wewenang pemantauan dan pengingat bagi *Supervisor* wajib terbatas hanya pada **tim aktifnya sendiri**. |

---

## 9. Non-Functional Requirements

### 9.1 Security and Privacy
* **Kontrol Akses Berlapis:** Otorisasi diverifikasi di batas rute, lapisan aplikasi server, dan lapisan basis data berdasarkan peran (`ADMIN`, `SUPERVISOR`, `SALES`), keaktifan akun, serta cakupan tim aktif.
* **Isolasi Data Pelanggan & Staf:** *Sales* tidak dapat mengintip prospek atau transaksi *Sales* lain; *Supervisor* terisolasi pada tim aktifnya; email dan nomor telepon pribadi staf terlindungi dari penambangan data lintas tim.
* **Perlindungan Dokumen Privat:** Seluruh berkas sensitif disimpan pada bucket privat berbatas akses maksimal **5 MB**, divalidasi jenis biner aslinya (*Magic Bytes*) di server untuk mencegah file berbahaya berkedok gambar/PDF, dan hanya diakses lewat *Signed URL* berdurasi **5 menit**.
* **Keamanan Logging & Anti-Manipulasi:** Log server menyensor otomatis kredensial/rahasia; setiap kegagalan di antarmuka hanya menampilkan pesan bisnis aman dan `correlationId` tanpa membocorkan detail internal sistem.

### 9.2 Performance
* Halaman daftar dan dashboard memanfaatkan *Server-Side Rendering* untuk menampilkan data awal dengan cepat dan aman.
* Evaluasi pengingat otomatis saat akses pengguna (*on-access sweep*) dibatasi maksimal 1 kali setiap **5 menit** (*throttled*) agar tidak membebani waktu muat halaman.
* Pencarian dan penyaringan tabel dilengkapi *debounce* serta paginasi yang menjaga responsivitas saat data prospek dan transaksi bertambah.

### 9.3 Reliability and Data Integrity
* **Transaksi Atomik (ACID):** Operasi lintas-entitas (pembuatan *Booking*, verifikasi pembayaran, kedaluwarsa otomatis, persetujuan bank, transisi *Deal*, pembatalan/refund, pengalihan *Lead*, pencairan KPR, perpindahan tahap KPR, dan pembatalan KPR konsumen) dijalankan secara atomik—berhasil menyeluruh atau batal seluruhnya jika satu aturan gagal.
* **Pencegahan Kondisi Balapan & Deadlock:** Penguncian baris unit dan urutan penguncian transaksi yang konsisten mencegah *double booking* maupun konflik saat beberapa *Admin* atau proses *cron* berjalan bersamaan.
* **Sinkronisasi Penyimpanan & Pemulihan:** Unggahan file ke penyimpanan privat dilengkapi pra-cek kondisi transaksi dan pembersihan otomatis (*compensating cleanup*) apabila pencatatan transaksi di basis data gagal.
* **Idempotensi Notifikasi:** Pemrosesan antrean notifikasi dan tugas penagihan menggunakan kunci deduplikasi agar tidak mengirim pengingat ganda.

### 9.4 Usability and Responsive Design
* Mengikuti sistem desain **FIM-Property CRM (`DESIGN.md v2.1`)**: palet profesional *Forest Green* & *Emerald*, kontras teks tinggi untuk kerja harian, ikon standar `Lucide React`, perataan kanan dengan angka tabular (`tabular-nums`) pada seluruh nominal Rupiah, dan tanpa animasi mengganggu.
* **Desktop-First & Mobile-Friendly:** Tampilan *Desktop* (`>= 1280px`) dioptimalkan untuk tabel analitik, pratinjau dokumen berdampingan, dan papan Kanban; tampilan *Mobile* (`< 768px`) menyesuaikan tabel menjadi kartu ringkas dengan target sentuh minimal `44px` untuk mendukung aktivitas lapangan dan *Site Visit*.
* Setiap aksi destruktif atau kritikal wajib disertai dialog konfirmasi eksplisit dan kolom alasan yang jelas.

### 9.5 Maintainability
* Struktur kode disusun secara modular per domain bisnis (Identitas, Katalog, CRM, Transaksi, Notifikasi, Analitik) dengan pemisahan tegas antara tampilan klien, layanan server, dan kalkulator aturan bisnis murni.
* Validasi input sisi server terpusat menggunakan skema terstruktur serta tipe data ketat (*strict typing*) agar mudah dipelihara dan dikembangkan oleh tim pengembang maupun agen pengkodean AI.

---

## 10. Success Criteria

### 10.1 Indikator Keberhasilan Sistem
1. **0% Insiden Double Booking:** Dua permintaan *Booking* bersamaan pada unit yang sama hanya mengizinkan satu pemenang dan menolak permintaan kedua secara bersih.
2. **100% Akurasi Perhitungan Finansial & Skor:** Total jadwal tagihan, sisa piutang, nilai *refund*, rekonsiliasi pencairan KPR, dan perhitungan skor prospek 4 indikator konsisten tanpa selisih pembulatan atau penghitungan ganda.
3. **100% Kepatuhan Batas Akses Role & Privasi:** Tidak ada kebocoran data prospek antar-*Sales*/antar-tim, tidak ada akses dokumen privat tanpa otorisasi, dan pemegang unit hanya tampil sebagai `Nama Depan • Kode Tim`.
4. **Kepatuhan Kebijakan `TC-01A` & C2:** Unit KPR hanya berstatus `SOLD` saat pencairan mencapai 100% (`FULLY_DISBURSED`), dan unit *Cash Bertahap* tetap `BOOKED` hingga seluruh termin lunas meskipun *Deal* sudah `CLOSED_WON`.

### 10.2 Hasil yang Dapat Diuji Saat Demonstrasi
Pada saat demonstrasi aplikasi menggunakan dataset simulasi internal (1 *Admin*, 3 *Supervisor*, 15 *Sales*, 3 Tim, 3 Developer, 5 Proyek, 10 Tipe, 30 Unit, 45 *Leads*), sistem harus berhasil mendemonstrasikan:
* **Skenario 1 (CRM & Scoring):** *Sales* membuat *Lead*, mencatat aktivitas, menyelesaikan *Site Visit*, dan melihat skor + temperatur berubah otomatis sesuai `OQ-04`; *Supervisor* mengalihkan *Lead* dalam satu tim.
* **Skenario 2 (Booking 72 Jam & Pembatalan/Refund):** *Sales* memesan unit (`HELD`), mengunggah bukti transfer (*max 5 MB*), *Admin* menolak lalu *Sales* mengunggah ulang bukti perbaikan, atau *Admin* membatalkan *Booking* dan menyelesaikan bukti *refund*.
* **Skenario 3 (Cash Keras & Cash Bertahap C2):** Pelunasan *Cash Keras* langsung mengubah unit menjadi `SOLD`; aktivasi PPJB *Cash Bertahap* menghasilkan `CLOSED_WON` sambil mempertahankan status unit `BOOKED` hingga termin terakhir lunas.
* **Skenario 4 (KPR Bertahap & `TC-01A`):** *Sales* mengunggah berkas fiktif KPR, *Admin* memverifikasi, memajukan tahap ke bank, mencatat SP3K dengan skenario *Top-Up DP*, menjadwalkan akad, mencatat pencairan `PRIMARY` (unit tetap `BOOKED`), dan mencatat pencairan `SUBSEQUENT` hingga 100% (unit otomatis menjadi `SOLD`).
* **Skenario 5 (Keamanan & Pengingat):** Percobaan akses lintas *Sales*/tim atau akses langsung URL dokumen oleh pihak tak berhak ditolak; tombol **Sinkronisasi Sistem** oleh *Admin* memproses *Booking* kedaluwarsa dan eskalasi SLA 24/48 jam dengan benar (sedangkan *Sales* dan *Supervisor* ditolak jika mencoba evaluasi global lintas perusahaan).

---

## 11. Project Constraints & Assumptions

### 11.1 Batasan Proyek (*Constraints*)
* **Lingkup Bisnis Internal:** Sistem hanya dirancang untuk alur kerja internal PT FIM-Property (*single-company*), bukan platform *marketplace* properti publik.
* **Teknologi & Infrastruktur:** Dibangun menggunakan *web stack* **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, dan **Supabase** (Auth, PostgreSQL, Private Storage) yang dapat dijalankan di lingkungan lokal maupun *cloud* (Vercel/Supabase) dengan batasan ukuran unggahan maksimal **5 MB** per file.
* **Batasan Fitur Non-ML & Non-Cicilan Bank:** Proyek tidak menyertakan komponen *Machine Learning* eksternal maupun modul penagihan cicilan bulanan nasabah setelah akad/pencairan KPR bank.
* **Batasan Waktu & Akademik:** Cakupan fitur dikunci pada modul inti CRM hingga pencairan dana KPR agar dapat diselesaikan, diuji, dan didemonstrasikan secara tuntas dalam batas waktu proyek.

### 11.2 Asumsi Proyek (*Assumptions*)
* Setiap staf (*Admin*, *Supervisor*, *Sales*) memiliki email kerja yang valid dan akunnya didaftarkan oleh *Admin* sebelum menggunakan sistem.
* Setiap *Supervisor* dan *Sales* aktif ditempatkan pada tepat satu tim penjualan aktif agar isolasi dan pelaporan data tim berjalan semestinya.
* Seluruh dokumen persyaratan KPR (KTP, NPWP, slip gaji, rekening koran) dan bukti transfer yang digunakan pada fase pengujian dan demonstrasi akademik adalah **data dan dokumen fiktif/simulasi** untuk menjaga privasi dan keamanan data.
* Koneksi internet/jaringan lokal tersedia selama operasional karena verifikasi sesi, transaksi atomik, dan pembuatan tautan dokumen privat diproses secara langsung di server.
