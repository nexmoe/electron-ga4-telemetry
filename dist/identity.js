"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityStore = void 0;
exports.isClientId = isClientId;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function isClientId(value) {
    return typeof value === 'string' && /^\d+\.\d+$/.test(value);
}
/** Main owns one identity per stream, collector partition and application identity key. */
class IdentityStore {
    directory;
    scope;
    onError;
    identities = new Map();
    persisted = new Map();
    constructor(directory, scope, onError) {
        this.directory = directory;
        this.scope = scope;
        this.onError = onError;
    }
    get status() {
        if (!this.persisted.size)
            return 'unused';
        return [...this.persisted.values()].every(Boolean) ? 'persisted' : 'memory';
    }
    path(key) {
        const name = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify([this.scope, key])).digest('hex');
        return (0, node_path_1.join)(this.directory, `${name}.json`);
    }
    get(key) {
        const cached = this.identities.get(key);
        if (cached)
            return cached;
        try {
            const saved = JSON.parse((0, node_fs_1.readFileSync)(this.path(key), 'utf8'));
            if (!saved || typeof saved !== 'object' || !('clientId' in saved) || !isClientId(saved.clientId)) {
                throw new Error('Invalid anonymous identity');
            }
            this.identities.set(key, saved.clientId);
            this.persisted.set(key, true);
            return saved.clientId;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                this.onError();
            return undefined;
        }
    }
    resolve(key, legacy) {
        return this.get(key) ?? this.set(key, isClientId(legacy) ? legacy :
            `${(0, node_crypto_1.randomInt)(1, 0x100000000)}.${Math.floor(Date.now() / 1000)}`);
    }
    set(key, clientId) {
        if (!isClientId(clientId))
            throw new Error('Invalid anonymous identity');
        if (this.identities.get(key) === clientId && this.persisted.get(key))
            return clientId;
        this.identities.set(key, clientId);
        let temporary;
        let descriptor;
        try {
            (0, node_fs_1.mkdirSync)(this.directory, { recursive: true, mode: 0o700 });
            const path = this.path(key);
            temporary = `${path}.${(0, node_crypto_1.randomUUID)()}.tmp`;
            descriptor = (0, node_fs_1.openSync)(temporary, 'wx', 0o600);
            (0, node_fs_1.writeFileSync)(descriptor, JSON.stringify({ clientId }), 'utf8');
            (0, node_fs_1.fsyncSync)(descriptor);
            (0, node_fs_1.closeSync)(descriptor);
            descriptor = undefined;
            (0, node_fs_1.renameSync)(temporary, path);
            this.persisted.set(key, true);
        }
        catch {
            this.persisted.set(key, false);
            this.onError();
        }
        finally {
            if (descriptor !== undefined) {
                try {
                    (0, node_fs_1.closeSync)(descriptor);
                }
                catch { /* Best effort. */ }
            }
            if (temporary) {
                try {
                    (0, node_fs_1.unlinkSync)(temporary);
                }
                catch { /* Renamed or not created. */ }
            }
        }
        return clientId;
    }
}
exports.IdentityStore = IdentityStore;
