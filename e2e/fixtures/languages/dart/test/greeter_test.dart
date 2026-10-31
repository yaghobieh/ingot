import 'package:hello/greeter.dart';
import 'package:test/test.dart';

void main() {
  group('greet', () {
    test('greets by name', () {
      expect(greet('Ingot'), 'Hello, Ingot!');
    });
  });
}
