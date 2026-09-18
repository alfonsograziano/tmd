/** The reference graph, as dot or json. */

import type { FileAnalysis } from "./lint.ts";

export interface GraphNode {
  id: string;
  type: string;
  path: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  field: string;
  /** False when the target does not exist. */
  resolved: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildGraph(analyses: FileAnalysis[]): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const analysis of analyses) {
    const file = analysis.file;
    if (file.id === null || file.type === null || analysis.schema === null) continue;
    nodes.push({ id: file.id, type: file.type, path: file.rel });
    for (const ref of analysis.refs) {
      edges.push({
        from: file.id,
        to: ref.targetId ?? ref.raw,
        field: ref.field,
        resolved: ref.targetId !== null,
      });
    }
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : 1));
  edges.sort((a, b) => (a.from === b.from ? (a.field < b.field ? -1 : 1) : a.from < b.from ? -1 : 1));
  return { nodes, edges };
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function toDot(graph: Graph): string {
  const lines = ["digraph tmd {", "  rankdir=LR;", '  node [shape=box, fontname="Helvetica"];'];
  const types = [...new Set(graph.nodes.map((node) => node.type))].sort();
  for (const type of types) {
    lines.push(`  subgraph "cluster_${type}" {`, `    label=${quote(type)};`);
    for (const node of graph.nodes.filter((candidate) => candidate.type === type)) {
      lines.push(`    ${quote(node.id)};`);
    }
    lines.push("  }");
  }
  for (const edge of graph.edges) {
    const style = edge.resolved ? "" : ", style=dashed, color=red";
    lines.push(`  ${quote(edge.from)} -> ${quote(edge.to)} [label=${quote(edge.field)}${style}];`);
  }
  lines.push("}", "");
  return lines.join("\n");
}
