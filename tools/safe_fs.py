#!/usr/bin/env python3
"""Read and write files under Master-Repo folders that agents can also write, without following links.

Agents write into some Master-Repo folders (companies/<slug>/mockups/), so a path there may be a symlink, may be
swapped for one mid-operation, or may be a hard link to a private file. Everything here walks down from the repo
one directory fd at a time with O_NOFOLLOW, reads only regular files with a single link, and writes a fresh file
renamed into place, so none of those can redirect a read or a write.

CLI (used by the app):  safe_fs.py read <relative path>        prints the file
                        safe_fs.py write <relative path>       writes stdin to it
"""
from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def open_dirs(base: Path, parts: list[str], create: bool = False) -> int:
    """A directory fd for base/parts...; refuses a link at any level, optionally creating missing levels."""
    fd = os.open(base, DIR_FLAGS)
    try:
        for part in parts:
            if not part or part in (".", "..") or "/" in part or "\0" in part:
                raise OSError(f"bad path part: {part!r}")
            try:
                nxt = os.open(part, DIR_FLAGS, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(part, 0o755, dir_fd=fd)
                nxt = os.open(part, DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_single(path: str | Path, dir_fd: int | None = None, limit: int = 20_000_000) -> bytes:
    """A regular file's bytes, refusing links: no symlink at the name, and no hard link (st_nlink must be 1)."""
    # O_NONBLOCK: a FIFO or device planted at the name opens without waiting and is then refused below.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dir_fd)
    with os.fdopen(fd, "rb") as fh:
        st = os.fstat(fh.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            raise OSError(f"not a plain single-link file: {path}")
        if st.st_size > limit:
            raise OSError(f"too large: {path}")
        return fh.read()


def write_at(dir_fd: int, name: str, data: bytes) -> None:
    """Write a fresh file and rename it over `name`: whatever was at the name is replaced, never written through."""
    tmp = f".{name}.{os.getpid()}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=dir_fd)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
        os.replace(tmp, name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
    except BaseException:
        try:
            os.unlink(tmp, dir_fd=dir_fd)
        except OSError:
            pass
        raise


def split(rel: str) -> tuple[list[str], str]:
    parts = rel.split("/")
    if len(parts) < 2 or rel.startswith("/"):
        raise OSError(f"bad path: {rel!r}")
    return parts[:-1], parts[-1]


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("read", "write"):
        print(__doc__, file=sys.stderr)
        return 2
    action, rel = argv
    dirs, name = split(rel)
    if dirs[0] != "companies":
        print("only companies/ is served", file=sys.stderr)
        return 2
    try:
        dfd = open_dirs(ROOT, dirs)
        try:
            if action == "read":
                sys.stdout.buffer.write(read_single(name, dir_fd=dfd))
            else:
                write_at(dfd, name, sys.stdin.buffer.read())
        finally:
            os.close(dfd)
    except OSError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
