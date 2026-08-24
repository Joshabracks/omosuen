import State from "./State.js";
export declare function setAttr(element: any, name: string, value: string): void;
export declare function childNamespaceOf(parent: any): string | undefined;
export declare function decodeEntities(str: string): string;
export declare function getValue(obj: any, values: string[]): any;
export declare function unescapeQuotes(str: string): string;
export declare function runComponent(data: any, state: State): {
    componentBody: string;
    deps: Set<string>;
} | null;
export declare function parseComponentBody(componentBody: string, state: State): any;
declare function constructElement(data: any, parentSSID: string, state: State, ns?: string): any;
export default constructElement;
