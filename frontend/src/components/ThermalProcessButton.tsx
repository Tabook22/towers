import { tr, useLanguage } from '../i18n';
import {useState} from 'react';
import {Alert,Button,Stack,Typography} from '@mui/material';
import {useOffline} from '../offline/OfflineProvider';
import ThermostatIcon from '@mui/icons-material/ThermostatRounded';
import {apiClient} from '../api/client';
import {useAuth} from '../auth/AuthContext';

export function ThermalProcessButton({imageId,disabled}:{imageId:number;disabled?:boolean}){
  useLanguage();
  const {user}=useAuth();const {online}=useOffline();const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(user?.role==='client')return null;
  async function open(){
    if(busy||!online||disabled)return;
    const tab=window.open('about:blank','_blank');
    if(!tab){setError(tr("Allow pop-ups for this site, then try again."));return}
    tab.opener=null;tab.document.title=tr('Opening thermal editor…');tab.document.body.textContent=tr('Opening thermal editor…');
    setBusy(true);setError('');
    try{const {data}=await apiClient.post<{url:string}>(`/api/thermal-bridge/images/${imageId}/launch`);
      if(!data.url.startsWith('/thermal/#inspection='))throw new Error(tr("Unexpected editor address"));
      tab.location.replace(data.url);
    }catch(e){tab.close();const issue=e as {response?:{data?:{detail?:string}};message?:string};setError(issue.response?.data?.detail||issue.message || tr("Could not open thermal editor"))}
    finally{setBusy(false)}
  }
  return <Stack spacing={.75}><Button size="small" variant="contained" startIcon={<ThermostatIcon/>} disabled={disabled||busy||!online} onClick={()=>void open()}>{busy ? tr("Opening editor…") : tr("Process thermal image")}</Button>{!online&&<Typography variant="caption" color="text.secondary">{tr('Reconnect to process this image in Thermal.')}</Typography>}{error&&<Alert severity="error" onClose={()=>setError('')}>{tr(error)}</Alert>}</Stack>;
}
