const { Client, GatewayIntentBits, Events, Partials, REST, Routes } = require('discord.js');
const Groq = require('groq-sdk');
const axios = require('axios');
const pdf = require('pdf-parse');

// ============================================================
// 1. AYARLAR (KENDİ BİLGİLERİNİ GİR)
// ============================================================
const DISCORD_TOKEN = 'KENDİ DİSCORD BOTUN TOKENİ';
const GROQ_API_KEY = 'GROQ APİ KEYİNİ GİR';
const OZEL_KANAL_ID = 'KANAL İD';
const CLIENT_ID = 'BOTUN CLİENT ID';
const SUNUCU_ID = 'SUNUCU İD';


// Botun kişiliği
const SISTEM_MESAJI = `
Sen Zottirik adında yardımsever, uzman ve hafif esprili bir yazılım asistanısın.
Metin tabanlı dosyaları (PDF, TXT, Kod) okuyup analiz edebilirsin.
Kurallar:
1. Kod paylaşırken MUTLAKA Discord Markdown formatı kullan (Örn: \`\`\`python ... \`\`\`).
2. Uzun açıklamaları maddeler halinde yap.
3. Türkçe konuş.
`;

// ============================================================
// 2. KURULUMLAR
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

const groq = new Groq({ apiKey: GROQ_API_KEY });
const sohbetGecmisi = new Map();

// --- SLASH KOMUT TANIMLAMASI ---
const commands = [
    {
        name: 'rozet-test',
        description: 'Geliştirici rozeti almak için test komutu!',
    },
];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

// ============================================================
// 3. BOT BAŞLANGICI VE KOMUT YÜKLEME
// ============================================================
client.once(Events.ClientReady, async (c) => {
    console.log(`✅ ${c.user.tag} (Zottirik) göreve hazır!`);

    // YENİ: Slash komutlarını SADECE BU SUNUCUYA kaydet (Anında görünür)
    try {
        console.log('Slash komutları sunucuya yükleniyor...');

        if (CLIENT_ID.length < 10 || SUNUCU_ID.length < 10) {
             console.log('⚠️ UYARI: CLIENT_ID veya SUNUCU_ID eksik! Komut yüklenemedi.');
        } else {
            // 🔥 DEĞİŞİKLİK BURADA: applicationGuildCommands kullanıyoruz
            await rest.put(
                Routes.applicationGuildCommands(CLIENT_ID, SUNUCU_ID),
                { body: commands },
            );
            console.log('✅ Slash komutu (/rozet-test) bu sunucu için başarıyla yüklendi!');
        }
    } catch (error) {
        console.error('Komut yükleme hatası (ID\'leri kontrol et):', error);
    }

    if (OZEL_KANAL_ID.length > 15) console.log(`🗣️ Özel kanal modu aktif.`);
});

// ============================================================
// 4. SLASH KOMUTU GELDİĞİNDE ÇALIŞACAK KISIM
// ============================================================
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'rozet-test') {
        await interaction.reply('🎉 Harika! Bu komutu kullandığın için 24 saat içinde geliştirici rozetini almaya hak kazanacaksın. Zottirik seninle gurur duyuyor!');
    }
});


// ============================================================
// 5. NORMAL MESAJ GELDİĞİNDE (ESKİ SİSTEM - AYNEN DEVAM)
// ============================================================
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    const etiketlendi = message.mentions.users.has(client.user.id);
    const soruKomutu = message.content.startsWith('!soru ');
    const ozelMesaj = message.channel.type === 1 || !message.guild;
    const ozelKanalda = message.channel.id === OZEL_KANAL_ID;
    const dosyaVar = message.attachments.size > 0; 

    if (etiketlendi || soruKomutu || ozelMesaj || ozelKanalda || dosyaVar) {
        if (!(etiketlendi || soruKomutu || ozelMesaj || ozelKanalda)) return;
        try {
            await message.channel.sendTyping();
            let kullaniciMesajiText = message.content.replace('!soru ', '').replace(`<@${client.user.id}>`, '').trim();
            let eklenenDosyaIcerigi = "";
            if (dosyaVar) {
                const attachment = message.attachments.first();
                const dosyaTipi = attachment.contentType;
                const dosyaAdi = attachment.name.toLowerCase();
                if (dosyaTipi === 'application/pdf' || dosyaAdi.endsWith('.pdf')) {
                    await message.reply("📂 PDF dosyasını okuyorum...");
                    eklenenDosyaIcerigi = await pdfMetniGetir(attachment.url);
                } else if ((dosyaTipi && dosyaTipi.startsWith('text/')) || dosyaAdi.endsWith('.js') || dosyaAdi.endsWith('.py') || dosyaAdi.endsWith('.html') || dosyaAdi.endsWith('.css') || dosyaAdi.endsWith('.json') || dosyaAdi.endsWith('.txt')) {
                    await message.reply("📄 Metin dosyasını okuyorum...");
                    eklenenDosyaIcerigi = await txtMetniGetir(attachment.url);
                } else if (dosyaTipi && dosyaTipi.startsWith('image/')) {
                     await message.reply("🚫 Şu an için resim görme özelliğim kapalıdır. Sadece metin ve PDF dosyalarını okuyabilirim."); return;
                } else {
                     if (kullaniciMesajiText) { await message.reply("⚠️ Bu dosya türünü okuyamıyorum ama soruna cevap veriyorum..."); } else { return await message.reply("⚠️ Bu dosya türünü okuyamıyorum (Sadece PDF ve Metin/Kod)."); }
                }
            }
            if (!kullaniciMesajiText && !eklenenDosyaIcerigi) return;
            if (!kullaniciMesajiText && eklenenDosyaIcerigi) kullaniciMesajiText = "Bu dosyayı analiz et.";

            const kanalID = message.channel.id;
            if (!sohbetGecmisi.has(kanalID)) { sohbetGecmisi.set(kanalID, [{ role: 'system', content: SISTEM_MESAJI }]); }
            const gecmis = sohbetGecmisi.get(kanalID);
            let finalMesaj = kullaniciMesajiText;
            if (eklenenDosyaIcerigi) { finalMesaj += `\n\n--- EKLENEN DOSYA İÇERİĞİ BAŞLANGICI ---\n${eklenenDosyaIcerigi}\n--- EKLENEN DOSYA İÇERİĞİ SONU ---`; }
            gecmis.push({ role: 'user', content: finalMesaj });
            if (gecmis.length > 15) gecmis.splice(1, 2);
            const chatCompletion = await groq.chat.completions.create({
                messages: gecmis,
                model: 'llama-3.3-70b-versatile',
                temperature: 0.7,
            });
            const cevap = chatCompletion.choices[0]?.message?.content || "Cevap alınamadı.";
            gecmis.push({ role: 'assistant', content: cevap });
            const parcalar = mesajBol(cevap);
            for (const parca of parcalar) { await message.reply(parca); }
        } catch (error) {
            console.error("HATA DETAYI:", error);
            let hataMesaji = "⚠️ Bir hata oluştu.";
            if (error.message.includes('413')) hataMesaji += " Dosya içeriği çok uzun, hepsini okuyamadım.";
            await message.reply(`${hataMesaji} Hafızayı temizliyorum.`);
            sohbetGecmisi.delete(message.channel.id);
        }
    }
});

// ============================================================
// 6. YARDIMCI FONKSİYONLAR
// ============================================================
async function pdfMetniGetir(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const data = await pdf(response.data);
        return data.text.slice(0, 100000);
    } catch (e) { console.error("PDF Okuma Hatası:", e); return "HATA: PDF dosyası okunamadı."; }
}
async function txtMetniGetir(url) {
    try {
        const response = await axios.get(url, { responseType: 'text' });
        return response.data.slice(0, 100000);
    } catch (e) { console.error("TXT Okuma Hatası:", e); return "HATA: Metin dosyası okunamadı."; }
}
function mesajBol(text, limit = 1900) {
    if (text.length <= limit) return [text];
    const chunks = [];
    let currentChunk = "";
    const lines = text.split('\n');
    let inCodeBlock = false;
    for (const line of lines) {
        if (line.includes('```')) inCodeBlock = !inCodeBlock;
        if (currentChunk.length + line.length + 1 > limit) {
            if (inCodeBlock) { currentChunk += "```"; chunks.push(currentChunk); currentChunk = "```\n(Devam...)\n" + line + "\n";
            } else { chunks.push(currentChunk); currentChunk = line + "\n"; }
        } else { currentChunk += line + "\n"; }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
}

client.login(DISCORD_TOKEN);