import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aiHealth,handleAiExtraction} from './ai.mjs';

function settings() {
  return {DEEPSEEK_API_KEY:randomUUID()};
}
function provider(data, extra={}) {
  return Response.json({status:'completed',output:[
    {type:'reasoning',summary:[]},
    {type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}
  ],...extra});
}
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8BiXAAAAAASUVORK5CYII=';
const need={id:'chair',label:'椅子',sourceText:'两把椅子',quantity:2,phoneWidthMm:null,phoneWeightG:null};
const data={purpose:'小组活动',needs:[need],startLocal:null,endLocal:null,allowAlternatives:null,missingQuestions:['几点开始？'],evidence:[{field:'quantity',quote:'两把椅子'}]};
const item={name:'Ruler',category:'unknown',visibleQuantity:1,visibleText:'10cm',specSuggestions:[{field:'widthMm',value:'100'}],uncertainties:[]};
const sceneItem={id:'a',name:'Laptop',category:'electronics',bbox:[100,100,500,600],visibleQuantity:1,visibleText:'',uncertainties:[]};

test('configuration health contains public metadata only and never calls a provider',()=>{
  const env=settings();
  for (const ready of [false,true]) {
    const health=aiHealth(ready?env:{});
    assert.equal(health.service,'waicy-resource-commons');
    assert.equal(health.remoteProcessing,true);
    assert.equal(health.modelAvailable,ready);
    assert.equal(health.apiVerified,false);
    assert.equal(JSON.stringify(health).includes(env.DEEPSEEK_API_KEY),false);
  }
  const priorConfig={OPENAI_API_KEY:randomUUID(),RESOURCE_AI_MODEL:'gpt-4o-mini'};
  const unconfigured=aiHealth(priorConfig);
  assert.equal(unconfigured.modelAvailable,false);
  assert.equal(unconfigured.model,'deepseek-flash');
  assert.equal(unconfigured.provider,'DeepSeek');
  assert.equal(unconfigured.backend,'deepseek');
});

test('a single request uses the private server credential and the selected UI language',async()=>{
  const env={...settings(),OPENAI_API_KEY:randomUUID(),RESOURCE_AI_MODEL:'gpt-4o-mini'};
  const source='需要两把椅子。';
  let billing=0,calls=0;
  const result=await handleAiExtraction('request',{text:source,language:'zh-CN'},env,async(url,opts)=>{
    assert.equal(billing,1);calls++;
    assert.equal(url,'https://api.deepseek.com/responses');
    assert.equal(opts.redirect,'manual');
    assert.equal(opts.headers.Authorization,'Bearer '+env.DEEPSEEK_API_KEY);
    assert.ok(opts.signal);
    assert.equal(opts.body.includes(env.DEEPSEEK_API_KEY),false);
    assert.equal(JSON.stringify(opts).includes(env.OPENAI_API_KEY),false);
    const actual=JSON.parse(opts.body);
    assert.equal(actual.model,'deepseek-flash');
    assert.deepEqual(actual.reasoning,{effort:'none'});
    assert.match(actual.instructions,/Simplified Chinese/);
    assert.equal(actual.max_output_tokens,1200);
    assert.equal(actual.input[0].content[0].text,source);
    assert.equal(actual.text.format.type,'json_schema');
    assert.equal(actual.text.format.name,'resource_request');
    assert.equal(actual.text.format.schema.additionalProperties,false);
    return provider({...data,
      needs:[need,{...need,label:'Unfounded',sourceText:'missing'}],
      evidence:[...data.evidence,{field:'made up',quote:'missing'}],
      startLocal:'2026-02-31T11:00',endLocal:'next Friday'},{usage:{total_tokens:27,private_details:env.DEEPSEEK_API_KEY}});
  },()=>{billing++;});
  assert.equal(calls,1);
  assert.deepEqual(result.data,data);
  assert.equal(result.usage.total_tokens,27);
  assert.equal(result.requiresHumanConfirmation,true);
  assert.equal(JSON.stringify(result).includes(env.DEEPSEEK_API_KEY),false);
});

test('invalid input or configuration never consumes a budget slot or calls the provider',async()=>{
  const env=settings();
  for (const [kind,body,config,status] of [
    ['request',{text:' '},env,400], ['request',{text:'a'.repeat(6001)},env,400],
    ['request',{text:'chairs',model:'client choice'},env,400], ['request',{text:'x',language:'constructor'},env,400],
    ['request',{text:'x',image},env,400],['scene',{image:'https://example.com/photo'},env,400],
    ['item',{image:image.replace('image/png','image/jpeg')},env,400],
    ['scene',{image:'data:image/png;base64,@@'},env,400], ['toString',{},env,404],
    ['request',{text:'chair'},{OPENAI_API_KEY:randomUUID()},503]
  ]) {
    let calls=0,debited=0;
    await assert.rejects(()=>handleAiExtraction(kind,body,config,()=>{calls++;},()=>{debited++;}),{status});
    assert.equal(debited,0);assert.equal(calls,0);
  }
});

test('budget rejection propagates unchanged without sending the provider request',async()=>{
  const blocked=Object.assign(new Error('limit reached'),{status:429});
  let calls=0;
  await assert.rejects(()=>handleAiExtraction('scene',{image},settings(),()=>{calls++;},async()=>{throw blocked;}),err=>err===blocked);
  assert.equal(calls,0);
});

test('photo output is limited to known fields and valid counts; model cannot grant permissions',async()=>{
  const env=settings();
  const final=await handleAiExtraction('item',{image,language:'es'},env,async(_,opts)=>{
    const payload=JSON.parse(opts.body);
    assert.match(payload.instructions,/Spanish/);
    assert.deepEqual(payload.input[0].content[1],{type:'input_image',image_url:image,detail:'auto'});
    return provider({...item,visibleQuantity:-3,specSuggestions:[...item.specSuggestions,{field:'owner',value:'someone'}]});
  });
  assert.equal(final.data.visibleQuantity,null);
  assert.deepEqual(final.data.specSuggestions,item.specSuggestions);
  await assert.rejects(()=>handleAiExtraction('item',{image},env,async()=>provider({...item,approved:true})),{status:502});
});

test('scene candidates remain reviewable and relation IDs are mapped consistently',async()=>{
  const env=settings();
  const scene={items:[sceneItem,{...sceneItem,id:'b',bbox:[3,4,2,5]}],sceneNotes:['Check labels.'],
    relations:[{parentId:'a',childId:'b',relation:'integrated-part',evidence:'The hinge connects the panel to its base.'}]};
  const result=await handleAiExtraction('scene',{image,language:'de'},env,async(_,opts)=>{
    assert.match(JSON.parse(opts.body).instructions,/German/);
    assert.equal(JSON.parse(opts.body).max_output_tokens,3500);
    return provider(scene);
  });
  assert.deepEqual(result.data.items.map(i=>i.id),['scene-001','scene-002']);
  assert.equal(result.data.items[1].bbox,null);
  assert.equal(Object.hasOwn(result.data,'relations'),false);
  assert.equal(result.grouping.proposals[0].applyByDefault,false);
  assert.deepEqual(result.grouping.proposals[0].childIds,['scene-002']);
});

test('upstream errors, credentials and raw headers never appear in public errors',async()=>{
  const env=settings();
  const sources=[
    [()=>new Response(env.DEEPSEEK_API_KEY,{status:403}),503],
    [()=>new Response(env.DEEPSEEK_API_KEY,{status:429}),429],
    [()=>{throw new Error(env.DEEPSEEK_API_KEY);},503],
    [()=>provider({...data,purpose:env.DEEPSEEK_API_KEY}),502],
    [()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:env.DEEPSEEK_API_KEY}]}]}),422],
    [()=>Response.json({status:'incomplete',output:env.DEEPSEEK_API_KEY}),502],
    [()=>provider({...data,needs:[{...need,quantity:'2'}]}),502],
    [()=>new Response('x'.repeat(256001)),502]
  ];
  for (const [fetchMock,status] of sources) {
    await assert.rejects(()=>handleAiExtraction('request',{text:'chairs'},env,fetchMock),err=>{
      assert.equal(err.status,status);
      assert.equal(String(err).includes(env.DEEPSEEK_API_KEY),false);
      return true;
    });
  }
});

test('Workers-compatible manual redirects cannot forward credentials or leak redirect destinations', async () => {
  const env = settings();
  let calls = 0, cancelled = false;
  const fetchMock = async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/responses');
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
    return new Response(new ReadableStream({cancel() {cancelled = true;}}), {
      status: 307, headers: {Location: 'https://example.invalid/' + env.DEEPSEEK_API_KEY}
    });
  };
  await assert.rejects(() => handleAiExtraction('request', {text: 'chairs'}, env, fetchMock), err => {
    assert.equal(err.status, 503);
    assert.equal(String(err).includes(env.DEEPSEEK_API_KEY), false);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test('bounded response reader preserves characters across chunks and releases its lock', async () => {
  const env = settings();
  const bytes = new TextEncoder().encode(await provider(data).text());
  const split = bytes.findIndex(b => b >= 0x80) + 1;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, split));
      controller.enqueue(bytes.subarray(split));
      controller.close();
    }
  });
  const result = await handleAiExtraction('request', {text: '两把椅子'}, env, async () => new Response(body));
  assert.deepEqual(result.data, data);
  assert.equal(body.locked, false);
});
