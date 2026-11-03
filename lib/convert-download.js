'use strict';

// Process the URL within one function invocation, then stream valid ZIP output.
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const media = require('./convert');

const TABLE = Uint32Array.from({length:256}, (_,n)=>{
  let c=n;
  for(let i=0;i<8;i++) c=(c&1)?(c>>>1)^0xedb88320:(c>>>1);
  return c>>>0;
});

function validSource(value) {
  try {
    const u=new URL(value);
    const h=u.hostname.toLowerCase();
    return u.protocol==='https:' && (
      h==='youtu.be' || h==='youtube.com' || h.endsWith('.youtube.com') ||
      h==='soundcloud.com' || h.endsWith('.soundcloud.com')
    );
  } catch { return false; }
}

async function fileInfo(file){
  let crc=0xffffffff, length=0;
  for await(const chunk of fs.createReadStream(file)){
    length+=chunk.length;
    for(const byte of chunk) crc=TABLE[(crc^byte)&255]^(crc>>>8);
  }
  if(length>0xffffffff) throw Error('File too large for ZIP archive.');
  return {crc:(crc^0xffffffff)>>>0, length};
}

function localHeader(filename, info){
  const name=Buffer.from(filename,'utf8');
  const b=Buffer.alloc(30+name.length);
  b.writeUInt32LE(0x04034b50,0);
  b.writeUInt16LE(20,4);
  b.writeUInt16LE(0x0800,6);
  b.writeUInt32LE(info.crc,14);
  b.writeUInt32LE(info.length,18);
  b.writeUInt32LE(info.length,22);
  b.writeUInt16LE(name.length,26);
  name.copy(b,30);
  return b;
}

function centralHeader(filename, info, offset){
  const name=Buffer.from(filename,'utf8');
  const b=Buffer.alloc(46+name.length);
  b.writeUInt32LE(0x02014b50,0);
  b.writeUInt16LE(20,4);
  b.writeUInt16LE(20,6);
  b.writeUInt16LE(0x0800,8);
  b.writeUInt32LE(info.crc,16);
  b.writeUInt32LE(info.length,20);
  b.writeUInt32LE(info.length,24);
  b.writeUInt16LE(name.length,28);
  b.writeUInt32LE(offset,42);
  name.copy(b,46);
  return b;
}

function safeName(value){
  return String(value||'audio').replace(/[^a-z0-9_-]/gi,'-').replace(/-+/g,'-').slice(0,55)||'audio';
}

async function* zipParts(parts, title){
  let offset=0;
  const central=[];
  const base=safeName(title);
  for(let i=0;i<parts.length;i++){
    const filename=base+'-part-'+String(i+1).padStart(2,'0')+'.ogg';
    const file=parts[i].filePath;
    const info=await fileInfo(file);
    const head=localHeader(filename,info);
    central.push(centralHeader(filename,info,offset));
    offset+=head.length+info.length;
    yield head;
    for await(const chunk of fs.createReadStream(file)) yield chunk;
  }
  const start=offset;
  for(const head of central){yield head;offset+=head.length;}
  const footer=Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50,0);
  footer.writeUInt16LE(central.length,8);
  footer.writeUInt16LE(central.length,10);
  footer.writeUInt32LE(offset-start,12);
  footer.writeUInt32LE(start,16);
  yield footer;
}

async function convertDownload({url,speed,normalize,maxSeconds,res,onReady}){
  if(!validSource(url)) throw Error('Gunakan link HTTPS YouTube atau SoundCloud yang valid.');
  const work=await fsp.mkdtemp(path.join(os.tmpdir(),'blackmamer-'));
  try{
    const meta=await media.metadata(url);
    if(meta.durationSec>15*60) throw Error('Sumber maksimal 15 menit untuk konversi via Vercel.');
    const input=await media.extract(url,work);
    const inputInfo=await media.probe(input);
    if(!inputInfo.durationSec) throw Error('Audio tidak terbaca oleh FFprobe.');
    const out=path.join(work,'converted.ogg');
    await media.convert(input,out,{speed,normalize});
    const parts=await media.split(out,work,maxSeconds);
    if(!parts.length) throw Error('FFmpeg tidak menghasilkan output audio.');
    if(onReady) await onReady({title:meta.title,parts:parts.length});
    res.status(200);
    res.setHeader('Content-Type','application/zip');
    res.setHeader('Content-Disposition','attachment; filename="'+safeName(meta.title)+'.zip"');
    res.setHeader('Cache-Control','no-store');
    await pipeline(Readable.from(zipParts(parts,meta.title)),res);
  }finally{
    await fsp.rm(work,{recursive:true,force:true}).catch(()=>{});
  }
}

module.exports={validSource,convertDownload,zipParts};
