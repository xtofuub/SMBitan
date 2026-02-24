from flask import Flask, request, jsonify, Response, send_file
from smb.SMBConnection import SMBConnection
import io
import os
import pathlib
import mimetypes
import threading
import time
import json
import hashlib

app = Flask(__name__, static_folder='static')

# ── In-memory file index for blazing-fast search ──
_index_lock = threading.Lock()
_index = {
    'entries': [],       # list of (name_lower, name, rel_path, is_dir, size)
    'unc': None,
    'status': 'idle',    # idle | indexing | ready | error
    'indexed': 0,
    'errors': 0,
    'started': 0,
    'elapsed': 0,
}

def _build_index(unc_root):
    """Walk entire tree using os.scandir (fast) and populate in-memory index.
    Uses disk cache if available to speed up reconnections."""
    global _index
    base = _normalize_unc(unc_root)
    
    with _index_lock:
        _index['status'] = 'indexing'
        _index['indexed'] = 0
        _index['errors'] = 0
        _index['unc'] = base
        _index['started'] = time.monotonic()
        _index['entries'] = []

    t0 = time.monotonic()

    # Try loading from disk cache first
    cached_entries = _load_index_from_disk(base)
    if cached_entries is not None:
        # Cache hit! Use it immediately
        with _index_lock:
            _index['entries'] = cached_entries
            _index['indexed'] = len(cached_entries)
            _index['errors'] = 0
            _index['elapsed'] = time.monotonic() - t0
            _index['status'] = 'ready'
        app.logger.info(f'Index loaded from cache: {len(cached_entries)} entries in {_index["elapsed"]:.2f}s')
        return

    # Cache miss — do full scan
    entries = []
    errors = 0

    def scan(directory, rel_prefix):
        nonlocal errors
        try:
            with os.scandir(directory) as it:
                for entry in it:
                    if entry.name in ('.', '..'):
                        continue
                    rel = (rel_prefix + '/' + entry.name) if rel_prefix else entry.name
                    try:
                        is_dir = entry.is_dir(follow_symlinks=False)
                        size = 0
                        if not is_dir:
                            try:
                                size = entry.stat(follow_symlinks=False).st_size
                            except Exception:
                                pass
                        entries.append((entry.name.lower(), entry.name, rel, is_dir, size))
                        # update live count every 500 entries
                        if len(entries) % 500 == 0:
                            with _index_lock:
                                _index['indexed'] = len(entries)
                                _index['elapsed'] = time.monotonic() - t0
                        if is_dir:
                            scan(entry.path, rel)
                    except Exception:
                        errors += 1
                        continue
        except Exception:
            errors += 1

    try:
        scan(base, '')
        elapsed = time.monotonic() - t0
        with _index_lock:
            _index['entries'] = entries
            _index['indexed'] = len(entries)
            _index['errors'] = errors
            _index['elapsed'] = elapsed
            _index['status'] = 'ready'
        app.logger.info(f'Index built: {len(entries)} entries in {elapsed:.1f}s ({errors} errors)')
        # Save to cache for next time
        _save_index_to_disk(base, entries, elapsed)
    except Exception as e:
        with _index_lock:
            _index['status'] = 'error'
            _index['errors'] = errors
            _index['elapsed'] = time.monotonic() - t0
        app.logger.exception(f'Index build failed: {e}')


def _normalize_unc(unc):
    base = unc
    if base.startswith('file://'):
        base = base[len('file://'):]
    base = base.replace('/', os.sep).rstrip(os.sep)
    if os.name == 'nt':
        stripped = base.lstrip(os.sep)
        base = os.sep + os.sep + stripped
    return os.path.normpath(base)

def _get_cache_file(unc_path):
    """Generate a cache filename based on UNC path hash."""
    # Create .index_cache directory if it doesn't exist
    cache_dir = os.path.join(os.path.dirname(__file__), '.index_cache')
    os.makedirs(cache_dir, exist_ok=True)
    # Use hash of UNC path as filename (prevents special char issues)
    hash_name = hashlib.md5(unc_path.lower().encode()).hexdigest()
    return os.path.join(cache_dir, f'{hash_name}.json')

def _save_index_to_disk(unc_path, entries, elapsed):
    """Save index to disk as JSON."""
    try:
        cache_file = _get_cache_file(unc_path)
        data = {
            'unc': unc_path,
            'timestamp': time.time(),
            'elapsed': elapsed,
            'entries': entries,
        }
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        app.logger.info(f'Index cached to {cache_file}')
    except Exception as e:
        app.logger.warning(f'Failed to save index cache: {e}')

def _load_index_from_disk(unc_path, max_age_hours=24):
    """Load index from disk if it exists and is fresh."""
    try:
        cache_file = _get_cache_file(unc_path)
        if not os.path.exists(cache_file):
            return None
        # Check age
        mtime = os.path.getmtime(cache_file)
        age_hours = (time.time() - mtime) / 3600
        if age_hours > max_age_hours:
            app.logger.info(f'Index cache stale (age={age_hours:.1f}h), will rescan')
            return None
        # Load
        with open(cache_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        app.logger.info(f'Loaded index from cache ({len(data["entries"])} entries, age={age_hours:.1f}h)')
        return data['entries']
    except Exception as e:
        app.logger.warning(f'Failed to load index cache: {e}')
        return None

def smb_connect(host, username='', password=''):
    client_name = 'pyclient'
    server_name = host
    conn = SMBConnection(username, password, client_name, server_name, use_ntlm_v2=True)
    conn.connect(host, 445, timeout=10)
    return conn

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/api/shares')
def list_shares():
    # Note: this endpoint traditionally lists SMB shares. If a UNC root is
    # provided via the `unc` query parameter and the server has filesystem
    # access to that path, return a single synthetic "share" entry so the
    # frontend can drill into the UNC location without SMB auth.
    host = request.args.get('host')
    unc = request.args.get('unc')
    username = request.args.get('user', '')
    password = request.args.get('pass', '')
    if unc:
        # normalize UNC: accept file:// or leading backslashes
        u = unc
        if u.startswith('file://'):
            u = u[len('file://'):]
        # replace forward slashes with os.sep
        u = u.replace('/', os.sep)
        u = u.strip()
        # return single share representing the UNC root
        root_name = os.path.basename(u.rstrip(os.sep)) or u
        return jsonify({'shares': [{'name': root_name, 'unc': u}]})
    if not host:
        return jsonify({'error': 'host is required'}), 400
    try:
        conn = smb_connect(host, username, password)
        shares = []
        for s in conn.listShares():
            try:
                if not s.isSpecial:
                    shares.append({'name': s.name, 'comments': s.comments})
            except Exception:
                continue
        conn.close()
        return jsonify({'shares': shares})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/list')
def list_path():
    host = request.args.get('host')
    share = request.args.get('share')
    path = request.args.get('path', '')
    username = request.args.get('user', '')
    password = request.args.get('pass', '')
    unc = request.args.get('unc')
    # require either SMB host+share, or an UNC root
    if not ((host and share) or unc):
        return jsonify({'error': 'host and share or unc required'}), 400
    # If unc param is provided, ignore SMB and list from filesystem instead
    if unc:
        base = unc
        # normalize
        if base.startswith('file://'):
            base = base[len('file://'):]
        base = base.replace('/', os.sep)
        base = base.rstrip(os.sep)
        # On Windows normalize leading slashes to a standard UNC prefix (\\server\share)
        if os.name == 'nt':
            # strip all leading separators then prefix with exactly two
            stripped = base.lstrip(os.sep)
            base = os.sep + os.sep + stripped
        # normalize base
        base = os.path.normpath(base)
        # build full path
        if path:
            target = os.path.normpath(os.path.join(base, path.replace('/', os.sep)))
        else:
            target = base
        # safety: ensure target is inside base
        if not target.lower().startswith(base.lower()):
            msg = f'path escapes UNC root; base={base!r} target={target!r}'
            app.logger.warning(msg)
            return jsonify({'error': msg}), 400
        try:
            app.logger.info(f'Listing UNC path: base={base!r} target={target!r}')
            entries = []
            try:
                names = os.listdir(target)
            except Exception as e:
                msg = f'UNC listdir error: base={base!r} target={target!r} exc={e!s}'
                app.logger.exception(msg)
                return jsonify({'error': msg}), 500
            for name in names:
                if name in ('.', '..'):
                    continue
                fp = os.path.join(target, name)
                try:
                    stat = os.stat(fp)
                    entries.append({'name': name, 'isDirectory': os.path.isdir(fp), 'size': stat.st_size})
                except Exception as e:
                    # skip entries that raise (special system files, permissions, transient network errors)
                    app.logger.warning(f"Skipping unreadable entry: {fp!r} exc={e!s}")
                    continue
            return jsonify({'files': entries})
        except Exception as e:
            msg = f'UNC access error: base={base!r} target={target!r} exc={e!s}'
            app.logger.exception(msg)
            return jsonify({'error': msg}), 500
    try:
        conn = smb_connect(host, username, password)
        entries = conn.listPath(share, path)
        files = []
        for e in entries:
            if e.filename in ['.', '..']:
                continue
            files.append({
                'name': e.filename,
                'isDirectory': e.isDirectory,
                'size': getattr(e, 'file_size', 0)
            })
        conn.close()
        return jsonify({'files': files})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/index', methods=['POST'])
def start_index():
    """Trigger background indexing of the UNC root."""
    unc = request.args.get('unc')
    if not unc and request.is_json:
        unc = request.json.get('unc', '')
    if not unc:
        return jsonify({'error': 'unc is required'}), 400
    with _index_lock:
        if _index['status'] == 'indexing':
            return jsonify({'status': 'indexing', 'indexed': _index['indexed']})
    t = threading.Thread(target=_build_index, args=(unc,), daemon=True)
    t.start()
    return jsonify({'status': 'indexing', 'indexed': 0})

@app.route('/api/index/status')
def index_status():
    """Return current index status."""
    with _index_lock:
        return jsonify({
            'status': _index['status'],
            'indexed': _index['indexed'],
            'errors': _index['errors'],
            'elapsed': round(_index['elapsed'], 2),
        })

@app.route('/api/index/clear', methods=['POST'])
def clear_index_cache():
    """Clear the index cache and force a rescan on next connect."""
    unc = request.args.get('unc')
    if not unc:
        return jsonify({'error': 'unc is required'}), 400
    try:
        cache_file = _get_cache_file(_normalize_unc(unc))
        if os.path.exists(cache_file):
            os.remove(cache_file)
            app.logger.info(f'Cleared index cache: {cache_file}')
        return jsonify({'status': 'cache cleared', 'will_rescan': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/search')
def search_files():
    """Search the in-memory index. Falls back to live walk if index not ready."""
    unc = request.args.get('unc')
    query = request.args.get('q', '').strip().lower()
    max_results = int(request.args.get('limit', 500))
    match_mode = request.args.get('match', 'name')   # name | path
    type_filter = request.args.get('type', 'all')     # all | file | dir
    exact = request.args.get('exact', '0') == '1'     # exact word match
    if not unc or not query:
        return jsonify({'error': 'unc and q are required'}), 400

    # Split query into terms for AND matching
    terms = query.split()

    def matches(name_lower, rel_path_lower, is_dir):
        # type filter
        if type_filter == 'file' and is_dir:
            return False
        if type_filter == 'dir' and not is_dir:
            return False
        # choose haystack
        haystack = name_lower if match_mode == 'name' else rel_path_lower
        if exact:
            # all terms must appear as whole words
            import re
            return all(re.search(r'(?:^|[\s._\-\\/])' + re.escape(t) + r'(?:$|[\s._\-\\/])', haystack) for t in terms)
        else:
            return all(t in haystack for t in terms)

    with _index_lock:
        status = _index['status']
        entries = _index['entries']
        idx_unc = _index['unc']

    norm_unc = _normalize_unc(unc)
    if entries and idx_unc and idx_unc.lower() == norm_unc.lower():
        results = []
        for name_lower, name, rel_path, is_dir, size in entries:
            if matches(name_lower, rel_path.lower(), is_dir):
                entry = {'name': name, 'path': rel_path, 'isDirectory': is_dir, 'size': size}
                results.append(entry)
                if len(results) >= max_results:
                    break
        return jsonify({
            'results': results,
            'truncated': len(results) >= max_results,
            'source': 'index',
            'indexStatus': status,
            'indexedCount': len(entries),
        })

    # Fallback: live filesystem walk
    base = norm_unc
    results = []

    def walk(directory, rel_prefix):
        if len(results) >= max_results:
            return
        try:
            with os.scandir(directory) as it:
                for entry in it:
                    if entry.name in ('.', '..'):
                        continue
                    if len(results) >= max_results:
                        return
                    rel_path = (rel_prefix + '/' + entry.name) if rel_prefix else entry.name
                    try:
                        is_dir = entry.is_dir(follow_symlinks=False)
                    except Exception:
                        continue
                    if matches(entry.name.lower(), rel_path.lower(), is_dir):
                        e = {'name': entry.name, 'path': rel_path, 'isDirectory': is_dir}
                        if not is_dir:
                            try:
                                e['size'] = entry.stat(follow_symlinks=False).st_size
                            except Exception:
                                e['size'] = 0
                        results.append(e)
                    if is_dir:
                        walk(entry.path, rel_path)
        except Exception:
            pass

    walk(base, '')
    return jsonify({'results': results, 'truncated': len(results) >= max_results, 'source': 'live'})


@app.route('/api/file')
def get_file():
    host = request.args.get('host')
    share = request.args.get('share')
    path = request.args.get('path')
    username = request.args.get('user', '')
    password = request.args.get('pass', '')
    unc = request.args.get('unc')
    # require either UNC root+path, or SMB host+share+path
    if not ((unc and path) or (host and share and path)):
        return jsonify({'error': 'unc+path or host+share+path required'}), 400
    # UNC filesystem fallback
    if unc:
        base = unc
        if base.startswith('file://'):
            base = base[len('file://'):]
        base = base.replace('/', os.sep).rstrip(os.sep)
        # On Windows normalize leading slashes to a standard UNC prefix
        if os.name == 'nt':
            stripped = base.lstrip(os.sep)
            base = os.sep + os.sep + stripped
        base = os.path.normpath(base)
        target = os.path.normpath(os.path.join(base, path.replace('/', os.sep)))
        if not target.lower().startswith(base.lower()):
            msg = f'path escapes UNC root; base={base!r} target={target!r}'
            app.logger.warning(msg)
            return jsonify({'error': msg}), 400
        if not os.path.exists(target):
            msg = f'file not found; tried path={target!r}'
            app.logger.warning(msg)
            return jsonify({'error': msg}), 404
        try:
            app.logger.info(f'Serving UNC file: base={base!r} target={target!r}')
            mime, _ = mimetypes.guess_type(target)
            return send_file(target, mimetype=mime or 'application/octet-stream', as_attachment=False)
        except Exception as e:
            msg = f'UNC file read error: base={base!r} target={target!r} exc={e!s}'
            app.logger.exception(msg)
            return jsonify({'error': msg}), 500
    try:
        conn = smb_connect(host, username, password)
        bio = io.BytesIO()
        conn.retrieveFile(share, path, bio)
        conn.close()
        data = bio.getvalue()
        # try decode as text
        try:
            text = data.decode('utf-8')
            return Response(text, mimetype='text/plain; charset=utf-8')
        except Exception:
            try:
                text = data.decode('latin-1')
                return Response(text, mimetype='text/plain; charset=latin-1')
            except Exception:
                return Response(data, mimetype='application/octet-stream')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
