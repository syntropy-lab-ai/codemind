/**
 * ui.js — модуль для обновления пользовательского интерфейса
 * Отвечает за отображение прогресса, результатов и ошибок
 */

/**
 * Показать прогресс-бар и обновить его состояние
 * @param {number} current — текущий шаг
 * @param {number} total — всего шагов
 * @param {string} message — текст сообщения
 */
export function showProgress(current, total, message) {
  const section = document.getElementById('progress-section');
  const bar = document.getElementById('progress-bar');
  const count = document.getElementById('progress-count');
  const msg = document.getElementById('progress-message');

  if (section) section.classList.remove('hidden');

  if (bar) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    bar.style.width = `${percent}%`;
  }

  if (count) count.textContent = `${current} / ${total}`;
  if (msg) msg.textContent = message;
}

/**
 * Скрыть прогресс-бар
 */
export function hideProgress() {
  const section = document.getElementById('progress-section');
  if (section) section.classList.add('hidden');
}

/**
 * Отобразить результаты поиска
 * @param {Array} results — массив объектов {repo, path, functionName, code, similarity}
 */
export function displayResults(results) {
  const section = document.getElementById('results-section');
  if (!section) return;

  if (!results || results.length === 0) {
    section.innerHTML = `
      <div class="text-center py-16 text-slate-500 fade-in">
        <svg class="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p>Ничего не найдено. Попробуйте изменить запрос.</p>
      </div>
    `;
    return;
  }

  const html = results.map((result, index) => {
    const similarityPercent = Math.round(result.similarity * 100);
    const language = detectLanguage(result.path);

    return `
      <div class="result-card bg-slate-900/60 border border-slate-800 rounded-xl p-5 fade-in" style="animation-delay: ${index * 0.05}s">
        <div class="flex items-start justify-between mb-3">
          <div class="flex-1">
            <h3 class="text-lg font-semibold text-white mb-1">${escapeHtml(result.functionName || result.path)}</h3>
            <p class="text-sm text-slate-400">
              <span class="text-indigo-400">${escapeHtml(result.repo)}</span>
              <span class="mx-2">/</span>
              <span>${escapeHtml(result.path)}</span>
            </p>
          </div>
          <div class="flex items-center gap-3">
            <span class="px-3 py-1 bg-indigo-500/20 text-indigo-300 text-sm font-medium rounded-full">
              ${similarityPercent}% совпадение
            </span>
            <a href="https://github.com/${result.repo}/blob/main/${result.path}" target="_blank" rel="noopener"
               class="github-link text-sm text-slate-400 hover:text-indigo-300 flex items-center gap-1">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.2 11.4.6.1.82-.26.82-.58v-2.03c-3.34.73-4.04-1.6-4.04-1.6-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 016 0c2.3-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.82.57A12.01 12.01 0 0024 12.5C24 5.87 18.63.5 12 .5z"/></svg>
              Открыть
            </a>
          </div>
        </div>
        <pre><code class="language-${language}">${escapeHtml(result.code)}</code></pre>
      </div>
    `;
  }).join('');

  section.innerHTML = html;

  // Применяем подсветку синтаксиса
  if (window.hljs) {
    section.querySelectorAll('pre code').forEach(block => {
      hljs.highlightElement(block);
    });
  }
}

/**
 * Показать ошибку (тост в правом верхнем углу)
 * @param {string} message — текст ошибки
 */
export function showError(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast bg-red-500/90 text-white px-4 py-3 rounded-lg shadow-lg max-w-sm backdrop-blur-sm';
  toast.innerHTML = `
    <div class="flex items-start gap-2">
      <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm">${escapeHtml(message)}</p>
    </div>
  `;

  container.appendChild(toast);

  // Автоматическое скрытие через 5 секунд
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

/**
 * Определить язык программирования по расширению файла
 * @param {string} path — путь к файлу
 * @returns {string} — идентификатор языка для highlight.js
 */
function detectLanguage(path) {
  const ext = path.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    html: 'xml',
    css: 'css',
    json: 'json',
    sh: 'bash',
    md: 'markdown'
  };
  return map[ext] || 'plaintext';
}

/**
 * Экранировать HTML-символы для безопасного вывода
 * @param {string} text — текст
 * @returns {string} — экранированный текст
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
