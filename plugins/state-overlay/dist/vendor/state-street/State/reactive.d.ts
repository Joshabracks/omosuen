export declare const RAW: unique symbol;
export declare function reactive<T extends object>(target: T, onMutate: (rootKey: string) => void): T;
