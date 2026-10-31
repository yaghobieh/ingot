require "minitest/autorun"
require_relative "../hello"

class GreetTest < Minitest::Test
  def test_greets_by_name
    assert_equal "Hello, Ingot!", greet("Ingot")
  end
end
