/**
 * Centralized graph data model inspired by Neo4j Browser's GraphModel.
 *
 * Manages nodes, edges, and expand/collapse state in a single class
 * with O(1) lookups via Maps and built-in dedup on add operations.
 *
 * This separates data management from D3 rendering logic.
 */

import type { SimNode, SimLink } from "./graphTypes";

// ---------------------------------------------------------------------------
// Edge key helper — composite key for dedup (we lack unique edge IDs)
// ---------------------------------------------------------------------------

function edgeKey(e: { sourceQualified: string; targetQualified: string; kind: string }): string {
  return `${e.sourceQualified}\0${e.targetQualified}\0${e.kind}`;
}

// ---------------------------------------------------------------------------
// GraphModel
// ---------------------------------------------------------------------------

export class GraphModel {
  // Core storage — O(1) lookups via Maps
  private _nodeMap: Map<string, SimNode> = new Map();
  private _edgeMap: Map<string, SimLink> = new Map();

  // Expand/collapse tracking (Neo4j pattern: expandedNodeMap)
  // Maps a parent node QN to the set of child QNs that were dynamically added
  private _expandedNodeMap: Map<string, Set<string>> = new Map();

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** All nodes as an array (for D3 consumption). */
  getNodes(): SimNode[] {
    return Array.from(this._nodeMap.values());
  }

  /** All edges as an array (for D3 consumption). */
  getEdges(): SimLink[] {
    return Array.from(this._edgeMap.values());
  }

  /** Number of nodes in the model. */
  get nodeCount(): number {
    return this._nodeMap.size;
  }

  /** Number of edges in the model. */
  get edgeCount(): number {
    return this._edgeMap.size;
  }

  /** All node qualified names as a set (for IPC messages). */
  getAllNodeQns(): Set<string> {
    return new Set(this._nodeMap.keys());
  }

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------

  /** Find a node by qualified name. O(1). */
  findNode(qn: string): SimNode | undefined {
    return this._nodeMap.get(qn);
  }

  /** Check if a node exists. O(1). */
  hasNode(qn: string): boolean {
    return this._nodeMap.has(qn);
  }

  /** Check if a node has been expanded (its children loaded). */
  isExpanded(qn: string): boolean {
    return this._expandedNodeMap.has(qn);
  }

  /**
   * Find all neighbor QNs connected to a node via edges.
   * Analogous to Neo4j's `findNodeNeighbourIds`.
   */
  findNeighborIds(qn: string): string[] {
    const neighbors: string[] = [];
    for (const edge of this._edgeMap.values()) {
      if (edge.sourceQualified === qn) {
        neighbors.push(edge.targetQualified);
      } else if (edge.targetQualified === qn) {
        neighbors.push(edge.sourceQualified);
      }
    }
    return neighbors;
  }

  // ---------------------------------------------------------------------------
  // Mutations — Add (with built-in dedup)
  // ---------------------------------------------------------------------------

  /**
   * Add nodes to the model. Skips nodes that already exist (dedup by qualifiedName).
   * Returns only the newly added nodes.
   * Analogous to Neo4j's `addNodes`.
   */
  addNodes(nodes: SimNode[]): SimNode[] {
    const added: SimNode[] = [];
    for (const node of nodes) {
      if (!this._nodeMap.has(node.qualifiedName)) {
        this._nodeMap.set(node.qualifiedName, node);
        added.push(node);
      }
    }
    return added;
  }

  /**
   * Add edges to the model. Skips edges that already exist (dedup by composite key).
   * Also skips edges whose endpoints don't exist in the model.
   * Returns only the newly added edges.
   * Analogous to Neo4j's `addRelationships`.
   */
  addEdges(edges: SimLink[]): SimLink[] {
    const added: SimLink[] = [];
    for (const edge of edges) {
      const key = edgeKey(edge);
      if (!this._edgeMap.has(key)) {
        // Validate both endpoints exist
        const src = this._nodeMap.get(edge.sourceQualified);
        const tgt = this._nodeMap.get(edge.targetQualified);
        if (src && tgt) {
          // Resolve D3 source/target references to actual node objects
          edge.source = src;
          edge.target = tgt;
          this._edgeMap.set(key, edge);
          added.push(edge);
        }
      }
    }
    return added;
  }

  // ---------------------------------------------------------------------------
  // Mutations — Expand / Collapse (Neo4j pattern)
  // ---------------------------------------------------------------------------

  /**
   * Expand a node: add child nodes and edges, and record the parent→children mapping.
   * Analogous to Neo4j's `addExpandedNodes`.
   *
   * @param parentQn  - The parent node's qualified name
   * @param children  - New child nodes to add
   * @param edges     - New edges to add
   * @returns The newly added nodes (deduped)
   */
  expandNode(parentQn: string, children: SimNode[], edges: SimLink[]): SimNode[] {
    // Position new nodes near parent for smooth animation
    const parent = this._nodeMap.get(parentQn);
    if (parent && parent.x != null && parent.y != null) {
      for (const child of children) {
        if (child.x == null) {
          child.x = parent.x + (Math.random() - 0.5) * 30;
          child.y = (parent.y ?? 0) + (Math.random() - 0.5) * 30;
        }
      }
    }

    const addedNodes = this.addNodes(children);
    this.addEdges(edges);

    // Track which children were loaded by this parent
    if (!this._expandedNodeMap.has(parentQn)) {
      this._expandedNodeMap.set(parentQn, new Set());
    }
    const childrenSet = this._expandedNodeMap.get(parentQn)!;
    for (const node of addedNodes) {
      childrenSet.add(node.qualifiedName);
    }

    return addedNodes;
  }

  /**
   * Collapse a node: recursively remove its dynamically loaded children
   * and all connected edges.
   * Analogous to Neo4j's `collapseNode`.
   *
   * @returns Set of removed node QNs
   */
  collapseNode(parentQn: string): Set<string> {
    const toRemove = new Set<string>();
    this._collectDescendants(parentQn, toRemove);

    if (toRemove.size === 0 && !this._expandedNodeMap.has(parentQn)) {
      return toRemove;
    }

    // Remove expanded state
    this._expandedNodeMap.delete(parentQn);

    // Remove nodes
    for (const qn of toRemove) {
      this._nodeMap.delete(qn);
    }

    // Collect edge keys to remove first to avoid mutating Map during iteration
    const edgeKeysToRemove: string[] = [];
    for (const [key, edge] of this._edgeMap) {
      if (toRemove.has(edge.sourceQualified) || toRemove.has(edge.targetQualified)) {
        edgeKeysToRemove.push(key);
      }
    }
    for (const key of edgeKeysToRemove) {
      this._edgeMap.delete(key);
    }

    return toRemove;
  }

  /** Recursively collect all descendant node QNs for collapse. */
  private _collectDescendants(parentQn: string, result: Set<string>): void {
    const children = this._expandedNodeMap.get(parentQn);
    if (!children) return;
    for (const childQn of children) {
      result.add(childQn);
      // Recurse into expanded children
      if (this._expandedNodeMap.has(childQn)) {
        this._collectDescendants(childQn, result);
        this._expandedNodeMap.delete(childQn);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mutations — Remove single node (for "dismiss" interaction)
  // ---------------------------------------------------------------------------

  /**
   * Remove a single node and all its connected edges.
   * Analogous to Neo4j's `removeNode` + `removeConnectedRelationships`.
   */
  removeNode(qn: string): void {
    if (!this._nodeMap.has(qn)) return;
    this._nodeMap.delete(qn);
    this._expandedNodeMap.delete(qn);

    // Remove from any parent's expanded children
    for (const [, children] of this._expandedNodeMap) {
      children.delete(qn);
    }

    // Collect edge keys to remove first to avoid mutating Map during iteration
    const edgeKeysToRemove: string[] = [];
    for (const [key, edge] of this._edgeMap) {
      if (edge.sourceQualified === qn || edge.targetQualified === qn) {
        edgeKeysToRemove.push(key);
      }
    }
    for (const key of edgeKeysToRemove) {
      this._edgeMap.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  /** Clear all data — for fresh graph loads. */
  reset(): void {
    this._nodeMap.clear();
    this._edgeMap.clear();
    this._expandedNodeMap.clear();
  }
}
