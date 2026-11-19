import { Vector3D } from '../../../math';
import type { CellMapT } from '../../cell-map/data';
import type { ColliderOBB } from '../../collider/methods';
import type { ProjectionParams } from './projection-math';
export interface Span {
    tEnter: number;
    tExit: number;
}
export declare function rayAABB(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number, out: Span): boolean;
export declare function rayOBB(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, obb: ColliderOBB): number;
export declare function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number;
export interface CellMarch {
    x: number[];
    y: number[];
    z: number[];
    t: number[];
    count: number;
}
export declare function makeCellMarch(): CellMarch;
export interface CellRange {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}
declare const windowBounds: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
};
export declare function cellWindowRange(cellMap: CellMapT, out: CellRange): typeof windowBounds;
export declare function marchCells(origin: Vector3D, dir: Vector3D, cellMap: CellMapT, out: CellMarch, stopAtFirst: boolean): void;
export interface Prism {
    nx: number[];
    ny: number[];
    nz: number[];
    d: number[];
    count: number;
}
export declare function makePrism(): Prism;
export declare function buildPrism(p: ProjectionParams, pointsXY: number[], pointCount: number, refHeight: number, lineThickness: number, out: Prism): boolean;
export declare function pointInPrism(prism: Prism, x: number, y: number, z: number): boolean;
export declare function pointInConvex(poly: number[], n: number, px: number, py: number): boolean;
export declare function segVsConvex(ax: number, ay: number, bx: number, by: number, poly: number[], n: number): boolean;
export declare function convexVsConvex(a: number[], na: number, b: number[], nb: number): boolean;
export {};
//# sourceMappingURL=intersect.d.ts.map