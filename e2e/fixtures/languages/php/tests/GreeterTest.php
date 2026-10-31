<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../greeter.php';

final class GreeterTest extends TestCase
{
    public function testGreets(): void
    {
        $this->assertSame('Hello, Ingot!', greet('Ingot'));
    }
}
