import {neis,send} from './_common.js';

export default async function handler(req,res){
  // 급식소리함 포털·형제 앱에서 학교 검색을 공용으로 쓸 수 있게 CORS 허용 (공개 나이스 데이터)
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  if(req.method==='OPTIONS') return res.status(204).end();

  try{
    const q=String(req.query.q||'').trim();
    if(q.length<2) return send(res,200,[]);

    const all=String(req.query.all||'')==='1';

    const rows=await neis('schoolInfo',{SCHUL_NM:q,pSize:'100'});
    const schools=rows
      .filter(r=>all || r.ATPT_OFCDC_SC_CODE==='J10' || String(r.ATPT_OFCDC_SC_NM||'').includes('경기도'))
      .map(r=>({
        officeCode:r.ATPT_OFCDC_SC_CODE,
        officeName:r.ATPT_OFCDC_SC_NM,
        schoolCode:r.SD_SCHUL_CODE,
        schoolName:r.SCHUL_NM,
        level:r.SCHUL_KND_SC_NM,
        address:r.ORG_RDNMA,
        region:extractRegion(r.ORG_RDNMA)
      }));
    send(res,200,schools);
  }catch(error){
    send(res,500,{error:error.message});
  }
}

function extractRegion(address=''){
  const m=String(address).match(/경기도\s+([^\s]+)/);
  return m?m[1]:'경기도';
}
