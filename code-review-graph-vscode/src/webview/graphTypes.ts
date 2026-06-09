/**
 * Shared type definitions for the webview graph visualization.
 * Extracted to avoid circular dependencies between graphModel.ts and graph.ts.
 */

import * as d3 from "d3";

// ---------------------------------------------------------------------------
// Node & Edge kinds
// ---------------------------------------------------------------------------

export type NodeKind = "File" | "Class" | "Function" | "Test" | "Type";

export type EdgeKind =
  | "CALLS"
  | "IMPORTS_FROM"
  | "INHERITS"
  | "IMPLEMENTS"
  | "TESTED_BY"
  | "CONTAINS"
  | "DEPENDS_ON";

// ---------------------------------------------------------------------------
// Raw data types (received from extension host)
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: number;
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  filePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  language: string | null;
  parentName: string | null;
  params: string | null;
  returnType: string | null;
  modifiers: string | null;
  isTest: boolean;
  fileHash: string | null;
  degree?: number;
}

export interface GraphEdge {
  id: number;
  kind: EdgeKind;
  sourceQualified: string;
  targetQualified: string;
  filePath: string;
  line: number;
}

// ---------------------------------------------------------------------------
// D3 simulation types
// ---------------------------------------------------------------------------

/** D3 simulation node extends GraphNode with x/y/vx/vy. */
export interface SimNode extends d3.SimulationNodeDatum, GraphNode {}

/** D3 simulation link with resolved source/target. */
export interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  kind: EdgeKind;
  sourceQualified: string;
  targetQualified: string;
}
