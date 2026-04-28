export interface CanvasRecipeNodeTemplate {
  id: string;
  nodeType: string;
  label: string;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface CanvasRecipeEdgeTemplate {
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface CanvasRecipeDefinition {
  id: string;
  title: string;
  description: string;
  steps: string[];
  nodes: CanvasRecipeNodeTemplate[];
  edges: CanvasRecipeEdgeTemplate[];
}

export const CANVAS_RECIPES: CanvasRecipeDefinition[] = [
  {
    id: 'youtube-url-article',
    title: 'YouTube URL -> Article',
    description:
      'Accept a YouTube video URL, fetch the transcript, and hand the full source to an agent for article drafting.',
    steps: ['Webhook', 'YouTube Transcript', 'Run Agent', 'Approval'],
    nodes: [
      {
        id: 'trigger',
        nodeType: 'trigger.webhook',
        label: 'YouTube video URL',
        position: { x: 0, y: 40 },
        data: {
          eventName: 'youtube.video.article',
          notes: 'Send {"url":"https://www.youtube.com/watch?v=..."} or {"videoId":"..."}',
        },
      },
      {
        id: 'transcript',
        nodeType: 'tool.transcriptapi',
        label: 'Get transcript',
        position: { x: 240, y: 40 },
        data: {
          video: '{{url}}',
          videoPath: 'url',
          includeSegments: false,
          outputMode: 'merge',
        },
      },
      {
        id: 'agent',
        nodeType: 'action.agent',
        label: 'Draft article',
        position: { x: 500, y: 40 },
        data: {
          instructions:
            'Write a production-ready article from the YouTube transcript. Return a title, slug, summary, bodyMarkdown, tags, and sourceVideoUrl. Preserve the source meaning and do not invent claims beyond the transcript.',
          inputTemplate:
            'Source video URL: {{youtubeTranscript.videoUrl}}\nVideo ID: {{youtubeTranscript.videoId}}\n\nTranscript:\n{{youtubeTranscript.transcript}}',
          waitTimeoutMs: '180000',
        },
      },
      {
        id: 'approval',
        nodeType: 'control.approval',
        label: 'Review draft',
        position: { x: 760, y: 40 },
        data: {
          reason: 'Review the generated YouTube article draft before publishing.',
          timeoutSeconds: '86400',
        },
      },
    ],
    edges: [
      { source: 'trigger', sourcePort: 'out', target: 'transcript', targetPort: 'in' },
      { source: 'transcript', sourcePort: 'out', target: 'agent', targetPort: 'in' },
      { source: 'agent', sourcePort: 'out', target: 'approval', targetPort: 'in' },
    ],
  },
  {
    id: 'search-browser-brief',
    title: 'Search -> Browser -> Brief',
    description: 'Find a strong result, open it, shape a compact payload, and hand it to an agent.',
    steps: ['Webhook', 'Web Search', 'Browser Lite', 'Shape Payload', 'Run Agent'],
    nodes: [
      {
        id: 'trigger',
        nodeType: 'trigger.webhook',
        label: 'Inbound topic',
        position: { x: 0, y: 40 },
        data: {
          eventName: '',
          notes: 'Send a topic or question in the webhook payload.',
        },
      },
      {
        id: 'search',
        nodeType: 'tool.web-search',
        label: 'Find top result',
        position: { x: 220, y: 40 },
        data: {
          provider: 'duckduckgo',
          query: '{{topic}}',
          limit: '5',
          outputMode: 'top-result-url',
        },
      },
      {
        id: 'browser',
        nodeType: 'tool.browser',
        label: 'Open result page',
        position: { x: 440, y: 40 },
        data: {
          action: 'extract',
          target: '{{input}}',
          extractMode: 'metadata',
          timeoutMs: '30000',
        },
      },
      {
        id: 'shape',
        nodeType: 'tool.payload-template',
        label: 'Build brief payload',
        position: { x: 660, y: 40 },
        data: {
          outputMode: 'replace',
          template:
            '{"sourceUrl":"{{finalUrl}}","pageTitle":"{{title}}","pageDescription":"{{description}}","ogTitle":"{{extracted.ogTitle}}","ogDescription":"{{extracted.ogDescription}}"}',
        },
      },
      {
        id: 'agent',
        nodeType: 'action.agent',
        label: 'Summarize and route',
        position: { x: 880, y: 40 },
        data: {
          instructions:
            'Summarize the page briefly and return a structured routing recommendation.',
          waitTimeoutMs: '30000',
        },
      },
    ],
    edges: [
      { source: 'trigger', sourcePort: 'out', target: 'search', targetPort: 'in' },
      { source: 'search', sourcePort: 'out', target: 'browser', targetPort: 'in' },
      { source: 'browser', sourcePort: 'out', target: 'shape', targetPort: 'in' },
      { source: 'shape', sourcePort: 'out', target: 'agent', targetPort: 'in' },
    ],
  },
  {
    id: 'search-browser-channel-reply',
    title: 'Search -> Browser -> Reply',
    description:
      'Look up a page, trim the output, and reply back on the originating channel with a safer template.',
    steps: ['Channel Trigger', 'Web Search', 'Browser Lite', 'Shape Payload', 'Channel Reply'],
    nodes: [
      {
        id: 'trigger',
        nodeType: 'trigger.channel',
        label: 'Inbound channel message',
        position: { x: 0, y: 40 },
        data: {
          channelType: '',
          routeKey: '',
          messagePattern: '',
        },
      },
      {
        id: 'search',
        nodeType: 'tool.web-search',
        label: 'Search answer source',
        position: { x: 220, y: 40 },
        data: {
          provider: 'duckduckgo',
          query: '{{message}}',
          limit: '5',
          outputMode: 'top-result-url',
        },
      },
      {
        id: 'browser',
        nodeType: 'tool.browser',
        label: 'Open top source',
        position: { x: 440, y: 40 },
        data: {
          action: 'extract',
          target: '{{input}}',
          extractMode: 'meta:description',
          timeoutMs: '30000',
        },
      },
      {
        id: 'shape',
        nodeType: 'tool.payload-template',
        label: 'Prepare reply text',
        position: { x: 660, y: 40 },
        data: {
          outputMode: 'assign',
          outputPath: 'replyText',
          template: '{{extracted}}',
        },
      },
      {
        id: 'reply',
        nodeType: 'action.channel-reply',
        label: 'Reply with source summary',
        position: { x: 880, y: 40 },
        data: {
          messageTemplate: '{{replyText}}',
        },
      },
    ],
    edges: [
      { source: 'trigger', sourcePort: 'out', target: 'search', targetPort: 'in' },
      { source: 'search', sourcePort: 'out', target: 'browser', targetPort: 'in' },
      { source: 'browser', sourcePort: 'out', target: 'shape', targetPort: 'in' },
      { source: 'shape', sourcePort: 'out', target: 'reply', targetPort: 'in' },
    ],
  },
];
