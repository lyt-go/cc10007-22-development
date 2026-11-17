import { useCallback, useEffect, useState } from 'react'

import { request } from '@/api/client'

const ENDPOINT = '/api/abmetric'
const VIEW_CODE = 'DASH-0002'

type Row = Record<string, string | number | null | string[]>
type Version = Record<string, string | number | null | string[]>
type Notification = Record<string, string | number | null>
type CheckResult = {
  版本号: number | null
  批次号?: string
  状态?: string
  落定时间?: string | null
  字段范围?: string[]
  message?: string
  items?: Row[]
}

function MetricCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>—</span>
  if (typeof value === 'object') {
    return (
      <span>
        {Object.entries(value as Record<string, number>).map(([name, num]) => (
          <span key={name} style={{ display: 'block' }}>{name}：{num}</span>
        ))}
      </span>
    )
  }
  return <span>{String(value)}</span>
}

export default function AbmetricView() {
  const [versions, setVersions] = useState<Version[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setErrorMessage('')
    try {
      const [versionRes, rowsRes, notifyRes, checkRes] = await Promise.all([
        request(`${ENDPOINT}/versions`),
        request(`${ENDPOINT}?size=200`),
        request(`${ENDPOINT}/notifications?view_code=${VIEW_CODE}`),
        request(`${ENDPOINT}/check?view_code=${VIEW_CODE}`),
      ])
      if (!versionRes.ok || !rowsRes.ok || !notifyRes.ok || !checkRes.ok) {
        throw new Error('实验看板指标明细读取失败')
      }
      const [versionPayload, rowsPayload, notifyPayload, checkPayload] = await Promise.all([
        versionRes.json(),
        rowsRes.json(),
        notifyRes.json(),
        checkRes.json(),
      ])
      setVersions(versionPayload.items ?? [])
      setRows(rowsPayload.items ?? [])
      setNotifications(notifyPayload.items ?? [])
      setCheckResult(checkPayload)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '实验看板指标明细读取失败')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function postAction(path: string, body?: unknown) {
    setBusy(true)
    setMessage('')
    setErrorMessage('')
    try {
      const response = await request(path, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? '操作未生效')
      }
      setMessage(payload.message)
      await reload()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page" data-module="abmetric">
      <header className="page-head">
        <div>
          <h2>实验看板指标明细数据集</h2>
          <p className="page-desc">
            按 {VIEW_CODE} 指标组合字段范围读取变体分流记录；仅已生效变体可发布到当前看板，同实验多变体按分流占比合并为一套当前指标组合，
            变体状态与指标组合同批次提交，并发核对只采用已落定数据集。
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() => void postAction(`${ENDPOINT}/generate`, { values: { view_code: VIEW_CODE }, remark: '看板页面生成' })}
          >
            生成数据集
          </button>
          <button className="btn" type="button" onClick={() => window.open(`${ENDPOINT}/export`, '_blank')}>
            导出明细
          </button>
        </div>
      </header>

      {(message || errorMessage) && (
        <footer className="page-foot" style={{ marginBottom: 12 }}>
          <span className={errorMessage ? 'error-text' : ''}>{errorMessage || message}</span>
        </footer>
      )}

      <h3>数据版本流水（发布准入可逐版核对）</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>版本号</th><th>批次号</th><th>视图编号</th><th>状态</th><th>字段范围</th>
            <th>实验数</th><th>明细行数</th><th>剔除未生效记录</th><th>生成时间</th><th>落定/发布时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={String(version.版本号)}>
              <td>{String(version.版本号)}</td>
              <td>{String(version.批次号 ?? '—')}</td>
              <td>{String(version.视图编号 ?? '—')}</td>
              <td>{String(version.status ?? '—')}</td>
              <td>{Array.isArray(version.字段范围) ? (version.字段范围 as string[]).join('、') : '—'}</td>
              <td>{String(version.实验数 ?? '—')}</td>
              <td>{String(version.明细行数 ?? '—')}</td>
              <td>
                {Array.isArray(version.剔除未生效记录) && (version.剔除未生效记录 as string[]).length > 0
                  ? (version.剔除未生效记录 as string[]).join('、')
                  : '无'}
              </td>
              <td>{String(version.生成时间 ?? '—')}</td>
              <td>
                {String(version.落定时间 ?? '—')}
                {version.发布时间 ? <><br />{String(version.发布时间)}</> : null}
              </td>
              <td className="row-actions">
                {version.status === '待落定' && (
                  <button
                    className="link"
                    type="button"
                    disabled={busy}
                    onClick={() => void postAction(`${ENDPOINT}/${String(version.版本号)}/settle`)}
                  >
                    整批落定
                  </button>
                )}
                {version.status === '已落定' && (
                  <button
                    className="link"
                    type="button"
                    disabled={busy}
                    onClick={() => void postAction(`${ENDPOINT}/${String(version.版本号)}/publish`)}
                  >
                    发布到看板
                  </button>
                )}
                {version.status === '已发布' && <span>已同步看板</span>}
              </td>
            </tr>
          ))}
          {versions.length === 0 && (
            <tr><td className="empty-state" colSpan={11}>暂无数据集版本，点击「生成数据集」开始</td></tr>
          )}
        </tbody>
      </table>

      <h3 style={{ marginTop: 20 }}>并发核对（只采用已落定数据集）</h3>
      <table className="data-table">
        <tbody>
          <tr>
            <th style={{ width: 160 }}>核对采用版本</th>
            <td>{checkResult?.版本号 ? `V${checkResult.版本号}（批次 ${checkResult.批次号}，状态：${checkResult.状态}）` : (checkResult?.message ?? '暂无已落定数据集')}</td>
          </tr>
          <tr>
            <th>字段范围</th>
            <td>{checkResult?.字段范围 ? checkResult.字段范围.join('、') : '—'}</td>
          </tr>
          <tr>
            <th>落定时间</th>
            <td>{checkResult?.落定时间 ?? '—'}</td>
          </tr>
        </tbody>
      </table>

      <h3 style={{ marginTop: 20 }}>指标明细（变体明细 + 实验合并当前指标组合）</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>版本</th><th>行类型</th><th>关联实验</th><th>变体编号</th><th>变体状态</th>
            <th>分流占比</th><th>指标组合</th><th>实验指标差异</th><th>告警线状态</th><th>来源分流记录</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td>V{String(row.版本号)}</td>
              <td>{String(row.行类型 ?? '—')}</td>
              <td>{String(row.关联实验 ?? '—')}</td>
              <td>{String(row.变体编号 ?? '—')}</td>
              <td>{String(row.变体状态 ?? '—')}</td>
              <td>{String(row.分流占比 ?? '—')}</td>
              <td><MetricCell value={row.指标组合} /></td>
              <td>
                {Array.isArray(row.指标差异)
                  ? (row.指标差异 as string[]).map((item) => <span key={item} style={{ display: 'block' }}>{item}</span>)
                  : '—'}
              </td>
              <td>{String(row.告警线状态 ?? '—')}</td>
              <td>{String(row.来源分流记录 ?? '—')}</td>
              <td>{String(row.status ?? '—')}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td className="empty-state" colSpan={11}>暂无指标明细行</td></tr>
          )}
        </tbody>
      </table>

      <h3 style={{ marginTop: 20 }}>订阅告警通知（随当前看板指标同步更新）</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>通知编号</th><th>版本</th><th>批次</th><th>关联实验</th><th>订阅接收组</th>
            <th>告警线状态</th><th>指标差异摘要</th><th>通知时间</th>
          </tr>
        </thead>
        <tbody>
          {notifications.map((notify) => (
            <tr key={String(notify.id)}>
              <td>{String(notify.通知编号 ?? '—')}</td>
              <td>V{String(notify.版本号 ?? '—')}</td>
              <td>{String(notify.批次号 ?? '—')}</td>
              <td>{String(notify.关联实验 ?? '—')}</td>
              <td>{String(notify.订阅接收组 ?? '—')}</td>
              <td>{String(notify.告警线状态 ?? '—')}</td>
              <td>{String(notify.指标差异摘要 ?? '—')}</td>
              <td>{String(notify.通知时间 ?? '—')}</td>
            </tr>
          ))}
          {notifications.length === 0 && (
            <tr><td className="empty-state" colSpan={8}>暂无订阅告警通知，发布数据集后自动生成</td></tr>
          )}
        </tbody>
      </table>
    </section>
  )
}
