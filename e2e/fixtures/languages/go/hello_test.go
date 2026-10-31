package main

import "testing"

func TestGreet(t *testing.T) {
	if got := Greet("Ingot"); got != "Hello, Ingot!" {
		t.Fatalf("got %q", got)
	}
}
