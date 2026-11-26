import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Empty, Form, Input, Modal, Progress, Row, Typography } from 'antd';
import { PlusOutlined, TrophyOutlined } from '@ant-design/icons';
import { api } from '../lib/api';
import { useAction, useIsAdmin, useSeasons } from '../lib/hooks';
import { fmtTs } from '../lib/format';

export function SeasonsPage() {
  const { data = [], isLoading } = useSeasons();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const create = useAction((v: { seedTnr: string }) => api.post<{ id: number }>('/seasons', v));
  const [form] = Form.useForm();
  const admin = useIsAdmin();

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Sezóny
        </Typography.Title>
        {admin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Nová sezóna
          </Button>
        )}
      </div>
      {!isLoading && !data.length && <Empty description="Zatím žádná sezóna" />}
      <Row gutter={[16, 16]}>
        {data.map((s) => (
          <Col key={s.id} xs={24} sm={12} lg={8} xl={6}>
            <Card hoverable onClick={() => nav(`/s/${s.id}`)} title={<><TrophyOutlined /> RŽL {s.name}</>}>
              <div className="muted">Seed turnaj {s.seedTnr}</div>
              <div style={{ margin: '8px 0' }}>
                Načteno {s.fetched} / {s.tournaments} turnajů
                <Progress percent={s.tournaments ? Math.round((s.fetched / s.tournaments) * 100) : 0} size="small" showInfo={false} />
              </div>
              <div className="muted" style={{ fontSize: 12 }}>Turnaje zjištěny {fmtTs(s.discoveredAt)}</div>
            </Card>
          </Col>
        ))}
      </Row>
      <Modal
        title="Nová sezóna"
        open={open}
        onCancel={() => setOpen(false)}
        okText="Založit a zjistit turnaje"
        confirmLoading={create.isPending}
        onOk={() =>
          form.validateFields().then((v) =>
            create.mutate(v, {
              onSuccess: (r) => {
                setOpen(false);
                nav(`/s/${r.id}/turnaje`);
              },
            })
          )
        }
      >
        <Typography.Paragraph type="secondary">
          Zadejte první turnaj A sezóny na chess-results (číslo nebo odkaz). Z jeho detailu se načte seznam všech navázaných turnajů
          (kola × A/B/C). Např. 2025/26 = 1250588, 2026/27 = 1492587.
        </Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item name="seedTnr" label="Seed turnaj (A, 1. kolo)" rules={[{ required: true, message: 'Zadejte číslo turnaje' }]}>
            <Input placeholder="https://chess-results.com/tnr1492587.aspx" autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
