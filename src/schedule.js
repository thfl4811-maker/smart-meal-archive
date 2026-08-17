import {neis,send} from './_common.js';

/* 나이스 학사일정(SchoolSchedule) 조회
   /api/schedule?office=..&school=..&from=YYYY-MM-DD&to=YYYY-MM-DD */
export default async function handler(req,res){
  try{
    const office=String(req.query.office||'');
    const school=String(req.query.school||'');
    const from=String(req.query.from||'').replaceAll('-','');
    const to=String(req.query.to||'').replaceAll('-','');

    if(!office||!school||!/^\d{8}$/.test(from)||!/^\d{8}$/.test(to)){
      return send(res,400,{error:'학교 또는 기간 값이 올바르지 않습니다.'});
    }

    const rows=await neis('SchoolSchedule',{
      ATPT_OFCDC_SC_CODE:office,
      SD_SCHUL_CODE:school,
      AA_FROM_YMD:from,
      AA_TO_YMD:to,
      pSize:'1000'
    });

    /* 같은 날짜에 같은 이름이 학년별로 반복되는 경우 중복 제거 */
    const seen=new Set();
    const out=[];
    for(const r of rows){
      const name=String(r.EVENT_NM||'').trim();
      if(!name||name==='토요휴업일')continue;
      const key=`${r.AA_YMD}|${name}`;
      if(seen.has(key))continue;
      seen.add(key);
      out.push({
        date:r.AA_YMD,                       /* YYYYMMDD */
        name,
        offDay:(r.SBTR_DD_SC_NM||'').includes('휴업')  /* 휴업일 여부 */
      });
    }

    send(res,200,out);

  }catch(error){
    send(res,500,{error:error.message});
  }
}
