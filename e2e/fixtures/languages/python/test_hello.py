import unittest

from hello import greet


class GreetTest(unittest.TestCase):
    def test_greets_by_name(self):
        self.assertEqual(greet("Ingot"), "Hello, Ingot!")


if __name__ == "__main__":
    unittest.main()
