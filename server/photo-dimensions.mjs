// Narrow header inspection, informed by image-size's MIT-licensed format readers:
// https://github.com/image-size/image-size/tree/main/lib/types
// WebP bit layouts: https://www.rfc-editor.org/rfc/rfc9649.html
// No image decoding or unbounded decompression takes place on the server.
const invalid=()=>Object.assign(Error('Повреждённый или неподдерживаемый заголовок фото. Пересохрани снимок как JPEG, PNG или обычный WebP.'),{status:400})
const maximum=()=>Object.assign(Error('Фото слишком большое: максимум 40 млн пикселей и 20 000 пикселей по каждой стороне. Уменьши снимок.'),{status:413})
export function pngHeaderCrc(bytes){
  let crc=0xffffffff
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
  return (crc^0xffffffff)>>>0
}
function bounded(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw invalid()
  if(width>20000||height>20000||width*height>40000000)throw maximum()
  return {width,height}
}
function pngSize(bytes){
  if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw invalid()
  if(bytes.readUInt32BE(29)!==pngHeaderCrc(bytes.subarray(12,29)))throw invalid()
  const size=bounded(bytes.readUInt32BE(16),bytes.readUInt32BE(20))
  const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}
  if(!depths[bytes[25]]?.includes(bytes[24])||bytes[26]!==0||bytes[27]!==0||bytes[28]>1)throw invalid()
  let offset=8,idat=false,ended=false
  while(offset<bytes.length){
    if(offset+12>bytes.length)throw invalid()
    const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8)
    if(!/^[A-Za-z]{4}$/.test(type)||offset+12+length>bytes.length||type==='acTL'||(offset!==8&&type==='IHDR'))throw invalid()
    if(type==='IDAT'&&length)idat=true
    offset+=12+length
    if(type==='IEND'){if(length!==0||offset!==bytes.length)throw invalid();ended=true;break}
  }
  if(!idat||!ended)throw invalid()
  return size
}
function jpegSize(bytes){
  if(bytes.length<16||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw invalid()
  let offset=2,size
  while(offset<bytes.length-2){
    if(bytes[offset++]!==255)throw invalid()
    while(bytes[offset]===255)offset++
    if(offset>=bytes.length)throw invalid()
    const marker=bytes[offset++]
    if(marker===0||marker===216||marker===217)throw invalid()
    if(marker===1||(marker>=208&&marker<=215))continue
    if(offset+2>bytes.length)throw invalid()
    const length=bytes.readUInt16BE(offset)
    if(length<2||offset+length>bytes.length)throw invalid()
    const sof=marker>=192&&marker<=207&&![196,200,204].includes(marker)
    if(sof){
      if(length<11||![8,12,16].includes(bytes[offset+2]))throw invalid()
      const components=bytes[offset+7]
      if(components<1||components>4||length!==8+3*components)throw invalid()
      const found=bounded(bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3))
      if(size&&(size.width!==found.width||size.height!==found.height))throw invalid()
      size=found
    }
    if(marker===218){
      if(!size||length<6||bytes[offset+2]<1||bytes[offset+2]>4||length!==6+2*bytes[offset+2]||offset+length>=bytes.length-2)throw invalid()
      return size
    }
    offset+=length
  }
  throw invalid()
}
function webpSize(bytes){
  if(bytes.length<26||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw invalid()
  let offset=12,canvas,size
  while(offset<bytes.length){
    if(offset+8>bytes.length)throw invalid()
    const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8,end=start+length
    if(end+(length&1)>bytes.length)throw invalid()
    if(offset===12&&!['VP8X','VP8 ','VP8L'].includes(type))throw invalid()
    if(type==='VP8X'){
      if(offset!==12||length!==10||(bytes[start]&0xc3)!==0||bytes[start+1]||bytes[start+2]||bytes[start+3])throw invalid()
      canvas=bounded(1+bytes.readUIntLE(start+4,3),1+bytes.readUIntLE(start+7,3))
    }else if(type==='VP8 '){
      if(size||length<10||(bytes[start]&1)!==0||bytes.toString('hex',start+3,start+6)!=='9d012a')throw invalid()
      size=bounded(bytes.readUInt16LE(start+6)&0x3fff,bytes.readUInt16LE(start+8)&0x3fff)
    }else if(type==='VP8L'){
      if(size||length<5||bytes[start]!==47||(bytes[start+4]>>5)!==0)throw invalid()
      const bits=bytes.readUInt32LE(start+1)
      size=bounded(1+(bits&0x3fff),1+((bits>>>14)&0x3fff))
    }else if(type==='ANIM'||type==='ANMF')throw invalid()
    offset=end+(length&1)
  }
  if(!size||(canvas&&(canvas.width!==size.width||canvas.height!==size.height)))throw invalid()
  return canvas??size
}
export function inspectPhotoDimensions(bytes,type){
  try{return type==='image/png'?pngSize(bytes):type==='image/jpeg'?jpegSize(bytes):type==='image/webp'?webpSize(bytes):(()=>{throw invalid()})()}
  catch(error){if(error.status)throw error;throw invalid()}
}
