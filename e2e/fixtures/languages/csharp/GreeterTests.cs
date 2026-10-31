using Xunit;

namespace Hello;

public class GreeterTests
{
    [Fact]
    public void GreetsByName()
    {
        Assert.Equal("Hello, Ingot!", Program.Greet("Ingot"));
    }
}
