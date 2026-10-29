import { LIBRARY_SERVER_PORT } from './library-app.consts';
import type { LibraryFile, NodeStructure, ReactStructure } from './library-app.types';

const file = (path: string, content: string): LibraryFile => ({ path, content: content.endsWith('\n') ? content : `${content}\n` });

const DOMAIN = `export class LibraryError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
    }
}

export interface Author { id: string; name: string; }
export interface Book { id: string; title: string; authorId: string; }
export interface Member { id: string; name: string; email: string; }
export interface Loan { id: string; bookId: string; memberId: string; borrowedAt: string; returnedAt?: string; }

export class MemoryDb {
    authors = new Map<string, Author>();
    books = new Map<string, Book>();
    members = new Map<string, Member>();
    loans = new Map<string, Loan>();
    private seq = 0;
    nextId(): string {
        this.seq += 1;
        return String(this.seq);
    }
}
`;

const rules = (dbImport: string): string => `import { LibraryError, type Author, type Book, type Loan, type Member, type MemoryDb } from '${dbImport}';

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const text = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new LibraryError(400, \`\${label} is required.\`);
    }
    return value.trim();
};

const emailOf = (value: unknown): string => {
    const found = text(value, 'Email');
    if (!found.includes('@')) {
        throw new LibraryError(400, 'Email must include @.');
    }
    return found;
};

const must = <T>(found: T | undefined, label: string): T => {
    if (found === undefined) {
        throw new LibraryError(404, \`\${label} not found.\`);
    }
    return found;
};

export const libraryApi = (db: MemoryDb) => ({
    listAuthors: (): Author[] => [...db.authors.values()],
    getAuthor: (id: string): Author => must(db.authors.get(id), 'Author'),
    createAuthor: (input: unknown): Author => {
        const author = { id: db.nextId(), name: text(record(input).name, 'Name') };
        db.authors.set(author.id, author);
        return author;
    },
    updateAuthor: (id: string, input: unknown): Author => {
        must(db.authors.get(id), 'Author');
        const author = { id, name: text(record(input).name, 'Name') };
        db.authors.set(id, author);
        return author;
    },
    removeAuthor: (id: string): { ok: true } => {
        must(db.authors.get(id), 'Author');
        if ([...db.books.values()].some(book => book.authorId === id)) {
            throw new LibraryError(409, 'Author still has books.');
        }
        db.authors.delete(id);
        return { ok: true };
    },
    listBooks: (): Book[] => [...db.books.values()],
    getBook: (id: string): Book => must(db.books.get(id), 'Book'),
    createBook: (input: unknown): Book => {
        const data = record(input);
        const authorId = text(data.authorId, 'Author');
        must(db.authors.get(authorId), 'Author');
        const book = { id: db.nextId(), title: text(data.title, 'Title'), authorId };
        db.books.set(book.id, book);
        return book;
    },
    updateBook: (id: string, input: unknown): Book => {
        must(db.books.get(id), 'Book');
        const data = record(input);
        const authorId = text(data.authorId, 'Author');
        must(db.authors.get(authorId), 'Author');
        const book = { id, title: text(data.title, 'Title'), authorId };
        db.books.set(id, book);
        return book;
    },
    removeBook: (id: string): { ok: true } => {
        must(db.books.get(id), 'Book');
        if ([...db.loans.values()].some(loan => loan.bookId === id && !loan.returnedAt)) {
            throw new LibraryError(409, 'Book is on loan.');
        }
        db.books.delete(id);
        return { ok: true };
    },
    listMembers: (): Member[] => [...db.members.values()],
    getMember: (id: string): Member => must(db.members.get(id), 'Member'),
    createMember: (input: unknown): Member => {
        const data = record(input);
        const member = { id: db.nextId(), name: text(data.name, 'Name'), email: emailOf(data.email) };
        db.members.set(member.id, member);
        return member;
    },
    updateMember: (id: string, input: unknown): Member => {
        must(db.members.get(id), 'Member');
        const data = record(input);
        const member = { id, name: text(data.name, 'Name'), email: emailOf(data.email) };
        db.members.set(id, member);
        return member;
    },
    removeMember: (id: string): { ok: true } => {
        must(db.members.get(id), 'Member');
        if ([...db.loans.values()].some(loan => loan.memberId === id && !loan.returnedAt)) {
            throw new LibraryError(409, 'Member has an open loan.');
        }
        db.members.delete(id);
        return { ok: true };
    },
    listLoans: (): Loan[] => [...db.loans.values()],
    getLoan: (id: string): Loan => must(db.loans.get(id), 'Loan'),
    borrow: (input: unknown): Loan => {
        const data = record(input);
        const bookId = text(data.bookId, 'Book');
        const memberId = text(data.memberId, 'Member');
        must(db.books.get(bookId), 'Book');
        must(db.members.get(memberId), 'Member');
        if ([...db.loans.values()].some(loan => loan.bookId === bookId && !loan.returnedAt)) {
            throw new LibraryError(409, 'Book is already on loan.');
        }
        const loan = { id: db.nextId(), bookId, memberId, borrowedAt: new Date().toISOString() };
        db.loans.set(loan.id, loan);
        return loan;
    },
    returnLoan: (id: string): Loan => {
        const loan = must(db.loans.get(id), 'Loan');
        if (loan.returnedAt) {
            throw new LibraryError(409, 'Loan is already returned.');
        }
        const next = { ...loan, returnedAt: new Date().toISOString() };
        db.loans.set(id, next);
        return next;
    }
});
`;

const httpSource = (domainImport: string, dbImport: string, apiImport: string): string => `import { Router, type Request, type Response } from 'express';
import { LibraryError } from '${domainImport}';
import { MemoryDb } from '${dbImport}';
import { libraryApi } from '${apiImport}';

const send = (fn: (req: Request) => unknown) => (req: Request, res: Response): void => {
    Promise.resolve()
        .then(() => fn(req))
        .then(body => {
            if (!res.headersSent) {
                res.json(body ?? {});
            }
        })
        .catch((error: unknown) => {
            const status = error instanceof LibraryError ? error.status : 500;
            const message = error instanceof Error ? error.message : 'Error';
            res.status(status).json({ error: message });
        });
};

export const apiRouter = (): Router => {
    const api = libraryApi(new MemoryDb());
    const router = Router();
    router.get('/authors', send(() => api.listAuthors()));
    router.post('/authors', send(req => api.createAuthor(req.body)));
    router.get('/authors/:id', send(req => api.getAuthor(String(req.params.id))));
    router.put('/authors/:id', send(req => api.updateAuthor(String(req.params.id), req.body)));
    router.delete('/authors/:id', send(req => api.removeAuthor(String(req.params.id))));
    router.get('/books', send(() => api.listBooks()));
    router.post('/books', send(req => api.createBook(req.body)));
    router.get('/books/:id', send(req => api.getBook(String(req.params.id))));
    router.put('/books/:id', send(req => api.updateBook(String(req.params.id), req.body)));
    router.delete('/books/:id', send(req => api.removeBook(String(req.params.id))));
    router.get('/members', send(() => api.listMembers()));
    router.post('/members', send(req => api.createMember(req.body)));
    router.get('/members/:id', send(req => api.getMember(String(req.params.id))));
    router.put('/members/:id', send(req => api.updateMember(String(req.params.id), req.body)));
    router.delete('/members/:id', send(req => api.removeMember(String(req.params.id))));
    router.get('/loans', send(() => api.listLoans()));
    router.get('/loans/:id', send(req => api.getLoan(String(req.params.id))));
    router.post('/loans/borrow', send(req => api.borrow(req.body)));
    router.post('/loans/:id/return', send(req => api.returnLoan(String(req.params.id))));
    return router;
};
`;


const SERVER_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app';

const listen = (app: ReturnType<typeof createApp>): Promise<Server> => new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
});

const close = (server: Server): Promise<void> => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
});

const send = async (base: string, method: string, path: string, payload?: unknown): Promise<{ status: number; data: Record<string, string | boolean> }> => {
    const response = await fetch(\`\${base}\${path}\`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });
    const raw = await response.json().catch(() => ({}));
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, string | boolean> : {};
    return { status: response.status, data };
};

test('library API: authors, books, members, loans, borrow and return', async () => {
    const server = await listen(createApp());
    const address = server.address() as AddressInfo;
    const base = \`http://127.0.0.1:\${address.port}\`;
    try {
        const missingName = await send(base, 'POST', '/api/authors', {});
        assert.equal(missingName.status, 400);

        const author = await send(base, 'POST', '/api/authors', { name: 'Herbert' });
        assert.equal(author.status, 200);
        const authorId = String(author.data.id);
        const renamed = await send(base, 'PUT', \`/api/authors/\${authorId}\`, { name: 'Frank Herbert' });
        assert.equal(renamed.data.name, 'Frank Herbert');

        const book = await send(base, 'POST', '/api/books', { title: 'Dune', authorId });
        assert.equal(book.data.title, 'Dune');
        const bookId = String(book.data.id);
        const listed = await fetch(\`\${base}/api/books\`);
        const listedBooks = await listed.json() as { title: string }[];
        assert.equal(listedBooks.length, 1);
        assert.equal(listedBooks[0].title, 'Dune');

        const badEmail = await send(base, 'POST', '/api/members', { name: 'Ada', email: 'ada' });
        assert.equal(badEmail.status, 400);
        const member = await send(base, 'POST', '/api/members', { name: 'Ada', email: 'ada@example.com' });
        const memberId = String(member.data.id);

        const loan = await send(base, 'POST', '/api/loans/borrow', { bookId, memberId });
        assert.equal(loan.status, 200);
        const loanId = String(loan.data.id);
        const again = await send(base, 'POST', '/api/loans/borrow', { bookId, memberId });
        assert.equal(again.status, 409);

        const gone = await send(base, 'GET', '/api/books/missing');
        assert.equal(gone.status, 404);

        const returned = await send(base, 'POST', \`/api/loans/\${loanId}/return\`);
        assert.equal(typeof returned.data.returnedAt, 'string');
        const twice = await send(base, 'POST', \`/api/loans/\${loanId}/return\`);
        assert.equal(twice.status, 409);

        const removed = await send(base, 'DELETE', \`/api/books/\${bookId}\`);
        assert.equal(removed.data.ok, true);
    } finally {
        await close(server);
    }
});
`;

const expressApp = (routerImport: string): string => `import express from 'express';
import { apiRouter } from '${routerImport}';

export const createApp = (): express.Express => {
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter());
    return app;
};
`;

const INDEX = `import { createApp } from './app';

const port = ${LIBRARY_SERVER_PORT};
createApp().listen(port, '127.0.0.1', () => {
    console.log(\`Library API listening on \${port}\`);
});
`;

const SERVER_PACKAGE = `{
  "name": "library-server",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "npm run build && node --test dist/app.test.js"
  },
  "dependencies": {
    "express": "^4.21.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.0",
    "typescript": "^5.6.3"
  }
}
`;

const SERVER_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`;

const modularApp = `import express from 'express';
import { authorsApi } from './modules/authors/authors';
import { booksApi } from './modules/books/books';
import { loansApi } from './modules/loans/loans';
import { membersApi } from './modules/members/members';

export const moduleApis = { authorsApi, booksApi, membersApi, loansApi };

export const createApp = (): express.Express => {
    const app = express();
    app.use(express.json());
    app.use('/api', booksApi());
    return app;
};
`;

export const libraryServerFiles = (node: NodeStructure): LibraryFile[] => {
    const layered = node === 'layered';
    const httpDomain = layered ? '../domain' : './shared/domain';
    const httpDb = layered ? '../repositories/memory-repository' : './shared/repository';
    const httpApi = layered ? '../services/library-service' : './shared/rules';
    const routerFile = layered ? 'server/src/controllers/library-controller.ts' : 'server/src/modules/http.ts';
    const rulesFile = layered ? 'server/src/services/library-service.ts' : 'server/src/modules/shared/rules.ts';
    const dbFile = layered ? 'server/src/repositories/memory-repository.ts' : 'server/src/modules/shared/repository.ts';
    const domainFile = layered ? 'server/src/domain.ts' : 'server/src/modules/shared/domain.ts';
    return [
        file('server/package.json', SERVER_PACKAGE),
        file('server/tsconfig.json', SERVER_TSCONFIG),
        file(domainFile, DOMAIN),
        file(dbFile, `export { MemoryDb } from '${layered ? '../domain' : './domain'}';\n`),
        file(rulesFile, rules(layered ? '../domain' : './domain')),
        file(routerFile, httpSource(httpDomain, httpDb, httpApi)),
        ...(layered ? [
            file('server/src/controllers/routes.ts', `export { apiRouter } from './library-controller';\n`)
        ] : [
            file('server/src/modules/books/books.ts', `export { apiRouter as booksApi } from '../http';\n`),
            file('server/src/modules/authors/authors.ts', `export { apiRouter as authorsApi } from '../http';\n`),
            file('server/src/modules/members/members.ts', `export { apiRouter as membersApi } from '../http';\n`),
            file('server/src/modules/loans/loans.ts', `export { apiRouter as loansApi } from '../http';\n`)
        ]),
        file('server/src/app.ts', layered ? expressApp('./controllers/library-controller') : modularApp),
        file('server/src/index.ts', INDEX),
        file('server/src/app.test.ts', SERVER_TEST)
    ];
};


const CLIENT_PACKAGE = `{
  "name": "library-client",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "tsc -p tsconfig.test.json && node --test dist-test/App.test.js"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.6.3",
    "vite": "^6.0.0"
  }
}
`;

const CLIENT_TSCONFIG_TEST = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "jsx": "react-jsx",
    "outDir": "dist-test",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "node",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"]
}
`;

const VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: { proxy: { '/api': 'http://127.0.0.1:${LIBRARY_SERVER_PORT}' } }
});
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Library</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const TYPES = `export interface Author { id: string; name: string; }
export interface Book { id: string; title: string; authorId: string; }
export interface Member { id: string; name: string; email: string; }
export interface Loan { id: string; bookId: string; memberId: string; borrowedAt: string; returnedAt?: string; }
`;

const API = `export const readJson = async <T>(path: string): Promise<T> => {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(\`Request failed (\${response.status})\`);
    }
    return response.json() as Promise<T>;
};
`;

const STYLES = `body { margin: 0; font-family: Inter, sans-serif; background: #f6f4ef; color: #1c1915; }
main { max-width: 880px; margin: 0 auto; padding: 24px; }
h1 { font-size: 22px; }
section { margin: 16px 0; padding: 12px 16px; background: #fff; border: 1px solid #e4ddd2; border-radius: 8px; }
ul { padding-left: 18px; }
.empty { color: #6b645c; }
`;

const panel = (name: string, path: string, field: string): string => `import { useEffect, useState } from 'react';
import { readJson } from '../../api';
import type { ${name} } from '../../types';

export function ${name}List({ items }: { items: readonly ${name}[] }) {
    if (!items.length) {
        return <p className='empty'>No ${name.toLowerCase()}s yet.</p>;
    }
    return <ul className='records'>{items.map(item => <li key={item.id}>{item.${field}}</li>)}</ul>;
}

export function ${name}Panel() {
    const [items, setItems] = useState<${name}[]>([]);
    useEffect(() => {
        readJson<${name}[]>('${path}').then(setItems).catch(() => undefined);
    }, []);
    return <section><h2>${name}s</h2><${name}List items={items} /></section>;
}
`;

const FEATURE_APP = `import { AuthorPanel } from './features/authors/Authors';
import { BookPanel } from './features/books/Books';
import { MemberPanel } from './features/members/Members';
import { LoanPanel } from './features/loans/Loans';

export function App() {
    return <main><h1>Library</h1><BookPanel /><AuthorPanel /><MemberPanel /><LoanPanel /></main>;
}
`;

const FEATURE_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookList } from './features/books/Books';

test('book list renders a title', () => {
    const html = renderToStaticMarkup(createElement(BookList, { items: [{ id: '1', title: 'Dune', authorId: '2' }] }));
    assert.match(html, /Dune/);
});
`;

const ATOM_LABEL = `export function Label({ text }: { text: string }) {
    return <span>{text}</span>;
}
`;

const ATOM_RECORD = `import { Label } from '../atoms/Label';

export function Record({ text }: { text: string }) {
    return <li><Label text={text} /></li>;
}
`;

const ATOM_CATALOG = `import { Record } from '../molecules/Record';

export function Catalog({ titles }: { titles: readonly string[] }) {
    if (!titles.length) {
        return <p className='empty'>No books yet.</p>;
    }
    return <ul className='records'>{titles.map(title => <Record key={title} text={title} />)}</ul>;
}
`;

const ATOM_PAGE = `import { useEffect, useState } from 'react';
import { readJson } from '../api';
import type { Author, Book, Loan, Member } from '../types';
import { Catalog } from '../organisms/Catalog';

export function LibraryPage() {
    const [books, setBooks] = useState<Book[]>([]);
    const [authors, setAuthors] = useState<Author[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [loans, setLoans] = useState<Loan[]>([]);
    useEffect(() => {
        readJson<Book[]>('/api/books').then(setBooks).catch(() => undefined);
        readJson<Author[]>('/api/authors').then(setAuthors).catch(() => undefined);
        readJson<Member[]>('/api/members').then(setMembers).catch(() => undefined);
        readJson<Loan[]>('/api/loans').then(setLoans).catch(() => undefined);
    }, []);
    return <main>
        <h1>Library</h1>
        <section><h2>Books</h2><Catalog titles={books.map(book => book.title)} /></section>
        <section><h2>Authors</h2><Catalog titles={authors.map(author => author.name)} /></section>
        <section><h2>Members</h2><Catalog titles={members.map(member => member.name)} /></section>
        <section><h2>Loans</h2><Catalog titles={loans.map(loan => loan.bookId)} /></section>
    </main>;
}
`;

const ATOM_APP = `import { LibraryPage } from './pages/LibraryPage';

export function App() {
    return <LibraryPage />;
}
`;

const ATOM_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Catalog } from './organisms/Catalog';

test('catalog renders a title', () => {
    const html = renderToStaticMarkup(createElement(Catalog, { titles: ['Dune'] }));
    assert.match(html, /Dune/);
});
`;

const MAIN = `import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (root) {
    createRoot(root).render(<App />);
}
`;

export const libraryClientFiles = (react: ReactStructure): LibraryFile[] => {
    const shared = [
        file('client/package.json', CLIENT_PACKAGE),
        file('client/tsconfig.test.json', CLIENT_TSCONFIG_TEST),
        file('client/vite.config.ts', VITE_CONFIG),
        file('client/index.html', INDEX_HTML),
        file('client/src/types.ts', TYPES),
        file('client/src/api.ts', API),
        file('client/src/styles.css', STYLES),
        file('client/src/css.d.ts', `declare module '*.css';\n`),
        file('client/src/main.tsx', MAIN)
    ];
    if (react === 'atomic') {
        return [
            ...shared,
            file('client/src/atoms/Label.tsx', ATOM_LABEL),
            file('client/src/molecules/Record.tsx', ATOM_RECORD),
            file('client/src/organisms/Catalog.tsx', ATOM_CATALOG),
            file('client/src/pages/LibraryPage.tsx', ATOM_PAGE),
            file('client/src/App.tsx', ATOM_APP),
            file('client/src/App.test.tsx', ATOM_TEST)
        ];
    }
    return [
        ...shared,
        file('client/src/features/books/Books.tsx', panel('Book', '/api/books', 'title')),
        file('client/src/features/authors/Authors.tsx', panel('Author', '/api/authors', 'name')),
        file('client/src/features/members/Members.tsx', panel('Member', '/api/members', 'name')),
        file('client/src/features/loans/Loans.tsx', panel('Loan', '/api/loans', 'bookId')),
        file('client/src/App.tsx', FEATURE_APP),
        file('client/src/App.test.tsx', FEATURE_TEST)
    ];
};

const ROOT_PACKAGE = `{
  "name": "library",
  "private": true,
  "workspaces": ["client", "server"],
  "scripts": {
    "build": "npm run build -w library-server && npm run build -w library-client",
    "test": "npm run test -w library-server && npm run test -w library-client",
    "start": "npm run start -w library-server"
  }
}
`;

const README = `# Library

React client and Node API for books, authors, members and loans.

\`\`\`bash
npm install
npm test
npm run build
npm start
\`\`\`

The client dev server proxies \`/api\` to port ${LIBRARY_SERVER_PORT}.
`;

const GITIGNORE = `node_modules
dist
dist-test
`;

export const librarySharedFiles = (): LibraryFile[] => [
    file('package.json', ROOT_PACKAGE),
    file('README.md', README),
    file('.gitignore', GITIGNORE)
];
