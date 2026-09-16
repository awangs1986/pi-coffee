// Tiny syntax highlighter: comments, strings, numbers, keywords, a few
// punctuation classes. Deliberately small; escapes everything it emits.

const KEYWORDS = {
  js: 'abstract as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of package private protected public return static super switch this throw true try type typeof undefined var void while with yield',
  py: 'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self',
  sh: 'if then else elif fi for while in do done case esac function return exit export local readonly set unset echo cd ls cat grep sed awk sudo apt npm node git curl',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  rs: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename using new delete this public private protected virtual override nullptr true false bool',
  sql: 'select from where and or not null insert into values update set delete create table drop alter add primary key foreign references index join left right inner outer on group by order having limit offset as distinct union all exists between like in is case when then else end',
  yaml: 'true false null yes no on off',
  json: 'true false null',
};
const ALIAS = {
  javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  python: 'py', py3: 'py',
  bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', shellsession: 'sh', powershell: 'sh', ps1: 'sh',
  golang: 'go', rust: 'rs',
  kotlin: 'java', kt: 'java', scala: 'java', csharp: 'java', cs: 'java',
  cpp: 'c', 'c++': 'c', h: 'c', hpp: 'c', cc: 'c',
  yml: 'yaml', json5: 'json', jsonc: 'json',
  html: 'html', xml: 'html', svg: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  diff: 'diff', patch: 'diff',
};

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function normalizeLang(lang) {
  const l = String(lang || '').trim().toLowerCase();
  if (!l) return '';
  return ALIAS[l] || (KEYWORDS[l] ? l : l);
}

export function highlight(code, lang) {
  const l = normalizeLang(lang);
  if (l === 'diff') return highlightDiff(code);
  if (l === 'html') return highlightMarkup(code);
  if (l === 'css') return highlightCss(code);
  const keywords = new Set((KEYWORDS[l] || '').split(' ').filter(Boolean));
  const lineComment = l === 'py' || l === 'sh' || l === 'yaml' ? '#' : l === 'sql' ? '--' : l === 'json' ? null : '//';
  const blockComment = l === 'py' || l === 'sh' || l === 'yaml' || l === 'json' ? null : ['/*', '*/'];
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    const two = code.slice(i, i + 2);
    if (lineComment && code.startsWith(lineComment, i)) {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += '<span class="tok-c">' + esc(code.slice(i, stop)) + '</span>';
      i = stop;
      continue;
    }
    if (blockComment && two === blockComment[0]) {
      const end = code.indexOf(blockComment[1], i + 2);
      const stop = end === -1 ? n : end + 2;
      out += '<span class="tok-c">' + esc(code.slice(i, stop)) + '</span>';
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n && code[j] !== ch) { if (code[j] === '\\') j++; if (code[j] === '\n' && ch !== '`') break; j++; }
      out += '<span class="tok-s">' + esc(code.slice(i, j + 1)) + '</span>';
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z_$]/.test(code[i - 1] || '')) {
      let j = i;
      while (j < n && /[0-9A-Fa-fxX._]/.test(code[j])) j++;
      out += '<span class="tok-n">' + esc(code.slice(i, j)) + '</span>';
      i = j;
      continue;
    }
    if (/[A-Za-z_$@]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$-]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const next = code.slice(j).match(/^\s*\(/);
      if (keywords.has(word) || (l === 'sql' && keywords.has(word.toLowerCase()))) out += '<span class="tok-k">' + esc(word) + '</span>';
      else if (ch === '@' || (l === 'sh' && ch === '$')) out += '<span class="tok-v">' + esc(word) + '</span>';
      else if (next && l !== 'sh' && l !== 'yaml') out += '<span class="tok-f">' + esc(word) + '</span>';
      else if (/^[A-Z][A-Za-z0-9_]*$/.test(word) && l !== 'sh' && l !== 'yaml') out += '<span class="tok-t">' + esc(word) + '</span>';
      else out += esc(word);
      i = j;
      continue;
    }
    if (l === 'sh' && ch === '$') {
      let j = i + 1;
      if (code[j] === '{') { const e = code.indexOf('}', j); j = e === -1 ? n : e + 1; }
      else while (j < n && /[\w]/.test(code[j])) j++;
      out += '<span class="tok-v">' + esc(code.slice(i, j)) + '</span>';
      i = j;
      continue;
    }
    if (l === 'yaml' && /^[\w.-]+:(\s|$)/.test(code.slice(i, code.indexOf('\n', i) === -1 ? n : code.indexOf('\n', i)).trimStart()) && (i === 0 || code[i - 1] === '\n' || code[i - 1] === ' ' || code[i - 1] === '-')) {
      const m = code.slice(i).match(/^[\w.-]+/);
      if (m) { out += '<span class="tok-a">' + esc(m[0]) + '</span>'; i += m[0].length; continue; }
    }
    if (l === 'json' && ch === '"') { /* handled above */ }
    if (/[{}()[\];,.]/.test(ch)) { out += '<span class="tok-p">' + esc(ch) + '</span>'; i++; continue; }
    out += esc(ch);
    i++;
  }
  return out;
}

function highlightDiff(code) {
  return code.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---')) return '<span class="tok-c">' + esc(line) + '</span>';
    if (line.startsWith('@@')) return '<span class="tok-a">' + esc(line) + '</span>';
    if (line.startsWith('+')) return '<span class="diff-add">' + esc(line) + '</span>';
    if (line.startsWith('-')) return '<span class="diff-del">' + esc(line) + '</span>';
    return esc(line);
  }).join('\n');
}

function highlightMarkup(code) {
  return esc(code)
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-c">$1</span>')
    .replace(/(&lt;\/?)([\w:-]+)/g, '$1<span class="tok-k">$2</span>')
    .replace(/([\w:-]+)(=)(&quot;[^&]*&quot;|&#39;[^&]*&#39;)/g, '<span class="tok-a">$1</span>$2<span class="tok-s">$3</span>');
}

function highlightCss(code) {
  return esc(code)
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-c">$1</span>')
    .replace(/([.#]?[\w-]+)(?=\s*\{)/g, '<span class="tok-t">$1</span>')
    .replace(/([\w-]+)(\s*:)/g, '<span class="tok-a">$1</span>$2')
    .replace(/(#[0-9a-fA-F]{3,8}\b|\b\d+(\.\d+)?(px|em|rem|%|vh|vw|s|ms)?)/g, '<span class="tok-n">$1</span>');
}
