import {
  type GraphEdge,
  type GraphNode,
  validateExecutableFlowGraph,
  validateFlowSemantics,
} from '@openclaw-wrapper/schemas';

export interface BuilderIssue {
  code: string;
  message: string;
  nodeId?: string;
  severity: 'warning' | 'error';
}

export function getBuilderIssues(nodes: GraphNode[], edges: GraphEdge[]): BuilderIssue[] {
  const executionIssues = validateExecutableFlowGraph(nodes, edges).map((issue) => ({
    code: 'execution-graph',
    message: issue.message,
    severity: 'error' as const,
  }));
  const semanticIssues = validateFlowSemantics(nodes, edges).map((issue) => ({
    code: issue.code,
    nodeId: issue.nodeId,
    severity: 'error' as const,
    message: issue.message,
  }));

  return [...executionIssues, ...semanticIssues];
}
