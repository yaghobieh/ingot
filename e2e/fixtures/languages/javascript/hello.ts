interface Person {
    readonly name: string;
}

const greet = (person: Person): string => `Hello, ${person.name}!`;

console.log(greet({ name: 'Ingot' }));
