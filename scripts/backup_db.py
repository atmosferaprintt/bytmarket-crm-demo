"""Create and verify local SQLite snapshots, or restore into a new database."""

import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys


def readonly_connection(path):
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"База не найдена: {source}")
    return sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=30)


def verify_database(path):
    """Check the real database without silently creating a missing file."""
    connection = readonly_connection(path)
    try:
        messages = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        if messages != ["ok"]:
            raise ValueError("Проверка целостности не пройдена: " + "; ".join(messages))
        return {"path": str(Path(path).expanduser().resolve()), "integrity_check": "ok"}
    finally:
        connection.close()


def copy_database(source, destination):
    """Use SQLite's snapshot API, including committed changes in a live WAL."""
    source_path = Path(source).expanduser().resolve()
    # Do not resolve the final component: even a dangling symlink must not be overwritten.
    target = Path(destination).expanduser().absolute()
    if target.exists() or target.is_symlink():
        raise FileExistsError(f"Перезапись запрещена: {target}")
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = Path(str(target) + suffix)
        if sidecar.exists() or sidecar.is_symlink():
            raise FileExistsError(f"У назначения уже есть файл SQLite: {sidecar}")
    verify_database(source_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Atomic exclusive creation prevents overwriting a file created after the existence check.
    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        reader = readonly_connection(source_path)
        try:
            writer = sqlite3.connect(str(target), timeout=30)
            try:
                reader.backup(writer, pages=256, sleep=0.05)
                # Keep the snapshot self-contained, without WAL/SHM sidecars.
                mode = writer.execute("PRAGMA journal_mode=DELETE").fetchone()[0]
                if mode != "delete":
                    raise ValueError("Не удалось создать автономную копию SQLite")
            finally:
                writer.close()
        finally:
            reader.close()
        # SQLite versions can leave an unused SHM after converting a WAL snapshot.
        # The destination is newly owned here and all its connections are closed.
        for suffix in ("-wal", "-shm"):
            Path(str(target) + suffix).unlink(missing_ok=True)
        return verify_database(target)
    except BaseException:
        # A failed snapshot is not left behind as an apparently usable backup.
        target.unlink(missing_ok=True)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description="Локальная резервная копия и восстановление SQLite")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--source", metavar="DATABASE", help="Создать резервную копию этой БД")
    mode.add_argument("--restore", metavar="BACKUP", help="Восстановить копию в новую БД")
    mode.add_argument("--verify", metavar="DATABASE", help="Проверить целостность БД")
    parser.add_argument("--destination", metavar="NEW_FILE", help="Новый файл, перезапись запрещена")
    args = parser.parse_args(argv)
    if args.verify and args.destination:
        parser.error("--verify не использует --destination")
    if not args.verify and not args.destination:
        parser.error("Для копирования и восстановления требуется --destination")
    try:
        if args.verify:
            result = verify_database(args.verify)
            result["operation"] = "verify"
        else:
            result = copy_database(args.source or args.restore, args.destination)
            result["operation"] = "restore" if args.restore else "backup"
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
