/**
 * search.js — модуль для семантического поиска по векторам.
 * Вычисляет косинусное сходство, добавляет буст по имени и ранжирует результаты.
 */

/**
 * Косинусное сходство между двумя векторами.
 * @param {number[]} vec1
 * @param {number[]} vec2
 * @returns {number}
 */
export function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;
  let dot = 0, m1 = 0, m2 = 0;
  for (let i = 0; i < vec1.length; i++) {
    dot += vec1[i] * vec2[i];
    m1 += vec1[i] * vec1[i];
    m2 += vec2[i] * vec2[i];
  }
  m1 = Math.sqrt(m1); m2 = Math.sqrt(m2);
  if (m1 === 0 || m2 === 0) return 0;
  return dot / (m1 * m2);
}

/**
 * Простая токенизация запроса (латиница + кириллица).
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeQuery(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-zа-яё0-9]+/g, ' ').split(/\s+/).filter(t => t.length >= 3);
}

/**
 * Найти наиболее релевантные фрагменты кода.
 * @param {number[]} queryEmbedding
 * @param {Array} cachedEmbeddings
 * @param {string} queryText — исходный запрос для буста по имени
 * @param {number} topK
 * @returns {Array}
 */
export function search(queryEmbedding, cachedEmbeddings, queryText = '', topK = 20) {
  const results = [];
  if (!cachedEmbeddings || cachedEmbeddings.length === 0) return results;
  const qTokens = tokenizeQuery(queryText);

  for (const repoData of cachedEmbeddings) {
    const { repo, files } = repoData;
    if (!files || !Array.isArray(files)) continue;
    for (const file of files) {
      const { path, blocks } = file;
      if (!blocks || !Array.isArray(blocks)) continue;
      for (const block of blocks) {
        const { name, code, embedding } = block;
        if (!embedding) continue;
        let sim = cosineSimilarity(queryEmbedding, embedding);

        // Буст по имени функции/файла (полезно для англ. запросов)
        if (qTokens.length > 0) {
          const hay = `${name || ''} ${path || ''}`.toLowerCase();
          let matches = 0;
          for (const t of qTokens) { if (hay.includes(t)) matches++; }
          if (matches > 0) sim = Math.min(1, sim + 0.06 * matches);
        }

        results.push({ repo, path, functionName: name, code, similarity: sim });
      }
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, topK);
}
