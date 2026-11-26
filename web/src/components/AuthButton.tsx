import { useState } from 'react';
import { App, Button, Input, Popover, Space, Tooltip } from 'antd';
import { LockOutlined, LogoutOutlined, UnlockOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiErrorText } from '../lib/api';
import { useAuth } from '../lib/hooks';

/** Small lock in the header: log in to the full (operator) mode / log out back to browsing. */
export function AuthButton() {
  const { data } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries();
  const login = async () => {
    if (!pw) return;
    setBusy(true);
    try {
      await api.post('/auth/login', { password: pw });
      setOpen(false);
      setPw('');
      message.success('Přihlášeno – plný režim');
      await refresh();
    } catch (e) {
      message.error(apiErrorText(e) ?? 'Přihlášení se nezdařilo');
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    await api.post('/auth/logout');
    message.success('Odhlášeno – režim prohlížení');
    await refresh();
  };

  if (data?.admin)
    return (
      <Space size={4} style={{ marginLeft: 'auto' }}>
        <Tooltip title="Plný režim: lze měnit data">
          <UnlockOutlined style={{ color: '#9fd3ff' }} />
        </Tooltip>
        <Tooltip title="Odhlásit (zpět do režimu prohlížení)">
          <Button size="small" type="text" icon={<LogoutOutlined />} style={{ color: '#fff' }} onClick={logout} />
        </Tooltip>
      </Space>
    );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      title="Přihlášení do plného režimu"
      content={
        <Space.Compact>
          <Input.Password autoFocus placeholder="Heslo" value={pw} onChange={(e) => setPw(e.target.value)} onPressEnter={login} style={{ width: 180 }} />
          <Button type="primary" loading={busy} onClick={login}>
            Přihlásit
          </Button>
        </Space.Compact>
      }
    >
      <Tooltip title="Přihlásit" placement="left">
        <Button size="small" type="text" icon={<LockOutlined />} style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.55)' }} />
      </Tooltip>
    </Popover>
  );
}
