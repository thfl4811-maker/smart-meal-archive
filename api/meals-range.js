import {neis,send} from './_common.js';

export default async function handler(req,res){
  try{
    const office=String(req.query.office||'');
    const school=String(req.query.school||'');
    const from=String(req.query.from||'').replaceAll('-','');
    const to=String(req.query.to||'').replaceAll('-','');
    const mealRaw=String(req.query.meal||'2');
    const meal=/^[123]$/.test(mealRaw)?mealRaw:'2';

    if(!office||!school||!/^\d{8}$/.test(from)||!/^\d{8}$/.test(to)){
      return send(res,400,{error:'학교 또는 기간 값이 올바르지 않습니다.'});
    }

    const start=new Date(
      `${from.slice(0,4)}-${from.slice(4,6)}-${from.slice(6,8)}T00:00:00`
    );

    const end=new Date(
      `${to.slice(0,4)}-${to.slice(4,6)}-${to.slice(6,8)}T00:00:00`
    );

    if(end < start){
      return send(res,400,{error:'종료일은 시작일보다 빠를 수 없습니다.'});
    }

    // 최대 조회기간 3년
    const minDate=new Date(end);
    minDate.setFullYear(minDate.getFullYear()-3);

    if(start < minDate){
      return send(res,400,{error:'조회 기간은 최대 3년입니다.'});
    }

    const rows=await neis('mealServiceDietInfo',{
      ATPT_OFCDC_SC_CODE:office,
      SD_SCHUL_CODE:school,
      MLSV_FROM_YMD:from,
      MLSV_TO_YMD:to,
      MMEAL_SC_CODE:meal,
      pSize:'1000'
    });

    send(res,200,rows.map(r=>({
      date:r.MLSV_YMD,
      mealName:r.MMEAL_SC_NM,
      dishes:r.DDISH_NM||'',
      calories:r.CAL_INFO||'',
      nutrients:r.NTR_INFO||''
    })));

  }catch(error){
    send(res,500,{error:error.message});
  }
}
