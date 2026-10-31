namespace Hello;

public static class Program
{
    public static string Greet(string name) => $"Hello, {name}!";

    public static void Main() => System.Console.WriteLine(Greet("Ingot"));
}
