# 🚀 Kalıcı online link (7/24) — Kurulum rehberi

Amaç: Paylaşacağın sabit bir link (ör. `https://vampir-koylu.onrender.com`) olsun; arkadaşların bu linke kendi telefonlarından girip oda koduyla oynasın. Bilgisayarın kapalıyken bile çalışır.

Kredi kartı istemeyen, ücretsiz ve en kolay yol: **GitHub + Render**. Toplam ~5 dakika.

> Hazırladığım her şey `vampir-koylu` klasöründe. Ayrıca kolay yükleme için `vampir-koylu-deploy.zip` oluşturdum.

---

## Adım 1 — Kodu GitHub'a koy

GitHub hesabın yoksa [github.com](https://github.com) → ücretsiz kayıt ol.

**En kolay yöntem (terminal gerekmez):**
1. [github.com/new](https://github.com/new) → Repository name: `vampir-koylu` → **Create repository**.
2. Açılan sayfada **"uploading an existing file"** bağlantısına tıkla.
3. `vampir-koylu-deploy.zip`'i açıp **içindeki tüm dosyaları** (server.js, package.json, public/, Dockerfile, render.yaml …) sürükleyip bırak. → **Commit changes**.
   - Önemli: zip'in **içindeki** dosyalar repo kök dizininde olmalı (server.js en üstte görünmeli).

**Terminali tercih edersen:** (repoyu GitHub'da oluşturduktan sonra)
```bash
cd vampir-koylu
git remote add origin https://github.com/KULLANICI_ADIN/vampir-koylu.git
git branch -M main
git push -u origin main
```
(Depo zaten `git init` + ilk commit ile hazır.)

---

## Adım 2 — Render'a bağla ve yayına al

1. [render.com](https://render.com) → **Get Started** → GitHub ile giriş yap (ücretsiz, kart yok).
2. Panelde **New +** → **Web Service**.
3. **Build and deploy from a Git repository** → GitHub'ı yetkilendir → `vampir-koylu` reposunu seç → **Connect**.
4. Ayarlar otomatik gelir (repodaki `render.yaml` sayesinde). Gelmezse elle:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. **Create Web Service** → 1-2 dakika bekle. Üstte yeşil **Live** yazınca hazır.
6. Sayfanın en üstündeki linktir senin adresin: `https://vampir-koylu-xxxx.onrender.com`

Bu linki paylaş. Herkes açar → **Yeni Oda Kur** / **Odaya Katıl** → oda koduyla oynarsınız. 🎉

---

## Bilinmesi gerekenler (ücretsiz plan)

- **İlk açılış yavaş:** 15 dk kimse kullanmazsa servis "uyur". Linke ilk giren ~30-50 sn bekler, sonra herkese hızlıdır. (Oyun başında bir kişi linki önceden açsın, ısınsın.)
- **Odalar bellekte:** Servis yeniden başlarsa açık odalar silinir; sorun değil, yeni oda kurarsınız.
- **Kart gerekmez, süre sınırı yok** — ücretsiz web servisi kalıcıdır.

## Alternatif hostlar (istersen)

Repoda `Dockerfile` de var; şu hostların hepsi aynı kodu çalıştırır:
- **Koyeb** ([koyeb.com](https://koyeb.com)) — ücretsiz, kart yok; "Deploy" → GitHub reposu → otomatik.
- **Railway** ([railway.app](https://railway.app)) — GitHub'dan tek tık; ücretsiz kota (bazen kart doğrulaması ister).
- **Fly.io** — `flyctl deploy` (kart ister).

Hepsinde ayar aynı: başlat komutu `node server.js`, port ortam değişkeni `PORT` (kod bunu otomatik kullanır).

---

Takılırsan ekran görüntüsünü at, adım adım ilerleyelim.
