// Glosas coránicas en español: equivalencias contextuales priorizadas.
const lexicon={
'بسم':'en el nombre','الله':'Alá','الرحمن':'el Compasivo','الرحيم':'el Misericordioso',
'الحمد':'la alabanza','لله':'a Alá','رب':'Señor','ربى':'mi Señor','ربك':'tu Señor',
'العلمين':'los mundos','العالمين':'los mundos','ملك':'Soberano','مالك':'Dueño',
'يوم':'día','الدين':'el Juicio','إياك':'solo a Ti','نعبد':'adoramos',
'نستعين':'pedimos ayuda','اهدنا':'guíanos','الصراط':'el camino',
'المستقيم':'recto','صراط':'camino','الذين':'quienes','أنعمت':'favoreciste',
'عليهم':'a ellos','غير':'no el de','المغضوب':'quienes recibieron la ira',
'ولا':'ni','الضالين':'los extraviados','الم':'Álif, Lam, Mim',
'ذلك':'ese','الكتب':'el Libro','الكتاب':'el Libro','لا':'no',
'ريب':'duda','فيه':'en él','هدى':'guía','للمتقين':'para los piadosos',
'يؤمنون':'creen','بالغيب':'en lo invisible','ويقيمون':'y establecen',
'الصلوة':'la oración','الصلاة':'la oración','ومما':'y de lo que',
'رزقنهم':'les proveímos','رزقناهم':'les proveímos','ينفقون':'gastan',
'و':'y','فى':'en','في':'en','من':'de','إلى':'hacia','على':'sobre',
'إن':'ciertamente','إنما':'solamente','أن':'que','كان':'era',
'قال':'dijo','قالوا':'dijeron','قل':'di','هو':'él','هم':'ellos',
'هذا':'este','هذه':'esta','ذلكم':'eso','ثم':'luego','قد':'ya',
'يا':'oh','أيها':'ustedes','الناس':'la gente','الحق':'la verdad',
'آمنوا':'creyeron','ربنا':'Señor nuestro','ربهم':'su Señor',
'أولئك':'aquellos','أولئكهم':'aquellos son','والله':'y Alá',
'بالله':'en Alá','لله':'a Alá'
};
const english={
'in the name':'en el nombre','the name':'el nombre','of allah':'de Alá',
'allah':'Alá','(of) allah':'de Alá','the most gracious':'el Compasivo',
'the most merciful':'el Misericordioso','the entirely merciful':'el Compasivo',
'the especially merciful':'el Misericordioso','all praise':'toda alabanza',
'praise':'alabanza','the praise':'la alabanza','lord':'Señor','the lord':'el Señor',
'of the worlds':'de los mundos','the worlds':'los mundos',
'master':'Soberano','owner':'Dueño','the day':'el día','day':'día',
'of judgment':'del Juicio','of recompense':'de la Retribución',
'you alone':'solo a Ti','we worship':'adoramos','we ask for help':'pedimos ayuda',
'guide us':'guíanos','the straight path':'el camino recto',
'the path':'el camino','those who':'quienes','upon them':'sobre ellos',
'not':'no','nor':'ni','the misguided':'los extraviados',
'the book':'el Libro','book':'Libro','that':'ese','this':'este',
'no doubt':'sin duda','doubt':'duda','in it':'en él','a guidance':'una guía',
'guidance':'guía','for the god-conscious':'para los piadosos',
'the god-conscious':'los piadosos','those':'aquellos','who':'que',
'believe':'creen','and establish':'y establecen','in the unseen':'en lo invisible',
'the prayer':'la oración','prayer':'oración','and from what':'y de lo que',
'we have provided them':'les hemos proveído','they spend':'gastan',
'the most':'el más','and':'y','or':'o','in':'en','from':'de',
'with':'con','upon':'sobre','to':'a','for':'para','he':'él',
'she':'ella','they':'ellos','we':'nosotros','you':'tú',
'said':'dijo','say':'di','the people':'la gente','people':'gente',
'your lord':'tu Señor','their lord':'su Señor','our lord':'nuestro Señor',
'mercy':'misericordia','truth':'verdad','the truth':'la verdad',
'punishment':'castigo','the earth':'la tierra','earth':'tierra',
'heaven':'cielo','created':'creó','he created':'Él creó',
'indeed':'ciertamente','verily':'en verdad','surely':'sin duda',
'if':'si','when':'cuando','then':'entonces','but':'pero',
'good':'bien','evil':'mal','fire':'fuego','water':'agua',
'life':'vida','death':'muerte','knowledge':'conocimiento',
'one':'uno','two':'dos','all':'todos','every':'cada'
};
function normalizeArabic(s){return String(s||'').normalize('NFKC')
.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g,'')
.replace(/[إأآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و')
.replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/[^\u0621-\u064A]/g,'')}
function clean(s){return String(s||'').replace(/<[^>]*>/g,'').trim()}
function safe(s){if(typeof s!=='string')return null;const v=s.trim();
if(!v||v.length>85||/[0-9<>()[\]{}]/.test(v)||/\b(translation|translated|allah \d|error|rate limit|limit exceeded|warning|quota|significado de|temor de allah)\b/i.test(v))return null;
if(/[一-龥\u0600-\u06FF]/u.test(v))return null;
return v}
const cache=new Map();
async function translateOne(item){
 const ar=normalizeArabic(item.ar);const en=clean(item.en).toLowerCase();
 if(lexicon[ar])return lexicon[ar];
 if(english[en])return english[en];
 if(!en)return null;
 const cacheKey=ar+'|'+en;if(cache.has(cacheKey))return cache.get(cacheKey);
 // Una sola fuente de traducción; no recurrir a MyMemory, que devolvía
 // entradas de memoria de traducción no relacionadas con el Corán.
 let result=null;
 try{
  const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q='+encodeURIComponent(item.en);
  const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
  if(response.ok){const json=await response.json();const candidate=safe((json[0]||[]).map(row=>row[0]||'').join(''));if(candidate && candidate.toLowerCase()!==en)result=candidate}
 }catch(e){}
 if(result)cache.set(cacheKey,result);
 return result;
}
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
 const items=req.body?.words;
 if(!Array.isArray(items)||items.length>100||items.some(x=>!x||typeof x.ar!=='string'||typeof x.en!=='string'||x.ar.length>100||x.en.length>140))
  return res.status(400).json({error:'Solicitud inválida'});
 let next=0;const result=Array(items.length);
 async function worker(){while(next<items.length){const i=next++;result[i]=await translateOne(items[i])}}
 await Promise.all(Array.from({length:Math.min(8,items.length)},worker));
 res.setHeader('Cache-Control','private, max-age=60');
 return res.status(200).json({glosses:result});
}
