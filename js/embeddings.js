/**
 * embeddings.js — модуль для получения векторных представлений кода.
 *
 * Стратегия (двойная, для устойчивости):
 *  1) Основная: Transformers.js — модель all-MiniLM-L6-v2 работает ПРЯМО В БРАУЗЕРЕ
 *     через WebAssembly. Никаких запросов к api-inference.huggingface.co.
 *  2) Fallback: если модель не удалось загрузить — встроенный лексический поиск
 *     (TF-IDF + hashing). Сайт НЕ падает.
 *
 * Улучшение ранжирования: перед эмбеддингом код очищается от строковых литералов
 * (UI-текст = шум), но комментарии сохраняются (они несут смысл о назначении кода).
 */

const EMBED_DIM = 384;

let extractor = null;
let initPromise = null;
let mode = 'loading';

async function loadTransformers() {
  try {
    const mod = await import('@xenova/transformers');
    const { pipeline, env } = mod;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const ex = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', { quantized: true });
    return ex;
  } catch (err) {
    console.warn('Transformers.js недоступен, fallback:', err.message);
    return null;
  }
}

async function getExtractor() {
  if (mode === 'transformers') return extractor;
  if (mode === 'fallback') return null;
  if (!initPromise) {
    initPromise = loadTransformers()
      .then(ex => {
        if (ex) { extractor = ex; mode = 'transformers'; }
        else { mode = 'fallback'; }
        return ex;
      })
      .catch(() => { mode = 'fallback'; initPromise = null; return null; });
  }
  return initPromise;
}

export async function warmup() { await getExtractor(); }
export function getMode() { return mode; }

/**
 * Очистка кода для эмбеддинга: убрать строковые литералы (одинарные/двойные/бэктики),
 * сохранить комментарии и структуру. Это снимает ложный сигнал из UI-текста внутри функций.
 * @param {string} code
 * @returns {string}
 */
export function cleanCode(code) {
  if (!code) return '';
  let out = code;
  // template literals (многострочные) -> пусто
  out = out.replace(/`[\s\S]*?`/g, ' ');
  // двойные кавычки
  out = out.replace(/"(?:[^"\\]|\\.)*"/g, ' ');
  // одинарные кавычки
  out = out.replace(/'(?:[^'\\]|\\.)*'/g, ' ');
  // схлопнуть лишние пробелы
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/**
 * Структурировать ввод для модели: имя + очищенный код.
 * Модель лучше понимает "function <name>: <code>", чем сырое тело.
 * @param {string} name
 * @param {string} cleanedCode
 * @returns {string}
 */
export function buildPrompt(name, cleanedCode) {
  return `function ${name || 'block'}: ${cleanedCode}`.substring(0, 2000);
}

export async function getEmbedding(text) {
  if (!text || !text.trim()) throw new Error('Пустой текст для эмбеддинга');
  const truncated = text.length > 2000 ? text.substring(0, 2000) : text;
  const ex = await getExtractor();
  if (ex) {
    try {
      const output = await ex(truncated, { pooling: 'mean', normalize: true });
      return Array.from(output.data);
    } catch (err) {
      console.warn('Ошибка инференса, fallback:', err.message);
      return hashEmbedding(truncated);
    }
  }
  return hashEmbedding(truncated);
}

export async function getEmbeddingsBatch(texts, onProgress = null) {
  const results = [];
  const total = texts.length;
  for (let i = 0; i < total; i++) {
    try { results.push(await getEmbedding(texts[i])); }
    catch { results.push(new Array(EMBED_DIM).fill(0)); }
    if (onProgress) onProgress(i + 1, total);
    await sleep(0);
  }
  return results;
}

export function extractCodeBlocks(code, language = 'javascript') {
  const blocks = [];
  if (!code || code.trim().length === 0) return blocks;
  const patterns = {
    javascript: [
      { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g, type: 'function' },
      { regex: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{[\s\S]*?\n\}/g, type: 'function' },
      { regex: /(?:export\s+)?class\s+(\w+)[\s\S]*?\n\}/g, type: 'class' }
    ],
    python: [
      { regex: /(?:async\s+)?def\s+(\w+)\s*\([^)]*\):[\s\S]*?(?=\n(?:def|class)|\Z)/g, type: 'function' },
      { regex: /class\s+(\w+)[\s\S]*?(?=\nclass|\Z)/g, type: 'class' }
    ],
    typescript: [
      { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)[^)]*\)\s*(?::\s*[^{]+)?\s*\{[\s\S]*?\n\}/g, type: 'function' },
      { regex: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*\{[\s\S]*?\n\}/g, type: 'function' },
      { regex: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)[^{]*\{[\s\S]*?\n\}/g, type: 'class' }
    ]
  };
  const langPatterns = patterns[language] || patterns.javascript;
  for (const pattern of langPatterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(code)) !== null) {
      const name = match[1];
      const fullMatch = match[0];
      const truncatedCode = fullMatch.length > 1500 ? fullMatch.substring(0, 1500) : fullMatch;
      blocks.push({ name, code: truncatedCode, type: pattern.type });
    }
  }
  if (blocks.length === 0 && code.length > 0) {
    blocks.push({ name: 'file', code: code.substring(0, 1500), type: 'file' });
  }
  return blocks;
}

// ================== LEXICAL FALLBACK ==================

function tokenize(text) {
  const cleaned = text.toLowerCase().replace(/[^a-zа-яё0-9_]+/g, ' ');
  const raw = cleaned.split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of raw) { const parts = w.split(/_/).filter(Boolean); for (const p of parts) out.push(p); }
  return out;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hashEmbedding(text) {
  const vec = new Float32Array(EMBED_DIM);
  const tokens = tokenize(text);
  if (tokens.length === 0) return Array.from(vec);
  const tf = Object.create(null);
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  for (const tok in tf) { vec[hashString(tok) % EMBED_DIM] += tf[tok]; }
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIM; i++) vec[i] /= norm;
  return Array.from(vec);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
