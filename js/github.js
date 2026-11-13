/**
 * github.js — модуль для работы с GitHub REST API
 */

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Получить список репозиториев пользователя
 */
export async function fetchRepos(username, token = null) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CodeMind-App'
  };
  if (token) headers['Authorization'] = `token ${token}`;

  const response = await fetch(
    `${GITHUB_API_BASE}/users/${username}/repos?per_page=100&type=all`,
    { headers }
  );

  if (!response.ok) {
    if (response.status === 401) throw new Error('Неверный GitHub токен.');
    if (response.status === 403) throw new Error('Превышен лимит GitHub API. Попробуйте через час.');
    if (response.status === 404) throw new Error(`Пользователь "${username}" не найден.`);
    throw new Error(`Ошибка GitHub API: ${response.status}`);
  }

  return response.json();
}

/**
 * Получить дерево файлов репозитория (рекурсивно)
 */
export async function fetchRepoTree(owner, repo, branch = 'main', token = null) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CodeMind-App'
  };
  if (token) headers['Authorization'] = `token ${token}`;

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers }
  );

  if (!response.ok) {
    if (response.status === 401) throw new Error('Неверный GitHub токен.');
    if (response.status === 403) throw new Error('Превышен лимит GitHub API.');
    if (response.status === 404) throw new Error(`Репозиторий "${owner}/${repo}" не найден.`);
    throw new Error(`Ошибка GitHub API: ${response.status}`);
  }

  return response.json();
}

/**
 * Получить содержимое файла (декодировать из base64)
 */
export async function fetchFileContent(owner, repo, path, token = null) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CodeMind-App'
  };
  if (token) headers['Authorization'] = `token ${token}`;

  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`,
    { headers }
  );

  if (!response.ok) {
    if (response.status === 401) throw new Error('Неверный GitHub токен.');
    if (response.status === 403) throw new Error('Превышен лимит GitHub API.');
    if (response.status === 404) throw new Error(`Файл "${path}" не найден.`);
    throw new Error(`Ошибка GitHub API: ${response.status}`);
  }

  const data = await response.json();

  if (data.encoding === 'base64' && data.content) {
    const binaryString = atob(data.content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  throw new Error(`Файл "${path}" не содержит текста.`);
}

/**
 * Получить список файлов кода (с фильтрацией мусора)
 */
export async function fetchCodeFiles(owner, repo, branch = 'main', token = null) {
  const tree = await fetchRepoTree(owner, repo, branch, token);

  if (!tree.tree || !Array.isArray(tree.tree)) return [];

  const codeExtensions = [
    '.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.cs',
    '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala',
    '.r', '.m', '.html', '.css', '.scss', '.vue', '.jsx',
    '.tsx', '.sh', '.bash', '.sql', '.json', '.md'
  ];
  const ignorePaths = [
    'node_modules/', 'vendor/', 'dist/', 'build/', '.git/',
    '__pycache__/', '.venv/', 'venv/', 'target/', 'bin/',
    'obj/', '.next/', '.nuxt/', 'public/', 'static/',
    'assets/', 'images/', 'img/', 'fonts/', 'docs/',
    'test/', 'tests/', 'spec/', '.github/', '.vscode/', '.idea/'
  ];

  return tree.tree
    .filter(item => item.type === 'blob')
    .filter(item => {
      const path = item.path.toLowerCase();
      const hasExt = codeExtensions.some(ext => path.endsWith(ext));
      if (!hasExt) return false;
      const ignored = ignorePaths.some(p => path.startsWith(p));
      return !ignored;
    })
    .map(item => ({ path: item.path, type: 'blob' }));
}
