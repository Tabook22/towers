import { Button } from '@mui/material';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { tr, useLanguage } from '../i18n';

export function EditSourceInspectionButton({ findingKey }: { findingKey: string }) {
  useLanguage();
  const { user } = useAuth();
  if (!['admin', 'reviewer', 'inspector', 'team_leader'].includes(user?.role || '') || !/^\d+:\d+$/.test(findingKey)) return null;
  const [visit, position] = findingKey.split(':');
  return <Button component={Link} startIcon={<EditOutlined />} to={`/visits/${visit}?position=${position}&check=temperatures&correct=1`}>{tr('Correct source readings')}</Button>;
}
