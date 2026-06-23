import type { AseFile } from './types';
/**
 * Parses an Aseprite file from its raw bytes.
 *
 * @param buffer - The .aseprite file contents (e.g. from fetch().arrayBuffer()).
 * @returns The fully-resolved file model.
 */
export declare function parseAseprite(buffer: ArrayBuffer): Promise<AseFile>;
