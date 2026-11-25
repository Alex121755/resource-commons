'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'ai-service.js'), 'utf8');

function loadClient({host = 'alex121755.github.io', answers = [], status = 200} = {}) {
  const requests = [], prompts = [];
  const window = {
    RCI18n: {language: 'es', format: (text,provider) => 'es: ' + text.replace('{0}',provider)},
    confirm: text => { prompts.push(text); return answers.shift(); }
  };
  vm.runInNewContext(source, {
    location: {hostname: host, protocol: 'https:'}, window, AbortSignal,
    fetch: async (url, options) => {
      requests.push({url, options});
      return {ok: status === 200, status, json: async () => ({data:{}, error:'Remote diagnostic text'})};
    }
  });
  return {client: window.ResourceAI, requests, prompts};
}
const remote = {ready: true, remoteProcessing: true, provider:'DeepSeek'};
const signal = new AbortController().signal;

test('Pages contacts its recognition server on health and sends data only after per-action consent', async () => {
  const {client, requests, prompts} = loadClient({answers:[false, true, false, true]});
  await client.health();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://resource-commons-waicy.alexl202301.chatgpt.site/api/health');
  assert.equal(requests[0].options.body, undefined);
  assert.equal(requests[0].options.credentials, 'omit');
  const payload = {text:'I need two chairs'};
  assert.equal(await client.extract('/api/extract-request', payload, remote, signal), null);
  await client.extract('/api/extract-request', payload, remote, signal);
  assert.equal(await client.extract('/api/extract-scene', {image:'example'}, remote, signal), null);
  await client.extract('/api/extract-item', {image:'example',text:'Office notes'}, remote, signal);
  assert.equal(requests.length, 3);
  assert.equal(prompts.length, 4);
  assert.ok(prompts.every(prompt => prompt.startsWith('es: ') && prompt.includes('DeepSeek')));
  assert.match(prompts[3], /photo and its notes or item name/);
  assert.deepEqual(JSON.parse(requests[1].options.body), {...payload, language:'es'});
  assert.deepEqual(Object.keys(requests[1].options.headers).sort(), ['Content-Type','X-Resource-Commons-Consent']);
  assert.equal(requests[1].options.headers['X-Resource-Commons-Consent'], 'cloud-v1');
  assert.equal(requests[1].options.redirect, 'error');
});

test('a local model retains its local API and payload contract', async () => {
  const {client,requests,prompts} = loadClient({host:'localhost'});
  const payload = {text:'Chairs'};
  await client.extract('/api/extract-request', payload, {ready:true,remoteProcessing:false}, signal);
  assert.equal(requests[0].url, '/api/extract-request');
  assert.deepEqual(JSON.parse(requests[0].options.body), payload);
  assert.equal(requests[0].options.headers['X-Resource-Commons-Consent'], undefined);
  assert.equal(prompts.length, 0);
});

test('hosted quota responses use a public message and hosted requests require cloud health', async () => {
  const {client,requests,prompts} = loadClient({answers:[true],status:429});
  await assert.rejects(client.extract('/api/extract-request',{text:'Chairs'},remote,signal), /shared AI limit/);
  await assert.rejects(client.extract('/api/extract-request',{text:'Chairs'},{ready:true,remoteProcessing:false},signal), /offline/);
  assert.equal(requests.length, 1);
  assert.equal(prompts.length, 1);
});
