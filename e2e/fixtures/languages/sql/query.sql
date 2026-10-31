CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO people (name) VALUES ('Ingot');
SELECT 'Hello, ' || name || '!' AS greeting FROM people WHERE id = 1;
