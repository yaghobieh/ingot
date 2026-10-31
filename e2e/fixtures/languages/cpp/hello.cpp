#include <iostream>
#include <string>

std::string greet(const std::string &name) {
    return "Hello, " + name + "!";
}

int main() {
    std::cout << greet("Ingot") << std::endl;
    return 0;
}
