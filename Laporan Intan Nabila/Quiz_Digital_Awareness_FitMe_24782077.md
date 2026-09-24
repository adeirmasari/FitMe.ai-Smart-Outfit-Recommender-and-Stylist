**Nama :** INTAN NABILA

**NPM  :** 24782077

**Mata Kuliah :** Internet Programming II

## Bagian 1. Identitas dan Topik Proyek Aplikasi
Nama aplikasinya: FitMe.ai
Deskripsi dan tujuan utamanya: Proyek Fitme.ai ini kami buat untuk menjawab sebuah permasalahan yang bisa dibilang sangat sepele tapi sering kali membuat orang bingung dan membuang waktu cukup lama untuk berpikir, yaitu memilih baju sehari-hari serta event atau acara tertentu. Sistem kerjanya berbasis web. Pengguna cukup memasukkan foto pakaian mereka dan memilih acaranya seperti apa. Setelah itu, biarkan sistem yang akan mengecek jenis pakaian dan warnanya, lalu memunculkan rekomendasi styling secara otomatis. Untuk otak utamanya, kami sepakat memakai model Qwen2.5-VL keluaran Alibaba Group. Alasan memilih model ini murni karena dia memang sangat ahli dalam membaca dan memproses gambar. Ini adalah alternatif yang pas untuk orang-orang yang merasa jasa konsultasi stylist terlalu mahal. 
Target pengguna kita Adalah dikalangan remaja atau anak muda mulai dari usia 17 sampai 30 tahun. Mereka biasanya butuh saran fashion yang instan dan sangat praktis.

## Bagian 2. Resume Modul Digital Awareness
**Module 1:** There's a whole new world out there!
Teknologi masa kini membuat berbagai pekerjaan harian jadi jauh lebih instan. Banyak hal yang awalnya harus diurus secara manual, tetapi sekarang sudah berpindah ke teknologi digital. Manfaatnya memang sangat terasa, tapi kita juga dituntut untuk punya skill atau kemampuan dalam dasar komputer juga agar tidak ketinggalan zaman.

**Module 2:** You'll Need Some Basic Tools
Sistem operasi itu fungsinya menghubungkan kita dengan perangkat yang terlalu keras. Dalam pemakaian sehari-hari, kita harus membiasakan menyusun file dalam folder dengan nama yang rapi. Urusan keamanan juga tidak kalah penting. Kata sandi harus dibuat panjang, menggabungkan huruf dan angka, serta tidak memakai data pribadi yang terlalu gampang ditebak orang.

**Module 3:** This is how you get around and find what you're looking for
Pencarian file di laptop dan pencarian informasi di internet itu beda metodenya. Kalau di internet, kita sangat bergantung pada pemilihan kata kunci. Selain itu, modul ini juga menekankan pentingnya mengetahui perbedaan antara karya berhak cipta atau copyright dan karya bebas atau public domain supaya kita tidak sembarangan melanggar karya hak cipta orang lain.

**Module 4:** It just keeps getting better
AI memang sangat membantu, tapi tetap ada risiko error dan bias. Saat kita berinternet, etiket itu wajib dijaga. Jangan gampang membagikan berita hoaks dan biasakan bertanggung jawab atas semua hal yang kita posting.
Module 5: Even Though It's Digital, It is Real, With Real Consequences
Data pribadi (PII) itu sangat sensitif. Sekali jejak digital tersebar, susah banget buat menghapusnya dan efeknya bisa langsung ke kehidupan nyata kita. Kalau ada cyberbullying, mending laporkan saja. Kita juga harus selalu waspada dengan penipuan online dan menghindari barang bajakan.
Module 6: Learn About Anything and Everything
Troubleshooting teknis itu kemampuan wajib. Kalau ada masalah, cek dulu hal-hal paling dasar seperti kabel, koneksi internet, atau mencoba melakukan restart. Karena literasi digital setiap orang itu beda-beda, kita harus punya kemauan buat terus belajar dan membikin aplikasi yang gampang dipakai.

## Bagian 3. Hubungan dan Implementasi pada Topik Proyek
1.	**Bagaimana rancangan aplikasi dapat mempermudah tugas sehari-hari pengguna? Apa proses “analog/tradisional” dari topik proyekmu yang berhasil disederhanakan menjadi digital**.
Jawabannya : FitMe.ai memangkas proses mencoba pakaian yang biasanya memakan waktu lama. Prosesnya dibuat jadi tiga tahap saja: unggah foto, pilih acara, lalu dapat saran. Semua riwayatnya otomatis tersimpan di dalam sistem, jadi pengguna tidak perlu repot-repot screenshot atau mencatat rekomendasinya.

2.	 **Jika aplikasimu memiliki fitur penyimpanan file atau pendaftaran akun, bagaimana kamu merancang struktur penyimpanan file yang intuitif bagi pengguna awam? Bagaimana kamu membantu pengguna membuat kata sandi yang aman?**
Jawabannya : Sistem secara otomatis akan mengurus penyimpanan file. Foto yang masuk akan ditaruh ke dalam riwayat secara berurutan. Untuk urusan keamanan di server, nama file fotonya langsung diacak menggunakan UUID supaya tidak saling tertukar dengan user atau pengguna lain. Waktu registrasi akun, ada indikator kekuatan kata sandi yang langsung bereaksi waktu pengguna mengetik. Aturannya ketat, minimal harus 8 karakter. Data sandi ini cuma disimpan dalam bentuk hash acak di database, jadi sangat aman.

3.	**Bagaimana kamu mendesain fitur pencarian (search bar) di dalam aplikasi agar pengguna dapat mencari informasi dengan mudah? Selain itu, sebutkan asset eksternal yang digunakan dalam aplikasi (library, API, gambar, icon). Apakah asset-aset tersebut berlisensi open-source, public domain, atau memiliki hak cipta khusus yang wajib dicantumkan?**
Jawabannya : Saya sengaja menaruh fitur pencarian di halaman riwayat. Pengguna bisa langsung mengetik nama acara atau warna bajunya, dan hasilnya akan langsung difilter otomatis. Terkait aset, framework backend Django memakai lisensi open-source BSD. Untuk pengolahan gambarnya pakai Pillow (lisensi HPND) dan model AI Qwen2.5-VL memakai lisensi Apache 2.0. Ikon webnya menggunakan lisensi MIT. Semua rincian dicatat dan transparan di dalam berkas LICENSES repositorinya.

4.	**Jika aplikasimu memiliki fitur interaksi social, bagaimana kamu mencegah pelanggaran etika digital di dalamnya?** Jika aplikasi menggunakan fitur pintar berbasis AI, bagaimana kamu memastikan AI tersebut bekerja secara etis dan bertanggung jawab bagi pengguna?
Jawabannya : Aplikasi ini sifatnya murni privat dan tidak ada fitur jejaring media sosial, jadi risiko perundungan antara pengguna dan user bisa dicegah sepenuhnya. Soal etika AI, prompt model sudah saya batasi dengan ketat supaya hanya fokus menganalisis pakaian dan warnanya saja. Model dilarang keras menilai wajah atau bentuk tubuh penggunanya. Setiap hasil saran juga saya beri label khusus untuk mengingatkan pengguna bahwa ini adalah analisis AI, bukan sebuah keharusan mutlak.

5.	**Data pribadi sensitive (PII) apa saja yang dikumpulkan oleh aplikasimu? Bagaimana cara kamu melindungi data tersebut agar tidak bocor atau disalahgunakan? Bagaimana aplikasi meminimalkan Risiko pengguna menjadi korban penipuan siber di platform mu?**
Jawabannya : Foto pakaian itu termasuk data sensitif karena bisa memperlihatkan kondisi lingkungan sekitar. Solusinya, sistem saya akan langsung menghapus data metadata lokasi (GPS) pada foto sebelum disimpan. Keamanannya memakai HTTPS dan tiap akun datanya terisolasi. Aplikasi ini juga tidak mengumpulkan data nomor handphone.

6.	**Ketika aplikasi mengalami masalah teknis (misalnya kehilangan koneksi internet atau kegagalan memuat data), bagaimana aplikasi mengomunikasikannya kepada pengguna? Tuliskan contoh rancangan pesan error ramah pengguna yang memandu pengguna melakukan troubleshooting mandiri secara mudah**
Jawabannya : Pesan error saya rancang tanpa memakai istilah teknis yang bikin pusing pengguna. Kalau koneksi internet mereka tiba-tiba putus, pesan yang muncul bakal seperti ini: terputus nih. Sepertinya perangkatmu sedang offline, jadi fotonya belum bisa dianalisis. Coba pastikan Wi-Fi atau data seluler sudah nyala ya. Kalau sudah terhubung, klik Coba Lagi. Tenang saja, fotomu tidak hilang.


