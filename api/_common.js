const NEIS='https://open.neis.go.kr/hub';

export async function neis(path,params={}){
  const key=process.env.NEIS_API_KEY;
  if(!key) throw new Error('NEIS_API_KEY가 없습니다.');

  const q=new URLSearchParams({
    KEY:key,
    Type:'json',
    pIndex:'1',
    pSize:'1000',
    ...params
  });

  const response=await fetch(`${NEIS}/${path}?${q}`);
  if(!response.ok) throw new Error(`나이스 API 오류 ${response.status}`);

  const json=await response.json();
  const head=json?.[path]?.[0]?.head;
  const result=head?.[1]?.RESULT;
  if(result?.CODE && result.CODE!=='INFO-000'){
    if(result.CODE==='INFO-200') return [];
    throw new Error(result.MESSAGE || '나이스 조회 오류');
  }
  return json?.[path]?.[1]?.row || [];
}

export function send(res,status,data){
  res.status(status).json(data);
}
