import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Puts tracked files under `target` (a file or folder) back to their committed content without `git checkout`, which
 * needs the index lock and fails while an IDE with this repository open is refreshing its git status.
 */
export const restoreFromHead = (target: string): void => {
    const cwd = fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() ? target : path.dirname(target);
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
    const files = execFileSync('git', ['ls-files', '--full-name', '--', target], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const file of files) {
        const content = execFileSync('git', ['show', `HEAD:${file}`], { cwd: top });
        const full = path.join(top, file);
        if (!fs.existsSync(full) || !fs.readFileSync(full).equals(content)) {
            fs.writeFileSync(full, content);
        }
    }
};
