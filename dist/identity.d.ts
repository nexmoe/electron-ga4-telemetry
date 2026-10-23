export declare function isClientId(value: unknown): value is string;
/** Main owns one identity per stream, collector partition and application identity key. */
export declare class IdentityStore {
    private readonly directory;
    private readonly scope;
    private readonly onError;
    private readonly identities;
    private readonly persisted;
    constructor(directory: string, scope: string, onError: () => void);
    get status(): 'unused' | 'persisted' | 'memory';
    private path;
    get(key: string): string | undefined;
    resolve(key: string, legacy?: unknown): string;
    set(key: string, clientId: string): string;
}
