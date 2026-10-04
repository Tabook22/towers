/** Keep cached field data usable during a connection failure, but hide it on a 403. */
export function queryNotice({error,hasData,online,paused,isError}:{error:unknown;hasData:boolean;online:boolean;paused:boolean;isError:boolean}){
  const status=(error as {response?:{status?:number}}|undefined)?.response?.status;
  if(status===403)return {kind:'permission',message:"You don't have permission to view teams on this account — ask a full admin to grant it.",hideData:true} as const;
  if(!online||paused)return {kind:'offline',message:hasData?'You are offline. Showing the last available teams; reconnect to refresh.':'Teams are not available offline yet. Reconnect and try again.',hideData:!hasData} as const;
  if(isError)return {kind:'error',message:hasData?'Teams could not be refreshed. Your last available data is still shown.':'Could not load teams. Check your connection and try again.',hideData:!hasData} as const;
  return null;
}
