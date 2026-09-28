import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

interface CampusDocument {
  id: string;
  title: string;
  docNumber: string;
  category: 'peraturan' | 'sop' | 'ukt' | 'kalender' | 'beasiswa' | 'surat_edaran' | 'lainnya';
  effectiveDate: string;
  summary: string;
  content: string;
  sourceUrl?: string;
  isBuiltIn?: boolean;
}

const DOCUMENTS_FILE = path.resolve(__dirname, 'data', 'documents.json');
const DEFAULT_DOCUMENTS_FILE = path.resolve(__dirname, 'data', 'defaultDocuments.json');

// Helper to get active campus documents from disk
function getCampusDocuments(): CampusDocument[] {
  try {
    if (fs.existsSync(DOCUMENTS_FILE)) {
      const data = fs.readFileSync(DOCUMENTS_FILE, 'utf-8');
      return JSON.parse(data);
    }
    if (fs.existsSync(DEFAULT_DOCUMENTS_FILE)) {
      const defaultData = fs.readFileSync(DEFAULT_DOCUMENTS_FILE, 'utf-8');
      const docs = JSON.parse(defaultData);
      fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(docs, null, 2), 'utf-8');
      return docs;
    }
  } catch (err) {
    console.error('Error loading documents:', err);
  }
  return [];
}

// Helper to save documents to disk
function saveCampusDocuments(docs: CampusDocument[]) {
  try {
    const dataDir = path.dirname(DOCUMENTS_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(DOCUMENTS_FILE, JSON.stringify(docs, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving documents:', err);
  }
}

// System Instruction dasar untuk Helpdesk Administrasi Politeknik Negeri Sriwijaya (Polsri)
function buildSystemInstruction(docs: CampusDocument[]): string {
  const docsText = docs
    .map(
      (d, i) => `=== [DOKUMEN RESMI #${i + 1}] ===
JUDUL DOKUMEN: ${d.title}
NOMOR SK / ATURAN: ${d.docNumber}
KATEGORI: ${d.category} (Berlaku: ${d.effectiveDate})
RINGKASAN: ${d.summary}
ISI TEKS RESMI:
${d.content}
`
    )
    .join('\n\n');

  return `
Anda adalah "Bantuku", asisten virtual helpdesk resmi layanan administrasi dan informasi kampus Politeknik Negeri Sriwijaya (Polsri), Palembang.
Tugas utama Anda adalah membantu mahasiswa, calon mahasiswa, alumni, dan masyarakat umum dalam memahami prosedur, persyaratan, jadwal, dan alur administrasi di lingkungan kampus Politeknik Negeri Sriwijaya.

ACUAN DAN SITUS UTAMA:
- Website resmi utama kampus adalah **https://polsri.ac.id/**.
- Situs ini adalah pusat informasi resmi Polsri yang dapat diakses secara publik oleh siapa saja tanpa perlu login dan tanpa subdomain www.
- ATURAN MUTLAK: JANGAN PERNAH menyarankan domain "siakad.polsri.ac.id" ataupun "www.polsri.ac.id". SELURUH informasi, pengumuman akademik, jadwal her-registrasi, panduan layanan surat, formulir, pengumuman UKT, kalender akademik, dan informasi kemahasiswaan WAJIB merujuk dan mengarahkan ke website resmi: **https://polsri.ac.id/**.
- Setiap kali memberikan jawaban spesifik terkait kampus, SELALU sertakan tautan resmi **https://polsri.ac.id/** sebagai sumber acuan dan link yang benar.

BASIS PENGETAHUAN DOKUMEN RESMI KAMPUS POLSRI (SUMBER KEBENARAN UTAMA / GROUND TRUTH):
Berikut adalah dokumen resmi, Peraturan Akademik, SK Direktur, Kalender, dan SOP resmi yang saat ini tersimpan di sistem:

${docsText}

ATURAN PENGGUNAAN DOKUMEN RESMI:
1. Ketika mahasiswa atau civitas kampus bertanya mengenai aturan, jadwal, syarat, atau alur, Anda WAJIB memprioritaskan dan mengutip isi DOKUMEN RESMI di atas secara presisi.
2. Jika relevan, sebutkan nama dokumen atau nomor SK / pasal terkait (contoh: "Berdasarkan Peraturan Akademik Polsri Pasal 24 tentang Cuti Akademik..." atau "Sesuai SK Direktur tentang Keringanan UKT...").
3. Jangan membuat-buat syarat yang tidak ada dalam dokumen.

Identitas & Sikap:
- Nama: Bantuku (Helpdesk Resmi Polsri)
- Nada bicara: Ramah, santun, profesional, solutif, ringkas, dan jelas ("Halo Rekan Mahasiswa Polsri!", "Ada yang bisa Bantuku bantu?").
- Bahasa: Bahasa Indonesia yang baik dan baku namun bersahabat.

Format Jawaban:
- JAWABAN HARUS RINGKAS, PADAT, DAN LANGSUNG KE INTI (Maksimal 3-5 poin/langkah singkat). JANGAN TERLALU PANJANG.
- Hindari basa-basi panjang. Langsung ke solusi/langkah yang dibutuhkan agar mahasiswa dapat membaca dan memahami dalam 15 detik.
- Format langkah wajib menggunakan penomoran 1., 2., 3. yang ringkas dan terstruktur.
- Gunakan **teks tebal** untuk nama berkas, lokasi loket/gedung, pasal aturan, dan tautan resmi.
- SELALU sertakan tautan resmi **https://polsri.ac.id/** di dalam jawaban sebagai rujukan yang valid dan dapat diakses bebas tanpa login.
- Jika ada hal krusial atau tenggat waktu, cantumkan di akhir secara ringkas:
  💡 **Catatan:** [info penting singkat]
- Di bagian akhir setiap jawaban, SELALU cantumkan label sumber dokumen dalam format:
[[SUMBER: Nama Dokumen Resmi / SK yang digunakan, Website Resmi Polsri (https://polsri.ac.id/)]]
- Arahkan ke Subbagian Akademik & Kemahasiswaan di Gedung Kantor Pusat Polsri Lt. 1 jika memerlukan verifikasi berkas langsung.
`;
}

// Helper untuk inisialisasi Gemini Client
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Endpoint info helpdesk & kontak kampus
app.get('/api/info', (_req: Request, res: Response) => {
  res.json({
    institution: 'Politeknik Negeri Sriwijaya (Polsri)',
    campus: 'Kampus Bukit Besar, Palembang',
    address: 'Jl. Srijaya Negara, Bukit Besar, Palembang, Sumatera Selatan 30139',
    units: {
      akademik: {
        name: 'Subbagian Akademik & Kemahasiswaan (BAAK)',
        location: 'Gedung Kantor Pusat Lantai 1',
        hours: 'Senin - Jumat, 08.00 - 16.00 WIB',
        email: 'akademik@polsri.ac.id',
        phone: '(0711) 353414',
      },
      keuangan: {
        name: 'Bagian Keuangan & Layanan UKT',
        location: 'Gedung Kantor Pusat Lantai 2',
        email: 'keuangan@polsri.ac.id',
      },
      portal: {
        name: 'Website Resmi Kampus Polsri (Akses Publik)',
        url: 'https://polsri.ac.id/',
      },
      website: 'https://polsri.ac.id/',
    },
  });
});

// Endpoint untuk mendapatkan daftar dokumen resmi kampus (Knowledge Base)
app.get('/api/documents', (_req: Request, res: Response) => {
  try {
    const docs = getCampusDocuments();
    res.json({ documents: docs, total: docs.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal memuat dokumen kampus', details: err?.message });
  }
});

// Endpoint untuk menambahkan dokumen resmi baru ke Knowledge Base
app.post('/api/documents', (req: Request, res: Response) => {
  try {
    const { title, docNumber, category, effectiveDate, summary, content } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: 'Judul dan isi teks dokumen wajib diisi.' });
      return;
    }

    const docs = getCampusDocuments();
    const newDoc: CampusDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      title: title.trim(),
      docNumber: docNumber?.trim() || 'Dokumen Resmi Polsri',
      category: category || 'lainnya',
      effectiveDate: effectiveDate?.trim() || 'Tahun Berjalan',
      summary: summary?.trim() || (content.length > 150 ? content.substring(0, 150) + '...' : content),
      content: content.trim(),
      sourceUrl: 'https://polsri.ac.id/',
      isBuiltIn: false,
    };

    docs.unshift(newDoc);
    saveCampusDocuments(docs);

    res.status(201).json({ success: true, document: newDoc, total: docs.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal menyimpan dokumen baru', details: err?.message });
  }
});

// Endpoint untuk menghapus dokumen dari Knowledge Base
app.delete('/api/documents/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let docs = getCampusDocuments();
    const prevCount = docs.length;
    docs = docs.filter((d) => d.id !== id);

    if (docs.length === prevCount) {
      res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
      return;
    }

    saveCampusDocuments(docs);
    res.json({ success: true, remaining: docs.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal menghapus dokumen', details: err?.message });
  }
});

// Endpoint untuk mereset dokumen ke default bawaan Polsri
app.post('/api/documents/reset', (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(DEFAULT_DOCUMENTS_FILE)) {
      const defaultData = fs.readFileSync(DEFAULT_DOCUMENTS_FILE, 'utf-8');
      const docs = JSON.parse(defaultData);
      saveCampusDocuments(docs);
      res.json({ success: true, documents: docs, total: docs.length });
    } else {
      res.status(404).json({ error: 'Berkas dokumen default tidak ditemukan.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Gagal mereset dokumen', details: err?.message });
  }
});

// Endpoint Chat dengan Gemini API
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Kunci API Gemini belum dikonfigurasi di server. Silakan pastikan GEMINI_API_KEY terpasang di Secrets panel.',
        fallbackAnswer: 'Halo! Mohon maaf, layanan sedang mempersiapkan konfigurasi API. Silakan pastikan GEMINI_API_KEY telah diatur di Settings > Secrets panel.',
      });
      return;
    }

    // Ambil seluruh dokumen resmi kampus terkini dari Knowledge Base
    const activeDocs = getCampusDocuments();
    const systemInstruction = buildSystemInstruction(activeDocs);

    // Format chat history for @google/genai, ensuring strictly alternating turns starting with 'user'
    const rawHistory = Array.isArray(history) ? history : [];
    const alternatingContents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const item of rawHistory) {
      if (!item || typeof item.text !== 'string' || !item.text.trim()) continue;
      const role: 'user' | 'model' = item.role === 'assistant' || item.role === 'model' ? 'model' : 'user';

      // First turn must always be 'user'
      if (alternatingContents.length === 0 && role === 'model') {
        continue;
      }

      const last = alternatingContents[alternatingContents.length - 1];
      if (last && last.role === role) {
        // Merge consecutive messages of the same role into a single turn
        last.parts[0].text += `\n\n${item.text.trim()}`;
      } else {
        alternatingContents.push({
          role,
          parts: [{ text: item.text.trim() }],
        });
      }
    }

    // Append the current incoming user message
    const currentText = message.trim();
    const lastTurn = alternatingContents[alternatingContents.length - 1];
    if (lastTurn && lastTurn.role === 'user') {
      lastTurn.parts[0].text += `\n\n${currentText}`;
    } else {
      alternatingContents.push({
        role: 'user',
        parts: [{ text: currentText }],
      });
    }

    // Keep at most 12 recent turns to stay well within limits
    const formattedContents = alternatingContents.slice(-12);

    // List of models to try in order:
    // 'gemini-3.1-flash-lite' has dedicated high quota and responds instantly
    // 'gemini-3.8-flash' as alternative
    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    let response: any = null;
    let lastError: any = null;

    for (const candidateModel of candidateModels) {
      try {
        response = await ai.models.generateContent({
          model: candidateModel,
          contents: formattedContents,
          config: {
            systemInstruction,
            temperature: 0.7,
          },
        });
        if (response && response.text) {
          break; // Succeeded!
        }
      } catch (err: any) {
        console.warn(`[Bantuku] Model ${candidateModel} failed:`, err?.message || err);
        lastError = err;
        // Continue to try next candidate model
      }
    }

    if (!response || !response.text) {
      throw lastError || new Error('Tidak ada respons dari model AI.');
    }

    const rawText = response.text || '';

    // Ekstraksi tag [[SUMBER: ...]] jika tersedia
    let text = rawText;
    let sources: string[] = [];

    const sourceRegex = /\[\[SUMBER:\s*([^\]]+)\]\]/i;
    const match = rawText.match(sourceRegex);
    if (match) {
      const sourceStr = match[1].trim();
      sources = sourceStr.split(',').map((s: string) => s.trim()).filter(Boolean);
      text = rawText.replace(sourceRegex, '').trim();
    } else {
      // Fallback deteksi jika model menulis "Sumber Dokumen:"
      const altMatch = rawText.match(/(?:Sumber\s*Dokumen|Rujukan|Sumber)\s*:\s*([^\n\r]+)/i);
      if (altMatch) {
        const sourceStr = altMatch[1].replace(/[*_#]/g, '').trim();
        sources = [sourceStr];
      } else {
        sources = ['Pedoman Akademik & Standar Layanan Mahasiswa Polsri'];
      }
    }

    res.json({
      text,
      sources,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);

    const errorMessage = error?.message || '';
    let userFriendlyError = 'Maaf, terjadi kendala saat memproses pertanyaan Anda. Silakan coba kirim kembali dalam beberapa saat.';

    if (errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('429')) {
      userFriendlyError = 'Batas kuota pertanyaan sementara tercapai (429). Mohon tunggu sekitar 30 detik sebelum mengajukan pertanyaan baru.';
    } else if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('PERMISSION_DENIED')) {
      userFriendlyError = 'Kunci API Gemini tidak valid atau izin ditolak. Silakan periksa pengaturan GEMINI_API_KEY di Settings > Secrets.';
    } else if (errorMessage.includes('fetch failed') || errorMessage.includes('ENOTFOUND')) {
      userFriendlyError = 'Gagal terhubung ke server kecerdasan buatan. Periksa koneksi internet Anda dan coba lagi.';
    }

    res.status(500).json({
      error: userFriendlyError,
      details: process.env.NODE_ENV !== 'production' ? errorMessage : undefined,
    });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`[Bantuku Polsri] Server running on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
