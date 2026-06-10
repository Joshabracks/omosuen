import type { AtlasSpace } from './types';

/**
 * Configuration for a SpaceTree — one per packer free-space bucket. The tree is a
 * balanced ordered set of AtlasSpaces; `cmp` is its total order (the bucket's size
 * comparator + a unique uid tiebreak). `primary`/`primaryMin` and
 * `secondary`/`secondaryMin` decompose the 2D fit predicate into the leading sort
 * dimension plus one residual dimension, so `findBestFit` is an O(log n) guided
 * descent (pruned by a subtree max of `secondary`) rather than a linear scan.
 *
 * The decomposition is exact per bucket: width-keyed → residual is height;
 * height-keyed → residual is width; size-keyed (only square frames land here, so
 * needX === needY === n and "x≥n && y≥n" ⇔ "min(x,y)≥n") → residual is min(x,y).
 */
export interface SpaceTreeConfig {
  /** Strict total order over spaces (bucket comparator, uid-tiebroken → unique). */
  cmp: (a: AtlasSpace, b: AtlasSpace) => number;
  /** Leading sort dimension of a space (width, height, or width+height). */
  primary: (s: AtlasSpace) => number;
  /** Minimum `primary` a space needs to possibly fit a (needX × needY) frame. */
  primaryMin: (needX: number, needY: number) => number;
  /** Residual fit dimension of a space (the one not implied by `primary`). */
  secondary: (s: AtlasSpace) => number;
  /** Minimum `secondary` a space needs to fit a (needX × needY) frame. */
  secondaryMin: (needX: number, needY: number) => number;
}

interface Node {
  space: AtlasSpace;
  left: Node | null;
  right: Node | null;
  parent: Node | null;
  height: number;
  /** Max `secondary(space)` over this subtree — prunes the best-fit descent. */
  maxSec: number;
}

/**
 * A self-balancing (AVL) ordered set of atlas free-spaces, replacing the packer's
 * sorted arrays. Insert / remove are O(log n) (vs the arrays' O(n) splice), and
 * `findBestFit` is an O(log n) guided descent (subtree-max augmentation) — turning
 * the packer from O(N²) to O(N log N).
 *
 * The order reproduces the previous "sorted array + stable insert" behaviour
 * exactly (same comparator, uid tiebreak = insertion order), and `findBestFit`
 * returns the minimum-key space that fits both dimensions — provably the same
 * space the old exact-fit-then-first-fit scan picked. So packing is byte-identical.
 */
export class SpaceTree {
  private root: Node | null = null;
  private readonly cmp: SpaceTreeConfig['cmp'];
  private readonly primary: SpaceTreeConfig['primary'];
  private readonly primaryMin: SpaceTreeConfig['primaryMin'];
  private readonly secondary: SpaceTreeConfig['secondary'];
  private readonly secondaryMin: SpaceTreeConfig['secondaryMin'];

  constructor(config: SpaceTreeConfig) {
    this.cmp = config.cmp;
    this.primary = config.primary;
    this.primaryMin = config.primaryMin;
    this.secondary = config.secondary;
    this.secondaryMin = config.secondaryMin;
  }

  insert(space: AtlasSpace): void {
    const node: Node = {
      space,
      left: null,
      right: null,
      parent: null,
      height: 1,
      maxSec: this.secondary(space),
    };
    if (!this.root) {
      this.root = node;
      return;
    }
    let cur: Node = this.root;
    for (;;) {
      // cmp is never 0 for distinct spaces (uid is unique).
      if (this.cmp(space, cur.space) < 0) {
        if (cur.left) {
          cur = cur.left;
        } else {
          cur.left = node;
          node.parent = cur;
          break;
        }
      } else {
        if (cur.right) {
          cur = cur.right;
        } else {
          cur.right = node;
          node.parent = cur;
          break;
        }
      }
    }
    this.rebalanceUp(node.parent);
  }

  remove(space: AtlasSpace): void {
    const node = this.findNode(space);
    if (node) this.deleteNode(node);
  }

  /**
   * Returns the minimum-key space that fits a (needX × needY) frame, or null.
   * Guided descent: the leftmost (in-order) node with primary ≥ primaryMin and
   * secondary ≥ secondaryMin, which equals the first space fitting both dims.
   */
  findBestFit(needX: number, needY: number): AtlasSpace | null {
    const pmin = this.primaryMin(needX, needY);
    const smin = this.secondaryMin(needX, needY);
    const node = this.query(this.root, pmin, smin);
    return node ? node.space : null;
  }

  // Leftmost in-order node in `node`'s subtree with primary ≥ pmin and
  // secondary ≥ smin. {primary ≥ pmin} is an in-order suffix (primary is the lead
  // key), so this finds the first fitting space in packing order. The subtree-max
  // (maxSec) prune skips whole subtrees that can't satisfy `secondary ≥ smin`.
  private query(node: Node | null, pmin: number, smin: number): Node | null {
    if (!node || node.maxSec < smin) return null;
    if (this.primary(node.space) < pmin) {
      // This node and its entire left subtree have smaller key and primary < pmin
      // → only the right subtree can qualify.
      return this.query(node.right, pmin, smin);
    }
    // node.primary ≥ pmin: prefer a smaller-key match in the left subtree.
    const left = this.query(node.left, pmin, smin);
    if (left) return left;
    if (this.secondary(node.space) >= smin) return node;
    return this.query(node.right, pmin, smin);
  }

  private findNode(space: AtlasSpace): Node | null {
    let cur = this.root;
    while (cur) {
      const c = this.cmp(space, cur.space);
      if (c === 0) return cur; // unique uid → identity match
      cur = c < 0 ? cur.left : cur.right;
    }
    return null;
  }

  private deleteNode(node: Node): void {
    let target = node;
    if (target.left && target.right) {
      // Two children: copy the in-order successor's space up, then physically
      // remove the successor (which has at most a right child).
      let succ = target.right;
      while (succ.left) succ = succ.left;
      target.space = succ.space;
      target = succ;
    }
    const child = target.left ?? target.right;
    const parent = target.parent;
    if (child) child.parent = parent;
    if (!parent) {
      this.root = child;
    } else if (parent.left === target) {
      parent.left = child;
    } else {
      parent.right = child;
    }
    this.rebalanceUp(parent);
  }

  private rebalanceUp(start: Node | null): void {
    let n = start;
    while (n) {
      this.update(n);
      const bf = this.balanceFactor(n);
      let sub = n;
      if (bf > 1) {
        if (this.balanceFactor(n.left!) < 0) this.rotateLeft(n.left!);
        sub = this.rotateRight(n);
      } else if (bf < -1) {
        if (this.balanceFactor(n.right!) > 0) this.rotateRight(n.right!);
        sub = this.rotateLeft(n);
      }
      n = sub.parent;
    }
  }

  private rotateLeft(x: Node): Node {
    const y = x.right!;
    x.right = y.left;
    if (y.left) y.left.parent = x;
    y.parent = x.parent;
    if (!x.parent) this.root = y;
    else if (x.parent.left === x) x.parent.left = y;
    else x.parent.right = y;
    y.left = x;
    x.parent = y;
    this.update(x);
    this.update(y);
    return y;
  }

  private rotateRight(y: Node): Node {
    const x = y.left!;
    y.left = x.right;
    if (x.right) x.right.parent = y;
    x.parent = y.parent;
    if (!y.parent) this.root = x;
    else if (y.parent.left === y) y.parent.left = x;
    else y.parent.right = x;
    x.right = y;
    y.parent = x;
    this.update(y);
    this.update(x);
    return x;
  }

  // Refresh cached height + subtree-max-secondary from children (call child-first).
  private update(n: Node): void {
    const lh = n.left ? n.left.height : 0;
    const rh = n.right ? n.right.height : 0;
    n.height = 1 + (lh > rh ? lh : rh);
    let m = this.secondary(n.space);
    if (n.left && n.left.maxSec > m) m = n.left.maxSec;
    if (n.right && n.right.maxSec > m) m = n.right.maxSec;
    n.maxSec = m;
  }

  private balanceFactor(n: Node): number {
    const lh = n.left ? n.left.height : 0;
    const rh = n.right ? n.right.height : 0;
    return lh - rh;
  }
}
