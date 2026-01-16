module.exports = {
  apps: [
    {
      name: 'api',
      script: './src/api/server.js',
      watch: ['./src/api', './app/common'],
      watch_delay: 500
    },
    {
      name: 'eth-event-retriever',
      script: './src/workers/eventRetriever.js',
      args: '--eventSource ethereum',
      watch: ['./src/workers', './src/common'],
      watch_delay: 500
    },
    {
      name: 'stk-event-retriever',
      script: './src/workers/eventRetriever.js',
      args: '--eventSource starknet',
      watch: ['./src/workers', './src/common'],
      watch_delay: 500
    },
    {
      name: 'event-processor',
      script: './src/workers/eventProcessor.js',
      watch: ['./src/workers', './src/common'],
      watch_delay: 500
    },
    {
      name: 'elastic-indexer',
      script: './src/workers/elasticsearch.js',
      watch: ['./src/workers', './src/common'],
      watch_delay: 500
    }
  ]
};
