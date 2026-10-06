// Actual captured USB frames through the website parser, using Node Web Streams.
// No claim about browser rendering or real WebSerial performance.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const source = fs.readFileSync(new URL('../../web/shared/serial.js', import.meta.url),'utf8');
const { SerialJsonClient } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const rows = fs.readFileSync(process.argv[2] || new URL('./stress-test/frames.jsonl',import.meta.url),'utf8')
  .trim().split('\n').map(JSON.parse).filter(r=>r.phase===(process.argv[3] || '11_inputs_1ms'));
assert.ok(rows.length>100,'Complete hardware rate sweep first');
const lines=rows.slice(0,1000).map(r=>r.line);
lines.push(JSON.stringify({data:{'Größe🎛':{value:1}},text:'\n\r"\\'})+'\r\n');
const expected=[...lines,lines[0]].map(JSON.parse);
const payload=Buffer.from(lines.join('')+'broken json\n'+lines[0]);
const results=[];
for(const chunkSize of [1,7,64,4096,payload.length]) {
  const received=[],errors=[],text=[];
  let offset=0;
  const client=new SerialJsonClient({onJson:obj=>received.push(obj),
    onTextLine:line=>text.push(line),onReadError:err=>errors.push(String(err))});
  client.port={readable:new ReadableStream({pull(controller) {
    if(offset>=payload.length) return controller.close();
    controller.enqueue(payload.subarray(offset,offset+chunkSize));offset+=chunkSize;
  }})};
  client.keepReading=true;
  const start=performance.now();
  client._startReadLoop();
  await client.readLoopPromise;
  const ms=performance.now()-start;
  assert.deepEqual(received,expected);
  assert.deepEqual(text,['broken json']);
  assert.deepEqual(errors,[]);
  results.push({chunkSize,frames:received.length,ms,framesPerSecond:received.length*1000/ms});
}
console.log(JSON.stringify({runtime:process.version,scope:'Node parser replay; no rendering or real WebSerial',results},null,2));
