export declare function fileSystemAccessSupported(): boolean;
/**
 * Writes `payload` (JSON-serialized) to a user-chosen file. Must be called from a
 * user gesture (click/keydown). Returns false if unsupported or cancelled.
 */
export declare function exportToFile(payload: unknown, suggestedName?: string): Promise<boolean>;
/**
 * Prompts the user to pick a JSON file and returns its parsed contents (or null if
 * unsupported/cancelled/invalid). Must be called from a user gesture.
 */
export declare function importFromFile(): Promise<unknown | null>;
