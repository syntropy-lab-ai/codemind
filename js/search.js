/**
 * search.js — модуль для семантического поиска по векторам
 * Вычисляет косинусное сходство и ранжирует результаты
 */

/**
 * Вычислить косинусное сходство между двумя векторами
 * @param {number[]} vec1 — первый вектор
 * @param {number[]} vec2 — второй вектор
 * @returns {number} — значение сходства от -1 до 1
 */
export function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) {
    return 0;
  }

  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    magnitude1 += vec1[i] * vec1[i];
    magnitude2 += vec2[i] * vec2[i];
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Найти наиболее релевантные фрагменты кода
 * @param {number[]} queryEmbedding — вектор поискового запроса
 * @param {Array} cachedEmbeddings — массив кешированных данных [{repo, files: [{path, blocks: [{name, code, embedding}]}]}]
 * @param {number} topK — количество лучших результатов (по умолчанию 20)
 * @returns {Array} — отсортированный массив результатов
 */
export function search(queryEmbedding, cachedEmbeddings, topK = 20) {
  const results = [];

  if (!cachedEmbeddings || cachedEmbeddings.length === 0) {
    return results;
  }

  // Проходим по всем репозиториям и файлам в кеше
  for (const repoData of cachedEmbeddings) {
    const { repo, files } = repoData;

    if (!files || !Array.isArray(files)) continue;

    for (const file of files) {
      const { path, blocks } = file;

      if (!blocks || !Array.isArray(blocks)) continue;

      for (const block of blocks) {
        const { name, code, embedding } = block;

        if (!embedding) continue;

        const similarity = cosineSimilarity(queryEmbedding, embedding);

        results.push({
          repo,
          path,
          functionName: name,
          code,
          similarity
        });
      }
    }
  }

  // Сортируем по убыванию сходства
  results.sort((a, b) => b.similarity - a.similarity);

  // Возвращаем топ-K результатов
  return results.slice(0, topK);
}
