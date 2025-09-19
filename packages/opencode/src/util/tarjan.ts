/**
 * Tarjan's algorithm for detecting strongly connected components (SCCs) in a directed graph.
 * This can be used to detect cycles in call graphs.
 */

export interface SCCResult {
  /** Strongly connected components that form cycles (size > 1) */
  cycles: string[][];
  /** All strongly connected components */
  sccs: string[][];
}

/**
 * Detect cycles in a directed graph using Tarjan's algorithm.
 * @param graph Adjacency list representation of the graph
 * @returns Object containing cycles and all SCCs
 */
export function detectCyclesWithTarjan(graph: Record<string, string[]>): SCCResult {
  const indexMap: Record<string, number> = {};
  const lowLinkMap: Record<string, number> = {};
  const onStack: Record<string, boolean> = {};
  const stack: string[] = [];
  const sccs: string[][] = [];
  let index = 0;

  // Initialize all nodes
  const allNodes = new Set<string>();
  for (const [node, neighbors] of Object.entries(graph)) {
    allNodes.add(node);
    for (const neighbor of neighbors) {
      allNodes.add(neighbor);
    }
  }

  // Visit all unvisited nodes
  for (const node of allNodes) {
    if (indexMap[node] === undefined) {
      strongConnect(node);
    }
  }

  // Filter out cycles (SCCs with more than one node)
  const cycles = sccs.filter(scc => scc.length > 1);

  return { cycles, sccs };

  /**
   * Recursive function to find strongly connected components
   * @param node Current node being visited
   */
  function strongConnect(node: string) {
    // Set the depth index for node to the smallest unused index
    indexMap[node] = index;
    lowLinkMap[node] = index;
    index++;
    stack.push(node);
    onStack[node] = true;

    // Consider successors of node
    const successors = graph[node] || [];
    for (const successor of successors) {
      if (indexMap[successor] === undefined) {
        // Successor has not yet been visited; recurse on it
        strongConnect(successor);
        lowLinkMap[node] = Math.min(lowLinkMap[node], lowLinkMap[successor]);
      } else if (onStack[successor]) {
        // Successor is in stack and hence in the current SCC
        lowLinkMap[node] = Math.min(lowLinkMap[node], indexMap[successor]);
      }
    }

    // If node is a root node, pop the stack and create an SCC
    if (lowLinkMap[node] === indexMap[node]) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        scc.push(w);
      } while (w !== node);
      sccs.push(scc);
    }
  }
}