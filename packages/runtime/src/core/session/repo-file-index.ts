// src/core/session/repo-file-index.ts
// Lightweight, dependency-free repo file index.
//
// Scans a directory once, caches the result, and answers "which files are
// most relevant to this query?". Scoring is keyword overlap on path tokens
// plus a small boost for source files. Embeddings can replace this later
// without touching the call site.
//
// Design notes:
//  - Skips heavyweight dirs (node_modules, .git, dist, coverage, logs,
//    .phus, *.sqlite) to keep the scan cheap and the results useful.
//  - No external dep on a language server; we only need path-level signal
//    to drive context assembly. Per-file symbol indexing belongs to a
//    separate module when we add it.

import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_IGNORED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "coverage",
    "logs",
    ".phus",
    ".vscode",
    "out",
    "tmp",
    "build",
    "target",
]);

const DEFAULT_IGNORED_EXT = new Set([
    ".sqlite",
    ".sqlite-journal",
    ".log",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".pdf",
    ".zip",
    ".tar",
    ".gz",
    ".tgz",
    ".lock",
]);

const SOURCE_EXT = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".rs",
    ".go",
    ".java",
    ".kt",
    ".rb",
    ".sh",
    ".md",
    ".mdx",
    ".yaml",
    ".yml",
    ".json",
    ".toml",
    ".html",
    ".css",
    ".scss",
    ".sql",
]);

export interface IndexedFile {
    /** Absolute path on disk. */
    absPath: string;
    /** Path relative to the index root, using forward slashes. */
    relPath: string;
    /** File size in bytes. */
    size: number;
    /** Lowercased extension including the dot, or "" when none. */
    ext: string;
    /** Path tokens (split on /, ., -, _, camelCase boundaries). */
    tokens: Set<string>;
    /** True when ext is in SOURCE_EXT. */
    isSource: boolean;
}

export interface ScoredFile {
    file: IndexedFile;
    score: number;
    matchedTokens: string[];
}

export interface RepoFileIndexOptions {
    /** Directories to ignore in addition to the default set. */
    ignoreDirs?: Set<string>;
    /** Extensions to ignore in addition to the default set. */
    ignoreExt?: Set<string>;
    /** Maximum file size to index (bytes). Default 1 MiB. */
    maxFileSize?: number;
}

export class RepoFileIndex {
    private readonly root: string;
    private readonly ignoreDirs: Set<string>;
    private readonly ignoreExt: Set<string>;
    private readonly maxFileSize: number;
    private files: IndexedFile[] = [];
    private scanned = false;

    constructor(root: string, options: RepoFileIndexOptions = {}) {
        this.root = path.resolve(root);
        this.ignoreDirs = new Set([...DEFAULT_IGNORED_DIRS, ...(options.ignoreDirs ?? [])]);
        this.ignoreExt = new Set([...DEFAULT_IGNORED_EXT, ...(options.ignoreExt ?? [])]);
        this.maxFileSize = options.maxFileSize ?? 1024 * 1024;
    }

    /** Force a rescan. Called automatically on the first search(). */
    scan(): IndexedFile[] {
        this.files = [];
        this.walk(this.root, []);
        this.scanned = true;
        return this.files.slice();
    }

    /** All indexed files (scans first if needed). */
    all(): IndexedFile[] {
        if (!this.scanned) this.scan();
        return this.files.slice();
    }

    /**
     * Score files against a free-text query and return the top N matches.
     * Empty query returns the most recently modified source files first
     * (deterministic: by relPath sort, so callers can rely on it).
     */
    search(query: string, limit = 20): ScoredFile[] {
        if (!this.scanned) this.scan();

        const tokens = tokenize(query);
        if (tokens.size === 0) {
            // No query — surface source files deterministically.
            return this.files
                .filter((f) => f.isSource)
                .slice(0, limit)
                .map((file) => ({ file, score: 0, matchedTokens: [] }));
        }

        const scored: ScoredFile[] = [];
        for (const file of this.files) {
            const matched: string[] = [];
            let score = 0;
            for (const t of tokens) {
                if (file.tokens.has(t)) {
                    matched.push(t);
                    // Path-token hits are weighted higher than filename hits,
                    // so files literally in the path win over incidental mentions.
                    score += t.length >= 4 ? 2 : 1;
                } else if (file.relPath.toLowerCase().includes(t)) {
                    matched.push(t);
                    score += 0.5;
                }
            }
            if (score > 0) {
                if (file.isSource) score *= 1.2;
                scored.push({ file, score, matchedTokens: matched });
            }
        }

        scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.file.relPath.localeCompare(b.file.relPath);
        });
        return scored.slice(0, limit);
    }

    private walk(dir: string, segments: string[]): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
            if (entry.isDirectory()) {
                if (this.ignoreDirs.has(entry.name)) continue;
                this.walk(path.join(dir, entry.name), [...segments, entry.name]);
                continue;
            }
            if (!entry.isFile()) continue;

            const ext = path.extname(entry.name).toLowerCase();
            if (this.ignoreExt.has(ext)) continue;

            const abs = path.join(dir, entry.name);
            let stat: fs.Stats;
            try {
                stat = fs.statSync(abs);
            } catch {
                continue;
            }
            if (stat.size > this.maxFileSize) continue;

            const relSegments = [...segments, entry.name];
            const relPath = relSegments.join("/");

            this.files.push({
                absPath: abs,
                relPath,
                size: stat.size,
                ext,
                tokens: tokenizePath(relPath),
                isSource: SOURCE_EXT.has(ext),
            });
        }
    }
}

const CAMEL_BOUNDARY = /([a-z\d])([A-Z])/g;

function tokenizePath(p: string): Set<string> {
    const replaced = p.replace(CAMEL_BOUNDARY, "$1 $2");
    return new Set(
        replaced
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s./_-]/gu, " ")
            .split(/[\s./_-]+/)
            .filter((t) => t.length > 1),
    );
}

function tokenize(s: string): Set<string> {
    if (!s) return new Set();
    return new Set(
        s
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
            .filter((t) => t.length > 1),
    );
}
