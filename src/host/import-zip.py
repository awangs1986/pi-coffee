"""Bounded ZIP project import. Never import Git metadata or filesystem links."""
import os, stat, sys, zipfile
archive, target = sys.argv[1:]
with zipfile.ZipFile(archive) as z:
    files = z.infolist()
    if len(files) > 10000 or sum(f.file_size for f in files) > 256 * 1024 * 1024:
        raise ValueError('Archive exceeds 10000 entries / 256 MiB expanded limit')
    seen = set()
    for f in files:
        parts = f.filename.replace('\\', '/').split('/')
        mode = f.external_attr >> 16
        if f.filename in seen or f.flag_bits & 1 or f.filename.startswith(('/', '\\')) or any(p in ('..', '.git') or ':' in p for p in parts) or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
            raise ValueError('Unsafe ZIP entry')
        seen.add(f.filename)
        path = os.path.realpath(os.path.join(target, *parts))
        if os.path.commonpath([path, os.path.realpath(target)]) != os.path.realpath(target):
            raise ValueError('Escaping ZIP entry')
    for f in files:
        path = os.path.join(target, *f.filename.replace('\\','/').split('/'))
        if f.is_dir():
            os.makedirs(path, exist_ok=True)
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with z.open(f) as source, open(path, 'xb') as dest:
                remaining=f.file_size
                while True:
                    chunk=source.read(min(65536,remaining+1))
                    if not chunk: break
                    remaining-=len(chunk)
                    if remaining<0: raise ValueError('Expanded size mismatch')
                    dest.write(chunk)
