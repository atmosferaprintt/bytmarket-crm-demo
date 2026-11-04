"""Business invariants for the local CRM prototype; no external services needed."""

import copy
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app.server import (
    add_stock,
    cancel_order,
    connect_db,
    create_client,
    create_order,
    create_product,
    get_state,
    init_db,
)


class InventoryAndOrdersTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = str(Path(self.directory.name) / "crm.sqlite3")
        init_db(self.path)
        self.conn = connect_db(self.path)
        self.addCleanup(self.conn.close)
        self.client = create_client(self.conn, {"name": "Тестовый покупатель"})
        self.sequence = 0

    def product(self, stock=0, price=125.50, box=12):
        self.sequence += 1
        result = create_product(self.conn, {
            "name": f"Средство {self.sequence}",
            "sku": f"TEST-{self.sequence}",
            "price": price,
            "unit_size": box,
        })
        if stock:
            add_stock(self.conn, {"product_id": result["id"], "quantity": stock, "reason": "Начальный приход для теста"})
        return result

    def payload(self, product, quantity=1, unit_size=1, key="test-order"):
        return {
            "client_id": self.client["id"],
            "idempotency_key": key,
            "lines": [{"product_id": product["id"], "quantity": quantity,
                       "unit_size": unit_size}],
        }

    def inventory(self, product):
        current = next(row for row in get_state(self.conn)["products"]
                       if row["id"] == product["id"])
        self.assertEqual(current["available"], current["stock"] - current["reserved"])
        return {"quantity": current["stock"], "reserved": current["reserved"]}

    def lines(self, order):
        return [dict(row) for row in self.conn.execute(
            "SELECT product_id, name, quantity, unit_size, price, total "
            "FROM order_lines WHERE order_id = ? ORDER BY product_id",
            (order["id"],),
        )]

    def test_three_boxes_reserve_thirty_six_pieces(self):
        product = self.product(stock=40)
        order = create_order(self.conn, self.payload(product, quantity=3, unit_size=12))
        self.assertEqual(self.inventory(product), {"quantity": 40, "reserved": 36})
        self.assertEqual(sum(line["quantity"] * line["unit_size"]
                             for line in self.lines(order)), 36)
        self.assertEqual(len(get_state(self.conn)["orders"]), 1)

    def test_concurrent_orders_cannot_reserve_last_piece_twice(self):
        product = self.product(stock=1)
        barrier = threading.Barrier(2)

        def reserve(key):
            conn = connect_db(self.path)
            try:
                barrier.wait(timeout=5)
                try:
                    return ("created", create_order(conn, self.payload(product, key=key)))
                except ValueError as error:
                    return ("rejected", str(error))
            finally:
                conn.close()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(reserve, key) for key in ("first", "second")]
            results = [future.result(timeout=15) for future in futures]
        self.assertCountEqual([result[0] for result in results], ["created", "rejected"])
        self.assertEqual(self.inventory(product), {"quantity": 1, "reserved": 1})
        self.assertEqual(len(get_state(self.conn)["orders"]), 1)

    def test_identical_retry_returns_original_order_without_new_reservation(self):
        product = self.product(stock=20)
        payload = self.payload(product, quantity=4)
        first = create_order(self.conn, payload)
        before = get_state(self.conn)
        second = create_order(self.conn, copy.deepcopy(payload))
        self.assertEqual(second["id"], first["id"])
        self.assertEqual(get_state(self.conn), before)
        self.assertEqual(self.inventory(product)["reserved"], 4)

    def test_reused_key_with_different_payload_is_rejected(self):
        product = self.product(stock=20)
        payload = self.payload(product, quantity=4)
        create_order(self.conn, payload)
        before = get_state(self.conn)
        changed = copy.deepcopy(payload)
        changed["lines"][0]["quantity"] = 5
        with self.assertRaises(ValueError):
            create_order(self.conn, changed)
        self.assertEqual(get_state(self.conn), before)
        self.assertEqual(self.inventory(product)["reserved"], 4)

    def test_repeated_cancellation_does_not_release_another_orders_stock(self):
        product = self.product(stock=20)
        first = create_order(self.conn, self.payload(product, quantity=4, key="first"))
        create_order(self.conn, self.payload(product, quantity=3, key="second"))
        cancel_order(self.conn, first["id"])
        self.assertEqual(self.inventory(product), {"quantity": 20, "reserved": 3})
        before = get_state(self.conn)
        cancel_order(self.conn, first["id"])
        self.assertEqual(get_state(self.conn), before)
        self.assertEqual(self.inventory(product)["reserved"], 3)

    def test_negative_receipt_is_rejected_without_changing_inventory(self):
        product = self.product(stock=10)
        before = get_state(self.conn)
        with self.assertRaises(ValueError):
            add_stock(self.conn, {"product_id": product["id"], "quantity": -2, "reason": "Проверка отрицательного прихода"})
        self.assertEqual(get_state(self.conn), before)
        self.assertEqual(self.inventory(product), {"quantity": 10, "reserved": 0})

    def test_insufficient_second_line_rolls_back_entire_order(self):
        available = self.product(stock=10)
        unavailable = self.product(stock=1)
        payload = self.payload(available, quantity=3)
        payload["lines"].append({"product_id": unavailable["id"], "quantity": 2,
                                  "unit_size": 1})
        before = get_state(self.conn)
        with self.assertRaises(ValueError):
            create_order(self.conn, payload)
        self.assertEqual(get_state(self.conn), before)
        self.assertEqual(self.inventory(available)["reserved"], 0)
        self.assertEqual(self.inventory(unavailable)["reserved"], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM order_lines").fetchone()[0], 0)
        # A failed request must not consume the key and prevent a corrected retry.
        payload["lines"][1]["quantity"] = 1
        create_order(self.conn, payload)
        self.assertEqual(len(get_state(self.conn)["orders"]), 1)

    def test_catalog_price_change_does_not_rewrite_order_history(self):
        product = self.product(stock=20, price=125.50)
        first = create_order(self.conn, self.payload(product, quantity=2, key="old-price"))
        historical_lines = self.lines(first)
        self.assertEqual(historical_lines[0]["price"], 12550)
        self.assertEqual(historical_lines[0]["total"], 25100)
        self.conn.execute("UPDATE products SET price = ? WHERE id = ?", (20000, product["id"]))
        second = create_order(self.conn, self.payload(product, quantity=2, key="new-price"))
        self.assertEqual(self.lines(first), historical_lines)
        self.assertEqual(self.lines(second)[0]["price"], 20000)
        self.assertEqual(self.lines(second)[0]["total"], 40000)
        self.assertEqual(len(get_state(self.conn)["orders"]), 2)


if __name__ == "__main__":
    unittest.main()
