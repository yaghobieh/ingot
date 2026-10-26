const metals = ['gold', 'silver', 'copper'];
let total = 0;
for (const metal of metals) {
    total += metal.length;
    console.log(`Forging ${metal}`);
}
console.log(`Total letters: ${total}`);
