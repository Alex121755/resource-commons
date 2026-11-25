// The browser talks to Resource Commons. Provider credentials belong on its server.
(() => {
  'use strict';
  const hosted = location.protocol === 'https:' && location.hostname === 'alex121755.github.io';
  const base = hosted ? 'https://resource-commons-waicy.alexl202301.chatgpt.site' : '';
  const available = ['http:', 'https:'].includes(location.protocol) &&
    (hosted || !location.hostname?.endsWith('.github.io'));
  const prompts = {
    '/api/extract-request': 'Send the request text you entered to {0} to suggest planning fields?',
    '/api/extract-item': 'Send this photo and its notes or item name to {0} to suggest inventory details?',
    '/api/extract-scene': 'Send the selected photo to {0} to identify the items in it?'
  };
  function hostedError(status) {
    if (status === 429) return 'The shared AI limit has been reached. Please try again later.';
    if (status === 413) return 'The input is too large. Shorten the text or choose a smaller photo.';
    if (status === 400 || status === 422) return 'The AI service could not read this input. Edit the text or choose another photo.';
    if (status === 504) return 'Recognition timed out. You can try again or enter the details manually.';
    return 'Cloud recognition is unavailable. Please try again later.';
  }
  async function health() {
    const response = await fetch(base + '/api/health', {
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('AI service is offline.');
    return response.json();
  }
  async function extract(endpoint, payload, service, signal) {
    if (!available || !Object.hasOwn(prompts, endpoint) || !service?.ready ||
        (hosted && !service.remoteProcessing)) throw new Error('AI service is offline.');
    if (service.remoteProcessing) {
      const question = prompts[endpoint];
      const provider = service.provider;
      if (!['DeepSeek', 'OpenAI'].includes(provider)) throw new Error('AI service is offline.');
      const message = window.RCI18n?.format(question, provider) ?? question.replace('{0}', provider);
      if (!window.confirm(message)) return null;
    }
    const headers = {'Content-Type': 'application/json'};
    let body = payload;
    if (hosted) {
      headers['X-Resource-Commons-Consent'] = 'cloud-v1';
      body = {...payload, language: window.RCI18n?.language || 'en'};
    }
    let response;
    try {
      response = await fetch(base + endpoint, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
        headers, body: JSON.stringify(body), signal
      });
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw error;
      throw new Error('Could not reach the recognition service. Check your connection and try again.');
    }
    if (hosted && !response.ok) throw new Error(hostedError(response.status));
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.data) {
      throw new Error(!hosted && typeof result?.error === 'string' ? result.error : 'The request failed. Try again later.');
    }
    return result;
  }
  window.ResourceAI = {hosted, available, health, extract};
})();
