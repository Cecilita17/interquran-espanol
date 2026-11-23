// Traducción de glosas al español. Nunca devuelve el texto original inglés como glosa española.
const cache = new Map();
const dictionary = {
"the name":"el nombre","in the name":"en el nombre","of allah":"de Alá","allah":"Alá",
"the most gracious":"el Compasivo","the most merciful":"el Misericordioso","all praise":"toda alabanza",
"to allah":"a Alá","lord":"Señor","of the worlds":"de los mundos","master":"Soberano",
"day":"día","judgement":"Juicio","we worship":"adoramos","you alone":"solo a Ti",
"we ask for help":"pedimos ayuda","guide us":"guíanos","the straight path":"el camino recto",
"those":"aquellos","who":"que","upon them":"sobre ellos","you have bestowed favor":"has favorecido",
"not":"no","nor":"ni","the wrongdoers":"los injustos","the misguided":"los extraviados",
"that":"ese","this":"este","the book":"el Libro","book":"Libro","no doubt":"sin duda",
"there is no doubt":"no hay duda","in it":"en él","guidance":"guía","for":"para",
"the god-conscious":"los piadosos","those who":"quienes","believe":"creen",
"in the unseen":"en lo invisible","and establish":"y establecen","the prayer":"la oración",
"and from what":"y de lo que","we have provided them":"les hemos proveído",
"they spend":"gastan","and":"y","or":"o","in":"en","from":"de","with":"con",
"upon":"sobre","to":"a","he":"él","she":"ella","they":"ellos","we":"nosotros",
"you":"tú","i":"yo","a":"un","an":"un","the":"el","is":"es","are":"son",
"said":"dijo","say":"di","he said":"él dijo","they said":"dijeron",
"people":"gente","the people":"la gente","believers":"creyentes",
"your lord":"tu Señor","their lord":"su Señor","our lord":"nuestro Señor",
"mercy":"misericordia","truth":"verdad","the truth":"la verdad",
"fear":"temor","a punishment":"un castigo","punishment":"castigo",
"heaven":"cielo","earth":"tierra","the earth":"la tierra",
"created":"creó","he created":"Él creó","will":"será","shall":"será",
"you are":"eres","they are":"son","we are":"somos",
"indeed":"ciertamente","verily":"en verdad","surely":"sin duda",
"if":"si","when":"cuando","then":"entonces","but":"pero",
"good":"bien","evil":"mal","fire":"fuego","the fire":"el fuego",
"water":"agua","life":"vida","death":"muerte","knowledge":"conocimiento",
"one":"uno","two":"dos","all":"todos","every":"cada"
};
function clean(s){return String(s||'').replace(/<[^>]*>/g,'').trim();}
function local(s){return dictionary[clean(s).toLowerCase()]||null;}
async function translate(s){
 const known=local(s);if(known)return known;
 if(cache.has(s))return cache.get(s);
 let out=null;
 try{
  const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q='+encodeURIComponent(s);
  const response=await fetch(url,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(6000)});
  if(response.ok){const data=await response.json();out=(data[0]||[]).map(p=>p[0]||'').join('').trim()||null;}
 }catch(e){}
 if(!out||out.toLowerCase()===s.toLowerCase()){
   try{
    const url='https://api.mymemory.translated.net/get?q='+encodeURIComponent(s)+'&langpair=en%7Ces';
    const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
    if(response.ok){const data=await response.json();out=data.responseData?.translatedText?.trim()||null;}
   }catch(e){}
 }
 if(out&&out.toLowerCase()!==s.toLowerCase())cache.set(s,out);
 return out&&out.toLowerCase()!==s.toLowerCase()?out:null;
}
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Método no permitido'});
 const items=req.body?.phrases;
 if(!Array.isArray(items)||items.length>120||items.some(s=>typeof s!=='string'||s.length>140))return res.status(400).json({error:'Solicitud inválida'});
 const unique=[...new Set(items.map(clean))];
 const values={};let next=0;
 async function worker(){while(next<unique.length){const phrase=unique[next++];values[phrase]=await translate(phrase);}}
 await Promise.all(Array.from({length:Math.min(10,unique.length)},worker));
 res.setHeader('Cache-Control','private, max-age=60');
 return res.status(200).json({glosses:items.map(s=>values[clean(s)]??null)});
}
