import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Card, Col, Divider, Form, Input, InputNumber, Row, Space, Switch, Typography } from 'antd';
import { DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { DEFAULT_SETTINGS } from '../../../../shared/rzl';
import { api } from '../../lib/api';
import { useAction, useSeason } from '../../lib/hooks';
import { useSeasonId } from './SeasonLayout';

export function SettingsTab() {
  const id = useSeasonId();
  const { data } = useSeason(id);
  const [form] = Form.useForm();
  const { modal } = App.useApp();
  const nav = useNavigate();
  const save = useAction((v: Record<string, unknown>) => api.patch(`/seasons/${id}`, v), 'Uloženo');
  const del = useAction(() => api.delete(`/seasons/${id}`), 'Sezóna smazána');

  useEffect(() => {
    if (data) form.setFieldsValue({ name: data.name, startYear: data.startYear, settings: data.settings });
  }, [data, form]);

  return (
    <Row gutter={16}>
      <Col xs={24} lg={14}>
        <Card title="Pravidla sezóny">
          <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
            <Space wrap>
              <Form.Item name="name" label="Název">
                <Input style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="startYear" label="Rok začátku (pro kategorie)" extra="J ≤ Y−15, HD16 Y−14..13, HD14 Y−12..11, HD12 Y−10..9, HD10 ≥ Y−8">
                <InputNumber style={{ width: 120 }} />
              </Form.Item>
              <Form.Item name={['settings', 'bestN']} label="Započítat nejlepších">
                <InputNumber min={1} max={20} />
              </Form.Item>
              <Form.Item name={['settings', 'hd8']} label="Kategorie HD 8" valuePropName="checked" extra="samostatně (nar. ≥ Y−6), jinak v HD 10">
                <Switch />
              </Form.Item>
            </Space>
            <Divider titlePlacement="start">Body za turnaj (násobek × body + přičíst)</Divider>
            <Space wrap size="large">
              {(['A', 'B', 'C'] as const).map((g) => (
                <Space key={g} align="baseline">
                  <b className={`grp-${g}`}>{g}:</b>
                  <Form.Item name={['settings', 'scoring', g, 'mult']} noStyle>
                    <InputNumber min={0} max={10} step={0.5} style={{ width: 64 }} />
                  </Form.Item>
                  × body +
                  <Form.Item name={['settings', 'scoring', g, 'add']} noStyle>
                    <InputNumber min={0} max={50} step={0.5} style={{ width: 64 }} />
                  </Form.Item>
                </Space>
              ))}
            </Space>
            <Divider titlePlacement="start">RŽL Elo</Divider>
            <Space wrap>
              <Form.Item name={['settings', 'elo', 'k']} label="K-faktor">
                <InputNumber min={1} max={100} />
              </Form.Item>
              <Form.Item name={['settings', 'elo', 'start']} label="Nový hráč bez Rtg">
                <InputNumber min={0} max={3000} />
              </Form.Item>
              <Form.Item name={['settings', 'elo', 'floor']} label="Minimum">
                <InputNumber min={0} max={3000} />
              </Form.Item>
            </Space>
            <div>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>
                Uložit
              </Button>{' '}
              <Button onClick={() => form.setFieldsValue({ settings: DEFAULT_SETTINGS })}>Výchozí hodnoty</Button>
            </div>
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={10}>
        <Card title="Jak se počítá">
          <Typography.Paragraph>
            <b>Body:</b> A = 2 × body + 5, B = body + 2, C = body. <b>Umístění v kole:</b> jen hráči regionu, nejdřív pořadí turnaje A,
            pak B, pak C. <b>Celkem:</b> součet nejlepších {data?.settings.bestN} výsledků, při rovnosti rozhoduje menší součet umístění
            započítaných výsledků.
          </Typography.Paragraph>
          <Typography.Paragraph>
            <b>RŽL Elo</b> = Rtg hráče v posledním turnaji + K × (skóre − očekávané skóre) proti Rtg soupeřů v tom turnaji (výpočet
            Swiss-Manageru). Volna a kontumace se nepočítají. Ověřeno na průběžném pořadí 2026/27: K = 25, nováček 1000, minimum 900.
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">Ověřeno proti oficiálním PDF 2024/25 a 2026/27 (body sedí u všech hráčů).</Typography.Paragraph>
        </Card>
        <Card title="Nebezpečná zóna" style={{ marginTop: 16 }}>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              modal.confirm({
                title: `Smazat sezónu ${data?.name}?`,
                content: 'Smažou se turnaje a výsledky sezóny. Hráči a oddíly zůstanou.',
                okButtonProps: { danger: true },
                onOk: () => del.mutateAsync(undefined).then(() => nav('/')),
              })
            }
          >
            Smazat sezónu
          </Button>
        </Card>
      </Col>
    </Row>
  );
}
