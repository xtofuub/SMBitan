/* ===== SMB Enumerator — Frontend ===== */

// ── Helpers ──
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function fmtSize(b) {
  if (!b || b === 0) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
function fileIcon(name, isDir) {
  if (isDir) return '📁';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {txt:'📝',json:'📋',py:'🐍',js:'📜',html:'🌐',css:'🎨',pdf:'📕',docx:'📘',doc:'📘',xlsx:'📊',xls:'📊',pptx:'📙',zip:'📦','7z':'📦',tar:'📦',gz:'📦',exe:'⚙️',iso:'💿',vmdk:'💿',png:'🖼️',jpg:'🖼️',jpeg:'🖼️',gif:'🖼️',webp:'🖼️',bmp:'🖼️',svg:'🖼️',ico:'🖼️',tiff:'🖼️',tif:'🖼️',avif:'🖼️',conf:'⚙️',cmd:'⚙️',ps1:'⚙️',csv:'📊',xml:'📋',lbx:'📎',sys:'⚙️'};
  return map[ext] || '📄';
}

// ── DOM refs ──
const $ = id => document.getElementById(id);
const hostInput   = $('host');
const userInput   = $('user');
const passInput   = $('pass');
const connectBtn  = $('connect');
const sharesDiv   = $('shares');
const searchInput = $('search');
const breadcrumbs = $('breadcrumbs');
const emptyState  = $('emptyState');
const downloadBtn = $('download');
const fileContent = $('fileContent');
const docxPreview = $('docxPreview');
const pdfPreview = $('pdfPreview');
const pdfCanvas = $('pdfCanvas');
const pdfPageNum = $('pdfPageNum');
const imgPreview = $('imgPreview');
const imgEl = $('imgEl');
const openInBrowserBtn = $('openInBrowser');
const useUncCb    = $('useUnc');
const refreshBtn  = $('refresh');
const clearCacheBtn = $('clearCache');

// ── State ──
let currentUnc = null;  // set when connected via UNC

// ── PDF viewer state ──
let pdfDoc = null;
let pdfPageIdx = 0;
let pdfZoom = 1.5;

async function renderPdfPage(pageNum) {
  if (!pdfDoc) return;
  pdfPageIdx = Math.max(0, Math.min(pageNum - 1, pdfDoc.numPages - 1));
  const page = await pdfDoc.getPage(pdfPageIdx + 1);
  const viewport = page.getViewport({ scale: pdfZoom });
  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  const ctx = pdfCanvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  pdfPageNum.textContent = `Page ${pdfPageIdx + 1} of ${pdfDoc.numPages}`;
}

// ── API ──
function api(path, params) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  return fetch(url).then(r => r.json().catch(() => r));
}
function apiRaw(path, params) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  return fetch(url);
}

// ── Normalize host input → proper UNC ──
function normalizeHost(raw) {
  let h = raw.trim();
  // file:// URL → UNC
  if (h.startsWith('file://')) {
    h = h.slice('file://'.length).replace(/^\/+/, '');
    h = '\\\\' + h.replace(/\//g, '\\');
  }
  // bare host\share (no leading \\)
  if (h.includes('\\') && !h.startsWith('\\')) {
    const first = h.split('\\')[0];
    if (first.includes('.') || /^[A-Za-z0-9-]+$/.test(first)) {
      h = '\\\\' + h;
    }
  }
  // forward-slash UNC
  if (h.startsWith('//')) {
    h = '\\\\' + h.slice(2).replace(/\//g, '\\');
  }
  return h;
}

// ── Build tree ──
function buildTree(shares, host, user, pass) {
  sharesDiv.innerHTML = '';
  const ul = el('ul');
  shares.forEach(s => {
    const li = el('li');
    const node = el('div', 'node');
    node.innerHTML = `<span class="icon">${fileIcon('', true)}</span><span class="label">${s.name}</span><span class="chevron">&#9654;</span>`;
    if (s.unc) currentUnc = s.unc;
    node.onclick = () => toggleShare(node, s.name, host, user, pass);
    li.appendChild(node);
    ul.appendChild(li);
  });
  sharesDiv.appendChild(ul);
}

// ── Build params for api calls ──
function mkParams(path, host, user, pass) {
  if (currentUnc) return { unc: currentUnc, path };
  return { host, share: '', path, user, pass };
}

// ── Collapse helper: remove child <ul> from same <li> ──
function collapseNode(node) {
  node.classList.remove('expanded');
  // The <ul> is a sibling of `node` inside the same <li>
  const li = node.parentElement;
  if (li) {
    const childUl = li.querySelector(':scope > ul');
    if (childUl) childUl.remove();
  }
}

// ── Loading indicator for a node ──
function setNodeLoading(node, loading) {
  const chevron = node.querySelector('.chevron');
  if (!chevron) return;
  if (loading) {
    chevron.dataset.orig = chevron.innerHTML;
    chevron.innerHTML = '<span class="node-spinner"></span>';
  } else {
    chevron.innerHTML = chevron.dataset.orig || '&#9654;';
  }
}

// ── Toggle share root ──
async function toggleShare(node, share, host, user, pass) {
  if (node.classList.contains('expanded')) {
    collapseNode(node);
    return;
  }
  node.classList.add('expanded');
  setNodeLoading(node, true);
  const params = currentUnc
    ? { unc: currentUnc, host, share, path: '' }
    : { host, share, path: '', user, pass };
  const res = await api('/api/list', params);
  setNodeLoading(node, false);
  if (res.error) { node.classList.remove('expanded'); alert(res.error); return; }
  const ul = buildFileList(res.files, share, host, user, pass, '');
  node.parentNode.insertBefore(ul, node.nextSibling);
}

// ── Build a <ul> of file entries with staggered animation ──
function buildFileList(files, share, host, user, pass, parentPath) {
  const ul = el('ul');
  // sort: dirs first, then alphabetical
  files.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  files.forEach((f, idx) => {
    const li = el('li');
    // stagger animation: each item delays slightly
    li.style.animationDelay = Math.min(idx * 15, 400) + 'ms';
    const fullPath = parentPath ? parentPath + '/' + f.name : f.name;
    const node = el('div', 'node');
    // store name as data attr for filtering
    node.dataset.name = f.name.toLowerCase();
    let html = `<span class="icon">${fileIcon(f.name, f.isDirectory)}</span><span class="label" title="${f.name}">${f.name}</span>`;
    if (f.isDirectory) {
      html += `<span class="chevron">&#9654;</span>`;
    } else {
      html += `<span class="size">${fmtSize(f.size)}</span>`;
    }
    node.innerHTML = html;
    if (f.isDirectory) {
      node.onclick = (e) => { e.stopPropagation(); toggleDir(node, share, host, user, pass, fullPath); };
    } else {
      node.onclick = (e) => { e.stopPropagation(); openFile(share, host, user, pass, fullPath); };
    }
    li.appendChild(node);
    ul.appendChild(li);
  });
  return ul;
}

// ── Navigate to a path in the tree — expand each segment progressively ──
async function expandToPath(targetPath, andOpenFile) {
  const host = hostInput.value;
  const user = userInput.value;
  const pass = passInput.value;
  const share = sharesDiv.querySelector('.node .label')?.textContent || '';
  const segments = targetPath.split('/').filter(Boolean);

  // Ensure root share is expanded first
  const rootNode = sharesDiv.querySelector('.node');
  if (rootNode && !rootNode.classList.contains('expanded')) {
    await toggleShare(rootNode, share, host, user, pass);
  }

  // Walk each segment
  let currentLi = rootNode?.parentElement;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (!currentLi) break;

    // Find child <ul> of current node
    const childUl = currentLi.querySelector(':scope > ul');
    if (!childUl) break;

    // Find the matching <li> by label text
    let matchLi = null;
    for (const li of childUl.querySelectorAll(':scope > li')) {
      const label = li.querySelector(':scope > .node .label');
      if (label && label.textContent === seg) {
        matchLi = li;
        break;
      }
    }
    if (!matchLi) break;

    const matchNode = matchLi.querySelector(':scope > .node');
    if (!matchNode) break;

    if (isLast && andOpenFile) {
      // It's a file — click to open preview
      matchNode.click();
      // scroll into view
      matchNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // It's a directory segment — expand if not already
    if (!matchNode.classList.contains('expanded')) {
      // Need to expand this directory
      const dirPath = segments.slice(0, i + 1).join('/');
      await toggleDir(matchNode, share, host, user, pass, dirPath);
    }

    // highlight the final folder
    if (isLast) {
      matchNode.classList.add('active');
      matchNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => matchNode.classList.remove('active'), 2000);
    }

    currentLi = matchLi;
  }
}

// ── Toggle directory ──
async function toggleDir(node, share, host, user, pass, dirPath) {
  if (node.classList.contains('expanded')) {
    collapseNode(node);
    return;
  }
  node.classList.add('expanded');
  setNodeLoading(node, true);
  const params = currentUnc
    ? { unc: currentUnc, host, share, path: dirPath }
    : { host, share, path: dirPath, user, pass };
  const res = await api('/api/list', params);
  setNodeLoading(node, false);
  if (res.error) { node.classList.remove('expanded'); alert(res.error); return; }
  const ul = buildFileList(res.files, share, host, user, pass, dirPath);
  node.parentNode.insertBefore(ul, node.nextSibling);
}

// ── Open / preview file ──
async function openFile(share, host, user, pass, filePath) {
  // reset viewer
  emptyState.style.display = 'none';
  fileContent.style.display = 'none';
  fileContent.textContent = '';
  docxPreview.style.display = 'none';
  docxPreview.innerHTML = '';
  imgPreview.style.display = 'none';
  imgEl.src = '';
  pdfPreview.style.display = 'none';
  pdfCanvas.width = 0;
  pdfCanvas.height = 0;
  downloadBtn.style.display = 'none';
  openInBrowserBtn.style.display = 'none';

  // show loading
  const preview = $('filePreview');
  const loader = el('div', 'loading');
  loader.innerHTML = '<div class="spinner"></div> Loading...';
  preview.appendChild(loader);

  // breadcrumbs
  breadcrumbs.innerHTML = '';
  const parts = filePath.split('/');
  parts.forEach((p, i) => {
    if (i > 0) {
      const sep = el('span', 'bc-sep'); sep.textContent = '/'; breadcrumbs.appendChild(sep);
    }
    const span = el('span', i === parts.length - 1 ? '' : 'bc-part');
    span.textContent = p;
    breadcrumbs.appendChild(span);
  });

  const params = currentUnc
    ? { unc: currentUnc, host, share, path: filePath }
    : { host, share, path: filePath, user, pass };
  const r = await apiRaw('/api/file', params);

  loader.remove();

  if (r.status !== 200) {
    const j = await r.json().catch(() => ({}));
    fileContent.style.display = 'block';
    fileContent.textContent = 'Error: ' + (j.error || r.statusText);
    return;
  }

  const ct = r.headers.get('content-type') || '';
  const ext = (filePath.split('.').pop() || '').toLowerCase();

  // Build file URL for "Open in Browser"
  const fileUrlParams = new URLSearchParams(params);
  const fileUrl = '/api/file?' + fileUrlParams.toString();

  // Always show "Open in Browser"
  openInBrowserBtn.style.display = 'inline-block';
  openInBrowserBtn.onclick = () => window.open(fileUrl, '_blank');

  // Image preview
  const imgExts = ['png','jpg','jpeg','gif','webp','bmp','svg','ico','tiff','tif','avif'];
  if (imgExts.includes(ext) || ct.startsWith('image/')) {
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    imgEl.onload = () => URL.revokeObjectURL(url);
    imgEl.src = url;
    imgPreview.style.display = 'flex';
    downloadBtn.style.display = 'inline-block';
    downloadBtn.onclick = () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = parts[parts.length - 1]; a.click();
    };
    return;
  }

  // .pdf preview via PDF.js
  if (ext === 'pdf' && typeof pdfjsLib !== 'undefined') {
    try {
      const buf = await r.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
      pdfPageIdx = 0;
      await renderPdfPage(1);
      pdfPreview.style.display = 'block';
      downloadBtn.style.display = 'inline-block';
      // Setup PDF nav buttons
      $('pdfPrev').onclick = () => renderPdfPage(pdfPageIdx);
      $('pdfNext').onclick = () => renderPdfPage(pdfPageIdx + 2);
      downloadBtn.onclick = () => {
        const blob = new Blob([buf], { type: 'application/pdf' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = parts[parts.length - 1]; a.click();
      };
      return;
    } catch (e) {
      // fall through to binary handler
      console.warn('PDF.js error:', e);
    }
  }

  // .docx preview via mammoth
  if (ext === 'docx' && typeof mammoth !== 'undefined') {
    try {
      const buf = await r.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      docxPreview.innerHTML = result.value;
      docxPreview.style.display = 'block';
      downloadBtn.style.display = 'inline-block';
      downloadBtn.onclick = () => {
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = parts[parts.length - 1]; a.click();
      };
      return;
    } catch (e) {
      // fall through to binary handler
    }
  }

  // text / json / csv / html / code preview
  if (ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') ||
      ['txt','json','csv','html','css','js','py','conf','cmd','ps1','log','xml','yml','yaml','ini','cfg','md','sh','bat'].includes(ext)) {
    const text = await r.text();
    fileContent.textContent = text;
    fileContent.style.display = 'block';
    downloadBtn.style.display = 'inline-block';
    downloadBtn.onclick = () => {
      const blob = new Blob([text], { type: ct || 'text/plain' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = parts[parts.length - 1]; a.click();
    };
    return;
  }

  // binary — download only
  const blob = await r.blob();
  fileContent.style.display = 'block';
  fileContent.textContent = `Binary file (${fmtSize(blob.size)}). Click Download to save.`;
  downloadBtn.style.display = 'inline-block';
  downloadBtn.onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = parts[parts.length - 1]; a.click();
  };
}

// ── Connect ──
connectBtn.onclick = async () => {
  const raw = hostInput.value.trim();
  const user = userInput.value;
  const pass = passInput.value;
  currentUnc = null;
  sharesDiv.innerHTML = '<div class="loading"><div class="spinner"></div> Connecting...</div>';

  const manualUnc = useUncCb && useUncCb.checked;
  let sendHost = normalizeHost(raw);

  const isUNC = manualUnc || sendHost.startsWith('\\\\') || sendHost.startsWith('//');
  const isDrive = /^[A-Za-z]:[\\\/]?$/.test(raw);

  let res;
  if (isUNC) {
    res = await api('/api/shares', { unc: sendHost });
  } else if (isDrive) {
    res = await api('/api/shares', { unc: sendHost });
  } else {
    res = await api('/api/shares', { host: raw, user, pass });
  }
  if (res.error) {
    sharesDiv.innerHTML = `<div class="placeholder" style="color:#f85149">${res.error}</div>`;
    return;
  }
  buildTree(res.shares, raw, user, pass);

  // Trigger background indexing for instant search
  if (currentUnc) {
    triggerIndex(currentUnc);
  }
};

// ── Index status ──
let indexStatus = 'idle'; // idle | indexing | ready
let indexedCount = 0;
let indexPollTimer = null;

function triggerIndex(unc) {
  indexStatus = 'indexing';
  indexedCount = 0;
  updateIndexBadge();
  fetch('/api/index?unc=' + encodeURIComponent(unc), { method: 'POST' })
    .then(r => r.json())
    .then(() => {
      // poll for status
      if (indexPollTimer) clearInterval(indexPollTimer);
      indexPollTimer = setInterval(async () => {
        try {
          const r = await fetch('/api/index/status');
          const d = await r.json();
          indexStatus = d.status;
          indexedCount = d.indexed;
          updateIndexBadge();
          if (d.status === 'ready' || d.status === 'error') {
            clearInterval(indexPollTimer);
            indexPollTimer = null;
          }
        } catch(e) { /* ignore */ }
      }, 500);
    })
    .catch(() => {});
}

function updateIndexBadge() {
  let badge = document.getElementById('indexBadge');
  if (!badge) {
    badge = el('span', 'index-badge');
    badge.id = 'indexBadge';
    const head = document.querySelector('.sidebar-head h2');
    if (head) head.parentElement.insertBefore(badge, head.nextSibling);
  }
  if (indexStatus === 'indexing') {
    badge.className = 'index-badge indexing';
    badge.innerHTML = `<span class="node-spinner"></span> Indexing ${indexedCount.toLocaleString()} files...`;
    badge.style.display = '';
  } else if (indexStatus === 'ready') {
    badge.className = 'index-badge ready';
    badge.innerHTML = `⚡ ${indexedCount.toLocaleString()} files indexed`;
    badge.style.display = '';
    // auto-hide after 4s
    setTimeout(() => { badge.style.display = 'none'; }, 4000);
  } else {
    badge.style.display = 'none';
  }
}

// ── Search filters ──
const searchFiltersDiv = $('searchFilters');
let searchMatch = 'name';  // name | path
let searchType = 'all';    // all | file | dir
let searchExact = false;

// show/hide filter bar based on search focus
searchInput.addEventListener('focus', () => { searchFiltersDiv.style.display = ''; });

// wire up filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const filter = btn.dataset.filter;
    const value = btn.dataset.value;
    if (filter === 'exact') {
      // toggle
      searchExact = !searchExact;
      btn.classList.toggle('active', searchExact);
    } else {
      // radio-style within group
      btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (filter === 'match') searchMatch = value;
      if (filter === 'type') searchType = value;
    }
    // re-trigger search with new filters
    if (searchInput.value.trim()) {
      searchInput.dispatchEvent(new Event('input'));
    }
  });
});

// ── Search — debounced backend search (instant when indexed) ──
let searchTimer = null;
let searchAbort = null;

function showTree() {
  // remove search results panel if present
  const sr = document.getElementById('searchResults');
  if (sr) sr.remove();
  // make normal tree visible again
  sharesDiv.querySelectorAll(':scope > ul').forEach(u => u.style.display = '');
}

function showSearchResults(results, query) {
  // hide normal tree
  sharesDiv.querySelectorAll(':scope > ul').forEach(u => u.style.display = 'none');
  // remove old search results
  let sr = document.getElementById('searchResults');
  if (sr) sr.remove();
  sr = el('div');
  sr.id = 'searchResults';

  if (results.length === 0) {
    sr.innerHTML = '<div class="placeholder">No results found</div>';
    sharesDiv.appendChild(sr);
    return;
  }

  const host = hostInput.value;
  const user = userInput.value;
  const pass = passInput.value;

  results.forEach((r, idx) => {
    const item = el('div', 'search-result');
    item.style.animationDelay = Math.min(idx * 10, 300) + 'ms';
    const icon = fileIcon(r.name, r.isDirectory);
    const pathParts = r.path.split('/');
    const parentPath = pathParts.slice(0, -1).join('/') || '';
    // highlight the matching part in the name
    const nameLower = r.name.toLowerCase();
    const qLower = query.toLowerCase();
    const matchIdx = nameLower.indexOf(qLower);
    let nameHtml = r.name;
    if (matchIdx >= 0) {
      const before = r.name.slice(0, matchIdx);
      const match = r.name.slice(matchIdx, matchIdx + query.length);
      const after = r.name.slice(matchIdx + query.length);
      nameHtml = `${before}<mark>${match}</mark>${after}`;
    }
    let sizeHtml = r.isDirectory ? '' : `<span class="size">${fmtSize(r.size)}</span>`;
    const locateBtn = `<button class="search-locate-btn" title="Show in tree">📂</button>`;
    item.innerHTML = `<span class="icon">${icon}</span><div class="search-info"><span class="search-name">${nameHtml}</span><span class="search-path">${parentPath || '/'}</span></div>${sizeHtml}${locateBtn}`;
    // Click → preview the file directly
    item.onclick = (e) => {
      if (e.target.closest('.search-locate-btn')) return; // handled by locate btn
      if (r.isDirectory) {
        // For folders, navigate to tree and expand
        searchInput.value = '';
        searchFiltersDiv.style.display = 'none';
        showTree();
        expandToPath(r.path, false);
      } else {
        // For files, preview directly without leaving search
        const share = sharesDiv.querySelector('.node .label')?.textContent || '';
        openFile(share, host, user, pass, r.path);
      }
    };
    // Locate button → navigate to path in tree
    item.querySelector('.search-locate-btn').onclick = (e) => {
      e.stopPropagation();
      searchInput.value = '';
      searchFiltersDiv.style.display = 'none';
      showTree();
      if (r.isDirectory) {
        expandToPath(r.path, false);
      } else {
        expandToPath(r.path, true);
      }
    };
    sr.appendChild(item);
  });
  sharesDiv.appendChild(sr);
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (searchAbort) { searchAbort.abort(); searchAbort = null; }
  if (!q) { showTree(); return; }
  if (!currentUnc) {
    // no UNC connected — fall back to DOM-only filter
    const allLis = sharesDiv.querySelectorAll('li');
    allLis.forEach(li => { li.style.display = 'none'; li.classList.remove('filter-match'); });
    allLis.forEach(li => {
      const node = li.querySelector(':scope > .node');
      if (!node) return;
      const name = node.dataset.name || (node.querySelector('.label')?.textContent || '').toLowerCase();
      if (name.includes(q.toLowerCase())) {
        li.style.display = ''; li.classList.add('filter-match');
        let parent = li.parentElement;
        while (parent) { if (parent.tagName === 'LI') parent.style.display = ''; parent = parent.parentElement; }
      }
    });
    return;
  }
  // debounce: 50ms if indexed (instant), 300ms if live walk
  const delay = (indexStatus === 'ready' || indexStatus === 'indexing') ? 50 : 300;
  searchTimer = setTimeout(async () => {
    const ctrl = new AbortController();
    searchAbort = ctrl;
    // show loading
    sharesDiv.querySelectorAll(':scope > ul').forEach(u => u.style.display = 'none');
    let sr = document.getElementById('searchResults');
    if (sr) sr.remove();
    sr = el('div'); sr.id = 'searchResults';
    sr.innerHTML = '<div class="loading"><div class="spinner"></div> Searching...</div>';
    sharesDiv.appendChild(sr);
    try {
      const url = new URL('/api/search', location.origin);
      url.searchParams.set('unc', currentUnc);
      url.searchParams.set('q', q);
      url.searchParams.set('match', searchMatch);
      url.searchParams.set('type', searchType);
      if (searchExact) url.searchParams.set('exact', '1');
      const resp = await fetch(url, { signal: ctrl.signal });
      const data = await resp.json();
      if (ctrl.signal.aborted) return;
      showSearchResults(data.results || [], q);
      // show result stats
      const statsDiv = el('div', 'search-stats');
      const count = (data.results || []).length;
      const src = data.source === 'index' ? '⚡ indexed' : '🔍 live';
      statsDiv.textContent = `${count} result${count !== 1 ? 's' : ''} (${src})`;
      if (data.truncated) statsDiv.textContent += ' — refine to see more';
      document.getElementById('searchResults')?.prepend(statsDiv);
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('Search error:', e);
    }
  }, 300);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    showTree();
    searchFiltersDiv.style.display = 'none';
  }
});

// ── Refresh ──
if (refreshBtn) refreshBtn.onclick = () => connectBtn.click();

// ── Clear index cache ──
if (clearCacheBtn) {
  clearCacheBtn.onclick = async () => {
    if (!currentUnc) return;
    clearCacheBtn.disabled = true;
    clearCacheBtn.textContent = '⏳';
    try {
      const res = await fetch(`/api/index/clear?unc=${encodeURIComponent(currentUnc)}`, { method: 'POST' });
      if (res.ok) {
        clearCacheBtn.textContent = '✓';
        await new Promise(r => setTimeout(r, 800));
        // Re-trigger indexing for fresh scan
        triggerIndex(currentUnc);
      }
    } catch(e) { /* ignore */ }
    finally {
      clearCacheBtn.disabled = false;
      clearCacheBtn.textContent = '🔄';
    }
  };
}

// ── Auto-hide credentials ──
function updateMode() {
  const v = (hostInput.value || '').trim();
  const hide = (useUncCb && useUncCb.checked) || v.startsWith('\\\\') || v.startsWith('\\') || v.startsWith('file://') || v.startsWith('//') || /^[A-Za-z]:[\\\/]?$/.test(v) || (v.includes('\\') && v.split('\\')[0].includes('.'));
  userInput.style.display = hide ? 'none' : '';
  passInput.style.display = hide ? 'none' : '';
}
hostInput.addEventListener('input', updateMode);
if (useUncCb) useUncCb.addEventListener('change', updateMode);
updateMode();

// ── Auto-connect and auto-expand root on page load ──
window.addEventListener('DOMContentLoaded', () => {
  if (hostInput.value.trim()) {
    connectBtn.click();
    // after connect resolves, auto-expand the first share node
    const waitForTree = setInterval(() => {
      const firstNode = sharesDiv.querySelector('.node');
      if (firstNode && !firstNode.classList.contains('expanded')) {
        clearInterval(waitForTree);
        firstNode.click();
      } else if (firstNode && firstNode.classList.contains('expanded')) {
        clearInterval(waitForTree);
      }
    }, 100);
    // safety: stop polling after 10s
    setTimeout(() => clearInterval(waitForTree), 10000);
  }
});

