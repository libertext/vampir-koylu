# 🧛 Vampir Köylü

İki sürüm var:

### 1) `vampir-koylu.html` — Tek dosya, elden ele (kurulum yok) ⭐
**Sadece `vampir-koylu.html` dosyasını çift tıklayıp aç.** Sunucu yok, internet yok, kurulum yok. Bir telefon/tablet sırayla dolaşır; uygulama **moderatör + anlatıcı** olur.

- 📖 Kurucu **mekân** ve **zaman** seçer, uygulama atmosferik hikâyeyi anlatır
- 🎭 Roller gizlice dağıtılır ("Sen vampirsin" der) — telefonu sırayla herkese ver, herkes rolünü **basılı tutup** gizlice görür
- 🧛 **Vampir sayısını** kurucu ayarlar · 💉 Doktor birini korur · 🔮 Gözcü kimlik inceler
- ⏱️ **Seçim süresi** (saniye) ayarlanır — gece seçimleri ve oy verme için geri sayım
- 🗳️ **Oylama uygulamadan**: telefon sırayla dolaşır, herkes gizli oy verir; sonuçta **kim kime kaç oy vermiş** görünür, **oy çokluğuyla infaz** olur

Telefona atmak için: dosyayı WhatsApp/AirDrop/e-posta ile gönder ya da tarayıcıda açıp "Ana ekrana ekle" de.

---

### 2) Sunucu sürümü — Herkes kendi telefonunda, oda kodu (PWA)

Arkadaşlarınla oynanan gerçek-zamanlı parti oyunu. **Herkes kendi telefonundan** katılır, bir oda koduyla buluşur. Ayrı bir "anlatıcı" gerekmez — oyunu uygulama yönetir. Kurulabilir bir **PWA**'dır: tarayıcıda açıp "Ana ekrana ekle" dediğinde indirilmiş uygulama gibi çalışır.

## Özellikler

- 🔴 Sunucu-otoriter oyun motoru (hile zor, roller gizli)
- 📱 Mobil-öncelikli, kurulabilir PWA (çevrimdışı uygulama kabuğu)
- 👥 4–20 oyuncu, oda kodu ile katılım
- 🎭 Roller: **Vampir 🧛 · Köylü 🧑‍🌾 · Doktor 💉 · Gözcü 🔮** (oyuncu sayısına göre otomatik dağıtılır)
- 🌙 Gece / ☀️ Gündüz / ⚖️ Oylama döngüsü, otomatik ilerleme
- 🩸 Kazanma koşulları ve tur sonu rol açıklaması
- ⚙️ **Sıfır bağımlılık** — sadece Node.js ile çalışır

## Çalıştırma

```bash
cd vampir-koylu
npm start        # ya da: node server.js
```

Sunucu açılınca terminalde iki adres yazar:

```
• Bu cihaz:   http://localhost:3000
• Aynı Wi-Fi: http://192.168.x.x:3000   ← telefonlar bunu açsın
```

**Aynı ortamdaki herkes** telefon tarayıcısında `http://192.168.x.x:3000` adresini açar (bilgisayarla aynı Wi-Fi'de olmaları yeterli). Bir kişi **Yeni Oda Kur** der, çıkan 4 haneli kodu söyler; diğerleri **Odaya Katıl** ile girer. Kurucu **Oyunu Başlat**'a basınca herkes kendi rolünü telefonunda görür.

> Port değiştirmek için: `PORT=8080 node server.js`

## Nasıl oynanır?

1. **Lobi** — Kurucu kodu paylaşır, herkes katılır (min 4 kişi).
2. **Gece** 🌙 — Vampirler ortak bir kurban seçer, Doktor birini korur, Gözcü birinin vampir olup olmadığını öğrenir. (Herkes seçince otomatik geçer; kurucu isterse hızlandırır.)
3. **Gündüz** ☀️ — Gece kimin öldüğü açıklanır, köy tartışır.
4. **Oylama** ⚖️ — Herkes asmak istediği kişiye oy verir. En çok oyu alan asılır ve rolü açığa çıkar.
5. Vampirler bitene kadar **Köylüler**, vampir sayısı diğerlerine eşitlenince **Vampirler** kazanır.

## İnternete açmak (isteğe bağlı)

Herkesin aynı Wi-Fi'de olması yeterlidir. Uzaktan/kalıcı oynatmak istersen bu klasörü bir Node hostuna (Render, Railway, Fly.io, kendi VPS'in) at ve `node server.js` çalıştır — `PORT` ortam değişkenini host verir. Kod tek dosyalık, bağımlılıksız olduğu için dağıtımı kolaydır.

## İkonları yeniden üretmek (isteğe bağlı)

`public/icon.svg` kaynak ikondur. PNG'leri yeniden üretmek için:

```bash
npm i --no-save @resvg/resvg-js
node -e 'const{Resvg}=require("@resvg/resvg-js"),fs=require("fs");const s=fs.readFileSync("public/icon.svg","utf8");for(const[n,w]of Object.entries({"icon-192.png":192,"icon-512.png":512,"icon-maskable.png":512,"icon-180.png":180})){fs.writeFileSync("public/"+n,new Resvg(s,{fitTo:{mode:"width",value:w}}).render().asPng())}'
```

## Teknik notlar

- İstemci durumu ~1.6 sn'de bir `/api/state` ile çeker (kısa polling). Küçük gruplar için fazlasıyla yeterli ve WebSocket'ten çok daha az kırılgan.
- Oyun durumu bellekte tutulur; 3 saat hareketsiz odalar otomatik silinir.
- Her oyuncuya yalnızca görmesi gereken bilgi gönderilir (roller sunucuda gizlenir).
