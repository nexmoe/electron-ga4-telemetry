/** Configuration snapshot. Events and callbacks must never be replayed after a crash. */
export declare class TagState {
    private defaults;
    private consent;
    private settings;
    private readonly configurations;
    private started;
    remember(args: unknown[]): void;
    replay(): unknown[][];
}
