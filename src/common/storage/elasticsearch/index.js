const appConfig = require('config');
const { Client } = require('@elastic/elasticsearch');

let client;

class ElasticSearch {
  static get client() {
    if (!client) client = new Client({ node: appConfig.get('Elasticsearch.uri') });
    return client;
  }
}

module.exports = ElasticSearch;
