import { useCallback, useEffect, useMemo, useState } from 'react'

import { request } from '@/api/client'

const ENDPOINT = '/api/dashboard'
const columns = [
  "视图编号",
  "视图名称",
  "指标组合",
  "图表布局",
  "数据刷新秒",
  "对比周期",
  "告警线配置",
  "订阅接收组"
]
const actions = [
  "提交视图评审",
  "发布视图",
  "下线视图"
]
const statuses = [
  "草稿",
  "视图评审中",
  "已发布",
  "已下线"
]

type Row = Record<string, string | number | null>
type MetricRow = Record<string, string | number | null | string[] | Record<string, number>>
type Snapshot = {
  视图编号: string
  视图名称?: string
  版本号: number | null
  批次号?: string
  发布时间?: string | null
  字段范围?: string[]
  items?: MetricRow[]
  notifications?: Record<string, string | number | null>[]
}

export default function DashboardView() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const filterFields = useMemo(() => ["视图编号", "视图名称", "status"], [])

  const reload = useCallback(async () => {
    setErrorMessage('')
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value)
    ).toString()
    try {
      const response = await request(`${ENDPOINT}?${query}&size=200`)
      if (!response.ok) {
        throw new Error('看板视图列表读取失败')
      }
      const payload = await response.json()
      setRows(payload.items ?? [])
      setTotal(payload.total ?? 0)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '运营看板列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    void reload()
  }, [reload])

  async function runAction(action: string, row: Row) {
    setErrorMessage('')
    try {
      const response = await request(`${ENDPOINT}/${row.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      })
      if (!response.ok) {
        throw new Error('运营看板动作未生效，请稍后重试')
      }
      const payload = await response.json()
      if (!payload.ok) {
        throw new Error(payload.message ?? '运营看板操作失败')
      }
      await reload()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '运营看板操作失败')
    }
  }

  async function openMetrics(row: Row) {
    setErrorMessage('')
    try {
      const response = await request(`${ENDPOINT}/${row.id}/metrics`)
      if (!response.ok) {
        throw new Error('看板指标明细读取失败')
      }
      setSnapshot(await response.json())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '看板指标明细读取失败')
    }
  }

  const publishedCount = rows.filter((row) => row.status === '已发布').length
  const reviewingCount = rows.filter((row) => row.status === '视图评审中').length
  const linkedCount = rows.filter((row) => row.指标数据版本).length

  return (
    <section className="page" data-module="dashboard">
      <header className="page-head">
        <div>
          <h2>运营看板管理</h2>
          <p className="page-desc">
            配置运营数据看板视图，组合多维度指标和实时告警线；实验看板指标明细数据集发布后，发布准入、数据版本与订阅通知在本列表可核对。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('看板视图登记入口尚未接入审批流')}>
            登记看板视图
          </button>
          <button className="btn" type="button" onClick={() => window.open(`${ENDPOINT}/export`, '_blank')}>
            导出运营看板清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        <article className="stat-card">
          <span className="stat-label">看板视图总数（当前筛选）</span>
          <strong className="stat-value">{rows.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已发布视图</span>
          <strong className="stat-value">{publishedCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">评审中视图</span>
          <strong className="stat-value">{reviewingCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">已关联指标数据集</span>
          <strong className="stat-value">{linkedCount}</strong>
        </article>
      </div>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); void reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field === 'status' ? '视图状态' : field}</span>
            {field === 'status' ? (
              <select
                value={filters[field] ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
              >
                <option value="">全部</option>
                {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            ) : (
              <input
                value={filters[field] ?? ''}
                placeholder={`按${field}检索`}
                onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
              />
            )}
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>视图状态</th>
            <th>发布准入 / 数据版本</th>
            <th>告警线状态</th>
            <th>订阅同步</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td>{row.status ?? '—'}</td>
              <td>
                {row.指标数据版本 ? (
                  <span>
                    {String(row.发布准入 ?? '—')}
                    <span style={{ display: 'block' }}>数据版本 V{String(row.指标数据版本)} / 批次 {String(row.发布批次号)}</span>
                    <button className="link" type="button" onClick={() => void openMetrics(row)}>查看指标明细</button>
                  </span>
                ) : (
                  <span>{String(row.发布准入 ?? '未发布')}</span>
                )}
              </td>
              <td>{String(row.告警线状态 ?? '—')}</td>
              <td>{String(row.订阅同步状态 ?? '—')}</td>
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => void runAction(action, row)}>
                    {action}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 5}>暂无运营看板数据，可先登记看板视图</td>
            </tr>
          )}
        </tbody>
      </table>

      {snapshot && (
        <div style={{ marginTop: 20 }}>
          <h3>
            {snapshot.视图编号} 指标明细
            <button className="btn ghost" type="button" style={{ marginLeft: 12 }} onClick={() => setSnapshot(null)}>关闭面板</button>
          </h3>
          <p className="page-desc">
            {snapshot.版本号
              ? `数据版本 V${snapshot.版本号}（批次 ${snapshot.批次号}），字段范围：${(snapshot.字段范围 ?? []).join('、')}，发布时间：${snapshot.发布时间 ?? '—'}`
              : '该视图尚无已发布的实验看板指标明细数据集'}
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>行类型</th><th>关联实验</th><th>变体编号</th><th>变体状态</th>
                <th>分流占比</th><th>指标组合</th><th>指标差异</th><th>告警线状态</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot.items ?? []).map((item, index) => (
                <tr key={index}>
                  <td>{String(item.行类型 ?? '—')}</td>
                  <td>{String(item.关联实验 ?? '—')}</td>
                  <td>{String(item.变体编号 ?? '—')}</td>
                  <td>{String(item.变体状态 ?? '—')}</td>
                  <td>{String(item.分流占比 ?? '—')}</td>
                  <td>
                    {item.指标组合 && typeof item.指标组合 === 'object'
                      ? Object.entries(item.指标组合 as Record<string, number>).map(([name, value]) => (
                          <span key={name} style={{ display: 'block' }}>{name}：{value}</span>
                        ))
                      : '—'}
                  </td>
                  <td>
                    {Array.isArray(item.指标差异)
                      ? (item.指标差异 as string[]).map((diff) => <span key={diff} style={{ display: 'block' }}>{diff}</span>)
                      : '—'}
                  </td>
                  <td>{String(item.告警线状态 ?? '—')}</td>
                </tr>
              ))}
              {(snapshot.items ?? []).length === 0 && (
                <tr><td className="empty-state" colSpan={8}>暂无指标明细</td></tr>
              )}
            </tbody>
          </table>
          <h4 style={{ marginTop: 16 }}>订阅告警通知（{snapshot.notifications?.length ?? 0} 条）</h4>
          <table className="data-table">
            <thead>
              <tr><th>通知编号</th><th>订阅接收组</th><th>关联实验</th><th>告警线状态</th><th>通知时间</th></tr>
            </thead>
            <tbody>
              {(snapshot.notifications ?? []).map((notify) => (
                <tr key={String(notify.id)}>
                  <td>{String(notify.通知编号 ?? '—')}</td>
                  <td>{String(notify.订阅接收组 ?? '—')}</td>
                  <td>{String(notify.关联实验 ?? '—')}</td>
                  <td>{String(notify.告警线状态 ?? '—')}</td>
                  <td>{String(notify.通知时间 ?? '—')}</td>
                </tr>
              ))}
              {(snapshot.notifications ?? []).length === 0 && (
                <tr><td className="empty-state" colSpan={5}>暂无订阅告警通知</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <footer className="page-foot">
        <span>共 {total} 条运营看板记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
