# Penjelasan Sistem untuk User / Stakeholder Non-Teknis

## 1. Tiga Area Kerja

Platform memiliki tiga area utama yang tetap berada dalam Case yang sama.

### SHADOW
Tempat membuat Case, menentukan target, mencari profile, menjalankan pencarian, dan menyusun Findings.

### ECHO
Tempat melihat siapa terhubung dengan siapa, memeriksa relasi, dan membangun peta pengetahuan investigasi.

### SPECTRA
Tempat memonitor aktivitas sosial, berita, media, engagement, sentiment, dan perkembangan isu.

Saat berpindah SHADOW → ECHO → SPECTRA, user tidak “keluar” dari Case; user hanya mengganti alat kerja.

## 2. Menambahkan Target

Setelah Case dibuat, user menambahkan Target.

Sistem pertama-tama mencari apakah profile target tersebut sudah dikenal oleh Workspace.

Jika sudah ada:
- profile dapat digunakan kembali;
- user dapat membandingkan identity match;
- freshness informasi dapat diperiksa;
- refresh lookup dapat dilakukan bila perlu.

Jika belum ada:
- SHADOW membuat Subject baru;
- lookup dijalankan ke source yang authorized;
- hasil muncul sebagai Candidate;
- setelah Candidate yang benar dikonfirmasi, canonical profile dibuat.

## 3. Mengapa Candidate Tidak Langsung Menjadi Profile?

Karena nama atau data yang mirip belum tentu menunjuk orang yang sama. Platform menjaga Candidate terpisah sampai identity cukup jelas.

## 4. Profile Dapat Digunakan Ulang

Satu canonical Entity dapat digunakan pada beberapa Case.

Namun:
- Evidence Case A tidak otomatis terlihat di Case B;
- Finding Case A tidak otomatis terlihat di Case B;
- relasi sensitif dapat tetap Case-specific.

Ini memungkinkan reuse identity tanpa membocorkan investigasi lain.

## 5. Monitoring di SPECTRA

SPECTRA dapat memantau account/entity/topic dan menemukan:
- post baru;
- mention/reply/comment;
- berita;
- video/media;
- engagement tinggi;
- sentiment berubah;
- pola interaction;
- kemungkinan coordinated activity.

SHADOW hanya menampilkan summary dan highlights penting agar Case Overview tetap ringkas.

## 6. Jika SPECTRA Menemukan Orang Baru

Misalnya berita menyatakan Target A bertemu dengan B.

Platform dapat:
1. menyimpan berita sebagai Evidence;
2. mengekstrak B sebagai Candidate;
3. menampilkan kemungkinan hubungan A–B di ECHO;
4. mengirim B ke Profile Inbox SHADOW;
5. SHADOW mencari apakah B sudah ada atau melakukan lookup baru;
6. setelah B teridentifikasi, ECHO mengganti Candidate B dengan canonical Entity B;
7. investigator menentukan apakah relationship tersebut layak dikonfirmasi sebagai Case Knowledge.

## 7. Mengapa Relasi Tidak Otomatis Confirm?

Platform membedakan:
- apa yang source menunjukkan;
- apa yang algorithm/model menduga;
- apa yang investigator konfirmasi.

Ini mengurangi risiko kesimpulan otomatis yang salah.

## 8. Evidence

Evidence berarti:
> “Source ini menunjukkan informasi ini pada waktu tertentu.”

Evidence tidak selalu berarti:
> “Informasi ini pasti benar.”

Karena itu Finding harus dibangun dari evidence dan keputusan yang dapat dipertanggungjawabkan.

## 9. ECHO Graph

ECHO dapat menampilkan beberapa layer:
- confirmed/reusable knowledge;
- Case-specific relationship;
- observed activity;
- analytical suggestions.

High-volume post tidak semuanya menjadi node. Activity biasanya ditampilkan aggregated dan detail dibuka di SPECTRA.

## 10. Alert dan Finding

Alert berarti sistem mendeteksi sesuatu yang membutuhkan perhatian.

Finding adalah kesimpulan investigator.

Alert dapat menjadi alasan untuk membuka investigation baru, tetapi tidak otomatis menjadi Finding.

## 11. Audit dan History

Sistem menjaga riwayat:
- siapa melakukan perubahan;
- kapan;
- terhadap resource apa;
- keputusan apa yang dibuat;
- source/evidence apa yang mendukungnya.

Perubahan penting tidak dihapus atau ditimpa diam-diam.
