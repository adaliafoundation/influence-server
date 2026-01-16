const { Client } = require('@sendgrid/client');
const Logger = require('@common/lib/logger');
const appConfig = require('config');

class SendGrid {
  _client;

  _enabled;

  constructor() {
    this._client = new Client();
    this._client.setApiKey(appConfig.get('SendGrid.apiKey'));
    this._enabled = Number(appConfig.get('Notifications.email.enabled'));
  }

  isEnabled() {
    return this._enabled;
  }

  async send({ to, from, templateData, templateId }) {
    if (!this.isEnabled()) {
      Logger.warn('Email notifications are disabled');
      return null;
    }

    if (!from?.email) throw new Error('Invalid from object. Email is required');
    if (!to) throw new Error('Missing recipient email');
    if (!templateId) throw new Error('Missing template ID');

    const request = {
      method: 'POST',
      url: '/v3/mail/send',
      body: {
        from,
        personalizations: [{
          to: [{ email: to }],
          dynamic_template_data: templateData
        }],
        template_id: templateId
      }
    };

    const [response, body] = await this._client.request(request);
    return { response, body };
  }
}

module.exports = SendGrid;
