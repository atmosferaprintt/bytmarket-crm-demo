"""Restore drill against temporary SQLite databases, including live WAL changes."""

from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from scripts.backup_db import copy_database, verify_database


class BackupRestoreTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "source.sqlite3"
        self.backup = self.root / "backup.sqlite3"
        self.restored = self.root / "restored.sqlite3"
        self.conn = sqlite3.connect(self.source)
        self.addCleanup(self.conn.close)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA wal_autocheckpoint=0")
        self.conn.executescript("""
            CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE orders(id INTEGER PRIMARY KEY, total INTEGER NOT NULL);
            CREATE TABLE order_lines(id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders,
                                     product_id INTEGER REFERENCES products, quantity INTEGER);
            INSERT INTO products VALUES(1, 'Средство'), (2, 'Губки');
            INSERT INTO orders VALUES(1, 12345);
            INSERT INTO order_lines VALUES(1, 1, 1, 3), (2, 1, 2, 12);
        """)

    def snapshot(self, path):
        connection = sqlite3.connect(path)
        try:
            return {name: connection.execute(f"SELECT * FROM {name} ORDER BY id").fetchall()
                    for name in ("products", "orders", "order_lines")}
        finally:
            connection.close()

    def test_backup_and_separate_restore_preserve_counts_rows_and_wal(self):
        self.assertTrue(Path(str(self.source) + "-wal").is_file())
        expected = self.snapshot(self.source)
        copy_database(self.source, self.backup)
        self.assertFalse(Path(str(self.backup) + "-wal").exists())
        self.assertFalse(Path(str(self.backup) + "-shm").exists())
        # Changes after the snapshot must not leak into the restored database.
        self.conn.execute("INSERT INTO orders VALUES(2, 50000)")
        self.conn.commit()
        copy_database(self.backup, self.restored)
        self.assertEqual(verify_database(self.restored)["integrity_check"], "ok")
        actual = self.snapshot(self.restored)
        self.assertEqual({key: len(rows) for key, rows in actual.items()},
                         {"products": 2, "orders": 1, "order_lines": 2})
        self.assertEqual(actual, expected)
        # Restore is a usable independent database, not just a readable backup file.
        restored_connection = sqlite3.connect(self.restored)
        try:
            restored_connection.execute("INSERT INTO orders VALUES(3, 25000)")
            restored_connection.commit()
        finally:
            restored_connection.close()
        self.assertEqual(len(self.snapshot(self.restored)["orders"]), 2)
        self.assertEqual(self.snapshot(self.backup), expected)

    def test_backup_and_restore_refuse_overwriting_existing_database(self):
        copy_database(self.source, self.backup)
        before = self.backup.read_bytes()
        with self.assertRaises(FileExistsError):
            copy_database(self.source, self.backup)
        self.assertEqual(self.backup.read_bytes(), before)
        before_source = self.snapshot(self.source)
        with self.assertRaises(FileExistsError):
            copy_database(self.backup, self.source)
        self.assertEqual(self.snapshot(self.source), before_source)

    def test_corrupted_backup_is_detected_and_not_restored(self):
        self.backup.write_bytes(b"This is not a SQLite database" * 100)
        with self.assertRaises((sqlite3.DatabaseError, ValueError)):
            verify_database(self.backup)
        with self.assertRaises((sqlite3.DatabaseError, ValueError)):
            copy_database(self.backup, self.restored)
        self.assertFalse(self.restored.exists())

    def test_verification_does_not_create_a_missing_database(self):
        with self.assertRaises(FileNotFoundError):
            verify_database(self.backup)
        self.assertFalse(self.backup.exists())

    def test_dangling_destination_symlink_is_not_followed(self):
        missing_target = self.root / "must-not-be-created.sqlite3"
        self.backup.symlink_to(missing_target)
        with self.assertRaises(FileExistsError):
            copy_database(self.source, self.backup)
        self.assertTrue(self.backup.is_symlink())
        self.assertFalse(missing_target.exists())

    def test_cli_backup_verify_restore_and_overwrite_exit_codes(self):
        script = Path(__file__).resolve().parents[1] / "scripts" / "backup_db.py"

        def run(*args):
            return subprocess.run([sys.executable, str(script), *map(str, args)],
                                  capture_output=True, text=True, check=False)

        for arguments in (
            ("--source", self.source, "--destination", self.backup),
            ("--verify", self.backup),
            ("--restore", self.backup, "--destination", self.restored),
        ):
            result = run(*arguments)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"integrity_check": "ok"', result.stdout)
        result = run("--restore", self.backup, "--destination", self.restored)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Перезапись запрещена", result.stderr)
        self.assertEqual(self.snapshot(self.source), self.snapshot(self.restored))


if __name__ == "__main__":
    unittest.main()
