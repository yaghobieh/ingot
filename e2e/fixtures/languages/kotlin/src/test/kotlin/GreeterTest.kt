import kotlin.test.Test
import kotlin.test.assertEquals

class GreeterTest {
    @Test
    fun `greets by name`() {
        assertEquals("Hello, Ingot!", Greeter.greet("Ingot"))
    }
}
